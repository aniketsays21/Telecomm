import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '@telecomm/db';
import {
  conversations,
  messages,
  contacts,
  sources,
  documents,
  chunks,
  cannedResponses,
  users,
} from '@telecomm/db/schema';
import { requireAdmin } from '../../middleware/auth.js';

/**
 * Demo-mode seed + wipe. Every row the seeder creates carries `is_demo=true`
 * so the wipe can delete just what was seeded, leaving any real conversations,
 * documents, and canned replies untouched.
 *
 * Volumes (tuned for "does this platform hold up at scale?"):
 *   • ~200 chat conversations, ~4 messages each  → ~800 messages
 *   • ~150 email conversations, ~3 messages each → ~450 messages
 *   • 30 KB documents across 6 sources           → ~120 chunks
 *   •  8 canned responses across tags
 *
 * All timestamps back-dated across the last 30 days so the dashboard reads
 * as an active workspace, not a wall of "just now" rows.
 */

// ---- data pools -----------------------------------------------------------

const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Rohan', 'Priya', 'Karan', 'Meera', 'Vikram', 'Ananya',
  'Rahul', 'Sneha', 'Arjun', 'Kavya', 'Sameer', 'Isha', 'Nikhil', 'Divya',
  'Aryan', 'Riya', 'Yash', 'Neha', 'Siddharth', 'Pooja', 'Manish', 'Tanya',
  'James', 'Emily', 'Michael', 'Sarah', 'David', 'Emma', 'Chris', 'Olivia',
  'Daniel', 'Sophia', 'Ryan', 'Mia',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Nair', 'Rao', 'Kapoor', 'Mehta', 'Gupta',
  'Reddy', 'Bose', 'Ali', 'Khan', 'Patel', 'Shah', 'Singh',
  'Smith', 'Johnson', 'Williams', 'Brown', 'Miller', 'Wilson',
];
const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'protonmail.com', 'icloud.com'];

const TAG_TEMPLATES: Array<{
  tag: string;
  subjects: string[];
  openers: string[];
  aiReply: string;
  sentimentBias: Array<'positive' | 'neutral' | 'negative' | 'frustrated' | 'angry'>;
}> = [
  {
    tag: 'shipping',
    subjects: ['Order not delivered', "Where's my package?", 'Late shipment', 'Delivery status'],
    openers: [
      'Hi, I ordered on {date} and still nothing. Order #{oid}.',
      'My package was supposed to arrive yesterday. Any update?',
      'Tracking has been stuck on "in transit" for 5 days now.',
    ],
    aiReply: "I looked up order #{oid} — it's in transit and expected within 2 business days. I'll flag it for a delivery update if it slips past then.",
    sentimentBias: ['neutral', 'negative', 'frustrated', 'neutral'],
  },
  {
    tag: 'refund',
    subjects: ['Refund request', 'Return not processed', 'Refund status'],
    openers: [
      'I returned an item 10 days ago but no refund yet. Order #{oid}.',
      "Can I get a refund? The product isn't what I expected.",
      'The refund never arrived to my card.',
    ],
    aiReply: 'Your refund for order #{oid} is being processed and typically posts within 5–7 business days. I can escalate if it takes longer.',
    sentimentBias: ['negative', 'frustrated', 'angry', 'neutral'],
  },
  {
    tag: 'sizing',
    subjects: ['Size question', 'What size should I order?', 'Size chart help'],
    openers: [
      'I usually wear a Medium in US brands. What size should I order here?',
      'The sizing chart is confusing — help?',
      'Is your Large true to size?',
    ],
    aiReply: 'Our sizes run true — a US Medium maps to Medium here. If you\'re between sizes, most customers size up for a relaxed fit.',
    sentimentBias: ['neutral', 'positive', 'neutral'],
  },
  {
    tag: 'account',
    subjects: ['Login issue', "Can't sign in", 'Password reset'],
    openers: [
      "I can't log into my account. Email is {email}.",
      'Password reset email never came through.',
      "It says my account doesn't exist but I've been ordering for a year.",
    ],
    aiReply: "I've sent a fresh password reset link to {email}. Please also check your spam folder if it doesn't appear in 2 minutes.",
    sentimentBias: ['negative', 'frustrated', 'neutral'],
  },
  {
    tag: 'pricing',
    subjects: ['Discount available?', 'Coupon not working', 'Price mismatch'],
    openers: [
      'Do you have any active discount codes?',
      "My coupon SAVE10 isn't applying at checkout.",
      'This was $30 yesterday and is now $50. What changed?',
    ],
    aiReply: "SAVE10 is valid on orders above ₹1,500. If your cart qualifies and it still won't apply, share a screenshot and I'll dig in.",
    sentimentBias: ['neutral', 'positive', 'negative'],
  },
  {
    tag: 'tech-issue',
    subjects: ['Website error', 'Payment failed', "Can't checkout"],
    openers: [
      'The checkout page keeps refreshing when I click Pay.',
      "Getting a 500 error on the product page.",
      "The app crashed and I lost my cart.",
    ],
    aiReply: "Sorry about that — could you try clearing cookies for our site and retrying? If it persists, share the browser you're on and I'll look at logs on our side.",
    sentimentBias: ['frustrated', 'angry', 'negative'],
  },
  {
    tag: 'complaint',
    subjects: ['Very disappointed', 'Poor product quality', 'Worst experience'],
    openers: [
      "This product broke on the first use. Absolutely unacceptable for the price.",
      "I've been waiting 3 weeks. Nobody responds. Terrible service.",
      'Cancel my order. This is the last time I buy from you.',
    ],
    aiReply: "I'm really sorry about this experience — I'm connecting you with a specialist who can make it right. You'll hear from them within a couple of hours.",
    sentimentBias: ['angry', 'frustrated', 'angry'],
  },
  {
    tag: 'general',
    subjects: ['Question about product', 'How does this work?', 'Just curious'],
    openers: [
      'Do you ship internationally?',
      'What materials is this made from?',
      'Is this in stock in the color I want?',
    ],
    aiReply: "Happy to help — we ship to 40+ countries; delivery times vary by region. Let me know where you're based and I'll pull specific timelines.",
    sentimentBias: ['positive', 'neutral', 'positive'],
  },
];

const DEMO_AGENTS = [
  { name: 'Priya Nair',       email: 'priya.support@demo.telecomm',  status: 'online'  as const },
  { name: 'Rohan Kapoor',     email: 'rohan.support@demo.telecomm',  status: 'online'  as const },
  { name: 'Emily Chen',       email: 'emily.support@demo.telecomm',  status: 'away'    as const },
  { name: 'Karan Mehta',      email: 'karan.support@demo.telecomm',  status: 'online'  as const },
  { name: 'Anika Rao',        email: 'anika.support@demo.telecomm',  status: 'offline' as const },
  { name: 'Marcus Johnson',   email: 'marcus.support@demo.telecomm', status: 'online'  as const },
];

const CANNED_RESPONSES = [
  { title: 'Order status', shortcut: 'orderstatus', body: 'Thanks for reaching out! I\'m checking your order status now and will get back within a few minutes.', tag: 'shipping' },
  { title: 'Refund initiated', shortcut: 'refundstart', body: 'Your refund has been initiated. Please allow 5–7 business days for it to appear on your original payment method.', tag: 'refund' },
  { title: 'Sizing guidance', shortcut: 'sizing', body: 'Our sizes are true to standard fit. If you\'re between sizes, we recommend sizing up for a relaxed fit or down for a tailored look.', tag: 'sizing' },
  { title: 'Password reset', shortcut: 'reset', body: 'I\'ve sent a password reset link to your email. It expires in 30 minutes — please check your inbox and spam folder.', tag: 'account' },
  { title: 'Discount policy', shortcut: 'discount', body: 'Active promotions are always shown at checkout. We don\'t send private discount codes, but signing up for our newsletter unlocks first-order savings.', tag: 'pricing' },
  { title: 'Tech issue triage', shortcut: 'techissue', body: 'Sorry for the trouble! Could you share (1) the browser you\'re using, (2) a screenshot of the error, and (3) the URL where it happened?', tag: 'tech-issue' },
  { title: 'Apology + escalation', shortcut: 'apology', body: 'I\'m so sorry about this experience. I\'m looping in a senior specialist right now — you\'ll hear from them within the hour.', tag: 'complaint' },
  { title: 'Thanks + close', shortcut: 'thanks', body: 'Glad we could help! I\'ll close this thread now, but feel free to reply anytime and we\'ll pick it right back up.', tag: 'general' },
];

const DEMO_DOC_TEMPLATES: Array<{ source: string; docs: Array<{ title: string; url: string; body: string }> }> = [
  {
    source: 'Help Centre',
    docs: [
      { title: 'How to track your order', url: 'https://help.example.com/tracking', body: 'You can track your order using the link in your shipping confirmation email or by logging into your account and visiting the Orders page. Tracking updates typically appear within 24 hours of dispatch.' },
      { title: 'Return and refund policy', url: 'https://help.example.com/returns', body: 'We accept returns within 30 days of delivery for unworn items in original packaging. Refunds are processed within 5-7 business days to your original payment method.' },
      { title: 'Size guide', url: 'https://help.example.com/sizing', body: 'Our clothing runs true to standard US sizing. When between sizes, we recommend sizing up for a relaxed fit. Detailed measurements are on each product page.' },
      { title: 'Shipping timelines', url: 'https://help.example.com/shipping', body: 'Domestic shipping: 2-5 business days. International: 7-14 days depending on destination. Express shipping is available at checkout.' },
      { title: 'Payment methods', url: 'https://help.example.com/payment', body: 'We accept all major credit cards, UPI, net banking, PayPal, and Apple Pay. Buy-now-pay-later via Klarna is available on orders above ₹2,000.' },
    ],
  },
  {
    source: 'Product FAQ',
    docs: [
      { title: 'Care instructions', url: 'https://help.example.com/care', body: 'Machine wash cold, tumble dry low, iron on medium heat. Do not bleach. Wash dark colors separately for the first three washes to prevent fading.' },
      { title: 'Warranty information', url: 'https://help.example.com/warranty', body: 'Products carry a 6-month manufacturer warranty covering defects. Wear and tear from normal use is not covered. Contact support with your order number to initiate a warranty claim.' },
      { title: 'What materials do you use?', url: 'https://help.example.com/materials', body: 'Our garments use OEKO-TEX certified organic cotton and recycled polyester blends. Full material composition is listed on every product page.' },
      { title: 'Sustainability', url: 'https://help.example.com/sustainability', body: 'We use 100% recycled packaging, offset shipping carbon, and pay living wages to all garment workers. Read our full sustainability report.' },
    ],
  },
  {
    source: 'Account help',
    docs: [
      { title: 'Reset your password', url: 'https://help.example.com/password-reset', body: 'Click "Forgot password" on the login page. A reset link is sent to your email and expires in 30 minutes. If you don\'t receive it, check spam or contact support.' },
      { title: 'Update your address', url: 'https://help.example.com/address', body: 'Log in, go to Account Settings → Addresses. You can add, edit, or remove shipping addresses. Changes apply to future orders — for orders in progress, contact support to update the shipping address.' },
      { title: 'Delete your account', url: 'https://help.example.com/delete-account', body: 'Email support with your registered address requesting deletion. Your personal data is removed within 30 days per GDPR/DPDP guidelines. Order history is retained for legal compliance.' },
      { title: 'Change email address', url: 'https://help.example.com/change-email', body: 'Account Settings → Profile → Email. You\'ll need to confirm the change via a link sent to the new address.' },
    ],
  },
  {
    source: 'Order help',
    docs: [
      { title: 'Cancel an order', url: 'https://help.example.com/cancel', body: 'Orders can be cancelled within 2 hours of placement directly from your Orders page. After that window, contact support and we\'ll try to intercept before dispatch.' },
      { title: 'Modify an order', url: 'https://help.example.com/modify', body: 'Size, colour, or quantity changes need to happen before dispatch. Contact support quickly with your order number and the change you need.' },
      { title: 'Combine two orders', url: 'https://help.example.com/combine', body: 'We can combine orders placed within a 24-hour window to save on shipping. Reply to your order confirmation with both order numbers and we\'ll consolidate.' },
      { title: 'Missing items in delivery', url: 'https://help.example.com/missing-items', body: 'If your package arrived with items missing, take a photo of the packing slip and open box, then contact support within 48 hours of delivery.' },
      { title: 'Wrong item received', url: 'https://help.example.com/wrong-item', body: 'Sorry about that! Photograph the item you received and the packing slip, and email support. We\'ll ship the correct item at no cost and arrange a return pickup.' },
    ],
  },
  {
    source: 'Payments & billing',
    docs: [
      { title: 'Payment declined', url: 'https://help.example.com/payment-declined', body: 'Payment failures usually mean bank restrictions or a mismatch between billing address and card. Retry with a different card or reach out — we can send a payment link.' },
      { title: 'Refund not received', url: 'https://help.example.com/refund-status', body: 'Refunds appear within 5-7 business days. If it\'s been longer, share your order number and last 4 digits of your card and we\'ll trace it with the payment provider.' },
      { title: 'GST invoice', url: 'https://help.example.com/gst-invoice', body: 'GST invoices are automatically emailed 24 hours after dispatch. Add your GSTIN at checkout to include it on the invoice.' },
    ],
  },
  {
    source: 'Shipping & delivery',
    docs: [
      { title: 'International shipping', url: 'https://help.example.com/intl-shipping', body: 'We ship to 42 countries. Delivery times: US 5-8 days, EU 6-10 days, APAC 4-7 days. Duties and taxes are collected at delivery.' },
      { title: 'Cash on delivery', url: 'https://help.example.com/cod', body: 'COD is available for orders under ₹5,000 to serviceable pincodes. A small handling fee applies. Enter your pincode at checkout to check availability.' },
      { title: 'Change delivery address', url: 'https://help.example.com/change-address', body: 'You can change the delivery address only before the order is dispatched. Contact support with your order number and new address as soon as possible.' },
      { title: 'Delivery attempts', url: 'https://help.example.com/delivery-attempts', body: 'Our couriers attempt delivery up to 3 times. If unsuccessful, the parcel is returned to us. You\'ll be refunded minus a return-shipping fee.' },
    ],
  },
];

// ---- helpers --------------------------------------------------------------

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(lo: number, hi: number): number { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
function randBool(p = 0.5): boolean { return Math.random() < p; }
function randomOid(): string { return String(randInt(100000, 999999)); }
function daysAgo(days: number): Date { return new Date(Date.now() - days * 86400_000 - randInt(0, 60) * 60_000); }
function subst(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

// ---- routes ---------------------------------------------------------------

export const demoRoutes: FastifyPluginAsync = async (app) => {
  // GET /demo/status — is demo mode currently on for this workspace?
  app.get('/demo/status', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const [row] = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM conversations
      WHERE workspace_id = ${session.workspaceId}::uuid AND is_demo = true
    `);
    const count = Number((row as Record<string, unknown>)?.cnt ?? 0);
    return { enabled: count > 0, seededConversations: count };
  });

  // POST /demo/enable — seed the workspace with realistic dummy data.
  // Idempotent: if demo data already exists, returns without re-seeding.
  app.post('/demo/enable', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;

    const [existing] = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM conversations
      WHERE workspace_id = ${session.workspaceId}::uuid AND is_demo = true
    `);
    if (Number((existing as Record<string, unknown>)?.cnt ?? 0) > 0) {
      return { ok: true, alreadySeeded: true };
    }

    const wid = session.workspaceId;
    const stats = await seedWorkspace(wid);
    request.log.info({ workspaceId: wid, stats }, 'demo seeded');
    return { ok: true, seeded: stats };
  });

  // POST /demo/disable — delete every row tagged is_demo. Real data untouched.
  app.post('/demo/disable', async (request, reply) => {
    const session = requireAdmin(request, reply);
    if (!session) return;
    const wid = session.workspaceId;

    // Cascade order: chunks → documents → sources; messages → conversations →
    // contacts; canned responses. Row counts collected for the response.
    const counts = { messages: 0, conversations: 0, contacts: 0, chunks: 0, documents: 0, sources: 0, canned: 0, agents: 0 };

    const delMessages = await db.delete(messages)
      .where(and(eq(messages.workspaceId, wid), eq(messages.isDemo, true)))
      .returning({ id: messages.id });
    counts.messages = delMessages.length;

    const delConvos = await db.delete(conversations)
      .where(and(eq(conversations.workspaceId, wid), eq(conversations.isDemo, true)))
      .returning({ id: conversations.id });
    counts.conversations = delConvos.length;

    const delContacts = await db.delete(contacts)
      .where(and(eq(contacts.workspaceId, wid), eq(contacts.isDemo, true)))
      .returning({ id: contacts.id });
    counts.contacts = delContacts.length;

    const delChunks = await db.delete(chunks)
      .where(and(eq(chunks.workspaceId, wid), eq(chunks.isDemo, true)))
      .returning({ id: chunks.id });
    counts.chunks = delChunks.length;

    const delDocs = await db.delete(documents)
      .where(and(eq(documents.workspaceId, wid), eq(documents.isDemo, true)))
      .returning({ id: documents.id });
    counts.documents = delDocs.length;

    const delSources = await db.delete(sources)
      .where(and(eq(sources.workspaceId, wid), eq(sources.isDemo, true)))
      .returning({ id: sources.id });
    counts.sources = delSources.length;

    const delCanned = await db.delete(cannedResponses)
      .where(and(eq(cannedResponses.workspaceId, wid), eq(cannedResponses.isDemo, true)))
      .returning({ id: cannedResponses.id });
    counts.canned = delCanned.length;

    // Delete demo agents LAST — messages / conversations referenced them via
    // assignee_id and author_id. Those got cleared above; now the FK is free.
    const delAgents = await db.delete(users)
      .where(and(eq(users.workspaceId, wid), eq(users.isDemo, true)))
      .returning({ id: users.id });
    counts.agents = delAgents.length;

    request.log.info({ workspaceId: wid, counts }, 'demo cleared');
    return { ok: true, cleared: counts };
  });
};

// ---- seeder ---------------------------------------------------------------

async function seedWorkspace(workspaceId: string) {
  // --- Demo teammates — the workspace's admin sees "5 agents on the team"
  //     instead of just themselves. Each agent gets a plausible name +
  //     always-available schedule so the on-duty picker considers them, and
  //     invite_accepted_at is stamped so they don't show a "pending" chip. ---
  const insertedAgents = await db.insert(users).values(
    DEMO_AGENTS.map((a) => ({
      workspaceId,
      name: a.name,
      email: a.email,
      role: 'agent' as const,
      status: a.status,
      // No passwordHash → they can't sign in, but the API doesn't need it
      // to route conversations to them.
      inviteAcceptedAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 86400_000),
      maxConcurrentChats: String(4 + Math.floor(Math.random() * 6)),
      isDemo: true,
    })),
  ).returning({ id: users.id, name: users.name });

  // --- Contacts (unique senders reused across their conversations) ---
  const contactCount = 120;
  const contactRows: Array<{ id: string; email: string; name: string }> = [];
  for (let i = 0; i < contactCount; i++) {
    const first = rand(FIRST_NAMES);
    const last = rand(LAST_NAMES);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${randInt(1, 99)}@${rand(EMAIL_DOMAINS)}`;
    contactRows.push({ id: '', email, name: `${first} ${last}` });
  }
  const insertedContacts = await db.insert(contacts).values(
    contactRows.map((c) => ({
      workspaceId,
      email: c.email,
      name: c.name,
      externalId: `demo-${c.email}`,
      isDemo: true,
      firstSeenAt: daysAgo(randInt(1, 60)),
      lastSeenAt: daysAgo(randInt(0, 30)),
    })),
  ).returning({ id: contacts.id, email: contacts.email, name: contacts.name });

  // --- Canned responses ---
  await db.insert(cannedResponses).values(
    CANNED_RESPONSES.map((c) => ({
      workspaceId,
      title: c.title,
      body: c.body,
      tags: [c.tag],
      isDemo: true,
    })),
  );

  // --- KB sources + documents + chunks ---
  let docCount = 0;
  for (const sourceGroup of DEMO_DOC_TEMPLATES) {
    const [src] = await db.insert(sources).values({
      workspaceId,
      type: 'website',
      name: sourceGroup.source,
      config: { startUrl: `https://help.example.com/${sourceGroup.source.toLowerCase().replace(/\s+/g, '-')}` },
      status: 'ready',
      docCount: sourceGroup.docs.length,
      lastSyncedAt: daysAgo(randInt(1, 20)),
      isDemo: true,
    }).returning();

    for (const doc of sourceGroup.docs) {
      const contentHash = createHash('sha256').update(doc.body).digest('hex');
      const [insertedDoc] = await db.insert(documents).values({
        workspaceId,
        sourceId: src.id,
        title: doc.title,
        url: doc.url,
        content: doc.body,
        contentHash,
        docType: 'page',
        isDemo: true,
      }).returning({ id: documents.id });

      // Chunk each doc into 2 chunks so full-text search still finds it.
      const mid = Math.floor(doc.body.length / 2);
      const parts = [doc.body.slice(0, mid), doc.body.slice(mid)];
      await db.insert(chunks).values(
        parts.map((body, i) => ({
          documentId: insertedDoc.id,
          workspaceId,
          content: body,
          tokenCount: Math.ceil(body.length / 4),
          position: i,
          isDemo: true,
        })),
      );
      docCount++;
    }
  }

  // --- Conversations + messages ---
  const CHAT_COUNT = 200;
  const EMAIL_COUNT = 150;
  let convoCount = 0;
  let msgCount = 0;

  const allConvoInserts: Array<Parameters<typeof db.insert<typeof conversations>>[0]> = [];
  void allConvoInserts;

  const insertRow = async (channel: 'chat' | 'email') => {
    const template = rand(TAG_TEMPLATES);
    const contact = rand(insertedContacts);
    const orderId = randomOid();
    const vars = { oid: orderId, email: contact.email ?? '', date: `${randInt(1, 28)} ${rand(['Jan', 'Feb', 'Mar', 'Apr', 'May'])}` };
    const createdAt = daysAgo(randInt(0, 30));
    const sentiment = rand(template.sentimentBias);
    // Distribution of statuses: 55% resolved, 30% open, 10% snoozed, 5% escalated.
    const dice = Math.random();
    const status: 'open' | 'snoozed' | 'resolved' = dice < 0.55 ? 'resolved' : dice < 0.85 ? 'open' : dice < 0.95 ? 'snoozed' : 'open';
    const escalated = dice >= 0.95 || sentiment === 'angry' && randBool(0.5);
    const resolvedAt = status === 'resolved' ? new Date(createdAt.getTime() + randInt(30, 24 * 60) * 60_000) : undefined;
    const subject = channel === 'email' ? rand(template.subjects) : null;

    // Assignment: every escalated conversation gets an agent (mandatory —
    // that's the whole point of escalation), and ~40% of everything else does
    // too, so the inbox has a healthy mix of "assigned to X" rows to demo
    // the routing UI. Resolved-by-agent implies the agent handled it end to
    // end, so those always carry an assignee.
    const shouldAssign = escalated
      || (resolvedAt && randBool(0.7))
      || randBool(0.4);
    const assignedAgent = shouldAssign ? rand(insertedAgents) : null;

    const [convo] = await db.insert(conversations).values({
      workspaceId,
      contactId: contact.id,
      channel,
      status,
      subject,
      aiHandled: !escalated,
      escalatedAt: escalated ? new Date(createdAt.getTime() + randInt(1, 20) * 60_000) : null,
      escalationReason: escalated ? 'Needs human review' : null,
      resolvedAt: resolvedAt ?? null,
      resolvedBy: resolvedAt ? (randBool(0.6) ? 'agent' : 'ai') : null,
      firstResponseAt: new Date(createdAt.getTime() + randInt(1, 8) * 60_000),
      lastMessageAt: resolvedAt ?? createdAt,
      priority: escalated ? randInt(1, 3) : 0,
      sentiment,
      tags: [template.tag],
      assigneeId: assignedAgent?.id ?? null,
      assignedAt: assignedAgent ? new Date(createdAt.getTime() + randInt(1, 15) * 60_000) : null,
      createdAt,
      isDemo: true,
    }).returning();
    convoCount++;

    // 3–6 message turns: customer, AI, maybe customer again, maybe agent.
    const turns = randInt(3, 6);
    let ts = createdAt.getTime();
    for (let i = 0; i < turns; i++) {
      ts += randInt(1, 15) * 60_000;
      const isCustomer = i % 2 === 0;
      const isAgent = !isCustomer && i > 1 && escalated;
      const body = isCustomer
        ? (i === 0 ? subst(rand(template.openers), vars) : rand([
            'Any update?', 'Still waiting on this.', 'Thanks for looking into it.', 'That worked — appreciate it!', 'Let me try that.',
          ]))
        : isAgent
          ? rand([
              "Hi, I'm taking a closer look at this now — give me a moment.",
              "Thanks for your patience. I've raised this with the shipping team and will confirm within the hour.",
              "I've applied a courtesy credit to your account for the inconvenience.",
            ])
          : subst(template.aiReply, vars);
      // For agent turns, prefer the assignee (that's who would really be
      // replying). Fall back to any demo agent if none was picked.
      const agentAuthorId = isAgent
        ? (assignedAgent?.id ?? rand(insertedAgents).id)
        : (isCustomer ? contact.id : null);
      await db.insert(messages).values({
        conversationId: convo.id,
        workspaceId,
        authorType: isCustomer ? 'contact' : isAgent ? 'agent' : 'ai',
        authorId: agentAuthorId,
        body,
        sentiment: isCustomer ? sentiment : null,
        createdAt: new Date(ts),
        isDemo: true,
      });
      msgCount++;
    }
  };

  for (let i = 0; i < CHAT_COUNT; i++) await insertRow('chat');
  for (let i = 0; i < EMAIL_COUNT; i++) await insertRow('email');

  return {
    agents: insertedAgents.length,
    contacts: insertedContacts.length,
    conversations: convoCount,
    messages: msgCount,
    documents: docCount,
    cannedResponses: CANNED_RESPONSES.length,
    knowledgeSources: DEMO_DOC_TEMPLATES.length,
  };
}
