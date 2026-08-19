import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '@telecomm/db';
import { users, workspaces } from '@telecomm/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { randomBytes } from 'crypto';
import { webUrl } from '../../lib/urls.js';
import { sendMail } from '../../lib/mailer.js';

const inviteBody = z.object({
  email: z.string().email(),
  name: z.string().min(2).optional(),
  role: z.enum(['agent', 'readonly']).default('agent'),
});

const dayLiteral = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3),
  z.literal(4), z.literal(5), z.literal(6),
]);
const availabilitySchema = z.object({
  timezone: z.string().min(1),
  schedule: z.array(z.object({
    day: dayLiteral,
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
  })),
});

const updateSelfBody = z.object({
  name: z.string().min(2).optional(),
  availability: availabilitySchema.optional(),
  status: z.enum(['online', 'away', 'offline']).optional(),
});

const updateMemberBody = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(['admin', 'agent', 'readonly']).optional(),
  availability: availabilitySchema.optional(),
  maxConcurrentChats: z.number().int().min(1).max(50).optional(),
});

/**
 * Send the "you're invited to join <brand> on Telecomm" email. Uses the
 * platform sender (SMTP_FROM), not any workspace's Gmail — the invitee has
 * not agreed to receive mail from that brand yet, and the platform sender
 * is what has a warm reputation.
 */
async function sendInviteEmail(opts: {
  to: string;
  inviteeName: string;
  inviterName: string;
  brand: string;
  role: string;
  link: string;
}): Promise<void> {
  const roleLabel = opts.role === 'admin' ? 'an admin' : opts.role === 'readonly' ? 'a viewer' : 'an agent';
  const subject = `${opts.inviterName} invited you to join ${opts.brand} on Telecomm`;

  const text = [
    `Hi ${opts.inviteeName},`,
    '',
    `${opts.inviterName} invited you to join the ${opts.brand} support workspace on Telecomm as ${roleLabel}.`,
    '',
    'Accept the invite and set up your account here:',
    opts.link,
    '',
    'This link is unique to you — do not share it. It expires after your first use.',
    '',
    "If you weren't expecting this invite, you can ignore this email.",
    '',
    '— The Telecomm team',
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#111827;">
  <p style="font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(opts.inviteeName)},</p>
  <p style="font-size:15px;margin:0 0 20px;color:#374151;">
    <strong>${escapeHtml(opts.inviterName)}</strong> invited you to join the
    <strong>${escapeHtml(opts.brand)}</strong> support workspace on Telecomm as ${escapeHtml(roleLabel)}.
  </p>
  <div style="margin:28px 0;">
    <a href="${opts.link}"
       style="display:inline-block;padding:12px 22px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      Accept invite &amp; sign up
    </a>
  </div>
  <p style="font-size:12px;color:#6b7280;margin:0 0 12px;">
    Or copy this link into your browser:<br>
    <span style="word-break:break-all;color:#4f46e5;">${escapeHtml(opts.link)}</span>
  </p>
  <p style="font-size:12px;color:#9ca3af;margin:24px 0 0;border-top:1px solid #e5e7eb;padding-top:16px;">
    This link is unique to you — do not share it. If you weren&#39;t expecting this invite, you can ignore this email.
  </p>
</div>`;

  await sendMail({
    to: opts.to,
    subject,
    text,
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const usersRoutes: FastifyPluginAsync = async (app) => {
  // GET /users/me
  app.get('/users/me', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;
    const [user] = await db.select({
      id: users.id, email: users.email, name: users.name, role: users.role, status: users.status,
      availability: users.availability, maxConcurrentChats: users.maxConcurrentChats,
    }).from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user) return reply.code(404).send({ error: 'Not found' });
    return user;
  });

  // PATCH /users/me — user updates their own name / availability / status
  app.patch('/users/me', async (request, reply) => {
    const session = requireAuth(request, reply);
    if (!session) return;
    const body = updateSelfBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const patch = body.data;
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'No fields to update' });
    await db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, session.userId));
    return { ok: true };
  });

  // GET /users — list workspace members (admin only)
  app.get('/users', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const members = await db.select({
      id: users.id, email: users.email, name: users.name, role: users.role, status: users.status,
      availability: users.availability, maxConcurrentChats: users.maxConcurrentChats,
      inviteAcceptedAt: users.inviteAcceptedAt, createdAt: users.createdAt,
    }).from(users).where(eq(users.workspaceId, session.workspaceId));
    return members;
  });

  // PATCH /users/:id — admin updates a teammate
  app.patch('/users/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const body = updateMemberBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const { maxConcurrentChats, ...rest } = body.data;
    const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (maxConcurrentChats != null) patch.maxConcurrentChats = String(maxConcurrentChats);
    if (Object.keys(patch).length <= 1) return reply.code(400).send({ error: 'No fields to update' });
    await db.update(users).set(patch).where(and(eq(users.id, id), eq(users.workspaceId, session.workspaceId)));
    return { ok: true };
  });

  // POST /users/invite — admin invites a teammate
  app.post('/users/invite', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;

    const body = inviteBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    // Prevent duplicate invite for same email in same workspace
    const existing = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.workspaceId, session.workspaceId), eq(users.email, body.data.email)))
      .limit(1);
    if (existing.length) return reply.code(409).send({ error: 'This email is already a member' });

    const inviteToken = randomBytes(32).toString('hex');
    const [invited] = await db.insert(users).values({
      workspaceId: session.workspaceId,
      email: body.data.email,
      name: body.data.name ?? body.data.email.split('@')[0],
      role: body.data.role,
      inviteToken,
      invitedBy: session.userId,
    }).returning({ id: users.id, email: users.email, name: users.name, role: users.role, inviteToken: users.inviteToken });

    const inviteLink = `${webUrl()}/invite/${inviteToken}`;

    // Kick off the email in the background. The invite row is already saved
    // so the recipient can accept via the returned link regardless — no
    // matter how slow (or misconfigured) the SMTP provider is, we do NOT
    // hold the HTTP response waiting for a network round-trip we can't
    // control. Delivery success shows up in the mailer logs, not on this
    // response.
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    if (smtpConfigured) {
      (async () => {
        try {
          const [ws] = await db
            .select({ name: workspaces.name })
            .from(workspaces)
            .where(eq(workspaces.id, session.workspaceId))
            .limit(1);
          const brand = ws?.name ?? 'Telecomm';
          const [inviter] = await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);
          const inviterName = inviter?.name ?? 'A teammate';
          await sendInviteEmail({
            to: invited.email,
            inviteeName: invited.name,
            inviterName,
            brand,
            role: invited.role,
            link: inviteLink,
          });
        } catch (err) {
          app.log.warn({ err, email: invited.email }, 'invite email failed — link is still on the invite row');
        }
      })();
    }

    return reply.code(201).send({
      ...invited,
      inviteLink,
      // Best-effort signal to the UI: SMTP is configured, so an email is
      // most likely on its way. When it isn't configured we tell the admin
      // to copy the link so they aren't waiting on a delivery that isn't
      // happening.
      emailSent: smtpConfigured,
      ...(smtpConfigured ? {} : { emailError: 'SMTP not configured on API. Copy the invite link and share it directly.' }),
    });
  });

  // DELETE /users/:id — admin removes a member
  app.delete('/users/:id', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    if (id === session.userId) return reply.code(400).send({ error: 'Cannot remove yourself' });
    await db.delete(users).where(and(eq(users.id, id), eq(users.workspaceId, session.workspaceId)));
    return reply.code(204).send();
  });
};
