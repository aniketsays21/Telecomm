import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { verifySession, SessionPayload } from '../lib/token.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionPayload;
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
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

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(request, reply)) return false;
  if (request.session.role !== 'admin') {
    reply.code(403).send({ error: 'Admin access required' });
    return false;
  }
  return true;
}
