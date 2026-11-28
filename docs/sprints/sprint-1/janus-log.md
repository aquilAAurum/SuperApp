# Janus log: Sprint 1

> Kept by Claude acting as Janus (workflow manager). State storage per CORE-02 is the `state:*` label on PR #6.

| When (UTC) | Item | Transition / event | Gate evidence | Note |
| :-- | :-- | :-- | :-- | :-- |
| 2026-11-21 18:55 | Sprint 1 | `0_READY` | Step 0 local; D01 committed | Deviation (artifacts written alongside build) approved by Nick 2026-11-21 |
| 2026-11-21 19:20 | SA-2026-001/002 | `3_BUILD` | Local: 120 unit, 10 E2E | Pushed to `ccr-a668c1bb-z0djyy` |
| 2026-11-21 23:47 | SA-2026-001 | **Gate failure** (same state) | CI run 44963469068: PocketBase migration failed (reserved field) | Self-correction loop; eval `2026-11-21_jules_reserved-field-name` |
| 2026-11-21 23:49 | Sprint | **Gate failure** | CodeQL run 44963469046: SARIF upload not permitted | Eval `2026-11-21_kumi-wai_codeql-upload-assumption` |
| 2026-11-21 23:51 | SA-2026-001 | **Gate failure** | CI run 44963758017: integration test assumed hidden fields hidden from superusers | Eval `2026-11-21_jules_superuser-hidden-fields` |
| 2026-11-21 23:55 | SA-2026-003 | Scope change: M3 added to Sprint 1 | Nick: "Approve all decisions. Open PR and continue" | Recorded in D01 §2 |
| 2026-11-21 23:58 | SA-2026-001/002/003 | Checks green | CI run 44964342040 | |
| 2026-11-22 | PR | Blocked: no `main` base | Branch creation blocked by permission check; Nick approved 2026-11-22; `main` created at `deb402b` | Eval `2026-11-21_kumi-wai_missing-main-branch` |
| 2026-11-22 | PR #6 | Opened → `state:4_INTEGRATION` | D07 (green at bfdb2a2) | Head re-run pending |
| 2026-11-22 | SA-2026-001/002/003 | Review findings J-1, J-2 fixed | commit 43075c6 | D08 |
| 2026-11-27 | Mini PC | PocketBase installed with `tools/install-windows.ps1`; Tailscale Serve on | Owner output in session | Installer fixes: corepack on Node 26 (a00722a) |
| 2026-11-28 | Device run | M-2, M-3, M-4 PASS; M-1 1/3 (45 ms) | D10 R-5…R-13 | Findings: status-bar overlap (fixed 5efd3b4), debug key per CI run (fixed 7f1fc2b), Tailscale drop after airplane mode (runbook) |
| next | PR #6 | `5_REVIEW` when head CI green and a second reviewer submits D08 | — | Author cannot approve own PR |
| next | Candidate | `6.5_MRB_HARDENING` blocked | D11 FAIL (evidence incomplete) | Needs M-1, M-2, HB-SEC-02, CodeQL run, release dry-run |
