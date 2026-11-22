# Eval case: E2E selector matched two elements

| Field | Content |
| :--- | :--- |
| `persona` | russ |
| `state` | 3_BUILD |
| `trigger` | E2E strict-mode violation in `sync.spec.ts` (local run) |
| `input` | D03 (header status became a button labelled '… Open Sync centre.') |
| `bad_output` | `getByRole('button', { name: 'Sync centre' })` |
| `fixed_output` | `{ exact: true }` in 218f497 |
| `Human_Preference_Rating` | Pending Nick |
| `lesson` | When a design adds an accessible name that contains another control's name, update selectors to exact names in the same change. |
