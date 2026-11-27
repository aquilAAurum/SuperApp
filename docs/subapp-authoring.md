# Writing a subapp

A subapp is a static web bundle plus `app.json`, hosted by the shell in a sandboxed iframe. It reaches everything (data, device, other apps, integrations) through `@superapp/sdk`. See `subapps/hello` for a complete example.

## Rules (lint- and shell-enforced)

- Import only `@superapp/sdk`; never the shell, `@capacitor/*`, `pocketbase` or `@superapp/contracts`.
- No network: `fetch`, XHR, WebSocket, forms, nested frames and workers are blocked by the shell's CSP. Ask the bridge instead.
- Ship **one self-contained `index.html`** (inline JS/CSS, data-URI images). With Vite use `vite-plugin-singlefile`, as `hello` does. Scripts loaded by URL must be classic scripts (see ADR-003).
- `app.json` must pass `validateManifest` (`packages/contracts/src/manifest.ts`): lowercase `id`; collections prefixed `<id>_`; emitted topics `<id>.<entity>.<verb>`; `car: null`; `background: { "tasks": [] }`.
- Declare every scope you call. Undeclared scopes return `SCOPE_DENIED` and are logged in Diagnostics.

## Minimal app

```ts
import { connect } from '@superapp/sdk';

const sa = connect({ appId: 'budget' });
const ctx = await sa.ready;              // welcome: user, device, formFactor, theme, grantedScopes
await sa.app.setTitle('Budget');
const caps = await sa.sys.capabilities(); // feature-detect, don't version-check
```

`sa.isHosted === false` when the page runs in a normal browser (`pnpm --filter <app> dev`); calls are answered by an in-memory dev mock.

## Pack

```bash
pnpm --filter <app> build            # vite build
node tools/pack.mjs subapps/<app>    # validates app.json, writes release/<id>-<version>.zip + .sha256
```

Upload to the server `subapps` collection arrives with the App manager (M5). Until then, reference apps are built into the shell with `--builtin apps/shell/public`.

## Migrating an existing vibe-coded app

1. Move its code under `subapps/<id>/`, add `app.json` and `@superapp/sdk`.
2. Replace direct `fetch`/storage with `sa.data.*` (M3) and other bridge methods.
3. Build as a single file; run it standalone first, then inside the shell (`pnpm dev` in `apps/shell`).
