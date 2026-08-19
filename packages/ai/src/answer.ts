import Anthropic from '@anthropic-ai/sdk';

export type SearchResult = {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
  title: string;
  url: string | null;
};

/** One prior message in the conversation so the AI can respond in context. */
export type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type ConversationSummary = {
  summary: string;
  whatCustomerWants: string;
  whatsBeenTried: string;
  currentStatus: string;
  keyDetails: string[];
};

/**
 * Summarize a conversation for the agent-facing side panel. Returns tight
 * one/two-line fields the agent can scan in a few seconds instead of reading
 * the whole thread. Cheap Haiku call — designed to run fire-and-forget after
 * each AI reply.
 */
export async function summarizeConversation(
  turns: ChatTurn[],
  brandName?: string,
): Promise<ConversationSummary> {
  const transcript = turns
    .slice(-20)
    .map((t) => `${t.role === 'user' ? 'Customer' : 'Assistant'}: ${t.content}`)
    .join('\n');

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: [
      `Summarize this ${brandName ?? 'brand'} customer-support conversation for an agent picking it up mid-thread.`,
      'Be terse. Facts only — no filler. Return JSON only:',
      '{',
      '  "summary": "<one sentence: what this conversation is about>",',
      '  "what_customer_wants": "<one sentence>",',
      '  "whats_been_tried": "<one sentence of what the AI or agent has already suggested; empty string if nothing tried>",',
      '  "current_status": "<one short phrase: waiting_on_customer | needs_agent | resolved | information_gathering>",',
      '  "key_details": ["<up to 5 short bullets: order IDs, dates, product names, error messages, anything specific>"]',
      '}',
    ].join('\n'),
    messages: [{ role: 'user', content: transcript || '(empty conversation)' }],
  });
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}';
  let parsed: {
    summary?: string;
    what_customer_wants?: string;
    whats_been_tried?: string;
    current_status?: string;
    key_details?: string[];
  } = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m?.[0] ?? '{}');
  } catch {
    // fall through with defaults
  }
  return {
    summary: (parsed.summary ?? 'Conversation with a customer.').toString().slice(0, 500),
    whatCustomerWants: (parsed.what_customer_wants ?? '').toString().slice(0, 400),
    whatsBeenTried: (parsed.whats_been_tried ?? '').toString().slice(0, 400),
    currentStatus: (parsed.current_status ?? '').toString().slice(0, 60),
    keyDetails: Array.isArray(parsed.key_details)
      ? parsed.key_details.slice(0, 5).map((d) => String(d).slice(0, 200))
      : [],
  };
}

const client = new Anthropic();

export type ExtractedContact = {
  /** Customer email address, if mentioned in this message or a prior one. */
  email?: string;
  /** Customer name, if given. */
  name?: string;
  /** Order ID / reference number, if quoted. */
  orderId?: string;
};

export type AIAnswer = {
  answer: string;
  confidence: number;
  shouldEscalate: boolean;
  escalationReason?: string;
  /** Fields the AI parsed out of the customer's message(s), to save on the contact. */
  extracted?: ExtractedContact;
  /** Short topic label the AI infers ("shipping", "refund", "sizing"…). Powers analytics. */
  topic?: string;
  sources: Array<{
    documentId: string;
    title: string;
    url?: string;
    excerpt: string;
    similarity: number;
  }>;
};

// Lower thresholds → the AI keeps trying rather than handing off. Default
// tier moved from `balanced` behavior to `confident`: the model's own
// `needs_human` flag is now the primary escalation signal, and confidence
// only forces a hand-off when the model was really unsure of itself.
const THRESHOLDS = { cautious: 0.75, balanced: 0.45, confident: 0.30 } as const;

/**
 * Ask the model, grounded in retrieved knowledge, with the running
 * conversation history so it can behave like a real support rep:
 *
 *   • Greet on the first turn, then get to work.
 *   • ASK CLARIFYING QUESTIONS instead of dumping a generic answer —
 *     order ID for order questions, product SKU for sizing/stock,
 *     email address for anything account-specific.
 *   • Only escalate when the question is genuinely out of scope or
 *     needs a human decision (refunds outside policy, complaints,
 *     custom deals). Missing info is a follow-up, not an escalation.
 *   • Return any info the customer volunteered so we can update the
 *     contact record and the agent picks up an already-identified user.
 */
export async function generateAnswer(
  question: string,
  chunks: SearchResult[],
  settings?: {
    botName?: string;
    brandName?: string;
    escalationThreshold?: string;
    systemInstructions?: string;
  },
  history: ChatTurn[] = [],
): Promise<AIAnswer> {
  const threshold = THRESHOLDS[(settings?.escalationThreshold as keyof typeof THRESHOLDS) ?? 'balanced'] ?? 0.60;
  const botName = settings?.botName ?? 'Assistant';
  const brand = settings?.brandName ?? 'our team';

  // Give each excerpt an index and, when the source doc has a URL, expose
  // that URL so the model can drop it inline as a clickable link the widget
  // will render. Docs without URLs (uploaded files, manual entries) are
  // marked so the model doesn't hallucinate a fake link.
  const context = chunks.length
    ? chunks
        .map((c, i) => {
          const header = c.url
            ? `[${i + 1}] ${c.title} — URL: ${c.url}`
            : `[${i + 1}] ${c.title} (no public URL)`;
          return `${header}\n${c.content.slice(0, 800)}`;
        })
        .join('\n\n---\n\n')
    : '(No relevant knowledge base content matched this question.)';

  // Keep the last ~10 turns to bound context. Older stuff falls off; the
  // model still sees the current question below.
  const trimmed = history.slice(-10);
  const transcript = trimmed
    .map((t) => `${t.role === 'user' ? 'Customer' : 'Assistant'}: ${t.content}`)
    .join('\n');

  const system = [
    `You are ${botName}, a warm, capable AI support assistant for ${brand}. You talk like a knowledgeable teammate — helpful, direct, and human — not like a scripted bot.`,
    '',
    'How you work:',
    '- Try HARD to resolve the customer\'s problem yourself. You are the first and best line of support; humans are a last resort, not a co-pilot.',
    '- Ground every factual answer in the knowledge base excerpts below. Never invent facts, prices, policies, dates, or product details.',
    '- When an excerpt has a URL, cite it inline as a clickable markdown link: [helpful label](URL). Prefer the article title as the label. Do not paste raw URLs; do not link to sources without a URL.',
    '- Be conversational. Greet on the first turn, use the customer\'s name if you know it, mirror their tone, and answer in 2–5 sentences.',
    '- Ask ONE clarifying question at a time when you need info — never a checklist. Examples:',
    '    • Order / delivery → ask for the order ID or the email used to buy.',
    '    • Account / login → ask for the account email.',
    '    • Product-specific (size, stock, variant) → ask which product.',
    '    • Refund / complaint → gather name, order ID, and one-line reason before considering escalation.',
    '- If the excerpts don\'t cover the topic, say so plainly. Then EITHER ask a clarifying question that would let you help, OR (only if the ask is truly out of AI scope — policy exception, custom deal, human judgement) offer to connect a human.',
    '- Persist any info the customer volunteers into the extracted fields so a human agent picks up an already-identified visitor.',
    '- Never promise refunds, exceptions, or timelines that aren\'t in the knowledge base. Never guess about their specific order — always ask for the order ID and say you\'ll check.',
    '',
    'Escalate to a human ONLY when: the customer explicitly asks for one, the resolution requires a decision only a human can make (policy exception, custom pricing, dispute), OR you\'ve asked one clarifying question and the knowledge base still can\'t help. Frustration alone is not an escalation trigger — try again with empathy and a link.',
    '',
    settings?.systemInstructions ? `Additional instructions from ${brand}:\n${settings.systemInstructions}` : '',
    '',
    'Return JSON only, matching this schema exactly. The `answer` field is what the customer sees — include markdown-style links [label](URL) inline where they help.',
    '{',
    '  "answer": "<what to say to the customer, 2-5 sentences, may contain [label](URL) markdown links to KB articles>",',
    '  "confidence": <0.0-1.0>,',
    '  "needs_human": <true if a human should take over, else false>,',
    '  "escalation_reason": <short string when needs_human is true, else null>,',
    '  "topic": <one lowercase phrase categorizing the customer\'s intent: "shipping" / "returns" / "refund" / "sizing" / "account" / "pricing" / "tech-issue" / "complaint" / "general" — pick the closest>,',
    '  "extracted": { "email": <string|null>, "name": <string|null>, "order_id": <string|null> }',
    '}',
  ].filter(Boolean).join('\n');

  const userContent = [
    'Knowledge base excerpts (may be empty):',
    context,
    '',
    transcript ? `Conversation so far:\n${transcript}` : '',
    '',
    `Current customer message: ${question}`,
  ].filter(Boolean).join('\n\n');

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}';

  let parsed: {
    answer?: string;
    confidence?: number;
    needs_human?: boolean;
    escalation_reason?: string | null;
    topic?: string;
    extracted?: { email?: string | null; name?: string | null; order_id?: string | null };
  } = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m?.[0] ?? '{}');
  } catch {
    parsed = { answer: text.slice(0, 500), confidence: 0.4 };
  }

  const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.4));
  // Model's explicit flag overrides the threshold — the model has the full
  // context to decide; the threshold is just a floor for silent low quality.
  const shouldEscalate = parsed.needs_human === true || confidence < threshold;

  const extracted: ExtractedContact = {};
  if (parsed.extracted?.email && typeof parsed.extracted.email === 'string') {
    extracted.email = parsed.extracted.email.trim();
  }
  if (parsed.extracted?.name && typeof parsed.extracted.name === 'string') {
    extracted.name = parsed.extracted.name.trim();
  }
  if (parsed.extracted?.order_id && typeof parsed.extracted.order_id === 'string') {
    extracted.orderId = parsed.extracted.order_id.trim();
  }

  return {
    answer: parsed.answer ?? "I'm not sure yet — could you share a bit more about what you're trying to do?",
    confidence,
    shouldEscalate,
    escalationReason: shouldEscalate ? (parsed.escalation_reason ?? 'Needs human review') : undefined,
    extracted: Object.keys(extracted).length ? extracted : undefined,
    topic: parsed.topic?.toString().slice(0, 40),
    sources: chunks.slice(0, 3).map(c => ({
      documentId: c.documentId,
      title: c.title,
      url: c.url ?? undefined,
      excerpt: c.content.slice(0, 200),
      similarity: c.similarity,
    })),
  };
}
