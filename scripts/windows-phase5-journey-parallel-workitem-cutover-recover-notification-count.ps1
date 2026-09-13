$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5B JOURNEY CUTOVER RECOVERY: NOTIFICATION COUNT ==="
Write-Host "Project: $Project"

$cutoverPath = Join-Path $Project "scripts\windows-phase5-journey-parallel-workitem-cutover.ps1"
if (-not (Test-Path -LiteralPath $cutoverPath -PathType Leaf)) { throw "Cutover script missing: $cutoverPath" }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir = Join-Path $Project (Join-Path ".secrets\phase5-journey-notification-count-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $cutoverPath -Destination (Join-Path $rollbackDir "windows-phase5-journey-parallel-workitem-cutover.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$text = [System.IO.File]::ReadAllText($cutoverPath,[System.Text.Encoding]::UTF8)
$text = $text.Replace("`r`n","`n").Replace("`r","`n")

$badLine = "UNION ALL SELECT 'notifications|' || count(*) FROM `"notifications`"`n"
if ($text.Contains($badLine)) {
    $text = $text.Replace($badLine,"")
    Write-Host "Notification row-count guard: REMOVED from Phase 5B code-only cutover"
} elseif ($text.Contains("FROM `"notifications`"")) {
    throw "Notification table reference exists in an unexpected form. Stop for review."
} else {
    Write-Host "Notification row-count guard: already absent"
}

[System.IO.File]::WriteAllText($cutoverPath,$text,(New-Object System.Text.UTF8Encoding($true)))

$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($cutoverPath,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host $_.Message }
    throw "PowerShell parser check failed after notification-count recovery."
}
Write-Host "PowerShell parser check: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 5B JOURNEY CUTOVER ==="
& powershell.exe -ExecutionPolicy Bypass -File $cutoverPath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5B journey cutover failed with exit code $LASTEXITCODE." }
