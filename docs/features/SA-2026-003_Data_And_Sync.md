# Feature Name: Data and sync (M3)

- **Feature ID:** SA-2026-003
- **Version:** 1.0   · **Status:** Proposal   · **Date:** 2026-11-21
- **Owner(s):** Qz   · **T-Shirt Size:** L
- **RICE:** R:1 | I:3 | C:85% | E:1 = 2.6

## 1. Executive Summary
### 1.1 Problem
Subapps need shared data that keeps working on bad connectivity, never loses or duplicates a write, and shows what is pending.
### 1.2 Solution
`data.*` bridge methods over an encrypted local mirror and a durable outbox; a sync worker that drains it through `/api/sa/ops`; a Sync centre that shows status and resolves failures.
### 1.3 Business Value & KPIs
KPI 2 (zero lost or duplicated writes); brand promise "no surprises" (header always shows Synced / Pending (n) / Offline / Error).
### 1.4 Hypothesis
Fixing `baseVersion` at enqueue plus opId idempotency makes the outbox safe to retry at any time.
### 1.5 Competitive Landscape
Offline-first sync engines (e.g. CRDT stores); we choose server-wins with review because the server is truth (spec principle).

## 2. Functional Specification
### 2.1 Acceptance criteria (spec M3) → tests
| Criterion | Test |
| :-- | :-- |
| 100 writes made in airplane mode all reach the server after reconnect with no duplicates | unit `sync.test.ts`; e2e `sync.spec.ts` "100 writes made in airplane mode…" |
| Killing the app mid-sync loses nothing | unit "killing the shell mid-sync…"; e2e "killing the app mid-sync loses nothing and duplicates nothing" (reload while a slow server is applying ops) |
| A forced version conflict appears in Needs attention | unit conflict cases; e2e "a forced version conflict appears in Needs attention and can be resolved" |
| Failure table (offline, 5xx backoff → dead after 10, 400 dead, 401 pause + refresh, 409/404 conflict, schema mismatch pause) | unit `sync.test.ts`, `engine.test.ts` |
| Subscribers get local results immediately, then server updates | unit `engine.test.ts`; SDK `data.subscribe` test |
### 2.2 MVP (MoSCoW)
Must: all of §2.1, Sync centre (status, outbox, Needs attention with Retry / Discard / Keep server / Apply mine / Recreate). Should: realtime while foreground. Could (follow-up): daily integrity check, *Edit* in Needs attention.
### 2.3 Out of Scope
Files upload path (M4), cross-device bus (M5).

## 3. UI/UX
### 3.1 User Flow — header status → Sync centre → Needs attention item → action → toast.
### 3.2 Input Model Contract — header status is a real button (opens Sync centre); actions are buttons in DOM order: Status → Sync now → each Needs-attention item (details, primary action, secondary) → Waiting list.
### 3.3 Accessibility — axe on Sync centre (e2e).
### 3.4 Feedback Plan — toasts for actions; subapps get `data.sync_failed` to show their own message.

## 4. Technical & Architectural Overview
See ADR-004 and `apps/shell/src/sync/`. Server: `server/pb_hooks/lib/ops.js`; `hello_notes` migration as the reference app collection.

## 5. Security & Privacy
`THREAT_MODEL.md` T-15…T-19. Data inventory: Profile §5 (encrypted mirror). HB-DATA-02.

## 6. Non-Functional Requirements
100 queued ops drain in < 20 s against the mocked server (e2e budget); max 4 records in parallel.

## 7. RAID Log
| Type | Item | Owner |
| :-- | :-- | :-- |
| Risk | SQLCipher path verified only by the Android build in CI, not yet on a device | Russ (D10) |
| Issue | Web builds need sign-in after reload (token in memory by design) | Qz |
| Deferred | Daily integrity check; Needs-attention *Edit* | Jules |

## 8. Release & Operations
Rollback: reinstall previous APK; the outbox format is versioned by `meta` keys and stays readable.

## 9. Post-Launch
Success: zero items in Needs attention caused by the shell itself over two weeks of use.

## 10. Governance
Sign-off: Qz, Jane, Mara, Russ, Theo, Nick. DoD: §2.1 green in CI with run links.

## Appendix: Change Log
- 1.0 (2026-11-21): initial.
