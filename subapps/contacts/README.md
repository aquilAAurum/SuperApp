# Contacts subapp (`contacts`)

Supra Contacts on the phone (SA-2026-007; Supra---Contacts plan P2). Reads the `contacts_*`
collections from the shell's local mirror, so everything works offline.

| Screen | What it does |
| :-- | :-- |
| Today | Overdue and due within 7 days (due = next touch, else latest touch + cadence; the interaction log counts as a touch), then birthdays, anniversaries and dated events in the next 30 days. |
| People | Search names, aliases, titles, organisations, emails, phones and locations; filter people / organisations / roles, projects, events. |
| Card | Reach (emails, phones, links), details, relationships and backlinks, shared background (warm intros), timeline, notes. **Edit** and **Log a touch** for people. |
| Graph | The Supra---Contacts graph viewer (vendored in `src/viewer/`, see its README) over the same records; *Open card* jumps back. |

Writes go through `sa.data.*` (outbox → `/api/sa/ops`). Until the vault is cut over, the next
`supra-contacts push` replaces edits made here; the app shows a banner while that is true.

```bash
pnpm --filter @superapp/subapp-contacts dev     # standalone (dev mock, empty data)
pnpm --filter @superapp/subapp-contacts build   # single-file build, packed into the shell's builtins
```

Tests: `src/model.test.ts` (reach-out math, dates, search incl. 5 000-person timing, links, graph
shape, edit validation), `src/viewer.test.ts` (vendored copy pinned), and
`apps/shell/tests/e2e/contacts.spec.ts` (inside the shell: Today, search, card, log a touch and edit
through the ops route, graph, axe-core).
