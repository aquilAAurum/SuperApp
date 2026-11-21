---
id: ADR-004
title: Encrypted local store behind a key/value commit interface; server-wins conflict policy
status: Proposed
date: 2026-11-21
decided_by: nick
supersedes: []
---

# ADR-004: Local store and conflict policy (M3)

## 1. Context

M3 needs a local mirror and a durable outbox whose writes happen in one transaction (spec §Integrity), on Android (SQLite) and in the browser (dev and E2E), plus a definite policy for version conflicts. Profile §8 left HB-DATA-02 (encryption at rest) open for the mirror.

## 2. Decisions

| # | Decision | Rationale |
| :-- | :-- | :-- |
| 1 | The sync logic talks to a tiny `KvBackend` (`get`, `list`, atomic `commit` of many writes) with three implementations: **SQLite** on Android (`SqliteKv`, one `kv` table, `executeSet` in a transaction), **IndexedDB** in the browser, memory in unit tests. | One code path for mirror + outbox semantics; atomicity is the backend's single job; the same tests cover every platform's logic. |
| 2 | The Android database is **SQLCipher-encrypted** (`@capacitor-community/sqlite`, `androidIsEncryption: true`) with a random 256-bit passphrase generated on first run and held by the plugin in Keystore-backed storage. The plugin is imported only in `CapabilityBroker.openDatabase()`. | Closes HB-DATA-02 for synced personal data on the phone; keeps SA-C2. |
| 3 | `baseVersion` is fixed when the op is queued: `confirmedVersion + pending ops for that record`. Each confirmed op bumps the server version by exactly one, so chained offline edits are checked against the right version without waiting. | Lets the outbox drain without a round-trip per edit, and still detects edits made elsewhere. |
| 4 | **Server wins** in the mirror on 409/404; the local change stays on the outbox row (`status: conflict`, server copy kept) and later edits to that record wait behind it. Needs attention offers *Apply mine* (rebase with a **new opId**), *Keep server version*, *Recreate* (deleted on server, new id) and *Retry/Discard* for dead rows. | Spec default; nothing is dropped silently; a rebase is a new operation, so it must not reuse the old idempotency key. |
| 5 | Catch-up (`updated > since`) and realtime records never overwrite a mirror entry that has unconfirmed local changes. | Local edits stay visible until confirmed or conflicted. |
| 6 | Local `data.list` filters support `field = value` / `field != value` joined by `&&`; anything else is `INVALID_PARAMS`, never silently ignored. | Keeps local and server results consistent. |

## 3. Consequences

- Web builds store the mirror unencrypted in IndexedDB and keep the session token in memory only, so a reload needs sign-in. Web is a dev/test target, not a production one.
- The spec's daily integrity check, and the "Edit" action in Needs attention, are deferred to an M3 follow-up (roadmap).
