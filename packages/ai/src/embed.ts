const VOYAGE_MODEL = 'voyage-2'; // 1024 dimensions
const DIMS = 1024;

// Deterministic pseudo-embedding for dev environments where api.voyageai.com
// is not reachable. Uses a seeded hash to produce a stable 1024-dim unit vector
// so similarity search returns consistent (though semantically meaningless) results.
// Never used in production (VOYAGE_API_KEY must be set and reachable).
function devEmbedding(text: string): number[] {
  const vec = new Array<number>(DIMS).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[(text.charCodeAt(i) * 2654435761 + i * 40503) % DIMS] += 1;
    vec[(text.charCodeAt(i) * 40503 + i) % DIMS] -= 0.5;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

async function callVoyage(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY not set');

  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: inputType }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage AI ${res.status}: ${body}`);
    }

    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(d => d.embedding);
  } catch (err) {
    // In dev, fall back to deterministic pseudo-embeddings when Voyage is unreachable
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[embed] Voyage unreachable, using dev embeddings: ${(err as Error).message}`);
      return texts.map(devEmbedding);
    }
    throw err;
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  // Voyage allows up to 128 texts per call; batch by 32 to stay safe
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    const embeddings = await callVoyage(batch, 'document');
    results.push(...embeddings);
  }
  return results;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [[embedding]] = await Promise.all([callVoyage([text], 'query')]);
  return embedding;
}
