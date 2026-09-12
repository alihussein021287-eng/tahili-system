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
    $text = Get-Content -LiteralPath $path -Raw
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
    return $path
}

function Add-LineAfterField {
    param([string]$SchemaText,[string]$ModelName,[string]$AfterField,[string]$NewField,[string]$NewLine)
    $pattern = "(?ms)(model\s+$([regex]::Escape($ModelName))\s*\{.*?^\})"
    $match = [regex]::Match($SchemaText, $pattern)
    if (-not $match.Success) { throw "Model not found: $ModelName" }
    $block = $match.Groups[1].Value
    if ($block -match "(?m)^\s*$([regex]::Escape($NewField))\s+") { return $SchemaText }
    $lines = $block -split "`r?`n"
    $out = New-Object System.Collections.Generic.List[string]
    $inserted = $false
    foreach ($line in $lines) {
        $out.Add($line)
        if (-not $inserted -and $line -match "^\s*$([regex]::Escape($AfterField))\s+") {
            $out.Add($NewLine)
            $inserted = $true
        }
    }
    if (-not $inserted) { throw "Field $AfterField not found in $ModelName" }
    $newBlock = $out -join "`n"
    return $SchemaText.Substring(0,$match.Index) + $newBlock + $SchemaText.Substring($match.Index + $match.Length)
}

Write-Host ""
Write-Host "=== PHASE 2 STAFF + UNIT FOUNDATION ==="
Write-Host "Project: $Project"

$phase0 = Test-PassReport "_PHASE01_AUDIT\05-PHASE0-LOCAL-CLONE-BACKUP.md" "Phase 0"
$wave1  = Test-PassReport "_PHASE01_AUDIT\06-PHASE1-GUID-FOUNDATION-WAVE1.md" "Phase 1 Wave 1"
$batch1 = Test-PassReport "_PHASE01_AUDIT\07-PHASE1-GUID-SHADOW-FK-BATCH1.md" "Phase 1 Batch 1"
$batch2 = Test-PassReport "_PHASE01_AUDIT\08-PHASE1-GUID-SHADOW-FK-BATCH2.md" "Phase 1 Batch 2"
$batch3 = Test-PassReport "_PHASE01_AUDIT\09-PHASE1-GUID-SHADOW-FK-BATCH3.md" "Phase 1 Batch 3"
Write-Host "Phase 0: PASS"
Write-Host "Phase 1 foundation + Batch 1-3: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$envMap = @{}
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

$foundationSql=@'
SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND column_name='guid' AND data_type='uuid'
AND table_name IN ('users','patients','branches','centers','referral_requests');
'@
if ([int](Invoke-PsqlText $foundationSql) -ne 5) { throw "Foundation GUIDs missing." }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase2-staff-unit" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force

$legacyCountsSql=@'
SELECT 'employees', count(*) FROM "Employee"
UNION ALL SELECT 'users', count(*) FROM "users"
UNION ALL SELECT 'attendance', count(*) FROM "Attendance"
UNION ALL SELECT 'shifts', count(*) FROM "Shift"
UNION ALL SELECT 'leaves', count(*) FROM "Leave"
ORDER BY 1;
'@
$legacyCountsBefore=Invoke-PsqlText $legacyCountsSql
$legacyCountsBefore | Set-Content -LiteralPath (Join-Path $rollbackDir "legacy-row-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=Get-Content -LiteralPath $schemaPath -Raw

if ($schema -notmatch '(?m)^model\s+Unit\s*\{') {
    $schema += @'

// =====================================================================
// Phase 2 - Staff and Unit foundation
// New identities are real PostgreSQL UUIDs from day one.
// =====================================================================

model Unit {
  id              String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name            String               @unique
  kind            String?
  active          Boolean              @default(true)
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt
  staffMembers    StaffMember[]        @relation("StaffPrimaryUnit")
  userMemberships UserUnitMembership[]

  @@index([active])
  @@map("units")
}

model StaffMember {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  legacyEmployeeId Int?      @unique
  userId           String?   @unique @db.Uuid
  user             User?     @relation("StaffMemberUser", fields: [userId], references: [guid], onDelete: SetNull)
  fullName         String
  jobTitle         String?
  primaryUnitId    String?   @db.Uuid
  primaryUnit      Unit?     @relation("StaffPrimaryUnit", fields: [primaryUnitId], references: [id], onDelete: SetNull)
  active           Boolean   @default(true)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([primaryUnitId])
  @@index([active])
  @@map("staff_members")
}

model UserUnitMembership {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @db.Uuid
  user      User     @relation("UserUnitMembershipUser", fields: [userId], references: [guid], onDelete: Restrict)
  unitId    String   @db.Uuid
  unit      Unit     @relation(fields: [unitId], references: [id], onDelete: Restrict)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, unitId])
  @@index([unitId, active])
  @@index([userId, active])
  @@map("user_unit_memberships")
}
'@
}

$schema=Add-LineAfterField $schema "User" "filePatientLinks" "staffMember" '  staffMember                  StaffMember?                 @relation("StaffMemberUser")'
$schema=Add-LineAfterField $schema "User" "staffMember" "unitMemberships" '  unitMemberships              UserUnitMembership[]         @relation("UserUnitMembershipUser")'
[System.IO.File]::WriteAllText($schemaPath,$schema,(New-Object System.Text.UTF8Encoding($false)))

$migrationDir=Join-Path $Project "prisma\migrations\20260913032000_phase2_staff_unit_foundation"
$migrationFile=Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
$migrationSql=@'
-- Phase 2 Staff + Unit foundation
-- Additive only. Existing Employee/Attendance/Shift/Leave tables remain untouched.

CREATE TABLE IF NOT EXISTS "units" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "kind" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "units_name_key" ON "units"("name");
CREATE INDEX IF NOT EXISTS "units_active_idx" ON "units"("active");

CREATE TABLE IF NOT EXISTS "staff_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "legacyEmployeeId" INTEGER,
  "userId" UUID,
  "fullName" TEXT NOT NULL,
  "jobTitle" TEXT,
  "primaryUnitId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "staff_members_legacyEmployeeId_key" ON "staff_members"("legacyEmployeeId");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_members_userId_key" ON "staff_members"("userId");
CREATE INDEX IF NOT EXISTS "staff_members_primaryUnitId_idx" ON "staff_members"("primaryUnitId");
CREATE INDEX IF NOT EXISTS "staff_members_active_idx" ON "staff_members"("active");

CREATE TABLE IF NOT EXISTS "user_unit_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "unitId" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_unit_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_unit_memberships_userId_unitId_key" ON "user_unit_memberships"("userId","unitId");
CREATE INDEX IF NOT EXISTS "user_unit_memberships_unitId_active_idx" ON "user_unit_memberships"("unitId","active");
CREATE INDEX IF NOT EXISTS "user_unit_memberships_userId_active_idx" ON "user_unit_memberships"("userId","active");

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_members_userId_fkey') THEN
   ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_members_primaryUnitId_fkey') THEN
   ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_primaryUnitId_fkey" FOREIGN KEY ("primaryUnitId") REFERENCES "units"("id") ON DELETE SET NULL NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_unit_memberships_userId_fkey') THEN
   ALTER TABLE "user_unit_memberships" ADD CONSTRAINT "user_unit_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("guid") ON DELETE RESTRICT NOT VALID;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_unit_memberships_unitId_fkey') THEN
   ALTER TABLE "user_unit_memberships" ADD CONSTRAINT "user_unit_memberships_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT NOT VALID;
 END IF;
END $$;

-- Seed Units only from explicit existing user departments. This is one-time migration data,
-- not a runtime name-based relationship.
INSERT INTO "units" ("name","kind","active","updatedAt")
SELECT DISTINCT btrim(u."department"), 'DEPARTMENT', true, CURRENT_TIMESTAMP
FROM "users" u
WHERE NULLIF(btrim(u."department"),'') IS NOT NULL
ON CONFLICT ("name") DO NOTHING;

-- Every legacy Employee gets a stable StaffMember UUID mapping.
INSERT INTO "staff_members" ("legacyEmployeeId","fullName","jobTitle","active","updatedAt")
SELECT e."id", e."name", e."job", true, CURRENT_TIMESTAMP
FROM "Employee" e
ON CONFLICT ("legacyEmployeeId") DO UPDATE
SET "fullName"=EXCLUDED."fullName", "jobTitle"=EXCLUDED."jobTitle", "updatedAt"=CURRENT_TIMESTAMP;

-- Link Employee-backed staff to a login only when the normalized full name is unique
-- on both sides. Ambiguous names are deliberately left unlinked for manual review.
WITH employee_unique AS (
  SELECT lower(btrim("name")) AS k, min("id") AS employee_id
  FROM "Employee"
  WHERE NULLIF(btrim("name"),'') IS NOT NULL
  GROUP BY lower(btrim("name"))
  HAVING count(*)=1
), user_unique AS (
  SELECT lower(btrim("fullName")) AS k, min("guid") AS user_guid
  FROM "users"
  WHERE NULLIF(btrim("fullName"),'') IS NOT NULL
  GROUP BY lower(btrim("fullName"))
  HAVING count(*)=1
)
UPDATE "staff_members" s
SET "userId"=uu.user_guid,
    "fullName"=u."fullName",
    "jobTitle"=COALESCE(u."jobTitle",s."jobTitle"),
    "active"=u."isActive",
    "updatedAt"=CURRENT_TIMESTAMP
FROM employee_unique eu
JOIN user_unique uu ON uu.k=eu.k
JOIN "users" u ON u."guid"=uu.user_guid
WHERE s."legacyEmployeeId"=eu.employee_id
  AND (s."userId" IS NULL OR s."userId"=uu.user_guid)
  AND NOT EXISTS (
    SELECT 1 FROM "staff_members" x WHERE x."userId"=uu.user_guid AND x."id"<>s."id"
  );

-- Every login gets exactly one StaffMember, even if it had no legacy Employee row.
INSERT INTO "staff_members" ("userId","fullName","jobTitle","active","updatedAt")
SELECT u."guid", u."fullName", u."jobTitle", u."isActive", CURRENT_TIMESTAMP
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "staff_members" s WHERE s."userId"=u."guid");

-- Set the primary unit from the user's existing department only for linked StaffMembers.
UPDATE "staff_members" s
SET "primaryUnitId"=un."id", "updatedAt"=CURRENT_TIMESTAMP
FROM "users" u
JOIN "units" un ON lower(btrim(un."name"))=lower(btrim(u."department"))
WHERE s."userId"=u."guid"
  AND NULLIF(btrim(u."department"),'') IS NOT NULL
  AND s."primaryUnitId" IS DISTINCT FROM un."id";

-- Membership is keyed by UUID user identity + UUID unit identity.
INSERT INTO "user_unit_memberships" ("userId","unitId","active","updatedAt")
SELECT u."guid", un."id", u."isActive", CURRENT_TIMESTAMP
FROM "users" u
JOIN "units" un ON lower(btrim(un."name"))=lower(btrim(u."department"))
WHERE NULLIF(btrim(u."department"),'') IS NOT NULL
ON CONFLICT ("userId","unitId") DO UPDATE
SET "active"=EXCLUDED."active", "updatedAt"=CURRENT_TIMESTAMP;

ALTER TABLE "staff_members" VALIDATE CONSTRAINT "staff_members_userId_fkey";
ALTER TABLE "staff_members" VALIDATE CONSTRAINT "staff_members_primaryUnitId_fkey";
ALTER TABLE "user_unit_memberships" VALIDATE CONSTRAINT "user_unit_memberships_userId_fkey";
ALTER TABLE "user_unit_memberships" VALIDATE CONSTRAINT "user_unit_memberships_unitId_fkey";
'@

if (Test-Path -LiteralPath $migrationFile) {
    $existing=Get-Content -LiteralPath $migrationFile -Raw
    if ($existing.Trim() -ne $migrationSql.Trim()) { throw "Existing Phase 2 migration differs from expected content." }
} else {
    [System.IO.File]::WriteAllText($migrationFile,$migrationSql,(New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "Schema and migration prepared."
Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")
Write-Host ""
Write-Host "=== PRISMA VALIDATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
Write-Host ""
Write-Host "=== MIGRATE DEPLOY ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","deploy")

$verifySql=@'
SELECT 'employee_mappings' || '|' || (SELECT count(*) FROM "Employee") || '|' || (SELECT count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL)
UNION ALL
SELECT 'user_staff' || '|' || (SELECT count(*) FROM "users") || '|' || (SELECT count(*) FROM "staff_members" WHERE "userId" IS NOT NULL)
UNION ALL
SELECT 'department_units' || '|' || (SELECT count(DISTINCT lower(btrim("department"))) FROM "users" WHERE NULLIF(btrim("department"),'') IS NOT NULL) || '|' || (SELECT count(*) FROM "units" WHERE "kind"='DEPARTMENT')
UNION ALL
SELECT 'department_memberships' || '|' || (SELECT count(*) FROM "users" WHERE NULLIF(btrim("department"),'') IS NOT NULL) || '|' || (SELECT count(*) FROM "user_unit_memberships")
ORDER BY 1;
'@
$verify=Invoke-PsqlText $verifySql
foreach ($line in ($verify -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 3 -or [int64]$p[1] -ne [int64]$p[2]) { throw "Phase 2 mapping verification failed: $line" }
}

$orphanSql=@'
SELECT 'staff.user' AS k, count(*) FROM "staff_members" s LEFT JOIN "users" u ON u."guid"=s."userId" WHERE s."userId" IS NOT NULL AND u."guid" IS NULL
UNION ALL SELECT 'staff.primaryUnit', count(*) FROM "staff_members" s LEFT JOIN "units" un ON un."id"=s."primaryUnitId" WHERE s."primaryUnitId" IS NOT NULL AND un."id" IS NULL
UNION ALL SELECT 'membership.user', count(*) FROM "user_unit_memberships" m LEFT JOIN "users" u ON u."guid"=m."userId" WHERE u."guid" IS NULL
UNION ALL SELECT 'membership.unit', count(*) FROM "user_unit_memberships" m LEFT JOIN "units" un ON un."id"=m."unitId" WHERE un."id" IS NULL
ORDER BY 1;
'@
$orphans=Invoke-PsqlText $orphanSql
foreach ($line in ($orphans -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2 -or [int64]$p[1] -ne 0) { throw "Phase 2 orphan verification failed: $line" }
}

$constraintSql=@'
SELECT count(*) FROM pg_constraint WHERE conname IN (
'staff_members_userId_fkey','staff_members_primaryUnitId_fkey','user_unit_memberships_userId_fkey','user_unit_memberships_unitId_fkey'
) AND convalidated;
'@
if ([int](Invoke-PsqlText $constraintSql) -ne 4) { throw "Expected 4 validated Phase 2 FKs." }

$legacyCountsAfter=Invoke-PsqlText $legacyCountsSql
if ($legacyCountsAfter.Trim() -ne $legacyCountsBefore.Trim()) { throw "Legacy row counts changed unexpectedly during Phase 2 foundation.`nBefore:`n$legacyCountsBefore`nAfter:`n$legacyCountsAfter" }

$ambiguousSql=@'
WITH employee_names AS (
 SELECT lower(btrim("name")) k, count(*) c FROM "Employee" WHERE NULLIF(btrim("name"),'') IS NOT NULL GROUP BY lower(btrim("name"))
), user_names AS (
 SELECT lower(btrim("fullName")) k, count(*) c FROM "users" WHERE NULLIF(btrim("fullName"),'') IS NOT NULL GROUP BY lower(btrim("fullName"))
)
SELECT count(*) FROM (
 SELECT k FROM employee_names WHERE c>1
 UNION
 SELECT k FROM user_names WHERE c>1
) x;
'@
$ambiguousNames=[int](Invoke-PsqlText $ambiguousSql)
Write-Host "Phase 2 database mapping/orphan/FK verification: PASS"
Write-Host "Ambiguous normalized names left unlinked automatically: $ambiguousNames"

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
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

$login=Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/login" -TimeoutSec 20
if ($login.StatusCode -ne 200 -or $login.Content -notmatch '<form') { throw "Login page smoke failed." }
Write-Host "Login page smoke: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$audit=Join-Path $auditDir "10-PHASE2-STAFF-UNIT-FOUNDATION.md"
$report=@"
# Phase 2 - Staff + Unit Foundation

Status: PASS

Gates:
- Phase 0 backup/restore: PASS
- Phase 1 GUID foundation Wave 1: PASS
- Phase 1 Shadow FK Batch 1: PASS
- Phase 1 Shadow FK Batch 2: PASS
- Phase 1 Shadow FK Batch 3: PASS

New UUID models:
- Unit
- StaffMember
- UserUnitMembership

Migration behavior:
- Unit rows seeded only from explicit existing User.department values.
- Every legacy Employee has a StaffMember UUID mapping via legacyEmployeeId.
- Every User has exactly one StaffMember linked by users.guid -> staff_members.userId.
- Exact unique Employee/User names may be linked during one-time migration only.
- Ambiguous names are not auto-linked.
- User department membership is migrated to UUID UserUnitMembership.
- StaffMember.primaryUnitId is populated from the same explicit department mapping.

Safety:
- Existing Employee, Attendance, Shift and Leave tables are untouched in this batch.
- No runtime name-based relationship introduced.
- No existing PK/FK removed.
- 4 new real UUID FK constraints validated.
- Legacy row counts unchanged.
- No prisma db push.

Verification mappings (label|expected|actual):
$verify

Orphan checks:
$orphans

Ambiguous normalized names requiring no automatic link: $ambiguousNames

Verification:
- Prisma validate: PASS
- Prisma migrate deploy: PASS
- Mapping counts: PASS
- Zero UUID FK orphans: PASS
- TypeScript: PASS
- Full Vitest: PASS
- Project audit: PASS
- Prisma migration status: PASS
- Login smoke: PASS

Rollback snapshot: $rollbackDir

Next:
Phase 2 attendance/shift/leave migration to StaffMember UUID IDs, preserving legacy name fields until verified cleanup.
"@
$report | Set-Content -LiteralPath $audit -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 2 STAFF + UNIT FOUNDATION: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
