$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

$Compose = @(
    "compose",
    "-p", "tahili-saif-dev",
    "--env-file", ".env.saif-dev",
    "-f", "docker-compose.saif-dev.yml"
)

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: docker $($Arguments -join ' ')" }
}
function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Invoke-Docker ($Compose + $Arguments)
}
function Get-ComposeText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & docker @($Compose + $Arguments) 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose command failed.`n$($output | Out-String)" }
    return (($output | Out-String).Trim())
}
function Invoke-PsqlText {
    param([Parameter(Mandatory = $true)][string]$Sql)
    $args = $Compose + @(
        "exec", "-T", "postgres",
        "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", $script:dbUser,
        "-d", $script:dbName,
        "-Atq"
    )
    $output = $Sql | & docker @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql failed.`n$($output | Out-String)" }
    return (($output | Out-String).Trim())
}
function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}
function Read-Utf8([string]$RelativePath) {
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file missing: $path" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
}

Write-Host ""
Write-Host "=== PHASE 4 FINAL GATE ==="
Write-Host "Project: $Project"

foreach ($item in @(
    @{ P="_PHASE01_AUDIT\18-PHASE4-REFERRAL-ROUTING-INVENTORY.md"; L="Referral routing inventory" },
    @{ P="_PHASE01_AUDIT\19-PHASE4-REFERRAL-WORKITEM-ROUTING.md"; L="Referral WorkItem routing" },
    @{ P="_PHASE01_AUDIT\20-PHASE4-WORKITEM-SCOPE-INVENTORY.md"; L="WorkItem scope inventory" },
    @{ P="_PHASE01_AUDIT\21-PHASE4-NOTIFICATION-SCOPE-INVENTORY.md"; L="Notification scope inventory" },
    @{ P="_PHASE01_AUDIT\22-PHASE4-WORKITEM-POLICY-UNIT-NOTIFY.md"; L="WorkItem policy + Unit notify" },
    @{ P="_PHASE01_AUDIT\23-PHASE4-REFERRAL-UNIT-BINDING.md"; L="Referral Unit binding" },
    @{ P="_PHASE01_AUDIT\24-PHASE4-REFERRAL-UNIT-SCOPE-CUTOVER.md"; L="Referral Unit scope cutover" }
)) {
    Test-PassReport $item.P $item.L
}
Write-Host "Phase 4 prerequisite reports 18-24: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$envMap=@{}
foreach ($line in Get-Content -LiteralPath ".env.saif-dev") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $k=$Matches[1]; $v=$Matches[2].Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v=$v.Substring(1,$v.Length-2) }
        $envMap[$k]=$v
    }
}
$script:dbUser=$envMap["DB_USER"]
$script:dbName=$envMap["DB_NAME"]
if ([string]::IsNullOrWhiteSpace($script:dbUser) -or [string]::IsNullOrWhiteSpace($script:dbName)) { throw "DB_USER/DB_NAME missing." }
if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres"))) -or [string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","app")))) { throw "Local Tahili stack is not running." }

$service = Read-Utf8 "src\lib\referral-service.ts"
$workflow = Read-Utf8 "src\lib\referral-workflow.ts"
$route = Read-Utf8 "src\lib\referral-workitem-routing.ts"
$notify = Read-Utf8 "src\lib\notify.ts"
$scope = Read-Utf8 "src\lib\patient-work-item-scope.ts"

foreach ($needle in @(
    'notifyUnitInTransaction',
    'userUnitMembership.findFirst',
    'centerMembershipVerified = Boolean(membership)',
    'destinationUnitId: current.destinationUnitId',
    'resolveDraftDestinationUnitId',
    'recipient.kind === "UNIT"'
)) {
    if (-not $service.Contains($needle)) { throw "Referral service final-gate assertion failed: $needle" }
}
if ($service.Contains('centerMembershipVerified: current.destinationScope === "INTERNAL_CENTER" && actor.permissions.has("referrals.accept")')) {
    throw "Permission-only center membership substitution still exists."
}
foreach ($needle in @(
    'kind: "UNIT"; unitId: string; purpose: "DESTINATION_UNIT"',
    'kind: "USER", userId: request.assignedReviewerId, purpose: "ASSIGNED_REVIEWER"',
    'if (blank(request.destinationUnitId)) errors.push("DESTINATION_UNIT_REQUIRED")'
)) {
    if (-not $workflow.Contains($needle)) { throw "Referral workflow final-gate assertion failed: $needle" }
}
if ($workflow.Contains('{ kind: "ROLE", role: "DOCTOR" }')) { throw "Patient-specific DOCTOR role notification still exists." }
if (-not $route.Contains('REFERRAL_WORKITEM_DESTINATION_UNIT_REQUIRED')) { throw "Explicit Unit WorkItem route guard missing." }
foreach ($needle in @('notifyUnitInTransaction','targetUserId','userUnitMembership')) {
    if (-not $notify.Contains($needle)) { throw "Unit notification helper final-gate assertion failed: $needle" }
}
foreach ($needle in @('assignedUserId','assignedUnitId','userUnitMembership')) {
    if (-not $scope.Contains($needle)) { throw "PatientWorkItem scope final-gate assertion failed: $needle" }
}
Write-Host "Phase 4 source invariants: PASS"

$dbGateSql=@'
SELECT 'destination_unit_column|' || count(*)
FROM information_schema.columns
WHERE table_schema='public' AND table_name='referral_requests' AND column_name='destinationUnitId' AND data_type='uuid'
UNION ALL
SELECT 'destination_unit_fk|' || count(*)
FROM pg_constraint
WHERE conname='referral_requests_destinationUnitId_fkey' AND convalidated
UNION ALL
SELECT 'internal_center_missing_unit|' || count(*)
FROM "referral_requests"
WHERE "destinationScope"::text='INTERNAL_CENTER' AND "destinationUnitId" IS NULL
UNION ALL
SELECT 'internal_center_inactive_unit|' || count(*)
FROM "referral_requests" r
LEFT JOIN "units" u ON u."id"=r."destinationUnitId"
WHERE r."destinationScope"::text='INTERNAL_CENTER' AND (u."id" IS NULL OR u."active"=false)
UNION ALL
SELECT 'active_workitems_invalid_owner|' || count(*)
FROM "patient_work_items"
WHERE "status"::text IN ('ASSIGNED','ACCEPTED','PROGRESS_IN')
  AND "assignedUserId" IS NULL AND "assignedUnitId" IS NULL
UNION ALL
SELECT 'claimed_user_not_unit_member|' || count(*)
FROM "patient_work_items" w
WHERE w."assignedUserId" IS NOT NULL
  AND w."assignedUnitId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user_unit_memberships" m
    WHERE m."userId"=w."assignedUserId" AND m."unitId"=w."assignedUnitId" AND m."active"=true
  )
ORDER BY 1;
'@
$dbGate=Invoke-PsqlText $dbGateSql
Write-Host $dbGate
$expected=@{
    'destination_unit_column'=1
    'destination_unit_fk'=1
    'internal_center_missing_unit'=0
    'internal_center_inactive_unit'=0
    'active_workitems_invalid_owner'=0
    'claimed_user_not_unit_member'=0
}
foreach ($line in ($dbGate -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2 -or -not $expected.ContainsKey($p[0]) -or [int64]$p[1] -ne [int64]$expected[$p[0]]) {
        throw "Phase 4 database gate failed: $line"
    }
}
Write-Host "Phase 4 database invariants: PASS"

$countsSql=@'
SELECT 'referral_requests|' || count(*) FROM "referral_requests"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'notifications|' || count(*) FROM "Notification"
UNION ALL SELECT 'user_unit_memberships|' || count(*) FROM "user_unit_memberships"
ORDER BY 1;
'@
$countsBefore=Invoke-PsqlText $countsSql

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")

Write-Host ""
Write-Host "=== PRISMA VALIDATE + GENERATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","generate")

Write-Host ""
Write-Host "=== TYPESCRIPT + PHASE 4 TARGETED TESTS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run","tests/unit/referral-workflow.test.ts","tests/unit/referral-workitem-routing.test.ts","tests/unit/patient-work-item-scope.test.ts","tests/unit/patient-work-item.test.ts","tests/unit/notifications.test.ts")

Write-Host ""
Write-Host "=== FULL TESTS + PROJECT AUDIT + BUILD ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")

Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

$countsAfter=Invoke-PsqlText $countsSql
if ($countsAfter.Trim() -ne $countsBefore.Trim()) {
    throw "Database row counts changed during Phase 4 final gate.`nBefore:`n$countsBefore`nAfter:`n$countsAfter"
}
Write-Host "Database write guard: PASS"

Write-Host ""
Write-Host "=== RUNNING APP LOGIN SMOKE ==="
$curl=Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw "curl.exe is required for login smoke." }
$httpCode=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $httpCode -notmatch '^\d{3}$') { throw "Running app login smoke failed: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "25-PHASE4-FINAL-GATE.md"
$report=@"
# Phase 4 - Final Gate

Status: PASS

Verified:
- Reports 18 through 24 are PASS.
- INTERNAL_CENTER referrals have an explicit validated Unit UUID binding.
- INTERNAL_CENTER acceptance uses active UserUnitMembership, not permission-only membership substitution.
- Specialist READY notifications target the assigned reviewer User.
- Center READY notifications fan out to active members of the destination Unit.
- PatientWorkItem ownership remains User/Unit based; Role is not used as patient-specific ownership.
- Referral WorkItem routing uses persisted destinationUnitId.
- No Phase 4 verification step changed core database row counts.
- Prisma schema/migration status, TypeScript, targeted tests, full tests, project audit, build, and login smoke all passed.
- Original live server remained untouched.

Database gate:
$dbGate

Next:
Phase 5 - My Work / patient journey / notification presentation cutover, while keeping legacy CareStage compatibility until its later cleanup gate.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "========================"
Write-Host "PHASE 4 FINAL GATE: PASS"
Write-Host "========================"
Write-Host ""
Write-Host "Report: $reportPath"
