-- Switch retrieval from pgvector cosine to Postgres full-text search (BM25-ish
-- via ts_rank_cd). Adds a stored tsvector column populated from chunks.content
-- and a GIN index for fast lookup. The legacy `embedding` column stays in
-- place so old data isn't dropped; the code just stops reading and writing it.

ALTER TABLE "chunks"
  ADD COLUMN IF NOT EXISTS "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_tsv_idx" ON "chunks" USING gin ("tsv");
