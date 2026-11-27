[UX/UI Design Architect] - [Anansi]
[[CONTEXT: core/personas/jules.md, project-profile.md]]
To: Jules (build), Jane (contract audit), Russ (traversal tests)

## Design Brief: Shell screens for M1–M3 (Doc ID D03)

> Prepared by Claude acting as Anansi (Core v4 persona). Written alongside the build under the Sprint 1 deviation Nick approved on 2026-11-21. Nick has not yet reviewed it.

### A. Executive Summary & Goals
The shell is a calm, single front door: one header that always tells the truth about sync, a grid of apps, and three utility screens (Sync centre, Diagnostics, Settings). Brand promise: **One door, no surprises** (Profile §1). Success: KPI 1 (handshake < 500 ms) and SA-U3 (sync state always visible).

### B. Requirements / User Stories
#### Feature: SA-2026-002, SA-2026-003
* The owner signs in once, then lands on the launcher with every app one tap away.
* The header shows `Synced`, `Pending (n)`, `Offline` or `Error`, and tapping it opens the Sync centre.
* Acceptance criteria: see `docs/features/SA-2026-002_*.md` §2.1 and `SA-2026-003_*.md` §2.1; Russ maps them in D09.

### C. Design Artifacts & Contracts

#### Lo-Fi Wireframes
```text
Setup                      Launcher                         Running app
┌──────────────────────┐   ┌──────────────────────────────┐  ┌──────────────────────────┐
│ Set up Super app     │   │ Super app        ● Pending(3)│  │ ←  Hello ✓               │
│ Server URL [______]  │   │ [Safe mode banner if on]     │  ├──────────────────────────┤
│ Email      [______]  │   │ Apps                         │  │                          │
│ Password   [______]  │   │ [H] [B] [M] …                │  │   sandboxed iframe       │
│ (error, role=alert)  │   │ Hello Budget Media           │  │                          │
│ [Sign in & register] │   │ [Sync centre][Diagnostics]   │  └──────────────────────────┘
└──────────────────────┘   │ [Settings]                   │
                           └──────────────────────────────┘
Sync centre: Status (state, server, last sync, outbox, oldest) · [Sync now] · Needs attention cards
(Compare versions ▸, primary action, secondary action) · Waiting list.
Diagnostics: Health · Apps table (state, handshake, last error) · Filter · Error log · Bridge inspector.
Settings: Server + Sign out · Theme · Safe mode · About.
```

#### Input Model Contract (touch primary; D-pad ready, SA-U4)
Every interactive element is a native `button`, `input`, `select`, `summary` or `label`-associated control, so it is focusable and announces itself. Focus order = DOM order:

| Screen | Focus order | Back / Escape |
| :-- | :-- | :-- |
| Setup | Server URL → Email → Password → Sign in | Android Back exits the app (no surface above) |
| Launcher | Sync status button → app tiles (alphabetical) → Sync centre → Diagnostics → Settings | Back exits the app |
| Running app | Back arrow → iframe content (subapp owns its order) | Back suspends the app and returns to the launcher |
| Sync centre | Back → Sync now → per card: Compare versions → primary → secondary → Waiting list | Back → launcher |
| Diagnostics | Back → Filter select | Back → launcher |
| Settings | Back → Sign out → Theme → Safe mode | Back → launcher |

Visible focus: `:focus-visible { outline: var(--focus-ring) }` globally; never removed. Minimum target size `--tap-target` (48 px).

#### States
| Surface | Loading | Empty | Error | Offline / degraded |
| :-- | :-- | :-- | :-- | :-- |
| Boot | "Starting…" (role=status) | — | Toast "Startup failed" → Setup | Boots from cache; header `Offline` |
| Setup | Button text "Signing in…", disabled | — | Inline `role=alert` message | "Server is unreachable." |
| Launcher | — | "No apps installed yet." | Tile shows `crashed`; toast with reason | Header `Offline` / `Pending (n)` |
| Running app | iframe hidden until handshake | — | Crash → toast + return to launcher | Writes queue locally (`pending: true`) |
| Sync centre | — | "Nothing needs attention." / "Outbox is empty." | Cards per dead/conflict row | Detail "Changes are saved on this phone." |

#### Tokens
All from `apps/shell/src/styles/tokens.css` v1.0.0: colours `--color-bg|surface|surface-raised|text|text-muted|border|accent|accent-text|danger|success|warning|focus`; spacing `--space-1…8`; radii `--radius-sm|md|lg`; type `--font-body|mono`, `--font-size-sm…xl`; `--focus-ring`, `--tap-target`, `--header-height`, `--tile-size`, `--motion-duration` (0.2 s, 0 under reduced motion), `--shadow-raised`. No new tokens proposed.

### D. Rationale & Constraints
- Sync status is a **button**, not a label, so "fail visibly" leads straight to the fix (Sync centre).
- Conflict cards show both versions behind a disclosure to keep the screen calm by default.
- Constraints applied: CORE-20…25, SA-U1…U5. Open question for Eleanor: should `Pending (n)` stay neutral (not warning colour) to avoid alarm when merely offline briefly?

Evidence: implementation `apps/shell/src/App.svelte`, `src/ui/*.svelte`; axe scans in `apps/shell/tests/e2e/*.spec.ts`.
From: Anansi
