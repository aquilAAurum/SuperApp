---
id: ADR-006
title: Contacts data model, core_people plus app-owned contacts_* collections
status: Accepted
date: 2026-11-27
decided_by: nick
supersedes: []
---

# ADR-006: Contacts data model (`core_people` + `contacts_*`)

## 1. Context

The Contacts subapp (SA-2026-007) needs a relationship graph (people, organisations, my roles/projects/events, typed links) plus CRM state, while other subapps need a shared, simple person record. SuperApp's conventions: app-owned collections carry the app id as prefix; synced collections are written only through `/api/sa/ops`; `core_people` is the shared identity record (spec §Data layer). Nick chose the subapp id `contacts` (2026-11-27), and merged the schema in PR #8.

## 2. Decisions

| # | Decision | Rationale |
| :-- | :-- | :-- |
| 1 | The relationship graph lives in app-owned **`contacts_*`** collections: `entities` (every note and unresolved link as a graph node), typed details (`people`, `organizations`, `nodes`), `edges` (every link with relation, origin, section, context note), `contact_points`, `key_dates`, `interactions`, `mentions`, `enrichment`, `imports`, and SQL views `contacts_reach_out`, `contacts_backlinks`. | Graph queries are joins on one node table; typed queries keep checks and relations. Matches the vault's structure, so migration is lossless. |
| 2 | **`core_people` is a projection**: a server hook keeps one `core_people` record per `contacts_people` record (same id) with display name, phones (E.164, type `phone`/`gvoice`/`whatsapp`) and emails, following delete and restore. | Other subapps read contacts through `core.people.read` without knowing the Contacts model; one writer, no sync conflicts between the two. |
| 3 | The PRD's logical collections map onto these (PRD §4.4.0). New CRM state (contexts, memberships, identities, campaigns, templates, filters, lists) arrives as **additive** `contacts_*` migrations in R1–R5. | No rename or data migration later; ids stay stable. |
| 4 | Ids are deterministic 15-character ids derived from the note title (migration) or generated on the device (new records), valid PocketBase ids. | Repeatable migration pushes, and records created in the app follow the existing M3 conventions. |

## 3. Consequences

- `core_people` must not be edited by the Contacts subapp directly; it edits `contacts_*` and the hook updates `core_people`. Other subapps that write `core_people` would be overwritten for contact-owned ids: documented in the PRD; enforced in R1 by giving the Contacts subapp `core.people.read` only.
- Tests: `server/tests/unit/contacts-core.test.ts` (projection), `server/tests/integration/server.test.ts` (mirror through delete/restore, views, owner-only).
