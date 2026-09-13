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
function Normalize-Lf([string]$Text) { return $Text.Replace("`r`n","`n") }
function Write-Utf8NoBom([string]$Path,[string]$Text) {
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}
function Replace-ExactOnce {
    param([string]$Text,[string]$Old,[string]$New,[string]$Label)
    $count=([regex]::Matches($Text,[regex]::Escape($Old))).Count
    if ($count -ne 1) { throw "$Label expected exactly one source block, found $count. Stop for review." }
    return $Text.Replace($Old,$New)
}

Write-Host ""
Write-Host "=== PHASE 4 DIRECT RECOVERY: REFERRAL UNIT SCOPE CUTOVER ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\19-PHASE4-REFERRAL-WORKITEM-ROUTING.md" "Phase 4 referral WorkItem routing"
Test-PassReport "_PHASE01_AUDIT\20-PHASE4-WORKITEM-SCOPE-INVENTORY.md" "Phase 4 WorkItem scope inventory"
Test-PassReport "_PHASE01_AUDIT\22-PHASE4-WORKITEM-POLICY-UNIT-NOTIFY.md" "Phase 4 WorkItem policy + Unit notify"
Test-PassReport "_PHASE01_AUDIT\23-PHASE4-REFERRAL-UNIT-BINDING.md" "Phase 4 referral Unit binding"
Write-Host "Prerequisite reports: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma","src\lib\referral-service.ts","src\lib\referral-workflow.ts","src\lib\referral-workitem-routing.ts","src\lib\notify.ts","tests\unit\referral-workflow.test.ts","tests\unit\referral-workitem-routing.test.ts")) {
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

$preflightSql=@'
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
SELECT 'active_workitems|' || count(*)
FROM "patient_work_items"
WHERE "status"::text IN ('OPEN','ASSIGNED','ACCEPTED','PROGRESS_IN','BLOCKED')
ORDER BY 1;
'@
$preflight=Invoke-PsqlText $preflightSql
Write-Host $preflight
$expectedPre=@{
    'destination_unit_column'=1
    'destination_unit_fk'=1
    'internal_center_missing_unit'=0
    'internal_center_inactive_unit'=0
    'active_workitems'=0
}
foreach ($line in ($preflight -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2 -or -not $expectedPre.ContainsKey($p[0]) -or [int64]$p[1] -ne [int64]$expectedPre[$p[0]]) { throw "Phase 4 scope recovery preflight failed: $line" }
}
Write-Host "Referral Unit scope preflight: PASS"

$countsSql=@'
SELECT 'referral_requests|' || count(*) FROM "referral_requests"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'notifications|' || count(*) FROM "Notification"
UNION ALL SELECT 'user_unit_memberships|' || count(*) FROM "user_unit_memberships"
ORDER BY 1;
'@
$countsBefore=Invoke-PsqlText $countsSql

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-referral-unit-scope-direct-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
foreach ($rel in @("src\lib\referral-service.ts","src\lib\referral-workflow.ts","src\lib\referral-workitem-routing.ts","tests\unit\referral-workflow.test.ts","tests\unit\referral-workitem-routing.test.ts")) {
    Copy-Item -LiteralPath $rel -Destination (Join-Path $rollbackDir ([IO.Path]::GetFileName($rel)+".before")) -Force
}
[System.IO.File]::WriteAllText((Join-Path $rollbackDir "row-counts.before.txt"),$countsBefore,(New-Object System.Text.UTF8Encoding($true)))
Write-Host "Rollback snapshot: $rollbackDir"

# The previous attempt already cut these two files over before it stopped.
$workflowPath=Join-Path $Project "src\lib\referral-workflow.ts"
$routePath=Join-Path $Project "src\lib\referral-workitem-routing.ts"
$workflow=Normalize-Lf ([System.IO.File]::ReadAllText($workflowPath,[System.Text.Encoding]::UTF8))
$route=Normalize-Lf ([System.IO.File]::ReadAllText($routePath,[System.Text.Encoding]::UTF8))
foreach ($needle in @(
    'destinationUnitId?: string | null;',
    'kind: "UNIT"; unitId: string; purpose: "DESTINATION_UNIT"',
    'kind: "USER", userId: request.assignedReviewerId, purpose: "ASSIGNED_REVIEWER"',
    'if (blank(request.destinationUnitId)) errors.push("DESTINATION_UNIT_REQUIRED")'
)) {
    if (-not $workflow.Contains($needle)) { throw "Expected partial workflow cutover marker missing: $needle" }
}
foreach ($needle in @('destinationUnitId?: string | null;','REFERRAL_WORKITEM_DESTINATION_UNIT_REQUIRED','assignedUnitId: destinationUnitId')) {
    if (-not $route.Contains($needle)) { throw "Expected partial routing cutover marker missing: $needle" }
}
Write-Host "Previously completed workflow/routing cutover: VERIFIED"

# Patch referral-service.ts in memory, then write once after every edit succeeds.
$servicePath=Join-Path $Project "src\lib\referral-service.ts"
$service=Normalize-Lf ([System.IO.File]::ReadAllText($servicePath,[System.Text.Encoding]::UTF8))

$oldNotifyImport='import { notifyRoleInTransaction, notifyUserInTransaction } from "@/lib/notify";'
$newNotifyImport='import { notifyRoleInTransaction, notifyUnitInTransaction, notifyUserInTransaction } from "@/lib/notify";'
if ($service.Contains($oldNotifyImport)) {
    $service=$service.Replace($oldNotifyImport,$newNotifyImport)
} elseif (-not $service.Contains($newNotifyImport)) {
    throw "Referral service notification import is not in expected pre/post form. Stop for review."
}

if (-not $service.Contains('async function resolveDraftDestinationUnitId')) {
    $validatePattern='(?ms)(function validateDraft\(input: ReferralDraftInput\) \{.*?^\})\n'
    $m=[regex]::Match($service,$validatePattern)
    if (-not $m.Success) { throw "validateDraft function anchor not found. Stop for review." }
    $helper=@'

async function resolveDraftDestinationUnitId(tx: any, input: ReferralDraftInput) {
  if (input.destinationScope !== "INTERNAL_CENTER") return null;
  if (!input.destinationCenterId) throw new Error("REFERRAL_DESTINATION_CENTER_REQUIRED");
  const center = await tx.center.findUnique({ where: { id: input.destinationCenterId }, select: { name: true } });
  if (!center?.name?.trim()) throw new Error("REFERRAL_DESTINATION_CENTER_NOT_FOUND");
  const units = await tx.unit.findMany({ where: { active: true }, select: { id: true, name: true } });
  const key = center.name.trim().toLowerCase();
  const matches = units.filter((unit: { id: string; name: string }) => unit.name.trim().toLowerCase() === key);
  if (matches.length === 0) throw new Error("REFERRAL_DESTINATION_UNIT_NOT_FOUND");
  if (matches.length !== 1) throw new Error("REFERRAL_DESTINATION_UNIT_AMBIGUOUS");
  return matches[0].id;
}
'@
    $insertAt=$m.Index+$m.Length
    $service=$service.Substring(0,$insertAt)+(Normalize-Lf $helper)+$service.Substring($insertAt)
}

$createAnchor='    const request = await tx.referralRequest.create({ data: {'
if (-not $service.Contains('const destinationUnitId = await resolveDraftDestinationUnitId(tx, input);')) {
    if (-not $service.Contains($createAnchor)) { throw "Referral create anchor not found. Stop for review." }
    $service=$service.Replace($createAnchor,'    const destinationUnitId = await resolveDraftDestinationUnitId(tx, input);'+"`n"+$createAnchor)
}
$createDataAnchor='      destinationCenterId: input.destinationCenterId || null,'
if (([regex]::Matches($service,[regex]::Escape('      destinationUnitId,'))).Count -lt 1) {
    $service=Replace-ExactOnce $service $createDataAnchor ($createDataAnchor+"`n      destinationUnitId,") "Referral create destination Unit data"
}

$nextAnchor='    validateDraft(next);'
if (-not $service.Contains('const destinationUnitId = await resolveDraftDestinationUnitId(tx, next);')) {
    $service=Replace-ExactOnce $service $nextAnchor ($nextAnchor+"`n    const destinationUnitId = await resolveDraftDestinationUnitId(tx, next);") "Referral update destination Unit resolution"
}
$updateDataAnchor='      destinationCenterId: patch.destinationCenterId,'
if (([regex]::Matches($service,[regex]::Escape('      destinationUnitId,'))).Count -lt 2) {
    $service=Replace-ExactOnce $service $updateDataAnchor ($updateDataAnchor+"`n      destinationUnitId,") "Referral update destination Unit data"
}

$validationAnchor='    const validation = validateReferralTransition({'
if (-not $service.Contains('let centerMembershipVerified = false;')) {
    if (-not $service.Contains($validationAnchor)) { throw "Referral transition validation anchor not found. Stop for review." }
    $membershipBlock=@'
    let centerMembershipVerified = false;
    if (current.destinationScope === "INTERNAL_CENTER" && toStatus === "ACCEPTED") {
      if (!current.destinationUnitId) throw new Error("REFERRAL_DESTINATION_UNIT_REQUIRED");
      const actorIdentity = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { guid: true, isActive: true },
      });
      if (!actorIdentity?.isActive || !actorIdentity.guid) throw new Error("REFERRAL_ACTOR_GUID_REQUIRED");
      const unit = await tx.unit.findFirst({ where: { id: current.destinationUnitId, active: true }, select: { id: true } });
      if (!unit) throw new Error("REFERRAL_DESTINATION_UNIT_INACTIVE");
      const membership = await tx.userUnitMembership.findFirst({
        where: { userId: actorIdentity.guid, unitId: current.destinationUnitId, active: true },
        select: { id: true },
      });
      centerMembershipVerified = Boolean(membership);
    }

'@
    $service=$service.Replace($validationAnchor,(Normalize-Lf $membershipBlock)+$validationAnchor)
}
$oldPermissionMembership='        centerMembershipVerified: current.destinationScope === "INTERNAL_CENTER" && actor.permissions.has("referrals.accept"),'
$newMembership='        centerMembershipVerified,'
if ($service.Contains($oldPermissionMembership)) {
    $service=$service.Replace($oldPermissionMembership,$newMembership)
} elseif (-not $service.Contains($newMembership)) {
    throw "centerMembershipVerified input is not in expected pre/post form. Stop for review."
}

if (-not $service.Contains('destinationUnitId: current.destinationUnitId')) {
    $routePattern='(?ms)^      const units = current\.destinationScope === "INTERNAL_CENTER".*?^      \}\);\n'
    $routeMatches=[regex]::Matches($service,$routePattern)
    if ($routeMatches.Count -ne 1) { throw "Could not identify exactly one old referral WorkItem route block. Found: $($routeMatches.Count). Stop for review." }
    $newRouteBlock=@'
      if (current.destinationScope === "INTERNAL_CENTER") {
        if (!current.destinationUnitId) throw new Error("REFERRAL_WORKITEM_DESTINATION_UNIT_REQUIRED");
        const activeUnit = await tx.unit.findFirst({ where: { id: current.destinationUnitId, active: true }, select: { id: true } });
        if (!activeUnit) throw new Error("REFERRAL_WORKITEM_DESTINATION_UNIT_INACTIVE");
      }
      const route = resolveInternalReferralWorkItemRoute({
        destinationScope: current.destinationScope,
        reviewerGuid: current.assignedReviewerGuid,
        destinationUnitId: current.destinationUnitId,
      });
'@
    $rm=$routeMatches[0]
    $service=$service.Substring(0,$rm.Index)+(Normalize-Lf $newRouteBlock)+$service.Substring($rm.Index+$rm.Length)
}

if (-not $service.Contains('recipient.kind === "UNIT"')) {
    $notifyPattern='(?ms)^    for \(const recipient of validation\.notificationRecipients\) \{\n.*?^    \}\n(?=    if \(toStatus === "READY")'
    $notifyMatches=[regex]::Matches($service,$notifyPattern)
    if ($notifyMatches.Count -ne 1) { throw "Could not identify exactly one referral notification loop structurally. Found: $($notifyMatches.Count). Stop for review." }
    $newNotifyLoop=@'
    for (const recipient of validation.notificationRecipients) {
      if (recipient.kind === "ROLE") {
        await notifyRoleInTransaction(tx as any, recipient.role as UserRole, "طلب إحالة يحتاج المتابعة", { link });
      } else if (recipient.kind === "UNIT") {
        await notifyUnitInTransaction(tx as any, recipient.unitId, "إحالة داخلية جديدة للوحدة", { link });
      } else {
        await notifyUserInTransaction(tx as any, recipient.userId, toStatus === "ACCEPTED" ? "قُبلت الإحالة الداخلية" : "طلب إحالة يحتاج المتابعة", { link });
      }
    }
'@
    $nm=$notifyMatches[0]
    $service=$service.Substring(0,$nm.Index)+(Normalize-Lf $newNotifyLoop)+"`n"+$service.Substring($nm.Index+$nm.Length)
}

# Service assertions before the single write.
foreach ($needle in @(
    'notifyUnitInTransaction',
    'userUnitMembership.findFirst',
    'centerMembershipVerified = Boolean(membership)',
    'destinationUnitId: current.destinationUnitId',
    'resolveDraftDestinationUnitId',
    'recipient.kind === "UNIT"',
    'recipient.unitId'
)) {
    if (-not $service.Contains($needle)) { throw "Recovered service source assertion failed before write: $needle" }
}
if ($service.Contains('centerMembershipVerified: current.destinationScope === "INTERNAL_CENTER" && actor.permissions.has("referrals.accept")')) {
    throw "Permission-only center membership substitution still exists."
}
Write-Utf8NoBom $servicePath $service
Write-Host "Referral service membership/routing/notification scope: RECOVERED"

# Replace the route utility test with the desired explicit-Unit test file.
$routeTestPath=Join-Path $Project "tests\unit\referral-workitem-routing.test.ts"
$routeTests=@'
import { describe, expect, it } from "vitest";
import { resolveInternalReferralWorkItemRoute } from "@/lib/referral-workitem-routing";

describe("internal referral WorkItem routing", () => {
  it("routes specialist work to the actual reviewer UUID and marks it accepted", () => {
    expect(resolveInternalReferralWorkItemRoute({
      destinationScope: "INTERNAL_SPECIALIST",
      reviewerGuid: "11111111-1111-1111-1111-111111111111",
    })).toEqual({
      status: "ACCEPTED",
      assignedUserId: "11111111-1111-1111-1111-111111111111",
      assignedUnitId: null,
      accepted: true,
    });
  });

  it("rejects specialist routing without a reviewer UUID", () => {
    expect(() => resolveInternalReferralWorkItemRoute({ destinationScope: "INTERNAL_SPECIALIST" }))
      .toThrow("REFERRAL_WORKITEM_REVIEWER_GUID_REQUIRED");
  });

  it("routes center work only to the explicit persisted Unit UUID", () => {
    expect(resolveInternalReferralWorkItemRoute({
      destinationScope: "INTERNAL_CENTER",
      destinationUnitId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    })).toEqual({
      status: "ASSIGNED",
      assignedUserId: null,
      assignedUnitId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      accepted: false,
    });
  });

  it("fails closed when a center referral has no explicit Unit UUID", () => {
    expect(() => resolveInternalReferralWorkItemRoute({ destinationScope: "INTERNAL_CENTER" }))
      .toThrow("REFERRAL_WORKITEM_DESTINATION_UNIT_REQUIRED");
  });
});
'@
Write-Utf8NoBom $routeTestPath (Normalize-Lf $routeTests)

# Patch workflow tests without brittle quote escaping.
$workflowTestPath=Join-Path $Project "tests\unit\referral-workflow.test.ts"
$workflowTests=Normalize-Lf ([System.IO.File]::ReadAllText($workflowTestPath,[System.Text.Encoding]::UTF8))
if (-not $workflowTests.Contains('destinationUnitId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",')) {
    $oldFixture=@'
    destinationCenterId: 7,
'@
    $newFixture=@'
    destinationCenterId: 7,
    destinationUnitId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
'@
    $workflowTests=Replace-ExactOnce $workflowTests (Normalize-Lf $oldFixture) (Normalize-Lf $newFixture) "internalCenter test fixture destinationUnitId"
}
if (-not $workflowTests.Contains('routes READY internal specialist notification only to its assigned reviewer')) {
    $designAnchor='describe("referral workflow notification design", () => {'
    if (-not $workflowTests.Contains($designAnchor)) { throw "Referral workflow notification design anchor not found. Stop for review." }
    $extra=@'

describe("referral workflow explicit internal targets", () => {
  it("routes READY internal specialist notification only to its assigned reviewer", () => {
    const result = check(internal(), actor("DOCTOR", permissions.update), "READY");
    expect(result.ok).toBe(true);
    expect(result.notificationRecipients).toEqual([
      { kind: "USER", userId: "doctor-1", purpose: "ASSIGNED_REVIEWER" },
    ]);
    expect(JSON.stringify(result.notificationRecipients)).not.toContain("DOCTOR");
  });

  it("routes READY internal center notification to the explicit Unit UUID", () => {
    const request = internalCenter();
    const result = check(request, actor("DOCTOR", permissions.update), "READY");
    expect(result.ok).toBe(true);
    expect(result.notificationRecipients).toEqual([
      { kind: "UNIT", unitId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", purpose: "DESTINATION_UNIT" },
    ]);
  });

  it("fails a center referral that has no explicit Unit UUID", () => {
    const request = { ...internalCenter(), destinationUnitId: null };
    const result = check(request, actor("DOCTOR", permissions.update), "READY");
    expect(result.errors).toContain("DESTINATION_UNIT_REQUIRED");
  });
});
'@
    $workflowTests=$workflowTests.Replace($designAnchor,(Normalize-Lf $extra)+"`n"+$designAnchor)
}
Write-Utf8NoBom $workflowTestPath $workflowTests
Write-Host "Referral scope tests: RECOVERED"

# Final source assertions.
$serviceCheck=Normalize-Lf ([System.IO.File]::ReadAllText($servicePath,[System.Text.Encoding]::UTF8))
$workflowCheck=Normalize-Lf ([System.IO.File]::ReadAllText($workflowPath,[System.Text.Encoding]::UTF8))
$routeCheck=Normalize-Lf ([System.IO.File]::ReadAllText($routePath,[System.Text.Encoding]::UTF8))
foreach ($needle in @('notifyUnitInTransaction','userUnitMembership.findFirst','centerMembershipVerified = Boolean(membership)','destinationUnitId: current.destinationUnitId','resolveDraftDestinationUnitId','recipient.kind === "UNIT"')) {
    if (-not $serviceCheck.Contains($needle)) { throw "Service source assertion failed: $needle" }
}
foreach ($needle in @('kind: "UNIT"; unitId: string; purpose: "DESTINATION_UNIT"','kind: "USER", userId: request.assignedReviewerId, purpose: "ASSIGNED_REVIEWER"','if (blank(request.destinationUnitId)) errors.push("DESTINATION_UNIT_REQUIRED")')) {
    if (-not $workflowCheck.Contains($needle)) { throw "Workflow source assertion failed: $needle" }
}
if ($workflowCheck.Contains('{ kind: "ROLE", role: "DOCTOR" }')) { throw "Patient-specific DOCTOR role notification still exists." }
if (-not $routeCheck.Contains('REFERRAL_WORKITEM_DESTINATION_UNIT_REQUIRED')) { throw "Explicit WorkItem destination Unit route assertion failed." }
Write-Host "Source cutover assertions: PASS"

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
    throw "Database row counts changed during direct code-only referral scope recovery.`nBefore:`n$countsBefore`nAfter:`n$countsAfter"
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
$reportPath=Join-Path $auditDir "24-PHASE4-REFERRAL-UNIT-SCOPE-CUTOVER.md"
$report=@"
# Phase 4 - Referral Unit Scope + Notification Cutover

Status: PASS

Recovery:
- Previous cutover already completed referral-workflow.ts and referral-workitem-routing.ts, then stopped before referral-service.ts was written.
- This direct recovery verified those completed source markers and finished referral-service.ts using structural matching instead of patching/re-running the brittle main helper.

Implemented:
- INTERNAL_CENTER draft create/update persists destinationUnitId while destinationCenterId remains for compatibility.
- INTERNAL_CENTER acceptance verifies the actor is active and has an actual active UserUnitMembership for destinationUnitId.
- referrals.accept permission remains required by workflow permission checks but is no longer treated as membership proof.
- Accepted center WorkItems route from the persisted destinationUnitId, not runtime Center-name lookup.
- INTERNAL_SPECIALIST READY notification targets the actual assigned reviewer User, not the DOCTOR role.
- INTERNAL_CENTER READY notification fans out to active members of the actual destination Unit.
- Role notifications remain only for true broadcast/admin workflow use.
- No Role value is used as PatientWorkItem ownership.

Safety:
- Code-only recovery after the already-applied additive Unit binding migration.
- No database row counts changed.
- No app container restart.
- Original live server remains untouched.

Preflight:
$preflight

Verification:
- Prisma validate/generate: PASS
- TypeScript: PASS
- Targeted Vitest: PASS
- Full Vitest: PASS
- Project audit: PASS
- Production build check: PASS
- Prisma migration status: PASS
- Running app login smoke: PASS (HTTP $code)

Rollback snapshot:
$rollbackDir

Next:
Phase 4 final gate, then Phase 5 My Work / patient journey / notification presentation cutover.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "======================================================"
Write-Host "PHASE 4 REFERRAL UNIT SCOPE DIRECT RECOVERY: PASS"
Write-Host "======================================================"
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "Rollback snapshot: $rollbackDir"
