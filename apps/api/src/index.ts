import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '@telecomm/db';
import IORedis from 'ioredis';
import { redisConnection } from './lib/redis.js';

// Single Redis client for health checks — BullMQ has its own pool; we don't
// want to reuse those or an aborted health probe could interfere with queue
// work. Small, dedicated, connected once.
let _healthRedis: IORedis | null = null;
function healthRedis(): IORedis {
  if (_healthRedis) return _healthRedis;
  _healthRedis = new IORedis({
    ...redisConnection(),
    // Health probes must fail fast, not sit in a retry loop.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    lazyConnect: true,
  });
  _healthRedis.on('error', () => { /* swallow — the probe reports the failure */ });
  return _healthRedis;
}
import { authMiddleware } from './middleware/auth.js';
import { authRoutes } from './routes/auth/index.js';
import { usersRoutes } from './routes/users/index.js';
import { workspacesRoutes } from './routes/workspaces/index.js';
import { onboardingRoutes } from './routes/onboarding/index.js';
import { chatRoutes } from './routes/chat/index.js';
import { inboxRoutes } from './routes/inbox/index.js';
import { knowledgeRoutes } from './routes/knowledge/index.js';
import { cannedRoutes } from './routes/canned/index.js';
import { wsRoutes } from './routes/ws/index.js';
import { analyticsRoutes } from './routes/analytics/index.js';
import { inboundEmailRoutes } from './routes/inbound/email.js';
import { csatRoutes } from './routes/csat/index.js';
import { gmailRoutes } from './routes/gmail/index.js';
import { webhooksRoutes } from './routes/webhooks/index.js';
import { triggersRoutes } from './routes/triggers/index.js';
import { demoRoutes } from './routes/demo/index.js';
import { domainsRoutes } from './routes/domains/index.js';
import { startWorkers } from './workers/index.js';

const PORT = Number(process.env.PORT ?? 4000);
const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname resolves to apps/api/dist at runtime. The compiled widget lives at
// apps/widget/dist/widget.js, so we go up two levels then across, not three.
const WIDGET_PATH = join(__dirname, '..', '..', 'widget', 'dist', 'widget.js');

async function build() {
  const app = Fastify({
    logger: { level: 'info' },
    // Cap the incoming JSON body to 5 MB. Widget messages are tiny; the
    // largest legitimate payload is a base64-encoded knowledge-base doc
    // upload (25 MB file → ~34 MB base64) — those come through the web
    // server-action pipeline, not this API, so 5 MB is comfortable.
    bodyLimit: 5 * 1024 * 1024,
    // Trust the reverse-proxy IP so per-IP rate limits key on the real
    // client, not the Railway proxy. Safe here — only Railway sits in
    // front of us.
    trustProxy: true,
    // Correlate every log line for a single request. Fastify will emit
    // `reqId=<id>` in each log entry and mirror it in the X-Request-Id
    // response header, so a user-reported bug can be traced end-to-end.
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      if (typeof inbound === 'string' && inbound.length > 0 && inbound.length < 128) return inbound;
      return randomUUID();
    },
  });

  // Echo the request id back on the response so client-side error reports
  // can include it.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Allow all origins — widget can be embedded on any customer site;
  // auth relies on JWT in headers (not cookies), so wildcard CORS is safe.
  await app.register(cors, {
    origin: true,
    credentials: false,
    exposedHeaders: ['x-request-id'],
  });

  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(authMiddleware);

  // Deep health check: /health returns fast; /health/deep verifies DB and
  // Redis are actually reachable. Point Railway's health-check at /health
  // (must return in ~1s) and a monitoring probe (Uptime Kuma etc.) at
  // /health/deep. A broken DB will drop /health/deep to 503 so alerts fire
  // instead of routing traffic to a zombie instance.
  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));
  app.get('/health/deep', async (_req, reply) => {
    const results: Record<string, { ok: boolean; error?: string }> = {};
    try {
      await db.execute(sql`SELECT 1`);
      results.postgres = { ok: true };
    } catch (err) {
      results.postgres = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    try {
      const pong = await healthRedis().ping();
      results.redis = { ok: pong === 'PONG' };
    } catch (err) {
      results.redis = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const allOk = Object.values(results).every((r) => r.ok);
    return reply.code(allOk ? 200 : 503).send({ ok: allOk, checks: results, ts: new Date().toISOString() });
  });

  // Serve the compiled widget bundle
  app.get('/widget.js', async (_req, reply) => {
    try {
      const content = await readFile(WIDGET_PATH, 'utf8');
      // Short TTL so a widget code change deployed to the API reaches
      // customer sites in ~5 minutes, not an hour. The bundle itself is
      // tiny (~25kB gzipped), so serving fresh is cheap.
      return reply
        .type('application/javascript')
        .header('Cache-Control', 'public, max-age=300, must-revalidate')
        .send(content);
    } catch {
      return reply.code(404).send('// Widget not built. Run: pnpm --filter @telecomm/widget build');
    }
  });

  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(workspacesRoutes);
  await app.register(onboardingRoutes);
  await app.register(chatRoutes);
  await app.register(inboxRoutes);
  await app.register(knowledgeRoutes);
  await app.register(cannedRoutes);
  await app.register(wsRoutes);
  await app.register(analyticsRoutes);
  await app.register(inboundEmailRoutes);
  await app.register(csatRoutes);
  await app.register(gmailRoutes);
  await app.register(webhooksRoutes);
  await app.register(triggersRoutes);
  await app.register(demoRoutes);
  await app.register(domainsRoutes);

  return app;
}

// Self-heal schema BEFORE building the API so the first request can't hit
// a query for a column the DB doesn't have yet. Idempotent — safe to run on
// every boot.
try {
  const { runStartupMigrations } = await import('./lib/startup-migrations.js');
  await runStartupMigrations();
} catch (err) {
  console.warn('[startup] schema self-heal failed (continuing):', err instanceof Error ? err.message : err);
}

const app = await build();

// Start background workers (ingest + embed)
startWorkers();

// Surface OAuth misconfiguration at boot instead of the first Connect click.
try {
  const { redirectUri } = await import('./lib/gmail-oauth.js');
  const uri = redirectUri();
  if (uri.startsWith('http://localhost') && process.env.NODE_ENV === 'production') {
    console.warn('[gmail] REDIRECT URI resolves to localhost in production — Google will reject.');
    console.warn('[gmail] Set GOOGLE_REDIRECT_URI to the URL registered in Google Cloud Console.');
  } else {
    console.log(`[gmail] OAuth redirect URI: ${uri}`);
  }
} catch (err) {
  console.warn('[gmail] redirect URI resolution failed at boot:', err instanceof Error ? err.message : err);
}

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`API listening on http://localhost:${PORT}`);
