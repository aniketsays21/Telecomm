import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { verifySession, SessionPayload } from '../lib/token.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Populated by the onRequest hook when a valid bearer token is present.
    // Declared as non-optional because every route handler that touches it goes
    // through requireAuth first, which 401s and returns when it is missing.
    session: SessionPayload;
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  // Fastify v5 dropped the plain `null` default because reference values leak
  // between requests. A getter satisfies the typed signature and hands each
  // request a fresh empty session that requireAuth will still reject.
  app.decorateRequest('session', {
    getter(): SessionPayload {
      return undefined as unknown as SessionPayload;
    },
  });

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) return; // Routes that require auth do their own check
    try {
      request.session = await verifySession(token);
    } catch {
      // Token invalid — leave session empty; protected routes will reject
    }
  });
};

export const authMiddleware = fp(authPlugin);

export function requireAuth(request: FastifyRequest, reply: FastifyReply): SessionPayload | false {
  if (!request.session?.userId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return request.session;
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(request, reply)) return false;
  if (request.session.role !== 'admin') {
    reply.code(403).send({ error: 'Admin access required' });
    return false;
  }
  return true;
}
