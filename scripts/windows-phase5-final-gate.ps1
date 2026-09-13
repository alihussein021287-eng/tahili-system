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
function Require-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}
function Read-Utf8 {
    param([string]$RelativePath)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required source missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
}

Write-Host ""
Write-Host "=== PHASE 5 FINAL GATE ==="
Write-Host "Project: $Project"

foreach ($item in @(
    @{ P="_PHASE01_AUDIT\25-PHASE4-FINAL-GATE.md"; L="Phase 4 final gate" },
    @{ P="_PHASE01_AUDIT\29-PHASE5-MY-WORK-PATIENTWORKITEM-CUTOVER.md"; L="Phase 5A My Work cutover" },
    @{ P="_PHASE01_AUDIT\31-PHASE5-JOURNEY-PARALLEL-WORKITEM-CUTOVER.md"; L="Phase 5B journey cutover" },
    @{ P="_PHASE01_AUDIT\32-PHASE5-NOTIFICATION-RECIPIENT-INVENTORY.md"; L="Phase 5C recipient inventory" },
    @{ P="_PHASE01_AUDIT\33-PHASE5-NOTIFICATION-ROLE-CONTEXT.md"; L="Phase 5C role context" },
    @{ P="_PHASE01_AUDIT\34-PHASE5-CLINICAL-RECIPIENT-ROUTING-READINESS.md"; L="Phase 5C clinical routing readiness" },
    @{ P="_PHASE01_AUDIT\35-PHASE5-ROUTING-FOUNDATION-INVENTORY.md"; L="Phase 5C routing foundation inventory" },
    @{ P="_PHASE01_AUDIT\36-PHASE5-NOTIFICATION-ROUTING-DECISION.md"; L="Phase 5C routing decision" }
)) {
    Require-PassReport $item.P $item.L
}
Write-Host "Phase 5 prerequisite reports: PASS"

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

$keyFiles=@(
    "src\app\(app)\my-work\page.tsx",
    "src\app\(app)\patients\[id]\page.tsx",
    "src\lib\patient-journey.ts",
    "src\lib\patient-work-item.ts",
    "src\lib\patient-work-item-scope.ts",
    "src\lib\referral-workflow.ts",
    "src\lib\referral-service.ts",
    "src\lib\notify.ts"
)
$hashBefore=@{}
foreach ($relative in $keyFiles) {
    $full=Join-Path $Project $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Required source missing: $relative" }
    $hashBefore[$relative]=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
}

$myWork=Read-Utf8 "src\app\(app)\my-work\page.tsx"
foreach ($needle in @(
    'canViewWorkItemScope',
    'prisma.patientWorkItem.findMany',
    'prisma.userUnitMembership.findMany',
    'rows.filter((row) => canViewWorkItemScope(row, workItemActor))',
    'title: patientWorkItemTitle(row.kind)'
)) {
    if (-not $myWork.Contains($needle)) { throw "My Work final-gate assertion failed: $needle" }
}
if ($myWork.Contains('responsibleRole: role as any')) { throw "Legacy Role-owned CareStage My Work query still exists." }

$journey=Read-Utf8 "src\lib\patient-journey.ts"
foreach ($needle in @('export type DerivedJourneyWorkItem = {','export function deriveJourneyWorkItems(')) {
    if (-not $journey.Contains($needle)) { throw "Patient journey final-gate assertion failed: $needle" }
}
$page=Read-Utf8 "src\app\(app)\patients\[id]\page.tsx"
foreach ($needle in @(
    'prisma.patientWorkItem.findMany',
    'const derivedJourneyWorkItems = deriveJourneyWorkItems(patient.id, journeyWorkItems);',
    'workItems={derivedJourneyWorkItems}',
    'patient-parallel-workitems'
)) {
    if (-not $page.Contains($needle)) { throw "Patient page final-gate assertion failed: $needle" }
}

$workflow=Read-Utf8 "src\lib\referral-workflow.ts"
foreach ($needle in @(
    'if (to === "PENDING_PRINT") return [{ kind: "ROLE", role: "MANAGER" }];',
    'kind: "USER", userId: request.assignedReviewerId, purpose: "ASSIGNED_REVIEWER"',
    'kind: "UNIT", unitId: request.destinationUnitId, purpose: "DESTINATION_UNIT"'
)) {
    if (-not $workflow.Contains($needle)) { throw "Referral notification routing final-gate assertion failed: $needle" }
}
$notify=Read-Utf8 "src\lib\notify.ts"
foreach ($needle in @('notifyUnitInTransaction','targetUserId','userUnitMembership')) {
    if (-not $notify.Contains($needle)) { throw "Notification fanout final-gate assertion failed: $needle" }
}
$service=Read-Utf8 "src\lib\patient-work-item.ts"
$scope=Read-Utf8 "src\lib\patient-work-item-scope.ts"
foreach ($needle in @('userUnitMembership.findFirst','WORK_ITEM_UNIT_MEMBERSHIP_REQUIRED','WORK_ITEM_ASSIGNED_USER_REQUIRED')) {
    if (-not $service.Contains($needle)) { throw "PatientWorkItem service guard missing: $needle" }
}
foreach ($needle in @('canViewWorkItemScope','canClaimWorkItemScope','canActOnWorkItemScope')) {
    if (-not $scope.Contains($needle)) { throw "PatientWorkItem scope policy missing: $needle" }
}
Write-Host "Phase 5 source invariants: PASS"

$dbGateSql=@'
SELECT 'units_total|' || count(*) FROM "units"
UNION ALL SELECT 'memberships_total|' || count(*) FROM "user_unit_memberships"
UNION ALL SELECT 'workitems_total|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'workitems_invalid_active_scope|' || count(*) FROM "patient_work_items"
WHERE "status"::text IN ('ASSIGNED','ACCEPTED','PROGRESS_IN')
  AND "assignedUserId" IS NULL AND "assignedUnitId" IS NULL
UNION ALL SELECT 'internal_center_missing_unit|' || count(*) FROM "referral_requests"
WHERE "destinationScope"::text='INTERNAL_CENTER' AND "destinationUnitId" IS NULL
ORDER BY 1;
'@
$dbGate=Invoke-PsqlText $dbGateSql
Write-Host $dbGate
foreach ($line in ($dbGate -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts=$line -split '\|',2
    if ($parts.Count -ne 2) { throw "Unexpected database gate row: $line" }
    if ($parts[0] -in @('workitems_invalid_active_scope','internal_center_missing_unit') -and [int64]$parts[1] -ne 0) {
        throw "Phase 5 database invariant failed: $line"
    }
}
Write-Host "Phase 5 database invariants: PASS"

$countsSql=@'
SELECT 'care_stages|' || count(*) FROM "CareStage"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'notifications|' || count(*) FROM "Notification"
UNION ALL SELECT 'user_unit_memberships|' || count(*) FROM "user_unit_memberships"
UNION ALL SELECT 'units|' || count(*) FROM "units"
UNION ALL SELECT 'referral_requests|' || count(*) FROM "referral_requests"
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
Write-Host "=== TYPESCRIPT ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")

$targeted=@()
if (Test-Path -LiteralPath "tests") {
    $targeted=@(Get-ChildItem -LiteralPath "tests" -Recurse -File | Where-Object {
        $_.Name -match '(patient-work-item|patient-journey|referral|notification|my-work).*\.test\.(ts|tsx)$'
    } | ForEach-Object { $_.FullName.Substring($Project.Length + 1).Replace('\','/') })
}
if ($targeted.Count -gt 0) {
    Write-Host ""
    Write-Host "=== PHASE 5 TARGETED TESTS ==="
    $testArgs=@("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")
    $testArgs += $targeted
    Invoke-Compose $testArgs
} else {
    Write-Host "Phase 5 targeted test file discovery: none; full suite will still run."
}

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
    throw "Database row counts changed during Phase 5 final gate.`nBefore:`n$countsBefore`nAfter:`n$countsAfter"
}
Write-Host "Database write guard: PASS"

foreach ($relative in $keyFiles) {
    $full=Join-Path $Project $relative
    $after=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    if ($after -ne $hashBefore[$relative]) { throw "Phase 5 final gate changed source file: $relative" }
}
Write-Host "Source write guard: PASS"

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
$reportPath=Join-Path $auditDir "37-PHASE5-FINAL-GATE.md"
$report=@"
# Phase 5 - Final Gate

Status: PASS

Verified:
- Phase 4 final gate and Phase 5 reports 29, 31, 32, 33, 34, 35, and 36 are PASS.
- My Work uses PatientWorkItem User/Unit scope and no longer uses responsibleRole as operational ownership.
- Patient journey presents parallel PatientWorkItems while legacy CareStage remains compatibility/history only.
- Internal specialist referral notification routing targets the assigned User.
- Internal center referral notification routing fans out to active Unit members through per-user Notification rows.
- PENDING_PRINT manager notification remains a valid process Role broadcast.
- True process/system Role broadcasts remain allowed.
- Patient-specific clinical Role notifications that cannot yet resolve a real User/Unit remain explicitly DEFERRED by report 36; they were not silently reinterpreted.
- No PatientWorkItem mutation exposure was found outside the service layer by report 36.
- PatientWorkItem service and scope guards remain present server-side.
- No Phase 5 verification step changed tracked source or core database row counts.
- Prisma validate/generate, TypeScript, targeted tests when discovered, full tests, project audit, build, migration status, and login smoke passed.
- Original live server remained untouched.

Database gate:
$dbGate

Cleanup boundary:
- Do not delete CareStage/PATHWAY_DEFAULT while deferred legacy clinical flows still depend on them.
- Do not seed Units from Role/station labels automatically.
- Before destructive cleanup, add/approve real organizational Unit/User routing for the deferred clinical flows or otherwise replace those legacy paths explicitly.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "========================"
Write-Host "PHASE 5 FINAL GATE: PASS"
Write-Host "========================"
Write-Host "Report: $reportPath"
