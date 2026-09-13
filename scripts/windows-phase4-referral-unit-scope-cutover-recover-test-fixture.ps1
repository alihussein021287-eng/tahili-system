$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Normalize-Lf([string]$Text) { return $Text.Replace("`r`n","`n") }
function Write-Utf8NoBom([string]$Path,[string]$Text) {
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ""
Write-Host "=== PHASE 4 RECOVERY: REFERRAL WORKFLOW TEST FIXTURE ==="
Write-Host "Project: $Project"

$testPath = Join-Path $Project "tests\unit\referral-workflow.test.ts"
$directPath = Join-Path $Project "scripts\windows-phase4-referral-unit-scope-cutover-recover-direct.ps1"
$servicePath = Join-Path $Project "src\lib\referral-service.ts"
$routeTestPath = Join-Path $Project "tests\unit\referral-workitem-routing.test.ts"
foreach ($path in @($testPath,$directPath,$servicePath,$routeTestPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file missing: $path" }
}

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-referral-test-fixture-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $testPath -Destination (Join-Path $rollbackDir "referral-workflow.test.ts.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

# The previous direct recovery already wrote the service and route test before
# stopping on the duplicate destinationCenterId fixture anchor. Verify that
# partial state before touching the remaining workflow test.
$service=Normalize-Lf ([System.IO.File]::ReadAllText($servicePath,[System.Text.Encoding]::UTF8))
foreach ($needle in @(
    'notifyUnitInTransaction',
    'userUnitMembership.findFirst',
    'centerMembershipVerified = Boolean(membership)',
    'destinationUnitId: current.destinationUnitId',
    'resolveDraftDestinationUnitId',
    'recipient.kind === "UNIT"'
)) {
    if (-not $service.Contains($needle)) { throw "Expected recovered referral-service marker missing: $needle" }
}
if ($service.Contains('centerMembershipVerified: current.destinationScope === "INTERNAL_CENTER" && actor.permissions.has("referrals.accept")')) {
    throw "Permission-only center membership substitution still exists. Stop for review."
}

$routeTest=Normalize-Lf ([System.IO.File]::ReadAllText($routeTestPath,[System.Text.Encoding]::UTF8))
foreach ($needle in @(
    'destinationUnitId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"',
    'REFERRAL_WORKITEM_DESTINATION_UNIT_REQUIRED'
)) {
    if (-not $routeTest.Contains($needle)) { throw "Expected recovered route-test marker missing: $needle" }
}
Write-Host "Previously recovered service/route-test state: VERIFIED"

$text=Normalize-Lf ([System.IO.File]::ReadAllText($testPath,[System.Text.Encoding]::UTF8))
$fixtureMarker='    destinationUnitId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",'
if (-not $text.Contains($fixtureMarker)) {
    $pattern='(?ms)(function\s+internalCenter\s*\(status:\s*ReferralRequestStatus\s*=\s*"DRAFT"\):\s*ReferralRequestSnapshot\s*\{.*?^\})'
    $matches=[regex]::Matches($text,$pattern)
    if ($matches.Count -ne 1) {
        throw "Could not identify exactly one internalCenter fixture function. Found: $($matches.Count). Stop for review."
    }

    $m=$matches[0]
    $block=$m.Value
    $centerLine='    destinationCenterId: 7,'
    $centerCount=([regex]::Matches($block,[regex]::Escape($centerLine))).Count
    if ($centerCount -ne 1) {
        throw "internalCenter fixture expected exactly one destinationCenterId line, found $centerCount. Stop for review."
    }
    if ($block.Contains('destinationUnitId:')) {
        throw "internalCenter fixture already has an unexpected destinationUnitId form. Stop for review."
    }

    $newBlock=$block.Replace($centerLine,$centerLine+"`n"+$fixtureMarker)
    $text=$text.Substring(0,$m.Index)+$newBlock+$text.Substring($m.Index+$m.Length)
    Write-Utf8NoBom $testPath $text
    Write-Host "internalCenter destinationUnitId fixture: RECOVERED STRUCTURALLY"
} else {
    Write-Host "internalCenter destinationUnitId fixture: already present"
}

$check=Normalize-Lf ([System.IO.File]::ReadAllText($testPath,[System.Text.Encoding]::UTF8))
$fixturePattern='(?ms)function\s+internalCenter\s*\(status:\s*ReferralRequestStatus\s*=\s*"DRAFT"\):\s*ReferralRequestSnapshot\s*\{.*?^\}'
$fm=[regex]::Match($check,$fixturePattern)
if (-not $fm.Success -or -not $fm.Value.Contains($fixtureMarker.Trim())) {
    throw "Recovered internalCenter fixture verification failed."
}
Write-Host "Workflow test fixture verification: PASS"

Write-Host ""
Write-Host "=== RESUME DIRECT PHASE 4 RECOVERY ==="
& powershell -ExecutionPolicy Bypass -File $directPath
$exit=$LASTEXITCODE
if ($exit -ne 0) { throw "Resumed direct Phase 4 recovery failed with exit code $exit." }
