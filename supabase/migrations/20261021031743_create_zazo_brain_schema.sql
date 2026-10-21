/*
# Zazo Brain — Knowledge Base Schema

1. New Tables
- `conversations`: Each conversation session (title, created_at, updated_at)
- `messages`: Individual messages within a conversation (role: user/assistant, content, metadata)
- `knowledge_entries`: Curated knowledge entries exported in JSONL format (instruction, context, response, tags, source_conversation_id)

2. Security
- Single-tenant app (no auth). All tables use `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)` because data is intentionally shared.
- RLS enabled on all three tables.

3. Notes
- `messages.metadata` stores extracted patterns, coding style notes, and tags as JSONB.
- `knowledge_entries` is the export-ready table for fine-tuning datasets.
- Indexes on foreign keys and frequently-queried columns.
*/

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'New Conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_conversations" ON conversations;
CREATE POLICY "anon_select_conversations" ON conversations FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_conversations" ON conversations;
CREATE POLICY "anon_insert_conversations" ON conversations FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_conversations" ON conversations;
CREATE POLICY "anon_update_conversations" ON conversations FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_conversations" ON conversations;
CREATE POLICY "anon_delete_conversations" ON conversations FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_messages" ON messages;
CREATE POLICY "anon_select_messages" ON messages FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_messages" ON messages;
CREATE POLICY "anon_update_messages" ON messages FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_messages" ON messages;
CREATE POLICY "anon_delete_messages" ON messages FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction text NOT NULL,
  context text NOT NULL DEFAULT '',
  response text NOT NULL,
  tags text[] DEFAULT '{}',
  source_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_knowledge_entries" ON knowledge_entries;
CREATE POLICY "anon_select_knowledge_entries" ON knowledge_entries FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_knowledge_entries" ON knowledge_entries;
CREATE POLICY "anon_insert_knowledge_entries" ON knowledge_entries FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_knowledge_entries" ON knowledge_entries;
CREATE POLICY "anon_update_knowledge_entries" ON knowledge_entries FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_knowledge_entries" ON knowledge_entries;
CREATE POLICY "anon_delete_knowledge_entries" ON knowledge_entries FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_created_at ON knowledge_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_tags ON knowledge_entries USING GIN(tags);
