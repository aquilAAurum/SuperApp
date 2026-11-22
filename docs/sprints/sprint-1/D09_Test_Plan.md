[QA Lead / Test Strategist] - [Russ]
[[CONTEXT: core/personas/jules.md, project-profile.md]]
To: Jules, Janus

## Test Plan: Sprint 1 — SA-2026-001, -002, -003 (Doc ID D09)

> Prepared by Claude acting as Russ. Gate: every PRD acceptance criterion and every High threat maps to an automated test or a named manual check.

### A. Context
| Field | Value |
| :-- | :-- |
| Project / Profile | `project-profile.md` |
| Sprint | 1 |
| Artifact under review | PR #6 (`ccr-a668c1bb-z0djyy`) |
| Evidence | CI workflow `ci.yml` jobs; Playwright report artifact `e2e-evidence` |

### B. Summary
**Coverage status:** every criterion and High threat below is mapped. Two criteria are **manual on device** (no Android device in CI).

### D. Test Cases

#### Acceptance criteria
| ID | Criterion | Level | Test |
| :-- | :-- | :-- | :-- |
| AC-1.1 | Migrations apply on a clean data dir | Integration (real PocketBase) | `server/tests/integration/server.test.ts` › migrations |
| AC-1.2 | Same opId twice → one record | Unit + integration | `server/tests/unit/ops.test.ts` "same opId twice"; integration "same opId twice → one record" |
| AC-1.3 | `pnpm test` passes | CI | job "Step 0, docs, lint, typecheck, unit, SDK size, audit" |
| AC-2.1 | Sign in once; device registered in `core_devices` | E2E | `shell.spec.ts` "signs in once and registers this device" |
| AC-2.2 | `hello` handshake < 500 ms **on the phone** | E2E (browser) + **MANUAL M-1** | `shell.spec.ts` "handshake in under 500 ms"; M-1 below |
| AC-2.3 | Forged message from another frame rejected and logged | Unit + E2E | `handshake.test.ts`; `shell.spec.ts` "forged hello…" |
| AC-3.1 | 100 airplane-mode writes reach the server, no duplicates | Unit + E2E | `sync.test.ts`; `sync.spec.ts` "100 writes made in airplane mode…" |
| AC-3.2 | Killing the app mid-sync loses nothing | Unit + E2E | `sync.test.ts` "killing the shell mid-sync"; `sync.spec.ts` "killing the app mid-sync…" |
| AC-3.3 | Forced version conflict appears in Needs attention | Unit + E2E | `sync.test.ts` conflict cases; `sync.spec.ts` "a forced version conflict…" |
| AC-3.4 | Encrypted local database on Android | **MANUAL M-2** | M-2 below |

#### High threats (THREAT_MODEL.md)
| Threat | Test |
| :-- | :-- |
| T-01 forged handshake | AC-2.3 tests |
| T-03 undeclared scope | `router.test.ts` SCOPE_DENIED cases; e2e "undeclared scopes are denied and logged" |
| T-05 subapp exfiltration | e2e "cannot reach the network, the shell DOM, storage or cookies"; `sandbox.test.ts` |
| T-07 shell XSS | ESLint sink rules (CI lint); CodeQL `security-extended` |
| T-10 direct writes / server-owned fields | integration "synced collections cannot be written directly"; unit "clients cannot set server-owned fields" |
| T-15 cross-app data writes | `router.test.ts`; integration "app collections are synced" |
| T-17 silent overwrite | AC-3.3 tests |
| T-18 crash mid-sync | AC-3.2 tests |

#### Non-functional
| Area | Test |
| :-- | :-- |
| WCAG 2.1 AA | axe in `shell.spec.ts` (setup, launcher, diagnostics, settings) and `sync.spec.ts` (Sync centre) |
| Resource lifecycle (CORE-15) | `lifecycle.test.ts` (timeout destroy, LRU ≤ 3, destroyAll); e2e "app.close destroys the iframe" |
| Degraded operation (CORE-17) | AC-3.1 (offline writes, status `Offline`) |
| SDK size | CI "SDK size budget" |

#### Manual checks (device: owner's Android phone, debug APK from CI artifact `superapp-debug-apk`)
| ID | Steps | Pass when |
| :-- | :-- | :-- |
| M-1 | Install APK, set up against the mini PC, open Hello, then Launcher → Diagnostics → Apps | Handshake column < 500 ms on three cold launches |
| M-2 | After syncing some notes: `adb shell run-as dev.superapp.shell ls databases/`, pull `superappSQLite.db`, try `sqlite3 … .tables` | File exists and is not readable as plain SQLite ("file is not a database") |
| M-3 | Toggle airplane mode, add 5 notes in Hello, re-enable network | Header goes `Offline` → `Pending (5)` → `Synced`; notes on server |
| M-4 | Android Back from a running app; from Sync centre | Returns to launcher each time |

From: Russ
