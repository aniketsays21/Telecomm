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

/**
 * Retrieve the top-K knowledge-base chunks for a customer question using
 * Postgres full-text search. No embedding provider involved.
 *
 * `plainto_tsquery` handles user-typed queries safely — it strips syntax that
 * would otherwise raise on `!` or `(` etc. `ts_rank_cd` gives us a BM25-like
 * relevance score; we normalize with option `32` (rank / (rank + 1)) so scores
 * live in (0, 1) and are directly comparable to what the old cosine call
 * returned. The rest of the RAG pipeline (prompt shape, sources array in the
 * response) is unchanged.
 *
 * The fallback branch below covers the "the whole query is stopwords" case
 * — `plainto_tsquery('english', 'is it')` returns an empty tsquery which
 * matches nothing. We degrade to `websearch_to_tsquery` on the raw text; if
 * that's also empty we return no rows rather than 500.
 */
export async function searchChunks(
  workspaceId: string,
  query: string,
  limit = 5,
): Promise<SearchResult[]> {
  const q = (query ?? '').trim();
  if (!q) return [];

  const rows = await db.execute(sql`
    WITH q AS (
      SELECT COALESCE(
        NULLIF(plainto_tsquery('english', ${q}), ''::tsquery),
        NULLIF(websearch_to_tsquery('english', ${q}), ''::tsquery)
      ) AS tsq
    )
    SELECT
      c.id          AS "chunkId",
      c.document_id AS "documentId",
      c.content,
      ts_rank_cd(c.tsv, q.tsq, 32) AS similarity,
      d.title,
      d.url
    FROM chunks c
    CROSS JOIN q
    JOIN documents d ON d.id = c.document_id
    WHERE c.workspace_id = ${workspaceId}::uuid
      AND q.tsq IS NOT NULL
      AND c.tsv @@ q.tsq
    ORDER BY similarity DESC
    LIMIT ${limit}
  `);

  return rows as unknown as SearchResult[];
}
