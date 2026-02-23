ALTER TABLE chat_traces
  ADD COLUMN IF NOT EXISTS debug_flow JSONB;

CREATE INDEX IF NOT EXISTS idx_chat_traces_created_at_idx
  ON chat_traces(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_traces_debug_flow_gin
  ON chat_traces USING GIN (debug_flow);
