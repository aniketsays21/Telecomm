import { db } from '@telecomm/db';
import { sql } from 'drizzle-orm';

export type SearchResult = {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
  title: string;
  url: string | null;
};

export async function searchChunks(
  workspaceId: string,
  queryEmbedding: number[],
  limit = 5,
): Promise<SearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  const rows = await db.execute(sql`
    SELECT
      c.id          AS "chunkId",
      c.document_id AS "documentId",
      c.content,
      1 - (c.embedding <=> ${embeddingStr}::vector) AS similarity,
      d.title,
      d.url
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.workspace_id = ${workspaceId}::uuid
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);

  return rows as unknown as SearchResult[];
}
