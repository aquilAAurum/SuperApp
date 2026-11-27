[General Counsel / Legal & Privacy] - [Priya]
[[CONTEXT: core/personas/qz.md, project-profile.md]]
To: MRB, Nick

## Legal & Privacy Review: Contacts subapp, Sprint R0 (Doc ID D18)

> Prepared by Claude acting as Priya. Not legal advice; a structured checklist for a single-owner personal system.

### A. Context
| Field | Value |
| :-- | :-- |
| Project / Profile | `project-profile.md` §5 (Supra Contacts row, added in #7) |
| Artifact under review | PRD SA-2026-007 v0.6; schema `server/pb_migrations/1764201600_contacts.js`; ADR-006/007/008 |
| Evidence | SuperApp #8 (schema + `core_people` mirror); Supra---Contacts `main` (importer, cutover) |

### B. Summary
**Final Status: PASS with conditions** (C-1…C-4 below). Storing contacts on the mini PC was approved by Nick (Q4).

### D. Findings
| ID | Area | Finding | Likelihood | Impact | Mitigation / condition |
| :-- | :-- | :-- | :-- | :-- | :-- |
| P-1 | Third-party personal data | Names, numbers, emails, employers, birthdays and notes about other people, for the owner's personal and professional relationships | — | M | Owner-only rules; encrypted phone mirror (ADR-004); backups encrypted off-box (runbook); soft deletes purged after 14 days (ADR-005). Household/personal use; no sharing or resale |
| P-2 | Work contacts (USCD) | Colleague and vendor data may fall under the employer's data policy | M | M | **C-1:** keep Work data to business contact details and work history already known to the owner; do not import USCD directory exports or mailbox data (PRD §3.3 already excludes Teams/mailbox sync) |
| P-3 | Milford Finance Committee | Public-body role: committee correspondence can be subject to public-records rules; notes about residents are sensitive | M | M | **C-2:** no committee deliberations or resident case notes in contact notes; keep Milford context to contact details and touch dates; confirm the town's records/retention guidance |
| P-4 | Baypath donors / sponsors | Donor status and pledge amounts are confidential to the organisation | M | M | **C-3:** amounts (Sponsors 2027 campaign) stay owner-only, are not exported in shared graph files (`--no-contact-info` + exclude amounts), and follow Baypath's donor-privacy policy if one exists |
| P-5 | FMCG clients | Client confidentiality from consulting work | L | M | Contact details and touch history only; no client deliverables in notes |
| P-6 | LinkedIn | Scraping is against LinkedIn's terms | — | M | PRD §3.3: no scraping; only the owner's own LinkedIn data export (CSV) or manual entry. Proposals from the CSV go to `contacts_enrichment` for review |
| P-7 | Unlinked names (mentions) | Names only, no contact details, deliberately | L | L | Fine as kept; they never become contact records without the owner adding details |
| P-8 | Migration copy | The importer's local SQLite file holds the whole network on the PC during migration | M | M | **C-4:** delete the file after cutover (runbook-migration §4); it is git-ignored |
| P-9 | Outbound messages | The app opens other apps; the user presses Send. No bulk mail, no tracking pixels | — | — | No CAN-SPAM / e-privacy marketing obligations triggered (manual 1:1) |
| P-10 | Licences | Importer dependency `yaml` (ISC); no new runtime dependency in SuperApp for this increment | — | — | OK |

From: Priya
