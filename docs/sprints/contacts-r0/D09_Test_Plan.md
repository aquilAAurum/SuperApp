[QA Lead / Test Strategist] - [Russ]
[[CONTEXT: core/personas/jules.md, project-profile.md]]
To: Jules, Janus

## Test Plan skeleton: SA-2026-007 Contacts (Doc ID D09)

> Prepared by Claude acting as Russ in Sprint R0. Gate (PRD §11.2): every **Must** acceptance criterion and every **High** threat maps to a test id. Levels: U unit · I integration (real PocketBase) · E E2E (Playwright + axe) · P on the phone (manual, recorded) · M migration (Supra---Contacts).

### A. Context
| Field | Value |
| :-- | :-- |
| Project / Profile | `project-profile.md` |
| Sprint | R0 (skeleton; filled per sprint at R1–R6) |
| Artifact under review | PRD `docs/features/SA-2026-007_Contacts_CRM.md` v0.6 |
| Evidence | Existing tests named below are on `main` (SuperApp #8) or Supra---Contacts `main` |

### B. Summary
**Coverage status:** all Must criteria (PRD §3.2) and Highs T-20, T-21, T-23 mapped. Already green: data layer, migration, cutover, graph view, `core_people` mirror.

### D. Test Cases

#### Must acceptance criteria
| Test id | AC | Level | Test (existing ✓ / planned sprint) |
| :-- | :-- | :-- | :-- |
| CT-E1.1-a | Create/edit offline syncs once, no duplicates | E | R1: "create contact offline, reconnect, one record" |
| CT-E1.1-b | Merge keeps memberships, affiliations, interactions | U + E | R1 |
| CT-E1.1-c | Archive = soft delete; restore within 14 days | I | ✓ `server.test.ts` "mirror … through delete and restore"; ADR-005 tests |
| CT-E1.2-a | Dry run counts and per-note issues before any write | M | ✓ Supra---Contacts `tests/importer.test.ts`, `push --dry-run` in `tests/supra.test.ts` |
| CT-E1.2-b | Push is idempotent and resumable | M + I | ✓ `tests/supra.test.ts` "full sync, idempotent re-run…"; `tools/pb-integration.sh` (113 created → no-op) |
| CT-E1.2-c | Every source file accounted for (K6) | M | ✓ import stats (`notes` = files); R1: report lists every file |
| CT-E1.2-d | Cutover retires the vault; later push refused, server untouched | M + I | ✓ `tests/supra.test.ts` cutover; `pb-integration.sh` exit 3 |
| CT-E1.2-e | Five note shapes, dangling/empty links, suffixed names, mixed-case keys | M | ✓ fixture vault tests; R1: synthetic 500-note vault (`tools/gen-vault.mjs`) K6 run |
| CT-E1.3 | Phone contacts / CSV import with consent, E.164/email matching, no overwrite of edited fields | U + P | R1 |
| CT-E1.4 | Markdown/CSV export round-trip = zero diffs | U | R1 |
| CT-E2.1 | Primary action + ≤ 6 alternates labelled channel · identity | U + E | R2 |
| CT-E2.2 | Each of 9 channels opens prefilled (dial, SMS, GV call, GV text, WhatsApp, Teams chat/call, email per identity, LinkedIn) | P | R2 (recorded); mechanisms from ADR-007 / S1–S4 |
| CT-E2.3 | "Why this channel?" shows the top 3 rules | U | R2 resolver tests |
| CT-E2.4 | Long-press sets preferred channel per membership | E | R2 |
| CT-E2.5 | Launch from Today, search, campaign, pinned tile | E | R2/R3 |
| CT-E2.6 | Quiet hours demote voice and warn | U | R2 (time-zone table) |
| CT-E2.7 | Missing app → "Not installed" / web fallback | P | R2 |
| CT-E3.1 | Quick-log after return; dismissing logs nothing and leaves a "Log it?" chip (Q11) | E | R2 |
| CT-E3.2 | Manual touch log | E | R3 |
| CT-E3.3 | Tiers A 14 / B 30 / C 90 / D 365; campaign override | U | R3 (cadence math incl. DST) |
| CT-E3.4 | Today sorted by priority; dates; snoozes return | U + E | R3; ✓ due/upcoming SQL (`reachOutDue`, `upcomingDates`) |
| CT-E3.5 | Health green/amber/red with icon + text | U + E (axe) | R3 |
| CT-E4.1 | Org alias + domain dedupe | U | R4; ✓ domain from website / staff emails |
| CT-E4.2 | Affiliations with kind and dates | I | R4 (from `contacts_edges` + dates) |
| CT-E4.3 | Who I know at X (current / former) | I | ✓ `v_org_people`; R4 UI |
| CT-E4.4 | Shared-background panel with overlap | U | ✓ `v_shared_context`; R4 date overlap |
| CT-E4.8 | Graph view: focus, path, filters, lenses, phone | E | ✓ Supra---Contacts `tests/graph.test.ts` + R4 subapp E2E |
| CT-E5.1–5.3 | Campaign create, targets, stages without drag | E | R5 |
| CT-E6.1 | Search < 100 ms on 5,000 contacts offline | P (bench) | R1 (`tools/gen-vault.mjs` at 5k) |
| CT-E6.2 | Smart lists | U | R1 |
| CT-E6.3 | Lens persists; every view honours it | E | R1 |
| CT-E7.1 | Contexts/identities seeded; Test compose per identity | P | R1/R2 |
| CT-E7.2–7.3 | Per-network defaults; channel availability | E + P | R2 |
| CT-GUARD | Cross-context guard (see T-21) | U + E | R2 |
| CT-EXPORT | Markdown export | U | R1 |

#### High threats
| Test id | Threat | Test |
| :-- | :-- | :-- |
| CT-T20-a | Channel-target injection | R2: contract schema tests per channel; fuzz set (Mara) on the intent template builder |
| CT-T20-b | No `component`/`selector`/package from data | R2: unit "template builder ignores data-supplied package" |
| CT-T21-a | Wrong-identity send (K3 = 0) | R2: adversarial matrix context × identity × channel; guard required for every cross pair |
| CT-T23-a | Stale vault after cutover | ✓ `tests/supra.test.ts`, ✓ `pb-integration.sh` |

#### K-metrics
| KPI | How measured | When |
| :-- | :-- | :-- |
| K1 taps to reach | E2E step count | R2–R3 |
| K2 channel open time | `contacts.launch` timing on the phone | R2 |
| K3 wrong-identity sends | Guard log + adversarial matrix | R2, R6 |
| K4 cadence adherence | Cadence report after 8 weeks | Post-R6 |
| K5 touch capture | interactions / launches | R3+ |
| K6 import fidelity | Import report vs file count | R1 (synthetic), cutover (real) |

From: Russ
