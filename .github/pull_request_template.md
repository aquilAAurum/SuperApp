## Summary
<!-- What changed and why. Link the Feature ID (e.g. SA-2026-002) and milestone (M1–M6). -->

## Workflow state
<!-- Current state from Core v4 state-machine (reimagined-bassoon core/workflow/state-machine.md), e.g. state:5_REVIEW. Track F or S. -->

## Evidence (links, not pasted content — CORE-01)
- Commit SHA:
- CI run:
- Debug APK artifact (Writer Deploys):
- Threat model entry (if new attack surface): THREAT_MODEL.md#
- Design notes / Input Model Contract (if UI):

## Hardening Baseline
- [ ] CI green (Step 0, lint, typecheck, unit, E2E + axe, PocketBase integration, Android build, audit, CodeQL)
- [ ] Contract first: `packages/contracts` changed before SDK and shell handler (spec note 1)
- [ ] No new bridge method, scope, native capability, Android permission or network origin without a threat-model entry
- [ ] Native calls only in `CapabilityBroker.ts`; server calls only in `src/server/` (lint-enforced)
- [ ] Every rejected call logged with app id, method, code, timestamp
- [ ] No blocking dialogs (`alert`/`confirm`/`prompt`); feedback via Toast
- [ ] Design tokens only; visible focus state on every new interactive element
- [ ] Docs updated, or ADR lists superseded docs
- [ ] Data inventory (project-profile.md §5) updated if user data is collected or stored

## Reviewers
<!-- Jane (peer review), Russ (QA), Mara (security) where applicable. Nick merges. -->
