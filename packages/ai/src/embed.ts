const VOYAGE_MODEL = 'voyage-2'; // 1024 dimensions

async function callVoyage(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY not set');

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
