import Anthropic from '@anthropic-ai/sdk';

export type SearchResult = {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
  title: string;
  url: string | null;
};

const client = new Anthropic();

export type AIAnswer = {
  answer: string;
  confidence: number;
  shouldEscalate: boolean;
  escalationReason?: string;
  sources: Array<{
    documentId: string;
    title: string;
    url?: string;
    excerpt: string;
    similarity: number;
  }>;
};

const THRESHOLDS = { cautious: 0.85, balanced: 0.70, confident: 0.55 } as const;

export async function generateAnswer(
  question: string,
  chunks: SearchResult[],
  settings?: { botName?: string; escalationThreshold?: string },
): Promise<AIAnswer> {
  const threshold = THRESHOLDS[(settings?.escalationThreshold as keyof typeof THRESHOLDS) ?? 'balanced'] ?? 0.70;
  const botName = settings?.botName ?? 'Assistant';

  if (chunks.length === 0) {
    return {
      answer: "I don't have enough information to answer that. Let me connect you with a human agent.",
      confidence: 0,
      shouldEscalate: true,
      escalationReason: 'No relevant knowledge base content found',
      sources: [],
    };
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] Source: ${c.title}\n${c.content.slice(0, 600)}`)
    .join('\n\n---\n\n');

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `You are ${botName}, a helpful customer support AI. Answer ONLY using the provided knowledge base context. If the context doesn't cover the question well, say so.

Knowledge base context:
${context}

Customer question: ${question}

Respond with JSON only:
{"answer":"<2-3 sentence answer>","confidence":<0.0-1.0>,"escalation_reason":"<if confidence < 0.7, why you're unsure, else null>"}`,
    }],
  });

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';

  let parsed: { answer?: string; confidence?: number; escalation_reason?: string | null } = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m?.[0] ?? '{}');
  } catch {
    parsed = { answer: text.slice(0, 500), confidence: 0.4 };
  }

  const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.4));
  const shouldEscalate = confidence < threshold;

  return {
    answer: parsed.answer ?? "I'm not sure. Let me connect you with a human agent.",
    confidence,
    shouldEscalate,
    escalationReason: shouldEscalate ? (parsed.escalation_reason ?? 'Low confidence') : undefined,
    sources: chunks.slice(0, 3).map(c => ({
      documentId: c.documentId,
      title: c.title,
      url: c.url ?? undefined,
      excerpt: c.content.slice(0, 200),
      similarity: c.similarity,
    })),
  };
}
