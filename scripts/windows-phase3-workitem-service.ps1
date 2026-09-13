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

function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
    return $path
}

Write-Host ""
Write-Host "=== PHASE 3 PATIENT WORK ITEM SERVICE ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\14-PHASE3-PATIENT-WORKITEM-FOUNDATION.md" "Phase 3 PatientWorkItem Foundation" | Out-Null
Write-Host "Phase 3 foundation: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }

foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$schema=[System.IO.File]::ReadAllText((Join-Path $Project "prisma\schema.prisma"),[System.Text.Encoding]::UTF8)
foreach ($needle in @("model PatientWorkItem", "enum PatientWorkItemStatus", "assignedUnitId", "assignedUserId", "createdById")) {
    if ($schema -notmatch [regex]::Escape($needle)) { throw "Local Prisma schema is missing Phase 3 foundation element: $needle" }
}

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase3-workitem-service" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null

$servicePath=Join-Path $Project "src\lib\patient-work-item.ts"
$testPath=Join-Path $Project "tests\unit\patient-work-item.test.ts"
if (Test-Path -LiteralPath $servicePath) { Copy-Item -LiteralPath $servicePath -Destination (Join-Path $rollbackDir "patient-work-item.ts.before") -Force }
if (Test-Path -LiteralPath $testPath) { Copy-Item -LiteralPath $testPath -Destination (Join-Path $rollbackDir "patient-work-item.test.ts.before") -Force }
Write-Host "Rollback snapshot: $rollbackDir"

$service=@'
import type { PatientWorkItemStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export type WorkItemAssignment = {
  assignedUserId?: string | null;
  assignedUnitId?: string | null;
};

export type WorkItemActor = {
  id: string;
  guid: string;
  username: string;
  fullName: string;
};

const TERMINAL = new Set<PatientWorkItemStatus>(["COMPLETED", "CANCELLED"]);

const TRANSITIONS: Record<PatientWorkItemStatus, readonly PatientWorkItemStatus[]> = {
  OPEN: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["PROGRESS_IN", "COMPLETED", "BLOCKED", "CANCELLED"],
  PROGRESS_IN: ["COMPLETED", "BLOCKED", "CANCELLED"],
  BLOCKED: ["ASSIGNED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function validateWorkItemAssignment(input: WorkItemAssignment, allowEmpty = false) {
  const user = input.assignedUserId?.trim() || null;
  const unit = input.assignedUnitId?.trim() || null;
  if (user && unit) throw new Error("WORK_ITEM_ASSIGNMENT_MUST_TARGET_ONE_OWNER");
  if (!allowEmpty && !user && !unit) throw new Error("WORK_ITEM_ASSIGNMENT_REQUIRED");
  return { assignedUserId: user, assignedUnitId: unit };
}

export function statusForAssignment(input: WorkItemAssignment): PatientWorkItemStatus {
  const target = validateWorkItemAssignment(input, true);
  return target.assignedUserId || target.assignedUnitId ? "ASSIGNED" : "OPEN";
}

export function validateWorkItemTransition(from: PatientWorkItemStatus, to: PatientWorkItemStatus) {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`WORK_ITEM_TRANSITION_NOT_ALLOWED:${from}->${to}`);
  return true;
}

function ensureMutable(status: PatientWorkItemStatus) {
  if (TERMINAL.has(status)) throw new Error(`WORK_ITEM_TERMINAL:${status}`);
}

async function loadActor(tx: any, actorUserId: string): Promise<WorkItemActor> {
  const actor = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, guid: true, username: true, fullName: true, isActive: true },
  });
  if (!actor || !actor.isActive || !actor.guid) throw new Error("WORK_ITEM_ACTOR_NOT_FOUND");
  return actor;
}

async function audit(
  tx: any,
  actor: WorkItemActor,
  action: "CREATE" | "UPDATE",
  event: string,
  recordId: string,
  oldValue?: unknown,
  newValue?: unknown,
) {
  await tx.auditLog.create({
    data: {
      userId: actor.id,
      actorUsername: actor.username,
      actorName: actor.fullName,
      action,
      tableName: "patient_work_items",
      recordId,
      oldValue: oldValue ? { event, value: oldValue } : { event },
      newValue: newValue ? { event, value: newValue } : { event },
    },
  });
}

export async function createPatientWorkItem(input: {
  actorUserId: string;
  patientId: string;
  kind: string;
  assignedUserId?: string | null;
  assignedUnitId?: string | null;
  referralRequestId?: string | null;
  parentWorkItemId?: string | null;
  note?: string | null;
}) {
  const kind = input.kind.trim();
  if (!kind) throw new Error("WORK_ITEM_KIND_REQUIRED");
  const assignment = validateWorkItemAssignment(input, true);
  const status = statusForAssignment(assignment);

  return prisma.$transaction(async (tx) => {
    const actor = await loadActor(tx, input.actorUserId);
    const item = await tx.patientWorkItem.create({
      data: {
        patientId: input.patientId,
        kind,
        status,
        assignedUserId: assignment.assignedUserId,
        assignedUnitId: assignment.assignedUnitId,
        createdById: actor.guid,
        referralRequestId: input.referralRequestId || null,
        parentWorkItemId: input.parentWorkItemId || null,
        note: input.note?.trim() || null,
      },
    });
    await audit(tx, actor, "CREATE", "CREATE", item.id, undefined, {
      status: item.status,
      assignedUserId: item.assignedUserId,
      assignedUnitId: item.assignedUnitId,
    });
    return item;
  });
}

export async function assignPatientWorkItem(input: {
  actorUserId: string;
  workItemId: string;
  assignedUserId?: string | null;
  assignedUnitId?: string | null;
  note?: string | null;
}) {
  const assignment = validateWorkItemAssignment(input);
  return prisma.$transaction(async (tx) => {
    const actor = await loadActor(tx, input.actorUserId);
    const before = await tx.patientWorkItem.findUnique({ where: { id: input.workItemId } });
    if (!before) throw new Error("WORK_ITEM_NOT_FOUND");
    ensureMutable(before.status);
    if (before.status !== "OPEN" && before.status !== "BLOCKED") {
      throw new Error(`WORK_ITEM_ASSIGN_NOT_ALLOWED:${before.status}`);
    }
    const item = await tx.patientWorkItem.update({
      where: { id: input.workItemId },
      data: {
        assignedUserId: assignment.assignedUserId,
        assignedUnitId: assignment.assignedUnitId,
        status: "ASSIGNED",
        acceptedAt: null,
        startedAt: null,
        completedAt: null,
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      },
    });
    await audit(tx, actor, "UPDATE", "ASSIGN", item.id, before, item);
    return item;
  });
}

export async function claimPatientWorkItem(input: { actorUserId: string; workItemId: string }) {
  return prisma.$transaction(async (tx) => {
    const actor = await loadActor(tx, input.actorUserId);
    const before = await tx.patientWorkItem.findUnique({ where: { id: input.workItemId } });
    if (!before) throw new Error("WORK_ITEM_NOT_FOUND");
    ensureMutable(before.status);
    if (!before.assignedUnitId || before.assignedUserId) throw new Error("WORK_ITEM_NOT_CLAIMABLE");
    if (before.status !== "ASSIGNED") throw new Error(`WORK_ITEM_CLAIM_NOT_ALLOWED:${before.status}`);

    const membership = await tx.userUnitMembership.findFirst({
      where: { userId: actor.guid, unitId: before.assignedUnitId, active: true },
      select: { id: true },
    });
    if (!membership) throw new Error("WORK_ITEM_UNIT_MEMBERSHIP_REQUIRED");

    const result = await tx.patientWorkItem.updateMany({
      where: {
        id: input.workItemId,
        status: "ASSIGNED",
        assignedUnitId: before.assignedUnitId,
        assignedUserId: null,
      },
      data: { assignedUserId: actor.guid },
    });
    if (result.count !== 1) throw new Error("WORK_ITEM_ALREADY_CLAIMED");
    const item = await tx.patientWorkItem.findUniqueOrThrow({ where: { id: input.workItemId } });
    await audit(tx, actor, "UPDATE", "CLAIM", item.id, before, item);
    return item;
  });
}

async function transitionOwnedWorkItem(input: {
  actorUserId: string;
  workItemId: string;
  from: PatientWorkItemStatus[];
  to: PatientWorkItemStatus;
  event: string;
  timestamps?: Record<string, Date | null>;
}) {
  return prisma.$transaction(async (tx) => {
    const actor = await loadActor(tx, input.actorUserId);
    const before = await tx.patientWorkItem.findUnique({ where: { id: input.workItemId } });
    if (!before) throw new Error("WORK_ITEM_NOT_FOUND");
    if (!before.assignedUserId || before.assignedUserId !== actor.guid) throw new Error("WORK_ITEM_ASSIGNED_USER_REQUIRED");
    if (!input.from.includes(before.status)) throw new Error(`WORK_ITEM_TRANSITION_NOT_ALLOWED:${before.status}->${input.to}`);
    validateWorkItemTransition(before.status, input.to);

    const result = await tx.patientWorkItem.updateMany({
      where: { id: input.workItemId, status: before.status, assignedUserId: actor.guid },
      data: { status: input.to, ...(input.timestamps || {}) },
    });
    if (result.count !== 1) throw new Error("WORK_ITEM_CONCURRENT_UPDATE");
    const item = await tx.patientWorkItem.findUniqueOrThrow({ where: { id: input.workItemId } });
    await audit(tx, actor, "UPDATE", input.event, item.id, before, item);
    return item;
  });
}

export function acceptPatientWorkItem(actorUserId: string, workItemId: string) {
  return transitionOwnedWorkItem({
    actorUserId,
    workItemId,
    from: ["ASSIGNED"],
    to: "ACCEPTED",
    event: "ACCEPT",
    timestamps: { acceptedAt: new Date() },
  });
}

export function startPatientWorkItem(actorUserId: string, workItemId: string) {
  return transitionOwnedWorkItem({
    actorUserId,
    workItemId,
    from: ["ACCEPTED"],
    to: "PROGRESS_IN",
    event: "START",
    timestamps: { startedAt: new Date() },
  });
}

export function completePatientWorkItem(actorUserId: string, workItemId: string) {
  return transitionOwnedWorkItem({
    actorUserId,
    workItemId,
    from: ["ACCEPTED", "PROGRESS_IN"],
    to: "COMPLETED",
    event: "COMPLETE",
    timestamps: { completedAt: new Date() },
  });
}

export async function reassignPatientWorkItem(input: {
  actorUserId: string;
  workItemId: string;
  assignedUserId?: string | null;
  assignedUnitId?: string | null;
  note?: string | null;
}) {
  const assignment = validateWorkItemAssignment(input);
  return prisma.$transaction(async (tx) => {
    const actor = await loadActor(tx, input.actorUserId);
    const before = await tx.patientWorkItem.findUnique({ where: { id: input.workItemId } });
    if (!before) throw new Error("WORK_ITEM_NOT_FOUND");
    ensureMutable(before.status);

    const item = await tx.patientWorkItem.update({
      where: { id: input.workItemId },
      data: {
        assignedUserId: assignment.assignedUserId,
        assignedUnitId: assignment.assignedUnitId,
        status: "ASSIGNED",
        acceptedAt: null,
        startedAt: null,
        completedAt: null,
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      },
    });
    await audit(tx, actor, "UPDATE", "REASSIGN", item.id, before, item);
    return item;
  });
}
'@

$tests=@'
import { describe, expect, it } from "vitest";
import {
  statusForAssignment,
  validateWorkItemAssignment,
  validateWorkItemTransition,
} from "@/lib/patient-work-item";

describe("PatientWorkItem assignment rules", () => {
  it("keeps an unassigned new item OPEN", () => {
    expect(statusForAssignment({})).toBe("OPEN");
  });

  it("marks a user or unit target as ASSIGNED", () => {
    expect(statusForAssignment({ assignedUserId: "user-guid" })).toBe("ASSIGNED");
    expect(statusForAssignment({ assignedUnitId: "unit-guid" })).toBe("ASSIGNED");
  });

  it("rejects simultaneous user and unit ownership", () => {
    expect(() => validateWorkItemAssignment({ assignedUserId: "u", assignedUnitId: "unit" }))
      .toThrow("WORK_ITEM_ASSIGNMENT_MUST_TARGET_ONE_OWNER");
  });

  it("requires one owner for explicit assign/reassign operations", () => {
    expect(() => validateWorkItemAssignment({})).toThrow("WORK_ITEM_ASSIGNMENT_REQUIRED");
  });
});

describe("PatientWorkItem transition rules", () => {
  it("accepts the main happy path", () => {
    expect(validateWorkItemTransition("OPEN", "ASSIGNED")).toBe(true);
    expect(validateWorkItemTransition("ASSIGNED", "ACCEPTED")).toBe(true);
    expect(validateWorkItemTransition("ACCEPTED", "PROGRESS_IN")).toBe(true);
    expect(validateWorkItemTransition("PROGRESS_IN", "COMPLETED")).toBe(true);
  });

  it("supports completing directly after acceptance", () => {
    expect(validateWorkItemTransition("ACCEPTED", "COMPLETED")).toBe(true);
  });

  it("supports re-routing a blocked item back to assigned", () => {
    expect(validateWorkItemTransition("BLOCKED", "ASSIGNED")).toBe(true);
  });

  it("keeps completed and cancelled terminal", () => {
    expect(() => validateWorkItemTransition("COMPLETED", "ASSIGNED")).toThrow("WORK_ITEM_TRANSITION_NOT_ALLOWED");
    expect(() => validateWorkItemTransition("CANCELLED", "ASSIGNED")).toThrow("WORK_ITEM_TRANSITION_NOT_ALLOWED");
  });

  it("rejects skipped ownership/acceptance states", () => {
    expect(() => validateWorkItemTransition("OPEN", "PROGRESS_IN")).toThrow("WORK_ITEM_TRANSITION_NOT_ALLOWED");
    expect(() => validateWorkItemTransition("ASSIGNED", "COMPLETED")).toThrow("WORK_ITEM_TRANSITION_NOT_ALLOWED");
  });
});
'@

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $servicePath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $testPath) | Out-Null
[System.IO.File]::WriteAllText($servicePath,$service,(New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText($testPath,$tests,(New-Object System.Text.UTF8Encoding($false)))

$serviceNow=[System.IO.File]::ReadAllText($servicePath,[System.Text.Encoding]::UTF8)
foreach ($needle in @("createPatientWorkItem", "claimPatientWorkItem", "acceptPatientWorkItem", "startPatientWorkItem", "completePatientWorkItem", "reassignPatientWorkItem", "userUnitMembership.findFirst", "auditLog.create", "patientWorkItem.updateMany")) {
    if ($serviceNow -notmatch [regex]::Escape($needle)) { throw "Service source assertion failed: $needle" }
}
Write-Host "WorkItem service source assertions: PASS"

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")

Write-Host ""
Write-Host "=== PRISMA VALIDATE + GENERATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","generate")

Write-Host ""
Write-Host "=== TARGETED WORKITEM TESTS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run","tests/unit/patient-work-item.test.ts")

Write-Host ""
Write-Host "=== TYPESCRIPT ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")

Write-Host ""
Write-Host "=== FULL UNIT TESTS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")

Write-Host ""
Write-Host "=== PROJECT AUDIT ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")

Write-Host ""
Write-Host "=== PRODUCTION BUILD CHECK (NO RESTART) ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")

Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

$login=Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/login" -TimeoutSec 20
if ($login.StatusCode -ne 200 -or $login.Content -notmatch '<form') { throw "Running app login smoke failed." }
Write-Host "Running app login smoke: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$audit=Join-Path $auditDir "15-PHASE3-PATIENT-WORKITEM-SERVICE.md"
$report=@"
# Phase 3 - PatientWorkItem Service

Status: PASS

Prerequisite:
- Phase 3 PatientWorkItem Foundation: PASS

Service added:
- createPatientWorkItem
- assignPatientWorkItem
- claimPatientWorkItem
- acceptPatientWorkItem
- startPatientWorkItem
- completePatientWorkItem
- reassignPatientWorkItem

Rules:
- WorkItem targets at most one direct User or Unit at a time.
- Unit claim requires active UserUnitMembership.
- Claim uses an atomic update guard so only one user can claim the unit item.
- Accept/Start/Complete require the actual assigned user UUID.
- Terminal COMPLETED/CANCELLED items cannot be reassigned by the service.
- Claim, assign, reassign, accept, start and complete are written to AuditLog inside the same database transaction as the WorkItem change.
- No Role-based ownership is introduced.

Safety:
- No database migration in this step.
- No CareStage or PATHWAY_DEFAULT removal.
- No running app restart.
- Source rollback snapshot created.

Verification:
- Source assertions: PASS
- Prisma validate/generate: PASS
- Targeted WorkItem tests: PASS
- TypeScript: PASS
- Full Vitest: PASS
- Project audit: PASS
- Production build check: PASS
- Prisma migration status: PASS
- Running app login smoke: PASS

Rollback snapshot: $rollbackDir

Next:
Inventory and migrate open CareStage records into PatientWorkItem using explicit mapping, without deleting CareStage yet.
"@
[System.IO.File]::WriteAllText($audit,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 3 PATIENT WORK ITEM SERVICE: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
