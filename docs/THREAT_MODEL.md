# Threat Model

## Scope

This document covers the current `v1` attack surface:

- Wallet authentication (`/v1/auth/*`)
- Admin intent pipeline (`property_intents`, `profit_distribution_intents`, `platform_fee_intents`)
- Operator execution scripts
- Indexer ingestion and API read model
- Frontend transaction flows (invest/claim/refund)

## Assets

- User identities and JWTs
- Owner/admin privileges
- Operator private key
- Intent queues and execution statuses
- Indexer-derived campaign/investment/profit records
- Onchain funds in campaign/distributor contracts

## Trust Boundaries

- Browser <-> Backend API
- Backend <-> RPC provider
- Operator scripts <-> Smart contracts
- Indexer <-> RPC logs/state
- Database <-> API/controllers

## Threats And Controls

### 1) Signature Replay / Message Substitution

Threat:
- Reuse signed login payloads or alter message context.

Controls:
- Nonce issuance with TTL and one-time consumption.
- Message validation enforces `Address`, supported `Chain ID`, and recent `Issued At`.
- Signature verification supports EOAs and EIP-1271 smart wallets.

Residual risk:
- In-memory nonce map is process-local (multi-instance deployments need shared nonce store).

### 2) Privilege Drift (Owner Role Persistence)

Threat:
- Previously allowlisted owner keeps owner role after allowlist removal.

Controls:
- Owner allowlist is evaluated on every login.
- Role is downgraded to `investor` if allowlist no longer permits owner access.

Residual risk:
- Existing unexpired owner JWT remains valid until expiry.
- Mitigation backlog: token revocation/versioning.

### 3) Brute Force / API Abuse

Threat:
- Request flooding on auth/API endpoints.

Controls:
- IP-based rate limiting on `/v1/auth` and `/v1`.
- Configurable windows and thresholds via env.

Residual risk:
- In-memory limiter is per-process; distributed setups need centralized limiter (Redis/API gateway).

### 4) Wrong-Chain Operator Execution

Threat:
- Intent executed/reconciled on a provider connected to a different chain.

Controls:
- Processor and reconciler verify `intent.chain_id` against provider chain.
- Mismatch marks intent failed with explicit error.

Residual risk:
- Requires accurate `chain_id` at intent creation time.

### 5) Operator Key Compromise / Misconfiguration

Threat:
- Leaked key signs malicious transactions.
- Placeholder zero key accidentally used.

Controls:
- Worker refuses zero placeholder private key.
- Runbooks enforce secrets management and monitoring.

Residual risk:
- Key still hot in process memory; hardware-backed signing not yet integrated.

### 6) Intent Pipeline Stalls Or Silent Failures

Threat:
- Failed/submitted intents accumulate unnoticed.

Controls:
- Lifecycle fields (`status`, `attempt_count`, timestamps, errors).
- Retry/dead-letter behavior.
- Reconciliation worker for submitted tx receipts.
- Alert script for failed/stale thresholds.

Residual risk:
- Alerting currently script-driven, not yet integrated with pager.

### 7) Indexer Consistency / Reorg Impact

Threat:
- Chain reorgs or partial ingestion causing incorrect API read model.

Controls:
- Reorg prune range and replay from checkpoint in indexer.
- Idempotent inserts keyed by `tx_hash` + `log_index`.

Residual risk:
- Long reorg/extreme RPC inconsistency can still require manual replay procedures.

## Security Configuration Baseline

- Strong `JWT_SECRET` (minimum enforced in code).
- Rate limiting enabled (`RATE_LIMIT_ENABLED=true`).
- Owner allowlist configured.
- Operator key from secrets manager (not file-committed).
- Dedicated RPC endpoints with monitoring and failover.

## Open Gaps (Next)

1. Shared nonce store for horizontally scaled auth.
2. JWT revocation/versioning for immediate owner-role invalidation.
3. Centralized distributed rate limiting.
4. Secrets manager + key rotation playbook.
5. Pager-integrated alerting for intent/indexer failures.
