-- Grounded: metrics events table
-- Run this against your Postgres database to set up the metrics schema.

CREATE TABLE IF NOT EXISTS metric_events (
  id            UUID PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id    TEXT NOT NULL,
  article_id    TEXT NOT NULL,
  thread_id     TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('thread_started', 'turn_added', 'clear_clicked')),
  payload       JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_metric_events_session ON metric_events (session_id);
CREATE INDEX IF NOT EXISTS idx_metric_events_article ON metric_events (article_id);
CREATE INDEX IF NOT EXISTS idx_metric_events_thread ON metric_events (thread_id);
CREATE INDEX IF NOT EXISTS idx_metric_events_type ON metric_events (event_type);

-- ----------------------------------------------------------------
-- Chat traces: observability for every tutor-mode interaction
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_traces (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id              TEXT NOT NULL,
  article_id              TEXT NOT NULL,
  thread_id               TEXT NOT NULL,
  user_message            TEXT NOT NULL,

  router_need_web         BOOLEAN,
  router_reason           TEXT,
  router_suggested_queries JSONB,

  search_called           BOOLEAN,
  search_queries          JSONB,
  search_sources          JSONB,
  search_error            TEXT,

  answer_text             TEXT NOT NULL,
  citations_present       BOOLEAN,
  answer_char_count       INT,

  latency_router_ms       INT,
  latency_search_ms       INT,
  latency_answer_ms       INT,
  latency_total_ms        INT,
  debug_flow              JSONB
);

ALTER TABLE chat_traces
  ADD COLUMN IF NOT EXISTS debug_flow JSONB;

CREATE INDEX IF NOT EXISTS idx_chat_traces_created ON chat_traces (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_traces_session ON chat_traces (session_id);
CREATE INDEX IF NOT EXISTS idx_chat_traces_article ON chat_traces (article_id);
CREATE INDEX IF NOT EXISTS idx_chat_traces_debug_flow_gin ON chat_traces USING GIN (debug_flow);

-- ----------------------------------------------------------------
-- Synthesis traces: observability for compare-sources runs
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS synthesis_traces (
  id SERIAL PRIMARY KEY,
  article_id TEXT NOT NULL,
  thread_id TEXT,
  status TEXT NOT NULL,
  phases JSONB NOT NULL,
  cost_usd_estimate NUMERIC,
  total_duration_ms INTEGER NOT NULL,
  bias_diversity_warning BOOLEAN DEFAULT false,
  apify_invocations INTEGER DEFAULT 0,
  paywall_count INTEGER DEFAULT 0,
  sources_attempted INTEGER,
  sources_used INTEGER,
  synthesis_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synthesis_traces_created
  ON synthesis_traces(created_at DESC);
