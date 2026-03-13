CREATE TABLE IF NOT EXISTS agent_activities (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  campaign_address TEXT,
  property_id TEXT,
  event_type TEXT NOT NULL,
  raised_usdc NUMERIC,
  target_usdc NUMERIC,
  campaign_state TEXT,
  reasoning TEXT NOT NULL,
  tx_hash TEXT,
  executed BOOLEAN NOT NULL DEFAULT FALSE,
  user_message TEXT,
  severity TEXT NOT NULL DEFAULT 'info'
);

CREATE INDEX IF NOT EXISTS idx_agent_activities_created_at
  ON agent_activities (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_activities_campaign
  ON agent_activities (campaign_address);
