# Project Profile: Super app

**Profile version:** 0.1.0   ·   **Core version:** v4 (reimagined-bassoon @ `85cb6b4`, [ADR-001](docs/adr/ADR-001_Adopt_Core_v4.md))   ·   **Owner:** Qz (content), Nick (approval)

Everything product-specific lives here; Core personas read these values. A Profile may add or tighten Core rules but never relax one without an ADR approved by Nick. Product source: *Super app — Android phone shell product spec* (Nov 21, 2026), committed verbatim as [`docs/spec.md`](docs/spec.md).

## 1. Product

| Field | Value |
| :--- | :--- |
| **Product** | A personal Android "super app": one sideloaded shell APK that hosts, launches and connects small web subapps, backed by a self-hosted PocketBase server on a Windows 11 mini PC that is the single source of truth. Single owner. |
| **Brand promise** | **One door, no surprises.** Every app behind one login; nothing lost, nothing hidden: sync state and errors are always visible. |
| **Magic moment** | From tapping the shell icon to using any subapp, signed in, in under 2 seconds, with no extra login. |
| **Primary input model** | **Touch** (phone). Every focusable element is a real button/link with a visible focus state so the same UI works with D-pad (Google TV) later. No hover-only UI. |
| **Feature ID prefix** | `SA-YYYY-NNN` (0xx platform/foundations, 1xx shell, 2xx data & sync, 3xx device & permissions, 4xx bus & devices, 5xx integrations, 9xx ADRs/papers) |
| **KPIs** | (1) Subapp handshake < 500 ms on the phone (M2). (2) Zero lost or duplicated writes in the airplane-mode test (M3). (3) 100 % of rejected bridge calls logged with app id, method, code, timestamp. (4) No integration secret ever present on the phone (M6). |

## 2. Platform & Architecture Constraints

| ID | Constraint | Source |
| :--- | :--- | :--- |
| SA-C1 | Shell is **Capacitor (Android)**, TypeScript + Vite + **Svelte 5**; minSdk 26, targetSdk current; Kotlin for custom plugins. Shell logic stays in shared TypeScript; native code only in plugins. | Spec §Tech stack; [ADR-002](docs/adr/ADR-002_Shell_UI_Svelte.md) |
| SA-C2 | **Every native call goes through `apps/shell/src/native/CapabilityBroker.ts`; every server call through `apps/shell/src/server/`.** Enforced by ESLint `no-restricted-imports`. | Spec implementation note 2 |
| SA-C3 | **Subapps run in sandboxed iframes** (`sandbox="allow-scripts allow-forms"`, never `allow-same-origin`) built via `srcdoc` with a shell-injected nonce CSP containing `connect-src 'none'`. Subapps import only `@superapp/sdk`. | Spec §Security; [ADR-003](docs/adr/ADR-003_Subapp_Isolation_Srcdoc_CSP.md) |
| SA-C4 | **Bridge API** is versioned in `packages/contracts` (envelope v1, API 1.0). Contract first → SDK → shell handler. Minor = additive; major keeps the previous adapter for ≥ 1 release. | Spec §Bridge API |
| SA-C5 | **Server is truth.** PocketBase (pinned version, `tools/pocketbase-ci.sh`) holds canonical data; the phone holds a cache + outbox only. Synced collections are written only through `POST /api/sa/ops` (baseVersion + opId idempotency). | Spec §Data layer, §Sync |
| SA-C6 | Network: server reachable only via Tailscale/LAN; the phone uses **Tailscale Serve HTTPS**. The APK has cleartext disabled; LAN `http://` addresses are dev/browser only. | Spec §Security; [ADR-003](docs/adr/ADR-003_Subapp_Isolation_Srcdoc_CSP.md) §Consequences |
| SA-C7 | **Device-agnostic contracts:** no API assumes a phone; form factor and capabilities come from `sys.capabilities` and `core_devices`. `car` and `background` manifest blocks stay null/empty in v1. | Spec §Scope |
| SA-C8 | Android permissions: **declare only v1 permissions, each with its feature** (Step 0 checks the manifest against an allow-list). | Spec §Permissions rules |

## 3. UX Constraints

| ID | Constraint |
| :--- | :--- |
| SA-U1 | Design tokens live in `apps/shell/src/styles/tokens.css` (token set **v1.0.0**), light/dark/system. Breaking changes need Jane's sign-off. |
| SA-U2 | Feedback goes through the **Toast** component in an `aria-live` region; `alert/confirm/prompt` are lint errors. |
| SA-U3 | **Fail visibly:** sync status (`Synced`, `Pending (n)`, `Offline`, `Error`) is always in the launcher header; every subapp error is attributed to an app id in Diagnostics. |
| SA-U4 | Android Back always closes the topmost surface (running app → launcher). |
| SA-U5 | Motion ≤ 0.2 s (`--motion-duration`); `prefers-reduced-motion` honoured. |

## 4. Sources of Truth (CORE-06)

| Domain | Source of truth |
| :--- | :--- |
| Product requirements | [`docs/spec.md`](docs/spec.md) (Nov 21, 2026 spec, verbatim) and `docs/features/` |
| Bridge API contract | `packages/contracts/src/methods.ts`, `envelope.ts`, `manifest.ts`, `errors.ts` |
| Data model | `server/pb_migrations/` (schema v1 = `schema_info.version` 1) |
| Server write path | `server/pb_hooks/lib/ops.js` (+ `ops.pb.js` route) |
| Client sync | `apps/shell/src/sync/` (store, data service, worker, resolve, engine) |
| Architecture decisions | `docs/adr/` |

## 5. Data Inventory (HB-DATA-01; Priya)

| Data | Purpose | Where | Retention | Protection |
| :--- | :--- | :--- | :--- | :--- |
| Owner email, name, password hash | Sign-in | PocketBase `users` (mini PC) | Account lifetime | PocketBase bcrypt; server reachable only on tailnet/LAN; backups encrypted off-box (runbook) |
| Server auth token, device id | Silent sign-in, device identity | Phone: Android Keystore-backed secure storage | Until sign-out | Keystore; `allowBackup=false`; never logged (redacted) |
| Server URL, theme, safe-mode flag | Settings | Phone: Capacitor Preferences | Until changed | Non-sensitive |
| Device record (name, model-derived name, capabilities, lastSeen) | Device registry for cross-device bus | PocketBase `core_devices` | Until removed | Owner-only API rules |
| Shell logs, bridge inspector, rejected-call log | Diagnostics | Phone memory (ring buffers, 500–1000 entries) | Session | Secrets/URLs redacted (`logger.ts`); export to `diagnostics` arrives in M5 |
| People, files, tags, settings, notifications, messages, app collections (synced) | Shared core and app data | PocketBase (canonical) + phone mirror and outbox (M3) | Soft delete → hard delete after 30 days; outbox rows removed when confirmed | Owner-only reads; writes only via ops route; phone copy in **SQLCipher-encrypted SQLite** with a Keystore-held key (ADR-004) |
| Integration tokens (Home Assistant, Jellyfin, Anthropic) | Server-side proxies | PocketBase `core_integrations.secret` (hidden field, null API rules) | Until rotated | **Never sent to the phone** (integration test asserts it) |
| Contacts, location (M4) | Subapp features with consent | Phone + mini PC only | Per feature | Consent per app; logged access |

## 6. Environments

| Environment | Purpose | Status |
| :--- | :--- | :--- |
| Developer workstation | `pnpm dev` (shell in browser), subapps standalone via SDK dev mock | Active |
| CI (GitHub Actions, ubuntu-24.04) | Required checks, debug APK artifact, PocketBase integration | Active (`.github/workflows/ci.yml`) |
| Mini PC (Windows 11) | PocketBase service (NSSM) behind Tailscale Serve HTTPS; Home Assistant OS VM, Jellyfin | **Manual prerequisite** (runbook §1). Step 0 reports it as MANUAL. |
| Phone (Android, sideloaded) | Production shell | Manual: install APK from Release or CI artifact |

## 7. Required Status Checks on `main` (Kumi Wai specifies → Nick applies in Settings → Branches)

- `CI / Step 0, docs, lint, typecheck, unit, SDK size, audit`
- `CI / E2E + accessibility (Playwright, axe-core)`
- `CI / PocketBase integration (migrations, version + idempotency hooks)`
- `CI / Android debug APK (Writer Deploys)`
- `CI / Dependency review` (PRs)
- `CodeQL / analyze`

## 8. Hardening Status (against Core `core/governance/hardening-baseline.md`)

Status as of Sprint 1. "Wired" = gate exists in CI; "Green in CI" = it has passed on the working branch (run links go in the PR Evidence Bundle).

| HB-ID | Status | Evidence / Note |
| :--- | :--- | :--- |
| HB-QUAL-01 Lint | Wired | `eslint.config.js` (flat, TS + Svelte) |
| HB-QUAL-02 Unit tests | Green in CI | Vitest: contracts, SDK, router, handshake, lifecycle, sandbox, sync, ops logic, packer |
| HB-QUAL-03 Hermetic E2E | Green in CI | `apps/shell/tests/e2e` (PocketBase mocked with `page.route`; ops answered by the real `ops.js`) |
| HB-QUAL-04 Step 0 | Wired | `tools/validate.mjs` |
| HB-QUAL-05 Type checking | Wired | `tsc` / `svelte-check --fail-on-warnings` |
| HB-A11Y-01 axe-core | Wired | E2E scans setup, launcher, diagnostics, settings |
| HB-A11Y-02 Input traversal | Open | Touch-first; D-pad traversal test arrives with the TV shell |
| HB-SEC-01 SAST | Wired (private-repo mode) | `codeql.yml`: CodeQL `security-extended`, SARIF kept as run artifact, `tools/check-sarif.mjs` fails on High/Critical (Nick approved 2026-11-22; no Security-tab upload on a personal private repo) |
| HB-SEC-02 Secret scanning | **Manual (Nick)** | Repo setting |
| HB-SEC-03 Threat model | Done for M1–M3 | `THREAT_MODEL.md` |
| HB-SEC-04 No HTML sinks | Wired | ESLint `no-restricted-syntax`, `svelte/no-at-html-tags` |
| HB-SEC-05 SECURITY.md | Done | `SECURITY.md` |
| HB-SUP-01 Pinned actions | Done | Step 0 checks every `uses:` is a 40-char SHA |
| HB-SUP-02 Lockfile | Done | `pnpm install --frozen-lockfile` |
| HB-SUP-03 Audit | Wired | `pnpm audit --prod --audit-level high` |
| HB-SUP-04 Dependency review | Wired | PR job |
| HB-SUP-05 Dependabot | Done | npm, actions, gradle |
| HB-SUP-06/07 SBOM, provenance | Wired | `release.yml` |
| HB-ELEC-* | N/A | Platform is Capacitor, not Electron. The WebView analogues are SA-C3, SA-C6, Step 0 manifest checks and the shell CSP (THREAT_MODEL T-07). |
| HB-DATA-01 Inventory | Done | §5 |
| HB-DATA-02 Encryption at rest | Done on device (pending D10 check) | Tokens in Keystore; mirror/outbox SQLCipher (ADR-004). Backups encrypted off-box (runbook). |
| HB-DATA-03 No secrets in logs | Wired | `logger.ts` redaction + unit test |
| HB-REL-01 Tag-only builds | Wired | `release.yml` |
| HB-REL-02 Signing | Wired, keystore pending | Secrets in `release` environment (manual) |
| HB-REL-03 Tested rollback | Open | Shell: reinstall previous APK (runbook). Subapp rollback arrives with the App manager (M5). |
| HB-OPS-01 JSON logs | Done | Shell `logger.ts`, tools, deploy script |
| HB-OPS-02/03 SLOs, backup/restore | Open | Runbook drafted (`docs/runbook.md`); restore test is a manual monthly task |
| HB-LEG-01 Licence policy | Wired | dependency-review denies GPL-3/AGPL |
| HB-LEG-02 Privacy notice | N/A | Single-owner, not distributed |
