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

function Normalize-Lf {
    param([Parameter(Mandatory = $true)][string]$Text)
    return $Text.Replace("`r`n","`n").Replace("`r","`n")
}

Write-Host ""
Write-Host "=== PHASE 5A MY WORK PATIENTWORKITEM CUTOVER ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\28-PHASE5-MY-WORK-CUTOVER-READINESS.md" "Phase 5 My Work readiness"
Write-Host "Phase 5 My Work readiness prerequisite: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(
    ".env.saif-dev",
    "docker-compose.saif-dev.yml",
    "prisma\schema.prisma",
    "src\app\(app)\my-work\page.tsx",
    "src\lib\patient-work-item-scope.ts"
)) {
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

$shapeSql=@'
SELECT CASE WHEN
  to_regclass('public.patient_work_items') IS NOT NULL
  AND to_regclass('public.user_unit_memberships') IS NOT NULL
  AND to_regclass('public.units') IS NOT NULL
  AND to_regclass('public.users') IS NOT NULL
  AND to_regclass('public."CareStage"') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required Phase 5A database shape is missing." }

$countsSql=@'
SELECT 'care_stages|' || count(*) FROM "CareStage"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'user_unit_memberships|' || count(*) FROM "user_unit_memberships"
UNION ALL SELECT 'units|' || count(*) FROM "units"
ORDER BY 1;
'@
$countsBefore=Invoke-PsqlText $countsSql

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase5-my-work-cutover" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
$pagePath=Join-Path $Project "src\app\(app)\my-work\page.tsx"
Copy-Item -LiteralPath $pagePath -Destination (Join-Path $rollbackDir "my-work-page.tsx.before") -Force
$countsBefore | Set-Content -LiteralPath (Join-Path $rollbackDir "db-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

$page=Normalize-Lf ([System.IO.File]::ReadAllText($pagePath,[System.Text.Encoding]::UTF8))

if (-not $page.Contains('import { canViewWorkItemScope } from "@/lib/patient-work-item-scope";')) {
    $anchor='import { prisma } from "@/lib/db";'
    if (-not $page.Contains($anchor)) { throw "My Work import anchor missing. Stop for review." }
    $page=$page.Replace($anchor,$anchor + "`n" + 'import { canViewWorkItemScope } from "@/lib/patient-work-item-scope";')
}

if (-not $page.Contains('function patientWorkItemTitle(kind: string)')) {
    $anchor=@'
function branchFields(row: any) {
  return {
    branchId: row.patient?.branch?.id ?? null,
    branchName: row.patient?.branch?.name ?? null,
  };
}
'@
    $replacement=@'
function branchFields(row: any) {
  return {
    branchId: row.patient?.branch?.id ?? null,
    branchName: row.patient?.branch?.name ?? null,
  };
}

function patientWorkItemTitle(kind: string) {
  if (kind.startsWith("LEGACY_CARE_STAGE:")) return kind.slice("LEGACY_CARE_STAGE:".length).trim() || "عمل رعاية";
  if (kind === "REFERRAL_INTERNAL_SPECIALIST") return "إحالة داخلية إلى اختصاصي";
  if (kind === "REFERRAL_INTERNAL_CENTER") return "إحالة داخلية إلى وحدة";
  return "عمل رعاية";
}
'@
    if (-not $page.Contains($anchor)) { throw "My Work helper anchor missing. Stop for review." }
    $page=$page.Replace($anchor,$replacement)
}

$oldStageActions='    stage: { WAITING: "فتح محطة الرعاية", IN_PROGRESS: "متابعة المحطة" },'
$newStageActions='    stage: { WAITING: "فتح محطة الرعاية", IN_PROGRESS: "متابعة المحطة", OPEN: "فتح عمل الرعاية", ASSIGNED: "استلام العمل", ACCEPTED: "بدء العمل", PROGRESS_IN: "متابعة العمل", BLOCKED: "مراجعة العائق" },'
if ($page.Contains($oldStageActions)) {
    $page=$page.Replace($oldStageActions,$newStageActions)
} elseif (-not $page.Contains('PROGRESS_IN: "متابعة العمل"')) {
    throw "My Work stage action map is not in expected pre/post cutover form. Stop for review."
}

if (-not $page.Contains('const workItemActor = userGuid ? { userGuid, unitIds } : null;')) {
    $oldIdentity='  const userId = (session.user as any).id as string;'
    $newIdentity=@'
  const userId = (session.user as any).id as string;
  const currentUserIdentity = await prisma.user.findUnique({
    where: { id: userId },
    select: { guid: true },
  });
  const userGuid = currentUserIdentity?.guid ?? null;
  const unitIds = userGuid
    ? (await prisma.userUnitMembership.findMany({
        where: { userId: userGuid, active: true, unit: { is: { active: true } } },
        select: { unitId: true },
      })).map((membership) => membership.unitId)
    : [];
  const workItemActor = userGuid ? { userGuid, unitIds } : null;
'@
    if (-not $page.Contains($oldIdentity)) { throw "My Work user identity anchor missing. Stop for review." }
    $page=$page.Replace($oldIdentity,$newIdentity.TrimEnd("`r","`n"))
}

$legacyStage=@'
  if (wants("stage") && perms.has("journey.view")) {
    queries.push(prisma.careStage.findMany({
      where: { responsibleRole: role as any, status: { in: ["WAITING", "IN_PROGRESS"] }, patient: { archivedAt: null, ...(branchId ? { branchId } : {}) } },
      select: { id: true, patientId: true, station: true, status: true, responsibleRole: true, createdAt: true, updatedAt: true, referralRequest: { select: { id: true } }, ...patientSelect },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: sourceLimit,
    }).then((rows) => ({ type: "stage" as const, rows })));
  }
'@
$newStage=@'
  if (wants("stage") && perms.has("journey.view") && workItemActor) {
    queries.push(prisma.patientWorkItem.findMany({
      where: {
        status: { in: ["OPEN", "ASSIGNED", "ACCEPTED", "PROGRESS_IN", "BLOCKED"] },
        patient: { archivedAt: null, ...(branchId ? { branchId } : {}) },
        OR: [
          { assignedUserId: workItemActor.userGuid },
          ...(workItemActor.unitIds.length > 0 ? [{ assignedUnitId: { in: workItemActor.unitIds } }] : []),
        ],
      },
      select: {
        id: true,
        patientId: true,
        kind: true,
        status: true,
        assignedUserId: true,
        assignedUnitId: true,
        createdAt: true,
        updatedAt: true,
        assignedUser: { select: { fullName: true } },
        assignedUnit: { select: { name: true } },
        referralRequest: { select: { id: true } },
        ...patientSelect,
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: sourceLimit,
    }).then((rows) => ({
      type: "stage" as const,
      rows: rows.filter((row) => canViewWorkItemScope(row, workItemActor)),
    })));
  }
'@
if ($page.Contains($legacyStage)) {
    $page=$page.Replace($legacyStage,$newStage)
} elseif (-not $page.Contains('prisma.patientWorkItem.findMany')) {
    throw "Legacy My Work CareStage block was not found and PatientWorkItem cutover is not present. Stop for review."
}

$oldAssignee='      assignee: row.assignedTo?.fullName ?? row.assignedTo ?? row.assignedReviewer?.fullName ?? row.therapist?.fullName ?? row.createdBy?.fullName ?? row.assignedRole ?? row.responsibleRole ?? null,'
$newAssignee='      assignee: row.assignedUser?.fullName ?? row.assignedUnit?.name ?? row.assignedTo?.fullName ?? row.assignedTo ?? row.assignedReviewer?.fullName ?? row.therapist?.fullName ?? row.createdBy?.fullName ?? row.assignedRole ?? row.responsibleRole ?? null,'
if ($page.Contains($oldAssignee)) {
    $page=$page.Replace($oldAssignee,$newAssignee)
} elseif (-not $page.Contains('row.assignedUser?.fullName ?? row.assignedUnit?.name')) {
    throw "My Work assignee mapping is not in expected pre/post cutover form. Stop for review."
}

$oldStageMap='    if (type === "stage") return { ...base, title: row.station, nextAction: nextAction(type, status), href: patientName ? `/patients/${row.patientId}?tab=journey` : "/patients-care?tab=journey", requiredPermission: "journey.view" };'
$newStageMap='    if (type === "stage") return { ...base, title: patientWorkItemTitle(row.kind), nextAction: nextAction(type, status), href: patientName ? `/patients/${row.patient?.id}?tab=journey` : "/patients-care?tab=journey", requiredPermission: "journey.view" };'
if ($page.Contains($oldStageMap)) {
    $page=$page.Replace($oldStageMap,$newStageMap)
} elseif (-not $page.Contains('title: patientWorkItemTitle(row.kind)')) {
    throw "My Work stage presentation mapping is not in expected pre/post cutover form. Stop for review."
}

[System.IO.File]::WriteAllText($pagePath,$page,(New-Object System.Text.UTF8Encoding($false)))

$check=[System.IO.File]::ReadAllText($pagePath,[System.Text.Encoding]::UTF8)
foreach ($needle in @(
    'canViewWorkItemScope',
    'prisma.patientWorkItem.findMany',
    'prisma.userUnitMembership.findMany',
    'assignedUserId: workItemActor.userGuid',
    'assignedUnitId: { in: workItemActor.unitIds }',
    'unit: { is: { active: true } }',
    'rows.filter((row) => canViewWorkItemScope(row, workItemActor))',
    'title: patientWorkItemTitle(row.kind)',
    'row.assignedUser?.fullName ?? row.assignedUnit?.name'
)) {
    if (-not $check.Contains($needle)) { throw "Phase 5A source assertion failed: $needle" }
}
if ($check.Contains('prisma.careStage.findMany({') -and $check.Contains('responsibleRole: role as any, status: { in: ["WAITING", "IN_PROGRESS"] }')) {
    throw "Legacy role-owned CareStage source still exists in My Work."
}
Write-Host "My Work PatientWorkItem scope cutover: PASS"

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")

Write-Host ""
Write-Host "=== PRISMA VALIDATE + GENERATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","generate")

Write-Host ""
Write-Host "=== TYPESCRIPT + TARGETED TESTS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")
$targetTests=@()
foreach ($candidate in @(
    "tests/unit/my-work.test.ts",
    "tests/unit/patient-work-item-scope.test.ts",
    "tests/unit/patient-work-item.test.ts"
)) {
    if (Test-Path -LiteralPath (Join-Path $Project $candidate)) { $targetTests += $candidate }
}
if ($targetTests.Count -gt 0) {
    Invoke-Compose (@("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run") + $targetTests)
}

Write-Host ""
Write-Host "=== PROJECT AUDIT + BUILD ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")

$countsAfter=Invoke-PsqlText $countsSql
if ($countsAfter.Trim() -ne $countsBefore.Trim()) { throw "Database row counts changed during Phase 5A code-only cutover." }
Write-Host "Database write guard: PASS"

$httpCode=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $httpCode -notmatch '^\d{3}$') { throw "Running app login smoke failed: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "29-PHASE5-MY-WORK-PATIENTWORKITEM-CUTOVER.md"
$report=@"
# Phase 5A - My Work PatientWorkItem Cutover

Status: PASS

Implemented:
- My Work patient-specific `stage` source now reads active PatientWorkItem rows instead of role-owned CareStage rows.
- The current legacy session User.id resolves to User.guid before PatientWorkItem scope is evaluated.
- Active UserUnitMembership rows are limited to active Units and supply the actor Unit UUID set.
- Database filtering is User/Unit based, and returned rows are additionally checked through canViewWorkItemScope.
- No Role value participates in PatientWorkItem ownership or visibility.
- Existing My Work `stage` presentation type, filters, dedupe behavior, Arabic UI, and patient journey deep link are preserved.
- Known referral WorkItem kinds receive Arabic presentation labels.
- CareStage remains untouched for historical/journey compatibility; this batch only changes My Work presentation sourcing.
- No PatientWorkItem mutation action was added or exposed by this batch; mutation authorization remains in the PatientWorkItem service guards.

Verification:
- Prisma validate + generate PASS.
- TypeScript PASS.
- Available targeted WorkItem/My Work tests PASS.
- project audit PASS.
- production build PASS.
- database write guard PASS.
- running app login smoke PASS (HTTP $code).

Safety:
- Code-only cutover; no migration created or applied.
- No app container restart.
- Original live server untouched.

Rollback snapshot:
$rollbackDir

Next:
- Inventory and cut over the patient journey presentation to combine operational PatientWorkItem data with retained historical CareStage compatibility, without deleting CareStage yet.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "========================================"
Write-Host "PHASE 5A MY WORK CUTOVER: PASS"
Write-Host "========================================"
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "Rollback snapshot: $rollbackDir"
