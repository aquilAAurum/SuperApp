# Eval case: CodeQL template assumed code scanning upload was available

| Field | Content |
| :--- | :--- |
| `persona` | kumi-wai |
| `state` | 3_BUILD |
| `trigger` | Gate failure: CodeQL upload 'Resource not accessible by integration', https://github.com/aquilAAurum/SuperApp/actions/runs/44963469046 |
| `input` | Core template-repo `codeql.yml` |
| `bad_output` | `.github/workflows/codeql.yml` at 7696e42 |
| `fixed_output` | Nick enabled CodeQL Advanced (fdb1fa5); pinned and merged in 8a1ebf9 |
| `Human_Preference_Rating` | Pending Nick |
| `lesson` | Step 0 should report whether code scanning is enabled (a MANUAL item until it is), and the template should say what to do on private personal repos. |
