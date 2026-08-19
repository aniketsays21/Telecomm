import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { verifySession, SessionPayload } from '../lib/token.js';

declare module 'fastify' {
  interface FastifyRequest {
    // null until the onRequest hook below verifies a bearer token and populates
    // it. Every protected route gates on requireAuth() (session?.userId truthy).
    session: SessionPayload | null;
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  // Fastify v5 rejects reference-typed defaults (objects/arrays) to prevent
  // cross-request leaks, but a primitive like `null` is fine — and unlike a
  // getter, this is writable, so the onRequest hook below can actually
  // populate it. A previous getter-only decoration silently discarded every
  // assignment here, which made every authenticated route return 401.
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) return; // Routes that require auth do their own check
    try {
      request.session = await verifySession(token);
    } catch {
      // Token invalid — leave session null; protected routes will reject
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

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): SessionPayload | false {
  const session = requireAuth(request, reply);
  if (!session) return false;
  if (session.role !== 'admin') {
    reply.code(403).send({ error: 'Admin access required' });
    return false;
  }
  return session;
}
