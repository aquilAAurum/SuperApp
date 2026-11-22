# Retrospective Feedback: Sprint 1 (Doc ID D14, one report per delivery persona)

> Prepared by Claude acting as each delivery persona. Evidence links are to CI runs, commits and eval cases in this repo.

---

## Retrospective Feedback Report (Doc ID D14)
**Reporting persona:** Qz, Product Manager   **Scope:** Sprint 1
### A. Successes
- The verbatim spec in `docs/spec.md` made every acceptance criterion traceable to a test (D09).
### B. Challenges & Blockers
- Scope grew from M1–M2 to M1–M3 mid-sprint (janus-log 2026-11-21 23:55). The plan (D01) had to be amended after the fact.
### C. Proposed Improvements
- Sprint template: add a "scope change" row that Janus fills when Nick widens scope, instead of editing §2 retroactively.

## Retrospective Feedback Report (Doc ID D14)
**Reporting persona:** Anansi, UX/UI Design Architect   **Scope:** Sprint 1
### A. Successes
- axe-core found zero WCAG 2.1 AA violations on five screens (https://github.com/aquilAAurum/SuperApp/actions/runs/44964342040).
### B. Challenges & Blockers
- D03 was written after the screens, so the Input Model Contract documents what exists rather than steering it (approved deviation).
- Turning the sync status into a button changed its accessible name and broke an E2E selector (eval `2026-11-21_russ_ambiguous-e2e-selector`).
### C. Proposed Improvements
- Feature template §3.2: list accessible names of new controls so Russ can update selectors in the same change.

## Retrospective Feedback Report (Doc ID D14)
**Reporting persona:** Mara, Security Engineer   **Scope:** Sprint 1
### A. Successes
- Red-team probes run as E2E on every push (forged handshake, sandbox network/DOM/storage/cookie probes).
### B. Challenges & Blockers
- An integration test checked the admin path instead of the phone's token (eval `2026-11-21_jules_superuser-hidden-fields`, https://github.com/aquilAAurum/SuperApp/actions/runs/44963758017).
- Code scanning availability was assumed, not checked (eval `2026-11-21_kumi-wai_codeql-upload-assumption`).
### C. Proposed Improvements
- Threat model template: each High threat names the **principal** its verifying test uses.

## Retrospective Feedback Report (Doc ID D14)
**Reporting persona:** Jules, Autonomous Coder & System Integrator   **Scope:** Sprint 1
### A. Successes
- Running the real server logic (`server/pb_hooks/lib/ops.js`) inside shell unit and E2E tests caught the opId-reuse bug before commit (eval `2026-11-21_jules_conflict-retry-reused-opid`).
### B. Challenges & Blockers
- The authoring sandbox could not execute PocketBase, so two server defects surfaced only in CI (evals `reserved-field-name`, `superuser-hidden-fields`).
### C. Proposed Improvements
- Add platform guard tests (reserved names, rule syntax) that run without the platform binary.

## Retrospective Feedback Report (Doc ID D14)
**Reporting persona:** Kumi Wai, Integration & CI Gatekeeper   **Scope:** Sprint 1
### A. Successes
- All four CI jobs went green on the third push; the Android APK built in CI on the first attempt.
### B. Challenges & Blockers
- No `main` branch existed, so no PR and no PR-triggered checks until 2026-11-22 (eval `2026-11-21_kumi-wai_missing-main-branch`).
### C. Proposed Improvements
- Core template-repo README: "create `main` from the template's first commit before pushing any working branch"; Step 0 MANUAL item for default branch and code scanning.

## Retrospective Feedback Report (Doc ID D14)
**Reporting persona:** Jane, Peer Review / Architecture Auditor   **Scope:** Sprint 1
### A. Successes
- Architecture rules are lint errors (verified with a deliberately violating file); review time went to behaviour (D08 J-1, J-2).
### B. Challenges & Blockers
- D08 was produced by the same agent that wrote the code: no reviewer independence (D08 header).
### C. Proposed Improvements
- `core/agents.yaml`: assign Jane to a different engine or session than Jules, and have Janus refuse `5_REVIEW` when author and reviewer are the same identity.

## Retrospective Feedback Report (Doc ID D14)
**Reporting persona:** Russ, QA Lead / Test Strategist   **Scope:** Sprint 1
### A. Successes
- Every acceptance criterion maps to an automated test; 148 unit + 14 E2E + 9 integration tests.
### B. Challenges & Blockers
- Two critical criteria need a physical phone (D10 R-5, R-6) and no device run is scheduled.
### C. Proposed Improvements
- Add an Android emulator E2E job (CI) for the handshake timing and SQLCipher check, keeping the on-device run for the release gate only.

## Retrospective Feedback Report (Doc ID D14)
**Reporting persona:** Theo, Release & SRE   **Scope:** Sprint 1
### A. Successes
- Tag-only release workflow with SBOM and provenance is in place; debug APK is produced on every push.
### B. Challenges & Blockers
- No signing keystore, no mini PC deployment, no backup/restore test yet (D11 operational readiness: Partial).
### C. Proposed Improvements
- Sprint 2 opens with a release dry-run (`v0.1.0-rc.1`) and a restore test, recorded in D12 and D19.
