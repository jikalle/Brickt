-- Platform fee intent workflow for campaign-level fee configuration.

CREATE TABLE IF NOT EXISTS platform_fee_intents (
  id UUID PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  campaign_address TEXT NOT NULL,
  platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps >= 0 AND platform_fee_bps <= 2000),
  platform_fee_recipient TEXT,
  created_by_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_fee_intents_campaign_idx
  ON platform_fee_intents(campaign_address);
CREATE INDEX IF NOT EXISTS platform_fee_intents_chain_idx
  ON platform_fee_intents(chain_id);
