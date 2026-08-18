import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { authRoutes } from './routes/auth/index.js';
import { usersRoutes } from './routes/users/index.js';
import { workspacesRoutes } from './routes/workspaces/index.js';

const PORT = Number(process.env.PORT ?? 4000);

async function build() {
  const app = Fastify({ logger: { level: 'info' } });

  await app.register(cors, {
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(authMiddleware);

  // Health check
  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  // Route groups
  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(workspacesRoutes);

  return app;
}

const app = await build();
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`API listening on http://localhost:${PORT}`);
