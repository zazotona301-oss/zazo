-- Track how a training record entered Zazo and whether it still needs review.
ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS source_name text;

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_metadata
  ON knowledge_entries USING GIN (metadata);

-- Text-only thoughts may be ingested before an assistant answer is curated.
ALTER TABLE knowledge_entries
  ALTER COLUMN response DROP NOT NULL;

ALTER TABLE knowledge_entries
  ALTER COLUMN response SET DEFAULT '';
