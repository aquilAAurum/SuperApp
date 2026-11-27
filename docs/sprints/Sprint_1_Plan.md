# Super app: Sprint 1 Plan (Core V4 Template)

**Doc ID:** D01   ·   **Project Profile:** `project-profile.md`   ·   **From:** Qz (Product Manager)

**Sprint Goal:** Ship M1 (Foundations) and M2 (Shell and bridge): a sideloadable debug APK whose `hello` subapp completes a verified handshake, with every gate running in CI.

---

## 1. Prerequisites & Assumptions

| # | Prerequisite | Verified how | Status |
| :-- | :-- | :-- | :-- |
| P1 | Step 0 validation green | CI run: _link on PR_ | ☐ |
| P2 | Mini PC: PocketBase service behind Tailscale Serve HTTPS | Manual, `docs/runbook.md` §1 | ☐ (Nick) |
| P3 | Repo settings: branch protection + required checks (Profile §7), secret scanning + push protection | Manual (Nick) | ☐ |
| P4 | `release` environment with `SUPERAPP_KEYSTORE_*` secrets (names only) | Manual (Nick/Theo) | ☐ (needed for first tag only) |
| D1 | PocketBase v0.34.2 release asset reachable from CI (SHA-256 pinned in `tools/pocketbase-ci.sh`) | CI job "PocketBase integration" | ☐ |

## 2. Active Scope

| ID | Feature / User Story | PRD (repo path) | Track | State | Current persona |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `SA-2026-001` | M1 Foundations | `docs/features/SA-2026-001_Foundations.md` | F | `3_BUILD` | Jules |
| `SA-2026-002` | M2 Shell and bridge | `docs/features/SA-2026-002_Shell_And_Bridge.md` | F | `3_BUILD` | Jules |
| `SA-2026-003` | M3 Data and sync (**added 2026-11-21**, Nick: "Approve all decisions. Open PR and continue") | `docs/features/SA-2026-003_Data_And_Sync.md` | F | `3_BUILD` | Jules |

Deferred (logged): biometric unlock (spec §Identity, optional) → M4 with the capability broker; notification inbox and deep-link router → M5; App manager, Permissions centre and Sync centre screens → M3–M5 with their data.

## 3. Workflow

Follows Core `core/workflow/state-machine.md` (V4) without modification. Sprint-specific deviations (approved by Nick, 2026-11-21):

- `1_PRD`, `2_DESIGN` and `2.5_THREAT_MODEL` artifacts for both features were produced together with the build in one pass (feature docs, `THREAT_MODEL.md`) because the spec already fixes requirements and design. Janus validates them at `5_REVIEW` instead of before `3_BUILD`.

## 4. Definition of Ready

- Feature docs, threat model (D04) and Test Plan mapping (feature docs §10.2) committed.

## 5. Definition of Done (sprint)

- **Functionality:** M1 and M2 acceptance criteria pass (feature docs §2.1), including the on-phone handshake timing read from Diagnostics on the debug APK.
- **Quality:** all required checks green on the PR; D08 (Jane) and D10 (Russ) PASS.
- **Hardening:** no open Critical/High findings; Profile §8 updated with run links.
- **Docs:** ADR-001…003 accepted by Nick (2026-11-21).
- **Learning:** D14 filed by each delivery persona; rejected outputs logged in `docs/evals/`.

## 6. Sprint artifacts

All persona artifacts, the Janus log and the sprint review are in [`sprint-1/`](sprint-1/README.md).
