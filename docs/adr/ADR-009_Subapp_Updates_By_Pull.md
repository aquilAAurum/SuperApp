---
id: ADR-009
title: Subapp updates by pull from a published/ folder in git, through the mini PC
status: Proposed
date: 2026-11-28
decided_by: nick
supersedes: []
---

# ADR-009: Subapp updates by pull

## 1. Context

Subapps shipped only inside the APK (`--builtin`), so every subapp edit meant a new APK. Supra's point is lightweight subapps inside a stable wrapper. Subapps are developed by Claude in cloud sessions, which can commit to git but cannot reach the phone or the mini PC. Nick asked for a pull model (2026-11-28). The spec already describes the target (§Packaging and install, §Hot updates; M5 App manager), and the server has had a `subapps` collection since M1.

## 2. Decision

| # | Decision | Rationale |
| :-- | :-- | :-- |
| 1 | Claude publishes a built subapp with `pnpm publish:subapp <id>` into **`published/<id>/`** (deterministic zip, SHA-256, manifest), commits it and opens a PR. Versions are immutable and must increase; the newest two are kept. | Git is the one place a cloud session can write; the PR diff shows code and manifest (scope) changes before anything ships. |
| 2 | **Nick merging to `main` is the release.** The mini PC pulls `main` fast-forward only every 15 minutes (`tools/sync-subapps.ps1 -Register`) and copies `published/` into `<PocketBase dir>\subapps_inbox`. | Keeps "Nick merges" as the gate; no inbound connection to the mini PC; no credentials beyond the existing checkout. |
| 3 | A server hook imports new inbox bundles into `subapps` every minute (names, semver, hash format, manifest id/version checked; never overwrites). Clients cannot write the collection; the `bundle` file is **protected** (file token required). | Server stays the single source of truth; the phone talks only to its own server (SA-C5, SA-C6). |
| 4 | The shell pulls on launch/resume (at most every 6 h), every 6 h while open, and on *Settings → Check for updates*. It installs a version only if it beats both the installed and the builtin copy, after verifying the zip's **SHA-256** and that the zip's own `app.json` is a valid manifest with the record's id and version. Bundles are stored in the encrypted local database and served via `srcdoc` like builtins (same sandbox and CSP). | Integrity is enforced on the device; updates work offline once installed; no new isolation surface. |
| 5 | An update applies the next time its app starts. A server version that crashes twice within 60 s of its first run is rolled back (to the previous server version, else the builtin) and never offered again; a newer version is. | Spec §Hot updates; the builtin is always a safe fallback. |

Out of scope: shell, bridge and native changes (still an APK), server migrations/hooks (still `deploy-server.ps1`), and consent prompts for scopes added by an update (M4; until then scope changes are reviewed in the PR).

## 3. Consequences

- Publishing a subapp change = bump version, `pnpm publish:subapp <id>`, PR, merge. Phone has it within ~15 min of the merge plus the next check (or immediately with *Check for updates*).
- Trust root is `main` + the mini PC checkout; anyone who can merge to `main` can ship code into the sandbox. Mitigated by branch protection and the fact that subapps stay sandboxed with `connect-src 'none'`.
- Tests: `apps/shell/src/host/updates.test.ts`, `tools/published.test.mjs`, Step 0 "published/ subapp bundles are intact", server integration "published subapps", E2E `updates.spec.ts` (update, tampered hash rejected, rollback).
