import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '@telecomm/db';
import { workspaces } from '@telecomm/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';

const updateBody = z.object({
  name: z.string().min(2).optional(),
  settings: z.record(z.unknown()).optional(),
  businessHours: z.object({
    timezone: z.string(),
    schedule: z.array(z.object({ day: z.number().int().min(0).max(6), open: z.string(), close: z.string() })),
  }).optional(),
});

/**
 * Email addresses in settings are routing and sending identity, not free text:
 * `supportEmail` is the inbound routing key (unique across workspaces) and
 * `smtpFromAddress` is the verified sender signature. Validate and canonicalise
 * both so a lookup by lower-cased address always matches what was stored.
 */
const emailSettings = z.object({
  supportEmail: z.string().email().optional(),
  smtpFromAddress: z.string().email().optional(),
  smtpFromName: z.string().max(120).optional(),
});

function normalizeEmailSettings(settings: Record<string, unknown>) {
  const parsed = emailSettings.safeParse(settings);
  if (!parsed.success) return { error: parsed.error.flatten() };
  const out = { ...settings };
  if (parsed.data.supportEmail) out.supportEmail = parsed.data.supportEmail.trim().toLowerCase();
  if (parsed.data.smtpFromAddress) {
    out.smtpFromAddress = parsed.data.smtpFromAddress.trim().toLowerCase();
  }
  if (parsed.data.smtpFromName !== undefined) out.smtpFromName = parsed.data.smtpFromName.trim();
  return { value: out };
}

export const workspacesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/workspaces/current', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).limit(1);
    if (!ws) return reply.code(404).send({ error: 'Not found' });
    return ws;
  });

  app.patch('/workspaces/current', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const body = updateBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.name) updates.name = body.data.name;
    if (body.data.businessHours) updates.businessHours = body.data.businessHours;

    if (body.data.settings) {
      const normalized = normalizeEmailSettings(body.data.settings);
      if (normalized.error) return reply.code(400).send({ error: normalized.error });

      // Merge rather than replace: settings holds widget, SLA and email config,
      // so a PATCH that sets one key must not wipe the others.
      const [current] = await db
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .where(eq(workspaces.id, session.workspaceId))
        .limit(1);
      updates.settings = { ...((current?.settings as object) ?? {}), ...normalized.value };
    }

    try {
      const [updated] = await db.update(workspaces)
        .set(updates as Partial<typeof workspaces.$inferInsert>)
        .where(eq(workspaces.id, session.workspaceId)).returning();
      return updated;
    } catch (err: any) {
      // workspaces_support_email_key — the address routes to another workspace.
      if (err?.code === '23505') {
        return reply.code(409).send({
          error: 'That support address is already connected to another workspace.',
        });
      }
      throw err;
    }
  });
};
