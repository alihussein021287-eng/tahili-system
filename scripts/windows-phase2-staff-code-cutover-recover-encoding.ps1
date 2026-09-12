$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

$target = Join-Path $Project "scripts\windows-phase2-staff-code-cutover.ps1"
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Target cutover script is missing: $target"
}

Write-Host ""
Write-Host "=== PHASE 2 STAFF CODE CUTOVER - POWERSHELL 5 UTF-8 RECOVERY ==="

# Windows PowerShell 5.1 treats UTF-8 files without a BOM as the local ANSI code page.
# The original script contains Arabic source snippets, so parsing can fail before any
# command executes. Read it explicitly as UTF-8, remove three cosmetic description
# rewrites that are not required for the UUID cutover, then write it back as UTF-8 BOM.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($target, $utf8NoBom)

$lines = $text -split "`r?`n"
$kept = New-Object System.Collections.Generic.List[string]
$removed = 0
foreach ($line in $lines) {
    if ($line -match '^\$staff\s*=\s*\$staff\.Replace\(''description=') {
        $removed++
        continue
    }
    $kept.Add($line)
}

if ($removed -ne 3 -and $removed -ne 0) {
    throw "Expected to remove either 3 cosmetic description rewrite lines or 0 on a repeated run; found $removed. Stop for review."
}

$patched = $kept -join "`r`n"
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($target, $patched, $utf8Bom)

$bytes = [System.IO.File]::ReadAllBytes($target)
if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    throw "Failed to write UTF-8 BOM to the cutover script."
}

Write-Host "UTF-8 BOM repair: PASS"
Write-Host "Cosmetic description rewrites removed: $removed"
Write-Host "Running repaired cutover script..."
Write-Host ""

& powershell -NoProfile -ExecutionPolicy Bypass -File $target
if ($LASTEXITCODE -ne 0) {
    throw "Repaired Phase 2 staff code cutover script failed with exit code $LASTEXITCODE."
}
