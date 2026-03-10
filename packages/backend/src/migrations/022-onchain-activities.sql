CREATE TABLE IF NOT EXISTS onchain_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  activity_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'confirmed', 'indexed', 'failed')),
  actor_role TEXT CHECK (actor_role IN ('owner', 'investor', 'worker')),
  actor_address TEXT,
  property_id TEXT,
  campaign_address TEXT,
  intent_type TEXT CHECK (intent_type IN ('property', 'profit', 'platformFee')),
  intent_id UUID,
  block_number BIGINT,
  log_index INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onchain_activities_actor_idx
  ON onchain_activities(actor_address, created_at DESC);

CREATE INDEX IF NOT EXISTS onchain_activities_status_idx
  ON onchain_activities(status, created_at DESC);

CREATE INDEX IF NOT EXISTS onchain_activities_property_idx
  ON onchain_activities(property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS onchain_activities_campaign_idx
  ON onchain_activities(campaign_address, created_at DESC);

CREATE INDEX IF NOT EXISTS onchain_activities_intent_idx
  ON onchain_activities(intent_type, intent_id);
