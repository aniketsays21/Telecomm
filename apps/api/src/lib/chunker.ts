export type Chunk = { content: string; position: number; tokenCount: number };

const CHUNK_WORDS = 350;
const OVERLAP_WORDS = 50;

// Rough token count: ~0.75 tokens per word for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

export function chunkText(text: string): Chunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: Chunk[] = [];
  let pos = 0;

  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + CHUNK_WORDS);
    const content = slice.join(' ');
    if (content.trim()) {
      chunks.push({ content, position: pos++, tokenCount: estimateTokens(content) });
    }
    i += CHUNK_WORDS - OVERLAP_WORDS;
  }

  return chunks;
}
