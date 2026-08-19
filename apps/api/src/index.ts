import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
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
import { startWorkers } from './workers/index.js';

const PORT = Number(process.env.PORT ?? 4000);
const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname resolves to apps/api/dist at runtime. The compiled widget lives at
// apps/widget/dist/widget.js, so we go up two levels then across, not three.
const WIDGET_PATH = join(__dirname, '..', '..', 'widget', 'dist', 'widget.js');

async function build() {
  const app = Fastify({ logger: { level: 'info' } });

  // Allow all origins — widget can be embedded on any customer site;
  // auth relies on JWT in headers (not cookies), so wildcard CORS is safe.
  await app.register(cors, {
    origin: true,
    credentials: false,
  });

  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(authMiddleware);

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  // Serve the compiled widget bundle
  app.get('/widget.js', async (_req, reply) => {
    try {
      const content = await readFile(WIDGET_PATH, 'utf8');
      return reply
        .type('application/javascript')
        .header('Cache-Control', 'public, max-age=3600')
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

  return app;
}

const app = await build();

// Start background workers (ingest + embed)
startWorkers();

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`API listening on http://localhost:${PORT}`);
