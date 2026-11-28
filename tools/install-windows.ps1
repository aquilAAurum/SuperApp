<#
.SYNOPSIS
  One-time setup of the Super app server on the Windows 11 mini PC (docs/runbook.md section 1).

.DESCRIPTION
  Run from a checkout of this repository, in an elevated PowerShell (Run as administrator):

      powershell -ExecutionPolicy Bypass -File tools\install-windows.ps1

  It is safe to re-run: every step checks what is already there.

  1. Tools via winget: Git, Node.js LTS (+ pnpm through corepack), Tailscale, NSSM.
     -WithAndroid also installs JDK 21 and Android Studio (only needed to build the APK locally).
  2. PocketBase (version pinned below), SHA-256 checked against the official release checksum.
  3. This repo's server/pb_migrations and server/pb_hooks, applied with `migrate up`.
  4. A PocketBase superuser (you are prompted; nothing is stored by this script).
  5. Windows service "superapp-pocketbase" (NSSM): starts with Windows, restarts on failure,
     listens on 127.0.0.1:8090 only, logs to <InstallDir>\logs.
  6. Tailscale Serve: https://<this-pc>.<tailnet>.ts.net -> 127.0.0.1:8090 (spec: no public ports).
  7. Health check, then a JSON summary line.

.PARAMETER NoService
  Skip the NSSM service and leave PocketBase stopped (used by CI).
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\superapp\pocketbase',
  [string]$ServiceName = 'superapp-pocketbase',
  [switch]$WithAndroid,
  [switch]$SkipTools,
  [switch]$SkipTailscale,
  [switch]$NoService,
  # Non-interactive superuser (CI). Interactive runs are prompted instead.
  [string]$SuperuserEmail = $env:PB_SUPERUSER_EMAIL,
  [string]$SuperuserPassword = $env:PB_SUPERUSER_PASSWORD
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Pinned with tools/pocketbase-ci.sh; checksum from the release's checksums.txt.
$PbVersion = '0.34.2'
$PbSha256 = '4567769e01f87285668585e1123163d73603de9912c354c858a2410db0ecb7cb' # pocketbase_0.34.2_windows_amd64.zip

$Repo = Split-Path -Parent $PSScriptRoot

function Write-Log([string]$Level, [string]$Msg, [hashtable]$Fields = @{}) {
  $entry = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); level = $Level; msg = $Msg }
  foreach ($k in $Fields.Keys) { $entry[$k] = $Fields[$k] }
  Write-Output ($entry | ConvertTo-Json -Compress)
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Update-SessionPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Install-WingetPackage([string]$Id, [string]$Command) {
  if ($Command -and (Get-Command $Command -ErrorAction SilentlyContinue)) {
    Write-Log 'info' 'tool.present' @{ id = $Id; command = $Command }
    return
  }
  # cmd /c keeps native stderr out of PowerShell's error stream (Windows PowerShell 5.1).
  cmd /c "winget list --id $Id --exact --accept-source-agreements >nul 2>nul"
  if ($LASTEXITCODE -eq 0) {
    Write-Log 'info' 'tool.present' @{ id = $Id }
    Update-SessionPath
    return
  }
  Write-Log 'info' 'tool.installing' @{ id = $Id }
  & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw "winget could not install $Id (exit $LASTEXITCODE)" }
  Update-SessionPath
}

if (-not (Test-Admin)) { throw 'Run this script from an elevated PowerShell (Run as administrator).' }
if (-not (Test-Path (Join-Path $Repo 'server\pb_migrations'))) { throw "Run from a checkout of the SuperApp repo (not found: $Repo\server\pb_migrations)." }

# --- 1. Tools ---------------------------------------------------------------
if (-not $SkipTools) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is missing. Install "App Installer" from the Microsoft Store, then re-run.' }
  Install-WingetPackage 'Git.Git' 'git'
  Install-WingetPackage 'OpenJS.NodeJS.LTS' 'node'
  if (-not $SkipTailscale) { Install-WingetPackage 'Tailscale.Tailscale' 'tailscale' }
  if (-not $NoService) { Install-WingetPackage 'NSSM.NSSM' 'nssm' }
  if ($WithAndroid) {
    Install-WingetPackage 'EclipseAdoptium.Temurin.21.JDK' $null
    Install-WingetPackage 'Google.AndroidStudio' $null
  }
}

$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required (found $(& node --version))." }
# Node 25+ no longer bundles corepack; install it from npm when missing.
if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
  Write-Log 'info' 'tool.installing' @{ id = 'corepack (npm)' }
  & npm install -g corepack
  if ($LASTEXITCODE -ne 0) { throw 'npm could not install corepack.' }
  Update-SessionPath
  $npmBin = Join-Path $env:APPDATA 'npm'
  if ((Test-Path $npmBin) -and ($env:Path -notlike "*$npmBin*")) { $env:Path = "$env:Path;$npmBin" }
  if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) { throw 'corepack is still not on PATH after installing it with npm.' }
}
& corepack enable
Push-Location $Repo
try {
  & corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
} finally { Pop-Location }
Write-Log 'info' 'repo.dependencies_installed' @{ node = (& node --version) }

# --- 2. PocketBase ----------------------------------------------------------
New-Item -ItemType Directory -Force -Path $InstallDir, (Join-Path $InstallDir 'logs') | Out-Null
$pbExe = Join-Path $InstallDir 'pocketbase.exe'
$installed = $null
if (Test-Path $pbExe) { $installed = ((& $pbExe --version) -split ' ')[-1] }
if ($installed -ne $PbVersion) {
  $zip = Join-Path $env:TEMP "pocketbase_${PbVersion}_windows_amd64.zip"
  $url = "https://github.com/pocketbase/pocketbase/releases/download/v$PbVersion/pocketbase_${PbVersion}_windows_amd64.zip"
  Write-Log 'info' 'pocketbase.downloading' @{ version = $PbVersion }
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
  if ($actual -ne $PbSha256) {
    Remove-Item $zip -Force
    throw "PocketBase checksum mismatch (expected $PbSha256, got $actual). Nothing was installed."
  }
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') { Stop-Service -Name $ServiceName }
  Expand-Archive -Path $zip -DestinationPath $InstallDir -Force
  Remove-Item $zip -Force
  Write-Log 'info' 'pocketbase.installed' @{ version = $PbVersion; path = $pbExe }
} else {
  Write-Log 'info' 'pocketbase.present' @{ version = $installed }
}

# --- 3. Migrations and hooks ------------------------------------------------
foreach ($dir in 'pb_migrations', 'pb_hooks') {
  $dest = Join-Path $InstallDir $dir
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Copy-Item -Recurse (Join-Path $Repo "server\$dir") $dest
}
$pbArgs = @('--dir', (Join-Path $InstallDir 'pb_data'), '--migrationsDir', (Join-Path $InstallDir 'pb_migrations'), '--hooksDir', (Join-Path $InstallDir 'pb_hooks'))
& $pbExe migrate up @pbArgs
if ($LASTEXITCODE -ne 0) { throw 'PocketBase migrations failed.' }
Write-Log 'info' 'pocketbase.migrated'

# --- 4. Superuser -----------------------------------------------------------
if (-not $SuperuserEmail) { $SuperuserEmail = Read-Host 'PocketBase admin email' }
if (-not $SuperuserPassword) {
  $secure = Read-Host 'PocketBase admin password (min 10 characters)' -AsSecureString
  $SuperuserPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
& $pbExe superuser upsert $SuperuserEmail $SuperuserPassword @pbArgs | Out-Null
$upsertExit = $LASTEXITCODE
$SuperuserPassword = $null
if ($upsertExit -ne 0) { throw 'Could not create the PocketBase superuser.' }
Write-Log 'info' 'pocketbase.superuser_ready' @{ email = $SuperuserEmail }

# --- 5. Windows service -----------------------------------------------------
if (-not $NoService) {
  if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    & nssm install $ServiceName $pbExe serve --http 127.0.0.1:8090 @pbArgs | Out-Null
  } else {
    & nssm set $ServiceName AppParameters ("serve --http 127.0.0.1:8090 " + (($pbArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ')) | Out-Null
  }
  & nssm set $ServiceName AppDirectory $InstallDir | Out-Null
  & nssm set $ServiceName DisplayName 'Super app PocketBase' | Out-Null
  & nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
  & nssm set $ServiceName AppExit Default Restart | Out-Null
  & nssm set $ServiceName AppRestartDelay 5000 | Out-Null
  & nssm set $ServiceName AppStdout (Join-Path $InstallDir 'logs\pocketbase.log') | Out-Null
  & nssm set $ServiceName AppStderr (Join-Path $InstallDir 'logs\pocketbase.log') | Out-Null
  & nssm set $ServiceName AppRotateFiles 1 | Out-Null
  & nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
  Restart-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ((Get-Service -Name $ServiceName).Status -ne 'Running') { Start-Service -Name $ServiceName }

  $healthy = $false
  for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
    try { $healthy = (Invoke-RestMethod -Uri 'http://127.0.0.1:8090/api/health' -TimeoutSec 2).code -eq 200 } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $healthy) { throw "PocketBase did not become healthy. See $InstallDir\logs\pocketbase.log" }
  Write-Log 'info' 'service.running' @{ service = $ServiceName; url = 'http://127.0.0.1:8090' }
}

# --- 6. Tailscale Serve (HTTPS for the phone) -------------------------------
$phoneUrl = $null
if (-not $SkipTailscale -and (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  cmd /c "tailscale status --json >nul 2>nul"
  if ($LASTEXITCODE -ne 0) {
    Write-Log 'warn' 'tailscale.not_signed_in' @{ next = 'Run "tailscale up", sign in, enable MagicDNS and HTTPS in the admin console, then re-run this script.' }
  } else {
    & tailscale serve --bg --https=443 http://127.0.0.1:8090 | Out-Null
    $dns = ((& tailscale status --json) | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
    $phoneUrl = "https://$dns"
    Write-Log 'info' 'tailscale.serving' @{ url = $phoneUrl }
  }
}

Write-Log 'info' 'install.done' @{
  pocketbase = $PbVersion
  admin_ui = 'http://127.0.0.1:8090/_/'
  phone_server_url = $phoneUrl
  next = 'Create the owner account in the admin UI (users collection), then follow docs/runbook.md section 4 for backups.'
}
