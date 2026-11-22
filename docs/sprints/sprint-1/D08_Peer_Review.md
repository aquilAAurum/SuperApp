[Peer Review / Architecture Auditor] - [Jane]
[[CONTEXT: core/personas/jules.md, project-profile.md]]
To: Jules, Janus

## Peer Review Report: PR #6 (Doc ID D08)

> Prepared by Claude acting as Jane, reviewing code Claude also wrote. That is a real independence gap: Core expects this as a GitHub PR review by a different reviewer, and a PR author cannot approve their own PR. Treat this as a self-review checklist until a second reviewer (human or another agent session) submits the D08 review on the PR.

### A. Context
| Field | Value |
| :-- | :-- |
| Project / Profile | `project-profile.md`, Core `spec-core.md` |
| Sprint | 1 |
| Artifact under review | PR #6 @ `8a1ebf9` |
| Evidence | CI run on bfdb2a2: https://github.com/aquilAAurum/SuperApp/actions/runs/44964342040 |

### B. Summary
**Final Status: PASS with follow-ups.** No BLOCKER. Two findings fixed during review (`43075c6`), five Minor findings open as follow-ups.
**Issues found:** 7

### C. Learning & Preference Signal
| Field | Value |
| :-- | :-- |
| Human_Preference_Rating | Pending Nick |
| Eval case | — |

### D. Findings
| ID | Component | Standard | Expected | Actual | Severity | Evidence / Status |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| J-1 | `server/pb_hooks/ops.pb.js` | Spec §Failure handling | Transient server errors retry (5xx) | Every thrown error answered 400 → outbox dead-letters transient failures | Major | **Fixed** `43075c6`: explicit `txApp.validate` → 400; anything thrown → 500. Integration test "rejects invalid records with 400" re-verifies on the next CI run |
| J-2 | `ServerClient.listSince` | Spec §Read path | No missed updates | `updated > since` skips records updated in the same millisecond | Minor | **Fixed** `43075c6` (`>=`; mirror dedupes by version) |
| J-3 | `Shell.signOut` | CORE-16 | Sign-out leaves no readable personal data for another account | Mirror and outbox persist across sign-out; pending writes would sync under the next account | Minor (single-owner system) | Open → follow-up: clear or re-key store on owner change |
| J-4 | `SyncEngine.notify` | NFR | O(1) per write | `refreshStatus()` lists the whole outbox on every local change (100 writes → 100 scans) | Minor | Open → debounce status refresh |
| J-5 | `shell.ts` | Maintainability | Composition root stays small | ~320 lines mixing bridge, lifecycle and sync wiring | Minor | Open → extract `sync` wiring before M4 |
| J-6 | `Shell.signOut` | CORE-15 | Every resource has a destroy path | Realtime subscriptions are not unsubscribed on sign-out | Minor | Open |
| J-7 | `bridge/handshake.ts` | CORE-11 | Port bound to the right document | `welcome` posted with `'*'` (opaque origin) | Info | Accepted residual risk, THREAT_MODEL §E |

Checked and conforming: contract-first order (contracts → SDK → handlers); native plugins only in `CapabilityBroker.ts` and PocketBase only in `src/server/` (ESLint, verified with a deliberately violating file); no HTML sinks; tokens only; every rejected call logged with app id, method, code and timestamp (`router.test.ts`).

From: Jane
