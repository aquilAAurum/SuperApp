# Eval case: Bulk writes from a subapp hit the bridge rate limit

| Field | Content |
| :--- | :--- |
| `persona` | jules |
| `state` | 3_BUILD |
| `trigger` | E2E `sync.spec.ts` › 100 airplane-mode writes (caught before commit) |
| `input` | Spec §Security (50 req/s per app) and §SDK |
| `bad_output` | SDK without retry; `data.subscribe` reloaded on every change event |
| `fixed_output` | 8676b5d (SDK backs off on retryable RATE_LIMITED; subscription reloads debounced) |
| `Human_Preference_Rating` | Pending Nick |
| `lesson` | Every retryable bridge error code needs a defined SDK behaviour; acceptance tests should include a burst case. |
