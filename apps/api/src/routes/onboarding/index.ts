import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@telecomm/db';
import { workspaces, sources } from '@telecomm/db/schema';
import { requireAuth } from '../../middleware/auth.js';
import { Queue } from 'bullmq';
import { QUEUES } from '@telecomm/shared';

const ingestQueue = new Queue(QUEUES.INGEST, {
  connection: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
});

/**
 * The single, platform-wide inbound address that every workspace forwards to.
 *
 * There is deliberately no per-workspace inbound address: one Postmark server
 * receives all mail and the owning workspace is resolved from the recipient of
 * the forwarded email (its `supportEmail`). Set POSTMARK_INBOUND_ADDRESS to the
 * inbound address of the shared Postmark server.
 */
function inboundAddress(): string {
  return process.env.POSTMARK_INBOUND_ADDRESS?.trim() ?? '';
}

function forwardingInstructions(supportEmail: string): string {
  const inbound = inboundAddress();
  if (!inbound) {
    return (
      `Forward ${supportEmail} to the platform inbound address. ` +
      'That address is not configured yet — set POSTMARK_INBOUND_ADDRESS on the API.'
    );
  }
  return (
    `Forward ${supportEmail} to ${inbound}. Replies are routed back to this workspace ` +
    `because ${supportEmail} is registered as its support address.`
  );
}

// Widget snippet for a workspace
function widgetSnippet(workspaceId: string, apiUrl: string) {
  return `<script>
  window.TelecommConfig = { workspaceId: '${workspaceId}' };
</script>
<script src="${apiUrl}/widget.js" async></script>`.trim();
}

export async function onboardingRoutes(app: FastifyInstance) {
  // GET /onboarding — current state + what's next
  app.get('/onboarding', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).limit(1);
    if (!ws) return reply.code(404).send({ error: 'Workspace not found' });

    const wsSources = await db.select({ id: sources.id, type: sources.type, name: sources.name, status: sources.status })
      .from(sources).where(eq(sources.workspaceId, session.workspaceId));

    return {
      onboardingState: ws.onboardingState ?? {},
      isLive: ws.isLive,
      slug: ws.slug,
      inboundEmail: inboundAddress(),
      inboundConfigured: !!inboundAddress(),
      supportEmail: (ws.settings as any)?.supportEmail ?? null,
      smtpFromAddress: (ws.settings as any)?.smtpFromAddress ?? null,
      widgetSnippet: widgetSnippet(ws.id, process.env.API_URL ?? 'http://localhost:4000'),
      sources: wsSources,
    };
  });

  // POST /onboarding/email — record the brand's support email + mark step done
  app.post('/onboarding/email', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const body = z.object({ supportEmail: z.string().email() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).limit(1);
    if (!ws) return reply.code(404).send({ error: 'Workspace not found' });

    // Normalise: this address is the inbound routing key and is matched
    // case-insensitively, so store it in a single canonical form.
    const supportEmail = body.data.supportEmail.trim().toLowerCase();
    const existing = (ws.settings as any) ?? {};

    try {
      await db.update(workspaces).set({
        settings: {
          ...existing,
          supportEmail,
          // Default the outbound sender to the same address so a brand that
          // only completes onboarding already sends under its own identity.
          smtpFromAddress: existing.smtpFromAddress ?? supportEmail,
        } as any,
        onboardingState: { ...((ws.onboardingState as object) ?? {}), emailConnected: true } as any,
        updatedAt: new Date(),
      }).where(eq(workspaces.id, session.workspaceId));
    } catch (err: any) {
      // workspaces_support_email_key — another workspace already routes this address.
      if (err?.code === '23505') {
        return reply.code(409).send({
          error: 'That support address is already connected to another workspace.',
        });
      }
      throw err;
    }

    return {
      inboundEmail: inboundAddress(),
      inboundConfigured: !!inboundAddress(),
      supportEmail,
      forwardingInstructions: forwardingInstructions(supportEmail),
    };
  });

  // POST /onboarding/sources — add a URL or file source
  app.post('/onboarding/sources', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const body = z.object({
      type: z.enum(['website', 'file', 'manual']),
      name: z.string().min(1),
      startUrl: z.string().url().optional(),
      url: z.string().url().optional(), // legacy alias for startUrl
      content: z.string().optional(),
      fileName: z.string().optional(),
      fileMime: z.string().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const { type, name, startUrl, url, content, fileName, fileMime } = body.data;

    const config: Record<string, unknown> = {};
    if (startUrl ?? url) config.startUrl = startUrl ?? url;
    if (content) config.content = content;
    if (fileName) config.fileName = fileName;
    if (fileMime) config.fileMime = fileMime;

    const [source] = await db.insert(sources).values({
      workspaceId: session.workspaceId,
      type,
      name,
      config,
      status: 'pending',
    }).returning();

    // Mark sources step done on workspace
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).limit(1);
    await db.update(workspaces).set({
      onboardingState: { ...((ws.onboardingState as object) ?? {}), sourcesConnected: true } as any,
      updatedAt: new Date(),
    }).where(eq(workspaces.id, session.workspaceId));

    // Kick off ingestion immediately
    await ingestQueue.add('ingest-source', { sourceId: source.id }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return { source };
  });

  // DELETE /onboarding/sources/:id — remove a source before going live
  app.delete('/onboarding/sources/:id', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    await db.delete(sources).where(eq(sources.id, id));
    return reply.code(204).send();
  });

  // POST /onboarding/widget-seen — mark widget step done (they've seen/copied the snippet)
  app.post('/onboarding/widget-seen', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).limit(1);
    await db.update(workspaces).set({
      onboardingState: { ...((ws.onboardingState as object) ?? {}), widgetInstalled: true } as any,
      updatedAt: new Date(),
    }).where(eq(workspaces.id, session.workspaceId));

    return { ok: true };
  });

  // POST /onboarding/complete — go live
  app.post('/onboarding/complete', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;

    await db.update(workspaces).set({
      isLive: true,
      updatedAt: new Date(),
    }).where(eq(workspaces.id, session.workspaceId));

    return { ok: true, isLive: true };
  });
}
