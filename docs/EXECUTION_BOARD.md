# Homeshare v2 Execution Board

This is the delivery source of truth to complete Homeshare v2 to production readiness.

## Program Rules

- Scope baseline: Base Sepolia staging first, Base mainnet launch second.
- Delivery mode: phase-gated. A phase does not close until all exit criteria are met.
- Priority order: correctness > security > operational safety > UX polish.
- Tracking rule: every work item has a ticket ID and explicit acceptance criteria.

## Phase Plan

| Phase | Goal | Duration | Gate |
| --- | --- | --- | --- |
| 0 | Baseline and scope lock | 1 week | Signed `v1` scope and KPI doc |
| 1 | Contract hardening | 2 weeks | Security-reviewed and test-complete contracts |
| 2 | Backend and data integrity | 2 weeks | Deterministic API + replay-safe indexer |
| 3 | Operator automation | 1-2 weeks | Intent execution lifecycle fully operational |
| 4 | Frontend end-to-end UX | 2 weeks | Full investor and owner critical paths working |
| 5 | Security, access, compliance | 2 weeks | Security checklist + compliance go/no-go |
| 6 | Production platform readiness | 1-2 weeks | CI/CD + observability + recovery drills passed |
| 7 | Testnet beta | 2 weeks | Beta KPIs met and blockers cleared |
| 8 | Mainnet launch + stabilization | Ongoing | 30-day stable run, no Sev-1 |

## Phase 0: Baseline And Scope Lock

### Deliverables
- Canonical architecture and API docs aligned to actual `v1` behavior.
- Launch definition: in-scope features, non-goals, and measurable KPIs.
- Phase backlog approved with dependencies.

### Tickets
- `CE-001` (`docs`) Align `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md` to current `v1` Base-focused implementation.
- `CE-002` (`backend`) Remove/flag legacy route and schema references that conflict with `v1`.
- `CE-003` (`program`) Create KPI baseline sheet: funding volume, claim success rate, API p95 latency, indexer lag, fee revenue.
- `CE-004` (`program`) Create dependency map across contracts/backend/frontend/ops.

### Exit Criteria
- One approved `v1` scope document exists and is signed.
- No documentation contradictions on supported chains or API surface.

## Phase 1: Contract Hardening

### Deliverables
- Complete and audited smart-contract behavior for funding, refunds, token claims, profit distribution, and fee mechanics.
- Test suite covers normal + edge + adversarial paths.

### Tickets
- `CE-101` (`contracts`) Add missing negative-path tests for `PropertyCrowdfund` and `ProfitDistributor`.
- `CE-102` (`contracts`) Add invariant/fuzz-style tests for accounting correctness and rounding.
- `CE-103` (`contracts`) Formalize event schema stability contract (event names/args as API contract).
- `CE-104` (`contracts/security`) External security review prep pack and remediation queue.
- `CE-105` (`contracts`) Freeze release candidate ABIs and deployment metadata.

### Exit Criteria
- All contract tests pass in CI.
- No unresolved High/Critical audit findings.

## Phase 2: Backend And Data Integrity

### Deliverables
- Stable `v1` APIs backed by replay-safe indexed data.
- Clean migration and schema baseline for new environments.

### Tickets
- `CE-201` (`backend/db`) Reconcile migration history and remove schema drift/duplication.
- `CE-202` (`backend/indexer`) Add deterministic replay checks and reorg regression tests.
- `CE-203` (`backend/api`) Enforce consistent cursor/pagination and validation across all `v1` endpoints.
- `CE-204` (`backend/api`) Add integration tests for `/v1/properties`, `/v1/campaigns`, `/v1/me/*`, `/v1/admin/*`.
- `CE-205` (`backend`) Standardize error model and API response contracts.

### Exit Criteria
- Fresh bootstrap from empty DB is successful.
- Re-index from deployment block yields stable results.
- `v1` integration tests pass.

## Phase 3: Operator Automation

### Deliverables
- Safe operational pipeline for intent execution and lifecycle tracking.

### Tickets
- `CE-301` (`backend/ops`) Harden platform-fee intent processor with retry policy and dead-letter semantics.
- `CE-302` (`backend/ops`) Add structured status transitions and timestamps for all intent types.
- `CE-303` (`backend/ops`) Build operator command set and runbooks (execute, retry, inspect, reconcile).
- `CE-304` (`backend/ops`) Add reconciliation job to verify onchain state vs DB intent status.
- `CE-305` (`ops`) Add alerting on failed/stalled intents.

### Exit Criteria
- Intents are traceable from creation to confirmed/failed with remediation path.
- On-call runbook exists and is validated.

## Phase 4: Frontend End-To-End UX

### Deliverables
- Complete investor and owner workflows with reliable transaction feedback.

### Tickets
- `CE-401` (`frontend`) Implement invest flow from property list/detail to signed transaction and confirmation.
- `CE-402` (`frontend`) Implement claim equity tokens and claim profits UX with clear statuses.
- `CE-403` (`frontend`) Implement refunds UX for failed campaigns.
- `CE-404` (`frontend`) Complete owner workflow surfaces for property/profit/platform-fee intents and statuses.
- `CE-405` (`frontend`) Add robust loading/error/empty states and wallet/network guardrails.

### Exit Criteria
- All critical user flows complete on Base Sepolia without manual DB edits.

## Phase 5: Security, Access, Compliance

### Deliverables
- Hardened auth and administrative controls plus legal/compliance readiness path.

### Tickets
- `CE-501` (`backend/security`) Tighten auth/session controls and owner allowlist management.
- `CE-502` (`backend/security`) Add API rate limiting and abuse protections.
- `CE-503` (`security`) Threat model and attack-surface review (wallet auth, operator keys, indexer).
- `CE-504` (`compliance`) Draft jurisdiction and KYC/AML requirements with legal counsel.
- `CE-505` (`docs`) Publish user disclosures/risk statements for fundraising and profit distribution.

### Exit Criteria
- Security checklist signed.
- Compliance go/no-go documented for launch jurisdiction.

## Phase 6: Production Platform Readiness

### Deliverables
- Deployment safety, observability, and incident response readiness.

### Tickets
- `CE-601` (`devops`) Build CI/CD pipelines for contracts/backend/frontend with gated promotions.
- `CE-602` (`devops`) Add monitoring dashboards: API latency/errors, indexer lag, intent failures, chain RPC health.
- `CE-603` (`devops`) Add backup/restore and run DR drill for PostgreSQL.
- `CE-604` (`devops`) Add incident response playbook and rollback procedures.
- `CE-605` (`ops`) Secrets management hardening for operator keys and JWT/database secrets.

### Exit Criteria
- Staging fire-drill + rollback drill completed successfully.

## Phase 7: Testnet Beta

### Deliverables
- Controlled user beta with measured funnel and reliability metrics.

### Tickets
- `CE-701` (`program`) Launch private beta cohort and support workflow.
- `CE-702` (`analytics`) Instrument and track funnel metrics from wallet connect to claim flows.
- `CE-703` (`engineering`) Resolve top beta blockers by severity and impact.
- `CE-704` (`ops`) Validate operator workflows under realistic event volume.

### Exit Criteria
- Beta KPIs met and blocker queue reduced to acceptable launch threshold.

## Phase 8: Mainnet Launch And Stabilization

### Deliverables
- Controlled rollout and 30-day stabilization.

### Tickets
- `CE-801` (`release`) Mainnet rollout with guardrails (caps, staged enablement, rollback toggles).
- `CE-802` (`ops`) Daily launch health review and incident triage.
- `CE-803` (`program`) Weekly KPI and revenue review with next-iteration plan.

### Exit Criteria
- 30-day stability target achieved without Sev-1 incidents.

## Active Queue (Auto Mode: Start Now)

1. `CE-001` Docs alignment and contradiction cleanup.
2. `CE-201` Migration/schema reconciliation plan.
3. `CE-204` `v1` integration test coverage expansion.
4. `CE-301` Platform-fee processor retry/dead-letter hardening.
5. `CE-401` Frontend invest flow implementation.

## Execution Cadence

- Sprint length: 1 week.
- Planning: Monday 30 minutes.
- Checkpoint: daily async update with `done / next / blockers`.
- Release cut: end of each sprint for completed phase subset.
- Incident rule: Sev-1 interrupts sprint and triggers hotfix path.
