# AI Customer Communication Platform — Build Plan

Companion to `docs/spec.md` (product spec). This document is the engineering plan: what to
build, in what order, with the concrete technical decisions each part needs.

**Contents**

1. [Scope for v1](#1-scope-for-v1)
2. [System architecture](#2-system-architecture)
3. [Data model](#3-data-model)
4. [Data source connectors](#4-data-source-connectors) ← the "how do I connect brand data" answer
5. [AI resolution engine](#5-ai-resolution-engine)
6. [Email channel](#6-email-channel)
7. [Chat widget](#7-chat-widget)
8. [Routing and assignment](#8-routing-and-assignment)
9. [Agent workspace: summaries and suggested replies](#9-agent-workspace-summaries-and-suggested-replies)
10. [Analytics](#10-analytics)
11. [Onboarding flow](#11-onboarding-flow)
12. [Custom domains](#12-custom-domains)
13. [Security and multi-tenancy](#13-security-and-multi-tenancy)
14. [Unit economics](#14-unit-economics)
15. [Build phases](#15-build-phases)
16. [Decisions you need to make now](#16-decisions-you-need-to-make-now)
17. [Risks](#17-risks)

---

## 1. Scope for v1

Five surfaces ship together. Nothing here is optional, because the product doesn't work
without any one of them:

| Surface | What it is | Who uses it |
|---|---|---|
| **Widget** | One `<script>` tag on the brand's site. Chat + article suggest + CSAT. | End customers |
| **Public help center** | Hosted KB, searchable, optionally on `help.brand.com` | End customers |
| **Dashboard** | Unified inbox (chat + email), KB editor, settings, analytics | Brand admins + agents |
| **Ingestion** | Connectors → knowledge base; inbound email → conversations | Runs headless |
| **AI engine** | Retrieval, answering, clarifying questions, escalation, summaries, reply drafts | Runs headless |

Explicitly **out** of v1 (from the spec's non-goals): WhatsApp, live-class copilot,
pre-purchase sales mode, native mobile app, helpdesk migration tooling.

The hard product target that shapes every technical decision: **80% of conversations
resolved without a human.** That number is not won by a better prompt. It's won by
(a) retrieval quality over the brand's real content, and (b) the bot being able to *do
things* — look up an order, check enrollment — not just cite articles. Design for both
from day one; a RAG-only bot lands around 40–50%.

---

## 2. System architecture

### Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Dashboard + KB + marketing | **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui** | One codebase for SSR'd public KB and the app; deploys to Vercel |
| API + workers | **Node/TypeScript service (Fastify or NestJS)** on Fly.io or Railway | Long-lived processes for WebSockets and queues, which serverless is bad at |
| Widget | **Preact + vanilla loader**, bundled standalone | Must stay under ~40 KB gzipped; can't ship React into a stranger's site |
| Database | **Postgres 16 + pgvector** (Neon or Supabase) | Relational data + embeddings in one place. Don't add a separate vector DB at this scale |
| Queue / cache | **Redis + BullMQ** | Ingestion jobs, email processing, summary generation, presence, rate limits |
| Realtime | **Socket.IO** on the API service (or Ably/Pusher to skip infra) | Widget ↔ agent messaging, typing, presence |
| Blob storage | **Cloudflare R2** or S3 | Attachments, KB images. R2 has no egress fees |
| LLM | **Claude** — `claude-sonnet-5` for answers, `claude-haiku-4-5` for classification/tagging/summaries, `claude-opus-5` where quality dominates | See §14 for the cost math |
| Embeddings | **Voyage AI** (`voyage-3`) or OpenAI `text-embedding-3-large` | Anthropic doesn't ship an embedding model; Voyage is their recommended pairing |
| Email | **Postmark** (inbound + outbound) | Best-in-class inbound parsing and threading; SES is cheaper but you build more |
| Auth | **Lucia / Auth.js with credentials** or Clerk | Email+password is the spec'd requirement; roll your own only if you want the control |
| Custom domains | **Cloudflare for SaaS** | Handles hostname verification + cert issuance + renewal. Building this yourself is 2 weeks you don't have |

### Services

```
                    ┌────────────────────────────────────────────┐
  brand's website ──┤ widget.js (iframe)                         │
                    └──────────────┬─────────────────────────────┘
                                   │ WSS + REST
customer's inbox ──► Postmark ─────┤
                     (inbound)     │
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │  API service (Fastify)                           │
        │   • REST  • WebSocket hub  • webhook receivers   │
        └───────┬──────────────────────────┬───────────────┘
                │                          │
                ▼                          ▼
        ┌───────────────┐          ┌──────────────────┐
        │  Postgres     │          │  Redis + BullMQ  │
        │  + pgvector   │          └────────┬─────────┘
        └───────────────┘                   │
                ▲                           ▼
                │                  ┌──────────────────────┐
                │                  │  Worker pool         │
                └──────────────────┤  • ingest/crawl      │
                                   │  • embed             │
                                   │  • ai-answer         │
                                   │  • summarize         │
                                   │  • email send/parse  │
                                   │  • analytics rollup  │
                                   └──────────┬───────────┘
                                              ▼
                                   Claude API · Voyage · connectors
                                   (Shopify, Teachable, …)

        Next.js app  ──►  dashboard (agents/admins)
                     ──►  public KB (help.brand.com via Cloudflare for SaaS)
```

**Why a separate worker pool matters:** an AI answer takes 2–6 seconds, a site crawl takes
minutes, and a transcript ingest takes longer. None of that can live in a request handler.
Every AI call and every connector sync is a queued job with retries and a dead-letter queue.

### The one architectural decision to make before writing code

Emit a **domain event for every state change** (`conversation.created`, `message.sent`,
`conversation.resolved`, `conversation.escalated`, `sla.breached`) onto an internal event
bus, from day one. Analytics, webhooks, the live summary trigger, and SLA timers all become
consumers of that stream rather than code sprinkled through your handlers. Retrofitting this
after Phase 1 is a painful refactor; adding it now costs about a day.

---

## 3. Data model

Core tables (Postgres). Every tenant-scoped table carries `workspace_id`, and every query
goes through it — see §13.

```
workspaces          id, name, slug, plan, business_hours(jsonb), settings(jsonb),
                    onboarding_state, is_live, custom_domain, created_at

users               id, workspace_id, email, password_hash, name, role(admin|agent),
                    availability(jsonb: schedule + timezone), status(online|away|offline),
                    max_concurrent_chats, invited_by, invite_accepted_at

contacts            id, workspace_id, email, name, external_id, attributes(jsonb),
                    first_seen_at, last_seen_at
                    -- one row per end customer, deduped on (workspace_id, email)

conversations       id, workspace_id, contact_id, channel(chat|email),
                    status(open|snoozed|resolved), assignee_id, assigned_at,
                    priority(smallint), sentiment, tags(text[]), subject,
                    email_thread_id, ai_handled(bool), escalated_at, escalation_reason,
                    resolved_at, resolved_by(ai|agent), csat_rating, csat_comment,
                    first_response_at, sla_due_at, snoozed_until, last_message_at

messages            id, conversation_id, workspace_id,
                    author_type(contact|agent|ai|system), author_id, body, body_html,
                    attachments(jsonb), is_internal_note(bool), mentions(uuid[]),
                    email_message_id, email_in_reply_to, delivery_state, read_at,
                    ai_confidence, ai_sources(jsonb), created_at

conversation_summaries  conversation_id, summary(text), what_customer_wants,
                        whats_been_tried, current_status, up_to_message_id, updated_at

kb_articles         id, workspace_id, title, slug, body_md, category_id, status(draft|published),
                    author_id, view_count, updated_at

kb_categories       id, workspace_id, name, slug, position

documents           id, workspace_id, source_id, external_id, title, url, content,
                    content_hash, doc_type(article|product|lecture|faq|page|file),
                    metadata(jsonb: lecture_id, timestamp, sku, …), updated_at

chunks              id, document_id, workspace_id, content, embedding vector(1024),
                    token_count, position, metadata(jsonb)
                    -- index: HNSW on embedding, + workspace_id filter

sources             id, workspace_id, type(website|shopify|teachable|file|manual|api),
                    config(jsonb), credentials_encrypted, status, last_synced_at,
                    sync_frequency, last_error, doc_count

actions             id, workspace_id, name, description, source_id, kind(order_lookup|
                    enrollment_check|custom_http), schema(jsonb), config(jsonb), enabled

escalation_rules    id, workspace_id, name, condition(jsonb), action, priority, enabled

canned_responses    id, workspace_id, title, body, tags(text[]), created_by   -- P1

events              id, workspace_id, type, conversation_id, actor, payload(jsonb),
                    created_at   -- the event stream; also feeds webhooks + analytics

daily_metrics       workspace_id, date, conversations_total, ai_resolved, agent_resolved,
                    abandoned, avg_first_response_s, avg_resolution_s, csat_sum,
                    csat_count, agent_minutes, …  -- rollup, one row per workspace per day
```

Notes that matter:

- **`contacts` is the identity spine.** Chat sessions start anonymous with a cookie-scoped
  visitor id; when the customer gives an email (or the widget is booted with a verified
  user), merge the anonymous contact into the identified one. Get this right early —
  retroactive merges are miserable.
- **`chunks.embedding` needs an HNSW index** with `workspace_id` in the query predicate.
  At 10k chunks/workspace and a few hundred workspaces this is comfortably fast in Postgres.
- **`daily_metrics` is a rollup, not the source of truth.** `events` is. Recompute rollups
  from events whenever a metric definition changes — and it will change.

---

## 4. Data source connectors

This is your explicit question, and it's the part that decides whether the bot is any good.

### The key distinction: indexed content vs. live lookups

Two fundamentally different things get called "connecting your data," and conflating them is
the most common way these products fail:

| | **Indexed content** | **Live lookups (actions)** |
|---|---|---|
| What | Help docs, policies, FAQs, product descriptions, lecture transcripts | "Where is order #1234?", "Does this student have access?" |
| How it works | Crawl → chunk → embed → store in `chunks`, retrieved at query time | Claude calls a tool at answer time, which hits the brand's API live |
| Freshness | Synced hourly/daily | Always current, by definition |
| Contains PII | Must not | Yes, scoped to the verified customer |

**Never embed customer records.** Order data goes stale in minutes, it's PII, and vector
search over it leaks one customer's data into another's answer. Orders are always a live
tool call, gated on identity verification.

### Tier 1 — works for every brand, zero integration work (build first)

These carry the product. A D2C brand or course creator can be live in 10 minutes with only these.

**1. Website / help-center crawler.** Admin pastes a URL. You fetch `/sitemap.xml`, fall
back to a BFS crawl bounded by same-origin + depth 3 + a page cap. Render JS with Playwright
(already needed for SPA help centers), extract main content with Readability, convert to
Markdown, strip nav/footer/cookie banners. Store hash per page; re-crawl on schedule and
skip unchanged pages. This is 3–4 days of work and it's the single highest-leverage connector.

**2. File upload.** PDF, DOCX, TXT, MD, CSV. Parse (`pdf-parse`, `mammoth`), chunk, embed.
Half your early customers have their refund policy in a Google Doc, not a help center.

**3. Paste / manual articles.** The KB editor itself is a source. Articles written in the
dashboard are indexed identically to crawled content.

**4. Sitemap of product pages.** For D2C, crawling `/products/*` gives you materials, sizing,
care instructions, and shipping copy — a surprisingly large share of pre-purchase and
post-purchase questions.

### Tier 2 — commerce (D2C segment)

**Shopify** — build a public Shopify app, OAuth install from your dashboard.
- Scopes: `read_products`, `read_orders`, `read_customers`, `read_fulfillments`.
  Note `read_orders` only reaches the last 60 days; `read_all_orders` requires Shopify
  approval — request it, and handle the interim gracefully.
- **Indexed:** products, variants, descriptions, collections, policy pages
  (`/policies/refund-policy` etc.).
- **Live actions:** `get_order_status(email, order_number)`, `get_tracking(order_id)`,
  `get_customer_orders(email)`.
- Subscribe to `orders/updated`, `fulfillments/create`, `products/update` webhooks so
  indexed product content and order state stay fresh.

**WooCommerce** — REST API with a consumer key/secret the admin generates and pastes. Same
action surface as Shopify.

**Generic order-lookup connector (the escape hatch, and it's important).** Most Indian D2C
brands are not on Shopify, or run a custom stack. Give the admin a form:

```
Endpoint       GET https://api.brand.com/orders?email={{email}}&order_id={{order_id}}
Auth           Header: X-API-Key = ••••••••
Field mapping  status        →  $.data.order_status
               tracking_url  →  $.data.shipment.url
               eta           →  $.data.expected_delivery
               items         →  $.data.line_items[*].name
```

You store this as an `actions` row, expose it to Claude as a tool with a generated JSON
schema, and map the response through the JSONPath config. One connector, unlimited backends.
Build this — it converts every "we're not on Shopify" objection into a 5-minute setup.

### Tier 3 — course platforms (primary segment)

Verify each platform's current API before committing; this space changes and several gate
API access behind higher plans.

- **Thinkific** — REST API with API key; courses, chapters, enrollments, users. Good.
- **Teachable** — API available on higher plans; courses, lectures, enrollments.
- **Kajabi** — thin public API historically; plan for webhooks + CSV + manual content as
  the primary path, and treat a deep API integration as a later bet.
- **Self-hosted / everything else** — CSV upload of enrollments + the generic action
  connector above.

**Indexed:** course structure, lecture titles, descriptions, attached resources, and
**transcripts** (below).
**Live actions:** `check_enrollment(email, course)`, `get_progress(email, course)`,
`get_access_status(email)` — the "I paid but can't access the course" question is a large
fraction of course-creator support volume and is fully automatable.

**Transcripts.** Pull existing captions where the platform provides them; otherwise transcribe
with Deepgram or AssemblyAI (fast and cheap — don't self-host Whisper for v1; it turns a
30-minute onboarding into an hours-long one and you'll own GPU capacity you don't want).
Store each transcript segment as a `document` with `metadata = {lecture_id, start_s, end_s}`
so answers can cite "Lecture 4, 12:30" and doubt clustering can group by timestamp — that's
the course-improvement signal the spec asks for, and it falls out of the metadata for free.

### Tier 4 — email as a source

Resolved email threads are training data for the KB. After ~200 resolved conversations,
cluster them and propose new articles ("31 people asked about international shipping; here's
a draft article from how your agents answered"). This is the KB-gap-detection P1 item, and it
becomes a genuine retention hook — the KB gets better the longer they use you.

### The connector interface

Every connector implements one contract, so adding the tenth costs a day, not a week:

```ts
interface Connector {
  type: string;
  authenticate(config: unknown): Promise<Credentials>;
  // Content that gets embedded
  fetchDocuments(source: Source, since?: Date): AsyncIterable<Document>;
  // Live capabilities exposed to the LLM as tools
  getActions(source: Source): ActionDefinition[];
  executeAction(source: Source, action: string, params: unknown): Promise<ActionResult>;
  // Optional: real-time freshness
  handleWebhook?(source: Source, payload: unknown): Promise<void>;
}
```

Sync strategy: full sync on connect → incremental (`since` + content-hash diff) on schedule →
webhook-driven invalidation where the platform supports it. Every sync writes a job record so
the dashboard can show "Last synced 8 minutes ago · 412 documents · 2 errors."

---

## 5. AI resolution engine

### Pipeline per inbound message

```
message in
   │
   ├─ 1. Guard checks         escalation rules (keywords: refund, chargeback, legal,
   │                          order value > X), sentiment, repeat-escalation
   │                          → any hit: hand to human immediately, skip the rest
   │
   ├─ 2. Classify             Haiku 4.5: intent, tag, sentiment, urgency,
   │                          needs-clarification?  (~200ms, ~$0.0005)
   │
   ├─ 3. Retrieve             embed query → pgvector top-20 (workspace-scoped)
   │                          → rerank → top-5 chunks
   │                          + last N conversation turns + contact context
   │
   ├─ 4. Answer               Sonnet 5 with tools = [connector actions],
   │                          system prompt = brand voice + policy + citation rules
   │                          → tool calls loop → final answer + cited sources
   │
   ├─ 5. Confidence gate      no supporting chunk above similarity threshold,
   │                          or model signals uncertainty, or 2 failed clarifications
   │                          → escalate
   │
   └─ 6. Emit                 answer + sources + confidence; log everything for eval
```

### The parts people get wrong

**Clarifying questions.** Requirement: the bot asks rather than guessing. Implement it as a
structured decision in step 2 — "is this answerable from context, or is a required parameter
missing?" — and cap it at **two** clarifying turns before escalating. Unbounded clarification
loops are the single most infuriating chatbot behavior and will tank your CSAT.

**Confidence.** Don't ask the model "how confident are you, 0–1" — self-reported confidence
is poorly calibrated. Use signals you control: top-chunk similarity score, number of
supporting chunks above threshold, whether every tool call succeeded, whether the answer
contains a citation at all. Combine into a score, threshold it, and **tune the threshold per
workspace from real escalation outcomes.** Start at a deliberately conservative setting
(escalate readily); a bot that escalates too much is recoverable, a bot that confidently
lies about refund policy loses the customer.

**Grounding.** System prompt rule: answer only from provided sources; if the sources don't
cover it, say so and offer a human. Attach `ai_sources` to every message so agents (and you,
during debugging) can see exactly what the bot read.

**Prompt injection.** Retrieved chunks and email bodies are untrusted input. Wrap them in
clear delimiters, instruct the model to treat them as data, and never let retrieved content
authorize a tool call it wouldn't otherwise make. Action tools that touch customer data must
verify identity independently (the email on the conversation, not an email mentioned in the
message body).

**Evals — build this in Phase 1, not later.** A CSV of ~100 real questions per pilot brand
with expected answers, run against the pipeline on every prompt or retrieval change, scored
by an LLM judge plus manual spot checks. Without it you cannot tell whether a prompt tweak
moved 80% resolution to 84% or to 71%. This is the difference between a product you can
improve and one you can only fiddle with.

### Answer modes

The bot has four possible moves, and picking correctly is most of the quality:

1. **Direct answer from KB** — with a "was this helpful?" and the source article linked.
2. **Action result** — "Your order shipped Tuesday, arriving Thursday, tracking here."
3. **Clarify** — one targeted question, with quick-reply buttons where the options are known.
4. **Escalate** — "Let me get a human on this," create the assignment, show queue position.

---

## 6. Email channel

### Inbound

Route the brand's support address to you. Two options, offer both:

- **Forwarding (default, zero DNS work):** brand sets `support@brand.com` to forward to
  `brand-a7f3@inbound.yourapp.com`. Works everywhere, ships today.
- **Subdomain MX (better threading, more setup):** brand points `MX` for
  `support.brand.com` at Postmark.

Postmark POSTs parsed JSON to your webhook. Your processing:

1. Verify the webhook signature; dedupe on `Message-ID`.
2. **Strip quoted history and signatures** — non-negotiable, or every reply re-feeds the whole
   thread to the LLM. Use `talon` / `email-reply-parser`; test against Gmail, Outlook, and
   Apple Mail quoting styles, which all differ.
3. Thread: look up `In-Reply-To` / `References` against `messages.email_message_id`. Match →
   append to the existing conversation. No match → new conversation, dedupe the contact on
   sender address.
4. Handle attachments (to R2), auto-replies and bounces (`Auto-Submitted`, `Precedence: bulk`
   headers → don't reply, don't create tickets), and spam.
5. Then the same AI pipeline as chat.

### Outbound

Agent replies in the dashboard → send via Postmark with:
- `From:` the brand's address (requires DKIM/SPF setup on their domain — walk them through it
  in onboarding; without it, deliverability suffers and it looks like spoofing)
- `In-Reply-To:` and `References:` set from the thread so it lands in the same conversation in
  the customer's inbox
- `Reply-To:` the inbound address so responses come back to you
- Store the outbound `Message-ID` for future threading

### AI on email

Different from chat: you have hours, not seconds, and mistakes are permanent — you can't
retract a sent email. Recommendation: for the first 2 weeks of a brand's life, AI email
replies are **drafted, not sent** — queued for one-click agent approval. Once a brand's
approval rate is consistently high, let them flip on auto-send per tag (e.g. auto-send order
status, always draft refunds). This is also the honest version of "80% resolution" for email.

---

## 7. Chat widget

**Loader** (`widget.js`, target < 5 KB): reads `data-workspace-id` from the script tag,
injects a launcher button and an **iframe** for the panel. The iframe is essential — full CSS
and JS isolation from whatever chaos lives on the brand's site.

```html
<script src="https://cdn.yourapp.com/widget.js" data-workspace-id="ws_abc123" async></script>
```

**Panel app** (Preact, loaded lazily on first open, < 40 KB gzipped): messages, typing
indicators, quick replies, file upload, article suggestions, CSAT, queue position.

**Identity.** Anonymous visitors get a signed cookie-scoped visitor id. Brands with logged-in
users can boot the widget with a verified identity:

```js
window.YourApp = { user: { email, name, external_id }, hash: "<hmac-sha256 with secret>" };
```

Verify the HMAC server-side before trusting the identity — otherwise anyone can look up
anyone's orders by typing an email into your widget. This is a real vulnerability class in
shipped support widgets; don't skip it.

**Article suggest-as-you-type.** Debounce 300 ms, embed the partial query, vector search over
published KB articles only, show up to 3 inline before the message is sent. Cache aggressively.

**Other requirements:** offline queue with retry on reconnect; unread badge; persistence
across sessions keyed on visitor id or verified email; mobile-responsive; configurable
position/colors/launcher text; and a `postMessage` API for the brand to open/close/prefill
the widget programmatically.

---

## 8. Routing and assignment

When a conversation needs a human:

```
1. Business hours?  No  → AI states the next available window, ticket queued as Open,
                          SLA clock starts at the next business-hours boundary
2. Eligible agents  = online AND within their availability schedule
                      AND current_open_chats < max_concurrent_chats
3. Ranking          = (skill/tag match) → (fewest active) → (longest idle)
4. No one eligible? → unassigned queue, notify admins, customer sees an honest wait estimate
5. Assign, emit conversation.assigned, notify the agent (in-app + email + optional push)
6. No acceptance in 60s → reassign to the next agent
```

**Priority score** rather than pure FIFO, recomputed on each message: sentiment (angry ↑),
explicit urgency keywords, SLA proximity, VIP/order-value if the connector provides it,
wait time. Sort the queue on it.

**Snooze** sets `snoozed_until`; a scheduled job re-opens and re-queues at that time.

**SLA:** default targets — 1 minute first response for chat, 4 hours for email (matching the
spec's goals). Timers live as scheduled jobs; on breach, emit `sla.breached` → dashboard
banner + email to admins.

**Collision warning:** presence per conversation over WebSocket — "Priya is viewing this
conversation" / "Priya is typing a reply."

---

## 9. Agent workspace: summaries and suggested replies

### Live conversation summary

Trigger: on conversation open when message count > 6, and incrementally every 5 messages after.
Generate with Haiku 4.5 (fast, cheap, entirely sufficient) into a structured shape:

```json
{
  "what_customer_wants": "Refund for a damaged kurta from order #4821",
  "whats_been_tried": "Bot verified the order and requested a photo; customer uploaded one; bot escalated per the refund policy rule",
  "current_status": "Awaiting agent decision on refund vs. replacement",
  "key_details": ["Order #4821, ₹2,340", "Delivered 14 Aug", "Photo attached", "Customer has ordered 6 times before"]
}
```

Cache against `up_to_message_id`; regenerate only on new messages. Summarize incrementally
(previous summary + new messages) rather than re-reading the whole thread — cheaper and it
keeps earlier context that would otherwise fall out.

### Suggested replies

Same retrieval as the bot, different output: 2–3 draft replies in the brand's voice, each
citing its sources, one click to insert into the composer and edit before sending. Log
`suggestion_shown` / `suggestion_used` / `suggestion_edited` — that ratio tells you whether
the feature is working, and edited drafts are the best training signal you'll get for
improving the answer prompt.

### Rest of the workspace

Three panes: queue (filterable by channel/assignee/status/tag) · conversation (with the
summary pinned at top and channel-appropriate composer) · context sidebar (contact details,
past orders via live action, past conversations, pages visited, last seen, current tags).
Plus internal notes with @mention, keyboard shortcuts, and canned responses (P1).

---

## 10. Analytics

Everything derives from the `events` table, rolled up nightly into `daily_metrics` and
recomputable from scratch. The overview page:

**Volume** — total conversations by channel/day, busiest hours heatmap, open vs. resolved.
**AI performance** — AI-resolved % (the headline), escalation rate with reasons, average turns
to resolution, confidence distribution.
**Quality** — CSAT average and distribution, response times (first + full resolution),
completion vs. drop-off.
**Topics** — top tags by volume and by escalation rate. Escalation rate per tag is the most
actionable number on the page: it's exactly where the KB is thin.
**Team** — per-agent volume, response time, CSAT, active hours.
**ROI** — `agent_hours_saved = ai_resolved_conversations × avg_agent_minutes_per_conversation`,
shown in hours and in money at a configurable hourly rate. Compute `avg_agent_minutes` from
that workspace's own agent-handled conversations, not an industry number — it's defensible
when a customer asks where the figure came from.
**Course creators** — doubt clusters by lecture and timestamp: "23 students asked about
'depreciation calculation' near 12:30 in Lecture 4." Cluster embeddings of escalated and
low-confidence questions carrying lecture metadata.

Define "AI-resolved" precisely and put the definition in a tooltip: *conversation closed
without any agent message, and either CSAT ≥ 3 or no negative signal within 24 hours.* Every
customer will interrogate this number; pick a definition you can defend.

---

## 11. Onboarding flow

Target: signup → live in under 30 minutes. Each step is resumable and its state lives in
`workspaces.onboarding_state`.

| # | Step | What happens server-side | Skippable |
|---|---|---|---|
| 1 | **Sign up** | Create workspace + admin user, verify email | no |
| 2 | **Connect email** | Show the forwarding address; verify by round-tripping a test email; optionally guide DKIM/SPF for outbound | yes (chat-only brands) |
| 3 | **Connect data sources** | Website URL → crawl preview showing pages found; OAuth for Shopify/Thinkific; file upload. Show a live count of documents found | **no** — the bot is useless without this |
| 4 | **Add agents** | Invite by email with role + availability schedule + timezone | yes (solo founders) |
| 5 | **Install widget** | Copy snippet, plus a "verify installation" button that polls for the first widget ping. Email-the-snippet-to-my-developer option | yes |
| 6 | **Building knowledge base** | Progress UI over the real ingestion jobs: "Crawling (47/120 pages)… Processing… Indexing…". Takes 2–15 minutes | no |
| 7 | **Sandbox test** | Chat with your own bot on your real KB. **Gate: cannot go live until at least one sandbox conversation is sent.** Show the bot's sources and confidence for each answer so they trust it | no |
| 8 | **Go live** | Flip `is_live`, widget starts serving | no |

Step 6 is the moment the product either impresses or doesn't. Make it feel like work is
happening — stream real progress from the job queue, name the pages as they're crawled — and
end with a concrete number: "Knowledge base ready: 143 documents, 1,847 chunks indexed."

Step 7 is where you catch bad answers before customers do, which is why the spec gates go-live
on it. Keep the gate.

---

## 12. Custom domains

Use **Cloudflare for SaaS**. Flow:

1. Admin enters `help.brand.com`.
2. You show two DNS records: `CNAME help → kb.yourapp.com`, and `TXT _yourapp-verify.help →
   <token>`.
3. Poll DNS (every 30s, 10 min timeout) for both records.
4. On verification, call Cloudflare's Custom Hostnames API → cert issued automatically,
   typically within a couple of minutes.
5. Requests arrive with the `Host` header → look up `workspaces.custom_domain` → render that
   workspace's KB.

The TXT record is what stops someone provisioning a cert for a domain they don't control.
Building this on Let's Encrypt + your own load balancer is genuinely 1–2 weeks including
renewal handling and edge cases; Cloudflare for SaaS is a day. Take the day.

---

## 13. Security and multi-tenancy

- **Tenant isolation.** `workspace_id` on every tenant table. Enforce it in one place: a
  repository/query layer that requires a workspace context, plus Postgres RLS as a second
  net. A single missing `WHERE workspace_id` in a support product means one brand reading
  another's customer conversations — assume it will happen unless the architecture prevents it.
- **Credentials.** Connector tokens encrypted at rest (envelope encryption, KMS or libsodium
  with a rotated key). Never log them, never return them to the client, show only last-4.
- **PII.** Redact card numbers and similar patterns before they reach the LLM or your logs.
  Support a per-workspace retention policy (auto-purge conversations older than N days).
- **Widget.** Origin allowlist per workspace, rate limits per visitor and per IP, HMAC
  identity verification (§7), file-type and size limits with virus scanning on uploads.
- **Prompt injection.** Retrieved content and inbound email are untrusted (§5).
- **Roles.** Admin vs. Agent enforced server-side on every endpoint, not just hidden in the UI.
- **Audit log.** Who changed settings, who read what conversation, who exported data.
- **Compliance posture.** DPA, data-deletion endpoint, sub-processor list. Any customer with a
  legal team asks for these; having them ready wins deals you'd otherwise stall on.

---

## 14. Unit economics

Per AI-handled chat conversation (~6 exchanges, ~5K input tokens per turn with retrieved
context, ~300 output):

| Component | Model | Cost |
|---|---|---|
| Classification + tagging (6×) | `claude-haiku-4-5` ($1/$5 per MTok) | ~$0.004 |
| Answers (6×) | `claude-sonnet-5` ($3/$15 per MTok; $2/$10 intro through 2026-08-31) | ~$0.11 |
| With prompt caching on the system prompt + KB context | | **~$0.04–0.06** |
| Summary + suggestions (agent-escalated only) | `claude-haiku-4-5` | ~$0.002 |
| Embeddings (ingest, amortized) | Voyage | negligible |

**Roughly $0.05 per AI-resolved conversation** with caching in place, which is what makes the
economics work at any sane price point — a brand doing 3,000 conversations/month costs you
about $150 in inference. Use `claude-opus-5` selectively (complex escalation decisions, KB
gap analysis), not on the main answer path.

Prompt caching is the biggest lever: the system prompt, brand voice, and tool definitions are
identical across every request in a workspace. Structure requests so the stable prefix comes
first and mark the cache breakpoint after it. Verify it's actually working by checking
`usage.cache_read_input_tokens` — a silent cache miss (a timestamp in the system prompt will
do it) quietly triples your bill.

Also: cap conversation length, dedupe identical questions with a semantic cache (same question
within 24h in the same workspace → serve the cached answer), and rate-limit per visitor.

---

## 15. Build phases

Assumes 2–3 engineers. Solo, roughly double it.

### Phase 0 — Foundations (week 1)
Monorepo (Turborepo: `apps/web`, `apps/api`, `apps/widget`, `packages/db|shared|ai`), Postgres
+ Drizzle/Prisma schema, Redis + BullMQ, auth with workspace + roles, the event bus, CI, staging.
*Done when:* a user can sign up, create a workspace, invite an agent, and the agent logs in with
restricted access.

### Phase 1 — Knowledge + AI core (weeks 2–4)
Website crawler, file upload, chunking + embedding pipeline, pgvector retrieval, the answer
pipeline with tool calling, confidence + escalation rules, KB editor and public KB page, and
the eval harness.
*Done when:* you can point it at a real brand's help center and get correct, cited answers to
real questions in a test script. **This is the riskiest phase — if answer quality isn't there,
nothing downstream matters. Do not move on until it is.**

### Phase 2 — Chat channel (weeks 4–6)
Widget (loader + panel), WebSocket infrastructure, conversation and message flow, agent inbox,
handoff, typing/presence/read receipts, attachments, CSAT, article suggest-as-you-type.
*Done when:* a real conversation runs end-to-end on a test site — bot answers, escalates,
agent replies, customer rates.

### Phase 3 — Email channel (weeks 6–7)
Postmark inbound + outbound, parsing and quote stripping, threading, email conversations in the
same inbox, draft-then-approve AI replies.
*Done when:* a 3-message back-and-forth threads correctly in both Gmail and the dashboard.

### Phase 4 — Agent workspace + routing (weeks 7–9)
Assignment engine with availability and business hours, priority scoring, snooze/resolve, live
summaries, suggested replies, context sidebar, internal notes + @mentions, collision warning,
SLA timers.
*Done when:* an agent can work a full shift in the tool without touching anything else.

### Phase 5 — Connectors + onboarding (weeks 9–11)
Shopify app, generic order-lookup connector, one course platform, transcript ingestion, the full
onboarding wizard, sandbox mode, custom domains.
*Done when:* a brand with no help from you goes signup → live in under 30 minutes.

### Phase 6 — Analytics + polish (weeks 11–13)
Event rollups, overview dashboard, ROI stat, topic clustering, course doubt clustering, SLA
alerts, performance pass, load test.
*Done when:* the dashboard answers "is this thing working?" without you explaining it.

### Phase 7 — Pilot (weeks 13–15)
Run it on Rubans and BetterAlt, plus one course-creator design partner. Instrument everything,
fix what breaks, tune the confidence threshold against real escalations.
*Done when:* AI resolution is at or above 80% on real traffic for at least one brand.

**~13 weeks to pilot, ~15 to a defensible number.** Phases 1 and 2 can partially overlap if
two engineers split AI and widget work; Phase 3 can slip after pilot if chat is landing well.

---

## 16. Decisions you need to make now

The spec leaves these open. My recommendations, so you can start:

| Question | Recommendation |
|---|---|
| **Course platform integration list** | Thinkific + Teachable first (real APIs), Kajabi via webhooks/CSV, plus the generic connector for everyone else. Don't build four deep integrations before you know which platform your design partners are actually on — ask them this week. |
| **Transcription: build or buy** | Buy (Deepgram or AssemblyAI). Self-hosted Whisper turns a 30-minute onboarding into hours and hands you GPU ops. Revisit only if transcription becomes a top-3 cost line. |
| **Confidence threshold: fixed or tunable** | Ship a conservative default, expose it as a three-position control (Cautious / Balanced / Confident) rather than a raw number, and tune per workspace from real escalation data. A number field invites customers to break their own bot. |
| **Default SLA + alert delivery** | 1 min chat / 4 h email first response (matches your stated goals), configurable per workspace. Alerts: dashboard banner + email to admins. Skip push in v1. |
| **Pricing** | Usage-based on resolved conversations, with a floor. It aligns with the ROI story the dashboard tells and with your own cost curve (~$0.05/conversation). Seat-based penalizes exactly the outcome you're selling — fewer agents. Something like ₹4,999/mo including 1,000 resolved conversations, then per-conversation overage. |
| **Roles: two enough for v1?** | Yes. Add read-only (P1) when a customer asks. Revisit after 10 customers. |
| **Custom domain SSL** | Cloudflare for SaaS. Not close. |
| **Webhooks/API: v1 or later?** | **Design the event system into the core now** (§2), ship the public API surface in Phase 2 of the roadmap. The events are nearly free if you build them from the start and expensive to retrofit; the REST surface can wait. |

---

## 17. Risks

**Answer quality below 80%.** The core risk. Mitigation: evals from Phase 1, per-brand
threshold tuning, and the honest framing that 80% is a *steady-state* target reached after a
few weeks of KB gap-filling — not a day-one number. Set that expectation with pilot customers
explicitly, or you'll be defending a number instead of improving it.

**Bad crawls.** SPA help centers, login-walled docs, PDF-only policies. Mitigation: Playwright
rendering, file upload as the universal fallback, and a crawl-preview step in onboarding so
failures surface before go-live rather than after.

**Email deliverability.** Replies landing in spam destroys trust instantly. Mitigation: force
DKIM/SPF setup during onboarding, monitor bounce/complaint rates per workspace, warm sending
domains.

**Realtime at scale.** WebSocket fan-out across multiple API instances needs a Redis adapter
from the start — sticky sessions alone will bite you the first time you scale to two instances.

**LLM cost blowout.** A single misconfigured brand looping the bot can burn a lot of money.
Mitigation: per-workspace daily spend caps with alerting, conversation length limits, semantic
caching, and prompt-cache verification in monitoring.

**Scope creep from the P1/P2 lists.** WhatsApp will get asked for in the first sales call.
Hold the line until 80% resolution is real on chat + email for at least one brand; a second
channel on an unproven core doubles the surface area and proves nothing.
