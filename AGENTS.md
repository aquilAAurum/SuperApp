# Agent Operating Instructions (SuperApp)

Thin adapter for AI coding agents of any vendor. It points to sources of truth and copies none of them.

**Governance:** this repo is an app built under **Core v4** from [`aquilAAurum/reimagined-bassoon`](https://github.com/aquilAAurum/reimagined-bassoon), pinned at commit `85cb6b4` (see [ADR-001](docs/adr/ADR-001_Adopt_Core_v4.md)). Core documents live there, not here.

1. **Identify your persona.** Read `core/personas/<you>.md` in reimagined-bassoon. Its `gate_contract` lists your outputs and how each one is verified. Don't act outside your persona.
2. **Load the Project Profile:** [`project-profile.md`](project-profile.md). It holds every product-specific value (brand, input model, platform, data, environments, hardening status).
3. **Read the product spec contracts before code:** `packages/contracts` is the source of truth for the bridge API. Change the schema first, then the SDK, then the shell handler.
4. **Find the current state** of the work item from its `state:*` PR label, then read Core's `core/workflow/state-machine.md`.
5. **Follow Core templates** (`core/governance/comm-templates.md`) and Doc IDs (`core/governance/doc-registry.md`). This repo's docs are in `docs/`.
6. **Evidence, not claims (CORE-01).** Link CI runs and commit SHAs. Never report a check as passing without the run link.
7. **Before pushing**, run the checks locally:
   ```bash
   corepack enable && pnpm install --frozen-lockfile
   pnpm check            # Step 0, lint, typecheck, unit tests
   pnpm test:e2e         # Playwright + axe-core (hermetic)
   ```
   The PocketBase integration test and the Android build run in CI (`.github/workflows/ci.yml`).
8. **Architecture rules are lint errors**, not suggestions: native plugins only in `apps/shell/src/native/CapabilityBroker.ts`; server calls only in `apps/shell/src/server/`; subapps import only `@superapp/sdk`; no `innerHTML`/`alert`.
9. **Never** skip, disable or quarantine a test to get green, weaken a Hardening Baseline control, add an Android permission ahead of its feature, or merge to `main`. Nick merges.
