# Deploys migrations and hooks to the mini PC (spec §Server setup, step 3).
# Run on the mini PC from a checkout of a tagged release:  powershell -ExecutionPolicy Bypass -File tools\deploy-server.ps1
# Assumes PocketBase lives in C:\superapp\pocketbase and runs as the NSSM service "superapp-pocketbase".
param(
  [string]$Target = 'C:\superapp\pocketbase',
  [string]$Service = 'superapp-pocketbase'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

Write-Output (@{ ts = (Get-Date).ToString('o'); level = 'info'; msg = 'deploy.backup_check'; target = $Target } | ConvertTo-Json -Compress)
if (-not (Test-Path "$Target\pb_data\backups")) {
  Write-Warning 'No PocketBase backups found. Take a backup in the admin UI before deploying (D19 runbook).'
}

Stop-Service -Name $Service
try {
  foreach ($dir in 'pb_migrations', 'pb_hooks') {
    $dest = Join-Path $Target $dir
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Copy-Item -Recurse (Join-Path $repo "server\$dir") $dest
  }
} finally {
  Start-Service -Name $Service
}
Write-Output (@{ ts = (Get-Date).ToString('o'); level = 'info'; msg = 'deploy.done'; service = $Service } | ConvertTo-Json -Compress)
