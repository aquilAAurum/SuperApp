[UX/UI Design Architect] - [Anansi]
[[CONTEXT: core/personas/jules.md, project-profile.md]]
To: Jules (build), Jane (Input Model Contract audit), Russ (traversal tests)

## Design Brief: Contacts subapp (Doc ID D03)

> Prepared by Claude acting as Anansi for Sprint R0 of SA-2026-007. Awaiting Jane's audit and Nick's review.

### A. Executive Summary & Goals
Contacts is a **launcher first, records second** app: from anywhere you are at most three taps from talking to someone through the right channel and account. Around that sit Today (who's due), the network (graph, Who I know, warm paths) and campaigns. Success: K1 taps to reach ≤ 3 (≤ 2 from Today), K2 channel open p50 < 1 s, K3 zero wrong-identity sends, K5 touch capture ≥ 80 % (PRD §1.3). Brand promise "one door, no surprises" (Profile §1): the app always says **which account** it is about to use.

### B. Requirements / User Stories
#### Feature: SA-2026-007
* Reach someone: search or Today → card → primary action → external app → back → quick-log.
* Stay current: Today lists overdue and due people with their primary action; health is shown with icon and text.
* Find a way in: Who I know at an org, shared background, path to a person, graph view.
* Run a campaign: targets, stages, next steps feeding Today.
* Acceptance criteria: PRD §3.1 (E1–E7) and §4.4.0; Russ maps them in D09.

### C. Design Artifacts & Contracts

#### Information architecture
```text
Contacts (subapp)
├── Header: lens  [All · Work · Professional · Personal] ▾ context   ·   search
├── Today (home)        due / overdue / dates / snoozed returning
├── People              search results, smart lists
│   └── Card            primary action, alternates, details, timeline, shared background
├── Network             graph view (built), Who I know at…, path finder
│   └── Org             people (current / former), linked orgs, my roles there
├── Campaigns           list → campaign board (stages) → target
└── Settings            contexts & identities (Test compose), channel availability, defaults, import & export
Sheets (modal, bottom): cross-context guard · quick-log · snooze · template picker
```

#### Lo-Fi Wireframes
```text
Today                                   Card                                    Guard sheet
┌───────────────────────────────────┐   ┌───────────────────────────────────┐   ┌───────────────────────────────────┐
│ Contacts   [Work ▾]          🔍    │   │ ←  Ava T.           ● Overdue 26d │   │ Send from a different account?    │
│ Today · 10 due (6 overdue)         │   │ Director of Ops · Northwind Foods │   │ Ava is a Work › USCD contact.     │
│ ┌───────────────────────────────┐ │   │ Work › USCD (primary) · Prof › …  │   │ This email would come from        │
│ │ ● Overdue 26d  Ava T.         │ │   │ ┌───────────────────────────────┐ │   │ Milford (Outlook).                │
│ │ Northwind · last: call Jun 8  │ │   │ │  Teams chat · USCD           ▸│ │   │ [Use USCD email instead]          │
│ │ [Teams chat · USCD]  [⋯]      │ │   │ └───────────────────────────────┘ │   │ [Send from Milford anyway]        │
│ └───────────────────────────────┘ │   │ USCD email · GV text · GV call ·  │   │ [Cancel]                          │
│ ┌───────────────────────────────┐ │   │ LinkedIn                 Why? ⓘ  │   └───────────────────────────────────┘
│ │ ● Due today   Ben O.          │ │   │ Phone  +1 … (GV)   Email  …       │
│ │ [GV text · Baypath]  [⋯]      │ │   │ Timeline · Shared background ·    │   Quick-log sheet (after return)
│ └───────────────────────────────┘ │   │ Relationships · Campaigns · Notes │   ┌───────────────────────────────────┐
│ Dates: Lee P. birthday Mar 14     │   └───────────────────────────────────┘   │ How did it go? Teams chat · USCD  │
│ [Today][People][Network][Campaigns]│                                          │ [Talked][Left msg][No answer]     │
└───────────────────────────────────┘                                          │ [Sent][Scheduled]   Note [_____]  │
                                                                               │ [Save]  (dismiss: nothing logged)│
Network                                 Settings › Identities                   └───────────────────────────────────┘
┌───────────────────────────────────┐   ┌───────────────────────────────────┐
│ [Graph][Who I know][Path]         │   │ Work › USCD                       │
│ graph canvas (built viewer):      │   │  USCD email · Google   [Test]  ✓  │
│ focus 1–3 hops, colour lenses,    │   │  Teams · USCD          [Test]  ✓  │
│ fold, filters, path finder        │   │  Google Voice          [Test]  ✓  │
│ Who I know at [ org …… ]          │   │ Professional › Milford            │
│  Current (4) · Former (11)        │   │  Milford email · Outlook [Test] ⚠ │
└───────────────────────────────────┘   │  ⚠ Outlook can't force the account│
                                        └───────────────────────────────────┘
```

#### Input Model Contract (touch primary; D-pad ready, SA-U4)
Native `button`/`a`/`input`/`select` only; DOM order = focus order; the subapp owns order inside its iframe.

| Screen | Focus order | Back / Escape |
| :-- | :-- | :-- |
| Today | Lens select → Search → each row: primary action → ⋯ (snooze, log, open card) → Dates rows → tab bar | Back → shell launcher |
| Card | Back → primary action → alternates (rank order) → Why? → contact points (copy) → section tabs → section content | Back → previous screen (Today/People/Network) |
| People | Back → search input → filter chips → result rows (row = open card; trailing primary action) | Back → Today |
| Network | Back → view tabs (Graph / Who I know / Path) → view controls → results | Back → Today; in graph, Escape clears selection first |
| Org | Back → Who I know list (current, then former) → linked orgs → my roles | Back → previous |
| Campaigns | Back → New → campaign rows → (board) stage columns as lists, each target row → stage buttons (no drag) | Back → list → Today |
| Settings | Back → Contexts → each identity: Test compose → edit → Channel availability → Import & export | Back → Today |
| Guard sheet | "Use <context> account instead" (default focus) → "Send from … anyway" → Cancel | Back/Escape = Cancel (nothing launched) |
| Quick-log sheet | Outcome buttons → Note → Save | Back/Escape logs nothing; the Today row shows a "Log it?" chip until tomorrow (E3.1, Q11) |

Visible focus: `:focus-visible { outline: var(--focus-ring) }`; targets ≥ `--tap-target`. Health and stage are never colour-only (icon + text).

#### States
| Surface | Loading | Empty | Error (toast) | Offline / degraded |
| :-- | :-- | :-- | :-- | :-- |
| Today | Skeleton rows from mirror (instant) | "Nobody is due. Next: <name> on <date>." / before import: "Import your contacts to start" → Settings › Import | "Couldn't load Today" + Retry | Works from mirror; header shows shell sync state |
| Card | — | Missing channel data: alternates show "Add a number" | Launch failed: "WhatsApp isn't installed. Opened the web version." / "Couldn't open Teams" | Launch works offline; quick-log queues |
| Search | — | "No one matches 'x'." + Create contact | — | Local mirror search (E6.1) |
| Network / graph | Layout runs progressively | "No links yet" | — | Mirror only |
| Campaign | — | "No targets yet" + Add targets | Stage change conflict → shell Needs attention | Queues |
| Identities | — | Seeded contexts with empty addresses: "Add the address for USCD email" | Test compose failed: shows mechanism used (ADR-007) | — |

#### Tokens
Shell token set v1.0.0 (`apps/shell/src/styles/tokens.css`), passed to the subapp by the SDK theme: `--color-bg|surface|surface-raised|text|text-muted|border|accent|accent-text|danger|success|warning|focus`, `--space-1…8`, `--radius-sm|md|lg`, `--font-body|mono`, `--font-size-sm|md|lg|xl`, `--tap-target`, `--motion-duration`, `--shadow-raised`. Health: overdue `--color-danger`, due soon `--color-warning`, within cadence `--color-success`, each with an icon. **No new tokens.** The graph view's kind colours (people/orgs/roles/projects/events/groups) are data colours local to the graph, documented in Supra---Contacts `docs/graph-usability.md`, not shell tokens.

### D. Rationale & Constraints
- **Primary action is one big button with the identity in its label** ("Teams chat · USCD"), so the user sees the account before tapping (K3, "no surprises").
- **Guard sheet defaults to the safe choice** (the membership's own account); overriding takes a deliberate second button.
- **No drag and drop** in campaign boards: stage buttons work with touch and D-pad (SA-U4).
- **Graph view reused** from Supra---Contacts `src/viewer/` (CSP-safe, touch and pinch, tested at ~1,400 nodes).
- Constraints: SA-C3 (sandbox, SDK only), SA-U1…U5, HB-SEC-04 (no HTML sinks; notes and templates rendered as text/sanitised Markdown).
- Quick-log dismissal (Q11, Nick 2026-11-27): dismissing logs nothing; the person stays due and the row shows a "Log it?" chip until tomorrow, so K5 counts only real logs.

From: Anansi
