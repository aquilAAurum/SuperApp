# Threat Model: Shell, bridge, server core and sync — SA-2026-001…003 (Doc ID D04)

Owner: Mara (Security Engineer). Data-inventory review: Priya. Template: Core `core/governance/comm-templates.md` §2. Covers milestones M1–M3 and the Contacts subapp delta (SA-2026-007, §C.2, Sprint R0); each later milestone appends its new surface before `3_BUILD` (HB-SEC-03).

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
| Local mirror + outbox | Encrypted SQLite (Android), IndexedDB (web); `data.*` bridge methods; catch-up and realtime from PocketBase | M3 |
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
| T-15 | Tampering / Elevation | Subapp writes to another app's or a core collection through `data.*` | M | H | **High** | Router resolves scope from the collection: own prefix → `data.own` **and** listed in manifest `collections`; `core_*` → `core.<x>.write`; anything else denied. Server re-checks ownership and synced-collection status | unit `router.test.ts` SCOPE_DENIED cases; integration "app collections are synced" |
| T-16 | Info disclosure | Phone lost or backed up: synced personal data read from disk | L | H | Medium | SQLCipher database, Keystore-held random passphrase, `allowBackup=false` (ADR-004) | Step 0 (backup off); manual check on device (D10) |
| T-17 | Integrity | Offline edits silently overwrite newer server data | M | H | **High** | `baseVersion` fixed at enqueue; server 409 → conflict row, server wins in mirror, owner decides; rebase uses a new opId | unit `sync.test.ts` conflict cases; e2e "a forced version conflict appears in Needs attention" |
| T-18 | Repudiation / integrity | Crash between server apply and local commit duplicates or loses writes | M | H | **High** | Outbox in the durable store, mirror + outbox in one commit, opId replay | unit "killing the shell mid-sync"; e2e "killing the app mid-sync loses nothing" |
| T-19 | DoS | A subapp floods writes and fills the outbox | L | M | Low | 50 req/s bridge limit per app; SDK backs off on `RATE_LIMITED` | unit `router.test.ts`, `sdk.test.ts` |

### C.2 Contacts subapp (SA-2026-007), Sprint R0 delta

New surface: `contacts_*` collections and the `core_people` mirror hook (built, PR #8); the vault importer (CLI, off-phone); channel launching from contact data (R2: `launcher.open` `ChannelTarget`, Kotlin launch plugin, `<queries>`); message templates and notes rendered in the subapp (R3/R5); bulk third-party personal data on the phone mirror.

| ID | Category | Threat | Likelihood | Impact | Severity | Control | Verifying test |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| T-20 | Tampering / Elevation | **Channel-target injection**: a contact field (phone, email, UPN, LinkedIn URL) carries extra URL/intent syntax (`&text=`, `#Intent;…;component=`, `javascript:`) and the launcher opens something other than the intended app or prefills attacker text | M | H | **High** | Subapps pass a typed `ChannelTarget`, never a URL; per-channel JSON Schema (E.164 regex, RFC 5321-lite email, `https://www.linkedin.com/in/` prefix, UPN); the shell builds the intent from a fixed template table, encodes every value, allow-lists schemes and packages; no `component`/`selector` from data | R2: contract tests per channel; fuzz set (Mara) on the template builder; unit "rejects a phone with URL syntax" |
| T-21 | Info disclosure / Repudiation | **Cross-context send**: a message goes out from the wrong identity (e.g. Milford email to a USCD colleague, personal mobile to a work contact) | M | H | **High** | Resolver takes the identity from the membership's context; cross-context guard sheet requires explicit "Send from … anyway"; every override logged; "Sending from" banner when the mechanism cannot force the account (ADR-007) | R2: Russ K3 adversarial matrix (0 wrong-identity sends); unit resolver hard filters |
| T-22 | Tampering / DoS | **Import parsing**: hostile or malformed vault content (YAML bombs, huge files, odd encodings, path tricks in a Drive zip) crashes or misleads the importer | L | M | Medium | Importer runs off-phone on the owner's PC; YAML parsed with the `core` schema (no custom tags), errors reported per note, not thrown; vault walk skips dot-folders and Templates; no zip extraction in the importer (S5 zip path would add size/entry caps and no path use from the archive) | Supra---Contacts `tests/vault.test.ts` "bad YAML is reported, not thrown"; R1: size/entry caps if an on-phone importer is built |
| T-23 | Tampering | **Stale vault overwrites app data** after cutover (an old copy re-pushed deletes or reverts edits made in Supra) | M | H | **High** | `cutover` record in `contacts_imports`; importer refuses to push afterwards (no override); before cutover every removal is a soft delete restorable for 14 days (ADR-005, ADR-008) | Supra---Contacts `tests/supra.test.ts` "cutover … push is refused"; `tools/pb-integration.sh` (real PocketBase): refused push, server untouched |
| T-24 | Elevation (XSS) | **Stored XSS** through notes, imported note bodies, templates or merge fields rendered in the subapp | M | M | Medium | No HTML sinks (ESLint, HB-SEC-04); Markdown rendered with raw HTML disabled; merge fields inserted as text; subapp CSP `connect-src 'none'` limits impact; graph viewer already uses `textContent` only | Lint; R3 unit "template with <script> renders as text"; Supra---Contacts `tests/graph.test.ts` "no HTML sinks" |
| T-25 | Info disclosure | **Lost or shared phone** exposes the whole network (third-party names, numbers, notes) | L | H | Medium | SQLCipher mirror with Keystore key (ADR-004); biometric unlock recommended on for `contacts` (M4); no message bodies stored; graph exports to files use `--no-contact-info` when shared | Step 0 backups off; D10 manual SQLCipher check |
| T-26 | Tampering | **`core_people` divergence**: another subapp edits a contact's `core_people` twin and the mirror silently overwrites it, or the Contacts app trusts edited core data | L | M | Low | Single writer: only the server hook writes `core_people` for contact-owned ids; the Contacts subapp gets `core.people.read` only (ADR-006); edits happen in `contacts_*` | Integration "mirror each contact into core_people … through delete and restore"; R1: manifest scope review (Jane) |
| T-27 | Info disclosure | **Package visibility expansion**: `<queries>` entries for handler apps let the shell (and a compromised shell) enumerate more installed apps | L | L | Low | Only the packages accepted in ADR-007; Step 0 allow-list checks the manifest | Step 0 manifest check (R2) |
| T-28 | Info disclosure | **Identifiers in logs**: launch instrumentation leaks numbers, addresses or message bodies into diagnostics | M | M | Medium | `contacts.launch` events carry channel, handler, network/context ids, ranks and timings only; logger redaction (HB-DATA-03) extended with E.164/email patterns | R2: unit "launch log carries no address or number" |


### C.3 Subapp updates by pull (ADR-009)

| ID | STRIDE | Threat | L | I | Risk | Mitigation | Verified by |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| T-29 | Tampering | **Modified bundle in transit or on the server** (inbox file swapped, record edited) runs on the phone | L | H | Medium | Phone verifies the zip's SHA-256 against the record and the zip's own `app.json` (hash-covered) for id/version and manifest validity before storing; clients cannot write `subapps`; protected file field; Step 0 checks `published/` integrity | unit `updates.test.ts` "rejects a zip whose hash does not match…"; e2e "hash does not match is rejected"; integration "published subapps" |
| T-30 | Elevation | **Malicious or careless update** (a merged PR) ships hostile code or adds scopes | L | H | Medium | Release = Nick merging to `main` (branch protection, PR diff shows `app.json` scopes); bundle runs in the same sandbox/CSP as builtins (`connect-src 'none'`, no same-origin); consent sheets for new scopes arrive with M4 | Review; e2e isolation tests apply to all bundles |
| T-31 | DoS | **Broken update** bricks an app, or a downgrade/replay reinstalls an old vulnerable version | M | M | Medium | Rollback after two crashes within 60 s; rolled-back versions blocked; only versions newer than installed and builtin are taken; published versions immutable and must increase; 10 MB cap | unit rollback cases; e2e "crashes twice within 60 s is rolled back" |
| T-32 | Tampering | **Mini PC pulls a rewritten `main`** | L | M | Low | `sync-subapps.ps1` fast-forward only, refuses a diverged branch; copies bundles only (no hooks/migrations) | Script review; Windows CI job runs the copy path |

## D. Data Inventory Delta (Priya)

See [`project-profile.md` §5](project-profile.md). New with SA-2026-007 (R0): third-party contact data in `contacts_*` and `core_people` (owner-only; soft deletes purged after 14 days, ADR-005), the importer's local SQLite file on the machine that runs the migration (git-ignored; delete after cutover), and identities (the owner's own addresses and numbers, R1). No message content is stored; interactions hold date, channel, outcome and a short note. New in M3: encrypted local mirror and outbox of synced records (Android), IndexedDB copy in browser builds. New in M1–M2: server token and device id (Keystore), `core_devices` row, in-memory diagnostics buffers, `processed_ops` ledger (30-day retention, no payload beyond the op result).

## E. Residual Risk & Sign-off

| Risk | Owner | Accepted until |
| :-- | :-- | :-- |
| `welcome` is posted with target origin `*` because the sandboxed frame has an opaque origin. A subapp that navigates itself between sending `hello` and the shell's synchronous reply could in theory receive its own port in a different document. Same app, same scopes; no cross-app escalation. | Mara | M5 review (revisit with server-installed bundles) |
| Subapp CSP keeps `style-src 'unsafe-inline'` (frameworks set inline styles). Impact is confined to the subapp's own sandbox. | Mara | Accepted |
| Shell `connect-src` allows `https:` and `http:` because the server address is user-configured; restriction is enforced in code by the URL policy, not by CSP. | Mara | Re-evaluate in M6 (consider pinning to the configured origin at runtime via a native allow-list) |
| Web/E2E builds keep secrets in memory only; there is no Keystore in the browser. Not a production path. | Mara | Accepted |
| PocketBase integration test (T-10–T-12) runs only in CI, not in the authoring environment of Sprint 1. | Kumi Wai | First green CI run |
| SA-2026-007: Gmail and Outlook compose intents have no documented from-account selector; until the S4 spike results exist, T-21 relies on the guard sheet and a "Sending from" banner rather than a forced account. | Mara | ADR-007 decision (end of R0) |
| SA-2026-007: the importer's local SQLite file holds the whole network in plain SQLite on the owner's PC during migration. | Priya | Cutover (delete the file afterwards; Supra---Contacts runbook-migration §4) |
