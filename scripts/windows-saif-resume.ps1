param(
  [string]$ProjectRoot = "C:\Users\Ali Hussein\Documents\GitHub\tahili-system-updates\UPDATE-01-GUID-FOUNDATION"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ProjectRoot)) { throw "Project path not found: $ProjectRoot" }
Set-Location $ProjectRoot

$bootstrap = Join-Path $ProjectRoot 'scripts\windows-saif-bootstrap.ps1'
if (-not (Test-Path $bootstrap)) { throw "Missing bootstrap script: $bootstrap" }

Write-Host "=== Repair bootstrap for Windows PowerShell 5.1 ===" -ForegroundColor Cyan
$content = Get-Content $bootstrap -Raw

$replacement = @'
function New-SafeSecret([int]$Bytes = 24) {
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }
  return ([BitConverter]::ToString($buffer).Replace('-', '').ToLowerInvariant())
}
'@

$pattern = '(?s)function New-SafeSecret\(\[int\]\$Bytes = 24\) \{.*?\r?\n\}'
if ($content -notmatch $pattern) { throw 'Could not locate New-SafeSecret function in bootstrap script.' }
$content = [regex]::Replace($content, $pattern, $replacement, 1)

# WSL is already installed/upgraded separately. Avoid repeating online update calls that may return 403.
$content = $content -replace '(?s)try \{ wsl\.exe --update --web-download \| Out-Host \} catch \{\s*try \{ wsl\.exe --update \| Out-Host \} catch \{\}\s*\}', '# WSL already installed/updated separately; skip online update here.'

Set-Content -Path $bootstrap -Value $content -Encoding UTF8

if (-not (Select-String -Path $bootstrap -Pattern 'BitConverter' -Quiet)) { throw 'PowerShell 5.1 compatibility patch did not apply.' }
if (Select-String -Path $bootstrap -Pattern 'RandomNumberGenerator\]::Fill' -Quiet) { throw 'Old RandomNumberGenerator.Fill call still exists.' }

Write-Host "Bootstrap repaired successfully." -ForegroundColor Green
Write-Host "Starting Tahili local staging bootstrap..." -ForegroundColor Cyan

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap -ProjectRoot $ProjectRoot
exit $LASTEXITCODE
