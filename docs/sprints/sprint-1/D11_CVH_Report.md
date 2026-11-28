[Milestone Review Board] - [Fortify Team]
[[CONTEXT: core/governance/mrb-charter.md, project-profile.md]]
To: Janus → Nick

## Commercial Viability & Hardening Report: M1–M3 candidate (Doc ID D11)
**Status: FAIL (not ready for `7_CEO_REVIEW`)**   ·   **Candidate SHA:** PR #6 head (last fully green `bfdb2a2`)

> Assembled by Claude acting as the five MRB roles. FAIL here means "evidence incomplete", not "defects found": no Critical/High finding is open, but several controls required at ≤ 6.5 have no evidence yet.

| Section | Owner | Status | Evidence |
| :-- | :-- | :-- | :-- |
| Security / Red Team | Mara | Partial | Threat model T-01…T-19 each mapped to a test; red-team E2E (forged handshake, sandbox escape probes) green. CodeQL results from the new Advanced setup not yet seen. Secret scanning not enabled. |
| Non-functional QA & a11y | Russ | Partial | D10: automated PASS; device run M-2/M-3/M-4 PASS, M-1 1 of 3 readings (45 ms); no endurance test yet (shell is not long-running server software, 48 h test not applicable) |
| Legal / Privacy / Licence | Priya | PASS with notes | D18 |
| Commercial viability | Qz | PASS | Personal system: cost = mini PC power + Tailscale free tier; no per-user cost. Go-to-market: n/a (sideloaded, single owner) |
| Operational readiness | Theo | Partial | Runbook draft (`docs/runbook.md`); no release dry-run (no tag yet); backup/restore not tested; signing keystore not configured |

### Hardening Baseline status (controls Required at ≤ 6.5)
| HB-ID | Status | Evidence / Exception |
| :-- | :-- | :-- |
| HB-QUAL-01/02/03/04 | PASS | CI run 44964342040 |
| HB-QUAL-05 | PASS | typecheck step |
| HB-A11Y-01 | PASS | axe in E2E |
| HB-A11Y-02 | N/A | Touch-first; D-pad test with TV shell |
| HB-SEC-01 | **Pending** | CodeQL Advanced first run |
| HB-SEC-02 | **FAIL** | Repo setting not confirmed (Nick) |
| HB-SEC-03 | PASS | `THREAT_MODEL.md` |
| HB-SEC-04 | PASS | ESLint sink rules |
| HB-SEC-05 | PASS | `SECURITY.md` |
| HB-SUP-01…04 | PASS | Step 0, lockfile, audit, dependency review on PR |
| HB-SUP-05 | PASS | `.github/dependabot.yml` |
| HB-DATA-01 | PASS | Profile §5 |
| HB-DATA-02 | PASS | M-2 on device 2026-11-28: database header is ciphertext (D10 R-6) |
| HB-DATA-03 | PASS | logger redaction tests |
| HB-LEG-01 | PASS | dependency-review licence policy; D18 |
| HB-LEG-02 | N/A | Not distributed |

**To reach PASS:** finish M-1 (two more readings, Russ), confirm HB-SEC-02 and the first CodeQL Advanced run (Nick/Mara), and a release dry-run with rollback (Theo). Each is listed in D13 next steps.

From: MRB (Mara, Russ, Priya, Qz, Theo)
