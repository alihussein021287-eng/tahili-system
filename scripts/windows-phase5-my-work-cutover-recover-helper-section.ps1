$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5A MY WORK CUTOVER RECOVERY: HELPER SECTION V2 ==="
Write-Host "Project: $Project"

$cutoverPath = Join-Path $Project "scripts\windows-phase5-my-work-cutover.ps1"
if (-not (Test-Path -LiteralPath $cutoverPath -PathType Leaf)) { throw "Cutover script missing: $cutoverPath" }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir = Join-Path $Project (Join-Path ".secrets\phase5-my-work-helper-section-recovery-v2" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $cutoverPath -Destination (Join-Path $rollbackDir "windows-phase5-my-work-cutover.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$text = [System.IO.File]::ReadAllText($cutoverPath,[System.Text.Encoding]::UTF8)
$text = $text.Replace("`r`n","`n").Replace("`r","`n")

$startMarker = "if (-not `$page.Contains('function patientWorkItemTitle(kind: string)')) {"
$endMarker = "`n`$oldStageActions="
$start = $text.IndexOf($startMarker,[System.StringComparison]::Ordinal)
$end = if ($start -ge 0) { $text.IndexOf($endMarker,$start,[System.StringComparison]::Ordinal) } else { -1 }

if ($start -lt 0 -or $end -lt 0 -or $end -le $start) {
    throw "Current helper insertion section could not be bounded safely. Stop for review."
}

$replacement = @"
if (-not `$page.Contains('function patientWorkItemTitle(kind: string)')) {
    `$helperText=@'
function patientWorkItemTitle(kind: string) {
  if (kind.startsWith("LEGACY_CARE_STAGE:")) return kind.slice("LEGACY_CARE_STAGE:".length).trim() || "عمل رعاية";
  if (kind === "REFERRAL_INTERNAL_SPECIALIST") return "إحالة داخلية إلى اختصاصي";
  if (kind === "REFERRAL_INTERNAL_CENTER") return "إحالة داخلية إلى وحدة";
  return "عمل رعاية";
}
'@
    `$nextActionMarker='function nextAction(type: WorkItemType, status: string) {'
    `$nextActionIndex=`$page.IndexOf(`$nextActionMarker,[System.StringComparison]::Ordinal)
    if (`$nextActionIndex -lt 0) { throw "My Work nextAction insertion anchor missing. Stop for review." }
    `$page=`$page.Substring(0,`$nextActionIndex) + `$helperText.TrimEnd("``r","``n") + "``n``n" + `$page.Substring(`$nextActionIndex)
}
"@

$text = $text.Substring(0,$start) + $replacement.TrimEnd("`r","`n") + $text.Substring($end)
[System.IO.File]::WriteAllText($cutoverPath,$text,(New-Object System.Text.UTF8Encoding($true)))
Write-Host "Helper insertion section: REBUILT"

$bytes=[System.IO.File]::ReadAllBytes($cutoverPath)
if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) { throw "UTF-8 BOM verification failed after helper-section recovery." }
Write-Host "UTF-8 BOM verification: PASS"

$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($cutoverPath,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host $_.Message }
    throw "PowerShell parser check failed after helper-section recovery."
}
Write-Host "PowerShell parser check: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 5A MY WORK CUTOVER ==="
& powershell.exe -ExecutionPolicy Bypass -File $cutoverPath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5A My Work cutover failed with exit code $LASTEXITCODE." }
