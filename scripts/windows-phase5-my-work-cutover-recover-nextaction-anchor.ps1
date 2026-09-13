$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5A MY WORK CUTOVER RECOVERY: NEXTACTION ANCHOR ==="
Write-Host "Project: $Project"

$cutoverPath = Join-Path $Project "scripts\windows-phase5-my-work-cutover.ps1"
if (-not (Test-Path -LiteralPath $cutoverPath -PathType Leaf)) { throw "Cutover script missing: $cutoverPath" }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir = Join-Path $Project (Join-Path ".secrets\phase5-my-work-nextaction-anchor-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $cutoverPath -Destination (Join-Path $rollbackDir "windows-phase5-my-work-cutover.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$text = [System.IO.File]::ReadAllText($cutoverPath,[System.Text.Encoding]::UTF8)
$text = $text.Replace("`r`n","`n").Replace("`r","`n")

$startMarker = 'if (-not $page.Contains(''function patientWorkItemTitle(kind: string)'')) {'
$endMarker = '$oldStageActions='
$start = $text.IndexOf($startMarker,[System.StringComparison]::Ordinal)
if ($start -lt 0) { throw "PatientWorkItem helper cutover start marker not found. Stop for review." }
$end = $text.IndexOf($endMarker,$start,[System.StringComparison]::Ordinal)
if ($end -lt 0) { throw "PatientWorkItem helper cutover end marker not found. Stop for review." }

$newBlock = @'
if (-not $page.Contains('function patientWorkItemTitle(kind: string)')) {
    $nextActionMarker='function nextAction(type: WorkItemType, status: string) {'
    if (-not $page.Contains($nextActionMarker)) { throw "My Work nextAction anchor missing. Stop for review." }
    $helperMarker='function patientWorkItemTitle(kind: string)'
    $helperIndex=$replacement.IndexOf($helperMarker,[System.StringComparison]::Ordinal)
    if ($helperIndex -lt 0) { throw "PatientWorkItem helper marker missing from cutover replacement." }
    $helperText=$replacement.Substring($helperIndex).TrimEnd("`r","`n")
    $page=$page.Replace($nextActionMarker,$helperText + "`n`n" + $nextActionMarker)
}

'@

$text = $text.Substring(0,$start) + $newBlock + $text.Substring($end)
Write-Host "Helper insertion anchor: RECOVERED using nextAction marker"

# Keep the cutover script safe for Windows PowerShell 5.1 because it contains Arabic literals.
[System.IO.File]::WriteAllText($cutoverPath,$text,(New-Object System.Text.UTF8Encoding($true)))

$bytes=[System.IO.File]::ReadAllBytes($cutoverPath)
if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) { throw "UTF-8 BOM verification failed after nextAction-anchor recovery." }
Write-Host "UTF-8 BOM verification: PASS"

$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($cutoverPath,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host $_.Message }
    throw "PowerShell parser check failed after nextAction-anchor recovery."
}
Write-Host "PowerShell parser check: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 5A MY WORK CUTOVER ==="
& powershell.exe -ExecutionPolicy Bypass -File $cutoverPath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5A My Work cutover failed with exit code $LASTEXITCODE." }
