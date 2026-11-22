[General Counsel / Legal & Privacy] - [Priya]
[[CONTEXT: core/personas/qz.md, project-profile.md]]
To: MRB, Nick

## Legal & Privacy Review: Sprint 1 (Doc ID D18)

> Prepared by Claude acting as Priya. Not legal advice; a structured checklist for a single-owner personal system.

### A. Context
| Field | Value |
| :-- | :-- |
| Project / Profile | `project-profile.md` §5 data inventory |
| Artifact under review | PR #6; production dependency licences (`pnpm licenses list --prod`, 2026-11-22) |

### B. Summary
**Final Status: PASS with notes.** No copyleft obligation is triggered; personal data stays on owner-controlled devices.

### D. Findings
| ID | Area | Finding | Likelihood | Impact | Mitigation |
| :-- | :-- | :-- | :-- | :-- | :-- |
| P-1 | Licences | 59 production packages: MIT 49, Apache-2.0 4, ISC 2, BSD-3-Clause 1, 0BSD 1, MIT AND Zlib 1 (`pako`), MIT OR GPL-3.0-or-later 1 (`jszip`, via `jeep-sqlite`, the SQLite plugin's browser fallback) | — | Low | Elect **MIT** for `jszip`. CI dependency-review denies GPL-3/AGPL for new deps. |
| P-2 | Third-party services | PocketBase (MIT), Tailscale (service terms), Jellyfin (GPL server, used over its API only, no linking), Home Assistant (Apache-2.0), Anthropic API (commercial terms; M6) | L | M | M6 must record Anthropic usage terms and the per-app budget before shipping `ai.chat` |
| P-3 | Personal data | Owner account, device record, synced personal records, later contacts and location | L | H | Stored only on the mini PC and phone; encrypted on phone (ADR-004); backups encrypted before leaving the mini PC (runbook §4) |
| P-4 | Contacts / location (M4) | Third parties' personal data (contacts) enters the system | M | M | Consent per app; data stays on owner devices; add retention to Profile §5 with M4 |
| P-5 | Claude prompts (M6) | Subapp-chosen data leaves the owner's infrastructure to Anthropic | M | M | Spec already limits prompts to the app's own scopes; add a visible "sent to Claude" indicator in M6 |
| P-6 | Privacy notice | Not distributed | — | — | HB-LEG-02 N/A |

From: Priya
