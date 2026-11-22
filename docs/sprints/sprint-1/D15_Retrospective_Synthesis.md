[Governance & Process Lead] - [Coach]
[[CONTEXT: core/personas/janus.md, project-profile.md]]
To: Nick

## Retrospective Synthesis: Sprint 1 (Doc ID D15)

> Prepared by Claude acting as the Coach. Gate: every root cause links to evidence and to a drafted change. App-local changes were made in this repo; Core-level changes are drafted below for a PR to reimagined-bassoon if Nick wants them.

| # | Root cause | Evidence | Drafted change | Where |
| :-- | :-- | :-- | :-- | :-- |
| RC-1 | **Platform behaviour verified only late.** The authoring environment could not run the target platform (PocketBase, Android), so platform rules were first exercised in CI or not at all. | Evals `reserved-field-name`, `superuser-hidden-fields`; D10 R-5/R-6 | (a) Done here: `server/tests/unit/migrations.test.ts` reserved-name guard. (b) Proposed: Android emulator E2E job (Russ D14). (c) Core: hardening baseline note "platform guard tests that run without the platform" under HB-QUAL-02. | (a) this PR; (b) Sprint 2; (c) bassoon |
| RC-2 | **Repository bootstrap assumptions.** The template assumes `main` exists and code scanning is available. | Evals `missing-main-branch`, `codeql-upload-assumption`; CI runs 44963469046 | Core `template-repo/README.md` step 0: create `main` first, check code scanning, then push; Step 0 MANUAL items for default branch and code scanning. | bassoon |
| RC-3 | **No reviewer independence.** One agent authored and reviewed. | D08 header; Jane D14 | Core `agents.yaml` + Janus rule: author ≠ reviewer identity for `5_REVIEW`. | bassoon |
| RC-4 | **Idempotency semantics under-specified for derived operations.** | Eval `conflict-retry-reused-opid` | Done here: ADR-004 decision 4 states that rebased/recreated ops get a new opId; unit test enforces it. | this PR |
| RC-5 | **Retryable error codes lacked a defined client behaviour.** | Eval `bulk-writes-rate-limited` | Done here: SDK RATE_LIMITED backoff + test. Proposed: contracts `errors.ts` documents the expected SDK behaviour per code. | this PR / Sprint 2 |
| RC-6 | **Mid-sprint scope change edited the plan retroactively.** | janus-log 23:55; Qz D14 | Core `sprint-template.md`: "Scope changes" table (date, requested by, items, Janus note). | bassoon |

### Persona changes suggested to Nick
- Jane: add "must not be the author of the change under review" to her mandate (RC-3).
- Kumi Wai: own a "repository bootstrap" checklist (RC-2).
- Russ: own emulator-based device checks (RC-1).

From: Coach
