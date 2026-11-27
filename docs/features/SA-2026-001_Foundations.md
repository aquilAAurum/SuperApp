# Feature Name: Foundations (M1)

- **Feature ID:** SA-2026-001
- **Version:** 1.0   · **Status:** Proposal   · **Date:** 2026-11-21
- **Owner(s):** Qz   · **T-Shirt Size:** M
- **RICE:** R:1 | I:3 | C:90% | E:0.5 = 5.4

## 1. Executive Summary
### 1.1 Problem
Every later milestone needs one contract, one server schema and executable gates; without them subapps, shell and server drift.
### 1.2 Solution
pnpm monorepo; `packages/contracts` (bridge API v1); PocketBase core migrations; version + idempotency hooks; CI for every Hardening Baseline gate.
### 1.3 Business Value & KPIs
Enables KPI 2 (zero lost/duplicated writes) and KPI 3 (every rejection attributable).
### 1.4 Hypothesis
If the server enforces `baseVersion` and `opId` itself, the M3 outbox can retry freely without ever duplicating data.
### 1.5 Competitive Landscape
N/A (personal system).

## 2. Functional Specification
### 2.1 User Stories (acceptance criteria from spec M1)
- As the owner, I can rebuild the server from the repo: **migrations apply on a clean data dir** → CI "PocketBase integration" › "apply on a clean data dir and record schema version 1".
- As the sync worker, I can resend an op safely: **same `opId` twice → one record** → unit `server/tests/unit/ops.test.ts` and integration `server.test.ts`.
- As a developer, **`pnpm test` passes** → CI "checks" job.
### 2.2 MVP (MoSCoW)
Must: contracts, core collections, ops route, version hook, CI. Should: retention cron. Won't (M1): Tailscale setup automation (manual runbook).
### 2.3 Out of Scope
Shell data mirror and outbox (M3).

## 3. UI/UX
No UI.

## 4. Technical & Architectural Overview
### 4.1 Integration — PocketBase JSVM hooks (`server/pb_hooks`), migrations (`server/pb_migrations`).
### 4.2 Architecture & Data Flow — `POST /api/sa/ops {opId, collection, recordId, op, payload, baseVersion}` → transaction: ledger lookup → synced-collection check → ownership → version check → apply → ledger insert (unique `opId`).
### 4.3 Key Considerations — synced collections are identified by fields (`version`, `deleted`, `owner`, `origin_device`), so app collections created later qualify automatically.
### 4.4 API Contract & Data Model — `server/pb_migrations/1763740800_core_collections.js`; `server/pb_hooks/lib/ops.js`.
### 4.5 Instrumentation — PocketBase request logs; ops rejections logged as `sa.ops.rejected`.

## 5. Security & Privacy
### 5.1 New attack surface — ops route; collection API rules. ### 5.2 Data inventory delta — `processed_ops`. ### 5.3 HB-IDs — HB-QUAL-01..05, HB-SEC-01, HB-SUP-01..05. ### 5.4 Threat model — `THREAT_MODEL.md` T-10, T-11, T-12.

## 6. Non-Functional Requirements
Ops route answers in < 100 ms on the mini PC for single-record ops.

## 7. RAID Log
| Type | Item | Owner |
| :-- | :-- | :-- |
| Risk | JSVM API details (goja) differ from Node; logic is unit-tested in Node and the adapter only in CI integration | Kumi Wai |
| Risk | Validation failures inside the transaction are reported as 400; verify PocketBase error shapes in the integration run | Jules |
| Dependency | PocketBase v0.34.2 pinned by SHA-256 | Theo |

## 8. Release & Operations
### 8.1 Rollout & rollback — `tools/deploy-server.ps1` after a PocketBase backup; rollback = restore backup + previous release's server bundle. ### 8.2 Observability — `/api/health`. ### 8.3 Docs — `docs/runbook.md`.

## 9. Post-Launch
### 9.1 Success evaluation — M3 airplane-mode test produces zero duplicates. ### 9.2 Sunset/pivot — n/a. ### 9.3 Known issues — none.

## 10. Governance
### 10.1 Sign-off — Qz, Jane, Mara, Russ, Theo, Nick.
### 10.2 Definition of Done — §2.1 criteria green in CI with run links in the PR.

## Appendix: Change Log
- 1.0 (2026-11-21): initial.
