param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  Write-Host 'Requesting Administrator privileges...'
  Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"")
  exit
}

Write-Host "`n=== Repair / update WSL from official Microsoft GitHub release ===" -ForegroundColor Cyan

dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to enable Microsoft-Windows-Subsystem-Linux ($LASTEXITCODE)" }
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to enable VirtualMachinePlatform ($LASTEXITCODE)" }

$headers = @{ 'User-Agent' = 'Tahili-Saif-WSL-Installer'; 'Accept' = 'application/vnd.github+json' }
$releaseUri = 'https://api.github.com/repos/microsoft/WSL/releases/latest'
Write-Host 'Reading latest WSL release metadata from Microsoft GitHub...'
$release = Invoke-RestMethod -Uri $releaseUri -Headers $headers -UseBasicParsing
$asset = $release.assets | Where-Object { $_.name -match '\.x64\.msi$' } | Select-Object -First 1
if (-not $asset) { $asset = $release.assets | Where-Object { $_.name -match 'x64.*\.msi$' } | Select-Object -First 1 }
if (-not $asset) { throw 'Could not find the official x64 WSL MSI in the latest Microsoft/WSL release.' }

$msi = Join-Path $env:TEMP $asset.name
Write-Host ("Downloading {0} ..." -f $asset.name)
try {
  Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $msi -UseBasicParsing
} catch {
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --retry 3 -o $msi $asset.browser_download_url
    if ($LASTEXITCODE -ne 0) { throw "WSL MSI download failed via GitHub/curl ($LASTEXITCODE)" }
  } else { throw }
}
if (-not (Test-Path $msi) -or (Get-Item $msi).Length -lt 1MB) { throw 'Downloaded WSL MSI is missing or unexpectedly small.' }

Write-Host 'Installing/updating WSL MSI...'
$proc = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @('/i',"`"$msi`"",'/qn','/norestart')
if ($proc.ExitCode -notin @(0,3010)) { throw "WSL MSI installation failed with code $($proc.ExitCode)" }
Remove-Item $msi -Force -ErrorAction SilentlyContinue

Write-Host "`n=== Verify WSL ===" -ForegroundColor Cyan
& wsl.exe --version | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'wsl --version failed after MSI installation.' }
& wsl.exe --set-default-version 2 | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Could not set WSL 2 as default.' }

Write-Host "`nWSL UPDATE COMPLETE" -ForegroundColor Green
Write-Host 'Now rerun scripts\windows-saif-bootstrap.ps1.'
