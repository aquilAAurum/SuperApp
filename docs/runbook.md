# Runbook & SLO Sheet (Doc ID D19, draft)

Owner: Theo (Release & SRE). Status: draft for Sprint 1; SLOs become binding at `9_OPERATE`.

## 1. Mini PC setup (spec §Server setup)

1. **Tailscale:** install, sign in, enable MagicDNS and HTTPS certificates. Expose PocketBase with Tailscale Serve so the phone uses `https://<minipc>.<tailnet>.ts.net`:
   `tailscale serve --bg --https=443 http://127.0.0.1:8090`
2. **PocketBase:** download the Windows x64 build of the version pinned in `tools/pocketbase-ci.sh` into `C:\superapp\pocketbase\`. Bind it to loopback only: `pocketbase.exe serve --http 127.0.0.1:8090`.
3. **Service:** install with NSSM as `superapp-pocketbase`, startup Automatic, restart on failure.
4. **Schema and hooks:** from a checkout of the release tag, run `pwsh tools/deploy-server.ps1` (copies `server/pb_migrations` and `server/pb_hooks`, restarts the service; migrations apply on start).
5. **Owner account:** create the superuser in the admin UI, then the owner in `users`.
6. **Integrations (M6):** add Home Assistant, Jellyfin and Anthropic entries in `core_integrations` via the admin UI only. Never put these values in the repo or on the phone.
7. **Windows:** disable sleep; BIOS "restore on AC power loss"; Windows Update active hours with restarts at 04:00.

## 2. Phone

1. Download the APK from the GitHub Release (or the CI `superapp-debug-apk` artifact) and install it (`adb install` or the Android installer).
2. First run: server URL `https://<minipc>.<tailnet>.ts.net`, sign in, the phone registers itself in `core_devices`.
3. **Safe mode:** Settings → Safe mode, if a subapp misbehaves at start.

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
