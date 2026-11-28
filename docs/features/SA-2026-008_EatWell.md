# Feature Name: EatWell (food diary and activity subapps)

- **Feature ID:** SA-2026-008
- **Doc ID:** D02 (PRD)   · **Producer:** Qz   · **Consumers:** Jane, Jules, Priya, Kumi Wai, Russ
- **Version:** 0.1   · **Status:** Proposal (for Nick's approval; R1 built in `subapps/eatwell`, state `3_BUILD`; Health Connect bridge per ADR-010, Accepted 2026-11-28)   · **Date:** 2026-11-28
- **Owner(s):** Qz (content), Nick (approval)
- **Subapp ids:** `eatwell` (R1, built). Planned: `mealplan` (R3).
- **Depends on:** SA-2026-003 (data and sync), ADR-010 (Health Connect, consent sheet; Accepted). R2 depends on M4 camera/files and an M6 server proxy.

## 1. Problem and goal

EatWell (aquilAAurum/EatWell, earlier "NutriSnap") is a standalone vibe-coded app: a React web app plus a separate native Android app, with data in `localStorage`/Room, a client-side Gemini key, OpenFoodFacts calls from the phone, and its own Health Connect code. It does too much (AI coaching, family meal plans) and is not part of Supra.

**Goal:** a calm food diary inside Supra that feels like Fitbit's Today screen and LoseIt's budget, without ads, upsells or coaching. Everything syncs to the owner's server; activity comes from Health Connect through Supra.

## 2. Principles (design brief)

1. **One number first.** Today opens on "calories left" in a ring, with the LoseIt equation under it: *budget − food + exercise*.
2. **Facts, not advice.** No coaching cards, tips, badges or streak nags. Trends show numbers and charts; the owner draws conclusions.
3. **Two taps to log.** Recents and favorites are one tap from each meal; servings and meal can be changed before adding.
4. **Calm visuals.** White (or dark) cards, a teal accent, big tabular numbers, colour never the only signal, 48 px targets, WCAG 2.1 AA (axe in E2E).
5. **Phone privileges only through Supra.** Health Connect, haptics (and later camera and notifications) go through the bridge with Supra's consent sheet.

## 3. Scope by release

| Release | Subapp | Scope | State |
| :-- | :-- | :-- | :-- |
| **R1** | `eatwell` | Today (date switcher, budget ring, macros, meals), add food (search over 139 builtin foods, own foods, recents, favorites, quick add calories, servings), water (+/−), weight log, Trends (weight vs goal with ETA, calories vs budget, steps), Foods (own foods, favorites), Goals (Mifflin-St Jeor budget, weekly rate, safety floor, override, macro split, water goal, units). Health Connect: activity tiles (steps, active calories, exercise, sleep), exercise calories added to the budget, meals/weight/water written back. Gentle mode (low-residue choices first, from the Crohn's flare work in the old app). | **Built** (this change) |
| R2 | `eatwell` | Barcode scan and packaged-food search (camera via M4 `files.pick`/camera; OpenFoodFacts through a server proxy, M6 pattern, so the phone never calls it directly). Copy a previous day / meal. Per-meal reminders (opt-in, `notify.post`). Import from the old app's JSON export. | Planned |
| R3 | `mealplan` | Weekly meal planner (own recipes, family variants); logs planned meals into EatWell over the bus (M5 `eatwell.entry.create` request). Optional AI meal ideas via `ai.chat` (M6) with no coaching. | Planned |

**R1.1 (0.2.0, after first phone use):** search returned nothing for ordinary words because the list had 139 foods and plurals did not match ("eggs" vs "Egg"). Fixed by singular-insensitive matching and a bundled reference database of 6,494 foods per 100 g (TempoLife dataset, CC-BY-4.0, mostly USDA SR Legacy; attribution in the Foods tab, `subapps/eatwell/data/README.md`), logged by weight (g or oz). Curated foods with real servings still rank first. Shipped as a subapp update (ADR-009), no APK.

Out of scope: ads, coaching, social features, a subscription tier, AI photo calorie estimation (unreliable; may return as an explicit "estimate" in R3).

## 4. Data (server: `server/pb_migrations/1764460800_eatwell.js`)

| Collection | Holds | Notes |
| :-- | :-- | :-- |
| `eatwell_entries` | Diary entries: local `date`, `meal`, name/brand, servings × serving label, nutrient totals, `food_ref` (builtin key or own food id), `logged_at` | Index (owner, date) |
| `eatwell_foods` | Own foods (per-serving nutrients) and favorite marks for builtin foods (`builtin_ref`) | |
| `eatwell_weights` | One weight per day (kg) | |
| `eatwell_water` | Water additions (ml) | |
| `eatwell_settings` | Profile and goals (units, sex, birth year, height, activity, goal weight, weekly rate, override, macro split, water goal, toggles) | One live record |

All are synced collections (version, soft delete, owner-only rules, writes only through `/api/sa/ops`). Health Connect readings are **not** stored (ADR-010 §8).

## 5. Budget math (unit-tested in `subapps/eatwell/src/model.test.ts`)

- BMR: Mifflin-St Jeor (sex-neutral constant −78 when sex is not given).
- Maintenance = BMR × activity factor (1.2 to 1.9). With *add exercise* on and Health Connect connected, the factor is 1.2 and the day's active calories are added, so movement counts once.
- Weekly goal → daily adjustment: rate × 7,700 kcal/kg ÷ 7.
- Safety floor 1,200 kcal (female or unspecified) / 1,500 (male); the Goals screen says when it applied.
- Macro targets from the % split (4/4/9 kcal per g). Default budget 2,000 until a profile and a weight exist.

## 6. Acceptance (R1)

| ID | Criterion | Evidence |
| :-- | :-- | :-- |
| EW-1 | Logging a food writes one `eatwell_entries` record through ops and updates "left" | E2E `eatwell.spec.ts` "logging a food …" |
| EW-2 | Budget, totals, scaling, search, units, trends math correct | Unit `model.test.ts` (17 tests) |
| EW-3 | Without Health Connect the app explains instead of offering Connect | E2E "without Health Connect …" |
| EW-4 | Today, add food, serving, Trends, Foods, Goals pass axe WCAG 2.1 AA | E2E "EatWell screens meet WCAG 2.1 AA" |
| EW-5 | Health reads/writes only after Supra consent + Health Connect grant; values never logged | Unit `device-handlers.test.ts`, `router.test.ts` (consent); **manual on phone after the new APK** |
| EW-6 | Server accepts valid diary records only through ops, owner-only | Integration "eatwell subapp collections" |

## 7. Migration from the old EatWell

The old app keeps data on the device (`nutrisnap_*` localStorage keys; Room on Android) and has a JSON export. R2 adds an importer for that export. Until then the old app can keep running side by side. The old repo's client-side Gemini key and direct OpenFoodFacts calls are not carried over.
