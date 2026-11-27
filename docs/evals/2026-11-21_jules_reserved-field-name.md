# Eval case: PocketBase migration used a reserved field name

| Field | Content |
| :--- | :--- |
| `persona` | jules |
| `state` | 3_BUILD |
| `trigger` | Gate failure: CI PocketBase integration, https://github.com/aquilAAurum/SuperApp/actions/runs/44963469068 |
| `input` | Spec §Data layer (`processed_ops` ledger) |
| `bad_output` | `server/pb_migrations/1763740800_core_collections.js` at 087a9a2 (`collectionName` field) |
| `fixed_output` | 0fb7c2d (`targetCollection` + unit guard `server/tests/unit/migrations.test.ts`) |
| `Human_Preference_Rating` | Pending Nick |
| `lesson` | Platform-reserved names must be checked by a unit test before CI boots the real platform; Core template should ship such a guard per platform. |
