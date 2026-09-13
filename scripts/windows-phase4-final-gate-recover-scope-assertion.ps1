$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 4 FINAL GATE RECOVERY: SCOPE ASSERTION ==="
Write-Host "Project: $Project"

$gatePath = Join-Path $Project "scripts\windows-phase4-final-gate.ps1"
if (-not (Test-Path -LiteralPath $gatePath -PathType Leaf)) { throw "Final gate script missing: $gatePath" }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-final-gate-scope-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $gatePath -Destination (Join-Path $rollbackDir "windows-phase4-final-gate.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$gate = [System.IO.File]::ReadAllText($gatePath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")

$oldLoad=@'
$notify = Read-Utf8 "src\lib\notify.ts"
$scope = Read-Utf8 "src\lib\patient-work-item-scope.ts"
'@
$newLoad=@'
$notify = Read-Utf8 "src\lib\notify.ts"
$scope = Read-Utf8 "src\lib\patient-work-item-scope.ts"
$workItemService = Read-Utf8 "src\lib\patient-work-item.ts"
'@
if ($gate.Contains($oldLoad)) {
    $gate=$gate.Replace($oldLoad,$newLoad)
} elseif (-not $gate.Contains('$workItemService = Read-Utf8 "src\lib\patient-work-item.ts"')) {
    throw "Final gate source-load block is not in expected pre/post recovery form. Stop for review."
}

$oldScope=@'
foreach ($needle in @('assignedUserId','assignedUnitId','userUnitMembership')) {
    if (-not $scope.Contains($needle)) { throw "PatientWorkItem scope final-gate assertion failed: $needle" }
}
'@
$newScope=@'
foreach ($needle in @('assignedUserId','assignedUnitId','unitIds','isWorkItemInActorUnit')) {
    if (-not $scope.Contains($needle)) { throw "PatientWorkItem scope final-gate assertion failed: $needle" }
}
foreach ($needle in @('WORK_ITEM_UNIT_MEMBERSHIP_REQUIRED','WORK_ITEM_ASSIGNED_USER_REQUIRED','assignedUserId: actor.guid','userUnitMembership.findFirst')) {
    if (-not $workItemService.Contains($needle)) { throw "PatientWorkItem service final-gate assertion failed: $needle" }
}
if ($workItemService -match '(?i)assignedRole|responsibleRole') {
    throw "PatientWorkItem service unexpectedly contains Role-based ownership."
}
'@
if ($gate.Contains($oldScope)) {
    $gate=$gate.Replace($oldScope,$newScope)
} elseif (-not $gate.Contains("'isWorkItemInActorUnit'")) {
    throw "Final gate scope assertion block is not in expected pre/post recovery form. Stop for review."
}

[System.IO.File]::WriteAllText($gatePath,$gate,$utf8NoBom)
Write-Host "Final gate scope assertion: RECOVERED"

$tokens=$null
$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($gatePath,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) {
    $detail=($errors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n"
    throw "Recovered final gate parser validation failed:`n$detail"
}
Write-Host "Full PowerShell parser check: PASS"

# Confirm the local source contract before re-running the expensive gate.
$scopePath=Join-Path $Project "src\lib\patient-work-item-scope.ts"
$servicePath=Join-Path $Project "src\lib\patient-work-item.ts"
if (-not (Test-Path -LiteralPath $scopePath -PathType Leaf) -or -not (Test-Path -LiteralPath $servicePath -PathType Leaf)) {
    throw "PatientWorkItem policy/service source missing."
}
$scopeText=[System.IO.File]::ReadAllText($scopePath,[System.Text.Encoding]::UTF8)
$serviceText=[System.IO.File]::ReadAllText($servicePath,[System.Text.Encoding]::UTF8)
foreach ($needle in @('assignedUserId','assignedUnitId','unitIds','isWorkItemInActorUnit')) {
    if (-not $scopeText.Contains($needle)) { throw "Local scope contract missing: $needle" }
}
foreach ($needle in @('WORK_ITEM_UNIT_MEMBERSHIP_REQUIRED','WORK_ITEM_ASSIGNED_USER_REQUIRED','assignedUserId: actor.guid','userUnitMembership.findFirst')) {
    if (-not $serviceText.Contains($needle)) { throw "Local WorkItem service contract missing: $needle" }
}
Write-Host "Local WorkItem policy/service contract: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 4 FINAL GATE ==="
& powershell -ExecutionPolicy Bypass -File $gatePath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 4 final gate failed with exit code $LASTEXITCODE." }
