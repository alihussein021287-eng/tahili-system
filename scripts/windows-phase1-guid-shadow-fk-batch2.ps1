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

function Add-ScalarAfterField {
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
Write-Host "=== PHASE 1 GUID SHADOW FK BATCH 2 ==="
Write-Host "Project: $Project"

$phase0 = Test-PassReport "_PHASE01_AUDIT\05-PHASE0-LOCAL-CLONE-BACKUP.md" "Phase 0"
$wave1  = Test-PassReport "_PHASE01_AUDIT\06-PHASE1-GUID-FOUNDATION-WAVE1.md" "Wave 1"
$batch1 = Test-PassReport "_PHASE01_AUDIT\07-PHASE1-GUID-SHADOW-FK-BATCH1.md" "Batch 1"
Write-Host "Phase 0: PASS"
Write-Host "Wave 1: PASS"
Write-Host "Batch 1: PASS"

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

if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres"))) -or [string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","app")))) {
    throw "Local Tahili stack is not running."
}

$foundationSql=@'
SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND column_name='guid' AND data_type='uuid'
AND table_name IN ('users','patients','branches','centers','referral_requests');
'@
if ([int](Invoke-PsqlText $foundationSql) -ne 5) { throw "Foundation GUIDs missing." }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase1-guid-shadow-batch2" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force

$countsSql=@'
SELECT 'appointments', count(*) FROM "appointments"
UNION ALL SELECT 'tasks', count(*) FROM "Task"
UNION ALL SELECT 'center_memberships', count(*) FROM "center_memberships"
ORDER BY 1;
'@
$preCounts=Invoke-PsqlText $countsSql
$preCounts | Set-Content -LiteralPath (Join-Path $rollbackDir "row-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=Get-Content -LiteralPath $schemaPath -Raw
$schema=Add-ScalarAfterField $schema "Appointment" "patientId" "patientGuid" '  patientGuid      String?           @db.Uuid'
$schema=Add-ScalarAfterField $schema "Appointment" "assignedToId" "assignedToGuid" '  assignedToGuid   String?           @db.Uuid'
$schema=Add-ScalarAfterField $schema "Appointment" "centerId" "centerGuid" '  centerGuid       String?           @db.Uuid'
$schema=Add-ScalarAfterField $schema "Task" "assignedToId" "assignedToGuid" '  assignedToGuid String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "Task" "createdById" "createdByGuid" '  createdByGuid String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "Task" "patientId" "patientGuid" '  patientGuid String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "CenterMembership" "centerId" "centerGuid" '  centerGuid String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "CenterMembership" "userId" "userGuid" '  userGuid   String? @db.Uuid'
[System.IO.File]::WriteAllText($schemaPath,$schema,(New-Object System.Text.UTF8Encoding($false)))

$migrationDir=Join-Path $Project "prisma\migrations\20260913021000_phase1_guid_shadow_fk_batch2"
$migrationFile=Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
$migrationSql=@'
-- Phase 1 GUID Shadow FK Batch 2
-- Additive only. Legacy IDs remain authoritative.

ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "patientGuid" UUID;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "assignedToGuid" UUID;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "centerGuid" UUID;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "assignedToGuid" UUID;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "createdByGuid" UUID;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "patientGuid" UUID;
ALTER TABLE "center_memberships" ADD COLUMN IF NOT EXISTS "centerGuid" UUID;
ALTER TABLE "center_memberships" ADD COLUMN IF NOT EXISTS "userGuid" UUID;

UPDATE "appointments" a SET "patientGuid"=p."guid" FROM "patients" p WHERE a."patientId"=p."id" AND a."patientGuid" IS DISTINCT FROM p."guid";
UPDATE "appointments" a SET "assignedToGuid"=u."guid" FROM "users" u WHERE a."assignedToId"=u."id" AND a."assignedToId" IS NOT NULL AND a."assignedToGuid" IS DISTINCT FROM u."guid";
UPDATE "appointments" a SET "centerGuid"=c."guid" FROM "centers" c WHERE a."centerId"=c."id" AND a."centerId" IS NOT NULL AND a."centerGuid" IS DISTINCT FROM c."guid";
UPDATE "Task" t SET "assignedToGuid"=u."guid" FROM "users" u WHERE t."assignedToId"=u."id" AND t."assignedToId" IS NOT NULL AND t."assignedToGuid" IS DISTINCT FROM u."guid";
UPDATE "Task" t SET "createdByGuid"=u."guid" FROM "users" u WHERE t."createdById"=u."id" AND t."createdById" IS NOT NULL AND t."createdByGuid" IS DISTINCT FROM u."guid";
UPDATE "Task" t SET "patientGuid"=p."guid" FROM "patients" p WHERE t."patientId"=p."id" AND t."patientId" IS NOT NULL AND t."patientGuid" IS DISTINCT FROM p."guid";
UPDATE "center_memberships" m SET "centerGuid"=c."guid" FROM "centers" c WHERE m."centerId"=c."id" AND m."centerGuid" IS DISTINCT FROM c."guid";
UPDATE "center_memberships" m SET "userGuid"=u."guid" FROM "users" u WHERE m."userId"=u."id" AND m."userGuid" IS DISTINCT FROM u."guid";

CREATE INDEX IF NOT EXISTS "appointments_patientGuid_idx" ON "appointments"("patientGuid");
CREATE INDEX IF NOT EXISTS "appointments_assignedToGuid_idx" ON "appointments"("assignedToGuid");
CREATE INDEX IF NOT EXISTS "appointments_centerGuid_idx" ON "appointments"("centerGuid");
CREATE INDEX IF NOT EXISTS "Task_assignedToGuid_idx" ON "Task"("assignedToGuid");
CREATE INDEX IF NOT EXISTS "Task_createdByGuid_idx" ON "Task"("createdByGuid");
CREATE INDEX IF NOT EXISTS "Task_patientGuid_idx" ON "Task"("patientGuid");
CREATE INDEX IF NOT EXISTS "center_memberships_centerGuid_idx" ON "center_memberships"("centerGuid");
CREATE INDEX IF NOT EXISTS "center_memberships_userGuid_idx" ON "center_memberships"("userGuid");

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_patientGuid_fkey') THEN ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientGuid_fkey" FOREIGN KEY ("patientGuid") REFERENCES "patients"("guid") ON DELETE CASCADE NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_assignedToGuid_fkey') THEN ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assignedToGuid_fkey" FOREIGN KEY ("assignedToGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_centerGuid_fkey') THEN ALTER TABLE "appointments" ADD CONSTRAINT "appointments_centerGuid_fkey" FOREIGN KEY ("centerGuid") REFERENCES "centers"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Task_assignedToGuid_fkey') THEN ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToGuid_fkey" FOREIGN KEY ("assignedToGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Task_createdByGuid_fkey') THEN ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByGuid_fkey" FOREIGN KEY ("createdByGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Task_patientGuid_fkey') THEN ALTER TABLE "Task" ADD CONSTRAINT "Task_patientGuid_fkey" FOREIGN KEY ("patientGuid") REFERENCES "patients"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_memberships_centerGuid_fkey') THEN ALTER TABLE "center_memberships" ADD CONSTRAINT "center_memberships_centerGuid_fkey" FOREIGN KEY ("centerGuid") REFERENCES "centers"("guid") ON DELETE CASCADE NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_memberships_userGuid_fkey') THEN ALTER TABLE "center_memberships" ADD CONSTRAINT "center_memberships_userGuid_fkey" FOREIGN KEY ("userGuid") REFERENCES "users"("guid") ON DELETE CASCADE NOT VALID; END IF;
END $$;

ALTER TABLE "appointments" VALIDATE CONSTRAINT "appointments_patientGuid_fkey";
ALTER TABLE "appointments" VALIDATE CONSTRAINT "appointments_assignedToGuid_fkey";
ALTER TABLE "appointments" VALIDATE CONSTRAINT "appointments_centerGuid_fkey";
ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_assignedToGuid_fkey";
ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_createdByGuid_fkey";
ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_patientGuid_fkey";
ALTER TABLE "center_memberships" VALIDATE CONSTRAINT "center_memberships_centerGuid_fkey";
ALTER TABLE "center_memberships" VALIDATE CONSTRAINT "center_memberships_userGuid_fkey";

CREATE OR REPLACE FUNCTION tahili_sync_appointments_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT "guid" INTO NEW."patientGuid" FROM "patients" WHERE "id"=NEW."patientId";
 IF NEW."assignedToId" IS NULL THEN NEW."assignedToGuid":=NULL; ELSE SELECT "guid" INTO NEW."assignedToGuid" FROM "users" WHERE "id"=NEW."assignedToId"; END IF;
 IF NEW."centerId" IS NULL THEN NEW."centerGuid":=NULL; ELSE SELECT "guid" INTO NEW."centerGuid" FROM "centers" WHERE "id"=NEW."centerId"; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_appointments_shadow_guids ON "appointments";
CREATE TRIGGER trg_tahili_sync_appointments_shadow_guids BEFORE INSERT OR UPDATE OF "patientId","patientGuid","assignedToId","assignedToGuid","centerId","centerGuid" ON "appointments" FOR EACH ROW EXECUTE FUNCTION tahili_sync_appointments_shadow_guids();

CREATE OR REPLACE FUNCTION tahili_sync_tasks_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."assignedToId" IS NULL THEN NEW."assignedToGuid":=NULL; ELSE SELECT "guid" INTO NEW."assignedToGuid" FROM "users" WHERE "id"=NEW."assignedToId"; END IF;
 IF NEW."createdById" IS NULL THEN NEW."createdByGuid":=NULL; ELSE SELECT "guid" INTO NEW."createdByGuid" FROM "users" WHERE "id"=NEW."createdById"; END IF;
 IF NEW."patientId" IS NULL THEN NEW."patientGuid":=NULL; ELSE SELECT "guid" INTO NEW."patientGuid" FROM "patients" WHERE "id"=NEW."patientId"; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_tasks_shadow_guids ON "Task";
CREATE TRIGGER trg_tahili_sync_tasks_shadow_guids BEFORE INSERT OR UPDATE OF "assignedToId","assignedToGuid","createdById","createdByGuid","patientId","patientGuid" ON "Task" FOR EACH ROW EXECUTE FUNCTION tahili_sync_tasks_shadow_guids();

CREATE OR REPLACE FUNCTION tahili_sync_center_memberships_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT "guid" INTO NEW."centerGuid" FROM "centers" WHERE "id"=NEW."centerId";
 SELECT "guid" INTO NEW."userGuid" FROM "users" WHERE "id"=NEW."userId";
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_center_memberships_shadow_guids ON "center_memberships";
CREATE TRIGGER trg_tahili_sync_center_memberships_shadow_guids BEFORE INSERT OR UPDATE OF "centerId","centerGuid","userId","userGuid" ON "center_memberships" FOR EACH ROW EXECUTE FUNCTION tahili_sync_center_memberships_shadow_guids();
'@

if (Test-Path -LiteralPath $migrationFile) {
    $existing=Get-Content -LiteralPath $migrationFile -Raw
    if ($existing.Trim() -ne $migrationSql.Trim()) { throw "Existing Batch 2 migration differs from expected content." }
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
SELECT 'appointments.patientGuid', count(*) FILTER (WHERE a."patientGuid" IS NULL OR a."patientGuid" IS DISTINCT FROM p."guid") FROM "appointments" a LEFT JOIN "patients" p ON p."id"=a."patientId"
UNION ALL SELECT 'appointments.assignedToGuid', count(*) FILTER (WHERE a."assignedToId" IS NOT NULL AND (a."assignedToGuid" IS NULL OR a."assignedToGuid" IS DISTINCT FROM u."guid")) FROM "appointments" a LEFT JOIN "users" u ON u."id"=a."assignedToId"
UNION ALL SELECT 'appointments.centerGuid', count(*) FILTER (WHERE a."centerId" IS NOT NULL AND (a."centerGuid" IS NULL OR a."centerGuid" IS DISTINCT FROM c."guid")) FROM "appointments" a LEFT JOIN "centers" c ON c."id"=a."centerId"
UNION ALL SELECT 'Task.assignedToGuid', count(*) FILTER (WHERE t."assignedToId" IS NOT NULL AND (t."assignedToGuid" IS NULL OR t."assignedToGuid" IS DISTINCT FROM u."guid")) FROM "Task" t LEFT JOIN "users" u ON u."id"=t."assignedToId"
UNION ALL SELECT 'Task.createdByGuid', count(*) FILTER (WHERE t."createdById" IS NOT NULL AND (t."createdByGuid" IS NULL OR t."createdByGuid" IS DISTINCT FROM u."guid")) FROM "Task" t LEFT JOIN "users" u ON u."id"=t."createdById"
UNION ALL SELECT 'Task.patientGuid', count(*) FILTER (WHERE t."patientId" IS NOT NULL AND (t."patientGuid" IS NULL OR t."patientGuid" IS DISTINCT FROM p."guid")) FROM "Task" t LEFT JOIN "patients" p ON p."id"=t."patientId"
UNION ALL SELECT 'center_memberships.centerGuid', count(*) FILTER (WHERE m."centerGuid" IS NULL OR m."centerGuid" IS DISTINCT FROM c."guid") FROM "center_memberships" m LEFT JOIN "centers" c ON c."id"=m."centerId"
UNION ALL SELECT 'center_memberships.userGuid', count(*) FILTER (WHERE m."userGuid" IS NULL OR m."userGuid" IS DISTINCT FROM u."guid") FROM "center_memberships" m LEFT JOIN "users" u ON u."id"=m."userId"
ORDER BY 1;
'@
$verify=Invoke-PsqlText $verifySql
foreach ($line in ($verify -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2 -or [int64]$p[1] -ne 0) { throw "Batch 2 shadow GUID verification failed: $line" }
}

$constraintSql=@'
SELECT count(*) FROM pg_constraint WHERE conname IN (
'appointments_patientGuid_fkey','appointments_assignedToGuid_fkey','appointments_centerGuid_fkey',
'Task_assignedToGuid_fkey','Task_createdByGuid_fkey','Task_patientGuid_fkey',
'center_memberships_centerGuid_fkey','center_memberships_userGuid_fkey'
) AND convalidated;
'@
if ([int](Invoke-PsqlText $constraintSql) -ne 8) { throw "Expected 8 validated Batch 2 GUID FKs." }

$triggerSql=@'
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
'trg_tahili_sync_appointments_shadow_guids','trg_tahili_sync_tasks_shadow_guids','trg_tahili_sync_center_memberships_shadow_guids'
) AND tgenabled <> 'D';
'@
if ([int](Invoke-PsqlText $triggerSql) -ne 3) { throw "Expected 3 Batch 2 sync triggers." }

$postCounts=Invoke-PsqlText $countsSql
if ($postCounts.Trim() -ne $preCounts.Trim()) { throw "Row counts changed during Batch 2.`nBefore:`n$preCounts`nAfter:`n$postCounts" }
Write-Host "Batch 2 database verification: PASS"

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
$audit=Join-Path $auditDir "08-PHASE1-GUID-SHADOW-FK-BATCH2.md"
$report=@"
# Phase 1 GUID Foundation - Shadow FK Batch 2

Status: PASS

Gates:
- Phase 0: PASS
- Wave 1: PASS
- Shadow FK Batch 1: PASS

Scope:
- Appointment -> Patient: patientGuid
- Appointment -> User(assignedTo): assignedToGuid
- Appointment -> Center: centerGuid
- Task -> User(assignedTo): assignedToGuid
- Task -> User(createdBy): createdByGuid
- Task -> Patient: patientGuid
- CenterMembership -> Center: centerGuid
- CenterMembership -> User: userGuid

Safety:
- Additive only.
- Legacy IDs remain authoritative.
- No legacy PK/FK removed.
- 8 UUID FK constraints validated.
- 3 legacy-write synchronization triggers enabled.
- Row counts unchanged.
- No prisma db push.

Verification:
- Shadow GUID mismatch/orphan checks: PASS
- TypeScript: PASS
- Full Vitest: PASS
- Project audit: PASS
- Prisma migration status: PASS
- Login smoke: PASS

Rollback snapshot: $rollbackDir
"@
$report | Set-Content -LiteralPath $audit -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 1 GUID SHADOW FK BATCH 2: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
