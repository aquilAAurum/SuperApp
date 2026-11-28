# Runbook & SLO Sheet (Doc ID D19, draft)

Owner: Theo (Release & SRE). Status: draft for Sprint 1; SLOs become binding at `9_OPERATE`.

## 1. Mini PC setup (spec §Server setup)

**Automated:** from a checkout of `main`, in PowerShell **run as administrator**:

```powershell
git clone https://github.com/aquilAAurum/SuperApp.git C:\superapp\repo
cd C:\superapp\repo
powershell -ExecutionPolicy Bypass -File tools\install-windows.ps1
```

`tools/install-windows.ps1` (safe to re-run; CI job "Windows install script" exercises it on every PR):

1. Installs Git, Node.js LTS (+ pnpm via corepack), Tailscale and NSSM with `winget`; `-WithAndroid` adds JDK 21 and Android Studio.
2. Downloads PocketBase (pinned version), verifies its SHA-256 against the release checksum, installs to `C:\superapp\pocketbase\`.
3. Copies `server/pb_migrations` and `server/pb_hooks`, runs `migrate up`.
4. Prompts for and creates the PocketBase superuser.
5. Registers the NSSM service `superapp-pocketbase`: automatic start, restart on failure, `127.0.0.1:8090` only, logs in `C:\superapp\pocketbase\logs`.
6. If Tailscale is signed in, runs `tailscale serve --bg --https=443 http://127.0.0.1:8090` and prints the phone's server URL. If not: run `tailscale up`, enable MagicDNS and HTTPS certificates in the Tailscale admin console, and re-run the script.

**Manual steps that stay manual:**

- **Owner account:** in the admin UI (`http://127.0.0.1:8090/_/`), create the owner in `users`.
- **Integrations (M6):** add Home Assistant, Jellyfin and Anthropic entries in `core_integrations` via the admin UI only. Never put these values in the repo or on the phone.
- **Windows:** disable sleep; BIOS "restore on AC power loss"; Windows Update active hours with restarts at 04:00.
- **Later deploys:** `powershell -ExecutionPolicy Bypass -File tools\deploy-server.ps1` (copies migrations and hooks, restarts the service).

### 1.1 Subapp updates (ADR-009)

One-time, on the mini PC, in Windows PowerShell **as Administrator** (deploy restarts the PocketBase service), from the SuperApp checkout on `main` after the PR is merged (`git switch main; git pull --ff-only`). PowerShell 7 (`pwsh`) is not needed:

```powershell
powershell -ExecutionPolicy Bypass -File tools\deploy-server.ps1          # installs the subapps hook and protected-bundle migration
powershell -ExecutionPolicy Bypass -File tools\sync-subapps.ps1           # first pull + copy now
powershell -ExecutionPolicy Bypass -File tools\sync-subapps.ps1 -Register # then every 15 minutes (scheduled task "Supra subapp sync")
```

The task runs as the signed-in user (uses the checkout's existing git credentials). Check it: Task Scheduler → *Supra subapp sync* → Last Run Result; PocketBase logs show `subapps.imported` / `subapps.import_rejected`. On the phone, Settings → Subapps shows each app's version and source; *Check for updates* pulls now.

## 2. Phone

1. Download the APK from the GitHub Release (or the CI `superapp-debug-apk` artifact) and install it (`adb install` or the Android installer).
2. First run: server URL `https://<minipc>.<tailnet>.ts.net`, sign in, the phone registers itself in `core_devices`.
3. **Keep Tailscale connected:** Android can drop the Tailscale VPN (seen after airplane mode on 2026-11-28). Turn on Settings → Network → VPN → Tailscale → **Always-on VPN**. If the header shows `Offline` while Wi-Fi works, open the Tailscale app first; queued changes are kept and sync when it reconnects.
4. **Installing builds:** `adb install -r app-debug.apk` updates in place (debug builds share one signing key since 7f1fc2b).
5. **Safe mode:** Settings → Safe mode, if a subapp misbehaves at start.

## 3. Health checks and SLOs (proposed)

| Signal | Check | SLO |
| :-- | :-- | :-- |
| Server reachable | `GET /api/health` (shell header, Diagnostics) | 99.5 % monthly while the phone is on the tailnet |
| Handshake time | Diagnostics → Apps | p95 < 500 ms |
| Rejected calls | Diagnostics → Error log | Investigated weekly |

## 4. Backups (HB-OPS-03)

- PocketBase scheduled backup nightly (admin UI → Settings → Backups).
- Task Scheduler job: encrypt the newest zip (e.g. `age` or 7-Zip AES-256) and copy it to the external drive and the off-site target **(target: open question, see roadmap)**. Keep 14 daily and 8 weekly.
- **Monthly restore test:** restore the newest backup into a scratch data dir, start PocketBase on another port, check `schema_info` and a known record. Record the date in D12.

## 5. Rollback

| Component | Procedure |
| :-- | :-- |
| Shell APK | Install the previous release APK (same signing key; Android keeps app data). |
| Server hooks/migrations | Stop service → restore the pre-deploy backup → deploy the previous release's `superapp-server-*.tar.gz` → start. |
| Subapp | Built-in subapps roll back with the APK. Server-installed bundles roll back in the App manager (M5). |
