# EatWell subapp (`eatwell`)

Food diary for Supra: calories left against a daily budget, macros, meals, water, weight, trends and goals. Activity (steps, active calories, exercise, sleep) comes from Health Connect **through the Supra bridge**; meals, weight and water can be written back. No ads, no coaching.

- Feature doc: [`docs/features/SA-2026-008_EatWell.md`](../../docs/features/SA-2026-008_EatWell.md)
- Health Connect bridge: [`docs/adr/ADR-010_Health_Connect_Capability.md`](../../docs/adr/ADR-010_Health_Connect_Capability.md)
- Server schema: `server/pb_migrations/1764460800_eatwell.js`

| File | What |
| :-- | :-- |
| `src/model.ts` | Pure logic: budget (Mifflin-St Jeor, weekly rate, floor, exercise), day totals, search, recents, units, trends (unit-tested) |
| `src/foods.ts` | 139 builtin foods with per-serving nutrients (offline search) |
| `src/health.ts` | `sa.device.health.*` glue: status, connect, day activity, series, best-effort writes |
| `src/data.ts` | Loads `eatwell_*` from the shell mirror, reloads on change |
| `src/charts.ts` | SVG ring, bars, line (DOM APIs only) |
| `src/main.ts` | Screens: Today, add food, serving, quick add, own food, weight, Trends, Foods, Goals |

```bash
pnpm --filter @superapp/subapp-eatwell dev     # standalone with the SDK dev mock (fake Health Connect data)
pnpm vitest run subapps/eatwell                # unit tests
pnpm publish:subapp eatwell                    # ADR-009 bundle into published/
```

Health Connect needs the shell APK built from the same change (API 1.1); on an older shell the app runs without activity data and says so.
