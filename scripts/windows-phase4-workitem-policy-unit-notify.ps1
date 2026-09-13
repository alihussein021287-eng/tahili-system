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

function Write-Utf8NoBom {
    param([Parameter(Mandatory = $true)][string]$Path,[Parameter(Mandatory = $true)][string]$Text)
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}

function Normalize-Lf {
    param([Parameter(Mandatory = $true)][string]$Text)
    return ($Text.Replace("`r`n","`n").Replace("`r","`n"))
}

Write-Host ""
Write-Host "=== PHASE 4 WORKITEM SCOPE POLICY + UNIT NOTIFICATION FANOUT ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\20-PHASE4-WORKITEM-SCOPE-INVENTORY.md" "Phase 4 WorkItem scope inventory" | Out-Null
Test-PassReport "_PHASE01_AUDIT\21-PHASE4-NOTIFICATION-SCOPE-INVENTORY.md" "Phase 4 notification scope inventory" | Out-Null
Write-Host "Phase 4 prerequisites: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(
    ".env.saif-dev",
    "docker-compose.saif-dev.yml",
    "src\lib\notify.ts",
    "src\lib\patient-work-item.ts",
    "prisma\schema.prisma"
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
  AND to_regclass('public.units') IS NOT NULL
  AND to_regclass('public.user_unit_memberships') IS NOT NULL
  AND to_regclass('public.users') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required WorkItem/Unit/User scope tables are missing." }

$countsSql=@'
SELECT 'notifications|' || count(*) FROM "Notification"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
ORDER BY 1;
'@
$countsBefore=Invoke-PsqlText $countsSql

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-workitem-policy-unit-notify" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null

$notifyPath=Join-Path $Project "src\lib\notify.ts"
$policyPath=Join-Path $Project "src\lib\patient-work-item-scope.ts"
$testPath=Join-Path $Project "tests\unit\patient-work-item-scope.test.ts"
Copy-Item -LiteralPath $notifyPath -Destination (Join-Path $rollbackDir "notify.ts.before") -Force
if (Test-Path -LiteralPath $policyPath) { Copy-Item -LiteralPath $policyPath -Destination (Join-Path $rollbackDir "patient-work-item-scope.ts.before") -Force }
if (Test-Path -LiteralPath $testPath) { Copy-Item -LiteralPath $testPath -Destination (Join-Path $rollbackDir "patient-work-item-scope.test.ts.before") -Force }
$countsBefore | Set-Content -LiteralPath (Join-Path $rollbackDir "db-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

$policy=@'
export type PatientWorkItemScopeTarget = {
  status: string;
  assignedUserId?: string | null;
  assignedUnitId?: string | null;
};

export type PatientWorkItemScopeActor = {
  userGuid: string;
  unitIds: readonly string[];
};

function normalizedUnitIds(actor: PatientWorkItemScopeActor) {
  return new Set(actor.unitIds.map((value) => value.trim()).filter(Boolean));
}

export function isWorkItemOwnedByActor(item: PatientWorkItemScopeTarget, actor: PatientWorkItemScopeActor) {
  const userGuid = actor.userGuid.trim();
  return !!userGuid && item.assignedUserId === userGuid;
}

export function isWorkItemInActorUnit(item: PatientWorkItemScopeTarget, actor: PatientWorkItemScopeActor) {
  const unitId = item.assignedUnitId?.trim() || null;
  return !!unitId && normalizedUnitIds(actor).has(unitId);
}

export function canViewWorkItemScope(item: PatientWorkItemScopeTarget, actor: PatientWorkItemScopeActor) {
  return isWorkItemOwnedByActor(item, actor) || isWorkItemInActorUnit(item, actor);
}

export function canClaimWorkItemScope(item: PatientWorkItemScopeTarget, actor: PatientWorkItemScopeActor) {
  return item.status === "ASSIGNED"
    && !item.assignedUserId
    && isWorkItemInActorUnit(item, actor);
}

export function canActOnWorkItemScope(item: PatientWorkItemScopeTarget, actor: PatientWorkItemScopeActor) {
  return isWorkItemOwnedByActor(item, actor);
}

export function assertWorkItemViewScope(item: PatientWorkItemScopeTarget, actor: PatientWorkItemScopeActor) {
  if (!canViewWorkItemScope(item, actor)) throw new Error("WORK_ITEM_SCOPE_DENIED");
}

export function assertWorkItemClaimScope(item: PatientWorkItemScopeTarget, actor: PatientWorkItemScopeActor) {
  if (!canClaimWorkItemScope(item, actor)) throw new Error("WORK_ITEM_CLAIM_SCOPE_DENIED");
}

export function assertWorkItemActionScope(item: PatientWorkItemScopeTarget, actor: PatientWorkItemScopeActor) {
  if (!canActOnWorkItemScope(item, actor)) throw new Error("WORK_ITEM_ACTION_SCOPE_DENIED");
}
'@

$tests=@'
import { describe, expect, it } from "vitest";
import {
  assertWorkItemActionScope,
  assertWorkItemClaimScope,
  assertWorkItemViewScope,
  canActOnWorkItemScope,
  canClaimWorkItemScope,
  canViewWorkItemScope,
} from "@/lib/patient-work-item-scope";

const actor = {
  userGuid: "11111111-1111-1111-1111-111111111111",
  unitIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
};

describe("PatientWorkItem server scope policy", () => {
  it("allows the actual assigned user to view and act", () => {
    const item = { status: "ACCEPTED", assignedUserId: actor.userGuid, assignedUnitId: null };
    expect(canViewWorkItemScope(item, actor)).toBe(true);
    expect(canActOnWorkItemScope(item, actor)).toBe(true);
    expect(() => assertWorkItemViewScope(item, actor)).not.toThrow();
    expect(() => assertWorkItemActionScope(item, actor)).not.toThrow();
  });

  it("allows a Unit member to see and claim an unclaimed Unit assignment", () => {
    const item = { status: "ASSIGNED", assignedUserId: null, assignedUnitId: actor.unitIds[0] };
    expect(canViewWorkItemScope(item, actor)).toBe(true);
    expect(canClaimWorkItemScope(item, actor)).toBe(true);
    expect(() => assertWorkItemClaimScope(item, actor)).not.toThrow();
  });

  it("does not let Unit membership act as ownership after claim", () => {
    const item = {
      status: "ACCEPTED",
      assignedUserId: "22222222-2222-2222-2222-222222222222",
      assignedUnitId: actor.unitIds[0],
    };
    expect(canViewWorkItemScope(item, actor)).toBe(true);
    expect(canActOnWorkItemScope(item, actor)).toBe(false);
    expect(() => assertWorkItemActionScope(item, actor)).toThrow("WORK_ITEM_ACTION_SCOPE_DENIED");
  });

  it("rejects unassigned and unrelated work from normal user scope", () => {
    expect(canViewWorkItemScope({ status: "OPEN", assignedUserId: null, assignedUnitId: null }, actor)).toBe(false);
    expect(canViewWorkItemScope({
      status: "ASSIGNED",
      assignedUserId: null,
      assignedUnitId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    }, actor)).toBe(false);
  });

  it("never uses a role as ownership or scope input", () => {
    const roleLikeValue = "DOCTOR";
    expect(canViewWorkItemScope({ status: "ASSIGNED", assignedUserId: roleLikeValue, assignedUnitId: null }, actor)).toBe(false);
  });
});
'@

foreach ($pair in @(
    @{ Path=$policyPath; Text=$policy; Label="WorkItem scope policy" },
    @{ Path=$testPath; Text=$tests; Label="WorkItem scope tests" }
)) {
    if (Test-Path -LiteralPath $pair.Path) {
        $existing=Normalize-Lf ([System.IO.File]::ReadAllText($pair.Path,[System.Text.Encoding]::UTF8))
        $expected=Normalize-Lf $pair.Text
        if ($existing -ne $expected) { throw "$($pair.Label) already exists with unexpected content. Stop for review." }
        Write-Host "$($pair.Label): already present"
    } else {
        Write-Utf8NoBom $pair.Path $pair.Text
        Write-Host "$($pair.Label): CREATED"
    }
}

$notify=Normalize-Lf ([System.IO.File]::ReadAllText($notifyPath,[System.Text.Encoding]::UTF8))
if (-not $notify.Contains('export async function notifyUnitInTransaction')) {
    $oldType='type NotificationClient = Pick<typeof prisma, "notification">;'
    $newType='type NotificationClient = Pick<typeof prisma, "notification" | "userUnitMembership">;'
    if (-not $notify.Contains($oldType)) { throw "Expected NotificationClient type was not found. Stop for review." }
    $notify=$notify.Replace($oldType,$newType)

    $anchor=@'
export async function notifyUserInTransaction(
  client: NotificationClient,
  userId: string,
  title: string,
  opts: { body?: string; link?: string } = {},
) {
  return createNotification(client, { targetUserId: userId, title, body: opts.body ?? null, link: opts.link ?? null }, { includeReadInDedupe: true });
}
'@
    $addition=@'

export async function notifyUnitInTransaction(
  client: NotificationClient,
  unitId: string,
  title: string,
  opts: { body?: string; link?: string } = {},
) {
  const targetUnitId = unitId.trim();
  if (!targetUnitId) return 0;

  const memberships = await client.userUnitMembership.findMany({
    where: { unitId: targetUnitId, active: true },
    select: { user: { select: { id: true, isActive: true } } },
  });
  const userIds = [...new Set(memberships.filter((row) => row.user.isActive).map((row) => row.user.id))];

  let created = 0;
  for (const userId of userIds) {
    if (await createNotification(
      client,
      { targetUserId: userId, title, body: opts.body ?? null, link: opts.link ?? null },
      { includeReadInDedupe: true },
    )) created += 1;
  }
  return created;
}
'@
    if (-not $notify.Contains($anchor)) { throw "Expected notifyUserInTransaction block was not found. Stop for review." }
    $notify=$notify.Replace($anchor,$anchor+$addition)
    Write-Utf8NoBom $notifyPath $notify
    Write-Host "Unit notification fanout helper: ADDED"
} else {
    foreach ($needle in @('userUnitMembership.findMany','targetUserId: userId','row.user.isActive')) {
        if (-not $notify.Contains($needle)) { throw "Existing notifyUnitInTransaction does not match expected safe fanout contract: $needle" }
    }
    Write-Host "Unit notification fanout helper: already present"
}

$serviceText=Normalize-Lf ([System.IO.File]::ReadAllText((Join-Path $Project "src\lib\patient-work-item.ts"),[System.Text.Encoding]::UTF8))
foreach ($needle in @(
    'WORK_ITEM_UNIT_MEMBERSHIP_REQUIRED',
    'WORK_ITEM_ASSIGNED_USER_REQUIRED',
    'assignedUserId: actor.guid',
    'userUnitMembership.findFirst'
)) {
    if (-not $serviceText.Contains($needle)) { throw "PatientWorkItem service ownership guard missing: $needle" }
}
if ($serviceText -match '(?i)assignedRole|responsibleRole') { throw "PatientWorkItem service unexpectedly contains Role-based ownership." }
Write-Host "Existing WorkItem ownership/claim guards: PASS"

$notifyCheck=Normalize-Lf ([System.IO.File]::ReadAllText($notifyPath,[System.Text.Encoding]::UTF8))
foreach ($needle in @(
    'notifyUnitInTransaction',
    'userUnitMembership.findMany',
    'targetUserId: userId',
    'row.user.isActive'
)) {
    if (-not $notifyCheck.Contains($needle)) { throw "Unit notification source assertion failed: $needle" }
}
Write-Host "Unit notification source assertions: PASS"

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
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run","tests/unit/patient-work-item-scope.test.ts","tests/unit/patient-work-item.test.ts","tests/unit/notifications.test.ts")

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
    throw "Database row counts changed during code-only policy/notification step.`nBefore:`n$countsBefore`nAfter:`n$countsAfter"
}
Write-Host "Database write guard: PASS (Notification and PatientWorkItem counts unchanged)"

$httpCode=(& curl.exe -s -o NUL -w "%{http_code}" "http://localhost:3000/login").Trim()
if ($LASTEXITCODE -ne 0 -or $httpCode -ne '200') { throw "Running app login smoke failed (HTTP $httpCode)." }
Write-Host "Running app login smoke: PASS (HTTP 200)"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "22-PHASE4-WORKITEM-POLICY-UNIT-NOTIFY.md"
$report=@"
# Phase 4 - WorkItem Scope Policy + Unit Notification Fanout

Status: PASS

Implemented:
- Added pure server-side PatientWorkItem scope policy helpers for view, Unit claim, and actual-user action scope.
- Scope uses only actual User GUID and active Unit membership IDs supplied by the authenticated server context; Role is not an ownership input.
- Added notifyUnitInTransaction to fan a Unit-targeted event out to active Unit members as individual targetUserId notifications.
- No targetUnitId column was added to Notification.
- Per-user fanout intentionally preserves the existing per-row read Boolean semantics, so one Unit member reading an alert cannot mark another member's alert as read.
- Existing PatientWorkItem claim and owned-transition guards were re-asserted.

Safety:
- Code-only step; no Prisma migration was created.
- Notification and PatientWorkItem row counts were unchanged.
- No app restart.
- No prisma db push.

Verification:
- Prisma validate/generate: PASS
- TypeScript: PASS
- Targeted Vitest: PASS
- Full Vitest: PASS
- Project audit: PASS
- Next.js build: PASS
- Prisma migration status: PASS
- Running app login smoke: PASS

DB counts before/after:
$countsBefore

Rollback snapshot:
$rollbackDir

Next:
- Replace internal referral Role-wide routing notifications with actual reviewer User notifications or Unit fanout notifications.
- Then expose PatientWorkItem actions through authenticated server actions that combine permission checks with these scope helpers.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "=============================================="
Write-Host "PHASE 4 WORKITEM POLICY + UNIT NOTIFY: PASS"
Write-Host "=============================================="
Write-Host "Report: $reportPath"
Write-Host "Rollback snapshot: $rollbackDir"
