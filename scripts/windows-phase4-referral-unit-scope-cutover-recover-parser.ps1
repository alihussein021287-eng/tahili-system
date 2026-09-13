$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 4 RECOVERY: REFERRAL UNIT SCOPE PARSER ==="
Write-Host "Project: $Project"

$mainPath = Join-Path $Project "scripts\windows-phase4-referral-unit-scope-cutover.ps1"
if (-not (Test-Path -LiteralPath $mainPath -PathType Leaf)) {
    throw "Main Phase 4 scope cutover script missing: $mainPath"
}

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-referral-unit-scope-parser-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $mainPath -Destination (Join-Path $rollbackDir "windows-phase4-referral-unit-scope-cutover.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($mainPath,[System.Text.Encoding]::UTF8)) {
    [void]$lines.Add($line)
}

$fixedValidation = 0
$fixedFixture = 0
for ($i=0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line.Contains('$new=$old+') -and $line.Contains('DESTINATION_UNIT_REQUIRED') -and $line.Contains('\"')) {
        $lines[$i] = '    $new=$old+"`n  | `"DESTINATION_UNIT_REQUIRED`""'
        $fixedValidation++
        continue
    }
    if ($line.Contains('$new=$old+') -and $line.Contains('destinationUnitId:') -and $line.Contains('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') -and $line.Contains('\"')) {
        $lines[$i] = '    $new=$old+"`n    destinationUnitId: `"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`","'
        $fixedFixture++
    }
}

if ($fixedValidation -ne 1) {
    throw "Expected exactly one DESTINATION_UNIT_REQUIRED parser escape fix, found $fixedValidation. Stop for review."
}
if ($fixedFixture -ne 1) {
    throw "Expected exactly one destinationUnitId fixture parser escape fix, found $fixedFixture. Stop for review."
}

$text = [string]::Join("`n",$lines)
if (-not $text.EndsWith("`n")) { $text += "`n" }
[System.IO.File]::WriteAllText($mainPath,$text,(New-Object System.Text.UTF8Encoding($false)))
Write-Host "Parser escape fixes: APPLIED (2)"

$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($mainPath,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    $detail = ($errors | ForEach-Object { "Line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n"
    throw "PowerShell parser still reports errors. Stop before execution.`n$detail"
}
Write-Host "Full PowerShell parser check: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 4 REFERRAL UNIT SCOPE CUTOVER ==="
& powershell -ExecutionPolicy Bypass -File $mainPath
if ($LASTEXITCODE -ne 0) {
    throw "Resumed Phase 4 referral Unit scope cutover failed with exit code $LASTEXITCODE."
}
