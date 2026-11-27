# Contacts subapp: Sprint R0 Plan (Core V4 Template)

**Doc ID:** D01   ·   **Project Profile:** `project-profile.md`   ·   **From:** Qz (Product Manager)

**Sprint Goal:** Decide everything the Contacts build depends on: PRD final, design (D03) and threat model (D04) accepted, identity routing settled by on-phone spikes (ADR-007), and a dry run of the real vault producing a report.

---

## 1. Prerequisites & Assumptions

| # | Prerequisite | Verified how | Status |
| :-- | :-- | :-- | :-- |
| P1 | M3 data & sync merged (`main`) | PR #6 merged 2026-11-27 | ☑ |
| P2 | Contacts schema + `core_people` mirror on `main` | PR #8 merged 2026-11-27 | ☑ |
| P3 | Restore op + 14-day purge | PR #7, ADR-005 | ☑ |
| P4 | Nick's phone with Google Voice, Gmail (4 accounts), Outlook (2 accounts), Teams, WhatsApp | Spike harness run | ☐ (Nick) |
| P5 | A current copy of the vault on a PC for the full dry run | runbook-migration §1 | ☐ (Nick) |

## 2. Active Scope

| ID | Item | Repo path | Track | State | Persona |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `SA-2026-007` | PRD v0.6 final, context seed + mapping, open questions | `docs/features/SA-2026-007_Contacts_CRM.md` | F | `1_PRD` → `2_DESIGN` | Qz |
| D03 | Design brief | `contacts-r0/D03_Design_Brief.md` | F | `2_DESIGN` | Anansi |
| D04 | Threat model delta T-20…T-28 | `THREAT_MODEL.md` §C.2 | F | `2.5_THREAT_MODEL` | Mara |
| D18 | Legal & privacy review | `contacts-r0/D18_Legal_Privacy_Review.md` | F | — | Priya |
| S1–S5 | Phone spikes | `spikes/r0-launch/`, `contacts-r0/Spikes.md` | F | `3_BUILD` (throwaway) | Jules |
| D16 | ADR-006 data model (Accepted), ADR-007 identity routing (Proposed), ADR-008 retire Obsidian (Accepted) | `docs/adr/` | F | — | Arthur |
| D17 | Bob, Eleanor memos | `contacts-r0/D17_Board_Memos.md` | — | — | Board |
| D09 | Test plan skeleton | `contacts-r0/D09_Test_Plan.md` | F | — | Russ |

Note: the PRD's R0 numbering said "ADR-005 data model, ADR-006 identity routing, ADR-007 retire Obsidian"; ADR-005 was taken by the restore op, so they are ADR-006/007/008.

## 3. Workflow

Core `core/workflow/state-machine.md` (V4). R0 is paper plus a throwaway spike; no production code. Deviation (recorded): the data layer and migration tooling were built before R0 (SuperApp #8, Supra---Contacts), at Nick's direction; R0 reviews them as-built.

## 4. Definition of Ready (R1)

PRD §11.4: D03 accepted (Jane audit), D04 controls listed for R1 surface (import, lens, identities), D09 mapping exists, M3 merged (☑).

## 5. Definition of Done (R0)

- PRD v0.6 approved by Nick; D03, D04 accepted; D18 conditions acknowledged.
- ADR-007 decided from S1–S4 results (per-identity table in `contacts-r0/Spikes.md`).
- Dry run of the real vault copy produces a report (☑ on a 34-note sample; full copy at P5).
- Janus log updated; D14 notes from Qz, Anansi, Mara, Jules at sprint end.

## 6. Sprint artifacts

[`contacts-r0/`](contacts-r0/README.md)
