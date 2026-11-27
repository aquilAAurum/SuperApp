---
id: ADR-001
title: Build the Super app under Core v4 from reimagined-bassoon, in its own repository
status: Accepted
date: 2026-11-21
decided_by: nick
core_pin: 85cb6b4ebea174008620d6b83eda5234ca52940e
supersedes: []
---

# ADR-001: Build the Super app under Core v4, in its own repository

## 1. Context

`aquilAAurum/reimagined-bassoon` holds the product-agnostic **Core v4** governance (personas with Gate Contracts, the V4 state machine, the Hardening Baseline, templates) and its first app, Kāne. Its ADR-001 (decision 12) says an app moves to its own repository when a second app starts. The Super app is that second app, and Nick asked for it to be built in `aquilAAurum/SuperApp` using bassoon's coding and governance principles.

## 2. Decisions

| # | Decision | Rationale |
| :-- | :-- | :-- |
| 1 | Consume Core **by reference**, pinned to bassoon commit `85cb6b4`. `AGENTS.md` and `project-profile.md` point to it; nothing from `core/` is copied here except the template-repo files (CI, PR template, SECURITY, THREAT_MODEL, Step 0, ESLint rules) that CORE-04 says to instantiate. | One source of truth for governance; personas stay engine- and product-agnostic. |
| 2 | Put the **Project Profile** at the repo root (`project-profile.md`), as `core/template-repo` does. | Personas find it at a fixed path. |
| 3 | Instantiate the template as a **pnpm monorepo** (`apps/shell`, `packages/contracts`, `packages/sdk`, `server/`, `subapps/*`, `tools/`) per the product spec. Template gates map 1:1: Step 0 → `tools/validate.mjs`; lint → flat ESLint (TS + Svelte); unit → Vitest; E2E → Playwright + axe-core; audit → `pnpm audit --prod`; dependency review; CodeQL; tag-only release with SBOM and provenance. | Keeps every Hardening Baseline gate executable (CORE-01). |
| 4 | Encode the spec's architecture rules as **lint errors and Step 0 checks** (native plugins only in `CapabilityBroker`, server calls only in `src/server/`, subapps import only the SDK, Android permission allow-list, sandbox flags, pinned actions). | Evidence over attestation: rules that can be checked by a machine are. |
| 5 | **HB-ELEC-*** controls are not applicable (platform is Capacitor/Android WebView). Their intent is covered by Profile constraints SA-C3 and SA-C6, the shell CSP, and Step 0 manifest checks, listed in the Profile's hardening table. This is a mapping, not a relaxation. | CORE precedence: a Profile may not relax a Core rule without an ADR; Nick approved this mapping on 2026-11-21. |
| 6 | Feature IDs use `SA-YYYY-NNN`. Spec milestones M1–M6 map to features SA-2026-001…006 (see `docs/roadmap.md`). | Matches the Core feature template. |
| 7 | The supplied product spec is committed verbatim as `docs/spec.md`. | Core forbids references to unversioned external documents. |

## 3. Consequences

- Upgrading Core means bumping `core_pin` here and in `AGENTS.md` in a PR that lists what changed.
- `tools/check-docs.mjs` (CI) validates ADR front matter and that the Core pin is consistent across files.
- Nick must apply repository settings once: branch protection with the required checks in Profile §7, secret scanning + push protection, and a protected `release` environment holding the signing keystore.

## 4. Success measure

M1 and M2 acceptance criteria pass in CI on the first PR, with every gate linked from the PR's Evidence Bundle.
