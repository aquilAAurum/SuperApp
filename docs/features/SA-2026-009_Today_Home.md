# Feature Name: Today home (agenda-first launcher)

- **Feature ID:** SA-2026-009
- **Version:** 1.0   · **Status:** Proposal   · **Date:** 2026-11-28
- **Owner(s):** Qz   · **T-Shirt Size:** L
- **RICE:** R:1 | I:3 | C:80% | E:1 = 2.4

## 1. Executive Summary
### 1.1 Problem
The launcher is a grid of tiles. It does not answer the owner's real question when they open the phone: *what should I do now, and when do I have time to focus?* Each app keeps its own dates and tasks.
### 1.2 Solution
A **Today** home: Now/Next with a suggested focus window, a week strip, one agenda timeline merging every app's items with free gaps and a now-line, people to reach, daily glances from apps, and quick add. Week view for planning; Apps moves to its own tab. Built on `core_agenda` and `core_glances` (ADR-011).
### 1.3 Business Value & KPIs
- T1: ≥ 1 focus block protected per working day (count `kind=focus` items, `source_app=shell`).
- T2: Reach-out items acted on within 3 days of due (Contacts K5 context).
- T3: Today renders from the local mirror in < 300 ms (offline included).
### 1.4 Hypothesis
Showing free time next to commitments, with one tap to protect it, increases focused hours more than a separate focus app would.
### 1.5 Competitive Landscape
Calendar/task "daily planner" apps; the difference is that every Supra app contributes, offline-first, on the owner's own server.

## 2. Functional Specification
### 2.1 User Stories → tests
| Story | Acceptance | Test |
| :-- | :-- | :-- |
| See my day across apps | Today shows shell items, Contacts dates and reach-outs, EatWell glance | e2e `today.spec.ts` "brings agenda, people, dates and glances…"; integration "Today projections" |
| Know what's now and next | Now card shows current item or free time until next, plus next item | unit `agenda.test.ts` nowNext; e2e |
| Protect free time | "Protect it as focus time" creates a focus block that syncs | unit `service.test.ts`; e2e "protects free time…" |
| Add quickly | + opens a sheet; Event/Task/Reminder/Focus with day, time, length | e2e "quick add…" |
| Plan the week | Week tab lists each day's items and planned focus; tap a day opens it in Today | e2e "quick add…" (week + open day) |
| Apps can't tamper with each other | Writing another app's agenda item or glance → SCOPE_DENIED | unit `handlers.test.ts` |
| Health only if I say so | Steps/active kcal appear only after opt-in; never stored | unit `service.test.ts` |
### 2.2 MVP (MoSCoW)
Must: all of §2.1. Should: Settings toggle for health on Today. Could: drag to reschedule, edit items, device-calendar import. Won't (now): community feed, notification inbox.
### 2.3 Out of Scope
Calendar import from Google/Android calendar (needs its own capability decision).

## 3. UI/UX
See D03 `docs/sprints/today/D03_Today_Design_Brief.md`. Mockups (2026-11-28) are the visual reference.

## 4. Technical & Architectural Overview
ADR-011. Shell: `src/today/agenda.ts` (pure planning), `src/today/service.ts`, `src/ui/today/*`. Server: `pb_migrations/1764547200_core_agenda.js`, `pb_hooks/agenda.pb.js`, `lib/agenda-core.js`.

### 4.4 Data Contract
`core_agenda`: kind (event, task, reminder, focus, date), title ≤ 200, start (`YYYY-MM-DD` or local `YYYY-MM-DDTHH:MM`), end, all_day, status (open, done, skipped), priority 0–3, source_app, source_key, deep_link (`superapp://`), person (core_people), notes ≤ 2000. `core_glances`: app_id, key, date, title ≤ 60, value, unit, target, detail ≤ 120, deep_link; unique (owner, app_id, key, date).

## 5. Security & Privacy
THREAT_MODEL T-40…T-43. Data inventory: Profile §5 rows for `core_agenda` / `core_glances`; health on Today (display only).

## 6. Non-Functional Requirements
Today from mirror < 300 ms; WCAG 2.1 AA (axe on Today, quick add, Week); touch targets ≥ 48 px; reduced motion honoured.

## 7. RAID Log
| Type | Item | Owner |
| :-- | :-- | :-- |
| Risk | Server projections only verified by CI integration tests until deployed to the mini PC | Theo |
| Assumption | Mini PC local time zone = owner's (key dates roll at local midnight) | Theo |
| Decision | Health on Today (ADR-011 §5) and the new core collections: accepted by Nick 2026-11-28 | Nick |

## 8. Release & Operations
Deploy server (`tools/deploy-server.ps1`) before installing the APK, so projections exist. Rollback: previous APK + previous server bundle; the new collections are additive. Projections are rebuilt from source data at every server start, nightly, and via superuser `POST /api/sa/agenda/rebuild`, so data that predates the deploy appears without being edited (found on device 2026-11-28: Today was empty until then).

## 10. Governance
Sign-off: Qz, Anansi, Jane, Mara, Russ, Priya, Nick.

## Appendix: Change Log
- 1.0 (2026-11-28): initial, from Nick's mockups.
- 1.1 (2026-11-28): full rebuild of projections (startup, nightly, superuser endpoint); "free for the rest of the day" shown only when something is timed.
