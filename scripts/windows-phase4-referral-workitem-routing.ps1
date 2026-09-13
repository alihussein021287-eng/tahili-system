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
    return $path
}

function Replace-Exact {
    param([string]$Text,[string]$Old,[string]$New,[string]$Label)
    if (-not $Text.Contains($Old)) { throw "Expected source block not found for $Label. Stop for review." }
    return $Text.Replace($Old,$New)
}

Write-Host ""
Write-Host "=== PHASE 4 REFERRAL -> WORKITEM ROUTING CUTOVER ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\17-PHASE3-CARESTAGE-OPEN-MIGRATION.md" "Phase 3 CareStage migration" | Out-Null
Test-PassReport "_PHASE01_AUDIT\18-PHASE4-REFERRAL-ROUTING-INVENTORY.md" "Phase 4 referral routing inventory" | Out-Null
Write-Host "Prerequisite reports: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma","src\lib\referral-service.ts")) {
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
  AND to_regclass('public.units') IS NOT NULL
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='referral_requests' AND column_name='guid' AND data_type='uuid')
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='referral_requests' AND column_name='assignedReviewerGuid' AND data_type='uuid')
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patients' AND column_name='guid' AND data_type='uuid')
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='guid' AND data_type='uuid')
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patient_work_items' AND column_name='legacyCareStageId')
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required Phase 1/2/3 UUID routing shape is missing." }

$ambiguousUnitSql=@'
SELECT count(*) FROM (
  SELECT lower(btrim("name"))
  FROM "units"
  WHERE "active"=true
  GROUP BY lower(btrim("name"))
  HAVING count(*) > 1
) x;
'@
$ambiguousUnits=[int64](Invoke-PsqlText $ambiguousUnitSql)
if ($ambiguousUnits -ne 0) { throw "Active Unit names are ambiguous after normalization. Stop before routing cutover." }

$acceptedInternalSql=@'
SELECT count(*) FROM "referral_requests"
WHERE "destinationScope"::text IN ('INTERNAL_SPECIALIST','INTERNAL_CENTER')
  AND "status"::text='ACCEPTED';
'@
$acceptedInternal=[int64](Invoke-PsqlText $acceptedInternalSql)
if ($acceptedInternal -ne 0) { throw "Accepted internal referrals appeared after the inventory ($acceptedInternal). Re-run inventory/backfill before code cutover." }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-referral-workitem-routing" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null

$servicePath=Join-Path $Project "src\lib\referral-service.ts"
$routePath=Join-Path $Project "src\lib\referral-workitem-routing.ts"
$testPath=Join-Path $Project "tests\unit\referral-workitem-routing.test.ts"
Copy-Item -LiteralPath $servicePath -Destination (Join-Path $rollbackDir "referral-service.ts.before") -Force
if (Test-Path -LiteralPath $routePath) { Copy-Item -LiteralPath $routePath -Destination (Join-Path $rollbackDir "referral-workitem-routing.ts.before") -Force }
if (Test-Path -LiteralPath $testPath) { Copy-Item -LiteralPath $testPath -Destination (Join-Path $rollbackDir "referral-workitem-routing.test.ts.before") -Force }
Write-Host "Rollback snapshot: $rollbackDir"

$route=@'
export type InternalReferralUnit = {
  id: string;
  name: string;
  active: boolean;
};

export type InternalReferralRouteInput = {
  destinationScope: "INTERNAL_SPECIALIST" | "INTERNAL_CENTER";
  reviewerGuid?: string | null;
  centerName?: string | null;
  units?: InternalReferralUnit[];
};

export type InternalReferralWorkItemRoute = {
  status: "ASSIGNED" | "ACCEPTED";
  assignedUserId: string | null;
  assignedUnitId: string | null;
  accepted: boolean;
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function resolveInternalReferralWorkItemRoute(input: InternalReferralRouteInput): InternalReferralWorkItemRoute {
  if (input.destinationScope === "INTERNAL_SPECIALIST") {
    const reviewerGuid = input.reviewerGuid?.trim() || null;
    if (!reviewerGuid) throw new Error("REFERRAL_WORKITEM_REVIEWER_GUID_REQUIRED");
    return {
      status: "ACCEPTED",
      assignedUserId: reviewerGuid,
      assignedUnitId: null,
      accepted: true,
    };
  }

  const centerName = input.centerName?.trim() || null;
  if (!centerName) throw new Error("REFERRAL_WORKITEM_CENTER_NAME_REQUIRED");
  const key = normalize(centerName);
  const matches = (input.units ?? []).filter((unit) => unit.active && normalize(unit.name) === key);
  if (matches.length === 0) throw new Error("REFERRAL_WORKITEM_UNIT_NOT_FOUND");
  if (matches.length !== 1) throw new Error("REFERRAL_WORKITEM_UNIT_AMBIGUOUS");
  return {
    status: "ASSIGNED",
    assignedUserId: null,
    assignedUnitId: matches[0].id,
    accepted: false,
  };
}
'@
[System.IO.File]::WriteAllText($routePath,$route,(New-Object System.Text.UTF8Encoding($false)))

$tests=@'
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

  it("routes center work to exactly one active Unit using normalized exact name", () => {
    expect(resolveInternalReferralWorkItemRoute({
      destinationScope: "INTERNAL_CENTER",
      centerName: " Rehab Center ",
      units: [
        { id: "unit-1", name: "rehab center", active: true },
        { id: "unit-2", name: "Other", active: true },
      ],
    })).toEqual({ status: "ASSIGNED", assignedUserId: null, assignedUnitId: "unit-1", accepted: false });
  });

  it("never guesses a missing or ambiguous Unit", () => {
    expect(() => resolveInternalReferralWorkItemRoute({
      destinationScope: "INTERNAL_CENTER",
      centerName: "Rehab",
      units: [],
    })).toThrow("REFERRAL_WORKITEM_UNIT_NOT_FOUND");

    expect(() => resolveInternalReferralWorkItemRoute({
      destinationScope: "INTERNAL_CENTER",
      centerName: "Rehab",
      units: [
        { id: "unit-1", name: "Rehab", active: true },
        { id: "unit-2", name: " rehab ", active: true },
      ],
    })).toThrow("REFERRAL_WORKITEM_UNIT_AMBIGUOUS");
  });
});
'@
[System.IO.File]::WriteAllText($testPath,$tests,(New-Object System.Text.UTF8Encoding($false)))

$service=[System.IO.File]::ReadAllText($servicePath,[System.Text.Encoding]::UTF8)
$service=$service.Replace("`r`n","`n")

$oldImport='import { validateReferralPatch, validateReferralTransition } from "@/lib/referral-workflow";'
$newImport=$oldImport + "`n" + 'import { resolveInternalReferralWorkItemRoute } from "@/lib/referral-workitem-routing";'
$service=Replace-Exact $service $oldImport $newImport "routing import"

$oldQuery='    const current = await tx.referralRequest.findUnique({ where: { id }, include: { patient: { select: { fileNumber: true } }, destinationCenter: { select: { name: true } } } });'
$newQuery='    const current = await tx.referralRequest.findUnique({ where: { id }, include: { patient: { select: { fileNumber: true, guid: true } }, destinationCenter: { select: { name: true } } } });'
$service=Replace-Exact $service $oldQuery $newQuery "referral patient GUID include"

$oldBlock=@'
    let careStageId = current.careStageId;
    if (validation.effects.createCareStage && !careStageId) {
      const last = await tx.careStage.aggregate({ where: { patientId: current.patientId }, _max: { sequence: true } });
      const stage = await tx.careStage.create({ data: {
        patientId: current.patientId,
        station: current.destinationCenter?.name || current.requestedService,
        responsibleRole: current.destinationScope === "INTERNAL_SPECIALIST" ? "DOCTOR" : "HEAD_THERAPIST",
        sequence: (last._max.sequence ?? -1) + 1,
        note: "ناتجة عن إحالة داخلية مقبولة",
        createdById: actor.userId,
      } });
      careStageId = stage.id;
    }
'@
$newBlock=@'
    let careStageId = current.careStageId;
    if (validation.effects.createCareStage && !careStageId) {
      const last = await tx.careStage.aggregate({ where: { patientId: current.patientId }, _max: { sequence: true } });
      const stage = await tx.careStage.create({ data: {
        patientId: current.patientId,
        station: current.destinationCenter?.name || current.requestedService,
        responsibleRole: current.destinationScope === "INTERNAL_SPECIALIST" ? "DOCTOR" : "HEAD_THERAPIST",
        sequence: (last._max.sequence ?? -1) + 1,
        note: "ناتجة عن إحالة داخلية مقبولة",
        createdById: actor.userId,
      } });
      careStageId = stage.id;
    }

    let workItemId: string | null = null;
    if (toStatus === "ACCEPTED" && (current.destinationScope === "INTERNAL_SPECIALIST" || current.destinationScope === "INTERNAL_CENTER")) {
      if (!careStageId) throw new Error("REFERRAL_WORKITEM_CARE_STAGE_REQUIRED");
      if (!current.patient.guid || !current.guid) throw new Error("REFERRAL_WORKITEM_GUID_FOUNDATION_REQUIRED");

      const actorIdentity = await tx.user.findUnique({ where: { id: actor.userId }, select: { guid: true } });
      if (!actorIdentity?.guid) throw new Error("REFERRAL_WORKITEM_ACTOR_GUID_REQUIRED");

      const units = current.destinationScope === "INTERNAL_CENTER"
        ? await tx.unit.findMany({ select: { id: true, name: true, active: true } })
        : [];
      const route = resolveInternalReferralWorkItemRoute({
        destinationScope: current.destinationScope,
        reviewerGuid: current.assignedReviewerGuid,
        centerName: current.destinationCenter?.name || null,
        units,
      });

      const existingWorkItem = await tx.patientWorkItem.findUnique({ where: { legacyCareStageId: careStageId } });
      if (existingWorkItem) {
        const sameOwner = existingWorkItem.assignedUserId === route.assignedUserId && existingWorkItem.assignedUnitId === route.assignedUnitId;
        if (!sameOwner) throw new Error("REFERRAL_WORKITEM_EXISTING_OWNER_MISMATCH");
        workItemId = existingWorkItem.id;
      } else {
        const workItem = await tx.patientWorkItem.create({ data: {
          patientId: current.patient.guid,
          kind: current.destinationScope === "INTERNAL_SPECIALIST" ? "REFERRAL_INTERNAL_SPECIALIST" : "REFERRAL_INTERNAL_CENTER",
          status: route.status,
          assignedUserId: route.assignedUserId,
          assignedUnitId: route.assignedUnitId,
          createdById: actorIdentity.guid,
          referralRequestId: current.guid,
          legacyCareStageId: careStageId,
          note: `Accepted internal referral ${current.id}`,
          acceptedAt: route.accepted ? new Date() : null,
        } });
        workItemId = workItem.id;
      }
    }
'@
$service=Replace-Exact $service $oldBlock $newBlock "accepted referral WorkItem routing"

$oldAudit='    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "referral_requests", recordId: id, oldValue: { status: current.status }, newValue: { status: toStatus, officialDocumentId, careStageId, resultRecorded: toStatus === "RESULT_RECEIVED", cancellationReason: toStatus === "CANCELLED" ? input.cancellationReason : undefined } } });'
$newAudit='    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "referral_requests", recordId: id, oldValue: { status: current.status }, newValue: { status: toStatus, officialDocumentId, careStageId, workItemId, resultRecorded: toStatus === "RESULT_RECEIVED", cancellationReason: toStatus === "CANCELLED" ? input.cancellationReason : undefined } } });'
$service=Replace-Exact $service $oldAudit $newAudit "referral audit WorkItem link"

[System.IO.File]::WriteAllText($servicePath,$service,(New-Object System.Text.UTF8Encoding($false)))

$sourceCheck=[System.IO.File]::ReadAllText($servicePath,[System.Text.Encoding]::UTF8)
foreach ($needle in @(
  'resolveInternalReferralWorkItemRoute',
  'REFERRAL_WORKITEM_ACTOR_GUID_REQUIRED',
  'patientWorkItem.create',
  'assignedReviewerGuid',
  'legacyCareStageId: careStageId',
  'workItemId,'
)) {
  if (-not $sourceCheck.Contains($needle)) { throw "Source cutover assertion failed: $needle" }
}
Write-Host "Source routing cutover: PASS"

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
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run","tests/unit/referral-workitem-routing.test.ts","tests/unit/referral-workflow.test.ts","tests/unit/patient-work-item.test.ts")

Write-Host ""
Write-Host "=== FULL TESTS + PROJECT AUDIT + BUILD ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")

Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

$afterAccepted=[int64](Invoke-PsqlText $acceptedInternalSql)
if ($afterAccepted -ne 0) { throw "Database changed during code-only cutover: accepted internal referrals now $afterAccepted." }

$loginOk=$false
try {
    $resp=Invoke-WebRequest -Uri "http://localhost:3000/api/auth/signin" -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) { $loginOk=$true }
} catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -in 301,302,303,307,308) { $loginOk=$true }
}
if (-not $loginOk) { throw "Running app login smoke failed." }
Write-Host "Running app login smoke: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "19-PHASE4-REFERRAL-WORKITEM-ROUTING.md"
$report=@"
# Phase 4 - Referral to PatientWorkItem Routing Cutover

Status: PASS

Accepted internal referrals at cutover: $acceptedInternal
Ambiguous normalized active Unit names: $ambiguousUnits

Implemented:
- INTERNAL_SPECIALIST accepted referrals now create a PatientWorkItem owned by the actual assigned reviewer UUID.
- Specialist WorkItems start as ACCEPTED because the reviewer is the actor accepting the referral.
- INTERNAL_CENTER accepted referrals now create a PatientWorkItem assigned to the exact matching active Unit UUID.
- Center WorkItems start as ASSIGNED and remain available for an authorized Unit member to claim.
- Unit matching is exact after trim/lower normalization; missing or ambiguous mappings fail closed.
- Legacy CareStage creation remains temporarily for UI/backward compatibility, but responsibleRole is not used as PatientWorkItem ownership.
- The new WorkItem is linked to the ReferralRequest UUID and transitional legacyCareStageId.
- Referral audit data records workItemId.

Safety:
- Code-only cutover; no new database migration in this step.
- No app container restart.
- Existing local database rows were not modified by this cutover.
- Original live server remains untouched.

Rollback snapshot:
$rollbackDir

Next:
- Build Phase 4 Unit claim/access and referral notification cutover around actual User/Unit scope.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 4 REFERRAL WORKITEM ROUTING: PASS"
Write-Host "======================================"
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "Rollback snapshot: $rollbackDir"
