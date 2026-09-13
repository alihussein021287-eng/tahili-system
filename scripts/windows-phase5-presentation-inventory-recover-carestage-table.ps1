$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5 INVENTORY RECOVERY: CARESTAGE TABLE NAME ==="
Write-Host "Project: $Project"

$inventoryPath = Join-Path $Project "scripts\windows-phase5-presentation-inventory.ps1"
if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { throw "Phase 5 inventory script missing: $inventoryPath" }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase5-presentation-inventory-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $inventoryPath -Destination (Join-Path $rollbackDir "windows-phase5-presentation-inventory.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($inventoryPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")

$oldReg = "to_regclass('public.care_stages')"
$newReg = "to_regclass('public.`"CareStage`"')"
if ($text.Contains($oldReg)) {
    $text = $text.Replace($oldReg,$newReg)
} elseif (-not $text.Contains($newReg)) {
    throw "CareStage to_regclass check is not in expected pre/post recovery form. Stop for review."
}

$oldFrom = 'FROM "care_stages"'
$newFrom = 'FROM "CareStage"'
if ($text.Contains($oldFrom)) {
    $text = $text.Replace($oldFrom,$newFrom)
} elseif (-not $text.Contains($newFrom)) {
    throw "CareStage SQL relation references are not in expected pre/post recovery form. Stop for review."
}

if ($text.Contains('FROM "care_stages"') -or $text.Contains("to_regclass('public.care_stages')")) {
    throw "Legacy incorrect care_stages relation reference remains after recovery."
}
if (-not $text.Contains('FROM "CareStage"') -or -not $text.Contains("to_regclass('public.`"CareStage`"')")) {
    throw "Recovered CareStage relation assertions failed."
}

[System.IO.File]::WriteAllText($inventoryPath,$text,$utf8NoBom)
Write-Host "CareStage physical table name: RECOVERED (CareStage)"

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
