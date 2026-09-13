$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Normalize-Lf([string]$Text) { return $Text.Replace("`r`n","`n") }
function Write-Utf8NoBom([string]$Path,[string]$Text) {
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ""
Write-Host "=== PHASE 4 RECOVERY: REFERRAL NOTIFICATION LOOP ==="
Write-Host "Project: $Project"

$mainPath = Join-Path $Project "scripts\windows-phase4-referral-unit-scope-cutover.ps1"
if (-not (Test-Path -LiteralPath $mainPath -PathType Leaf)) { throw "Main Phase 4 cutover script missing: $mainPath" }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-referral-notify-loop-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $mainPath -Destination (Join-Path $rollbackDir "windows-phase4-referral-unit-scope-cutover.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$main=Normalize-Lf ([System.IO.File]::ReadAllText($mainPath,[System.Text.Encoding]::UTF8))

$oldLogic=@'
if ($service.Contains($oldNotifyLoop)) {
    $service=$service.Replace($oldNotifyLoop,$newNotifyLoop)
} elseif (-not $service.Contains('recipient.kind === "UNIT"')) {
    throw "Referral notification loop is not in expected pre/post cutover form. Stop for review."
}
'@

$newLogic=@'
if (-not $service.Contains('recipient.kind === "UNIT"')) {
    $notifyPattern='(?ms)^    for \(const recipient of validation\.notificationRecipients\) \{\n.*?^    \}\n(?=    if \(toStatus === "READY")'
    $notifyMatches=[regex]::Matches($service,$notifyPattern)
    if ($notifyMatches.Count -ne 1) {
        throw "Could not identify exactly one referral notification loop structurally. Found: $($notifyMatches.Count). Stop for review."
    }
    $m=$notifyMatches[0]
    $service=$service.Substring(0,$m.Index)+(Normalize-Lf $newNotifyLoop)+"`n"+$service.Substring($m.Index+$m.Length)
} else {
    foreach ($needle in @('recipient.kind === "UNIT"','notifyUnitInTransaction','recipient.unitId')) {
        if (-not $service.Contains($needle)) { throw "Existing referral notification loop is incomplete: $needle" }
    }
}
'@

if ($main.Contains($oldLogic)) {
    $main=$main.Replace($oldLogic,$newLogic)
    Write-Utf8NoBom $mainPath $main
    Write-Host "Notification loop patch strategy: RECOVERED TO STRUCTURAL MATCHING"
} elseif ($main.Contains('$notifyPattern=')) {
    Write-Host "Notification loop patch strategy: already recovered"
} else {
    throw "Expected notification-loop patch logic was not found in the main script. Stop for review."
}

# Validate the entire main PowerShell script before it can run again.
$tokens=$null
$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($mainPath,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) {
    $messages=($errors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n"
    throw "Main script parser validation failed after recovery:`n$messages"
}
Write-Host "Full PowerShell parser check: PASS"

# Confirm the prior failed attempt did not already write a partial service cutover.
$servicePath=Join-Path $Project "src\lib\referral-service.ts"
if (-not (Test-Path -LiteralPath $servicePath -PathType Leaf)) { throw "Referral service missing: $servicePath" }
$service=Normalize-Lf ([System.IO.File]::ReadAllText($servicePath,[System.Text.Encoding]::UTF8))
if ($service.Contains('recipient.kind === "UNIT"') -and -not $service.Contains('notifyUnitInTransaction')) {
    throw "Referral service has an inconsistent partial Unit notification state. Stop for review."
}
Write-Host "Referral service pre-resume consistency: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 4 REFERRAL UNIT SCOPE CUTOVER ==="
& powershell -ExecutionPolicy Bypass -File $mainPath
$exit=$LASTEXITCODE
if ($exit -ne 0) { throw "Resumed Phase 4 referral Unit scope cutover failed with exit code $exit." }
