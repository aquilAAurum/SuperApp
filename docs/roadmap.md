# Roadmap

Spec milestones (docs/spec.md §Milestones) as Core v4 features. Each milestone ends with a working APK and passes its acceptance criteria before the next starts. Track F for all six (each adds attack surface).

| Milestone | Feature ID | Scope | State | Acceptance evidence |
| :-- | :-- | :-- | :-- | :-- |
| M1 Foundations | [SA-2026-001](features/SA-2026-001_Foundations.md) | Monorepo, contracts, PocketBase core migrations + version/idempotency hooks, CI | `4_INTEGRATION` (PR pending `main`) | CI: `pnpm test`; PocketBase integration job (clean data dir, same opId twice → one record) |
| M2 Shell and bridge | [SA-2026-002](features/SA-2026-002_Shell_And_Bridge.md) | Capacitor shell, sign-in, device registration, launcher, iframe host, handshake, `app`/`sys`, SDK 1.0, `hello` | `4_INTEGRATION` (PR pending `main`) | CI E2E: handshake < 500 ms (browser), forged frame rejected + logged; **on-phone timing pending** (manual, debug APK) |
| M3 Data and sync | [SA-2026-003](features/SA-2026-003_Data_And_Sync.md) | Encrypted mirror, outbox, sync worker, conflicts, Sync centre, `data.*`, realtime + catch-up | `3_BUILD` | Unit + E2E: 100 airplane-mode writes, kill mid-sync, forced conflict. Follow-ups: daily integrity check, Needs-attention *Edit* |
| M4 Permissions and device | SA-2026-004 | Capability broker plugins, consent sheets, Permissions centre, capability map, notifications, share, external launch | Backlog | Undeclared contacts → `SCOPE_DENIED`; revoke ends session; Netflix launches |
| M5 App manager, bus, diagnostics | SA-2026-005 | Bundle install/update/rollback, bus (local + `core_messages`), deep links, inbox, log export | Backlog | Broken update auto-rolls back; A→B bus event; server message < 2 s; export lands |
| M6 Integrations | SA-2026-006 | Home Assistant, Jellyfin, Claude routes + bridge methods; two sample subapps | Backlog | Light toggles; item plays; chat streams; no secret on phone |
| Contacts & CRM (`contacts` subapp) | [SA-2026-007](features/SA-2026-007_Contacts_CRM.md) | Launcher-first contact manager: Work / Professional / Personal networks, identity-aware channel routing, cadence, network navigation, campaigns; replaces the Obsidian CRM (one-time migration, then cutover). Data layer, vault migration and graph view built; Sprints R0–R6 for the app | `1_PRD` (proposal; data layer in `3_BUILD`) | Per PRD §11.5; build starts after M3 merge and M4 launcher |

## Open questions (spec) and their status

| Question | Status |
| :-- | :-- |
| Shell UI framework: React or Svelte? | **Decided: Svelte 5** ([ADR-002](adr/ADR-002_Shell_UI_Svelte.md), accepted by Nick 2026-11-21). |
| Which existing vibe-coded apps migrate first, and what stack? | Open (Qz, before M3 PRD). `docs/subapp-authoring.md` lists what a migration needs. |
| Google Drive API in v1, or the file picker? | Open; spec lists the Drive API as "Later", so M4 plans the SAF picker only. |
| Off-site backup target for the mini PC? | Open (Theo, before `9_OPERATE`); runbook §4 has the procedure with the target left blank. |
| Shell as the Android home screen by default? | Open; the `HOME` intent filter is deliberately not declared yet. |
