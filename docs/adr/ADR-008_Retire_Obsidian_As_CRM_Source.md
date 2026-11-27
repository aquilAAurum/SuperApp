---
id: ADR-008
title: Retire the Obsidian vault as the CRM source of truth after a one-time migration
status: Accepted
date: 2026-11-27
decided_by: nick
supersedes: []
---

# ADR-008: Retire Obsidian as the CRM source of truth

## 1. Context

The contact network lives in an Obsidian vault on the phone (canonical) with a Google Drive backup. Two options were on the table: keep the vault as the source of truth and write app edits back into notes, or migrate once and make Supra the source of truth (PRD SA-2026-007 E1.2). Nick chose the PRD's flow on 2026-11-27 ("PRD wins"), reversing the earlier write-back answer.

## 2. Decisions

| # | Decision | Rationale |
| :-- | :-- | :-- |
| 1 | The vault is migrated **once**: `import` + dry runs (report, newest-note check) → repeatable `push` (reconcile, restore within 14 days) → **`cutover`**. | Dry runs and repeatable pushes let the data be checked in the app before committing. |
| 2 | `cutover` writes a `cutover` record to `contacts_imports`; afterwards the importer refuses to push (exit code 3, no override flag). | A stale vault copy can never overwrite or delete edits made in Supra. |
| 3 | After cutover the vault is made read-only and archived; contacts are edited only in Supra. Markdown/CSV export (PRD E1.4) keeps the data portable. | One source of truth; no lock-in. |
| 4 | Write-back into notes is not built. Proposed facts from outside (CSV, connectors) go to `contacts_enrichment` and are reviewed in the app. | Removes a sync loop with a phone-only vault that Supra cannot write to safely. |

## 3. Consequences

- The importer lives in `aquilAAurum/Supra---Contacts` (CLI on a PC, against a current vault copy); runbook `docs/runbook-migration.md` there. Spike S5 (picking the vault on the phone) is optional evidence, not a dependency.
- Cutover is Nick's call (PRD R6 lists it; tooling exists now). Until then, the vault remains canonical and the server copy is a mirror.
