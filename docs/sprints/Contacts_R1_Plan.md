# Contacts subapp: Sprint R1 Plan (Core V4 Template)

**Doc ID:** D01   ·   **Project Profile:** `project-profile.md`   ·   **From:** Qz (Product Manager)   ·   **Status:** draft, cut at R1 `0_READY`

**Sprint Goal:** A `contacts` subapp on the phone with list, search, card and edit over the migrated data; networks, contexts and identities; Markdown/CSV export; phone-contacts import.

## 1. Prerequisites
| # | Prerequisite | Status |
| :-- | :-- | :-- |
| P1 | R0 done (D03 + D04 accepted, ADR-007 decided) | ☐ |
| P2 | M4 `device.contacts` (for phone-contacts import only) | ☐ (import can slip to R2 without blocking the rest) |
| P3 | Vault migrated with `push` (cutover optional at R1) | ☐ (Nick) |

## 2. Scope
| Item | Notes |
| :-- | :-- |
| Additive migration: `contacts_contexts`, `contacts_memberships`, `contacts_identities`, `contacts_filters` | Seeded contexts from PRD §2.2/§2.3; identity addresses entered in Settings (not in the repo) |
| `subapps/contacts` scaffold + manifest (`data.own`, `core.people.read`; no `core.people.write`, ADR-006) | Contract-first: no bridge change in R1 |
| Today (read-only), People list, search (< 100 ms on 5k), card, edit, archive/restore | Reuses `contacts_reach_out` |
| Lens + context chips; memberships edit; context suggestions from §2.3 confirmed in a review screen | |
| Graph view tab (reuse Supra---Contacts `src/viewer/`) | |
| Export Markdown/CSV; round-trip test | |
| Phone-contacts import (E1.3) with consent and matching | If M4 lands |

## 3. Definition of Done
PRD §11.5 for R1's epics; D10 import fidelity on a synthetic 500-note vault (`tools/gen-vault.mjs`); required checks green; D08 PASS.
