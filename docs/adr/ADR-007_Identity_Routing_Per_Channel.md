---
id: ADR-007
title: Identity routing per channel (which from-account each launch uses)
status: Proposed
date: 2026-11-27
decided_by: nick (pending spike results S1–S4)
supersedes: []
---

# ADR-007: Identity routing per channel

## 1. Context

The Contacts launcher must open the right channel from the right identity: six email identities (Personal Gmail; USCD, FMCG, Baypath on Google; Milford and Job search on Outlook), Google Voice as the business voice/text line, the personal mobile for personal contacts, WhatsApp for international contacts, Teams for USCD (PRD SA-2026-007 §2.2, §4.7). Android offers no documented "from account" extra for Gmail or Outlook compose intents, so the mechanism per identity must be measured on Nick's phone (Sprint R0 spikes S1–S4, `spikes/r0-launch/index.html`; results in `docs/sprints/contacts-r0/Spikes.md`).

## 2. Proposed decisions (confirmed or replaced by the spike results)

| # | Channel | Proposed mechanism | Fallback if the spike fails |
| :-- | :-- | :-- | :-- |
| 1 | Google Voice call/text | Intent targeted at `com.google.android.apps.googlevoice` (`ACTION_DIAL tel:` / `ACTION_SENDTO smsto:` + `sms_body`) | GV's own "make calls with Google Voice" setting with plain `tel:`; text via GV app link without prefill |
| 2 | Personal call/text | `ACTION_DIAL tel:` and `smsto:` to the default apps | — |
| 3 | WhatsApp | `https://wa.me/<digits>?text=` (personal WhatsApp) | `whatsapp://send` targeted at `com.whatsapp` |
| 4 | Teams | `https://teams.microsoft.com/l/chat/0/0?users=<upn>&message=` and `/l/call/0/0` | Chat only; call from inside Teams |
| 5 | Google email identities | Account-addressed compose `https://mail.google.com/mail/u/<account>/?view=cm&to=…` | `mailto:` targeted at Gmail plus a "Sending from <account>, switch account in Gmail" banner (E7.1 Test compose) |
| 6 | Outlook identities (2 accounts in one app) | `ms-outlook://compose?to=…` | Banner + per-context "last used" guidance; long-term: server-side draft via Graph API (needs Priya/Mara review) |

Every launch records `{channel, identity, mechanism}` so K3 (wrong-identity sends = 0) can be measured.

## 3. Consequences

- R2 builds the Kotlin launch plugin from the mechanisms accepted here; `<queries>` gets exactly the packages named in the accepted rows (SA-C8, Step 0 allow-list).
- Rows whose spike fails keep their fallback and a visible "Sending from" banner; the cross-context guard (PRD §2.2) applies to all.
