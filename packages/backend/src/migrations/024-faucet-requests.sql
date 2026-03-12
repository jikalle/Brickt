CREATE TABLE IF NOT EXISTS faucet_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL,
  wallet_address TEXT NOT NULL,
  token TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  transaction_hash TEXT,
  provider_request_id TEXT,
  error_message TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS faucet_requests_wallet_token_requested_at_idx
  ON faucet_requests (wallet_address, token, requested_at DESC);

CREATE INDEX IF NOT EXISTS faucet_requests_ip_token_requested_at_idx
  ON faucet_requests (ip_address, token, requested_at DESC);
