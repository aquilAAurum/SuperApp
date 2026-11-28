---
id: ADR-011
title: Today home built on shared core_agenda and core_glances collections
status: Proposed
date: 2026-11-28
decided_by: nick
supersedes: []
---

# ADR-011: Today home, `core_agenda` and `core_glances`

## 1. Context

Nick asked for the launcher to become a unified view centred on the calendar/agenda, to help manage time and focus, drawing on data from every app (mockups shared 2026-11-28: daily dashboard, unified agenda feed, calendar-centric communication, health hub, community calendar). The shell owns no domain features and must not read other apps' private collections (spec principles; ADR-006 §3), and Health Connect readings must never be stored (ADR-010 §8).

## 2. Decisions

| # | Decision | Rationale |
| :-- | :-- | :-- |
| 1 | Two new **core synced collections**: `core_agenda` (events, tasks, reminders, focus blocks, dates: `start`/`end` local times, `all_day`, `status`, `source_app`, `source_key`, `deep_link`, `person`) and `core_glances` (one card per app, key and day: value, unit, target, detail, deep link). | One shared, app-agnostic contract the home screen (and later TV/desktop shells, other apps) reads; nothing in the shell knows Contacts' or EatWell's schemas. |
| 2 | Apps write them through the existing `data.*` methods with `core.agenda.write` / `core.glances.write`; the shell enforces **per-record ownership**: an app may only create, change or delete records whose `source_app` / `app_id` is its own id. | The core scope alone would let one app rewrite another's items; this keeps every contribution attributable. |
| 3 | **Server projections** for existing apps (same pattern as `core_people`, ADR-006): Contacts key dates → `date` items (next occurrence, age for birthdays; daily cron rolls recurring dates), Contacts reach-out due dates → `task` items with `person`, EatWell entries and water → the `eatwell/intake` glance. Deterministic ids (md5 of owner + key) make projections idempotent. | Real data on day one without editing other teams' subapps; one writer per projected record. |
| 4 | The shell writes its own items with `source_app = "shell"` (quick add, "Protect it as focus time"); only these can be ticked off on Today. Other apps' items open their app via `deep_link`. | Completing "Reach out to Ben" belongs in Contacts (it logs a touch), not in the shell. |
| 5 | **Health on Today is opt-in, off by default** (Settings toggle, preference `today.health`). When on, the shell reads today's steps and active calories as one aggregate from Health Connect through the CapabilityBroker; values are shown only, never stored, logged or synced. | Health data is the most sensitive data Supra handles; the owner decides whether it appears on the home screen. |
| 6 | Design tokens **v1.1.0**: green accent (`#1f7a43`, AA with white text), light card surfaces, role-named agenda kind colours; dark theme kept. | Mockups' visual direction within CORE-21/23. |

## 3. Consequences

- New migration `1764547200_core_agenda.js`, hooks `agenda.pb.js` + `lib/agenda-core.js`; shell `src/today/*`, `src/ui/today/*`; the old launcher becomes the **Apps** tab.
- Other apps (and future calendar imports) contribute by writing `core_agenda` with their own `source_app`; a device-calendar import (READ_CALENDAR) is a separate decision with its own ADR.
- Not in this change: notification inbox (M5), community/moments feed (no data source yet), editing items after creation.

## 4. Approval

Adds core collections and a new place where health data is displayed, so it needs Nick's approval.
