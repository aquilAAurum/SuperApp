# Super app

One Android shell that hosts, launches and connects many small web subapps, backed by a self-hosted PocketBase server on a Windows 11 mini PC. Built under **Core v4** governance from [`aquilAAurum/reimagined-bassoon`](https://github.com/aquilAAurum/reimagined-bassoon) ([ADR-001](docs/adr/ADR-001_Adopt_Core_v4.md)).

- Product spec: [`docs/spec.md`](docs/spec.md) · Project Profile: [`project-profile.md`](project-profile.md) · Roadmap: [`docs/roadmap.md`](docs/roadmap.md)
- Security: [`THREAT_MODEL.md`](THREAT_MODEL.md), [`SECURITY.md`](SECURITY.md) · Operations: [`docs/runbook.md`](docs/runbook.md)
- Agents start at [`AGENTS.md`](AGENTS.md).

## Layout

```text
apps/shell/            Capacitor + Svelte shell (android/ inside)
  src/bridge/          handshake guard, bridge router, permissions, rate limit
  src/host/            subapp lifecycle, sandbox (srcdoc + CSP), bundle loading
  src/native/          CapabilityBroker: the only place native plugins are imported
  src/server/          ServerClient: the only place PocketBase is called
packages/contracts/    Bridge API v1: envelope, methods + JSON Schemas, scopes, manifest, errors
packages/sdk/          @superapp/sdk (7 KB minified; budget 15 KB)
server/                PocketBase migrations and JS hooks (ops route, version + idempotency)
subapps/hello/         Reference subapp used by tests
tools/                 Step 0, bundle packer, PocketBase CI bootstrap, server deploy
docs/                  spec, ADRs, features, sprints, runbook, evals
```

## Develop

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check                         # Step 0, lint, typecheck, unit tests
pnpm test:e2e                      # Playwright + axe-core against a mocked server
pnpm --filter @superapp/shell dev  # shell in the browser
pnpm --filter @superapp/subapp-hello dev   # subapp standalone (SDK dev mock)
```

Android: `pnpm build && pnpm --filter @superapp/shell exec cap sync android`, then `./gradlew assembleDebug` in `apps/shell/android` (JDK 21, Android SDK). CI uploads a debug APK on every PR.

## Status

M1 (Foundations) and M2 (Shell and bridge) are built and awaiting review; M3–M6 are planned in the roadmap.
