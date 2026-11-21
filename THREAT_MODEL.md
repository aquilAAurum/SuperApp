# Threat Model: Shell, bridge and server core — SA-2026-001 / SA-2026-002 (Doc ID D04)

Owner: Mara (Security Engineer). Data-inventory review: Priya. Template: Core `core/governance/comm-templates.md` §2. Covers milestones M1–M2; each later milestone appends its new surface before `3_BUILD` (HB-SEC-03).

## A. Scope

| Surface | Entry point | Introduced |
| :--- | :--- | :--- |
| Subapp ↔ shell handshake | `window.postMessage` `hello` → `welcome` + transferred `MessagePort` | M2 |
| Bridge API | Private `MessagePort` per app; envelope v1; methods in `packages/contracts/src/methods.ts` | M2 (`app.*`, `sys.*` implemented; others answer `NOT_IMPLEMENTED`) |
| Subapp bundles | Built-in bundles under `/builtin/<id>/<version>/` loaded via `srcdoc` | M2 (server bundles: M5) |
| Shell ↔ PocketBase | HTTPS to the configured server URL (auth, `core_devices`, `/api/health`) | M2 |
| Ops write path | `POST /api/sa/ops` (auth required) | M1 |
| PocketBase collections | API rules in `server/pb_migrations/1763740800_core_collections.js` | M1 |
| Device secrets | Keystore-backed secure storage (token, device id) | M2 |
| Android | Permissions `INTERNET`, `ACCESS_NETWORK_STATE`; no exported components except the launcher activity | M2 |

## B. Data Flow & Trust Boundaries

```text
[Subapp iframe: UNTRUSTED, opaque origin, CSP connect-src 'none']
   │  hello (window.postMessage, authenticated by event.source identity)
   │  requests over private MessagePort (token + schema + scope checks)
   ▼
[Shell WebView: TRUSTED]──CapabilityBroker──▶[Android plugins / Keystore]
   │  HTTPS (Tailscale Serve), bearer token
   ▼
[PocketBase on mini PC: TRUSTED, tailnet/LAN only]──hooks──▶[core_integrations secrets → HA / Jellyfin / Anthropic (M6)]
```

Boundaries crossed: B1 iframe → shell (every message validated on the shell side, CORE-12); B2 shell → server (server re-checks auth and API rules, CORE-13: PocketBase rules are the second line of defence); B3 shell → Android (only via the broker).

## C. Threats (STRIDE)

| ID | Category | Threat | L | I | Severity | Control | Verifying test |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| T-01 | Spoofing | Another frame (or a navigated subapp) sends `hello` claiming to be app X and receives X's port and scopes | M | H | **High** | Accept `hello` only from the exact `contentWindow` the shell created and is still awaiting; app id must match that frame; SDK range check; reject + log otherwise | unit `handshake.test.ts` "rejects and logs a hello forged from another frame"; e2e "a forged hello from another frame is rejected and logged" |
| T-02 | Spoofing | Subapp replays or forges requests after its session was revoked | M | M | Medium | 256-bit per-session token compared in constant time; `detach()` closes the port and drops queued messages | unit `router.test.ts` "detach closes the port and stops answering" |
| T-03 | Elevation | Subapp calls a method or collection it did not declare (e.g. contacts, another app's collection, `core_*` without scope) | H | H | **High** | Scope resolved per call from contracts; must be declared in manifest **and** consented for consent scopes; `data.own` limited to manifest `collections` | unit `router.test.ts` SCOPE_DENIED cases; e2e "undeclared scopes are denied and logged" |
| T-04 | Tampering | Malformed params crash handlers or smuggle fields | H | M | Medium | Ajv JSON Schema per method (`additionalProperties: false`) before any handler runs | unit `contracts.test.ts` "rejects unknown params"; `router.test.ts` INVALID_PARAMS |
| T-05 | Info disclosure | Subapp exfiltrates data over the network, reads shell DOM, storage or cookies | M | H | **High** | `sandbox="allow-scripts allow-forms"` (opaque origin); shell-injected CSP first in `<head>`: `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `frame-src 'none'`, `base-uri 'none'`; nonce on scripts; Permissions Policy denies camera/mic/geolocation | e2e "the subapp cannot reach the network, the shell DOM, storage or cookies"; unit `sandbox.test.ts` |
| T-06 | DoS | Subapp floods the bridge | M | L | Low | Token bucket 50 req/s per app → `RATE_LIMITED` | unit `router.test.ts` "rate limits per app" |
| T-07 | Elevation | XSS in the shell WebView (would bypass every bridge check) | L | H | **High** | Shell CSP: `script-src 'self'`, no inline/eval; ESLint bans `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`{@html}`; subapp-provided strings rendered as text only | lint (CI); CodeQL `security-extended` |
| T-08 | Info disclosure | Tokens or URLs with credentials leak into logs or exported diagnostics | M | M | Medium | Logger redacts `token/secret/password/authorization/cookie/apikey` keys and reduces `*Url` fields to origin; session token never logged | unit `core.test.ts` "redacts secrets and URLs"; `router.test.ts` "never logs the session token" |
| T-09 | Spoofing / MITM | Phone talks to an attacker-controlled server or over cleartext | L | H | Medium | URL policy: HTTPS, or HTTP only to LAN/Tailscale; APK `cleartextTrafficPermitted=false`, system CAs only; server reachable only on tailnet/LAN | unit `core.test.ts` URL policy; e2e "refuses plain HTTP to a public host"; Step 0 manifest checks |
| T-10 | Tampering | Client writes synced records directly, skipping version checks, or sets `owner`/`version` | M | H | **High** | Synced collections: create/update/delete rules `null`; writes only via `/api/sa/ops`, which strips server-owned fields and checks `baseVersion` in a transaction | unit `ops.test.ts`; integration "synced collections cannot be written directly"; unit "clients cannot set server-owned fields" |
| T-11 | Repudiation / integrity | Retries duplicate writes; concurrent replays race | H | M | Medium | `opId` ledger (`processed_ops`, unique index) inside the same transaction; replay returns the original result | unit + integration "same opId twice → one record" |
| T-12 | Info disclosure | Integration secrets reach the phone | L | H | Medium | `core_integrations` has null API rules and a hidden `secret` field; only hooks read it | integration "integration secrets are never readable by clients" |
| T-13 | Info disclosure | Tokens copied off the device via Android backup / device transfer | L | H | Medium | Keystore-backed storage; `allowBackup=false`; data-extraction rules exclude all domains | Step 0 "Android backups disabled" |
| T-14 | DoS | A subapp hangs on start or leaks iframes | M | L | Low | 10 s start timeout → `crashed`; max 3 suspended iframes (LRU destroy); explicit destroy path (CORE-15) | unit `lifecycle.test.ts` (timeout, LRU, destroyAll); e2e "app.close destroys the iframe" |

## D. Data Inventory Delta (Priya)

See [`project-profile.md` §5](project-profile.md). New in M1–M2: server token and device id (Keystore), `core_devices` row, in-memory diagnostics buffers, `processed_ops` ledger (30-day retention, no payload beyond the op result).

## E. Residual Risk & Sign-off

| Risk | Owner | Accepted until |
| :-- | :-- | :-- |
| `welcome` is posted with target origin `*` because the sandboxed frame has an opaque origin. A subapp that navigates itself between sending `hello` and the shell's synchronous reply could in theory receive its own port in a different document. Same app, same scopes; no cross-app escalation. | Mara | M5 review (revisit with server-installed bundles) |
| Subapp CSP keeps `style-src 'unsafe-inline'` (frameworks set inline styles). Impact is confined to the subapp's own sandbox. | Mara | Accepted |
| Shell `connect-src` allows `https:` and `http:` because the server address is user-configured; restriction is enforced in code by the URL policy, not by CSP. | Mara | Re-evaluate in M6 (consider pinning to the configured origin at runtime via a native allow-list) |
| Web/E2E builds keep secrets in memory only; there is no Keystore in the browser. Not a production path. | Mara | Accepted |
| PocketBase integration test (T-10–T-12) runs only in CI, not in the authoring environment of Sprint 1. | Kumi Wai | First green CI run |
