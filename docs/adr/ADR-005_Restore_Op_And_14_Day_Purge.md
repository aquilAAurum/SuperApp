---
id: ADR-005
title: Restore op for soft-deleted records; soft deletes purged after 14 days
status: Accepted
date: 2026-11-27
decided_by: nick
supersedes: []
---

# ADR-005: Restore op and 14-day purge

## 1. Context

Synced collections are soft-deleted through `POST /api/sa/ops` and hard-deleted later by the retention job. Before this ADR, `ops.js` refused to update a soft-deleted record, so nothing could un-delete it: the spec's 30-day window gave no way back. The Supra Contacts importer reconciles the Obsidian vault into `contacts_*` collections with stable ids. A note that is deleted (or renamed) and later restored stayed blocked on the server (Supra Contacts plan, open item O-1). Nick decided: restoring must be possible, it must not be a significant rewrite, and deleted data is purged after 14 days.

## 2. Decisions

| # | Decision | Rationale |
| :-- | :-- | :-- |
| 1 | `op: "restore"` joins `create`/`update`/`delete`. It requires `baseVersion` and an existing soft-deleted record. It sets `deleted = false`, applies the optional `payload` (server-owned fields stripped as usual), bumps `version` and is recorded in `processed_ops` like any op. Restoring a live record → 409 `CONFLICT` ("record is not deleted"); a missing or purged record → 404. | Smallest change that closes the gap: same path, same idempotency, same version check, about 10 lines in `ops.js`. |
| 2 | Soft-deleted records of synced collections are hard-deleted **14 days** after their last update (was 30). `processed_ops` stays at 30 days. | Owner's retention decision. Keeping the idempotency ledger longer than records only makes replays of old ops safer. |
| 3 | After the purge, a record with the same id can simply be created again. | Stable ids (contacts) recover naturally once the window has passed. |

This amends spec §Data layer ("hard deletes … after 30 days") and §Sync (op types). `docs/spec.md` stays verbatim; this ADR is the newer source of truth for those two points.

## 3. Consequences

- The phone outbox (`apps/shell/src/sync`) doesn't emit `restore` yet. ADR-004's *Recreate* action can become *Restore* (same id, history kept) in an M3 follow-up.
- Tests: unit (`server/tests/unit/ops.test.ts`) and PocketBase integration (`server/tests/integration/server.test.ts`) cover restore, stale versions, live records and missing records.
