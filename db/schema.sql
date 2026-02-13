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

-- Index for querying by session
CREATE INDEX IF NOT EXISTS idx_metric_events_session ON metric_events (session_id);

-- Index for querying by article
CREATE INDEX IF NOT EXISTS idx_metric_events_article ON metric_events (article_id);

-- Index for querying by thread
CREATE INDEX IF NOT EXISTS idx_metric_events_thread ON metric_events (thread_id);

-- Index for querying by event type
CREATE INDEX IF NOT EXISTS idx_metric_events_type ON metric_events (event_type);
