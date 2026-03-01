# Compliance Readiness Pack

> Not legal advice. This document is an engineering and operations readiness framework to support legal counsel review.

## Objective

Define the minimum compliance controls and launch decisions required before production fundraising and profit distribution.

## Scope

- Product surface: property fundraising, tokenized equity claims, USDC profit claims, platform-fee collection.
- Environments: Base Sepolia staging and Base mainnet production.
- Actors: investors, owners/operators, platform administrators.

## Jurisdiction Baseline (Decision Required)

Before launch, designate:

1. Primary launch jurisdiction(s).
2. Excluded jurisdiction(s).
3. Investor eligibility model:
   - retail allowed
   - accredited/professional only
4. Entity model:
   - licensed entity
   - exempt model
   - partner-led model

Record these decisions in a signed legal memo before enabling production deposits.

## KYC/AML Control Requirements

Minimum controls required for go-live:

1. Customer identification workflow (KYC provider or approved manual process).
2. Screening workflow:
   - sanctions
   - politically exposed persons (PEP)
   - adverse media
3. Risk scoring policy and escalation path.
4. Ongoing monitoring cadence for active users.
5. Suspicious activity handling and reporting process.
6. Case/audit trail retention policy.

## Product Compliance Requirements

1. Investor disclosures must be presented before funding:
   - loss risk
   - illiquidity
   - no guaranteed returns
   - regulatory/jurisdiction restrictions
2. Terms of use and privacy policy must be versioned and accepted.
3. Campaign metadata must map to legal documentation references.
4. Owner onboarding must include beneficial owner and source-of-funds checks.
5. Profit distribution flow must have accounting reconciliation against offchain records.

## Operational Compliance Controls

1. Access governance:
   - owner allowlist management process
   - maker-checker approval for allowlist changes
2. Key management:
   - operator key stored in secrets manager
   - key rotation schedule
3. Incident and breach response:
   - legal/compliance notification owner
   - escalation SLA
4. Record retention:
   - API/auth logs
   - intent lifecycle logs
   - onchain tx reconciliation logs

## Data And Privacy Controls

1. Data minimization by default.
2. Storage encryption at rest and in transit.
3. Least-privilege DB and operational access.
4. PII handling policy and deletion/retention timeline.
5. Vendor DPA/processor agreements for KYC and infrastructure providers.

## Go/No-Go Checklist

Launch only if all are true:

- [ ] Jurisdiction and investor-eligibility memo signed by counsel.
- [ ] KYC/AML provider integrated and tested in staging.
- [ ] Mandatory disclosure copy approved by legal.
- [ ] Terms/privacy published and acceptance tracked.
- [ ] Owner onboarding controls and SOP approved.
- [ ] Compliance incident response owner assigned and on-call.
- [ ] Record-retention and audit-log policy approved.
- [ ] Production secrets management and key-rotation policy active.

## Ownership Matrix

| Area | Primary Owner | Backup Owner |
| --- | --- | --- |
| Jurisdiction/legal memo | Legal counsel | Head of Compliance |
| KYC/AML operations | Compliance Lead | Operations Lead |
| Platform access governance | Security Lead | Backend Lead |
| Key management | Security Lead | DevOps Lead |
| Investor disclosures | Product Lead | Legal counsel |
| Incident reporting | Compliance Lead | Engineering Manager |

## Evidence Artifacts

Keep these artifacts in a controlled internal location:

1. Signed legal memo (jurisdiction + eligibility).
2. KYC/AML vendor configuration and test evidence.
3. Disclosure and terms approval records.
4. Access/key-management SOP and rotation logs.
5. Incident simulation records.
6. Launch go/no-go signoff sheet.

## Pre-Mainnet Exit Criteria (CE-504)

1. This checklist is completed and signed.
2. Compliance owners are assigned and acknowledged.
3. Legal counsel issues explicit go/no-go recommendation for launch jurisdiction.
