# Feature Name: Shell and bridge (M2)

- **Feature ID:** SA-2026-002
- **Version:** 1.0   · **Status:** Proposal   · **Date:** 2026-11-21
- **Owner(s):** Qz   · **T-Shirt Size:** L
- **RICE:** R:1 | I:3 | C:80% | E:1 = 2.4

## 1. Executive Summary
### 1.1 Problem
Vibe-coded apps each need their own login, storage and device access; none can talk to the others.
### 1.2 Solution
A Capacitor shell that signs in once, registers the phone, launches subapps in sandboxed iframes and gives them a versioned, scope-checked bridge through `@superapp/sdk`.
### 1.3 Business Value & KPIs
KPI 1 (handshake < 500 ms), KPI 3 (every rejected call logged), brand promise "one door".
### 1.4 Hypothesis
A `srcdoc` + nonce-CSP sandbox gives full isolation without a native per-app WebView.
### 1.5 Competitive Landscape
WeChat-style mini-program hosts; this one is self-hosted and single-owner.

## 2. Functional Specification
### 2.1 User Stories (acceptance criteria from spec M2) → tests
| Criterion | Test |
| :-- | :-- |
| First run: server URL, sign in once, register this device (`core_devices` row) | e2e "signs in once and registers this device in core_devices"; "refuses plain HTTP to a public host and wrong passwords" |
| `hello` launches and completes the handshake **in under 500 ms on the phone** | e2e "hello launches and completes the handshake in under 500 ms" (CI browser); **manual on the debug APK**: Diagnostics → Apps → Handshake column (Russ, D10) |
| A **forged message from another frame is rejected and logged** | e2e "a forged hello from another frame is rejected and logged"; unit `handshake.test.ts` |
| `app.*` and `sys.*` work; undeclared scopes return `SCOPE_DENIED` and are logged | e2e "app and sys methods work; undeclared scopes are denied and logged"; unit `router.test.ts` |
| Subapp cannot reach network, shell DOM, storage or cookies | e2e isolation test; unit `sandbox.test.ts` |
| Lifecycle: 10 s start timeout, ≤ 3 suspended iframes, explicit destroy, safe mode | unit `lifecycle.test.ts`; e2e "app.close destroys the iframe", "safe mode disables every subapp" |
| SDK < 15 KB minified, standalone mode `isHosted === false` | CI "SDK size budget"; unit `sdk.test.ts` |
### 2.2 MVP (MoSCoW)
Must: setup, launcher with sync status, iframe host, handshake, `app`/`sys`, Diagnostics (health, error log, bridge inspector), Settings (server, theme, safe mode). Could: biometric unlock (deferred to M4).
### 2.3 Out of Scope
App manager, Permissions centre, Sync centre, notification inbox, deep links (M3–M5).

## 3. UI/UX
### 3.1 User Flow — Setup → Launcher → tap tile → app (back arrow / Android Back → launcher). Launcher → Diagnostics / Settings.
### 3.2 Input Model Contract notes — touch first; every control is a native `<button>`, `<input>`, `<select>` with `:focus-visible` ring (token `--focus-ring`), DOM order = focus order: header → tiles (alphabetical) → Diagnostics → Settings. Back closes the topmost surface (SA-U4).
### 3.3 Accessibility — axe-core WCAG 2.1 AA on setup, launcher, diagnostics, settings (E2E).
### 3.4 Feedback Plan — Toasts for sign-in, crashes, safe mode.

## 4. Technical & Architectural Overview
### 4.1 Integration — `apps/shell` (Svelte UI + TS core), `packages/sdk`, `subapps/hello`, `tools/pack.mjs`.
### 4.2 Architecture & Data Flow — see `THREAT_MODEL.md` §B. Router pipeline: envelope → token → rate limit → method → schema → scopes → handler.
### 4.3 Key Considerations — ADR-003 (srcdoc isolation), ADR-002 (Svelte).
### 4.4 API Contract & Data Model — `packages/contracts`; `core_devices`.
### 4.5 Instrumentation — JSON logs (`apps/shell/src/core/logger.ts`); bridge inspector; rejection log.

## 5. Security & Privacy
### 5.1 New attack surface — handshake, bridge, bundle loading, server sign-in, Keystore. ### 5.2 Data inventory delta — token, device id, `core_devices`. ### 5.3 HB-IDs — HB-QUAL-*, HB-A11Y-01, HB-SEC-01/03/04, HB-DATA-03, HB-OPS-01. ### 5.4 Threat model — `THREAT_MODEL.md` T-01…T-09, T-13, T-14.

## 6. Non-Functional Requirements
Handshake < 500 ms; launcher interactive < 1 s after boot with a cached session.

## 7. RAID Log
| Type | Item | Owner |
| :-- | :-- | :-- |
| Risk | On-phone timing not yet measured (no device in CI) | Russ |
| Assumption | Phone reaches the server via Tailscale Serve HTTPS (APK has cleartext off) | Theo |
| Issue | LAN `http://` works in the browser only (ADR-003 §3) | Qz |

## 8. Release & Operations
### 8.1 Rollout & rollback — sideload debug APK from the CI artifact; rollback = reinstall previous APK. ### 8.2 Observability — Diagnostics screen. ### 8.3 Docs — `README.md`, `docs/subapp-authoring.md`.

## 9. Post-Launch
### 9.1 Success evaluation — Nick uses `hello` on the phone; handshake reading recorded in D10. ### 9.2 Sunset/pivot — n/a. ### 9.3 Known issues — see RAID.

## 10. Governance
### 10.1 Sign-off — Qz, Anansi, Jane, Mara, Russ, Theo, Nick.
### 10.2 Definition of Done — every row in §2.1 green in CI (run link) plus the manual on-phone reading.

## Appendix: Change Log
- 1.0 (2026-11-21): initial.
