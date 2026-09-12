param(
  [string]$ProjectRoot = "C:\Users\Ali Hussein\Documents\GitHub\tahili-system-updates\UPDATE-01-GUID-FOUNDATION"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  Write-Host "Requesting Administrator privileges..."
  $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-ProjectRoot',"`"$ProjectRoot`"")
  Start-Process powershell.exe -Verb RunAs -ArgumentList $args
  exit
}

if (-not (Test-Path $ProjectRoot)) {
  throw "Project path not found: $ProjectRoot"
}

Set-Location $ProjectRoot

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path','Machine')
  $user = [Environment]::GetEnvironmentVariable('Path','User')
  $extra = @(
    "$env:LOCALAPPDATA\Microsoft\WindowsApps",
    'C:\Program Files\Docker\Docker\resources\bin',
    "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
  ) -join ';'
  $env:Path = "$machine;$user;$extra"
}

function Get-GitExe {
  $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending
  if ($candidates.Count -gt 0) { return $candidates[0].FullName }
  return $null
}

function New-SafeSecret([int]$Bytes = 24) {
  $buffer = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return ([Convert]::ToHexString($buffer)).ToLowerInvariant()
}

function Ensure-DockerDesktop {
  Refresh-Path
  $desktopCandidates = @(
    'C:\Program Files\Docker\Docker\Docker Desktop.exe',
    "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
  )
  foreach ($candidate in $desktopCandidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  Write-Step "Install Docker Desktop directly from Docker"
  $installer = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'
  $url = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'
  Write-Host "Downloading Docker Desktop..."
  Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
  if (-not (Test-Path $installer) -or (Get-Item $installer).Length -lt 1MB) {
    throw "Docker Desktop installer download failed."
  }

  Write-Host "Installing Docker Desktop with WSL2 backend..."
  $proc = Start-Process $installer -Wait -PassThru -ArgumentList @('install','--quiet','--accept-license','--backend=wsl-2')
  if ($proc.ExitCode -ne 0) {
    throw "Docker Desktop installation failed with code $($proc.ExitCode)"
  }
  Remove-Item $installer -Force -ErrorAction SilentlyContinue
  Refresh-Path

  foreach ($candidate in $desktopCandidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw "Docker Desktop installation completed but executable was not found."
}

Write-Step "Windows prerequisites"
Refresh-Path
$win = Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture
$win | Format-List | Out-Host

$wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
$vmFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
$rebootMayBeRequired = $false

if ($wslFeature.State -ne 'Enabled') {
  Write-Host "Enabling Windows Subsystem for Linux..."
  Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null
  $rebootMayBeRequired = $true
}
if ($vmFeature.State -ne 'Enabled') {
  Write-Host "Enabling Virtual Machine Platform..."
  Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null
  $rebootMayBeRequired = $true
}

try { wsl.exe --update --web-download | Out-Host } catch {
  try { wsl.exe --update | Out-Host } catch {}
}
try { wsl.exe --set-default-version 2 | Out-Host } catch {}

$dockerDesktop = Ensure-DockerDesktop

if ($rebootMayBeRequired) {
  Write-Host "`nWSL2/VirtualMachinePlatform were enabled successfully." -ForegroundColor Yellow
  Write-Host "A Windows restart is required once before Docker can start." -ForegroundColor Yellow
  Write-Host "Restart Windows, then run the SAME script again:" -ForegroundColor Yellow
  Write-Host "powershell -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\windows-saif-bootstrap.ps1`"" -ForegroundColor White
  exit 3010
}

Write-Step "Tool discovery"
$gitExe = Get-GitExe
if ($gitExe) { & $gitExe --version | Out-Host } else { Write-Host "Git CLI not found; continuing because the working copy already exists." -ForegroundColor Yellow }
Refresh-Path
try { docker --version | Out-Host } catch { throw "Docker CLI was not found after installation." }
try { wsl.exe --version | Out-Host } catch {}

Write-Step "Starting Docker Desktop"
$running = Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue
if (-not $running) { Start-Process $dockerDesktop | Out-Null }

$dockerReady = $false
for ($i = 0; $i -lt 120; $i++) {
  try {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
  } catch {}
  Start-Sleep -Seconds 4
}
if (-not $dockerReady) {
  throw "Docker Desktop did not become ready within 8 minutes. Open Docker Desktop once, wait until Engine is running, then rerun this script."
}

Write-Step "Create isolated local environment"
$envFile = Join-Path $ProjectRoot '.env.saif-dev'
$envLocal = Join-Path $ProjectRoot '.env.local'
$secretDir = Join-Path $ProjectRoot '.secrets'
$accessFile = Join-Path $secretDir 'SAIF-LOCAL-ACCESS.txt'
$composeFile = Join-Path $ProjectRoot 'docker-compose.saif-dev.yml'
New-Item -ItemType Directory -Force -Path $secretDir | Out-Null

if (-not (Test-Path $envFile)) {
  $dbPassword = New-SafeSecret 18
  $minioPassword = New-SafeSecret 18
  $nextAuthSecret = New-SafeSecret 32
  $reminderKey = New-SafeSecret 24
  $adminPassword = 'SaifDev!' + (New-SafeSecret 10)
  $gitRevision = 'saif-local'
  if ($gitExe) {
    try { $gitRevision = (& $gitExe rev-parse HEAD).Trim() } catch {}
  }

  @"
DB_USER=tahili_saif
DB_PASSWORD=$dbPassword
DB_NAME=tahili_saif
DATABASE_URL=postgresql://tahili_saif:$dbPassword@localhost:55432/tahili_saif
NEXTAUTH_SECRET=$nextAuthSecret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_URL_INTERNAL=http://localhost:3000
NEXTAUTH_ALLOW_HTTP_LOGIN=true
AUTH_TRUST_HOST=true
ADMIN_INITIAL_PASSWORD=$adminPassword
REMINDER_KEY=$reminderKey
MINIO_USER=saifadmin
MINIO_PASSWORD=$minioPassword
MINIO_ENDPOINT=localhost
MINIO_PORT=59000
MINIO_ACCESS_KEY=saifadmin
MINIO_SECRET_KEY=$minioPassword
UPLOAD_DIR=./uploads
ALLOW_INITIAL_SETUP=false
TAHILI_LAN_IP=127.0.0.1
GIT_REVISION=$gitRevision
"@ | Set-Content -Encoding UTF8 $envFile

  Copy-Item $envFile $envLocal -Force

  @"
Tahili Saif local staging
========================
Application: http://localhost:3000
MinIO Console: http://localhost:59001
PostgreSQL: localhost:55432
Database: tahili_saif
Database user: tahili_saif
Admin username: admin
Admin password: $adminPassword
MinIO user: saifadmin
MinIO password: $minioPassword

These credentials are LOCAL ONLY and stored under .secrets (gitignored).
"@ | Set-Content -Encoding UTF8 $accessFile
} else {
  Copy-Item $envFile $envLocal -Force
}

if (-not (Test-Path $composeFile)) {
  throw "Missing $composeFile. Pull the update branch first."
}

Write-Step "Load local environment"
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    $name = $matches[1].Trim()
    $value = $matches[2]
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

$compose = @('compose','-p','tahili-saif-dev','--env-file',$envFile,'-f',$composeFile)

Write-Step "Build application image"
& docker @compose build app
if ($LASTEXITCODE -ne 0) { throw "Docker app build failed." }
$buildExit = 0

Write-Step "Start PostgreSQL, MinIO and ClamAV"
& docker @compose up -d postgres minio clamav
if ($LASTEXITCODE -ne 0) { throw "Infrastructure startup failed." }

Write-Step "Wait for PostgreSQL"
$dbReady = $false
for ($i = 0; $i -lt 60; $i++) {
  & docker @compose exec -T postgres pg_isready -U $env:DB_USER -d $env:DB_NAME *> $null
  if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $dbReady) { throw "PostgreSQL did not become ready." }

Write-Step "Apply committed Prisma migrations"
& docker @compose run --rm --no-deps app npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed. db push was NOT used." }

Write-Step "Seed local database"
& docker @compose run --rm --no-deps app npm run db:seed
if ($LASTEXITCODE -ne 0) { throw "Database seed failed." }

Write-Step "Start Tahili app"
& docker @compose up -d app
if ($LASTEXITCODE -ne 0) { throw "Application startup failed." }

$checks = [ordered]@{}
$checks['build'] = $buildExit

Write-Step "Build isolated verification image"
& docker @compose --profile checks build checks
if ($LASTEXITCODE -ne 0) {
  $checks['checks-image'] = $LASTEXITCODE
} else {
  $checks['checks-image'] = 0

  Write-Step "TypeScript check inside Docker"
  & docker @compose --profile checks run --rm --no-deps checks npx tsc --noEmit
  $checks['typecheck'] = $LASTEXITCODE

  Write-Step "Unit/integration tests inside Docker"
  & docker @compose --profile checks run --rm --no-deps checks npm test
  $checks['tests'] = $LASTEXITCODE
}

Write-Step "Application health check"
$appReady = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/login' -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $appReady = $true; break }
  } catch {
    Start-Sleep -Seconds 2
  }
}
$checks['http'] = if ($appReady) { 0 } else { 1 }

Write-Step "Final status"
& docker @compose ps

$report = Join-Path $secretDir 'SAIF-LOCAL-SETUP-REPORT.txt'
@"
Tahili Saif local staging setup report
Generated: $(Get-Date -Format o)
Project: $ProjectRoot
Compose project: tahili-saif-dev
Application: http://localhost:3000
MinIO Console: http://localhost:59001
PostgreSQL: localhost:55432
Build exit: $($checks['build'])
Checks image exit: $($checks['checks-image'])
Typecheck exit: $($checks['typecheck'])
Tests exit: $($checks['tests'])
HTTP exit: $($checks['http'])
Credentials: $accessFile
"@ | Set-Content -Encoding UTF8 $report

Write-Host "`nLOCAL STAGING SETUP COMPLETE" -ForegroundColor Green
Write-Host "App: http://localhost:3000"
Write-Host "Credentials: $accessFile"
Write-Host "Report: $report"

if (($checks.Values | Where-Object { $_ -ne 0 }).Count -gt 0) {
  Write-Host "One or more verification checks failed; the environment remains running for diagnosis." -ForegroundColor Yellow
  exit 2
}

exit 0
