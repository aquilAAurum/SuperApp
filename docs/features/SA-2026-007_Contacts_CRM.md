# Feature Name: Contacts & Relationship Manager ("Rolodex" subapp)

- **Feature ID:** SA-2026-007
- **Doc ID:** D02 (PRD)   · **Producer:** Qz   · **Consumers:** Anansi, Mara, Priya, Jules, Kumi Wai, Russ, Jane, Theo, Arthur, Janus, Board
- **Version:** 0.6   · **Status:** Proposal (Sprint R0, for Nick's approval; data layer and vault migration built in Supra---Contacts)   · **Date:** 2026-11-27
- **Owner(s):** Qz (content), Nick (approval)   · **T-Shirt Size:** XL (delivered as six sprint-sized increments, §11)
- **RICE:** R:1 | I:3 | C:70% | E:3 = 0.7 (single-owner product; Impact 3 because it replaces a daily-use tool)
- **Subapp id:** `contacts` (collections `contacts_*`, events `contacts.*`, deep links `superapp://contacts/...`)
- **Depends on:** SA-2026-003 (M3 data & sync), SA-2026-004 (M4 capability broker, contacts, external launch), SA-2026-005 (M5 notifications inbox, deep links, bus)
- **Planning only.** This document is the holistic spec for later build sprints. No code is part of this deliverable.

---

## 1. Executive Summary

### 1.1 Problem

The current CRM is a set of Markdown notes in an Obsidian vault (one note per person/organisation, YAML front matter, wikilinks). It is good for writing and bad for *acting*:

1. **Reaching someone takes too many steps.** From a note you still have to remember *how* you talk to that person (WhatsApp? Teams? personal Gmail? Google Voice so your cell stays private?), switch apps, find them again, and pick the right *from* account. Mistakes happen: a work email from a personal address, a personal text from a work line.
2. **Networks are blurred.** Work colleagues, the wider professional network and personal relationships live in one vault with only tag discipline to separate them. There is no "work mode" that guarantees you only see and use work identities.
3. **Cadence is invisible.** "Last contacted" lives in front matter that is edited by hand, if at all. Nothing tells you who is overdue.
4. **The network can't be queried.** Shared employers, shared alma maters and warm-intro paths are buried in prose and wikilinks. Dataview queries are brittle and don't run on the phone.
5. **Campaigns are ad hoc.** Outreach drives (sponsorship asks for Baypath, a job search, a board recruitment, holiday cards) are tracked in separate lists with no link to the people records or touch history.

### 1.2 Solution

A lightweight, phone-first contact manager with CRM attributes, delivered as a SuperApp subapp. Its centre of gravity is the **launcher**: open a person, tap once, and the app opens the *right channel* (phone, Google Voice, SMS, WhatsApp, Teams, email from the *right account*, or LinkedIn) with the number/address/message pre-filled. Around the launcher sit four capabilities:

| Pillar | What it does |
| :-- | :-- |
| **Launcher** | Channel resolver chooses the best channel and from-identity per contact and context; one-tap primary action, ranked alternates, "why this?" explanation. |
| **Three networks** | Every contact belongs to **Work**, **Professional** and/or **Personal**, each with its own default channels and from-identities. A global **network lens** hides everything outside the chosen network; a cross-context guard stops wrong-account sends (e.g. a Milford email to a USCD colleague). |
| **Cadence** | Tier-based contact frequency, health score, a daily **Today** queue of who is due, and touch logging that updates automatically after each launch. |
| **Network navigation** | Organisations and education as first-class records; affiliations with dates; "who do I know at X", "who else went to Y", shared employer/alma-mater overlaps, and warm-intro paths. |
| **Campaigns** | Named outreach drives with target lists, pipeline stages, per-channel templates, campaign-specific cadence and progress metrics. |

The Obsidian vault is imported once (with a dry-run diff), then retired as the source of truth. Markdown export remains available so the data never gets locked in.

### 1.3 Business Value & KPIs

| ID | KPI | Target | How measured |
| :-- | :-- | :-- | :-- |
| K1 | **Taps to reach** a contact from the launcher home | ≤ 3 taps (search/open → primary channel), ≤ 2 from Today queue | E2E step count; instrumented `contacts.launch` events |
| K2 | **Time to channel open** (tap primary action → external app foreground) | p50 < 1.0 s, p95 < 2.0 s on the phone | `contacts.launch` timing in Diagnostics |
| K3 | **Wrong-identity sends** (channel/from-account outside the membership's context without explicit override) | 0 | Guard log; Russ adversarial tests |
| K4 | **Cadence adherence** for Tier A contacts | ≥ 85 % within cadence after 8 weeks of use | Cadence report |
| K5 | **Touch capture rate** (launches that end with a logged touch) | ≥ 80 % | `contacts_interactions` / `contacts.launch` |
| K6 | **Import fidelity** of the Obsidian vault | 100 % of notes accounted for (imported, merged or explicitly skipped), 0 silent field loss | Importer report vs vault file count |
| K7 | Shell KPIs inherited (Profile §1) | Handshake < 500 ms; zero lost/duplicated writes; no secrets on phone | Existing CI + M3 tests |

### 1.4 Hypothesis

If reaching a person is one tap and the app tells you who is due, you will contact the people who matter more often and with fewer mistakes, and the CRM data will stay current because logging is a by-product of launching rather than a separate chore.

### 1.5 Competitive Landscape

| Option | Strength | Why not |
| :-- | :-- | :-- |
| Obsidian vault (status quo) | Flexible, plain text, owned | No actions, no phone-first UX, no network separation, queries brittle |
| Personal CRMs (Clay, Dex, Monica, Covve) | Cadence reminders, enrichment | Cloud-hosted third-party copies of your network; weak multi-identity launching; no work/personal separation; LinkedIn scraping ToS risk |
| HubSpot / Salesforce | Pipelines, campaigns | Team-sales oriented, heavy, cloud; wrong fit for a personal + work + personal-life mix |
| Android Contacts + Google Contacts | Native, synced | No CRM attributes, no cadence, no identity routing |

**Differentiator:** self-hosted (server-is-truth on the mini PC), identity-aware launcher, strict network separation, and network navigation over your own data.

---

## 2. Personas & Networks

### 2.1 The user

Single owner (Nick). Has a day job (USCD). Also does FMCG consulting, runs a job search, is involved with Baypath and sits on the Milford Finance Committee, and keeps a personal network of family, friends and community. **Each of those roles has its own email account** (confirmed by Nick, 2026-11-23), so the app has to route by *organisation context*, not just by three networks.

### 2.2 Networks and contexts

Three **networks** stay the top-level split. Inside a network, a **context** is the organisation or role a relationship belongs to. Each context owns its from-identities. Contexts are what decide which email account a message comes from.

| Network | Context | Email identity (from-account) | Other identities | Default channels, in order |
| :-- | :-- | :-- | :-- | :-- |
| **Work** | **USCD** (US Cabinet Depot, employer) | USCD email (Google) | Teams (USCD tenant), **Google Voice** | Teams chat → USCD email → GV text → GV call |
| **Professional** | **FMCG** (consulting) | FMCG email (Google) | **Google Voice**, LinkedIn | FMCG email → LinkedIn → GV text → GV call |
| **Professional** | **Job search** | Outlook account (Microsoft) | **Google Voice**, LinkedIn | Outlook email → LinkedIn → GV call |
| **Professional** | **Baypath** | Baypath email (Google) | **Google Voice** | Baypath email → GV text → GV call |
| **Professional** | **Milford Finance Committee** | Milford email (**Outlook / Microsoft**) | **Google Voice** | Milford email → GV text → GV call |
| **Professional** | **General** (former colleagues, alumni, peers not tied to one of the above; Q8) | TBC (Q8) | **Google Voice**, LinkedIn | LinkedIn → email → GV text |
| **Personal** | **Personal** | Personal Gmail (Google) | **Personal mobile** (phone + SMS) | SMS → phone → personal Gmail |
| *any* | *International contact* (number outside the home country) | — | **WhatsApp** (personal app) | WhatsApp chat first; then the context's usual email |

**Channel conventions (Nick, 2026-11-23):** Google Voice is the voice and text line for every business context (Work and Professional); the personal mobile is for Personal only; WhatsApp is for international contacts in any context. These are defaults the resolver applies (§4.6), not hard locks.

The email addresses themselves are entered in Settings (E7.1), not written in this repo. "TBC" items are confirmed in Sprint R0 (§12). Contexts are data, not code: adding a new board seat or client later means adding a context and an identity, nothing else.

**Rules**

- A contact has exactly one **primary membership** and zero or more secondary ones (e.g. a USCD colleague who is also a friend, or a Baypath sponsor who is also an FMCG client). A **membership is network + context**. Channel preferences, cadence tier and notes visibility are set **per membership**, not per contact.
- The resolver takes the from-identity from the membership's context. Example: emailing a Baypath sponsor always proposes the Baypath account, even if that person is also a personal friend, unless you open them through their Personal membership.
- Campaigns carry a context (the Baypath sponsorship campaign defaults to the Baypath identity; the job-search campaign to Outlook).
- The **network lens** (All · Work · Professional · Personal) is a persistent global filter shown in the subapp header, with an optional context sub-filter (e.g. Professional › Baypath). In a single-network lens, search, Today, campaigns and launch only use that network's memberships and identities.
- **Cross-context guard:** launching a channel whose from-identity belongs to a different context than the membership in use (e.g. Milford email to a USCD colleague) requires an explicit "Send from <identity> anyway" confirmation in a bottom sheet (no `confirm()`; SA-U2). Every override is logged.
- Work network data is flagged `sensitivity: work` for privacy treatment (§5.2).

### 2.3 Context seed list and vault mapping (R0, from the real vault)

Seed contexts (E7.1): **Work › USCD**, **Professional › FMCG**, **Professional › Job search**, **Professional › Baypath**, **Professional › Milford**, **Professional › General**, **Personal**. Identities are added in Settings, not in the repo.

The dry run suggests a primary membership per person from how the vault links them; Nick confirms or changes each suggestion in the import review (E1.2). Rules, first match wins:

| # | Vault signal | Suggested context |
| :-- | :-- | :-- |
| 1 | `current_organization` / `company` / `professional_network` = US Cabinet Depot, or listed in a USCD role note (e.g. "General Manager (USCD)"); USCD vendors and carriers whose `professional_network` is USCD | Work › USCD |
| 2 | Linked to Baypath Humane Society, the "Baypath Content" list, or an org tagged `sponsor-prospect` | Professional › Baypath |
| 3 | Linked to Town of Milford or its Finance Committee | Professional › Milford |
| 4 | In the "Recruiters" list or under a recruiting firm in it | Professional › Job search |
| 5 | FMCG client orgs (list to be confirmed by Nick, Q12) | Professional › FMCG |
| 6 | Linked to a BBU role note, Bimbo Bakeries USA / Grupo Bimbo, BBU projects or events (former employer) | Professional › General |
| 7 | In the "LinkedIn Network" note or any other professional list | Professional › General |
| 8 | Family, friends, scouting and community lists | Personal (Q9, decided) |
| — | Nothing matched | Professional › General: personal Gmail for email, Google Voice for calls and texts (Q8, decided) |

Measured on a 34-note sample of the phone vault (`docs/sprints/contacts-r0/Spikes.md`): **195 of 200 people** get a suggestion from rules 1–7; 5 fall through to the default. Folder signals: `People/` → person, `Organizations/` → organisation, notes at the root → roles, projects, events and lists (§4.4.1).

---

## 3. Functional Specification

### 3.1 Epics and user stories (with acceptance criteria)

#### E1 — Contact records and import

| ID | Story | Acceptance criteria |
| :-- | :-- | :-- |
| E1.1 | As the owner I can create, edit, merge and archive a contact with CRM attributes (§4.4). | Create/edit offline → synced with no duplicates (M3 guarantees). Merge keeps all memberships, affiliations, interactions; produces a merge record. Archive = soft delete. |
| E1.2 | I can migrate my Obsidian vault (People + Organizations folders, role and hub notes) into the **central database** (PocketBase on the mini PC, SQLite underneath, single source of truth, SA-C5) **once**, after dry runs, and then retire the vault. The phone copy is canonical; the importer runs on a PC against a current copy (Drive for desktop mirror of `Network`, or the folder copied from the phone). (v0.5: built as the `supra-contacts` CLI in `aquilAAurum/Supra---Contacts`; runbook `docs/runbook-migration.md`.) | `import` reports counts, data issues and the **newest note's modification time** (to confirm the copy matches the phone). `push --dry-run` shows new / changed / removed before anything is written. Writes go through `/api/sa/ops` with deterministic record ids and opIds, so pushes are idempotent and resumable; pushes are repeatable until **cutover**. Before cutover, notes removed from the vault are soft-deleted (restorable for 14 days, ADR-005) and restored if they come back. `cutover` makes a final push, records a `cutover` row in `contacts_imports`, and from then on `push` is refused (no override), so a stale vault can never overwrite app edits; the vault is made read-only and archived (§9.1). Note shapes and fields are detected per §4.4.1; unmapped keys are kept (`entity_attributes`, JSON front matter); `[[wikilinks]]` become typed edges (affiliations, relationships, org links); every source file is accounted for (K6). |
| E1.3 | I can import phone contacts (`device.contacts.read`) and Google / LinkedIn CSV exports. | Consent sheet on first use. Matching by normalised E.164 phone, lower-cased email, then fuzzy name + org with manual review. No automatic overwrite of a field I edited. |
| E1.4 | I can export everything to Markdown (Obsidian-compatible front matter) and CSV. | Round-trip test: export → re-import into an empty instance → zero diffs. |
| E1.5 | Duplicate detection runs on create/import. | Suggests merges with a confidence score; never auto-merges. |

#### E2 — Launcher and channel routing

| ID | Story | Acceptance criteria |
| :-- | :-- | :-- |
| E2.1 | On a contact card I see one **primary action** button and up to 6 ranked alternates. | Primary computed by the resolver (§4.6); each alternate labelled with channel + from-identity (e.g. "Email · nick@work"). |
| E2.2 | Tapping a channel opens the external app with the target pre-filled. | Phone → dialer with number (ACTION_DIAL, no `CALL_PHONE`). SMS → messaging app with number. Google Voice → GV app targeted. WhatsApp → chat with E.164 number. Teams → chat/call with UPN. Email → compose with to/subject from the chosen from-account (§4.7). LinkedIn → profile URL in the LinkedIn app. |
| E2.3 | "Why this channel?" explains the resolver's choice. | Shows the top 3 rules that fired (e.g. "Work network · weekday 10:12 · last 4 touches via Teams"). |
| E2.4 | Long-press a channel to set it as the preferred channel for this contact in this network. | Preference stored on the membership; resolver honours it next time. |
| E2.5 | Launch from anywhere: Today queue, search results, campaign list, and a shell launcher shortcut ("pinned people"). | Pinned people appear in the SuperApp home grid as external-style tiles that deep link to `superapp://contacts/contact/:id?action=primary`. |
| E2.6 | Quiet hours and time zones. | If the contact's local time is outside their (or default) reachable window, the resolver demotes voice channels and shows "It's 22:40 for Sam" before launching. |
| E2.7 | Missing app fallback. | If a target app isn't installed, the channel shows "Not installed" and falls back to the web URL where one exists (Teams, WhatsApp, LinkedIn, Gmail) or is hidden (Google Voice). |
| E2.8 | Message templates. | Choosing "Text with template" fills a body from a template (campaign or personal) with merge fields (`{firstName}`, `{company}`, `{lastTopic}`). Body is passed only to channels that accept prefill (SMS, WhatsApp, email, Teams chat). |

#### E3 — Touch logging and cadence

| ID | Story | Acceptance criteria |
| :-- | :-- | :-- |
| E3.1 | After I return from a launched app, a **quick-log sheet** asks "How did it go?" | Pre-filled channel, identity, timestamp and campaign; one-tap outcomes: *Talked · Left message · No answer · Sent · Scheduled*; optional note; dismiss logs nothing: the person stays due and the row shows a "Log it?" chip until the next day (Q11). Logging updates `lastTouchAt` and next due date. |
| E3.2 | I can log a touch manually (met in person, event, gift, intro made). | Same fields; type list configurable. |
| E3.3 | Each membership has a **cadence tier**. | Defaults: A = 14 days, B = 30, C = 90, D = 365, None = no reminders; editable per network. Campaign membership can override with a tighter cadence while the campaign is active. |
| E3.4 | **Today** view lists who is due, overdue, and upcoming dates. | Sorted by a priority score (overdue ratio × tier weight × campaign boost). Includes birthdays, work anniversaries, follow-up dates I set, and snoozed items returning. Each row has the primary action button. |
| E3.5 | Relationship **health** indicator per contact. | Green within cadence, amber up to 1.5× cadence, red beyond; visible on card and list; not colour-only (icon + text, WCAG). |
| E3.6 | Daily digest notification. | At a configurable time: "5 people due today (2 overdue)", deep links to Today. Uses `notify.post`; respects network lens schedule (e.g. no Work digest on weekends). |
| E3.7 | Snooze and "not now". | Snooze 1 d / 1 w / custom, with reason; snoozes are visible, not silent. |
| E3.8 (Later) | Automatic touch capture from call log / SMS / Gmail / Teams. | Behind future capabilities (`device.calllog.read`, `device.sms.read`, server-side Gmail/Graph integrations); not in v1. |

#### E4 — Network navigation (organisations, education, overlaps, paths)

| ID | Story | Acceptance criteria |
| :-- | :-- | :-- |
| E4.1 | Organisations (companies, schools, non-profits, associations) are records with type, domain, aliases, parent org and location. | Alias + domain matching dedupes "IBM" / "International Business Machines" / `ibm.com`. |
| E4.2 | **Affiliations** link people (including *me*) to orgs with role, start/end dates, and kind (employment, education, board, volunteer, membership). | Education carries degree, field, class year. Current employment derives "Company / Title" on the card. |
| E4.3 | "Who do I know at …" search. | Type an org → current and former affiliates, grouped by network and by current/former, each with primary action. |
| E4.4 | **Shared-background panel** on every contact card. | Lists orgs and schools shared with *me*, with date overlap ("Both at Acme 2015–2018") and flags **concurrent overlap** (likely knew each other). |
| E4.5 | **Overlap finder** between any two contacts or a contact and a group. | "Who else in my network overlaps with Dana?" → ranked list by number and closeness of shared affiliations. |
| E4.6 | **Relationships** between people (knows, introduced-by, reports-to, family, spouse/partner) with strength 1–5. | Edges are directional where it matters (introduced-by, reports-to). |
| E4.7 | **Warm-intro path** to a target person or org. | Shortest paths (≤ 3 hops) weighted by edge strength and recency of my touches with the first hop; shows "Ask Priya (strong, talked 9 days ago) → she worked with Lee at Acme 2016–2019". One tap launches a templated intro request to the first hop. |
| E4.9 | **Role view (org chart):** for each of my roles, see who I reported to, my direct reports, and colleagues by function, each with the primary action. | Built from imported role nodes (§4.4.1) and editable; colleagues show "worked with you as <role>". |
| E4.10 | **Org-to-org links:** partners, vendors, carriers, parent/owner. | Org page lists linked orgs and "who I know there", e.g. people at USCD's vendors. |
| E4.8 | **Graph view** of people, organisations and my roles/projects/events (the Obsidian graph, kept by requirement). | Built (v0.5) as a CSP-safe canvas view: fold single-link nodes into hubs, focus 1–3 hops, path finder ("how am I connected to…"), connection filters, colour by type / cluster / reach-out / seniority / relationship, search, unlinked-names layer, touch and pinch. 60 fps at ~1,400 nodes. Reused by the subapp. |

#### E5 — Campaigns

| ID | Story | Acceptance criteria |
| :-- | :-- | :-- |
| E5.1 | Create a campaign with name, goal, network(s), date range, owner identity and target metric (e.g. "10 sponsors committed", "30 conversations"). | Templates provided: Sponsorship/fundraising, Job search, Hiring/recruiting, Reconnect, Holiday/greetings, Event invite. |
| E5.2 | Add targets by search, by saved filter (e.g. "Professional · alumni of X · tier A–B"), by org, or from overlap/path results. | Bulk add with preview; respects lens. |
| E5.3 | Each target moves through **pipeline stages** defined per campaign (default: Identified → Researching → Contacted → Engaged → Committed → Closed-won / Closed-lost / Not now). | Stage changes are logged with timestamp; board and list views; drag is not required (buttons for touch + D-pad). |
| E5.4 | Campaign cadence and sequences. | Campaign can define steps (Day 0 email, Day 4 LinkedIn, Day 10 call) that feed the Today queue with a campaign boost. |
| E5.5 | Per-campaign templates per channel with merge fields. | Template preview with a real contact before use. |
| E5.6 | Campaign dashboard. | Counts per stage, conversion, touches this week, overdue targets, committed value (optional amount field for sponsorship/fundraising). |
| E5.7 | Campaign close-out. | Archive campaign; outcomes remain on each contact's timeline; export results to CSV. |

#### E6 — Search, filters and lens

| ID | Story | Acceptance criteria |
| :-- | :-- | :-- |
| E6.1 | Instant search across name, nickname, org, title, tags, email, phone, notes. | < 100 ms on 5 000 contacts from the local mirror; works offline. |
| E6.2 | Saved filters ("smart lists") combine network, tier, health, org, school, tag, location, campaign, last-touch range. | Saved filters usable as campaign target sources and digest sources. |
| E6.3 | Network lens persists per device and is always visible. | Switching lens updates every view within one frame; Today and digest honour the lens. |

#### E7 — Settings and identities

| ID | Story | Acceptance criteria |
| :-- | :-- | :-- |
| E7.1 | Manage **contexts** (USCD, FMCG, Job search, Baypath, Milford Finance Committee, Personal, and any added later) and their **identities** (from-accounts): label, context, channel kind, address/number, provider, handler app, signature. | Seeded with the six contexts in §2.2. e.g. "USCD email · Google"; "FMCG email · Google"; "Baypath email · Google"; "Milford email · Outlook"; "Job search · Outlook"; "Personal · Gmail app"; "Google Voice · business"; "Mobile · personal"; "WhatsApp · international". Each identity shows a "Test compose" button that opens a blank draft so I can confirm the right account appears. |
| E7.2 | Per-network defaults: channel order, quiet hours, digest time, default tier. | Applies to new memberships; existing ones keep explicit overrides. |
| E7.3 | Channel availability check. | Settings screen shows each channel's handler app as Installed / Missing / Web fallback. |

### 3.2 MVP (MoSCoW)

| Priority | Scope |
| :-- | :-- |
| **Must** | E1.1–E1.4, E2.1–E2.7, E3.1–E3.5, E4.1–E4.4, E4.8, E5.1–E5.3, E6.1–E6.3, E7.1–E7.3, cross-context guard, Markdown export |
| **Should** | E1.5, E2.8, E3.6–E3.7, E4.5–E4.7, E4.9–E4.10, E5.4–E5.7 |
| **Could** | contact photo sync, vCard QR share, TV read-only view (D-pad) |
| **Won't (v1)** | Automatic capture from call log/SMS/Gmail/Teams (E3.8), LinkedIn scraping or enrichment APIs, bulk email sending, write-back to Android contacts, multi-user sharing |

### 3.3 Out of Scope

- Sending messages *from* the app itself. The app opens the native/external app; the user presses Send there. (Keeps secrets and messaging permissions off the phone and outside the subapp.)
- Any scraping of LinkedIn or other networks (ToS). LinkedIn data enters only by manual entry or the user's own LinkedIn data export CSV.
- Syncing the corporate (Work) mailbox or Teams directory into PocketBase (pending Priya's review, §5.2).
- Marketing automation, mass mail, tracking pixels.

---

## 4. Technical & Architectural Overview

### 4.1 Integration with the SuperApp

| Concern | Approach |
| :-- | :-- |
| Packaging | Subapp `contacts` (static bundle + `app.json`), imports only `@superapp/sdk` (SA-C3). |
| Data | App-owned collections `contacts_*` plus read/write of `core_people`, `core_tags` (core scopes). All writes through `data.*` → outbox → `/api/sa/ops` (SA-C5). |
| Launching | `launcher.open` bridge method (`apps.launch` scope), extended in a **minor** contract version with an `intent` target (§4.5). Native work only in `CapabilityBroker.ts` + a Kotlin plugin (SA-C2). |
| Device contacts | `device.contacts.list` (`device.contacts.read`) for import only. |
| Notifications | `notify.post` for digests; deep links `superapp://contacts/today`, `/contact/:id`, `/campaign/:id`. |
| Bus | Emits `contacts.touch.logged`, `contacts.campaign.stage_changed`; listens `core.person.updated`. Other subapps (e.g. a future calendar subapp) can react. |
| Form factors | `phone` in v1; contracts stay device-agnostic (SA-C7) so a TV/desktop read-only view is possible later. |

Draft manifest (for Jules; final in `subapps/contacts/app.json`):

```json
{
  "id": "contacts",
  "name": "Rolodex",
  "version": "0.1.0",
  "sdk": ">=1.1 <2.0",
  "entry": "index.html",
  "formFactors": ["phone"],
  "scopes": {
    "required": ["data.own", "core.people.read", "core.people.write", "core.tags.read", "apps.launch"],
    "optional": ["device.contacts.read", "notify.post", "files.read", "nav.open"]
  },
  "collections": ["contacts_profiles", "contacts_contexts", "contacts_memberships", "contacts_identities", "contacts_orgs", "contacts_affiliations",
                  "contacts_relationships", "contacts_interactions", "contacts_campaigns", "contacts_campaign_targets",
                  "contacts_templates", "contacts_filters", "contacts_lists", "contacts_org_links", "contacts_imports"],
  "events": { "emits": ["contacts.touch.logged", "contacts.campaign.stage_changed"], "listens": ["core.person.updated"] },
  "deepLinks": ["/today", "/contact/:id", "/org/:id", "/campaign/:id"],
  "intents": [{ "action": "share.receive", "types": ["text/plain", "text/x-vcard"] }],
  "car": null,
  "background": { "tasks": [] }
}
```

### 4.2 Architecture & Data Flow

```text
 ┌──────────── Phone (shell) ─────────────────────────────────────────────┐
 │  contacts iframe (sandboxed)                                               │
 │   UI ─► Resolver (pure TS) ─► sa.launcher.open(target) ──┐             │
 │   UI ─► sa.data.* ──────────────────────────┐            │             │
 │                                              ▼            ▼             │
 │                    Shell bridge router ─► Sync engine   CapabilityBroker│
 │                       (scopes, schema)    (mirror+outbox)  └► Kotlin    │
 │                                              │               Launch     │
 │                                              │               plugin ─► Android intent
 └──────────────────────────────────────────────┼─────────────────────────┘    (Dialer, GV, WhatsApp,
                                                ▼ Tailscale HTTPS                Teams, Gmail/Outlook,
                                    PocketBase (mini PC): contacts_* + core_people   LinkedIn)
                                    server hooks: version, idempotency,
                                    (later) cadence digest job, graph queries
```

- **Resolver and cadence math run client-side** in the subapp (pure functions, unit-testable, offline).
- **Graph queries** (overlaps, paths) run client-side over the mirror for ≤ 5 000 contacts / 20 000 affiliations; a server route is the fallback if Bob's scale review finds the phone too slow (§7 R4).
- **Touch return detection:** the subapp records `pendingLaunch` before calling `launcher.open`; on `app` resume/visibility change it shows the quick-log sheet. No call-log access needed.

### 4.3 Key Considerations

1. **`core_people` vs `contacts_*`:** `core_people` stays the shared identity record (name, phones, emails, sourceIds, tags) so other subapps benefit. CRM-only data lives in `contacts_profiles` (1:1 with `core_people`) and related collections. Decision recorded as an ADR (Arthur, Sprint R0).
2. **Normalisation:** phones stored E.164 with type (mobile/landline/voip/work) and an `smsCapable` flag; emails lower-cased with a `domain` field for org matching.
3. **Link-target safety:** every URL/intent is built from a fixed template table, values are encoded, schemes and packages are allow-listed in contracts (§5).
4. **From-account handling is the riskiest unknown** (§4.7): spike in Sprint R0.
5. **Obsidian import fidelity:** the vault schema is user-defined; the importer is mapping-driven, never hard-coded.

### 4.4.0 What is built (v0.5) and how this contract maps onto it

The vault migration and the network data layer were built first (Supra---Contacts, schema `server/pb_migrations/1764201600_contacts.js`, installed with this PR). The contract below keeps its logical names; this is how they map onto the built collections. Everything marked *later* is added by additive migrations in the build sprints.

| Contract (logical) | Built collection(s) | Status |
| :-- | :-- | :-- |
| `contacts_profiles` | `contacts_people` (name parts, job title, current org, alma mater, location, preferred channel, cadence, last/next touch, met on, how met; `core_person` link) + `contacts_entities` (seniority, relationship, status, full front matter, tags, aliases, attributes) | Built; nickname, pronouns, photo, family *later* |
| `contacts_orgs` | `contacts_organizations` (companies: domain, industry, size, HQ, relationship tier, primary contact, parent) + `contacts_nodes` (my roles, projects, events, groups) + `contacts_entities.kind` | Built |
| `contacts_affiliations` | `contacts_edges` with `works_at` / `worked_at` / `involved_in` / `listed_under` / `alumnus_of` / `member_of`; `section` = department, `context_note` = the role note it was listed in (`via`) | Built as edges; dated affiliations *later* |
| `contacts_relationships` | `contacts_edges` with `knows` / `reports_to` / `key_contact` / `primary_contact` | Built as edges; strength *later* |
| `contacts_org_links` | `contacts_edges` between organisations (`related_to`, `subsidiary_of`, `listed_under`) | Built as edges |
| `contacts_interactions` | `contacts_interactions` (date, kind, summary, source) | Built; channel, identity, outcome, membership, campaign *later* |
| `contacts_imports` | `contacts_imports` (audit per push; `cutover` marker) | Built |
| — | `contacts_contact_points` (normalised E.164 phones incl. extensions, emails, WhatsApp, Google Voice, LinkedIn, website; primary + valid flags) | Built (core_people mirrors them, §4.3) |
| — | `contacts_key_dates` (birthdays, anniversaries, met-on, follow-ups) | Built |
| — | `contacts_mentions` (unlinked names, §4.4.1) | Built |
| — | `contacts_enrichment` (proposed facts → data-quality queue) | Built |
| — | Views `contacts_reach_out` (due date = next touch, else latest touch + cadence), `contacts_backlinks` | Built |
| `contacts_contexts`, `contacts_memberships`, `contacts_identities`, `contacts_campaigns`, `contacts_campaign_targets`, `contacts_templates`, `contacts_filters`, `contacts_lists` | — | *Later* (R0–R6) |

Ids are deterministic 15-character ids from the note title, so the migration, the server and the phone mirror agree. `core_people` is kept in step by a server hook (`server/pb_hooks/contacts.pb.js`): one `core_people` record per `contacts_people` record (same id), with name, phones and emails, so other subapps see contacts.

### 4.4 Data Contract (SoT: `server/pb_migrations/1764201600_contacts.js` plus additive migrations)

All collections follow the synced-collection conventions (device-generated `id`, `version`, `deleted`, `owner`, `origin_device`, `created`, `updated`).

| Collection | Purpose | Key fields |
| :-- | :-- | :-- |
| `core_people` (existing) | Shared identity | displayName, phones (JSON: `[{e164, type, label, smsCapable, whatsapp}]`), emails (JSON: `[{address, type, label}]`), sourceIds, tags |
| `contacts_profiles` | CRM attributes, 1:1 with a person | person (rel `core_people`, unique), isMe (bool), firstName, lastName, nickname, pronouns, photo (rel `core_files`), birthday, anniversaries (JSON), location {city, region, country, tz}, linkedinUrl, howWeMet, knownThrough (rel org), seniority, metAt (date), introducedBy (rel person), interests (JSON), family (JSON), pets (JSON), customFields (JSON), notes (markdown), sourceNotePath (Obsidian origin) |
| `contacts_contexts` | Organisation/role a relationship belongs to (§2.2) | name, network, org (rel `contacts_orgs`, optional), defaultIdentity (rel identity), channelOrder (JSON), quietHours (JSON), color, active |
| `contacts_memberships` | Person ↔ network + context | person, network (`work`/`professional`/`personal`), context (rel `contacts_contexts`), primary (bool), tier (`A`/`B`/`C`/`D`/`none`), cadenceDays (override), preferredChannels (JSON ordered list), preferredIdentity (rel identity), quietHours (JSON), lastTouchAt, nextDueAt, snoozedUntil, snoozeReason, active (bool), donorStatus (Baypath), sensitivity (`normal`/`work`) |
| `contacts_identities` | My from-accounts | label, context (rel `contacts_contexts`), network (derived), provider (`google`/`microsoft`/`other`), kind (`email`/`teams`/`phone`/`gvoice`/`sms`/`whatsapp`/`linkedin`), address, handler (`gmail`/`outlook`/`gmail_web`/`dialer`/`gvoice`/`whatsapp`/`whatsapp_business`/`teams`/`linkedin`/`default`), signature, active |
| `contacts_orgs` | Companies, schools, non-profits, units, groups, projects, events | name, kind (`company`/`school`/`nonprofit`/`association`/`government`/`unit`/`board`/`group`/`firm`/`project`/`event`/`other`), aliases (JSON, incl. abbreviations such as BBU, USCD), domains (JSON), parent (rel org), industry, hqLocation, website, primaryContact (rel person), relationshipLevel, topics (JSON), location, linkedinUrl, notes |
| `contacts_org_links` | Org ↔ org | from, to, kind (`parent`/`owner`/`partner`/`vendor`/`carrier`/`client`/`related`), notes |
| `contacts_affiliations` | Person ↔ org over time | person, org, kind (`employment`/`education`/`board`/`volunteer`/`membership`/`member`/`attended`/`client`), title, department, via (rel to Nick's affiliation: "worked with me in this role"), keyPerson (bool), degree, field, classYear, start, end, current (bool), source (`manual`/`obsidian`/`linkedin_csv`/`contacts`) |
| `contacts_relationships` | Person ↔ person | from, to, kind (`knows`/`introduced_by`/`reports_to`/`family`/`partner`/`mentor`), strength (1–5), since, notes |
| `contacts_interactions` | Touches / timeline | person (or org, for org history), membership, network, context, channel, identity, direction (`out`/`in`), outcome, at, durationSec, note, campaign (rel), launchId (correlates with launch event) |
| `contacts_campaigns` | Outreach drives | name, kind, context (rel), goal, metric {type, target}, networks (JSON), startAt, endAt, stages (JSON ordered), cadenceDays, sequence (JSON steps), defaultIdentity, status (`draft`/`active`/`paused`/`closed`) |
| `contacts_campaign_targets` | Person in a campaign | campaign, person, stage, stageChangedAt, nextStepAt, amount (number, optional), outcome, notes |
| `contacts_templates` | Message templates | name, channelKinds (JSON), network, campaign (rel, optional), subject, body (with merge fields) |
| `contacts_filters` | Saved smart lists | name, network, query (JSON AST) |
| `contacts_lists` | Static lists (e.g. imported LinkedIn audience lists) | name, context (rel, optional), members (rel people, multiple), source |
| `contacts_imports` | Import runs (audit) | source (`obsidian`/`contacts`/`google_csv`/`linkedin_csv`), startedAt, stats (JSON), mapping (JSON), report (rel `core_files`), status |

**Access rules:** owner only (as all collections). `contacts_identities.address` is not a secret but is personal data; no tokens are stored anywhere in `contacts_*`.

### 4.4.1 The vault as it actually is (from 16 sample notes, 2026-11-23)

Nick shared sample notes: people, organisations, his own role notes, school and group lists. They show **five note shapes**, two generations of person schema, and fields whose names mean something other than this PRD's terms. The importer must detect the shape per note, not assume one schema. No real names, addresses or numbers are copied into this repo; R1 tests use a synthetic vault that reproduces these patterns (§11.2).

| Shape | How to detect | What it holds |
| :-- | :-- | :-- |
| **P2 — Person (current schema)** | `type: person` | `name`, `first_name`, `last_name`, `organization` (plain text), `title`, `email`, `email_alt`, `phone`, `phone_alt` (quoted E.164), `linkedin`, `location`, `preferred_channel`, `network`, `affiliations`, `former_organizations`, `roles`, `alma_mater`, `connections`, `pet_type`, `donor_status`, `status`, `cadence_days`, `last_touch`, `next_touch`, `tags`. Body: `## Quick Dial` (generated `tel:` link) and `## Interaction Log`. |
| **P1 — Person (older schema)** | `type: contact` | `first_name`, `last_name`, `email`, `phone`, `current_organization` (wikilink), `former_organizations` (wikilinks), `Pet_type` (capitalised), `alma_mater`, `node` (wikilinks to role nodes / projects), `tier` (seniority, e.g. "C-Suite"). |
| **O — Organisation** | `type: organization` | `company_name`, `industry`, `website`, `hq_location`, `primary_contact` (wikilink), `relationship_tier`, `status`, `tags`, `campaigns`, `topics_of_interest`, `related_org` (wikilink, e.g. parent or owner). Body: a Dataview query (replaced by the app's "Who I know at…"), then headed sections: Roles, Key People, Notable Personnel, Strategic Partners, Strategic Vendors, Transportation, and a dated "Interaction & Project History". |
| **R — My role node** | Title like "<Role> (<org abbrev>)", e.g. "Director Of Supply Chain (BBU)", "General Manager (USCD)"; `meeting_date`, `status: processed`; body links the org | Nick's own past or current position, written as an org chart: "Report To [[X]]", Direct Reports, then people grouped by function (Sales, Distribution, Production, Support › IT / Finance / HR, Distribution Engineering), Vendors, Events, and sub-org headings (e.g. a carrier) with their people. |
| **H — Hub / list note** | No front matter; body is headings (often wikilinks) followed by bulleted wikilinks, sometimes nested | Groups and cohorts: a school's alumni list, a degree cohort, a board of directors, a firm's partners and consultants, a scouting council with troops and units, and a "LinkedIn Network" note whose headings are audiences (Baypath content, professional network, recruiters › firm › person). |

**Field meanings that differ from this PRD (importer must not map by name alone):**

| Vault field | What it actually means | Rolodex target |
| :-- | :-- | :-- |
| `network` (P2) | The *organisation or community you know them through* (e.g. a former employer) | `contacts_profiles.knownThrough` (rel org) + a **context suggestion**, not `contacts_memberships.network` |
| `tier` (P1), `relationship_tier` (O) | Seniority / level of the relationship ("C-Suite", "CEO") | `contacts_profiles.seniority`; `contacts_orgs.relationshipLevel`. **Not** the cadence tier |
| `affiliations` (P2) | Sub-units of an org, written "BBU - Manufacturing", "BBU - ePMO" | `contacts_affiliations.department` on the matching org (via alias table: BBU → Bimbo Bakeries USA, USCD → US Cabinet Depot) |
| `roles` (P2), `node` (P1) | Links to Nick's role nodes or projects (e.g. a named project) the person was part of | `contacts_affiliations.via` → Nick's affiliation for that role (concurrency without dates); projects → `contacts_orgs` kind `project` |
| `former_organizations` | Mostly orgs, but sometimes contains a role-node title | Validate against the org list and role-node list; role titles route to `via` |
| `organization` / `current_organization` | Current employer (text in P2, wikilink in P1) | Current `employment` affiliation |
| `alma_mater` | Schools (list) | `education` affiliations |
| `connections` | People they know | `contacts_relationships` (`knows`) |
| `preferred_channel` | e.g. `linkedin`, `phone` | `contacts_memberships.preferredChannels[0]` (resolver rule 2) |
| `cadence_days`, `last_touch`, `next_touch`, `status` | Cadence state (e.g. 60 days) | `cadenceDays` override, `lastTouchAt`, explicit follow-up date (`nextDueAt` kept as entered), membership `active` |
| `donor_status` | Baypath donor/sponsor status | Baypath membership `donorStatus`; seeds the Baypath Sponsors 2027 campaign stage |
| `pet_type` / `Pet_type` ("Dog, Dog") | Pets | `contacts_profiles.pets` (list); keys matched case-insensitively |
| `primary_contact` (O) | Main contact at the org | `contacts_orgs.primaryContact` |
| `related_org` (O) | Parent / owner / sister company | `contacts_org_links` (`parent` by default, editable) |
| O sections Strategic Partners / Vendors / Transportation | Org-to-org relationships | `contacts_org_links` (`partner` / `vendor` / `carrier`) |
| O sections Key People / Notable Personnel | People at the org | Current `employment` affiliation + `keyPerson` flag |
| O section Roles | Nick's role nodes at that org | Nick's own `employment` affiliations (title = role-node title without the suffix) |
| `## Quick Dial` | Generated `tel:` link | Dropped (the launcher replaces it) |
| `## Interaction Log`, O "Interaction & Project History" | Dated entries | `contacts_interactions` on the person or the org (flagged `imported`) |
| Dataview code blocks | Queries | Dropped; equivalent native views exist (E4.3) |

**Role node (R) parsing:** each R note becomes one `employment` affiliation for Nick (`isMe`). Every person listed in it gets an affiliation with the same org, `department` = nearest heading, and `via` = that affiliation, so the app knows they **worked with Nick during that role** even though the vault has no dates. "Report To" becomes `reports_to` (Nick → that person); Direct Reports become `reports_to` (them → Nick). Sub-org headings that are wikilinks (a carrier, a vendor) create an org, an `org_link` (`vendor`/`carrier`) and affiliations for the people under them. Events listed become `contacts_orgs` kind `event` with `attended` affiliations. The importer asks once for each role's start/end years so overlap detection (E4.4) gets real dates.

**Hub note (H) parsing:** the note title, or each heading that is a wikilink, becomes a group (`contacts_orgs` kind `school` / `board` / `group` / `firm` / `unit`, chosen in the mapping UI, with `parent` for nesting such as council › troop). Each bullet is a membership: `education` for school lists, `board` for boards, `member` for groups, and the heading text (Partners, Consultants) becomes the title. Nested bullets (firm › person) give the person an affiliation with the firm. Audience lists in "LinkedIn Network" (e.g. Baypath content, Recruiters) become **static lists** (`contacts_lists`) that can seed campaigns or contexts: Recruiters → Job search context; Baypath content → Baypath context candidates.

**Names and links:**

- Wikilinks may point at notes that don't exist yet or be empty (`"[[]]"`). Missing targets become **stub records** ("no note yet") whose kind is inferred from how they are linked; empty links are ignored and reported.
- Plain-text names in lists (no wikilink) are **deliberate**: people involved but not worth a note or contact details (Nick, 2026-11-27). They are kept as lightweight mentions (`contacts_mentions`) attached to what they're listed under; they are not stubs and not data-quality items. A name that matches an existing record attaches to it.
- Disambiguation suffixes in note titles ("Name (BBU)", "Name AOP") are stripped from `displayName`, kept as an alias so links resolve, and used as a hint for the org.
- The same person often appears in several hub notes (e.g. a LinkedIn list and a school cohort). That is the point: each appearance becomes another affiliation, which feeds shared-background and overlap views.

**Data-quality queue (post-import):** linked stubs without any phone/email/LinkedIn, notes flagged by the importer (`duplicate_section`, `unrendered_template`, `name_mismatch`, tier typos, bad phones/emails/dates, empty links, title collisions), role titles found in `former_organizations`, duplicate candidates, people with a cadence but no context, and notes the parser could not classify. The import is not "done" (K6) until the queue is cleared or each item is explicitly deferred.

**Default context suggestions** (Nick confirms in the dry run): current USCD affiliation → Work › USCD; in a Recruiters list → Professional › Job search; `donor_status` set or in a Baypath list → Professional › Baypath; Milford committee → Professional › Milford; FMCG client → Professional › FMCG; scouting, family, friends → Personal; other former colleagues and alumni → Professional › General (Q8).

### 4.5 Bridge contract change (contract first → SDK → shell)

Additive, **API 1.1**: `launcher.open` gains a typed `intent` target. Subapps never pass raw intents; they pass a **channel request** that the shell renders from an allow-listed template table in `packages/contracts`.

```ts
// packages/contracts (proposed, for Jules to implement in the build sprints)
type ChannelKind = 'dial' | 'sms' | 'gvoice_call' | 'gvoice_sms' | 'whatsapp_chat'
                 | 'teams_chat' | 'teams_call' | 'email_compose' | 'linkedin_profile' | 'url';
interface ChannelTarget {
  kind: 'channel';
  channel: ChannelKind;
  to: string;               // E.164 number, email/UPN, or LinkedIn profile URL (validated per channel)
  handler?: string;         // allow-listed handler id, e.g. 'gmail' | 'outlook' | 'gmail_web'
  fromAccount?: string;     // email address of the from-identity (email_compose only)
  subject?: string; body?: string;  // length-capped; encoded by the shell
}
// launcher.open({ target: ChannelTarget }) → { opened: 'app' | 'web' | 'none', handler, ms }
```

New error code reuse: `UNAVAILABLE` (handler not installed and no web fallback), `INVALID_PARAMS` (value fails per-channel validation). Every package targeted is added to `<queries>` and to Step 0's manifest allow-list with this feature (SA-C8). **No new Android permission is required** (dial uses ACTION_DIAL, not ACTION_CALL).

### 4.6 Channel resolver (pure function, deterministic, explainable)

Input: contact, membership in use (from lens or primary), identities, current time, contact time zone, recent interactions, campaign context, installed handlers. Output: ordered list of `{channel, identity, score, reasons[]}`.

Rules in priority order (each produces a reason string):

1. **Hard filters:** channel needs data (no SMS to a landline, no WhatsApp unless flagged/known, no Teams outside Work, no personal mobile line for Work/Professional memberships without the guard, no Google Voice for Personal unless set on the contact), identity must belong to the membership's context (else guarded), handler installed or web fallback exists.
2. **Explicit preference** on the membership (E2.4) → top.
3. **Campaign step** due today → that step's channel.
3a. **International:** the contact's number is outside the home country → WhatsApp chat ranks first (call stays on the context's voice line, since WhatsApp links cannot start a call).
4. **Reciprocity:** channel the contact used most recently *inbound* (when logged).
5. **Habit:** most frequent successful outbound channel in last 90 days.
6. **Context:** time-of-day vs contact quiet hours (demote voice), weekday/weekend for Work.
7. **Context default order** (§2.2), then network default.

### 4.7 From-account (identity) routing — channel matrix and spike items

| Channel | Android mechanism | From-identity control | Confidence | Spike |
| :-- | :-- | :-- | :-- | :-- |
| Phone | `ACTION_DIAL tel:` | SIM default (dual-SIM selection is OS-level) | High | Dual-SIM handling |
| Google Voice call | Intent targeted at GV package (`com.google.android.apps.googlevoice`) | GV number (all business contexts) | **Medium** | **S1 (critical, since GV is the default business line):** confirm GV accepts targeted `tel:` dial; fallback = GV "make calls" setting |
| SMS | `ACTION_SENDTO smsto:` with body | Default SMS app / SIM | High | — |
| Google Voice text | `smsto:` targeted at GV package | GV number | **Medium** | S1 |
| WhatsApp | `https://wa.me/<digits>?text=` (personal `com.whatsapp`) | Personal WhatsApp number | High | S2: confirm chat opens with prefilled text; WhatsApp Business not needed in v1 |
| Teams chat / call | `https://teams.microsoft.com/l/chat/0/0?users=<upn>&message=` / `/l/call/0/0?users=` | Signed-in Teams account | High (chat), Medium (call) | S3: verify call link on the phone |
| Email (Google accounts: Personal Gmail, USCD, FMCG, Baypath) | Account-addressed compose (`https://mail.google.com/mail/u/<account>/?view=cm&to=…`) or `mailto:` to the Gmail package | Account path segment; aliases via Gmail "Send as" | **Low–Medium** | **S4 (critical):** prove reliable from-account selection on the phone; fallback = server-side Gmail API draft in the correct mailbox, then open draft (needs a future integration with server-held token, never on phone) |
| Email (Microsoft accounts: Milford, Job-search Outlook) | `mailto:` targeted at the Outlook package, or `ms-outlook://compose?to=` | Outlook app holds **two accounts** (Milford and Job search); its compose intent does not document an account selector | **Low–Medium** | S4: test whether compose opens with the last-used or default account; mitigation is the "Sending from" banner and per-context default-account checks |
| LinkedIn | Profile URL (App Link into `com.linkedin.android`) | Signed-in LinkedIn | High | — (messaging deep link not relied on) |

With **six email identities: four Google (Personal, USCD, FMCG, Baypath) and two Microsoft (Milford, Job search)**, from-account selection is the central technical risk. S4 runs once per identity (Test compose, E7.1) and records which mechanism works for each. The results become an ADR ("Identity routing per channel") before Sprint R2 build starts. Fallback ladder if a mechanism fails for an identity: (1) Google accounts → account-addressed Gmail web compose (`/mail/u/<address>/`), which selects the account explicitly; (2) Microsoft accounts → Outlook on the web compose for that account where it can be addressed, otherwise the Outlook app with a pre-launch sheet "Check: sending from <identity>"; (3) later, server-side drafts via Gmail API / Microsoft Graph created in the correct mailbox, then opened (tokens held on the mini PC only, never on the phone, as with existing integrations). The "Sending from: …" banner shows on every email launch regardless.

### 4.8 Instrumentation

Bus/log events (no message bodies, no phone numbers or addresses in logs — redacted per HB-DATA-03):

| Event | Fields |
| :-- | :-- |
| `contacts.launch` | launchId, channel, handler, networkOfMembership, networkOfIdentity, guardOverride (bool), resolverRank, ms, opened |
| `contacts.touch.logged` | launchId?, channel, outcome, campaign?, latencyFromLaunchSec |
| `contacts.cadence.digest` | dueCount, overdueCount, lens |
| `contacts.import.completed` | source, counts, conflicts, skipped |

These feed K1–K6 in a small in-app Insights screen (Should) and Diagnostics.

---

## 5. Security & Privacy

### 5.1 New attack surface

| Surface | Risk | Control (to be confirmed in D04) |
| :-- | :-- | :-- |
| `launcher.open` channel targets | URL/intent injection via contact fields (e.g. a phone field containing `&text=` or `javascript:`) | Template table in contracts; per-channel JSON Schema validation (E.164 regex, RFC 5321-lite email, `https://www.linkedin.com/in/` prefix); shell encodes; allow-listed schemes and packages only; unit + fuzz tests |
| Import (Markdown zip, CSV, vCard via share) | Zip bombs, path traversal, oversized files, Markdown with HTML | Size/entry caps, no path use from archive, parse as text, render notes with a Markdown renderer that disallows raw HTML (HB-SEC-04) |
| Message templates & notes | Stored XSS in the subapp | No `innerHTML`; sanitized Markdown; CSP already `connect-src 'none'` |
| New `<queries>` packages | Package visibility expansion | Only the handlers in §4.7; Step 0 allow-list |
| Cross-context sends | Reputational/data-leak harm (USCD, FMCG, Baypath or Milford matters sent from the wrong account) | Cross-context guard, logging, Russ adversarial tests (K3) |
| Bulk data on phone | Lost phone exposes whole network | Already covered: SQLCipher mirror, Keystore key, biometric unlock (M4) recommended on for `contacts` |

### 5.2 Data inventory delta (Priya)

| Data | Purpose | Where | Retention | Protection / note |
| :-- | :-- | :-- | :-- | :-- |
| Third-party personal data (names, numbers, emails, birthdays, family, employment/education history, notes) | Relationship management | PocketBase `contacts_*`, `core_people`; phone mirror | Until deleted by owner; soft delete purged after 14 days (ADR-005) | Owner-only; encrypted mirror; encrypted backups. Household/personal use, but **Work** contacts may fall under employer data policy |
| Work and organisation-context records (USCD, FMCG, Baypath, Milford, Job search) | Relationships per context | Same | Same | **Nick confirmed (2026-11-23) storing these on the mini PC is allowed.** Priya still reviews organisation-specific obligations (e.g. Milford committee or Baypath donor confidentiality) in D18 and whether any context needs restricted fields |
| Interaction log (who, when, channel, outcome, short note) | Cadence | Same | Configurable auto-prune (default keep) | No message content captured |
| Imported Obsidian vault copy (phone folder snapshot and/or Drive zip) | Import audit | `core_files` | Deleted after successful import + 30 days | Owner-only |
| Identities (my addresses/numbers) | Routing | `contacts_identities` | Until removed | Not secrets; no OAuth tokens on phone |

### 5.3 Applicable HB-IDs

HB-SEC-03 (threat model update T-20+), HB-SEC-04 (no HTML sinks in notes/templates), HB-DATA-01 (inventory delta above), HB-DATA-02 (encryption at rest, inherited), HB-DATA-03 (no addresses/numbers/bodies in logs), HB-QUAL-01…05, HB-A11Y-01 (axe on every contacts screen), HB-A11Y-02 (focus order, D-pad-ready), HB-SUP-* (any new parsing dependency: Markdown, CSV, libphonenumber — licence + audit).

### 5.4 Threat model link

D04 delta to `THREAT_MODEL.md` produced by Mara in Sprint R0 (§11).

---

## 6. UI/UX

### 6.1 Primary user flows

1. **Reach someone:** Launcher home → *Rolodex* tile (or pinned person) → search → contact card → **primary action** → external app → return → quick-log sheet → done.
2. **Daily cadence:** digest notification → Today → row primary action → quick-log → next row.
3. **Find a way in:** search org "Acme" → *Who I know* → contact → shared-background panel → *Ask for intro* (templated) → launch.
4. **Run a campaign:** Campaigns → New from template → add targets from smart list → Today shows campaign steps → stage buttons on each target → dashboard.

### 6.2 Lo-fi wireframes

```text
┌─ Rolodex ──────────── [Lens: Professional ▾] ─┐   ┌─ Dana Kim ─────────────── [⋯] ─┐
│ [🔍 Search people, orgs, schools        ]     │   │ VP Partnerships · Acme Corp     │
│                                               │   │ Professional (A) · Personal (C) │
│ TODAY  5 due · 2 overdue        [Campaigns]   │   │ ● Healthy — last touch 9 d ago  │
│ ┌───────────────────────────────────────────┐ │   │ ┌─────────────────────────────┐ │
│ │ ● Sam Ortiz   overdue 6d  [✉ Email·FMCG] │ │   │ │  ✉  Email · FMCG account     │ │ ← primary
│ │ ● Priya Shah  due today   [💬 GV text  ] │ │   │ └─────────────────────────────┘ │
│ │ ◆ Lee Wong    Baypath: Contacted→ [in LinkedIn]│ │ [in LinkedIn] [GV text] [GV call]│
│ │ 🎂 Ana Ruiz   birthday    [WhatsApp   ] │ │   │ [WhatsApp·personal ⚠]  Why this?│
│ └───────────────────────────────────────────┘ │   │                                 │
│ PINNED  (Dana) (Mom) (Raj)                    │   │ SHARED WITH YOU                 │
│ RECENT  …                                     │   │ 🏢 Acme 2015–2018 (overlap ✓)   │
└───────────────────────────────────────────────┘   │ 🎓 State Univ · MBA '12 / '14   │
                                                    │ TIMELINE  ▸ 11/13 Email · Sent  │
┌─ How did it go? ─────────────────────────────┐    │ CAMPAIGNS ▸ Baypath 2027: Engaged│
│ Email to Dana from FMCG · 10:42             │    │ NOTES  ▸ …                      │
│ [Sent] [Talked] [Left msg] [No answer] [Sched]│   └─────────────────────────────────┘
│ Note: ___________________   Campaign: Baypath│
│ Next follow-up: (in 14 d ▾)      [Save] [Skip]│   ⚠ = identity outside this network →
└──────────────────────────────────────────────┘      guard sheet before launch
```

```text
┌─ Who I know at Acme Corp ─────────────────────┐   ┌─ Baypath Sponsors 2027 ─── active ─┐
│ CURRENT (3)                                   │   │ Goal: 10 committed · $25k           │
│  Dana Kim  VP Partnerships  Prof A  [✉]       │   │ Identified 14 │ Contacted 9 │ Eng 5 │
│  …                                            │   │ Committed 3 ($8.5k) │ Lost 2        │
│ FORMER (4)                                    │   │ This week: 7 touches · 3 overdue    │
│  Lee Wong  2016–2019  Prof B  [in]            │   │ [Targets] [Sequence] [Templates]    │
│ PATHS IN                                      │   └─────────────────────────────────────┘
│  You → Priya (strong) → Lee (Acme 2016–19)    │
│  [Ask Priya for intro]                        │
└───────────────────────────────────────────────┘
```

### 6.3 Input Model Contract notes (Anansi to finalise in D03)

- Touch-first; every action is a real `<button>`/`<a>` with visible focus (Profile §1).
- Focus order on contact card: Back → Lens → Overflow → Primary action → Alternates (left→right) → Why this? → Shared-with-you items → Timeline → Campaigns → Notes.
- Today rows: row (opens card) → row primary action; no swipe-only actions (swipe is a shortcut for an equivalent button).
- Android Back closes quick-log sheet → card → list (SA-U4).
- Motion ≤ 0.2 s; reduced-motion honoured (SA-U5).

### 6.4 Accessibility (WCAG 2.1 AA)

Health and network indicators use icon + text, never colour alone; channel buttons have accessible names including identity ("Email from FMCG account"); minimum 48 dp targets; axe-core on all screens.

### 6.5 Feedback plan

Toasts for saves/launch failures (SA-U2); sync state from shell header (SA-U3); "Not installed" and guard states explained in place; Insights screen surfaces K1–K5 weekly so the owner can tune cadence tiers.

---

## 7. Non-Functional Requirements

| ID | Requirement |
| :-- | :-- |
| NFR-1 | Scale: 5 000 contacts, 1 500 orgs, 20 000 affiliations, 50 000 interactions without degraded UX. |
| NFR-2 | Search < 100 ms; contact card open < 300 ms; Today compute < 200 ms (local mirror, mid-range phone). |
| NFR-3 | Fully usable offline (read, search, launch, log); writes queue in the outbox. |
| NFR-4 | Launch latency K2 (p95 < 2 s). |
| NFR-5 | Bundle size: subapp ≤ 250 KB gzip excluding fonts; phone-number library loaded lazily (import only). |
| NFR-6 | Deterministic resolver: same inputs → same ranking (unit-testable, snapshot tests). |
| NFR-7 | Data portability: complete Markdown + CSV export at any time. |
| NFR-8 | Time zones: all timestamps UTC in storage; cadence days computed in the owner's zone; quiet hours in the contact's zone. |

---

## 8. RAID Log

| Type | ID | Item | Owner | Mitigation / next step |
| :-- | :-- | :-- | :-- | :-- |
| Risk | R1 | Email from-account selection on Android is not reliably controllable, and there are six email identities across Google and Microsoft (§4.7) | Jules | Spike S4 per identity in R0; fallback ladder §4.7; "Sending from" banner; later server-side drafts |
| Risk | R2 | Google Voice may not accept targeted dial/SMS intents. **Raised to High:** GV is the default voice/text line for every business context | Jules | Spike S1 first in R0; fallback = GV set to handle all outgoing calls + open GV app on the contact |
| Risk | R3 | ~~Employer policy may forbid storing Work contacts on a personal server~~ Closed 2026-11-23: Nick confirmed it is allowed. Residual: organisation-specific confidentiality (Milford, Baypath) | Priya | D18 note in R0 |
| Risk | R4 | Client-side graph queries too slow at NFR-1 scale | Bob / Jules | Benchmark in R4; server route fallback |
| Risk | R5 | Vault is inconsistent: two person schemas, field names whose meaning differs from Rolodex terms (`network`, `tier`, `affiliations`), role titles inside `former_organizations`, many people existing only as names in list notes (confirmed from samples, §4.4.1) | Qz / Jules | Shape detection per note; semantic mapping table; stubs + data-quality queue; dry run before any write |
| Risk | R7 | ~~Two copies of the vault may have diverged~~ Closed 2026-11-23: phone copy is canonical; Drive-only notes are reported, not auto-imported | Qz | E1.2 |
| Risk | R8 | Vault folder access: the folder picker may not grant a tree on the phone location, and `files.pick` in the bridge picks files, not folders | Jules | Spike S5 in R0; additive `files.pick({ directory: true })` contract change, or zip fallback |
| Risk | R6 | Touch capture falls below K5 because logging is optional | Eleanor | One-tap outcomes, a "Log it?" chip after a dismissed quick-log (Q11), weekly nudge |
| Assumption | A1 | M3 (sync) is merged and M4 (capability broker, contacts, external launch) is at least in `5_REVIEW` before R1 build | Janus | Gate in Sprint R1 plan prerequisites |
| Assumption | A2 | ~~Identities~~ Confirmed 2026-11-23: Personal Gmail (personal); USCD (work); FMCG (consulting); Outlook (job search); Baypath; Milford (Finance Committee). Providers confirmed: Milford and Job search on Microsoft, the rest on Google. GV = business line, mobile = personal, WhatsApp = international | Nick | Closed |
| Assumption | A3 | The Obsidian vault is the only legacy CRM source. Location confirmed 2026-11-23: on the phone and in Google Drive (the `baypath-notes` repo is only a stub) | Nick | Closed |
| Issue | I1 | `core_people` lacks typed phone/email objects | Jules | Additive migration in R1 (JSON shape change is backward-compatible: plain strings accepted and upgraded) |
| Dependency | D1 | SA-2026-004 `launcher.open` + `<queries>` | Jules | Contract 1.1 lands in R1 or with M4, whichever is first |
| Dependency | D2 | SA-2026-005 notifications inbox + deep-link router | Jules | Digest (E3.6) slides to R3+ if M5 is late |

---

## 9. Release & Operations

### 9.1 Rollout & rollback

- Subapp released through the App manager channel (`subapps` collection); previous bundle kept for rollback (M5). Until M5 lands, sideload via the packer and `tools/deploy-server.ps1`.
- Migrations are additive; `contacts_*` collections can be ignored by an older bundle. Rollback = previous bundle; data stays.
- **Obsidian cutover (phone vault → central PocketBase/SQLite database):** (1) dry run on the phone copy, (2) import, (3) 2-week parallel run where Obsidian is read-only, (4) Markdown export snapshot archived to the vault as `_rolo-export-YYYY-MM-DD/`, (5) Obsidian retired as CRM SoT (ADR).

### 9.2 Observability & SLOs

Launch success rate ≥ 99 % (opened ≠ none when handler installed); import job success; digest delivered daily; error attribution to `contacts` in Diagnostics.

### 9.3 Support & documentation

User guide (Arthur): networks and lens, identities setup, cadence tiers, campaigns, import/export. Runbook delta (Theo): migration order, backup coverage for `contacts_*`, import file cleanup.

---

## 10. Post-Launch

### 10.1 Success evaluation

After 8 weeks: K1–K6 from Insights; Eleanor's usability review (D17); decide on automatic capture (E3.8).

### 10.2 Sunset/pivot conditions

If K5 < 50 % after 8 weeks, pivot cadence to inferred touches (call log / Gmail integration) before adding more features. If wrong-identity incidents occur despite the guard, make the guard blocking (no override) for Work.

### 10.3 Known issues (anticipated)

Dual-SIM dialing cannot be forced; LinkedIn messaging cannot be deep-linked reliably; WhatsApp cannot start a call via link.

---

## 11. Sprint Plan & Agent Deliverables

Sprints are two weeks, named **R0–R6** ("Rolodex") to avoid colliding with the platform sprint numbers. Each sprint ends with a working debug APK containing the increment (Writer Deploys). Every item runs Track F through the V4 state machine (`core/workflow/state-machine.md`); a separate D01 Sprint Plan is cut from each row below at that sprint's `0_READY`.

### 11.1 Roadmap overview

| Sprint | Theme | Exit criterion (demo) | Platform dependency |
| :-- | :-- | :-- | :-- |
| **R0** | Discovery, design, threat model, spikes | PRD approved; D03 + D04 accepted; spike ADRs S1–S4 decided; Obsidian dry-run on a vault copy produces a report | None (paper + throwaway spike branch) |
| **R1** | Data foundation & import | `contacts_*` migrations + `core_people` typed shapes; contacts list/card/edit; network memberships + lens; Obsidian and phone-contacts import with dry run; Markdown export round-trip | M3 merged; M4 `device.contacts` |
| **R2** | Launcher & identities | Contract 1.1 `ChannelTarget`; Kotlin launch plugin; resolver v1; all 9 channels open on the phone; cross-context guard; quick-log sheet | M4 `launcher.open`, `<queries>` |
| **R3** | Cadence & Today | Tiers, health, Today queue, snooze, digest notification, pinned people tiles, templates (non-campaign) | M5 notifications/deep links (digest only) |
| **R4** | Network navigation | Orgs/affiliations UI, Who-I-know, shared-background panel, overlap finder, relationships, warm-intro paths, scale benchmark | — |
| **R5** | Campaigns | Campaign templates, targets, stages, sequences feeding Today, dashboard, CSV export; Baypath Sponsors 2027 run as the pilot campaign | — |
| **R6** | Hardening, release, cutover | MRB CVH PASS; release record; Obsidian retired; Insights screen; runbook + user guide | All above |

### 11.2 Deliverables by agent, per sprint

Doc IDs from `core/governance/doc-registry.md`. "—" means no deliverable that sprint beyond routine review.

#### Sprint R0 — Discovery & design

| Agent | Deliverable | Verified by |
| :-- | :-- | :-- |
| **Qz** | This PRD (D02) finalised; D01 for R0 and R1; remaining open questions §12 answered with Nick; context seed list (§2.2) and tag/folder → context mapping drafted from the real vault | Template sections present; Nick approval |
| **Anansi** | D03 Design Brief: IA (Today, Search, Card, Org, Campaign, Settings), Input Model Contract for every screen, empty/error/loading/offline states, guard sheet, quick-log sheet, token usage (no new tokens without Jane) | Jane audits the Input Model Contract |
| **Mara** | D04 delta: T-20+ for channel-target injection, import parsing, template XSS, cross-context leak, lost device; each High → control + test | Committed to `THREAT_MODEL.md`; Russ maps tests |
| **Priya** | D18: third-party data handling; confidentiality obligations per context (Milford Finance Committee, Baypath donors, FMCG clients); LinkedIn ToS (no scraping, CSV export OK); data inventory delta sign-off. Storing contacts on the mini PC is already approved by Nick | D18 PASS / conditions |
| **Jules** | Spikes on the phone (throwaway branch): S1 GV targeted intents; S2 WhatsApp vs Business; S3 Teams call link; **S4 from-account for each of the six email identities**; **S5 opening the vault folder on the phone and a zip from Google Drive**; Obsidian dry-run parser prototype run on copies of both vault locations | Spike notes with screen recordings / logcat in PR evidence; per-identity result table |
| **Arthur** | D16 ADR-006 "Contacts data model: `core_people` + `contacts_*`" (Accepted); ADR-007 "Identity routing per channel" (from spike results); ADR-008 "Retire Obsidian as CRM source of truth" (Accepted). Numbers moved up one: ADR-005 is the restore op. | Nick accepts |
| **Bob** | D17 memo: client-side graph vs server route; data volume assumptions (NFR-1) | Filed |
| **Eleanor** | D17 memo: usability of launcher-first flow; K5 risk; lens mental model | Filed |
| **Janus** | Work item `SA-2026-007` with `state:1_PRD` → `2_DESIGN` → `2.5_THREAT_MODEL`; enforces that no build starts before D03/D04 accepted | Labels + log |
| **Russ** | D09 Test Plan skeleton: acceptance criteria → test ids for all epics; adversarial cases for K3 | Mapping table covers every Must |

#### Sprint R1 — Data foundation & import

| Agent | Deliverable | Verified by |
| :-- | :-- | :-- |
| **Qz** | D01 R1; acceptance criteria refined for E1, E6, E7.1 | Pre-flight with Jules |
| **Jules** | Migrations `contacts_*` + `core_people` typed phones/emails; `subapps/contacts` scaffold + manifest; list/search/card/edit; memberships + lens; identities settings; Obsidian importer (mapping, dry run, report); phone contacts import; Markdown/CSV export; D06 PR + Evidence Bundle | Required checks green; PocketBase integration covers new collections |
| **Kumi Wai** | CI: contacts unit/E2E jobs, SDK size budget unaffected, Step 0 aware of new collections; D07 | ARTIFACT VERIFIED |
| **Russ** | D10: import fidelity (K6) on a synthetic 500-note vault that reproduces all five note shapes of §4.4.1 (P1, P2, O, R, H), dangling and empty wikilinks, suffix-disambiguated names, mixed-case keys and role titles in `former_organizations` — no real vault data in the repo; offline create/edit; search perf (NFR-2); export round-trip | D10 PASS |
| **Jane** | D08: architecture rules (subapp imports only SDK, no HTML sinks, migrations follow conventions) | D08 PASS |
| **Priya** | Import/consent copy review | Comment on PR |
| **Mara** | Review importer against T-2x (zip, path, size) | Security review on PR |
| **Arthur** | Import user guide draft | Docs check |

#### Sprint R2 — Launcher & identities

| Agent | Deliverable | Verified by |
| :-- | :-- | :-- |
| **Qz** | D01 R2; resolver rule weights signed off | — |
| **Jules** | `packages/contracts` API 1.1 `ChannelTarget` + schemas → SDK → shell handler → Kotlin launch plugin in `CapabilityBroker`; `<queries>` entries + Step 0 allow-list; resolver v1 with explanations; channel buttons, guard sheet, "Not installed" fallbacks, quick-log sheet, `contacts.launch` instrumentation | Contract tests; on-phone recording of each channel |
| **Mara** | Fuzz/injection test set for channel targets; review of plugin intent construction | All Highs have passing tests |
| **Russ** | D10: matrix of 9 channels × installed/missing × network guard; K2 timing on phone; K3 adversarial (0 wrong-identity) | D10 PASS with timing evidence |
| **Jane** | D08: contract-first order respected; native code only in broker/plugin; no permission added | D08 PASS |
| **Kumi Wai** | D07; Android build includes new plugin; manifest check | Green |
| **Anansi** | Visual QA of card/alternates/guard; a11y names | Sign-off note |

#### Sprint R3 — Cadence & Today

| Agent | Deliverable | Verified by |
| :-- | :-- | :-- |
| **Qz** | D01 R3; default tiers & priority score formula | — |
| **Jules** | Cadence engine (pure), health indicator, Today view, snooze, manual touch logging, templates + merge fields, pinned-people launcher tiles (`superapp://contacts/contact/:id?action=primary`), daily digest via `notify.post` | Unit tests on cadence math incl. DST/time zones |
| **Russ** | D10: cadence boundary tests, digest timing, lens-respecting digest, K1 tap counts | PASS |
| **Eleanor** | Hallway test of Today flow on the phone (1 week of real use) → D17 notes | Filed |
| **Jane / Kumi Wai** | D08 / D07 | PASS / Verified |

#### Sprint R4 — Network navigation

| Agent | Deliverable | Verified by |
| :-- | :-- | :-- |
| **Qz** | D01 R4; path-ranking criteria | — |
| **Jules** | Org records with alias/domain dedupe; affiliations UI (employment, education, board…); Who-I-know; shared-background panel with overlap detection; overlap finder; relationships; warm-intro paths (≤ 3 hops) with templated intro launch; role view / org chart (E4.9); org-to-org links (E4.10); benchmark at NFR-1 scale | Benchmark report in PR |
| **Bob** | Review benchmark; go/no-go on client-side graph | D17 note |
| **Russ** | D10: overlap correctness on a seeded graph (known answers), path ranking, perf | PASS |
| **Anansi** | D03 addendum: org and path screens, Input Model Contract | Jane audit |
| **Jane / Kumi Wai** | D08 / D07 | PASS / Verified |

#### Sprint R5 — Campaigns

| Agent | Deliverable | Verified by |
| :-- | :-- | :-- |
| **Qz** | D01 R5; campaign templates (Sponsorship, Job search, Recruiting, Reconnect, Greetings, Event); **pilot: Baypath Sponsors 2027** goals and stage set | Nick approves pilot |
| **Jules** | Campaign CRUD, target add (search, smart list, org, path results), stages with history, sequences feeding Today with campaign boost, per-campaign templates, dashboard, close-out + CSV export, `contacts.campaign.stage_changed` | E2E: create → add 20 targets → advance stages → dashboard numbers match |
| **Russ** | D10: pipeline integrity under offline edits/conflicts; sequence scheduling | PASS |
| **Priya** | Review fundraising/sponsorship use (consent to contact, no bulk send, CAN-SPAM not triggered since sends are manual 1:1) | D18 note |
| **Eleanor** | Pilot feedback after 2 weeks of the Baypath campaign | D17 note |
| **Jane / Kumi Wai** | D08 / D07 | PASS / Verified |

#### Sprint R6 — Hardening, release & cutover

| Agent | Deliverable | Verified by |
| :-- | :-- | :-- |
| **MRB (Fortify Team)** | D11 CVH for SA-2026-007: all HB-IDs §5.3, threat tests green, no open High/Critical | CVH PASS |
| **Qz** | CVH commercial section (cost: zero marginal infra; time saved vs Obsidian); K1–K6 baseline | Filed |
| **Theo** | D12 Release Record (tag, signed APK if shell changed, subapp bundle hash); D19 runbook delta (migrations, backup includes `contacts_*`, import cleanup job); rollback rehearsal | Tested rollback evidence |
| **Jules** | Insights screen; fixes from CVH; cutover tooling (final import, export snapshot) | PR evidence |
| **Arthur** | User guide final; ADR-007 accepted; D13 final sprint review | Nick sign-off |
| **Janus** | D13 draft; state `6.5` → `7` → `8` → `9` | Labels/log |
| **Coach** | D15 retrospective synthesis across R0–R6 (from each persona's D14) | Filed |
| **Vinod / Bob / Eleanor** | D17 board memos: go-live recommendation, next horizon (auto-capture, TV view) | Filed |
| **Nick** | Approves cutover, merges, retires Obsidian CRM | Merge on `main` |

### 11.3 Cross-sprint responsibilities (RACI summary)

| Activity | R | A | C | I |
| :-- | :-- | :-- | :-- | :-- |
| Requirements & priorities | Qz | Nick | Eleanor, Bob | All |
| UX & Input Model | Anansi | Jane (audit) | Eleanor | Jules |
| Security & privacy | Mara, Priya | Nick | Jules | Russ |
| Contracts, code, migrations | Jules | Jane (review) | Bob | Kumi Wai |
| CI & gates | Kumi Wai | Janus | Jules | Nick |
| Testing | Russ | Janus | Mara | Jules |
| Release & ops | Theo | Nick | Arthur | All |
| Docs & ADRs | Arthur | Nick | Qz | All |
| Process & state | Janus | Nick | Coach | All |

### 11.4 Definition of Ready (per build sprint)

PRD section for the sprint's epics final; D03 screens for those epics accepted; D04 controls for new surface listed; D09 mapping exists; platform dependency for the sprint (§11.1) is merged or in `5_REVIEW` with Nick's waiver.

### 11.5 Definition of Done (feature)

- All Must stories pass their acceptance tests (D09 → D10 PASS) on the debug APK on the phone.
- K1–K3 measured and within target; K6 = 100 % on the real vault.
- Required checks green; D08 PASS; CVH PASS; no permission added beyond the v1 list.
- Obsidian vault imported, parallel run complete, ADR-007 accepted.
- User guide and runbook delta published; D14 from each delivery persona, D15 from Coach.

---

## 12. Open Questions (for Nick, answer in R0)

| # | Question | Default if unanswered |
| :-- | :-- | :-- |
| Q1 | ~~App name~~ **Answered: "Rolodex" (`contacts`).** | — |
| Q2 | ~~Which email accounts map to which network?~~ **Answered 2026-11-23:** Personal Gmail = personal; USCD = work; FMCG = consulting; Outlook = job search; Baypath; Milford = Finance Committee. **Answered 2026-11-23:** Milford is Outlook; the other organisation accounts are Google; Google Voice is the business line; phone is personal; WhatsApp is for international contacts. USCD uses Teams; the job-search account is Outlook (both confirmed). | — |
| Q3 | ~~Where is the vault?~~ **Answered:** on the phone (canonical) and in Google Drive (`Network`: `People/`, `Organizations/`, role and list notes at the root). Front-matter keys and note shapes confirmed from 34 sample notes (§4.4.1, §2.3). | — |
| Q4 | ~~May Work contacts be stored on the mini PC?~~ **Answered: yes.** | — |
| Q5 | ~~Cadence tiers~~ **Answered: A 14 / B 30 / C 90 / D 365 days.** | — |
| Q6 | ~~Pilot campaign~~ **Answered: Baypath Sponsors 2027, with amounts tracked.** | — |
| Q8 | ~~Former colleagues, alumni and peers that don't belong to USCD, FMCG, Job search, Baypath or Milford: which email account should they get (personal Gmail, Job-search Outlook, or FMCG)?~~ **Answered 2026-11-27:** a General professional context with **personal Gmail** for email and Google Voice for calls/texts. | — |
| Q9 | ~~Should scouting and other community groups be Personal, or their own context?~~ **Answered 2026-11-27:** Personal. | — |
| Q10 | Start/end years for each of your role nodes (BBU and USCD roles), asked once in the import dry run | Asked in the importer |
| Q7 | Should the server send the daily digest (works when phone is off) or the phone (simpler)? | Phone (local notification) in v1 |
| Q11 | ~~Quick-log sheet: should dismissing it log an "Attempted" touch (E3.1), or log nothing and keep the person due with a "Log it?" chip (Eleanor, D17)?~~ **Answered 2026-11-27:** dismiss logs nothing; the person stays due with a "Log it?" chip (E3.1 updated). | — |
| Q12 | FMCG: which client organisations belong to the FMCG context (rule 5, §2.3)? | Asked in the import review |
| Q13 | Milford Finance Committee: is there town guidance on records/retention for committee correspondence (D18 C-2)? | Keep Milford context to contact details and touch dates |

---

## 13. Governance

### 13.1 Sign-off

| Role | Name | Status |
| :-- | :-- | :-- |
| Product | Qz | Draft |
| Design audit | Jane | ☐ |
| Security | Mara | ☐ |
| QA | Russ | ☐ |
| Legal & privacy | Priya | ☐ |
| Release | Theo | ☐ |
| CEO | Nick | ☐ |

### 13.2 Definition of Done

See §11.5.

## Appendix: Change Log

| Version | Date | Change |
| :-- | :-- | :-- |
| 0.6 | 2026-11-27 | Sprint R0: §2.3 context seed list and vault → context rules (195/200 people covered on a 34-note sample); Q3 closed; Q11–Q13 added; ADR numbers ADR-006/007/008; R0 artifacts in `docs/sprints/contacts-r0/`. | Nick answered Q8 (General context: personal Gmail + Google Voice), Q9 (scouting/community = Personal), Q11 (dismissing quick-log logs nothing; E3.1 updated).
| 0.5 | 2026-11-27 | Nick: subapp id is `contacts` (was `rolo`); the vault is migrated once and retired (dry runs → repeatable push → cutover), Supra is the source of truth; unlinked names are deliberate lightweight mentions, not stubs; graph view is a Must (built); soft deletes purged after 14 days with a restore op (ADR-005). New §4.4.0 maps this contract onto the built `contacts_*` collections. |
| 0.4 | 2026-11-23 | USCD uses Teams, job search is Outlook (confirmed). Real vault analysed from 16 sample notes: new §4.4.1 (five note shapes, field-meaning corrections, role-node and hub-note parsing, stubs, data-quality queue, context suggestions) replaces the guessed mapping; data contract gains `contacts_org_links`, `contacts_lists`, affiliation `via`, org kinds for units/groups/projects/events; E4.9 role view, E4.10 org links; General professional context; Q8–Q10. |
| 0.3 | 2026-11-23 | Nick's answers: email providers (Milford + Job search Microsoft, rest Google); channel conventions (GV business, mobile personal, WhatsApp international) in §2.2 and resolver; vault phone copy canonical, migrated into the central PocketBase/SQLite database via batched ops; GV risk raised; Q1, Q5, Q6 closed. |
| 0.2 | 2026-11-23 | Nick's answers: six email identities → per-organisation **contexts** inside networks (`contacts_contexts`), cross-context guard, from-account risk and fallback ladder expanded; vault on phone + Google Drive (dual-copy import, spike S5); mini-PC storage of all contacts approved; Q2–Q4 updated. |
| 0.1 | 2026-11-22 | First draft: pivot from Obsidian/Markdown CRM to the `contacts` subapp; epics E1–E7; data contract; channel/identity matrix; sprints R0–R6 with agent deliverables. |
