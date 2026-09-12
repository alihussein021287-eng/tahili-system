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
Write-Host "=== PHASE 1 GUID SHADOW FK BATCH 3 ==="
Write-Host "Project: $Project"

$phase0 = Test-PassReport "_PHASE01_AUDIT\05-PHASE0-LOCAL-CLONE-BACKUP.md" "Phase 0"
$wave1  = Test-PassReport "_PHASE01_AUDIT\06-PHASE1-GUID-FOUNDATION-WAVE1.md" "Wave 1"
$batch1 = Test-PassReport "_PHASE01_AUDIT\07-PHASE1-GUID-SHADOW-FK-BATCH1.md" "Batch 1"
$batch2 = Test-PassReport "_PHASE01_AUDIT\08-PHASE1-GUID-SHADOW-FK-BATCH2.md" "Batch 2"
Write-Host "Phase 0: PASS"
Write-Host "Wave 1: PASS"
Write-Host "Batch 1: PASS"
Write-Host "Batch 2: PASS"

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
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase1-guid-shadow-batch3" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force

$countsSql=@'
SELECT 'treatment_plans', count(*) FROM "TreatmentPlan"
UNION ALL SELECT 'therapy_sessions', count(*) FROM "therapy_sessions"
UNION ALL SELECT 'center_programs', count(*) FROM "center_programs"
UNION ALL SELECT 'center_sessions', count(*) FROM "center_sessions"
ORDER BY 1;
'@
$preCounts=Invoke-PsqlText $countsSql
$preCounts | Set-Content -LiteralPath (Join-Path $rollbackDir "row-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=Get-Content -LiteralPath $schemaPath -Raw

$schema=Add-ScalarAfterField $schema "TreatmentPlan" "patientId" "patientGuid" '  patientGuid          String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "TreatmentPlan" "therapistId" "therapistGuid" '  therapistGuid        String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "TreatmentPlan" "centerId" "centerGuid" '  centerGuid           String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "TreatmentPlan" "createdById" "createdByGuid" '  createdByGuid        String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "TreatmentPlan" "specialistDoctorId" "specialistDoctorGuid" '  specialistDoctorGuid String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "TreatmentPlan" "referralRequestId" "referralRequestGuid" '  referralRequestGuid  String? @db.Uuid'

$schema=Add-ScalarAfterField $schema "TherapySession" "patientId" "patientGuid" '  patientGuid    String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "TherapySession" "centerId" "centerGuid" '  centerGuid     String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "TherapySession" "therapistId" "therapistGuid" '  therapistGuid  String? @db.Uuid'

$schema=Add-ScalarAfterField $schema "CenterProgram" "centerId" "centerGuid" '  centerGuid          String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "CenterProgram" "patientId" "patientGuid" '  patientGuid         String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "CenterProgram" "referralRequestId" "referralRequestGuid" '  referralRequestGuid String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "CenterProgram" "assignedToId" "assignedToGuid" '  assignedToGuid      String? @db.Uuid'

$schema=Add-ScalarAfterField $schema "CenterSession" "centerId" "centerGuid" '  centerGuid     String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "CenterSession" "patientId" "patientGuid" '  patientGuid    String? @db.Uuid'
$schema=Add-ScalarAfterField $schema "CenterSession" "assignedToId" "assignedToGuid" '  assignedToGuid String? @db.Uuid'

[System.IO.File]::WriteAllText($schemaPath,$schema,(New-Object System.Text.UTF8Encoding($false)))

$migrationDir=Join-Path $Project "prisma\migrations\20260913023000_phase1_guid_shadow_fk_batch3"
$migrationFile=Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null

$migrationSql=@'
-- Phase 1 GUID Shadow FK Batch 3
-- Additive only. Legacy IDs remain authoritative.

ALTER TABLE "TreatmentPlan" ADD COLUMN IF NOT EXISTS "patientGuid" UUID;
ALTER TABLE "TreatmentPlan" ADD COLUMN IF NOT EXISTS "therapistGuid" UUID;
ALTER TABLE "TreatmentPlan" ADD COLUMN IF NOT EXISTS "centerGuid" UUID;
ALTER TABLE "TreatmentPlan" ADD COLUMN IF NOT EXISTS "createdByGuid" UUID;
ALTER TABLE "TreatmentPlan" ADD COLUMN IF NOT EXISTS "specialistDoctorGuid" UUID;
ALTER TABLE "TreatmentPlan" ADD COLUMN IF NOT EXISTS "referralRequestGuid" UUID;

ALTER TABLE "therapy_sessions" ADD COLUMN IF NOT EXISTS "patientGuid" UUID;
ALTER TABLE "therapy_sessions" ADD COLUMN IF NOT EXISTS "centerGuid" UUID;
ALTER TABLE "therapy_sessions" ADD COLUMN IF NOT EXISTS "therapistGuid" UUID;

ALTER TABLE "center_programs" ADD COLUMN IF NOT EXISTS "centerGuid" UUID;
ALTER TABLE "center_programs" ADD COLUMN IF NOT EXISTS "patientGuid" UUID;
ALTER TABLE "center_programs" ADD COLUMN IF NOT EXISTS "referralRequestGuid" UUID;
ALTER TABLE "center_programs" ADD COLUMN IF NOT EXISTS "assignedToGuid" UUID;

ALTER TABLE "center_sessions" ADD COLUMN IF NOT EXISTS "centerGuid" UUID;
ALTER TABLE "center_sessions" ADD COLUMN IF NOT EXISTS "patientGuid" UUID;
ALTER TABLE "center_sessions" ADD COLUMN IF NOT EXISTS "assignedToGuid" UUID;

UPDATE "TreatmentPlan" t SET "patientGuid"=p."guid" FROM "patients" p WHERE t."patientId"=p."id" AND t."patientGuid" IS DISTINCT FROM p."guid";
UPDATE "TreatmentPlan" t SET "therapistGuid"=u."guid" FROM "users" u WHERE t."therapistId"=u."id" AND t."therapistId" IS NOT NULL AND t."therapistGuid" IS DISTINCT FROM u."guid";
UPDATE "TreatmentPlan" t SET "centerGuid"=c."guid" FROM "centers" c WHERE t."centerId"=c."id" AND t."centerId" IS NOT NULL AND t."centerGuid" IS DISTINCT FROM c."guid";
UPDATE "TreatmentPlan" t SET "createdByGuid"=u."guid" FROM "users" u WHERE t."createdById"=u."id" AND t."createdById" IS NOT NULL AND t."createdByGuid" IS DISTINCT FROM u."guid";
UPDATE "TreatmentPlan" t SET "specialistDoctorGuid"=u."guid" FROM "users" u WHERE t."specialistDoctorId"=u."id" AND t."specialistDoctorId" IS NOT NULL AND t."specialistDoctorGuid" IS DISTINCT FROM u."guid";
UPDATE "TreatmentPlan" t SET "referralRequestGuid"=r."guid" FROM "referral_requests" r WHERE t."referralRequestId"=r."id" AND t."referralRequestId" IS NOT NULL AND t."referralRequestGuid" IS DISTINCT FROM r."guid";

UPDATE "therapy_sessions" s SET "patientGuid"=p."guid" FROM "patients" p WHERE s."patientId"=p."id" AND s."patientGuid" IS DISTINCT FROM p."guid";
UPDATE "therapy_sessions" s SET "centerGuid"=c."guid" FROM "centers" c WHERE s."centerId"=c."id" AND s."centerId" IS NOT NULL AND s."centerGuid" IS DISTINCT FROM c."guid";
UPDATE "therapy_sessions" s SET "therapistGuid"=u."guid" FROM "users" u WHERE s."therapistId"=u."id" AND s."therapistId" IS NOT NULL AND s."therapistGuid" IS DISTINCT FROM u."guid";

UPDATE "center_programs" p0 SET "centerGuid"=c."guid" FROM "centers" c WHERE p0."centerId"=c."id" AND p0."centerGuid" IS DISTINCT FROM c."guid";
UPDATE "center_programs" p0 SET "patientGuid"=p."guid" FROM "patients" p WHERE p0."patientId"=p."id" AND p0."patientGuid" IS DISTINCT FROM p."guid";
UPDATE "center_programs" p0 SET "referralRequestGuid"=r."guid" FROM "referral_requests" r WHERE p0."referralRequestId"=r."id" AND p0."referralRequestId" IS NOT NULL AND p0."referralRequestGuid" IS DISTINCT FROM r."guid";
UPDATE "center_programs" p0 SET "assignedToGuid"=u."guid" FROM "users" u WHERE p0."assignedToId"=u."id" AND p0."assignedToId" IS NOT NULL AND p0."assignedToGuid" IS DISTINCT FROM u."guid";

UPDATE "center_sessions" s SET "centerGuid"=c."guid" FROM "centers" c WHERE s."centerId"=c."id" AND s."centerGuid" IS DISTINCT FROM c."guid";
UPDATE "center_sessions" s SET "patientGuid"=p."guid" FROM "patients" p WHERE s."patientId"=p."id" AND s."patientGuid" IS DISTINCT FROM p."guid";
UPDATE "center_sessions" s SET "assignedToGuid"=u."guid" FROM "users" u WHERE s."assignedToId"=u."id" AND s."assignedToId" IS NOT NULL AND s."assignedToGuid" IS DISTINCT FROM u."guid";

CREATE INDEX IF NOT EXISTS "TreatmentPlan_patientGuid_idx" ON "TreatmentPlan"("patientGuid");
CREATE INDEX IF NOT EXISTS "TreatmentPlan_therapistGuid_idx" ON "TreatmentPlan"("therapistGuid");
CREATE INDEX IF NOT EXISTS "TreatmentPlan_centerGuid_idx" ON "TreatmentPlan"("centerGuid");
CREATE INDEX IF NOT EXISTS "TreatmentPlan_createdByGuid_idx" ON "TreatmentPlan"("createdByGuid");
CREATE INDEX IF NOT EXISTS "TreatmentPlan_specialistDoctorGuid_idx" ON "TreatmentPlan"("specialistDoctorGuid");
CREATE INDEX IF NOT EXISTS "TreatmentPlan_referralRequestGuid_idx" ON "TreatmentPlan"("referralRequestGuid");
CREATE INDEX IF NOT EXISTS "therapy_sessions_patientGuid_idx" ON "therapy_sessions"("patientGuid");
CREATE INDEX IF NOT EXISTS "therapy_sessions_centerGuid_idx" ON "therapy_sessions"("centerGuid");
CREATE INDEX IF NOT EXISTS "therapy_sessions_therapistGuid_idx" ON "therapy_sessions"("therapistGuid");
CREATE INDEX IF NOT EXISTS "center_programs_centerGuid_idx" ON "center_programs"("centerGuid");
CREATE INDEX IF NOT EXISTS "center_programs_patientGuid_idx" ON "center_programs"("patientGuid");
CREATE INDEX IF NOT EXISTS "center_programs_referralRequestGuid_idx" ON "center_programs"("referralRequestGuid");
CREATE INDEX IF NOT EXISTS "center_programs_assignedToGuid_idx" ON "center_programs"("assignedToGuid");
CREATE INDEX IF NOT EXISTS "center_sessions_centerGuid_idx" ON "center_sessions"("centerGuid");
CREATE INDEX IF NOT EXISTS "center_sessions_patientGuid_idx" ON "center_sessions"("patientGuid");
CREATE INDEX IF NOT EXISTS "center_sessions_assignedToGuid_idx" ON "center_sessions"("assignedToGuid");

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TreatmentPlan_patientGuid_fkey') THEN ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_patientGuid_fkey" FOREIGN KEY ("patientGuid") REFERENCES "patients"("guid") ON DELETE CASCADE NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TreatmentPlan_therapistGuid_fkey') THEN ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_therapistGuid_fkey" FOREIGN KEY ("therapistGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TreatmentPlan_centerGuid_fkey') THEN ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_centerGuid_fkey" FOREIGN KEY ("centerGuid") REFERENCES "centers"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TreatmentPlan_createdByGuid_fkey') THEN ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_createdByGuid_fkey" FOREIGN KEY ("createdByGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TreatmentPlan_specialistDoctorGuid_fkey') THEN ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_specialistDoctorGuid_fkey" FOREIGN KEY ("specialistDoctorGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='TreatmentPlan_referralRequestGuid_fkey') THEN ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_referralRequestGuid_fkey" FOREIGN KEY ("referralRequestGuid") REFERENCES "referral_requests"("guid") ON DELETE SET NULL NOT VALID; END IF;

 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='therapy_sessions_patientGuid_fkey') THEN ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_patientGuid_fkey" FOREIGN KEY ("patientGuid") REFERENCES "patients"("guid") ON DELETE CASCADE NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='therapy_sessions_centerGuid_fkey') THEN ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_centerGuid_fkey" FOREIGN KEY ("centerGuid") REFERENCES "centers"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='therapy_sessions_therapistGuid_fkey') THEN ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_therapistGuid_fkey" FOREIGN KEY ("therapistGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;

 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_programs_centerGuid_fkey') THEN ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_centerGuid_fkey" FOREIGN KEY ("centerGuid") REFERENCES "centers"("guid") ON DELETE RESTRICT NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_programs_patientGuid_fkey') THEN ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_patientGuid_fkey" FOREIGN KEY ("patientGuid") REFERENCES "patients"("guid") ON DELETE RESTRICT NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_programs_referralRequestGuid_fkey') THEN ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_referralRequestGuid_fkey" FOREIGN KEY ("referralRequestGuid") REFERENCES "referral_requests"("guid") ON DELETE SET NULL NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_programs_assignedToGuid_fkey') THEN ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_assignedToGuid_fkey" FOREIGN KEY ("assignedToGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;

 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_sessions_centerGuid_fkey') THEN ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_centerGuid_fkey" FOREIGN KEY ("centerGuid") REFERENCES "centers"("guid") ON DELETE RESTRICT NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_sessions_patientGuid_fkey') THEN ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_patientGuid_fkey" FOREIGN KEY ("patientGuid") REFERENCES "patients"("guid") ON DELETE RESTRICT NOT VALID; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='center_sessions_assignedToGuid_fkey') THEN ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_assignedToGuid_fkey" FOREIGN KEY ("assignedToGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
END $$;

ALTER TABLE "TreatmentPlan" VALIDATE CONSTRAINT "TreatmentPlan_patientGuid_fkey";
ALTER TABLE "TreatmentPlan" VALIDATE CONSTRAINT "TreatmentPlan_therapistGuid_fkey";
ALTER TABLE "TreatmentPlan" VALIDATE CONSTRAINT "TreatmentPlan_centerGuid_fkey";
ALTER TABLE "TreatmentPlan" VALIDATE CONSTRAINT "TreatmentPlan_createdByGuid_fkey";
ALTER TABLE "TreatmentPlan" VALIDATE CONSTRAINT "TreatmentPlan_specialistDoctorGuid_fkey";
ALTER TABLE "TreatmentPlan" VALIDATE CONSTRAINT "TreatmentPlan_referralRequestGuid_fkey";
ALTER TABLE "therapy_sessions" VALIDATE CONSTRAINT "therapy_sessions_patientGuid_fkey";
ALTER TABLE "therapy_sessions" VALIDATE CONSTRAINT "therapy_sessions_centerGuid_fkey";
ALTER TABLE "therapy_sessions" VALIDATE CONSTRAINT "therapy_sessions_therapistGuid_fkey";
ALTER TABLE "center_programs" VALIDATE CONSTRAINT "center_programs_centerGuid_fkey";
ALTER TABLE "center_programs" VALIDATE CONSTRAINT "center_programs_patientGuid_fkey";
ALTER TABLE "center_programs" VALIDATE CONSTRAINT "center_programs_referralRequestGuid_fkey";
ALTER TABLE "center_programs" VALIDATE CONSTRAINT "center_programs_assignedToGuid_fkey";
ALTER TABLE "center_sessions" VALIDATE CONSTRAINT "center_sessions_centerGuid_fkey";
ALTER TABLE "center_sessions" VALIDATE CONSTRAINT "center_sessions_patientGuid_fkey";
ALTER TABLE "center_sessions" VALIDATE CONSTRAINT "center_sessions_assignedToGuid_fkey";

CREATE OR REPLACE FUNCTION tahili_sync_treatment_plans_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT "guid" INTO NEW."patientGuid" FROM "patients" WHERE "id"=NEW."patientId";
 IF NEW."therapistId" IS NULL THEN NEW."therapistGuid":=NULL; ELSE SELECT "guid" INTO NEW."therapistGuid" FROM "users" WHERE "id"=NEW."therapistId"; END IF;
 IF NEW."centerId" IS NULL THEN NEW."centerGuid":=NULL; ELSE SELECT "guid" INTO NEW."centerGuid" FROM "centers" WHERE "id"=NEW."centerId"; END IF;
 IF NEW."createdById" IS NULL THEN NEW."createdByGuid":=NULL; ELSE SELECT "guid" INTO NEW."createdByGuid" FROM "users" WHERE "id"=NEW."createdById"; END IF;
 IF NEW."specialistDoctorId" IS NULL THEN NEW."specialistDoctorGuid":=NULL; ELSE SELECT "guid" INTO NEW."specialistDoctorGuid" FROM "users" WHERE "id"=NEW."specialistDoctorId"; END IF;
 IF NEW."referralRequestId" IS NULL THEN NEW."referralRequestGuid":=NULL; ELSE SELECT "guid" INTO NEW."referralRequestGuid" FROM "referral_requests" WHERE "id"=NEW."referralRequestId"; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_treatment_plans_shadow_guids ON "TreatmentPlan";
CREATE TRIGGER trg_tahili_sync_treatment_plans_shadow_guids BEFORE INSERT OR UPDATE OF "patientId","patientGuid","therapistId","therapistGuid","centerId","centerGuid","createdById","createdByGuid","specialistDoctorId","specialistDoctorGuid","referralRequestId","referralRequestGuid" ON "TreatmentPlan" FOR EACH ROW EXECUTE FUNCTION tahili_sync_treatment_plans_shadow_guids();

CREATE OR REPLACE FUNCTION tahili_sync_therapy_sessions_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT "guid" INTO NEW."patientGuid" FROM "patients" WHERE "id"=NEW."patientId";
 IF NEW."centerId" IS NULL THEN NEW."centerGuid":=NULL; ELSE SELECT "guid" INTO NEW."centerGuid" FROM "centers" WHERE "id"=NEW."centerId"; END IF;
 IF NEW."therapistId" IS NULL THEN NEW."therapistGuid":=NULL; ELSE SELECT "guid" INTO NEW."therapistGuid" FROM "users" WHERE "id"=NEW."therapistId"; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_therapy_sessions_shadow_guids ON "therapy_sessions";
CREATE TRIGGER trg_tahili_sync_therapy_sessions_shadow_guids BEFORE INSERT OR UPDATE OF "patientId","patientGuid","centerId","centerGuid","therapistId","therapistGuid" ON "therapy_sessions" FOR EACH ROW EXECUTE FUNCTION tahili_sync_therapy_sessions_shadow_guids();

CREATE OR REPLACE FUNCTION tahili_sync_center_programs_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT "guid" INTO NEW."centerGuid" FROM "centers" WHERE "id"=NEW."centerId";
 SELECT "guid" INTO NEW."patientGuid" FROM "patients" WHERE "id"=NEW."patientId";
 IF NEW."referralRequestId" IS NULL THEN NEW."referralRequestGuid":=NULL; ELSE SELECT "guid" INTO NEW."referralRequestGuid" FROM "referral_requests" WHERE "id"=NEW."referralRequestId"; END IF;
 IF NEW."assignedToId" IS NULL THEN NEW."assignedToGuid":=NULL; ELSE SELECT "guid" INTO NEW."assignedToGuid" FROM "users" WHERE "id"=NEW."assignedToId"; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_center_programs_shadow_guids ON "center_programs";
CREATE TRIGGER trg_tahili_sync_center_programs_shadow_guids BEFORE INSERT OR UPDATE OF "centerId","centerGuid","patientId","patientGuid","referralRequestId","referralRequestGuid","assignedToId","assignedToGuid" ON "center_programs" FOR EACH ROW EXECUTE FUNCTION tahili_sync_center_programs_shadow_guids();

CREATE OR REPLACE FUNCTION tahili_sync_center_sessions_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT "guid" INTO NEW."centerGuid" FROM "centers" WHERE "id"=NEW."centerId";
 SELECT "guid" INTO NEW."patientGuid" FROM "patients" WHERE "id"=NEW."patientId";
 IF NEW."assignedToId" IS NULL THEN NEW."assignedToGuid":=NULL; ELSE SELECT "guid" INTO NEW."assignedToGuid" FROM "users" WHERE "id"=NEW."assignedToId"; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_center_sessions_shadow_guids ON "center_sessions";
CREATE TRIGGER trg_tahili_sync_center_sessions_shadow_guids BEFORE INSERT OR UPDATE OF "centerId","centerGuid","patientId","patientGuid","assignedToId","assignedToGuid" ON "center_sessions" FOR EACH ROW EXECUTE FUNCTION tahili_sync_center_sessions_shadow_guids();
'@

if (Test-Path -LiteralPath $migrationFile) {
    $existing=Get-Content -LiteralPath $migrationFile -Raw
    if ($existing.Trim() -ne $migrationSql.Trim()) { throw "Existing Batch 3 migration differs from expected content." }
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
SELECT 'TreatmentPlan.patientGuid', count(*) FILTER (WHERE t."patientGuid" IS NULL OR t."patientGuid" IS DISTINCT FROM p."guid") FROM "TreatmentPlan" t LEFT JOIN "patients" p ON p."id"=t."patientId"
UNION ALL SELECT 'TreatmentPlan.therapistGuid', count(*) FILTER (WHERE t."therapistId" IS NOT NULL AND (t."therapistGuid" IS NULL OR t."therapistGuid" IS DISTINCT FROM u."guid")) FROM "TreatmentPlan" t LEFT JOIN "users" u ON u."id"=t."therapistId"
UNION ALL SELECT 'TreatmentPlan.centerGuid', count(*) FILTER (WHERE t."centerId" IS NOT NULL AND (t."centerGuid" IS NULL OR t."centerGuid" IS DISTINCT FROM c."guid")) FROM "TreatmentPlan" t LEFT JOIN "centers" c ON c."id"=t."centerId"
UNION ALL SELECT 'TreatmentPlan.createdByGuid', count(*) FILTER (WHERE t."createdById" IS NOT NULL AND (t."createdByGuid" IS NULL OR t."createdByGuid" IS DISTINCT FROM u."guid")) FROM "TreatmentPlan" t LEFT JOIN "users" u ON u."id"=t."createdById"
UNION ALL SELECT 'TreatmentPlan.specialistDoctorGuid', count(*) FILTER (WHERE t."specialistDoctorId" IS NOT NULL AND (t."specialistDoctorGuid" IS NULL OR t."specialistDoctorGuid" IS DISTINCT FROM u."guid")) FROM "TreatmentPlan" t LEFT JOIN "users" u ON u."id"=t."specialistDoctorId"
UNION ALL SELECT 'TreatmentPlan.referralRequestGuid', count(*) FILTER (WHERE t."referralRequestId" IS NOT NULL AND (t."referralRequestGuid" IS NULL OR t."referralRequestGuid" IS DISTINCT FROM r."guid")) FROM "TreatmentPlan" t LEFT JOIN "referral_requests" r ON r."id"=t."referralRequestId"
UNION ALL SELECT 'therapy_sessions.patientGuid', count(*) FILTER (WHERE s."patientGuid" IS NULL OR s."patientGuid" IS DISTINCT FROM p."guid") FROM "therapy_sessions" s LEFT JOIN "patients" p ON p."id"=s."patientId"
UNION ALL SELECT 'therapy_sessions.centerGuid', count(*) FILTER (WHERE s."centerId" IS NOT NULL AND (s."centerGuid" IS NULL OR s."centerGuid" IS DISTINCT FROM c."guid")) FROM "therapy_sessions" s LEFT JOIN "centers" c ON c."id"=s."centerId"
UNION ALL SELECT 'therapy_sessions.therapistGuid', count(*) FILTER (WHERE s."therapistId" IS NOT NULL AND (s."therapistGuid" IS NULL OR s."therapistGuid" IS DISTINCT FROM u."guid")) FROM "therapy_sessions" s LEFT JOIN "users" u ON u."id"=s."therapistId"
UNION ALL SELECT 'center_programs.centerGuid', count(*) FILTER (WHERE p0."centerGuid" IS NULL OR p0."centerGuid" IS DISTINCT FROM c."guid") FROM "center_programs" p0 LEFT JOIN "centers" c ON c."id"=p0."centerId"
UNION ALL SELECT 'center_programs.patientGuid', count(*) FILTER (WHERE p0."patientGuid" IS NULL OR p0."patientGuid" IS DISTINCT FROM p."guid") FROM "center_programs" p0 LEFT JOIN "patients" p ON p."id"=p0."patientId"
UNION ALL SELECT 'center_programs.referralRequestGuid', count(*) FILTER (WHERE p0."referralRequestId" IS NOT NULL AND (p0."referralRequestGuid" IS NULL OR p0."referralRequestGuid" IS DISTINCT FROM r."guid")) FROM "center_programs" p0 LEFT JOIN "referral_requests" r ON r."id"=p0."referralRequestId"
UNION ALL SELECT 'center_programs.assignedToGuid', count(*) FILTER (WHERE p0."assignedToId" IS NOT NULL AND (p0."assignedToGuid" IS NULL OR p0."assignedToGuid" IS DISTINCT FROM u."guid")) FROM "center_programs" p0 LEFT JOIN "users" u ON u."id"=p0."assignedToId"
UNION ALL SELECT 'center_sessions.centerGuid', count(*) FILTER (WHERE s."centerGuid" IS NULL OR s."centerGuid" IS DISTINCT FROM c."guid") FROM "center_sessions" s LEFT JOIN "centers" c ON c."id"=s."centerId"
UNION ALL SELECT 'center_sessions.patientGuid', count(*) FILTER (WHERE s."patientGuid" IS NULL OR s."patientGuid" IS DISTINCT FROM p."guid") FROM "center_sessions" s LEFT JOIN "patients" p ON p."id"=s."patientId"
UNION ALL SELECT 'center_sessions.assignedToGuid', count(*) FILTER (WHERE s."assignedToId" IS NOT NULL AND (s."assignedToGuid" IS NULL OR s."assignedToGuid" IS DISTINCT FROM u."guid")) FROM "center_sessions" s LEFT JOIN "users" u ON u."id"=s."assignedToId"
ORDER BY 1;
'@
$verify=Invoke-PsqlText $verifySql
foreach ($line in ($verify -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2 -or [int64]$p[1] -ne 0) { throw "Batch 3 shadow GUID verification failed: $line" }
}

$constraintSql=@'
SELECT count(*) FROM pg_constraint WHERE conname IN (
'TreatmentPlan_patientGuid_fkey','TreatmentPlan_therapistGuid_fkey','TreatmentPlan_centerGuid_fkey','TreatmentPlan_createdByGuid_fkey','TreatmentPlan_specialistDoctorGuid_fkey','TreatmentPlan_referralRequestGuid_fkey',
'therapy_sessions_patientGuid_fkey','therapy_sessions_centerGuid_fkey','therapy_sessions_therapistGuid_fkey',
'center_programs_centerGuid_fkey','center_programs_patientGuid_fkey','center_programs_referralRequestGuid_fkey','center_programs_assignedToGuid_fkey',
'center_sessions_centerGuid_fkey','center_sessions_patientGuid_fkey','center_sessions_assignedToGuid_fkey'
) AND convalidated;
'@
if ([int](Invoke-PsqlText $constraintSql) -ne 16) { throw "Expected 16 validated Batch 3 GUID FKs." }

$triggerSql=@'
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
'trg_tahili_sync_treatment_plans_shadow_guids','trg_tahili_sync_therapy_sessions_shadow_guids','trg_tahili_sync_center_programs_shadow_guids','trg_tahili_sync_center_sessions_shadow_guids'
) AND tgenabled <> 'D';
'@
if ([int](Invoke-PsqlText $triggerSql) -ne 4) { throw "Expected 4 Batch 3 sync triggers." }

$postCounts=Invoke-PsqlText $countsSql
if ($postCounts.Trim() -ne $preCounts.Trim()) { throw "Row counts changed during Batch 3.`nBefore:`n$preCounts`nAfter:`n$postCounts" }
Write-Host "Batch 3 database verification: PASS"

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
$audit=Join-Path $auditDir "09-PHASE1-GUID-SHADOW-FK-BATCH3.md"
$report=@"
# Phase 1 GUID Foundation - Shadow FK Batch 3

Status: PASS

Gates:
- Phase 0: PASS
- Wave 1: PASS
- Shadow FK Batch 1: PASS
- Shadow FK Batch 2: PASS

Scope:
- TreatmentPlan -> Patient/User/Center/ReferralRequest foundation GUIDs: 6 shadow FKs
- TherapySession -> Patient/Center/User foundation GUIDs: 3 shadow FKs
- CenterProgram -> Center/Patient/ReferralRequest/User foundation GUIDs: 4 shadow FKs
- CenterSession -> Center/Patient/User foundation GUIDs: 3 shadow FKs

Safety:
- Additive only.
- Legacy IDs remain authoritative.
- No legacy PK/FK removed.
- 16 UUID FK constraints validated.
- 4 legacy-write synchronization triggers enabled.
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
Write-Host "PHASE 1 GUID SHADOW FK BATCH 3: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
