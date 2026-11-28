# Mini PC side of subapp updates by pull (ADR-009). Run from the SuperApp checkout on the mini PC.
#   pwsh tools/sync-subapps.ps1             pull main (fast-forward only), copy published/ to the inbox
#   pwsh tools/sync-subapps.ps1 -Register   run that every 15 minutes (Windows scheduled task)
# PocketBase imports new bundles from <Target>\subapps_inbox within a minute (server/pb_hooks/subapps.pb.js);
# phones pull them from the server. Only bundles are copied: migrations and hooks still deploy
# with tools/deploy-server.ps1, deliberately.
param(
  [string]$Target = 'C:\superapp\pocketbase',
  [string]$Branch = 'main',
  [int]$EveryMinutes = 15,
  [switch]$NoPull,
  [switch]$Register
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Write-Log([string]$msg, [hashtable]$fields = @{}) {
  $o = [ordered]@{ ts = (Get-Date).ToString('o'); level = 'info'; msg = $msg }
  foreach ($k in $fields.Keys) { $o[$k] = $fields[$k] }
  Write-Output ($o | ConvertTo-Json -Compress)
}

if ($Register) {
  $shellExe = (Get-Process -Id $PID).Path
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Target `"$Target`" -Branch $Branch"
  $action = New-ScheduledTaskAction -Execute $shellExe -Argument $arguments -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
  Register-ScheduledTask -TaskName 'Supra subapp sync' -Action $action -Trigger $trigger -Force `
    -Description "Pull published subapps from $Branch into $Target\subapps_inbox (ADR-009)" | Out-Null
  Write-Log 'subapps.sync_registered' @{ everyMinutes = $EveryMinutes; branch = $Branch; target = $Target }
  return
}

if (-not $NoPull) {
  $current = (git -C $repo rev-parse --abbrev-ref HEAD).Trim()
  if ($current -ne $Branch) { throw "The checkout at $repo is on '$current', not '$Branch'. Switch it first: git -C $repo switch $Branch" }
  git -C $repo fetch --quiet origin $Branch
  if ($LASTEXITCODE -ne 0) { throw "git fetch origin $Branch failed" }
  git -C $repo merge --ff-only --quiet FETCH_HEAD
  if ($LASTEXITCODE -ne 0) { throw "Local $Branch has diverged from origin/$Branch; not syncing (fast-forward only)." }
}

$src = Join-Path $repo 'published'
$dest = Join-Path $Target 'subapps_inbox'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
if (Test-Path $src) {
  robocopy $src $dest /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
  $global:LASTEXITCODE = 0
}
$bundles = @(Get-ChildItem -Path $dest -Recurse -Filter '*.zip' -ErrorAction SilentlyContinue).Count
Write-Log 'subapps.synced' @{ bundles = $bundles; commit = (git -C $repo rev-parse --short HEAD).Trim(); inbox = $dest }
