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

type ParsedEnvelope = {
  answer?: string;
  confidence?: number;
  needs_human?: boolean;
  escalation_reason?: string | null;
  topic?: string;
  sentiment?: string;
  language?: string;
  extracted?: { email?: string | null; name?: string | null; order_id?: string | null };
};

/**
 * Robustly parse the model's JSON envelope WITHOUT ever leaking the raw text
 * to the customer.
 *
 * The model is asked to return a `{ answer, confidence, … }` JSON object, but
 * it occasionally emits invalid JSON — most commonly unescaped double-quotes
 * inside the `answer` string (e.g. `"answer": "…by "session timing" — …"`),
 * which makes `JSON.parse` throw. The old fallback then dumped the entire raw
 * envelope (```json fences and all) into the chat bubble. This function never
 * does that:
 *
 *   1. Strip any markdown code fences, then try a straight JSON.parse.
 *   2. On failure, salvage each field with a field-anchored regex. The answer
 *      is captured as everything between `"answer":"` and the next known key
 *      (`","confidence"`), so unescaped inner quotes don't break it.
 *   3. If even the answer can't be salvaged, return a safe generic reply —
 *      never the raw model output.
 */
function parseAiEnvelope(raw: string): ParsedEnvelope {
  // Drop ```json … ``` fences the model sometimes wraps the object in.
  const text = raw.replace(/```(?:json)?/gi, '').trim();

  // Fast path: valid JSON.
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as ParsedEnvelope;
    } catch {
      /* fall through to salvage */
    }
  }

  // Salvage path — anchored extraction that tolerates unescaped quotes.
  const out: ParsedEnvelope = {};

  // answer: capture up to the next top-level key so inner quotes are fine.
  const answerMatch =
    text.match(/"answer"\s*:\s*"([\s\S]*?)"\s*,\s*"confidence"/) ||
    text.match(/"answer"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (answerMatch) {
    out.answer = answerMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\')
      .trim();
  }

  const conf = text.match(/"confidence"\s*:\s*([0-9]*\.?[0-9]+)/);
  if (conf) out.confidence = Number(conf[1]);

  const nh = text.match(/"needs_human"\s*:\s*(true|false)/);
  if (nh) out.needs_human = nh[1] === 'true';

  const topic = text.match(/"topic"\s*:\s*"([^"]+)"/);
  if (topic) out.topic = topic[1];

  const sentiment = text.match(/"sentiment"\s*:\s*"([^"]+)"/);
  if (sentiment) out.sentiment = sentiment[1];

  const language = text.match(/"language"\s*:\s*"([^"]+)"/);
  if (language) out.language = language[1];

  const reason = text.match(/"escalation_reason"\s*:\s*"([^"]+)"/);
  if (reason) out.escalation_reason = reason[1];

  // Last resort: no answer field at all. If the raw text is short and clearly
  // NOT a JSON dump (no braces), use it as-is — the model may have replied in
  // plain prose. Otherwise return a safe generic message; never show JSON.
  if (!out.answer) {
    const looksLikeJson = /[{}]|"answer"|"confidence"/.test(text);
    out.answer = !looksLikeJson && text.length > 0 && text.length < 600
      ? text
      : "I'm sorry, I didn't quite catch that — could you rephrase what you need help with?";
    out.confidence = out.confidence ?? 0.4;
  }

  return out;
}

export type ExtractedContact = {
  /** Customer email address, if mentioned in this message or a prior one. */
  email?: string;
  /** Customer name, if given. */
  name?: string;
  /** Order ID / reference number, if quoted. */
  orderId?: string;
};

/** Sentiment of the customer's most recent turn — powers dashboard rollups. */
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'frustrated' | 'angry';

export type AIAnswer = {
  answer: string;
  confidence: number;
  shouldEscalate: boolean;
  escalationReason?: string;
  /** Fields the AI parsed out of the customer's message(s), to save on the contact. */
  extracted?: ExtractedContact;
  /** Short topic label the AI infers ("shipping", "refund", "sizing"…). Powers analytics. */
  topic?: string;
  /** Detected sentiment of the customer's current message. */
  sentiment?: Sentiment;
  /** BCP-47 language tag the AI detected in the customer's message (e.g. 'en', 'es-MX'). */
  language?: string;
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
    '- Detect the language the customer wrote in and REPLY IN THAT SAME LANGUAGE. If they switch mid-conversation, follow their switch. Never switch back to English silently.',
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
    'CRITICAL JSON RULE: inside the "answer" string value, never use raw double-quote characters — use single quotes for any quoted phrase (e.g. write \'session timing\', not "session timing"). Any double-quote inside a value must be escaped as \\". Emit valid JSON only — no markdown code fences, no ```json wrapper.',
    '{',
    '  "answer": "<what to say to the customer, 2-5 sentences, may contain [label](URL) markdown links to KB articles>",',
    '  "confidence": <0.0-1.0>,',
    '  "needs_human": <true if a human should take over, else false>,',
    '  "escalation_reason": <short string when needs_human is true, else null>,',
    '  "topic": <one lowercase phrase categorizing the customer\'s intent: "shipping" / "returns" / "refund" / "sizing" / "account" / "pricing" / "tech-issue" / "complaint" / "general" — pick the closest>,',
    '  "sentiment": <one of: "positive" | "neutral" | "negative" | "frustrated" | "angry" — how the CUSTOMER is feeling in their latest message>,',
    '  "language": <BCP-47 language tag detected in the customer\'s latest message (e.g. "en", "es", "hi", "pt-BR")>,',
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
  const parsed = parseAiEnvelope(text);

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

  const allowedSentiments: Sentiment[] = ['positive', 'neutral', 'negative', 'frustrated', 'angry'];
  const rawSentiment = (parsed.sentiment ?? '').toString().toLowerCase().trim();
  const sentiment: Sentiment | undefined = (allowedSentiments as string[]).includes(rawSentiment)
    ? (rawSentiment as Sentiment)
    : undefined;
  const rawLang = (parsed.language ?? '').toString().trim();
  // BCP-47 is a bit forgiving: allow [a-z]{2,3} optionally followed by '-XX'.
  const language = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(rawLang) ? rawLang : undefined;

  return {
    answer: parsed.answer ?? "I'm not sure yet — could you share a bit more about what you're trying to do?",
    confidence,
    shouldEscalate,
    escalationReason: shouldEscalate ? (parsed.escalation_reason ?? 'Needs human review') : undefined,
    extracted: Object.keys(extracted).length ? extracted : undefined,
    topic: parsed.topic?.toString().slice(0, 40),
    sentiment,
    language,
    sources: chunks.slice(0, 3).map(c => ({
      documentId: c.documentId,
      title: c.title,
      url: c.url ?? undefined,
      excerpt: c.content.slice(0, 200),
      similarity: c.similarity,
    })),
  };
}

/**
 * Draft a suggested reply for an agent, grounded in the conversation history
 * and (optionally) KB excerpts. This is fired when the agent opens a
 * conversation and clicks "Suggest reply" — the draft goes into their reply
 * box, they can edit before sending. Distinct from `generateAnswer` because:
 *   • Persona is "agent's assistant", not "customer's agent" — first person,
 *     ready-to-send, no "as an AI…" framing.
 *   • No JSON envelope, no confidence gating — just a string.
 *   • Never escalates; the human is already here.
 */
export async function draftAgentReply(
  turns: ChatTurn[],
  chunks: SearchResult[],
  settings?: { brandName?: string; agentName?: string },
): Promise<string> {
  const brand = settings?.brandName ?? 'the team';
  const agent = settings?.agentName ?? 'the agent';

  const context = chunks.length
    ? chunks
        .map((c, i) => {
          const header = c.url ? `[${i + 1}] ${c.title} — ${c.url}` : `[${i + 1}] ${c.title}`;
          return `${header}\n${c.content.slice(0, 700)}`;
        })
        .join('\n\n---\n\n')
    : '(No knowledge-base articles matched.)';

  const transcript = turns
    .slice(-14)
    .map((t) => `${t.role === 'user' ? 'Customer' : 'Us'}: ${t.content}`)
    .join('\n');

  const system = [
    `You are drafting a reply for ${agent}, a support agent at ${brand}, to send to a customer.`,
    'Write the reply directly — no "here is a suggested reply" preamble, no signature, no "let me know if you have questions" filler.',
    'Reply in the SAME LANGUAGE the customer used most recently.',
    'Ground factual claims in the knowledge-base excerpts. Cite articles as inline markdown links like [label](URL) when a URL is provided.',
    'Match a warm, human, competent tone. 2–5 sentences. Never invent facts, prices, dates, or policies.',
    'If the customer asked a question you cannot answer from the excerpts, write a reply that (a) acknowledges what they need, (b) asks the one clarifying question that would let you help, or (c) explains what info you\'ll gather next.',
    'Return the reply text ONLY — no JSON, no quotes around it, no explanation.',
  ].join('\n');

  const userContent = [
    'Knowledge base excerpts:',
    context,
    '',
    'Conversation so far:',
    transcript || '(no prior messages)',
    '',
    'Write the reply.',
  ].join('\n\n');

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  return text.trim();
}
