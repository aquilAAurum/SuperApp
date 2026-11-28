[UX/UI Design Architect] - [Anansi]
[[CONTEXT: core/personas/jules.md, project-profile.md]]
To: Jules, Jane, Russ

## Design Brief: Today home, Week, quick add (Doc ID D03)

> Prepared by Claude acting as Anansi from Nick's mockups (2026-11-28). Awaiting Nick's review.

### A. Goals
Calendar-centric home that answers "what now, what next, when can I focus" using every app's data (SA-2026-009).

### B. Wireframe
```text
┌ green header ───────────────────────┐
│ ~Supra~                  [● Synced] │  h1 brand · sync status button
│ Good morning, Nick                  │
│ Saturday, November 28               │
│  M  T  W  T  F [S] S   ← week strip │  dots = items per day
└─────────────────────────────────────┘
┌ Now card ───────────────────────────┐
│ FREE TIME  2 h 25 min until 12:30   │  or NOW: <item> until …
│ [Protect it as focus time]          │
│ Next: Lunch with Sam at 12:30       │
└─────────────────────────────────────┘
People to reach  (BO) (M)               ← Contacts reach-outs, overdue days
Still open       □ shell task · 2 d late
Agenda  [Birthday: Ada (35) · Contacts] ← all-day chips
 09:00 ▌Standup              ─ You
 ───── now 10:02 ───────────           ← now-line
 10:02 ┆ Free · 2 h 28 min ┆           ← free gaps (dashed)
 12:30 ▌Lunch with Sam
Today at a glance [Eaten today 1240/2000 ▓▓░ 1.2 L water] [Activity*]
Apps  (H) (C) (E)  All apps →
Sync centre · Diagnostics
[ Today | Week | (+) | Apps | Settings ]  ← bottom nav
```
\* Activity glance only when the owner turned on health on Today.

### C. Input Model Contract (touch; D-pad ready)
Focus order: sync status → week days (7) → focus action → people → still-open items → all-day chips → timeline items (checkbox, then title) → glances → app tiles → All apps → Sync centre → Diagnostics → bottom nav (Today, Week, +, Apps, Settings). Quick add sheet: What → type (4 radios) → Day → Time → Length → Cancel → Add; Escape or Android Back closes. Visible focus ring on every control (`--focus-ring`).

### D. States
| Surface | Empty | Offline | Error |
| :-- | :-- | :-- | :-- |
| Now card | "Your day is open" | From mirror | — |
| Agenda | "Nothing planned. Add something" | From mirror; quick add queues | Toast |
| Glances | Section hidden | Last synced values | — |
| Quick add | — | Saved locally, syncs later | Inline `role=alert` |

### E. Tokens (v1.1.0)
New: `--color-accent-soft`, `--color-kind-{event,task,focus,date,reminder}` and `-soft`, `--color-now`, `--shadow-card`, `--radius-xl`, `--nav-height`. Accent changed to `#1f7a43` (white text ≥ 4.5:1). Jane signs off the token bump (minor version: additive + accent value).

### F. Accessibility notes
Visible text is part of each control's accessible name (axe `label-content-name-mismatch` caught three cases during build; fixed with visually-hidden text instead of `aria-label`).

From: Anansi
