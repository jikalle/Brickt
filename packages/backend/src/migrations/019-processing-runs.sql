CREATE TABLE IF NOT EXISTS processing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual', 'cron')),
  processing_mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_created_at ON processing_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_runs_trigger_source ON processing_runs (trigger_source);
