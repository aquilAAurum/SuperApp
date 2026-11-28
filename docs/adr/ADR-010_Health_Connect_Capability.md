---
id: ADR-010
title: Health Connect as a v1 capability (device.health.read / device.health.write), with a shell consent sheet
status: Proposed
date: 2026-11-28
decided_by: nick
supersedes: []
---

# ADR-010: Health Connect through the bridge

## 1. Context

The spec's capability map lists *Health data, `device.health.read`, Health Connect plugin* as **Later**, and the manifest validator rejected the scope as reserved. EatWell (SA-2026-008) moves into Supra as a subapp. Its value depends on Health Connect: activity and calories burned from the owner's watch or phone feed the daily budget, and meals, weight and water logged in EatWell should reach Health Connect so other health apps see them. The standalone EatWell Android app already read steps and calories from Health Connect directly; inside Supra a subapp cannot touch Android (SA-C2, SA-C3), so the shell has to provide it.

Consent-gated scopes also had no consent UI yet (M4): the router answered `SCOPE_DENIED` for every undecided consent scope. Health data is the most sensitive data Supra has handled, so the scope must not ship without the spec's grant flow (§Permissions, steps 2 to 5).

## 2. Decision

| # | Decision | Rationale |
| :-- | :-- | :-- |
| 1 | `device.health.read` leaves `RESERVED_SCOPES`; a new **`device.health.write`** is added. Both are **consent scopes**. Bridge API goes to **1.1** (additive): `device.health.status`, `.request`, `.read`, `.write`, `.delete`; `capabilities.device.health` (optional field). SDK 1.1.0 wraps them as `sa.device.health.*`. | Contract first (SA-C4). Read and write are separate decisions for the owner. |
| 2 | Contract names are **device-agnostic** (`steps`, `activeCalories`, `weight`…) with fixed units (SI + kcal). The mapping to Android permissions lives in `packages/contracts/src/health.ts` and is mirrored in the plugin. | SA-C7: a TV or desktop shell can serve the same contract from another store, or answer `UNAVAILABLE`. |
| 3 | Reads return **aggregates only** (per local day or whole range, max 400 days). Writes are limited to **nutrition, weight, hydration** and are **upserts keyed by the subapp's own record id** (`clientRecordId`), so edits replace and deletes remove exactly what the app wrote. No raw sample reads, no other record types. | Smallest surface that serves EatWell; no subapp can enumerate the owner's health history record by record or write data it did not log. |
| 4 | `status` needs the scope **declared** but no consent (it only says what the shell holds, so an app can offer "Connect"). `request` shows Supra's consent sheet (first time), then **Health Connect's own dialog**. `read`/`write` never show a dialog; ungranted metrics come back in `missing`. | Two independent gates (Supra per app, Android per data type). No surprise dialogs on app start. |
| 5 | A **consent sheet** in the shell implements grant-flow step 3 for every consent scope: *Allow / Allow once / Don't allow*. Allow and Don't allow persist (Capacitor Preferences); Allow once lasts for the app session. Settings → Permissions lists decisions and resets them; a reset ends the app's session. Server mirroring to `grants` stays in M4. | Spec §Permissions; "revoke ends session" (M4 acceptance) applied now. |
| 6 | Native side is an **in-repo Kotlin plugin** (`HealthConnectPlugin.kt`, `androidx.health.connect:connect-client` 1.1.0) registered in `MainActivity`, reachable only through `CapabilityBroker.ts`. It refuses any permission outside its allow-list. A **rationale activity** (required by Health Connect) states how Supra uses the data. Kotlin is added to the app module for this plugin only. | SA-C1 ("Kotlin for custom plugins"); no third-party plugin with broad permissions. |
| 7 | The manifest declares exactly the 13 `android.permission.health.*` permissions in the contract, plus the Health Connect `<queries>` entry. **Step 0 now checks every `<uses-permission>`** (the old regex silently skipped `health.*` names) and that the manifest matches the contract. | SA-C8 ("declare only v1 permissions, each with its feature") with an executable gate. |
| 8 | Health readings are **never stored** in PocketBase or the mirror and never logged: the shell logs app id, method, metric names and counts only. | HB-DATA-03; keeps the data inventory small (project-profile §5). |

## 3. Consequences

- Needs a **new APK** (shell, bridge and Android project changed). Until it is installed, EatWell shows "Update Supra to connect Health Connect" and works without activity data.
- The Kotlin plugin is first compiled by the CI *Android debug APK* job (no Android SDK in cloud sessions). If `connect-client` 1.1.0 API names differ, that job fails before anything ships.
- Reading history older than 30 days before the first grant needs `READ_HEALTH_DATA_HISTORY`; not requested now (trends use EatWell's own data first).
- Another subapp gets health data only by declaring the scope, passing Supra's sheet and Health Connect's dialog.

## 4. Approval

Changes the spec's capability map (Later → v1) and adds Android permissions, so it needs Nick's approval before merge (project-profile: a Profile may not relax a rule without an ADR approved by Nick).
