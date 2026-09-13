$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 4 FINAL GATE RECOVERY: LINE-SAFE SCOPE ASSERTION ==="
Write-Host "Project: $Project"

$gatePath = Join-Path $Project "scripts\windows-phase4-final-gate.ps1"
if (-not (Test-Path -LiteralPath $gatePath -PathType Leaf)) { throw "Final gate script missing: $gatePath" }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-final-gate-scope-line-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $gatePath -Destination (Join-Path $rollbackDir "windows-phase4-final-gate.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($gatePath,[System.Text.Encoding]::UTF8)) {
    [void]$lines.Add($line)
}

$scopeLoad = '$scope = Read-Utf8 "src\lib\patient-work-item-scope.ts"'
$serviceLoad = '$workItemService = Read-Utf8 "src\lib\patient-work-item.ts"'
if (-not $lines.Contains($serviceLoad)) {
    $idx = $lines.IndexOf($scopeLoad)
    if ($idx -lt 0) { throw "Could not find PatientWorkItem scope source-load line. Stop for review." }
    $lines.Insert($idx + 1, $serviceLoad)
    Write-Host "WorkItem service source-load assertion: ADDED"
} else {
    Write-Host "WorkItem service source-load assertion: already present"
}

$oldStart = "foreach (`$needle in @('assignedUserId','assignedUnitId','userUnitMembership')) {"
$newMarker = "foreach (`$needle in @('assignedUserId','assignedUnitId','unitIds','isWorkItemInActorUnit')) {"
if (-not $lines.Contains($newMarker)) {
    $idx = $lines.IndexOf($oldStart)
    if ($idx -lt 0) { throw "Could not find old PatientWorkItem scope assertion line. Stop for review." }
    if ($idx + 2 -ge $lines.Count) { throw "Old scope assertion block is truncated. Stop for review." }
    $expectedIf = '    if (-not $scope.Contains($needle)) { throw "PatientWorkItem scope final-gate assertion failed: $needle" }'
    if ($lines[$idx + 1] -ne $expectedIf -or $lines[$idx + 2] -ne '}') {
        throw "Old scope assertion block shape is unexpected. Stop for review."
    }

    $lines.RemoveRange($idx,3)
    $replacement = @(
        "foreach (`$needle in @('assignedUserId','assignedUnitId','unitIds','isWorkItemInActorUnit')) {",
        '    if (-not $scope.Contains($needle)) { throw "PatientWorkItem scope final-gate assertion failed: $needle" }',
        '}',
        "foreach (`$needle in @('WORK_ITEM_UNIT_MEMBERSHIP_REQUIRED','WORK_ITEM_ASSIGNED_USER_REQUIRED','assignedUserId: actor.guid','userUnitMembership.findFirst')) {",
        '    if (-not $workItemService.Contains($needle)) { throw "PatientWorkItem service final-gate assertion failed: $needle" }',
        '}',
        "if (`$workItemService -match '(?i)assignedRole|responsibleRole') {",
        '    throw "PatientWorkItem service unexpectedly contains Role-based ownership."',
        '}'
    )
    for ($j=$replacement.Count-1; $j -ge 0; $j--) { $lines.Insert($idx,$replacement[$j]) }
    Write-Host "PatientWorkItem scope/service assertions: RECOVERED"
} else {
    Write-Host "PatientWorkItem scope/service assertions: already recovered"
}

$text=[string]::Join("`n",$lines)
if (-not $text.EndsWith("`n")) { $text += "`n" }
[System.IO.File]::WriteAllText($gatePath,$text,(New-Object System.Text.UTF8Encoding($false)))

$tokens=$null
$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($gatePath,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) {
    $detail=($errors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n"
    throw "Recovered final gate parser validation failed:`n$detail"
}
Write-Host "Full PowerShell parser check: PASS"

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
if ($serviceText -match '(?i)assignedRole|responsibleRole') { throw "Local WorkItem service unexpectedly contains Role-based ownership." }
Write-Host "Local WorkItem policy/service contract: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 4 FINAL GATE ==="
& powershell -ExecutionPolicy Bypass -File $gatePath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 4 final gate failed with exit code $LASTEXITCODE." }
