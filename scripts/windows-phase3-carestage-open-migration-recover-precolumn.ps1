$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Source = Join-Path $PSScriptRoot "windows-phase3-carestage-open-migration.ps1"
$Temp = Join-Path $PSScriptRoot (".phase3-carestage-open-migration-fixed-" + [Guid]::NewGuid().ToString("N") + ".ps1")

Write-Host ""
Write-Host "=== PHASE 3 CARESTAGE OPEN MIGRATION - PRE-COLUMN RECOVERY ==="

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Source migration script not found: $Source"
}

$text = [System.IO.File]::ReadAllText($Source,[System.Text.Encoding]::UTF8)
$bad = 'UNION ALL SELECT ''legacy_mapped|'' || count(*) FROM "patient_work_items" WHERE "legacyCareStageId" IS NOT NULL;'
if (-not $text.Contains($bad)) {
    throw "Expected pre-column legacy_mapped query not found. Stop for review."
}

$fixed = $text.Replace($bad,';')
[System.IO.File]::WriteAllText($Temp,$fixed,(New-Object System.Text.UTF8Encoding($true)))
Write-Host "Pre-column count repair: PASS"
Write-Host "Running guarded CareStage open migration..."

try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $Temp
    $code=$LASTEXITCODE
    if ($code -ne 0) { throw "Recovered CareStage open migration failed with exit code $code." }
}
finally {
    if (Test-Path -LiteralPath $Temp) { Remove-Item -LiteralPath $Temp -Force }
}
