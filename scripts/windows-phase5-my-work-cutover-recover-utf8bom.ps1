$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5A MY WORK CUTOVER RECOVERY: UTF8 BOM ==="
Write-Host "Project: $Project"

$cutoverPath = Join-Path $Project "scripts\windows-phase5-my-work-cutover.ps1"
if (-not (Test-Path -LiteralPath $cutoverPath -PathType Leaf)) { throw "Cutover script missing: $cutoverPath" }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir = Join-Path $Project (Join-Path ".secrets\phase5-my-work-cutover-utf8bom-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $cutoverPath -Destination (Join-Path $rollbackDir "windows-phase5-my-work-cutover.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$text = [System.IO.File]::ReadAllText($cutoverPath,$utf8NoBom)

if (-not $text.Contains('PHASE 5A MY WORK CUTOVER')) { throw "Unexpected cutover script content. Stop for review." }
if (-not $text.Contains('PROGRESS_IN')) { throw "Expected Phase 5A stage action content missing. Stop for review." }
if (-not $text.Contains('patientWorkItem.findMany')) { throw "Expected PatientWorkItem cutover block missing. Stop for review." }

[System.IO.File]::WriteAllText($cutoverPath,$text,$utf8Bom)
Write-Host "Cutover script encoding: UTF-8 BOM"

$bytes = [System.IO.File]::ReadAllBytes($cutoverPath)
if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    throw "UTF-8 BOM verification failed."
}
Write-Host "BOM verification: PASS"

$tokens=$null
$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($cutoverPath,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) {
    $detail = ($errors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n"
    throw "Phase 5A cutover parser validation still failed after BOM recovery:`n$detail"
}
Write-Host "PowerShell parser check: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 5A MY WORK CUTOVER ==="
& powershell -ExecutionPolicy Bypass -File $cutoverPath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5A My Work cutover failed with exit code $LASTEXITCODE." }
