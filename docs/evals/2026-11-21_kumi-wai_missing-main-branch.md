# Eval case: PR could not be opened: no main branch

| Field | Content |
| :--- | :--- |
| `persona` | kumi-wai |
| `state` | 4_INTEGRATION |
| `trigger` | Process failure: the first push to an empty repo made the working branch the default; creating `main` needed Nick's approval |
| `input` | Nick: 'Open PR and continue' |
| `bad_output` | No base branch; CI did not run on the working branch |
| `fixed_output` | `main` created at deb402b with Nick's approval; CI also triggers on `ccr-*` (ac0fcf9) |
| `Human_Preference_Rating` | Pending Nick |
| `lesson` | For a new repo, create `main` with the template's first commit before any working branch is pushed; add it to the template-repo README steps. |
