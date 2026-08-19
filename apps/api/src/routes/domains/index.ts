import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { db } from '@telecomm/db';
import { customDomains } from '@telecomm/db/schema';
import { requireAdmin } from '../../middleware/auth.js';
import { verifyDomain, provisionSsl, cnameTarget } from '../../lib/domain-verify.js';

// Reject anything that isn't a valid hostname up front so we don't waste a
// DNS lookup on `example .com` or `hello world`.
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/i;

export const domainsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/domains', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const rows = await db
      .select()
      .from(customDomains)
      .where(eq(customDomains.workspaceId, session.workspaceId));
    return { domains: rows, cnameTarget: cnameTarget() };
  });

  app.post('/domains', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const body = z.object({
      hostname: z.string().trim().toLowerCase().max(253),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const hostname = body.data.hostname.replace(/\.$/, '');
    if (!HOSTNAME_RE.test(hostname)) {
      return reply.code(400).send({ error: 'That doesn\'t look like a valid hostname (e.g. help.brand.com).' });
    }
    // Bare-domain check — CNAMEs at the apex don't work on most DNS
    // providers, so we reject apex domains up front and steer to a subdomain.
    if (hostname.split('.').length < 3) {
      return reply.code(400).send({
        error: 'Use a subdomain like help.brand.com. Apex domains (brand.com) can\'t be CNAME\'d on most DNS providers.',
      });
    }

    const verificationToken = randomBytes(16).toString('hex');
    try {
      const [row] = await db.insert(customDomains).values({
        workspaceId: session.workspaceId,
        hostname,
        verificationToken,
        expectedCnameTarget: cnameTarget(),
        createdBy: session.userId,
      }).returning();
      return reply.code(201).send({ domain: row, cnameTarget: cnameTarget() });
    } catch (err: any) {
      // Unique index on hostname — someone else's workspace already claimed it.
      if (err?.code === '23505') {
        return reply.code(409).send({ error: 'That hostname is already connected to another workspace.' });
      }
      throw err;
    }
  });

  app.post('/domains/:id/verify', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const [dom] = await db
      .select()
      .from(customDomains)
      .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, session.workspaceId)))
      .limit(1);
    if (!dom) return reply.code(404).send({ error: 'Not found' });

    const check = await verifyDomain(dom.hostname, dom.verificationToken);
    if (!check.ok) {
      return reply.code(400).send(check);
    }

    // DNS is clean — persist the verification timestamp and kick off SSL.
    const ssl = await provisionSsl(dom.hostname);
    await db.update(customDomains).set({
      verifiedAt: new Date(),
      sslStatus: ssl.ok ? 'active' : 'error',
      sslError: ssl.ok ? null : ssl.message,
      sslIssuedAt: ssl.ok ? new Date() : null,
      sslProvider: ssl.provider,
      updatedAt: new Date(),
    }).where(eq(customDomains.id, dom.id));

    return { ok: true, verification: check, ssl };
  });

  app.delete('/domains/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    await db.delete(customDomains)
      .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, session.workspaceId)));
    return reply.code(204).send();
  });
};
