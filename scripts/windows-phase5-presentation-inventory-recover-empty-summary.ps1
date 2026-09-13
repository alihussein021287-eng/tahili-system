$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5 INVENTORY RECOVERY: EMPTY SUMMARY ==="
Write-Host "Project: $Project"

$inventoryPath = Join-Path $Project "scripts\windows-phase5-presentation-inventory.ps1"
if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { throw "Phase 5 inventory script missing: $inventoryPath" }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase5-presentation-inventory-summary-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $inventoryPath -Destination (Join-Path $rollbackDir "windows-phase5-presentation-inventory.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($inventoryPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")

$old='    $sum=($sourceRows | Where-Object Pattern -eq $key | Measure-Object -Property Count -Sum).Sum'
$new=@'
    $sum=0
    foreach ($row in @($sourceRows | Where-Object { $_.Pattern -eq $key })) {
        $sum += [int64]$row.Count
    }
'@
$new=$new.TrimEnd("`r","`n")

if ($text.Contains($old)) {
    $text=$text.Replace($old,$new)
    Write-Host "StrictMode-safe source summary: RECOVERED"
} elseif ($text.Contains('foreach ($row in @($sourceRows | Where-Object { $_.Pattern -eq $key }))')) {
    Write-Host "StrictMode-safe source summary: already present"
} else {
    throw "Phase 5 source summary block is not in expected pre/post recovery form. Stop for review."
}

# The prior recovery must already have corrected the physical legacy table name locally.
foreach ($needle in @('to_regclass(''public."CareStage"'')','FROM "CareStage"')) {
    if (-not $text.Contains($needle)) { throw "Expected prior CareStage table-name recovery marker missing: $needle" }
}

[System.IO.File]::WriteAllText($inventoryPath,$text,$utf8NoBom)

$tokens=$null
$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($inventoryPath,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) {
    $detail=($errors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n"
    throw "Recovered inventory parser validation failed:`n$detail"
}
Write-Host "PowerShell parser check: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 5 PRESENTATION / JOURNEY INVENTORY ==="
& powershell -ExecutionPolicy Bypass -File $inventoryPath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5 presentation inventory failed with exit code $LASTEXITCODE." }
