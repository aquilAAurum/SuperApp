# Eval case: Integration test asserted the wrong security boundary

| Field | Content |
| :--- | :--- |
| `persona` | jules |
| `state` | 3_BUILD |
| `trigger` | Gate failure: CI PocketBase integration, https://github.com/aquilAAurum/SuperApp/actions/runs/44963758017 |
| `input` | THREAT_MODEL T-12 (no integration secret on the phone) |
| `bad_output` | `server/tests/integration/server.test.ts` at 0fb7c2d (checked the superuser response) |
| `fixed_output` | fec1f0c (checks list and view with the owner token the phone holds) |
| `Human_Preference_Rating` | Pending Nick |
| `lesson` | Security tests must exercise the principal that crosses the trust boundary (the phone's token), not an admin path. |
