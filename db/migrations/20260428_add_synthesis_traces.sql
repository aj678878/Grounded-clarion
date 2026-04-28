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
