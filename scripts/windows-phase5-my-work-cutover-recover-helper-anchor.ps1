$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5A MY WORK CUTOVER RECOVERY: HELPER ANCHOR ==="
Write-Host "Project: $Project"

$cutoverPath = Join-Path $Project "scripts\windows-phase5-my-work-cutover.ps1"
if (-not (Test-Path -LiteralPath $cutoverPath -PathType Leaf)) { throw "Cutover script missing: $cutoverPath" }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir = Join-Path $Project (Join-Path ".secrets\phase5-my-work-helper-anchor-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $cutoverPath -Destination (Join-Path $rollbackDir "windows-phase5-my-work-cutover.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$text = [System.IO.File]::ReadAllText($cutoverPath,[System.Text.Encoding]::UTF8)
$text = $text.Replace("`r`n","`n").Replace("`r","`n")

$old = @'
    if (-not $page.Contains($anchor)) { throw "My Work helper anchor missing. Stop for review." }
    $page=$page.Replace($anchor,$replacement)
'@

$new = @'
    if ($page.Contains($anchor)) {
        $page=$page.Replace($anchor,$replacement)
    } else {
        $branchPattern='(?ms)function\s+branchFields\s*\(\s*row\s*:\s*any\s*\)\s*\{.*?^\s*\}'
        $branchMatch=[regex]::Match($page,$branchPattern)
        if (-not $branchMatch.Success) { throw "My Work branchFields helper could not be located by exact or regex anchor. Stop for review." }
        $helperMarker='function patientWorkItemTitle(kind: string)'
        $helperIndex=$replacement.IndexOf($helperMarker,[System.StringComparison]::Ordinal)
        if ($helperIndex -lt 0) { throw "PatientWorkItem helper marker missing from cutover replacement." }
        $helperText=$replacement.Substring($helperIndex).TrimEnd("`r","`n")
        $insertAt=$branchMatch.Index + $branchMatch.Length
        $page=$page.Substring(0,$insertAt) + "`n`n" + $helperText + $page.Substring($insertAt)
    }
'@

if ($text.Contains($old)) {
    $text = $text.Replace($old,$new)
    Write-Host "Helper anchor strategy: RECOVERED with regex fallback"
} elseif ($text.Contains('$branchPattern=')) {
    Write-Host "Helper anchor strategy: already recovered"
} else {
    throw "Expected helper-anchor block was not found in local cutover script. Stop for review."
}

# Preserve Windows PowerShell 5.1-safe UTF-8 BOM because the cutover script contains Arabic literals.
[System.IO.File]::WriteAllText($cutoverPath,$text,(New-Object System.Text.UTF8Encoding($true)))

$bytes=[System.IO.File]::ReadAllBytes($cutoverPath)
if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) { throw "UTF-8 BOM verification failed after helper-anchor recovery." }
Write-Host "UTF-8 BOM verification: PASS"

$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($cutoverPath,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host $_.Message }
    throw "PowerShell parser check failed after helper-anchor recovery."
}
Write-Host "PowerShell parser check: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 5A MY WORK CUTOVER ==="
& powershell.exe -ExecutionPolicy Bypass -File $cutoverPath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5A My Work cutover failed with exit code $LASTEXITCODE." }
