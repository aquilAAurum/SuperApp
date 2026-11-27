# Eval case: Conflict retry reused the original idempotency key

| Field | Content |
| :--- | :--- |
| `persona` | jules |
| `state` | 3_BUILD |
| `trigger` | Unit tests `sync.test.ts` › Needs attention actions (caught before commit) |
| `input` | ADR-004 decision 4 |
| `bad_output` | First draft of `apps/shell/src/sync/resolve.ts` (rebased rows kept their opId; server correctly replayed the old 409) |
| `fixed_output` | 37b2c9b (`resolveRow` issues a new opId for rebase and recreate) |
| `Human_Preference_Rating` | Pending Nick |
| `lesson` | Any operation whose payload or base changes is a new operation and needs a new idempotency key; write the replay case into the test first. |
