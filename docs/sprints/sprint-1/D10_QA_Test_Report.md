[QA Lead / Test Strategist] - [Russ]
[[CONTEXT: core/personas/janus.md, project-profile.md]]
To: Janus

## QA Test Report: Sprint 1 (Doc ID D10)

> Prepared by Claude acting as Russ, from CI results and, since 2026-11-28, the owner's device run (screenshots and `adb` output shared in the session).

### A. Context
| Field | Value |
| :-- | :-- |
| Project / Profile | `project-profile.md` |
| Sprint | 1 |
| Artifact under review | PR #6; last fully green CI at `bfdb2a2` |
| Evidence | https://github.com/aquilAAurum/SuperApp/actions/runs/44964342040 (all four CI jobs green) |

### B. Summary
**Final Status: BLOCKER** for the release gate (`6.5`), now only on M-1's two remaining handshake readings. Device run 2026-11-28 on the owner's Android phone (WebView 158, Tailscale to the mini PC): M-2, M-3 and M-4 PASS, isolation and scope denial PASS, first handshake 45 ms. All automated cases PASS.
**Issues found:** 0 open automated failures. 7 defects were found by tests during the sprint and fixed (see `docs/evals/`).

### C. Learning & Preference Signal
| Field | Value |
| :-- | :-- |
| Human_Preference_Rating | Pending Nick |
| Eval case | `docs/evals/2026-11-21_*` (7 cases) |

### D. Findings / Test Cases
| ID | Component | Standard | Expected | Actual | Severity | Evidence |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| R-1 | Unit (15 files, 148 tests) | HB-QUAL-02 | all pass | pass | — | CI job "Step 0, docs, lint…" on bfdb2a2 (147 at that SHA; +1 at 43075c6 locally) |
| R-2 | E2E (14 tests incl. axe) | HB-QUAL-03, HB-A11Y-01 | all pass, 0 axe violations | pass | — | CI job "E2E + accessibility" |
| R-3 | PocketBase integration (9 tests) | AC-1.1, AC-1.2, T-10, T-12 | all pass on real PocketBase 0.34.2 | pass (after 2 fixes) | — | CI job "PocketBase integration" |
| R-4 | Android build | Writer Deploys | debug APK produced | produced | — | artifact `superapp-debug-apk` |
| R-5 | AC-2.2 on device | KPI 1 | < 500 ms on 3 cold launches | **45 ms** on the first reading; 2 more pending | Critical | M-1, Diagnostics → Apps (owner screenshot 2026-11-28) |
| R-6 | AC-3.4 on device | HB-DATA-02 | DB unreadable without key | **PASS**: first 16 bytes `81 ac 92 46 12 ea 6c e0 b6 62 e5 b2 2c 22 7f 21` (plain SQLite would start `SQLite format 3`) | Critical | M-2, `adb shell run-as … head -c 16 … \| od` |
| R-8 | Offline sync on device | AC-3.1 | Offline writes survive and sync on reconnect | **PASS**: 105 notes written in airplane mode (5 + 100), 1 edit; outbox 105 → 0 after reconnect, nothing in Needs attention. Server count of 105 to be confirmed in the admin UI | Critical | M-3 (owner screenshots 2026-11-28) |
| R-9 | Back navigation on device | SA-U4 | Back returns to launcher | **PASS** | High | M-4 (owner report) |
| R-10 | Sandbox on Android WebView 158 | T-05 | network, parent DOM, storage, cookies blocked | **PASS**: all four blocked | Critical | Hello isolation check on device |
| R-11 | Scope denial on device | T-03, KPI 3 | `SCOPE_DENIED`, logged with app, method, code, time | **PASS** | High | Diagnostics error log on device |
| R-12 | Recovery after airplane mode | CORE-17 | Sync resumes when connectivity returns | **Finding**: Android dropped the Tailscale VPN after airplane mode; the shell correctly kept all writes and showed "Server unreachable", and drained once Tailscale reconnected. The message does not tell the owner to check Tailscale. | Medium | Follow-up: runbook §2 "Always-on VPN"; Sync centre hint |
| R-13 | Edge-to-edge layout | SA-U1 | Content clear of system bars | Fixed in 5efd3b4 (header drew under the status bar on Android 15+); verified on device | Medium | owner screenshots | CORE-22 | n/a until TV shell | not applicable | Low | Profile §8 |

From: Russ
