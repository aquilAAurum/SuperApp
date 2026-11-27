<!-- Versioned copy of the product spec supplied by Nick on 2026-11-21. Source of truth for requirements (CORE-06). Change via PR + ADR. -->

# Super app — Android phone shell product spec

Nov 21, 2026 · @Nick Holmes

## Overview

Build a personal Android "super app": one shell APK that hosts, launches and connects many small web-based subapps, backed by a self-hosted server on a Windows 11 mini PC that is the single source of truth.

**Goals**

1. One front door on the phone for every vibe-coded app, with one login.
2. A shared core data layer so apps reuse the same people, files, tags and settings.
3. Safe app-to-app communication through a versioned bridge API and message bus.
4. Robust behaviour under bad connectivity: no lost writes, visible sync state, clear recovery.
5. Access to native Android capabilities, granted per subapp.
6. A design that extends to Google TV, Android Auto and desktop without rework.

**Non-goals (v1)**

- Publishing on Google Play (the APK is sideloaded).
- Replacing the system dialer, SMS app or browser.
- Multi-user or multi-tenant support; this is a single-owner system.
- Hosting third-party web apps with bridge access.

**Guiding principles**

- **The shell is a platform, not a feature.** If only one app needs it, it lives in that app.
- **The server is truth.** The phone holds a cache and an outbox, never the canonical copy.
- **Subapps never touch the network, database or device directly.** Everything goes through the bridge.
- **Data changes go through the store; intents go through the bus.**
- **Fail visibly.** Every error is logged, attributed to an app id, and surfaced in the shell.
- **Device-agnostic contracts.** No API assumes a phone; capabilities are discovered, not assumed.

## Scope

v1 ships the Android phone shell, the subapp SDK and the server core; every contract is written so TV, Auto and desktop shells can be added later without changing subapps.

| Area | v1 (phone) | Later | What v1 must keep open |
| --- | --- | --- | --- |
| Shell | Capacitor Android APK | Google TV APK, desktop/web shell | Shell logic in shared TypeScript; native code isolated in plugins |
| Subapps | Hosted in sandboxed iframes | Same bundles on TV/desktop | `formFactors` in manifest; layout mode passed in handshake |
| Input | Touch | D-pad focus, voice | No hover-only UI in shell; focusable elements are real buttons/links |
| Devices | One registered phone | TV, car, tablet, desktop | `devices` table and device-targeted bus messages from day one |
| Car | None | Android Auto via Car App Library | `car` block reserved in manifest; bus events carry no UI assumptions |
| Transport | Via server (PocketBase realtime) | Direct LAN/Tailscale WebSocket | One message envelope, transport chosen by shell |
| Integrations | Home Assistant, Jellyfin, Claude, external app launch | Health Connect, usage stats, call log | Scope names reserved; capability discovery API |

## Architecture and tech stack

The shell is the only component that talks to Android, the server and external services; subapps talk only to the shell.

&#91;embedded content: phone shell and mini PC · v1 components\]

The bridge router is the only door between subapps and everything else; the data mirror is the only part that talks to PocketBase, which also proxies Home Assistant, Jellyfin and the Claude API.

**Tech stack**

| Layer | Choice | Notes |
| --- | --- | --- |
| Shell UI | TypeScript + Vite + a light UI framework (React or Svelte) | Single-page app; runs in Capacitor WebView |
| Native wrapper | Capacitor (current stable), Android target | minSdk 26, targetSdk current; Kotlin for custom plugins |
| Local storage | SQLite via a Capacitor SQLite plugin | Cache, outbox, logs, permission grants, subapp bundle index |
| Secrets on device | Android Keystore-backed secure storage plugin | Server token, device token |
| Subapp runtime | Sandboxed iframes served from the shell origin | `sandbox="allow-scripts allow-forms"`, no `allow-same-origin` |
| Subapp SDK | TypeScript package `@superapp/sdk` | Generated types from the bridge API schema |
| API schema | JSON Schema / TypeScript types in a shared `contracts` package | Single source for SDK, shell validation and server rules |
| Server | PocketBase on Windows 11 mini PC | Auth, collections, realtime, file storage, backups, JS hooks |
| Network | Tailscale on phone and mini PC | No public ports; LAN and remote use the same address |
| Push | ntfy (self-hosted) | Optional in v1; shell also polls on resume |
| Repo | pnpm monorepo | `apps/shell`, `packages/sdk`, `packages/contracts`, `server/`, `subapps/*` |

## Shell functionality

The shell ships seven built-in screens and owns no domain features; everything else is a subapp.

1. **Home launcher**
   - Grid of installed subapps and external app shortcuts (marked "external"), recent apps, pinned items.
   - Header shows sync status: `Synced`, `Pending (n)`, `Offline`, `Error`.
   - Long-press: app info, permissions, pin/unpin.
   - Can be set as the Android default home app (optional, `HOME` intent filter).
2. **Identity**
   - Sign in to PocketBase once; token stored in secure storage; silent refresh.
   - Optional biometric/device-credential unlock on launch and after N minutes in background.
   - First-run setup: server URL, sign in, register this device (writes a `devices` row).
3. **App manager**
   - Lists subapps from the server `subapps` collection; install, update, disable, uninstall.
   - Shows version, manifest, required SDK version, size, last error.
   - Keeps the previous version of every bundle for one-tap rollback.
4. **Permissions centre**
   - Per app: granted scopes, denied scopes, last used.
   - Revoke any scope; revoking ends the app's session and forces a new handshake.
   - Access log (scope, app, time, result).
5. **Sync centre**
   - Server reachability (LAN or Tailscale), round-trip time, last successful sync.
   - Outbox: count, oldest item age, per-item status.
   - "Needs attention" list (dead-lettered writes and conflicts) with Retry, Edit, Discard, Keep server version.
6. **Diagnostics**
   - Health screen: server, schema version, storage per app, WebView version, shell version.
   - Per-app error log (crashes, timeouts, rejected calls, scope denials).
   - Bridge inspector: live list of bridge messages with filter by app.
   - Export logs: zip of logs + diagnostics uploaded to the server `diagnostics` collection and shareable via Android share sheet.
   - Safe mode: start with all subapps disabled (hold a button on launch or toggle in settings).
7. **Settings**
   - Server URL, theme (light/dark/system), notification preferences per app, background sync interval, clear cache, about.

The shell also runs a **notification inbox** (v1: list of notifications raised by subapps, with deep link back) and a **deep-link router** for `superapp://` URIs.

## Subapp model

A subapp is a static web bundle (HTML/JS/CSS) plus an `app.json` manifest, uploaded to the server and cached on the device.

**Manifest (`app.json`)**

```json
{
  "id": "budget",
  "name": "Budget",
  "version": "1.4.0",
  "sdk": ">=1.0 <2.0",
  "entry": "index.html",
  "icon": "icon.png",
  "formFactors": ["phone", "tv"],
  "scopes": {
    "required": ["data.own", "core.people.read"],
    "optional": ["device.contacts.read", "notify.post"]
  },
  "collections": ["budget_expenses", "budget_categories"],
  "events": {
    "emits": ["budget.expense.created"],
    "listens": ["core.person.updated"]
  },
  "deepLinks": ["/expense/:id", "/report/:month"],
  "intents": [{ "action": "share.receive", "types": ["text/plain", "image/*"] }],
  "car": null,
  "background": { "tasks": [] }
}
```

**Rules**

- `id` is lowercase, unique, and prefixes every collection and event the app owns (`budget_*`, `budget.*`).
- `sdk` is a semver range; the shell refuses to launch an app whose range it cannot satisfy and shows why.
- `collections` must exist on the server; the shell refuses writes to collections not listed.
- `car` and `background` are reserved for later and must be `null` or empty in v1.

**Packaging and install**

1. Developer builds the bundle and zips it with `app.json` at the root.
2. Upload to the server `subapps` collection (record = manifest fields + zip file + SHA-256 hash).
3. Shell app manager downloads the zip, verifies the hash, unpacks to `files/subapps/<id>/<version>/`, and records it in local SQLite.
4. Previous version is kept for rollback; older versions are deleted.

**Lifecycle**

| State | Meaning |
| --- | --- |
| `installed` | Bundle on device, not running |
| `starting` | iframe created, waiting for `hello` (timeout 10 s → `crashed`) |
| `active` | Visible and handshake complete |
| `suspended` | Hidden; iframe kept up to 3 most recent apps, then destroyed |
| `crashed` | Unresponsive or threw on start; error card shown with Reload, Roll back, Report |
| `disabled` | Turned off by user or safe mode |

**Hot updates**: on launch and every 6 hours, the shell compares installed versions with the server and downloads updates in the background; an update applies the next time the app starts. A subapp that crashes twice within 60 seconds of an update is auto-rolled back and flagged in diagnostics.

## Bridge API and SDK

The bridge API is the versioned contract between subapps and the shell; the SDK is a thin TypeScript wrapper generated from it. Version 1.0 ships with v1.

**Handshake**

1. Shell creates the iframe and a `MessageChannel`; it keeps `port1`.
2. SDK posts `{ type: "hello", appId, sdkVersion }` to `window.parent`.
3. Shell checks `event.source` is that iframe's window, the app id matches the iframe it created, and the SDK version satisfies the manifest.
4. Shell transfers `port2` to the iframe with `{ type: "welcome", sessionToken, apiVersion, grantedScopes, user, device, formFactor, theme, locale }`.
5. All further traffic uses the private port; messages on `window.postMessage` after the handshake are ignored.
6. Session tokens are random, held only in memory, and die when the iframe is destroyed or a scope is revoked.

**Message envelope**

```ts
// request (subapp → shell)
{ v: 1, id: "uuid", kind: "req", method: "data.create", params: {...}, token: "..." }
// response (shell → subapp)
{ v: 1, id: "same-uuid", kind: "res", ok: true, result: {...} }
{ v: 1, id: "same-uuid", kind: "res", ok: false, error: { code: "SCOPE_DENIED", message: "...", retryable: false } }
// event (shell → subapp, pushed)
{ v: 1, kind: "evt", topic: "core.person.updated", payload: {...}, ts: "ISO-8601" }
```

Every request times out after 15 s by default (configurable per call). The shell validates `params` against the JSON Schema in `packages/contracts` before acting.

**v1 methods**

| Namespace | Methods | Scope |
| --- | --- | --- |
| `app` | `ready`, `setTitle`, `close`, `getContext` | none |
| `data` | `list`, `get`, `create`, `update`, `delete`, `subscribe`, `unsubscribe` | `data.own`, `core.<collection>.read/write` |
| `bus` | `emit`, `on`, `off`, `request` (with reply) | `bus.emit:<topic>`, `bus.listen:<topic>` from manifest |
| `nav` | `open` (deep link), `back`, `share` | `nav.open` |
| `launcher` | `open` external app or URL on a device | `apps.launch` |
| `files` | `pick`, `upload`, `getUrl` | `files.read`, `files.write` |
| `notify` | `post`, `cancel`, `badge` | `notify.post` |
| `device` | `info`, `battery`, `network`, `location`, `contacts.list`, `haptics` | `device.*` per capability |
| `ha` | `states`, `call`, `subscribe` | `home.read`, `home.control` |
| `media` | `search`, `item`, `streamUrl`, `playOn` | `media.read`, `media.play` |
| `ai` | `chat` (Claude via server) | `ai.chat` |
| `sys` | `capabilities` (what exists on this device), `log` | none |

**Error codes**: `INVALID_PARAMS`, `SCOPE_DENIED`, `NOT_FOUND`, `CONFLICT`, `OFFLINE_QUEUED` (write accepted into outbox; `ok: true` with `result.pending: true`), `UNAVAILABLE` (capability not on this device), `TIMEOUT`, `RATE_LIMITED`, `SERVER_ERROR`, `INTERNAL`.

**Versioning**: additive changes bump the minor version; breaking changes bump the major and the shell keeps the previous major adapter for at least one release. `sys.capabilities` lets apps feature-detect instead of version-checking.

**SDK requirements**

- Promise-based, fully typed, < 15 KB minified.
- Works standalone in a normal browser: `sa.isHosted === false`, data calls fall back to a dev mock or direct PocketBase with a dev token.
- `sa.data.subscribe` delivers local results immediately, then server updates.
- Global error hook: uncaught errors and unhandled rejections are forwarded via `sys.log`.

## Permissions and native capabilities

Android grants permissions to the shell; the shell grants scopes to subapps. A subapp gets a capability only if Android allowed it, the manifest declares it, and the user approved it for that app.

**Grant flow**

1. Subapp calls a method needing scope `X`.
2. Shell checks the manifest lists `X` (if not: `SCOPE_DENIED`, logged).
3. If the user has not decided for this app: show a shell consent sheet ("Budget wants to read your contacts", Allow / Allow once / Deny).
4. If the scope needs an Android runtime permission the shell lacks: request it now; if denied permanently, deep-link to Android app settings.
5. Store the decision in local SQLite and mirror it to the server `grants` collection; log the access.

**Capability map (v1)**

| Capability | Scope | Android source | v1 |
| --- | --- | --- | --- |
| Device info, app version | `device.info` | Capacitor Device | Yes |
| Battery | `device.battery` | Capacitor Device | Yes |
| Network state | `device.network` | Capacitor Network | Yes |
| Location | `device.location` | Capacitor Geolocation (`ACCESS_FINE_LOCATION`) | Yes |
| Contacts | `device.contacts.read` | Community contacts plugin (`READ_CONTACTS`) | Yes |
| Haptics | `device.haptics` | Capacitor Haptics | Yes |
| Camera / photo pick | `files.read` | Capacitor Camera, Android photo picker | Yes |
| Local notifications | `notify.post` | Capacitor Local Notifications (`POST_NOTIFICATIONS`) | Yes |
| Share in / out | `nav.open`, manifest `intents` | Capacitor Share + `SEND` intent filter | Yes |
| Launch external apps | `apps.launch` | Capacitor App Launcher + `<queries>` entries | Yes |
| Google Drive files | `files.read` | Android Storage Access Framework picker | Yes |
| Google Drive API | `gdrive.read/write` | Google sign-in (OAuth) + Drive REST | Later |
| Call log, SMS read | `device.calllog.read`, `device.sms.read` | Custom Kotlin plugin | Later |
| App usage stats | `device.usage.read` | Custom Kotlin plugin (`PACKAGE_USAGE_STATS`, special access) | Later |
| Health data | `device.health.read` | Health Connect plugin | Later |
| Background tasks | manifest `background` | WorkManager via custom plugin | Later (shell sync only in v1) |

**Rules for Claude Code**

- Declare only v1 permissions in `AndroidManifest.xml`; add later ones with their feature.
- Every native call goes through one `CapabilityBroker` module in the shell; no plugin is imported anywhere else.
- `sys.capabilities` returns what this device supports, so the same subapp runs on TV where contacts return `UNAVAILABLE`.

## Data layer

PocketBase on the mini PC holds the canonical data; the phone keeps a SQLite mirror of what apps have read plus the outbox. Schema changes are versioned PocketBase migrations committed to `server/pb_migrations`.

**Conventions for every synced collection**

- `id`: generated on the device at creation, in PocketBase's id format (15 chars, `a-z0-9`), so retries never duplicate.
- `version`: integer, starts at 1, incremented by a server hook on every update.
- `deleted`: boolean soft delete; hard deletes only by a server cleanup job after 30 days.
- `owner`: relation to `users`.
- `origin_device`: relation to `devices` (who wrote it last).
- `created`, `updated`: PocketBase autodate fields.
- App-owned collections are prefixed with the app id (`budget_expenses`); core collections are prefixed `core_`.

**Core collections**

| Collection | Purpose | Key fields |
| --- | --- | --- |
| `users` | PocketBase auth | email, name, avatar |
| `core_devices` | Every shell install (phone now, TV/car later) | name, kind (`phone`/`tv`/`car`/`desktop`), formFactor, shellVersion, capabilities (JSON), lastSeen, pushTopic |
| `core_people` | Shared contacts list | displayName, phones (JSON), emails (JSON), sourceIds (JSON, e.g. Android contact id), tags |
| `core_tags` | Shared labels | name, color |
| `core_files` | Shared file store | file, mime, size, sha256, tags, sourceApp |
| `core_settings` | Key/value settings | scope (`global` or app id), key, value (JSON) |
| `core_notifications` | Inbox items | appId, title, body, deepLink, readAt, targetDevice |
| `core_messages` | Bus messages between devices | from (device), to (device or `*`), topic, payload, expiresAt, deliveredAt |
| `core_external_apps` | External app registry | name, icon, packages (JSON per platform), linkTemplates (JSON) |
| `core_integrations` | Server-held tokens for HA, Jellyfin, Claude | kind, baseUrl, secret (server-only, never returned to clients) |
| `subapps` | Published subapp bundles | appId, version, manifest (JSON), bundle (file), sha256, channel |
| `grants` | Per-device, per-app scope decisions | device, appId, scope, decision, decidedAt |
| `diagnostics` | Uploaded log bundles | device, file, summary |
| `schema_info` | Current schema version | version, appliedAt |

**Access rules**

- All collections: authenticated owner only (single-user system, but rules are still enforced).
- `core_integrations.secret` is hidden from the API; only server hooks read it.
- Subapp scope enforcement lives in the shell; PocketBase rules are the second line of defence, not the first.

## Sync, offline and error recovery

The shell is online-first with a durable outbox: reads come from the local mirror and refresh from the server, writes are applied locally and queued until the server confirms them. No write is ever dropped silently.

**Write path**

1. Subapp calls `data.create/update/delete`.
2. Shell validates params and scope, writes the change to the local mirror, and appends an outbox row: `{ opId, collection, recordId, op, payload, baseVersion, attempts, status, createdAt, lastError }`.
3. Shell replies immediately: `ok: true` with `pending: true` if not yet confirmed.
4. Sync worker sends outbox rows in order, per record, with `opId` as an idempotency key.
5. Server hook checks `baseVersion` equals the stored `version`; if so it applies, bumps `version`, and records `opId` in a `processed_ops` collection (kept 30 days) so a replay returns the original result.
6. On success the shell updates the mirror with the server record, marks the row `done`, and emits `data.changed` to subscribers.

**Read path**

- `data.list/get` returns local rows at once, then fetches from the server when online and pushes a second result through the subscription.
- PocketBase realtime subscriptions keep the mirror current while the app is in the foreground; on resume the shell does a catch-up query using `updated > lastSyncAt`.

**Failure handling**

| Situation | Behaviour |
| --- | --- |
| Offline / server unreachable | Rows stay `queued`; status shows `Offline`; retry on connectivity change and every 30 s with backoff |
| Timeout or 5xx | Exponential backoff 2 s → 5 min with jitter; after 10 attempts the row moves to `dead` |
| 400 validation error | Row moves to `dead` immediately with the server message |
| 401 / 403 | Pause sync, attempt token refresh, prompt sign-in if refresh fails |
| Version conflict (409) | Server wins by default: mirror takes the server record, row moves to `conflict` with both versions kept for review |
| Record deleted on server | Row moves to `conflict` with option to recreate |
| Shell killed mid-sync | Outbox is in SQLite; resumes on next launch; idempotency key prevents duplicates |
| Schema mismatch (`schema_info.version` higher than the shell supports) | Writes to affected collections pause; banner asks to update the shell |

`dead` and `conflict` rows appear in Sync centre → Needs attention, and the owning subapp receives a `data.sync_failed` event so it can show its own message.

**Integrity safeguards**

- Outbox operations for the same record are never reordered; different records may send in parallel (max 4).
- Local mirror writes and outbox appends happen in one SQLite transaction.
- Daily integrity check compares local record versions with the server for recently used collections and repairs drift by refetching.
- The server runs PocketBase scheduled backups nightly and copies them off the machine (see server setup).

## Message bus and devices

One bus carries events between subapps on the same device and between devices; subapps address a topic and optionally a device, and the shell picks the transport.

**Topics**

- Format `<appId>.<entity>.<verb>` (`budget.expense.created`); core topics use `core.` (`core.person.updated`).
- Subapps may only emit topics prefixed with their own id and may only listen to topics declared in their manifest.
- Payloads are JSON, max 64 KB; large data goes in a record and the event carries its id.

**Delivery**

| Target | Transport (v1) | Guarantee |
| --- | --- | --- |
| Same device, running apps | In-memory shell router | Delivered to active and suspended listeners; dropped if no listener |
| Same device, durable | `bus.emit({ durable: true })` stores in local SQLite | Delivered when a listener next starts (max age 24 h) |
| Another device | Write to `core_messages`; target shell receives via PocketBase realtime or catch-up on resume | At least once until `expiresAt` (default 5 min, max 7 days); receiver de-duplicates by message id |

**`bus.request`** sends a message and waits for one reply (default timeout 10 s), used for "ask another app" patterns such as picking a person.

**Cross-device readiness (build now, use later)**

- Register the phone in `core_devices` on first run; send a heartbeat (`lastSeen`) on resume and every 15 minutes while open.
- Every bus message has `from` and `to` device fields even when both are the phone.
- A `Transport` interface with one v1 implementation (`ServerRelayTransport`) so a `DirectLanTransport` (NSD discovery + WebSocket over LAN/Tailscale) can be added for low-latency use such as TV remote control.
- Device pairing reserved: a future TV shows a QR code with a one-time code; the phone scans it and creates the TV's `core_devices` row and token.

## Integrations

Every third-party service is reached through a PocketBase custom route on the mini PC, so secrets stay on the server and subapps see only bridge methods.

**Home Assistant**

- Runs on the mini PC as Home Assistant OS in a Hyper-V VM; reachable over Tailscale.
- Server holds a long-lived access token in `core_integrations`.
- Routes: `GET /api/sa/ha/states`, `POST /api/sa/ha/call` (domain, service, data). A server-side WebSocket client relays state changes the user opted into as `core.home.state_changed` bus events.
- Inbound: Home Assistant automations call a PocketBase webhook (`/api/sa/hooks/ha`, shared secret) to raise bus events or notifications.
- Scopes: `home.read`, `home.control`; the shell may restrict `home.control` to an allow-list of entities per app.

**Jellyfin**

- Runs natively on Windows on the mini PC.
- Library and metadata via server routes (`/api/sa/media/search`, `/api/sa/media/item/:id`, `/api/sa/media/resume`).
- Playback: the server returns a short-lived stream URL for a dedicated Jellyfin user; the shell's player or the subapp's `<video>` element plays it directly from Jellyfin over Tailscale.
- `media.playOn({ device })` is a bus message to another device (later: TV).
- Heavy viewing (background playback, casting, downloads) deep-links to the official Jellyfin Android app.

**Claude**

- Route `POST /api/sa/ai/chat` calls the Anthropic Messages API with a key held in `core_integrations`; model name configurable in `core_settings`.
- The shell attaches the calling app id; the server enforces a per-app daily token budget and logs usage.
- Responses stream back to the subapp through the bridge as `ai.chunk` events.
- Claude never gets direct database access; a subapp chooses what data to include in the prompt, within its own scopes.

**External apps and deep links**

- `core_external_apps` lists apps such as Netflix (`com.netflix.mediaclient`), with link templates (e.g. a title URL).
- `launcher.open({ target, device })`: on this device, the shell tries the content link, then the package launch, then the web URL; for another device it sends a bus message.
- Every package the shell may launch is listed in `<queries>` in `AndroidManifest.xml` (Android 11+ package visibility).
- Inbound `superapp://<appId>/<path>` links open the matching subapp route; registered as an Android intent filter.

**Push**: optional self-hosted ntfy topic per device; the server posts a wake-up when `core_messages` or `core_notifications` target the device, and the shell syncs on receipt.

## Security

The trust boundary is the iframe: everything inside a subapp is untrusted, everything the shell and server do is checked.

- **Network**: the server is reachable only on the Tailscale network and LAN; no ports open to the internet. The shell refuses any server URL that is not HTTPS or a Tailscale/LAN address.
- **Subapp isolation**: iframes use `sandbox="allow-scripts allow-forms"` (no same-origin, no top navigation, no popups) and a Content Security Policy with `connect-src 'none'`, so subapps cannot make network requests themselves.
- **Bridge**: private `MessagePort` per app, per-session token, schema validation on every call, per-app rate limit (default 50 requests/second).
- **Secrets**: server token and device token in Android Keystore-backed storage; integration secrets only on the server; nothing sensitive in subapp storage.
- **Bundles**: SHA-256 verified on download; only bundles from the owner's server are installable.
- **App lock**: optional biometric unlock; the shell blurs its content in the Android recents screen (`FLAG_SECURE` option).
- **Device data**: contacts, location and later call/SMS data are stored only on the mini PC and phone; backups are encrypted before leaving the mini PC.
- **Audit**: scope grants, revocations and sensitive capability use are logged locally and mirrored to the server.

## Server setup and build

The mini PC (Windows 11) runs PocketBase as a service behind Tailscale; the phone APK is built locally and sideloaded.

**Mini PC**

1. Install Tailscale; enable MagicDNS and HTTPS certificates; expose PocketBase with Tailscale Serve so the phone uses `https://<minipc>.<tailnet>.ts.net`.
2. Install PocketBase (Windows x64) in `C:\superapp\pocketbase\`; run as a Windows service with NSSM, auto-restart on failure.
3. Commit `pb_migrations/` and `pb_hooks/` (custom routes, version and idempotency hooks, integration proxies) from the repo; deploy with a script that copies them and restarts the service.
4. Install Jellyfin (Windows installer) and Home Assistant OS (Hyper-V VM); add their URLs and tokens to `core_integrations` via the PocketBase admin UI.
5. Optional: ntfy for push.
6. Backups: PocketBase scheduled backup nightly; a Task Scheduler job encrypts the zip and copies it to an external drive and one off-site target; keep 14 daily and 8 weekly copies; monthly restore test.
7. Windows: disable sleep, enable automatic restart after power loss in BIOS, schedule Windows Update restarts for 4 am.

**Monorepo layout**

```text
superapp/
  apps/shell/            Capacitor + TypeScript shell (android/ inside)
  packages/contracts/    Bridge API JSON Schemas + generated types
  packages/sdk/          @superapp/sdk
  packages/ui/           Shared UI kit for subapps (optional)
  server/pb_migrations/  Versioned schema
  server/pb_hooks/       Custom routes and hooks (JS)
  subapps/hello/         Reference subapp used by tests
  tools/                 Bundle packer, deploy scripts
```

**Build and deploy**

- Shell: `pnpm build` → `npx cap sync android` → Gradle `assembleRelease` signed with a personal keystore; install via `adb install` or by downloading the APK from the server.
- Shell self-update: the shell checks a `shell_releases` record and offers to download and install a newer APK (Android installer prompt).
- Subapps: `pnpm --filter <app> build` → `tools/pack` creates the zip and hash → uploads to `subapps`.
- Dev mode: run a subapp with Vite in the browser using the SDK's standalone mode; the shell can also load a subapp from a dev URL when developer mode is on.

## Milestones and acceptance criteria

Build in six milestones; each ends with a working APK and passes its criteria before the next starts.

1. **M1 — Foundations**
   - Monorepo, contracts package, PocketBase with core migrations and hooks, Tailscale HTTPS.
   - Done when: `pnpm test` passes; PocketBase migrations apply on a clean data dir; version and idempotency hooks have tests (same `opId` twice → one record).
2. **M2 — Shell and bridge**
   - Capacitor shell, sign-in, device registration, launcher, iframe host, handshake, `app`/`sys` methods, SDK v1.0, reference `hello` subapp.
   - Done when: `hello` launches, completes the handshake in under 500 ms on the phone, and a forged message from another frame is rejected and logged.
3. **M3 — Data and sync**
   - Local SQLite mirror, outbox, sync worker, conflict handling, Sync centre, `data.*` methods.
   - Done when: 100 writes made in airplane mode all reach the server after reconnect with no duplicates; killing the app mid-sync loses nothing; a forced version conflict appears in Needs attention.
4. **M4 — Permissions and device**
   - Capability broker, consent sheets, Permissions centre, v1 capability map, notifications, share in/out, external app launch.
   - Done when: a subapp without `device.contacts.read` in its manifest gets `SCOPE_DENIED`; revoking a scope ends the session; Netflix launches from the launcher.
5. **M5 — App manager, bus and diagnostics**
   - Bundle install/update/rollback, message bus (local + `core_messages`), deep links, notification inbox, diagnostics, safe mode, log export.
   - Done when: a broken update auto-rolls back; a bus event from app A reaches app B; a message to the phone written on the server arrives within 2 s while the app is open; log export lands in `diagnostics`.
6. **M6 — Integrations**
   - Home Assistant, Jellyfin and Claude routes and bridge methods; two sample subapps (home dashboard, media "continue watching").
   - Done when: a light toggles from a subapp; a Jellyfin item plays; a Claude chat streams; no integration secret is ever present on the phone.

**Implementation notes for Claude Code**

- Treat `packages/contracts` as the source of truth: change the schema first, then regenerate SDK types, then implement the shell handler.
- Keep all native plugin calls inside `apps/shell/src/native/CapabilityBroker.ts`; keep all server calls inside `apps/shell/src/server/`.
- No subapp may import anything from the shell; they depend only on `@superapp/sdk`.
- Write tests alongside each module: unit tests (Vitest) for the router, outbox and permission checks; an integration test that runs `hello` against a local PocketBase.
- Never hard-code the phone: read form factor and capabilities from `sys.capabilities` and the `core_devices` record.
- Log every rejected call with app id, method, error code and timestamp.
- Prefer small, reviewable commits per milestone sub-task.

## Open questions

- [ ] Shell UI framework: React or Svelte?
- [ ] Which existing vibe-coded apps migrate first, and what stack are they in?
- [ ] Is a Google Drive API integration needed in v1, or is the file picker enough?
- [ ] Off-site backup target for the mini PC (cloud bucket, second location)?
- [ ] Should the shell be set as the Android home screen by default?
