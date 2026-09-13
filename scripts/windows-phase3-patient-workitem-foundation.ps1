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

function Add-ModelLineBeforeClose {
    param([string]$SchemaText,[string]$ModelName,[string]$Needle,[string]$NewLine)
    $pattern = "(?ms)(model\s+$([regex]::Escape($ModelName))\s*\{.*?^\})"
    $match = [regex]::Match($SchemaText, $pattern)
    if (-not $match.Success) { throw "Model not found: $ModelName" }
    $block = $match.Groups[1].Value
    if ($block -match "(?m)^\s*$([regex]::Escape($Needle))\s+") { return $SchemaText }
    $close = $block.LastIndexOf("}")
    if ($close -lt 0) { throw "Model close not found: $ModelName" }
    $newBlock = $block.Substring(0,$close).TrimEnd() + "`n" + $NewLine + "`n}"
    return $SchemaText.Substring(0,$match.Index) + $newBlock + $SchemaText.Substring($match.Index + $match.Length)
}

Write-Host ""
Write-Host "=== PHASE 3 PATIENT WORK ITEM FOUNDATION ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\05-PHASE0-LOCAL-CLONE-BACKUP.md" "Phase 0" | Out-Null
Test-PassReport "_PHASE01_AUDIT\06-PHASE1-GUID-FOUNDATION-WAVE1.md" "Phase 1 Wave 1" | Out-Null
Test-PassReport "_PHASE01_AUDIT\10-PHASE2-STAFF-UNIT-FOUNDATION.md" "Phase 2 Staff + Unit" | Out-Null
Test-PassReport "_PHASE01_AUDIT\11-PHASE2-STAFF-OPERATIONAL-IDS.md" "Phase 2 Staff IDs" | Out-Null
Test-PassReport "_PHASE01_AUDIT\12-PHASE2-STAFF-CODE-CUTOVER.md" "Phase 2 Staff Code Cutover" | Out-Null
Test-PassReport "_PHASE01_AUDIT\13-PHASE2-STAFF-HISTORICAL-GATE.md" "Phase 2 Historical Gate" | Out-Null
Write-Host "Prerequisite reports: PASS"

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
SELECT CASE WHEN
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','patients','referral_requests') AND column_name='guid' AND data_type='uuid')=3
  AND to_regclass('public.units') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $foundationSql).Trim() -ne "PASS") { throw "Required UUID foundations are missing." }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase3-patient-workitem" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force

$coreCountsSql=@'
SELECT 'patients', count(*) FROM "patients"
UNION ALL SELECT 'users', count(*) FROM "users"
UNION ALL SELECT 'referral_requests', count(*) FROM "referral_requests"
UNION ALL SELECT 'units', count(*) FROM "units"
UNION ALL SELECT 'staff_members', count(*) FROM "staff_members"
ORDER BY 1;
'@
$coreCountsBefore=Invoke-PsqlText $coreCountsSql
$coreCountsBefore | Set-Content -LiteralPath (Join-Path $rollbackDir "core-row-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=[System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8)

foreach ($requiredModel in @("Patient","User","Unit","ReferralRequest")) {
    if ($schema -notmatch "(?m)^model\s+$requiredModel\s*\{") { throw "Required model missing from local schema: $requiredModel" }
}

if ($schema -notmatch '(?m)^enum\s+PatientWorkItemStatus\s*\{') {
    $schema += @'

enum PatientWorkItemStatus {
  OPEN
  ASSIGNED
  ACCEPTED
  PROGRESS_IN
  COMPLETED
  BLOCKED
  CANCELLED
}
'@
}

if ($schema -notmatch '(?m)^model\s+PatientWorkItem\s*\{') {
    $schema += @'

model PatientWorkItem {
  id                String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  patientId         String                @db.Uuid
  patient           Patient               @relation("PatientWorkItemPatient", fields: [patientId], references: [guid], onDelete: Restrict)
  kind              String
  status            PatientWorkItemStatus @default(OPEN)
  assignedUnitId    String?               @db.Uuid
  assignedUnit      Unit?                 @relation("WorkItemAssignedUnit", fields: [assignedUnitId], references: [id], onDelete: SetNull)
  assignedUserId    String?               @db.Uuid
  assignedUser      User?                 @relation("WorkItemAssignedUser", fields: [assignedUserId], references: [guid], onDelete: SetNull)
  createdById       String                @db.Uuid
  createdBy         User                  @relation("WorkItemCreatedBy", fields: [createdById], references: [guid], onDelete: Restrict)
  referralRequestId String?               @db.Uuid
  referralRequest   ReferralRequest?      @relation("WorkItemReferral", fields: [referralRequestId], references: [guid], onDelete: Restrict)
  parentWorkItemId  String?               @db.Uuid
  parentWorkItem    PatientWorkItem?      @relation("WorkItemParent", fields: [parentWorkItemId], references: [id], onDelete: SetNull)
  childWorkItems    PatientWorkItem[]     @relation("WorkItemParent")
  note              String?
  cancellationReason String?
  acceptedAt        DateTime?
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt

  @@index([patientId, status])
  @@index([assignedUserId, status])
  @@index([assignedUnitId, status])
  @@index([referralRequestId])
  @@index([parentWorkItemId])
  @@index([createdAt])
  @@map("patient_work_items")
}
'@
}

$schema=Add-ModelLineBeforeClose $schema "Patient" "workItems" '  workItems PatientWorkItem[] @relation("PatientWorkItemPatient")'
$schema=Add-ModelLineBeforeClose $schema "User" "assignedWorkItems" '  assignedWorkItems PatientWorkItem[] @relation("WorkItemAssignedUser")'
$schema=Add-ModelLineBeforeClose $schema "User" "createdWorkItems" '  createdWorkItems PatientWorkItem[] @relation("WorkItemCreatedBy")'
$schema=Add-ModelLineBeforeClose $schema "Unit" "assignedWorkItems" '  assignedWorkItems PatientWorkItem[] @relation("WorkItemAssignedUnit")'
$schema=Add-ModelLineBeforeClose $schema "ReferralRequest" "workItems" '  workItems PatientWorkItem[] @relation("WorkItemReferral")'

[System.IO.File]::WriteAllText($schemaPath,$schema,(New-Object System.Text.UTF8Encoding($false)))

$migrationDir=Join-Path $Project "prisma\migrations\20260913043000_phase3_patient_workitem_foundation"
$migrationFile=Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
$migrationSql=@'
-- Phase 3 - PatientWorkItem foundation
-- Additive only. CareStage/PATHWAY_DEFAULT remain untouched in this step.

DO $$ BEGIN
  CREATE TYPE "PatientWorkItemStatus" AS ENUM ('OPEN','ASSIGNED','ACCEPTED','PROGRESS_IN','COMPLETED','BLOCKED','CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "patient_work_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "patientId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" "PatientWorkItemStatus" NOT NULL DEFAULT 'OPEN',
  "assignedUnitId" UUID,
  "assignedUserId" UUID,
  "createdById" UUID NOT NULL,
  "referralRequestId" UUID,
  "parentWorkItemId" UUID,
  "note" TEXT,
  "cancellationReason" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patient_work_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "patient_work_items_patientId_status_idx" ON "patient_work_items"("patientId","status");
CREATE INDEX IF NOT EXISTS "patient_work_items_assignedUserId_status_idx" ON "patient_work_items"("assignedUserId","status");
CREATE INDEX IF NOT EXISTS "patient_work_items_assignedUnitId_status_idx" ON "patient_work_items"("assignedUnitId","status");
CREATE INDEX IF NOT EXISTS "patient_work_items_referralRequestId_idx" ON "patient_work_items"("referralRequestId");
CREATE INDEX IF NOT EXISTS "patient_work_items_parentWorkItemId_idx" ON "patient_work_items"("parentWorkItemId");
CREATE INDEX IF NOT EXISTS "patient_work_items_createdAt_idx" ON "patient_work_items"("createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_work_items_patientId_fkey') THEN
    ALTER TABLE "patient_work_items" ADD CONSTRAINT "patient_work_items_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("guid") ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_work_items_assignedUnitId_fkey') THEN
    ALTER TABLE "patient_work_items" ADD CONSTRAINT "patient_work_items_assignedUnitId_fkey" FOREIGN KEY ("assignedUnitId") REFERENCES "units"("id") ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_work_items_assignedUserId_fkey') THEN
    ALTER TABLE "patient_work_items" ADD CONSTRAINT "patient_work_items_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_work_items_createdById_fkey') THEN
    ALTER TABLE "patient_work_items" ADD CONSTRAINT "patient_work_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("guid") ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_work_items_referralRequestId_fkey') THEN
    ALTER TABLE "patient_work_items" ADD CONSTRAINT "patient_work_items_referralRequestId_fkey" FOREIGN KEY ("referralRequestId") REFERENCES "referral_requests"("guid") ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_work_items_parentWorkItemId_fkey') THEN
    ALTER TABLE "patient_work_items" ADD CONSTRAINT "patient_work_items_parentWorkItemId_fkey" FOREIGN KEY ("parentWorkItemId") REFERENCES "patient_work_items"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

ALTER TABLE "patient_work_items" VALIDATE CONSTRAINT "patient_work_items_patientId_fkey";
ALTER TABLE "patient_work_items" VALIDATE CONSTRAINT "patient_work_items_assignedUnitId_fkey";
ALTER TABLE "patient_work_items" VALIDATE CONSTRAINT "patient_work_items_assignedUserId_fkey";
ALTER TABLE "patient_work_items" VALIDATE CONSTRAINT "patient_work_items_createdById_fkey";
ALTER TABLE "patient_work_items" VALIDATE CONSTRAINT "patient_work_items_referralRequestId_fkey";
ALTER TABLE "patient_work_items" VALIDATE CONSTRAINT "patient_work_items_parentWorkItemId_fkey";
'@

if (Test-Path -LiteralPath $migrationFile) {
    $existing=[System.IO.File]::ReadAllText($migrationFile,[System.Text.Encoding]::UTF8)
    if ($existing.Trim() -ne $migrationSql.Trim()) { throw "Existing Phase 3 migration differs from expected content." }
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

$columnSql=@'
SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND table_name='patient_work_items'
AND (
  (column_name IN ('id','patientId','assignedUnitId','assignedUserId','createdById','referralRequestId','parentWorkItemId') AND data_type='uuid')
  OR column_name IN ('kind','status','note','cancellationReason','acceptedAt','startedAt','completedAt','createdAt','updatedAt')
);
'@
if ([int](Invoke-PsqlText $columnSql) -ne 16) { throw "PatientWorkItem column/type verification failed." }

$constraintSql=@'
SELECT count(*) FROM pg_constraint WHERE conname IN (
'patient_work_items_patientId_fkey',
'patient_work_items_assignedUnitId_fkey',
'patient_work_items_assignedUserId_fkey',
'patient_work_items_createdById_fkey',
'patient_work_items_referralRequestId_fkey',
'patient_work_items_parentWorkItemId_fkey'
) AND convalidated;
'@
if ([int](Invoke-PsqlText $constraintSql) -ne 6) { throw "Expected 6 validated PatientWorkItem UUID FKs." }

$enumSql=@'
SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
FROM pg_type t
JOIN pg_enum e ON e.enumtypid=t.oid
WHERE t.typname='PatientWorkItemStatus';
'@
$enumValues=(Invoke-PsqlText $enumSql).Trim()
if ($enumValues -ne "OPEN,ASSIGNED,ACCEPTED,PROGRESS_IN,COMPLETED,BLOCKED,CANCELLED") { throw "PatientWorkItemStatus enum verification failed: $enumValues" }

$coreCountsAfter=Invoke-PsqlText $coreCountsSql
if ($coreCountsAfter.Trim() -ne $coreCountsBefore.Trim()) { throw "Existing core row counts changed unexpectedly.`nBefore:`n$coreCountsBefore`nAfter:`n$coreCountsAfter" }

$workItemCount=[int64](Invoke-PsqlText 'SELECT count(*) FROM "patient_work_items";')
if ($workItemCount -ne 0) { throw "Phase 3 foundation expected an empty PatientWorkItem table before legacy migration, found $workItemCount rows." }

$smokeSql=@'
BEGIN;
DO $$
DECLARE
  p uuid;
  u uuid;
  w uuid;
BEGIN
  SELECT "guid" INTO p FROM "patients" ORDER BY "id" LIMIT 1;
  SELECT "guid" INTO u FROM "users" WHERE "isActive"=true ORDER BY "id" LIMIT 1;
  IF p IS NOT NULL AND u IS NOT NULL THEN
    INSERT INTO "patient_work_items" ("patientId","kind","status","createdById","assignedUserId","updatedAt")
    VALUES (p,'PHASE3_SMOKE','ASSIGNED',u,u,CURRENT_TIMESTAMP)
    RETURNING "id" INTO w;
    UPDATE "patient_work_items" SET "status"='ACCEPTED', "acceptedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=w;
    UPDATE "patient_work_items" SET "status"='PROGRESS_IN', "startedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=w;
    UPDATE "patient_work_items" SET "status"='COMPLETED', "completedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=w;
  END IF;
END $$;
ROLLBACK;
SELECT count(*) FROM "patient_work_items";
'@
$afterSmoke=(Invoke-PsqlText $smokeSql).Trim()
if ($afterSmoke -ne "0") { throw "Transactional PatientWorkItem smoke did not roll back cleanly." }
Write-Host "PatientWorkItem database + transactional smoke verification: PASS"

Write-Host ""
Write-Host "=== PRISMA GENERATE ==="
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
$audit=Join-Path $auditDir "14-PHASE3-PATIENT-WORKITEM-FOUNDATION.md"
$report=@"
# Phase 3 - PatientWorkItem Foundation

Status: PASS

Prerequisites:
- Phase 0 backup/restore: PASS
- Phase 1 GUID foundation: PASS
- Phase 2 Staff + Unit foundation: PASS
- Phase 2 Staff operational IDs: PASS
- Phase 2 Staff code cutover: PASS
- Phase 2 historical linkage gate: PASS

New UUID model:
- PatientWorkItem

Status lifecycle:
- OPEN
- ASSIGNED
- ACCEPTED
- PROGRESS_IN
- COMPLETED
- BLOCKED
- CANCELLED

UUID relations:
- patientId -> Patient.guid
- assignedUnitId -> Unit.id
- assignedUserId -> User.guid
- createdById -> User.guid
- referralRequestId -> ReferralRequest.guid
- parentWorkItemId -> PatientWorkItem.id

Indexes:
- patientId + status
- assignedUserId + status
- assignedUnitId + status
- referralRequestId
- parentWorkItemId
- createdAt

Safety:
- Additive only.
- CareStage and PATHWAY_DEFAULT remain untouched.
- No existing PK/FK removed.
- No legacy data migrated in this foundation step.
- Existing core row counts unchanged.
- No prisma db push.
- No running application restart.

Verification:
- Prisma validate: PASS
- Migration deploy: PASS
- 6 UUID FKs validated: PASS
- Status enum verification: PASS
- Transactional WorkItem lifecycle smoke with rollback: PASS
- Prisma generate: PASS
- TypeScript: PASS
- Full Vitest: PASS
- Project audit: PASS
- Production build check: PASS
- Prisma migration status: PASS
- Running app login smoke: PASS

Rollback snapshot: $rollbackDir

Next:
Phase 3 WorkItem service/actions for assign/claim/accept/start/complete/reassign with AuditLog, followed by controlled migration of open CareStage work into PatientWorkItem.
"@
[System.IO.File]::WriteAllText($audit,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 3 PATIENT WORK ITEM FOUNDATION: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
