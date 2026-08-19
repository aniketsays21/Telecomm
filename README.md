# Telecomm

**An AI-driven customer support platform.** One inbox for chat and email; a
knowledge-grounded AI that resolves what it can; a dashboard that shows what's
actually happening. Built to feel like a modern SaaS product you'd hand to a
real support team, not a demo.

---

## Product surface

**For the customer (the person needing help)**
- Embeddable chat widget — one `<script>` tag, drops onto any site
- AI answers grounded in your knowledge base, cites articles as inline links
- Detects language and replies in it
- Proactive triggers (auto-open the chat after N seconds on a URL match)
- Live human hand-off — header switches to "Aniket is here" the moment an agent replies
- Persistent conversation across page reloads

**For the agent / admin (the dashboard)**
- Unified inbox: chat + email in one list, status / channel / search filters
- Full message thread with contact profile, page-view journey, AI-drafted summary
- **Suggest reply** — AI drafts a first-person reply grounded in the KB, agent edits before sending
- Canned responses with `/` slash-picker
- Team management: invite agents by email, per-agent working hours, capacity limits
- Auto-assignment based on who's on-duty and least loaded
- SLA tracking with breach alerts
- Analytics dashboard: volume, sentiment, response time, top problems, channel split

**Integrations**
- **Gmail** — OAuth into any Gmail; subject-rule routing decides what becomes a ticket
- **Postmark** (legacy path, still supported) — forward-to-inbound
- **Outbound webhooks** — HMAC-SHA256 signed deliveries of conversation + message events, with retry & failure log

**Knowledge base**
- Website crawler with sitemap + robots.txt awareness (up to 500 pages/source)
- File upload: PDF, DOCX, TXT, MD up to 25 MB
- Postgres full-text search (BM25-style) — no external embedding provider needed

**Ops**
- **Demo mode toggle** in the sidebar seeds ~350 realistic conversations, ~1,250 messages, 30 KB docs, and 8 canned replies so you can see the platform at scale. Toggle off wipes only the demo rows.

---

## Architecture

```
┌─────────────────────┐   ┌───────────────────────┐   ┌────────────────────┐
│  Widget (Preact)    │   │  Web (Next.js 15)     │   │  Postgres          │
│  apps/widget        │──▶│  apps/web             │──▶│  (Neon / Railway)  │
│  ~25 KB gzipped     │   │  App Router SSR       │   │  drizzle-orm       │
└─────────┬───────────┘   └──────────┬────────────┘   └──────────▲─────────┘
          │                          │                           │
          │ POST /widget/chat        │ REST via `api.*` client   │
          ▼                          ▼                           │
┌────────────────────────────────────────────────────────────────┴────────┐
│  API (Fastify)  apps/api                                                │
│  ─────────────────────────────────────────────────────────────────────  │
│  auth · inbox · widget/chat · gmail (OAuth+poll) · analytics · webhooks │
│  onboarding · knowledge · triggers · demo · csat · users · workspaces   │
│  ─────────────────────────────────────────────────────────────────────  │
│  Workers (BullMQ + Redis): ingest (crawl + chunk), sla-check, gmail-poll│
└──────────┬────────────────────────────┬──────────────────────────────────┘
           │                            │
           ▼                            ▼
┌────────────────────┐         ┌──────────────────────────┐
│ Anthropic Claude   │         │ Redis (BullMQ queues)    │
│ Haiku 4.5 (ans+sum)│         │ (Upstash / Railway)      │
└────────────────────┘         └──────────────────────────┘
```

### Monorepo layout

```
apps/
  api/         Fastify HTTP API, background workers, esbuild-bundled for prod
  web/         Next.js 15 dashboard (App Router, React 19, server actions)
  widget/      Preact 10 chat widget bundle served at /widget.js by the API

packages/
  db/          Drizzle ORM schema + migrations (Postgres 15+)
  ai/          Anthropic-backed answer/summarize/draft functions (thin)
  shared/      Cross-app types + BullMQ queue name constants
```

### How a customer message flows

1. **Widget POST** `/widget/chat` with `workspaceId + sessionId + message`
2. **Contact upsert** on `(workspaceId, sessionId)`, conversation upserted
3. **Retrieval** — `searchChunks()` runs a `ts_rank_cd` full-text query over `chunks.tsv`
4. **AI call** — `generateAnswer(question, chunks, settings, history)` returns
   `{ answer, confidence, sentiment, language, extracted, sources, shouldEscalate }`
5. **Sentiment written** on both `messages` and `conversations` rows
6. **Auto-assign** to the best-available agent if escalated (`pickBestAgent`)
7. **Webhooks fan out** — `conversation.created`, `message.created`, optionally
   `conversation.escalated` are signed with HMAC-SHA256 and delivered with
   5-attempt exponential-backoff retry
8. **Widget renders** the reply with clickable KB-article chips underneath
9. **Poller** picks up any subsequent agent reply, badges the launcher

### Data model highlights

- `conversations.sentiment` is the *latest classified turn* — good enough for
  rollups without walking the message table
- `chunks.tsv` is a `GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`
  column with a GIN index — retrieval is a single SQL query, no embedding provider
- Every table that can hold seeded rows has an `is_demo boolean` so demo-mode
  wipe deletes exactly what was seeded
- `webhook_deliveries` logs every attempt (success + fail) for the admin log view

---

## Tech stack

| Layer            | Choice                                | Why                                                                |
|------------------|---------------------------------------|--------------------------------------------------------------------|
| Language         | TypeScript 5.6                        | One language, real types across web/api/widget                     |
| Package manager  | pnpm 10 + Turborepo                   | Fast installs, workspace protocol, cached builds                   |
| Web              | Next.js 15 (App Router, React 19)     | Server actions, streaming, edge-friendly RSC                       |
| API              | Fastify 5 + Zod                       | Fast, schema-validated, first-class TypeScript ergonomics          |
| Widget           | Preact 10                             | React API in ~3 KB — matters for a script injected on customer sites |
| DB               | Postgres 15+ (with `pgcrypto`)        | Battle-tested, `tsvector` for full-text search, JSONB for settings |
| ORM              | Drizzle                               | SQL-first types; no heavy runtime                                  |
| Queues           | BullMQ + Redis                        | Retry, backoff, delayed jobs — for ingest + SLA + Gmail polling    |
| AI               | Anthropic Claude (Haiku 4.5)          | Answer + summarize + draft-reply. Cheap, fast, quality-competitive |
| Mail (outbound)  | Nodemailer (SMTP or Ethereal in dev)  | Provider-agnostic; Gmail sends go through Gmail API                |
| Mail (inbound)   | Gmail API (History pull)              | No inbound MX config; per-workspace mailbox connection             |
| Deploy           | Railway (API + web + Postgres + Redis)| One repo, one platform, monorepo-friendly                          |

---

## What's included (v1)

**Channels**
- ✅ Chat widget (installed via `<script>` tag)
- ✅ Gmail (per-workspace OAuth + subject-rule routing)
- ✅ Postmark inbound forwarding (legacy — Gmail is preferred)

**AI**
- ✅ Grounded answers using Postgres full-text search over KB
- ✅ Inline markdown-link citations to source articles
- ✅ Language detection + reply in same language
- ✅ Sentiment classification (positive / neutral / negative / frustrated / angry)
- ✅ Auto-topic tagging for analytics
- ✅ Agent reply drafts (`/inbox/conversations/:id/suggest-reply`)
- ✅ Rolling conversation summary for agent side panel

**Knowledge base**
- ✅ Website crawler (sitemap.xml + `Sitemap:` in robots.txt + BFS)
- ✅ File upload (PDF/DOCX/TXT/MD, ≤ 25 MB)
- ✅ Manual text paste
- ✅ Re-sync per source

**Inbox**
- ✅ Chat + email in one list
- ✅ Status / channel / search filters
- ✅ Internal notes
- ✅ Canned responses with `/` picker
- ✅ CSAT email on resolve

**Team**
- ✅ Invite by email (link fallback if SMTP not configured)
- ✅ Per-agent working hours + capacity
- ✅ Auto-assign to on-duty least-loaded agent

**Automations**
- ✅ Proactive chat triggers (time-on-page + URL pattern)
- ✅ SLA due-at with breach alerts

**Platform**
- ✅ Outbound webhooks (HMAC signed, retry, delivery log)
- ✅ Public API (Bearer JWT) for every dashboard operation
- ✅ Demo mode toggle (seeds/wipes realistic sample data)
- ✅ CSV export of conversations

---

## What's NOT included (roadmap)

- ❌ **Voice notes / attachments** — needs object storage (R2 / S3) decision
- ❌ **Real-time WebSocket everywhere** — inbox uses SSE-lite polling; widget polls at 3s
- ❌ **Inbound webhooks from Freshdesk / Shopify / Zendesk** (each is its own OAuth + event-mapping pass)
- ❌ **AI tool-use** — the AI can't yet call `check_order_status(id)` or `apply_credit(amount)`
- ❌ **Hybrid semantic + BM25 search** — BM25 only right now
- ❌ **Reranker** — top-K goes straight from search to prompt
- ❌ **Auto-recrawl scheduler** — sources sync on manual request only
- ❌ **Headless-browser crawler** for JS-rendered SPAs
- ❌ **Multi-language UI** — the AI replies in-language but the dashboard is English-only
- ❌ **SSO / SCIM / audit log** — enterprise plumbing
- ❌ **Native mobile apps** — dashboard is web-responsive, no iOS/Android app
- ❌ **Slack integration** for agent-side reply
- ❌ **Public help center** generated from your KB (nice deflection channel)
- ❌ **Self-serve billing / usage metering**

---

## Local development

**Prereqs:** Node 20+, pnpm 10+, Docker (for Postgres + Redis).

```bash
# 1. Install
pnpm install

# 2. Bring up Postgres + Redis
docker compose up -d

# 3. Run migrations (creates all tables)
pnpm --filter @telecomm/db migrate

# 4. Copy env template
cp .env.example .env    # then fill in ANTHROPIC_API_KEY at minimum

# 5. Start everything
pnpm dev                # api + web + widget in parallel
```

**Ports (defaults):**
- API — `http://localhost:4000`
- Web — `http://localhost:3000`
- Widget bundle served by API at `http://localhost:4000/widget.js`

**Sign up flow** → onboarding wizard → connect Gmail → add a KB source → paste widget snippet → publish → land on Dashboard.

---

## Deployment (Railway)

Four services in one project:

1. **Postgres** — Railway plugin (or Neon)
2. **Redis** — Railway plugin (or Upstash)
3. **API** — deploy from `apps/api`, `Dockerfile` provided
4. **Web** — deploy from `apps/web`, `Dockerfile` provided

### Required env vars

**API service**
- `DATABASE_URL` — Postgres connection string
- `REDIS_URL` — Redis connection string
- `AUTH_SECRET` — random 32+ char string (for JWT signing)
- `TELECOMM_ENCRYPTION_KEY` — `openssl rand -hex 32` (encrypts Gmail refresh tokens)
- `ANTHROPIC_API_KEY` — your Claude API key
- `PUBLIC_API_URL` — public URL of the API service (e.g. `https://api.yourdomain.com`)
- `WEB_URL` — public URL of the web dashboard
- `NODE_ENV=production`
- **For Gmail:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (exact match to what's registered in Google Cloud Console)
- **For outbound email (invites, CSAT):** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

**Web service**
- `NEXT_PUBLIC_API_URL` — same as API's `PUBLIC_API_URL`

### Migrations on deploy

The API self-heals critical schema on every boot (`apps/api/src/lib/startup-migrations.ts`)
using idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS`
statements. For a full schema reset, run `pnpm --filter @telecomm/db migrate` from a
one-off box connected to your production database.

---

## Webhook signature verification

Every outbound webhook carries:

```
X-Telecomm-Event: conversation.resolved
X-Telecomm-Timestamp: 1737480123
X-Telecomm-Signature: t=1737480123,v1=<hex sha256>
```

Verify on your side:

```ts
import { createHmac } from 'node:crypto';

const parts = req.headers['x-telecomm-signature'].split(',');
const t  = parts.find(p => p.startsWith('t=')).slice(2);
const v1 = parts.find(p => p.startsWith('v1=')).slice(3);

const expected = createHmac('sha256', WEBHOOK_SECRET)
  .update(`${t}.${rawRequestBody}`)
  .digest('hex');

if (expected !== v1) throw new Error('bad signature');
// Optionally: reject if timestamp is > 5 min old (replay protection)
```

---

## License

Proprietary — all rights reserved.
