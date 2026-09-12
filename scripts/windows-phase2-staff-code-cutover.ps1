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
    $text = Get-Content -LiteralPath $path -Raw
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
    return $path
}

function Replace-Exact {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Old,
        [Parameter(Mandatory = $true)][string]$New,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if ($Text.Contains($New)) { return $Text }
    if (-not $Text.Contains($Old)) { throw "Expected source block not found for $Label. Stop for review." }
    return $Text.Replace($Old, $New)
}

Write-Host ""
Write-Host "=== PHASE 2 STAFF CODE CUTOVER ==="
Write-Host "Project: $Project"

$foundation = Test-PassReport "_PHASE01_AUDIT\10-PHASE2-STAFF-UNIT-FOUNDATION.md" "Phase 2 Staff + Unit Foundation"
$ops = Test-PassReport "_PHASE01_AUDIT\11-PHASE2-STAFF-OPERATIONAL-IDS.md" "Phase 2 Staff Operational IDs"
Write-Host "Phase 2 foundation: PASS"
Write-Host "Phase 2 operational IDs: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }

$files = @(
    "src\app\(app)\attendance\actions.ts",
    "src\app\(app)\shifts\actions.ts",
    "src\app\(app)\staff\page.tsx",
    "prisma\schema.prisma"
)
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$schema = Get-Content -LiteralPath "prisma\schema.prisma" -Raw
foreach ($needle in @("model StaffMember", "staffMemberId String?", "AttendanceStaffMember", "ShiftStaffMember", "LeaveStaffMember")) {
    if ($schema -notmatch [regex]::Escape($needle)) { throw "Local Prisma schema is missing required Phase 2 field/relation: $needle" }
}

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase2-staff-code-cutover" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "src\app\(app)\attendance\actions.ts" -Destination (Join-Path $rollbackDir "attendance-actions.ts.before") -Force
Copy-Item -LiteralPath "src\app\(app)\shifts\actions.ts" -Destination (Join-Path $rollbackDir "shifts-actions.ts.before") -Force
Copy-Item -LiteralPath "src\app\(app)\staff\page.tsx" -Destination (Join-Path $rollbackDir "staff-page.tsx.before") -Force
Write-Host "Rollback snapshot: $rollbackDir"

# ---------------------------------------------------------------------
# Attendance action: the UI sends StaffMember UUID. The legacy name field
# remains a display snapshot only. A unique-name fallback is retained for
# stale forms during the transition, but every successful new write stores
# staffMemberId.
# ---------------------------------------------------------------------
$attendancePath = "src\app\(app)\attendance\actions.ts"
$attendance = Get-Content -LiteralPath $attendancePath -Raw

$attendanceHelperOld = @'
import { redirect } from "next/navigation";

export async function checkIn(fd: FormData) {
'@
$attendanceHelperNew = @'
import { redirect } from "next/navigation";

async function resolveStaffMember(fd: FormData) {
  const staffMemberId = fd.get("staffMemberId")?.toString().trim();
  if (staffMemberId) {
    return prisma.staffMember.findFirst({
      where: { id: staffMemberId, active: true },
      select: { id: true, fullName: true },
    });
  }

  // Transitional fallback for stale forms only. New UI submits UUID.
  const legacyName = fd.get("name")?.toString().trim();
  if (!legacyName) return null;
  const matches = await prisma.staffMember.findMany({
    where: { active: true, fullName: { equals: legacyName, mode: "insensitive" } },
    select: { id: true, fullName: true },
    take: 2,
  });
  return matches.length === 1 ? matches[0] : null;
}

export async function checkIn(fd: FormData) {
'@
$attendance = Replace-Exact $attendance $attendanceHelperOld $attendanceHelperNew "attendance staff resolver"

$attendanceCreateOld = @'
  const returnTo = fd.get("returnTo")?.toString();
  const name = fd.get("name")?.toString().trim();
  if (!name) {
    const target = returnTo === "staff" ? "/staff?tab=attendance" : "/attendance";
    redirect(`${target}${target.includes("?") ? "&" : "?"}saved=${encodeURIComponent("اختر الموظف")}`);
  }
  const created = await prisma.attendance.create({ data: { name: name!, checkIn: new Date() } });
  await logAudit({ action: "CREATE", tableName: "attendance", recordId: created.id });
'@
$attendanceCreateNew = @'
  const returnTo = fd.get("returnTo")?.toString();
  const staff = await resolveStaffMember(fd);
  if (!staff) {
    const target = returnTo === "staff" ? "/staff?tab=attendance" : "/attendance";
    redirect(`${target}${target.includes("?") ? "&" : "?"}saved=${encodeURIComponent("اختر موظفاً صالحاً")}`);
  }
  const created = await prisma.attendance.create({
    data: { staffMemberId: staff!.id, name: staff!.fullName, checkIn: new Date() },
  });
  await logAudit({ action: "CREATE", tableName: "attendance", recordId: created.id, newValue: { staffMemberId: staff!.id } });
'@
$attendance = Replace-Exact $attendance $attendanceCreateOld $attendanceCreateNew "attendance UUID create"
[System.IO.File]::WriteAllText((Join-Path $Project $attendancePath),$attendance,(New-Object System.Text.UTF8Encoding($false)))

# ---------------------------------------------------------------------
# Shift/Leave actions: same UUID-first rule, legacy name kept as snapshot.
# ---------------------------------------------------------------------
$shiftsPath = "src\app\(app)\shifts\actions.ts"
$shifts = Get-Content -LiteralPath $shiftsPath -Raw

$shiftHelperOld = @'
function savedPath(fd: FormData, tab: "shifts" | "leaves", message: string) {
  const target = fd.get("returnTo")?.toString() === "staff" ? `/staff?tab=${tab}` : "/shifts";
  return `${target}${target.includes("?") ? "&" : "?"}saved=${encodeURIComponent(message)}`;
}

export async function addShift(fd: FormData) {
'@
$shiftHelperNew = @'
function savedPath(fd: FormData, tab: "shifts" | "leaves", message: string) {
  const target = fd.get("returnTo")?.toString() === "staff" ? `/staff?tab=${tab}` : "/shifts";
  return `${target}${target.includes("?") ? "&" : "?"}saved=${encodeURIComponent(message)}`;
}

async function resolveStaffMember(fd: FormData) {
  const staffMemberId = fd.get("staffMemberId")?.toString().trim();
  if (staffMemberId) {
    return prisma.staffMember.findFirst({
      where: { id: staffMemberId, active: true },
      select: { id: true, fullName: true },
    });
  }

  // Transitional fallback for stale forms only. New UI submits UUID.
  const legacyName = fd.get("name")?.toString().trim();
  if (!legacyName) return null;
  const matches = await prisma.staffMember.findMany({
    where: { active: true, fullName: { equals: legacyName, mode: "insensitive" } },
    select: { id: true, fullName: true },
    take: 2,
  });
  return matches.length === 1 ? matches[0] : null;
}

export async function addShift(fd: FormData) {
'@
$shifts = Replace-Exact $shifts $shiftHelperOld $shiftHelperNew "shift staff resolver"

$addShiftOld = @'
  const name = fd.get("name")?.toString().trim();
  const date = dateOnly(fd.get("date")?.toString());
  if (!name || !date) redirect(savedPath(fd, "shifts", "أدخل الموظف والتاريخ"));
  const t = await prisma.shift.create({ data: {
    name: name!, date: date!,
    type: (fd.get("type")?.toString() as any) || "MORNING",
    startTime: fd.get("startTime")?.toString() || null,
    endTime: fd.get("endTime")?.toString() || null,
    notes: fd.get("notes")?.toString() || null,
  }});
  await logAudit({ action: "CREATE", tableName: "shifts", recordId: t.id });
'@
$addShiftNew = @'
  const staff = await resolveStaffMember(fd);
  const date = dateOnly(fd.get("date")?.toString());
  if (!staff || !date) redirect(savedPath(fd, "shifts", "اختر الموظف والتاريخ"));
  const t = await prisma.shift.create({ data: {
    staffMemberId: staff!.id,
    name: staff!.fullName,
    date: date!,
    type: (fd.get("type")?.toString() as any) || "MORNING",
    startTime: fd.get("startTime")?.toString() || null,
    endTime: fd.get("endTime")?.toString() || null,
    notes: fd.get("notes")?.toString() || null,
  }});
  await logAudit({ action: "CREATE", tableName: "shifts", recordId: t.id, newValue: { staffMemberId: staff!.id } });
'@
$shifts = Replace-Exact $shifts $addShiftOld $addShiftNew "shift UUID create"

$requestLeaveOld = @'
  const name = fd.get("name")?.toString().trim();
  const from = dateOnly(fd.get("fromDate")?.toString());
  const to = dateOnly(fd.get("toDate")?.toString());
  if (!name || !from || !to) redirect(savedPath(fd, "leaves", "أدخل الموظف وتاريخي الإجازة"));
  if (to! < from!) redirect(savedPath(fd, "leaves", "تاريخ النهاية قبل البداية"));
  const l = await prisma.leave.create({ data: {
    name: name!, fromDate: from!, toDate: to!,
    type: (fd.get("type")?.toString() as any) || "ANNUAL",
    reason: fd.get("reason")?.toString() || null,
  }});
  await logAudit({ action: "CREATE", tableName: "leaves", recordId: l.id });
'@
$requestLeaveNew = @'
  const staff = await resolveStaffMember(fd);
  const from = dateOnly(fd.get("fromDate")?.toString());
  const to = dateOnly(fd.get("toDate")?.toString());
  if (!staff || !from || !to) redirect(savedPath(fd, "leaves", "اختر الموظف وتاريخي الإجازة"));
  if (to! < from!) redirect(savedPath(fd, "leaves", "تاريخ النهاية قبل البداية"));
  const l = await prisma.leave.create({ data: {
    staffMemberId: staff!.id,
    name: staff!.fullName,
    fromDate: from!,
    toDate: to!,
    type: (fd.get("type")?.toString() as any) || "ANNUAL",
    reason: fd.get("reason")?.toString() || null,
  }});
  await logAudit({ action: "CREATE", tableName: "leaves", recordId: l.id, newValue: { staffMemberId: staff!.id } });
'@
$shifts = Replace-Exact $shifts $requestLeaveOld $requestLeaveNew "leave UUID create"
[System.IO.File]::WriteAllText((Join-Path $Project $shiftsPath),$shifts,(New-Object System.Text.UTF8Encoding($false)))

# ---------------------------------------------------------------------
# Staff UI: choices come from active StaffMember UUID identities.
# Existing legacy names stay only for display/filtering of historical rows.
# ---------------------------------------------------------------------
$staffPath = "src\app\(app)\staff\page.tsx"
$staff = Get-Content -LiteralPath $staffPath -Raw

$destructureOld = @'
    employeeRoster,
    attendanceRows,
'@
$destructureNew = @'
    employeeRoster,
    staffMembers,
    attendanceRows,
'@
$staff = Replace-Exact $staff $destructureOld $destructureNew "staff Promise destructuring"

$queryOld = @'
    canAttendance || canShifts ? prisma.employee.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    canAttendance ? prisma.attendance.findMany({ where: { date: { gte: attendanceDate, lt: attendanceEnd } }, orderBy: [{ checkOut: "asc" }, { checkIn: "desc" }] }) : Promise.resolve([]),
'@
$queryNew = @'
    canAttendance || canShifts ? prisma.employee.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    canAttendance || canShifts ? prisma.staffMember.findMany({ where: { active: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" }, take: 500 }) : Promise.resolve([]),
    canAttendance ? prisma.attendance.findMany({ where: { date: { gte: attendanceDate, lt: attendanceEnd } }, orderBy: [{ checkOut: "asc" }, { checkIn: "desc" }] }) : Promise.resolve([]),
'@
$staff = Replace-Exact $staff $queryOld $queryNew "staff member UUID query"

$optionsOld = @'
  const employeeNames = Array.from(new Set([...employeeRoster.map((item: any) => item.name), ...allUsers.map((user: any) => user.fullName)].filter(Boolean))).sort();
  const presentNames = new Set(todayAttendance.map((row: any) => row.name));
'@
$optionsNew = @'
  const employeeNames = Array.from(new Set([...employeeRoster.map((item: any) => item.name), ...staffMembers.map((item: any) => item.fullName), ...allUsers.map((user: any) => user.fullName)].filter(Boolean))).sort();
  const staffMemberOptions = staffMembers.map((item: any) => ({ value: item.id, label: item.fullName }));
  const presentNames = new Set(todayAttendance.map((row: any) => row.name));
'@
$staff = Replace-Exact $staff $optionsOld $optionsNew "staff UUID options"

$attendanceFormOld = '<Combobox name="name" label="الموظف" required placeholder="اختر الموظف" options={employeeNames} />'
$attendanceFormNew = '<Combobox name="staffMemberId" label="الموظف" required placeholder="اختر الموظف" options={staffMemberOptions} />'
$staff = Replace-Exact $staff $attendanceFormOld $attendanceFormNew "attendance staffMemberId form"

$shiftFormOld = '<Combobox name="name" label="الموظف" allowFree options={employeeNames} required />'
$shiftFormNew = '<Combobox name="staffMemberId" label="الموظف" allowFree={false} options={staffMemberOptions} required />'
# The old line appears in both Shift and Leave forms. Replace both occurrences intentionally.
if (-not $staff.Contains($shiftFormNew)) {
    $occurrences = ([regex]::Matches($staff, [regex]::Escape($shiftFormOld))).Count
    if ($occurrences -ne 2) { throw "Expected two legacy staff name forms, found $occurrences. Stop for review." }
    $staff = $staff.Replace($shiftFormOld,$shiftFormNew)
}

$staff = $staff.Replace('description="إضافة مناوبة مرتبطة باسم موظف وتاريخ فقط، حسب النموذج الحالي."','description="إضافة مناوبة مرتبطة بهوية الموظف الفعلية مع الاحتفاظ بالاسم كسجل عرض."')
$staff = $staff.Replace('description="التسجيل يستخدم قائمة الموظفين الحالية ولا يغير بيانات الحسابات."','description="التسجيل يعتمد هوية StaffMember الفعلية، والاسم محفوظ للعرض فقط."')
$staff = $staff.Replace('description="يسجل الطلب في جدول الإجازات الحالي، ثم ينتظر القبول إذا لزم."','description="يسجل الطلب على هوية StaffMember الفعلية، ثم ينتظر القبول إذا لزم."')

[System.IO.File]::WriteAllText((Join-Path $Project $staffPath),$staff,(New-Object System.Text.UTF8Encoding($false)))

# Source-level assertions before expensive checks.
$attendanceNow = Get-Content -LiteralPath $attendancePath -Raw
$shiftsNow = Get-Content -LiteralPath $shiftsPath -Raw
$staffNow = Get-Content -LiteralPath $staffPath -Raw
if ($attendanceNow -notmatch 'staffMemberId:\s*staff!\.id') { throw "Attendance source is not UUID-first." }
if (($shiftsNow | Select-String -Pattern 'staffMemberId:\s*staff!\.id' -AllMatches).Matches.Count -lt 2) { throw "Shift/Leave source is not UUID-first." }
if (([regex]::Matches($staffNow,'name="staffMemberId"')).Count -ne 3) { throw "Expected three staffMemberId UI controls." }
if ($staffNow -notmatch 'prisma\.staffMember\.findMany') { throw "Staff page is not sourcing StaffMember UUID choices." }
Write-Host "Source UUID cutover assertions: PASS"

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
$audit=Join-Path $auditDir "12-PHASE2-STAFF-CODE-CUTOVER.md"
$report=@"
# Phase 2 - Staff Operational Code Cutover

Status: PASS

Prerequisites:
- Phase 2 Staff + Unit Foundation: PASS
- Phase 2 Staff Operational IDs: PASS

Source cutover:
- Attendance create now resolves a StaffMember and always stores staffMemberId UUID.
- Shift create now resolves a StaffMember and always stores staffMemberId UUID.
- Leave create now resolves a StaffMember and always stores staffMemberId UUID.
- Legacy name is retained only as a display/audit snapshot.
- Staff UI submits StaffMember UUID values rather than free-text employee names.
- A unique-name fallback remains temporarily for stale forms during transition; successful writes still persist the UUID.

Safety:
- No database migration in this step.
- No legacy name field removed.
- No application container restart performed.
- Running local app remained reachable.
- Rollback source snapshot exists.

Verification:
- Source UUID assertions: PASS
- Prisma validate: PASS
- Prisma generate: PASS
- TypeScript: PASS
- Full Vitest: PASS
- Project audit: PASS
- Production build check: PASS
- Prisma migration status: PASS
- Running app login smoke: PASS

Rollback snapshot: $rollbackDir

Next:
Phase 2 verification/manual-resolution gate for historical Attendance/Shift/Leave rows that remain unlinked, then Phase 3 PatientWorkItem foundation.
"@
$report | Set-Content -LiteralPath $audit -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 2 STAFF CODE CUTOVER: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
