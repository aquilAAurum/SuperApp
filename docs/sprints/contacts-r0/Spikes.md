# Sprint R0 spikes S1–S5 (Jules)

Harness: [`spikes/r0-launch/index.html`](../../../spikes/r0-launch/index.html), opened in Chrome on Nick's phone. Chrome converts each `intent:` link into the same Android intent (action, data, target package, string extras) the R2 Kotlin launch plugin will send, so the results predict the plugin's behaviour; Chrome may add its own "open with" chooser. Addresses and numbers stay on the phone; results are outcomes and identity labels only.

| Spike | Question | Tests | Result | Decision |
| :-- | :-- | :-- | :-- | :-- |
| S1 | Does Google Voice accept targeted dial and text intents (default business line)? | S1.1 GV dial, S1.2 GV text with body, S1.3/S1.4 plain `tel:`/`sms:` baselines | _pending Nick's run_ | ADR-007 row 1 |
| S2 | WhatsApp prefill; is Business needed? | S2.1 `wa.me`, S2.2 targeted `com.whatsapp`, S2.3 `com.whatsapp.w4b` | _pending_ | ADR-007 row 3 |
| S3 | Teams chat/call links on the phone | S3.1 chat + message, S3.2 call link, S3.3 `msteams:` | _pending_ | ADR-007 row 4 |
| **S4** | Can each of the six email identities be opened as the From account? | Google ×4: account-addressed compose (`/mail/u/<account>/`), `mailto` targeted at Gmail; Outlook ×2: `ms-outlook://compose`, `mailto` targeted at Outlook | _pending_ | ADR-007 rows 5–6 |
| S5 | Can the vault be picked on the phone (folder or Drive zip)? | S5.1 file picker: count + newest modified | _pending_ (optional since ADR-008: migration runs on a PC) | Informs whether an on-phone importer is ever needed |

## Obsidian dry-run prototype (vault copies)

Run 2026-11-27 with the Supra---Contacts importer on a copy of 34 notes from the phone vault (uploaded by Nick; not committed). Aggregate only:

| Measure | Value |
| :-- | :-- |
| Notes read | 34 (including 2 empty notes) |
| Graph nodes / links | 301 / 617 (267 linked names without a note) |
| People / orgs / roles / projects / events / groups | 202 / 59 / 5 / 14 / 1 / 16 |
| Contact points (valid emails, phones incl. extensions, fax) | 21 |
| Data issues | 12: duplicate template sections (6 notes), unrendered `{{date}}` (1), title vs front-matter name mismatch (1), tier typos (2), empty `[[]]` links (2) |
| Context suggestions (PRD §2.3 rules) | 195 of 200 people get a suggestion; 5 fall back to the default |
| Contacts due for outreach on 2026-11-27 | 10 (all due since 2026-11-01) |

The Google Drive copy (`Network`) has the same layout (`People/`, `Organizations/`, role notes at the root); a full run against it waits for a current copy on the PC (runbook-migration).
