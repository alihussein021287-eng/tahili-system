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
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed: docker $($Arguments -join ' ')"
    }
}

function Get-DockerText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & docker @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed: docker $($Arguments -join ' ')`n$($output | Out-String)"
    }
    return (($output | Out-String).Trim())
}

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Invoke-Docker ($Compose + $Arguments)
}

function Get-ComposeText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    return Get-DockerText ($Compose + $Arguments)
}

function Test-PassReport {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "$Label PASS report is missing: $path"
    }
    $text = Get-Content -LiteralPath $path -Raw
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") {
        throw "$Label gate is not proven PASS: $path"
    }
    return $path
}

function Add-ScalarAfterField {
    param(
        [Parameter(Mandatory = $true)][string]$SchemaText,
        [Parameter(Mandatory = $true)][string]$ModelName,
        [Parameter(Mandatory = $true)][string]$AfterField,
        [Parameter(Mandatory = $true)][string]$NewField,
        [Parameter(Mandatory = $true)][string]$NewLine
    )

    $pattern = "(?ms)(model\s+$([regex]::Escape($ModelName))\s*\{.*?^\})"
    $match = [regex]::Match($SchemaText, $pattern)
    if (-not $match.Success) { throw "Model not found: $ModelName" }

    $block = $match.Groups[1].Value
    if ($block -match "(?m)^\s*$([regex]::Escape($NewField))\s+") { return $SchemaText }

    $lines = $block -split "`r?`n"
    $output = New-Object System.Collections.Generic.List[string]
    $inserted = $false
    foreach ($line in $lines) {
        $output.Add($line)
        if (-not $inserted -and $line -match "^\s*$([regex]::Escape($AfterField))\s+") {
            $output.Add($NewLine)
            $inserted = $true
        }
    }
    if (-not $inserted) { throw "Field $AfterField not found in model $ModelName" }

    $newBlock = $output -join "`n"
    return $SchemaText.Substring(0, $match.Index) + $newBlock + $SchemaText.Substring($match.Index + $match.Length)
}

Write-Host ""
Write-Host "=== PHASE 1 GUID FOUNDATION - SHADOW FK BATCH 1 ==="
Write-Host "Project: $Project"

$phase0 = Test-PassReport -RelativePath "_PHASE01_AUDIT\05-PHASE0-LOCAL-CLONE-BACKUP.md" -Label "Phase 0"
$wave1 = Test-PassReport -RelativePath "_PHASE01_AUDIT\06-PHASE1-GUID-FOUNDATION-WAVE1.md" -Label "Wave 1"
Write-Host "Phase 0 gate: PASS"
Write-Host "Wave 1 gate: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }

foreach ($file in @(".env.saif-dev", "docker-compose.saif-dev.yml", "prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$envMap = @{}
foreach ($line in Get-Content -LiteralPath ".env.saif-dev") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $key = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $envMap[$key] = $value
    }
}
$dbUser = $envMap["DB_USER"]
$dbName = $envMap["DB_NAME"]
if ([string]::IsNullOrWhiteSpace($dbUser) -or [string]::IsNullOrWhiteSpace($dbName)) {
    throw "DB_USER or DB_NAME is missing from .env.saif-dev"
}

$postgresId = Get-ComposeText @("ps", "-q", "postgres")
$appId = Get-ComposeText @("ps", "-q", "app")
if ([string]::IsNullOrWhiteSpace($postgresId) -or [string]::IsNullOrWhiteSpace($appId)) {
    throw "Local Tahili stack is not running."
}

$guidReadySql = @'
SELECT table_name || '|' || count(*)
FROM information_schema.columns
WHERE table_schema='public'
  AND column_name='guid'
  AND data_type='uuid'
  AND table_name IN ('users','patients','branches','centers','referral_requests')
GROUP BY table_name
ORDER BY table_name;
'@
$guidReady = Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $guidReadySql)
if (($guidReady -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -ne 5) {
    throw "Wave 1 GUID columns are not present on all five foundation tables."
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir = Join-Path $Project (Join-Path ".secrets\phase1-guid-shadow" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force

$preSql = @'
SELECT 'users', count(*) FROM "users"
UNION ALL SELECT 'patients', count(*) FROM "patients"
UNION ALL SELECT 'referral_requests', count(*) FROM "referral_requests"
ORDER BY 1;
'@
$preCounts = Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $preSql)
$preCounts | Set-Content -LiteralPath (Join-Path $rollbackDir "row-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

# Add scalar shadow GUID columns to Prisma without switching any relation yet.
$schemaPath = Join-Path $Project "prisma\schema.prisma"
$schema = Get-Content -LiteralPath $schemaPath -Raw
$schema = Add-ScalarAfterField $schema "User" "branchId" "branchGuid" '  branchGuid       String?   @db.Uuid'
$schema = Add-ScalarAfterField $schema "Patient" "branchId" "branchGuid" '  branchGuid      String?   @db.Uuid'
$schema = Add-ScalarAfterField $schema "Patient" "createdById" "createdByGuid" '  createdByGuid String?   @db.Uuid'
$schema = Add-ScalarAfterField $schema "ReferralRequest" "patientId" "patientGuid" '  patientGuid String? @db.Uuid'
$schema = Add-ScalarAfterField $schema "ReferralRequest" "createdById" "createdByGuid" '  createdByGuid String? @db.Uuid'
$schema = Add-ScalarAfterField $schema "ReferralRequest" "assignedReviewerId" "assignedReviewerGuid" '  assignedReviewerGuid String? @db.Uuid'
$schema = Add-ScalarAfterField $schema "ReferralRequest" "destinationCenterId" "destinationCenterGuid" '  destinationCenterGuid String? @db.Uuid'
$schema = Add-ScalarAfterField $schema "ReferralRequest" "statusChangedById" "statusChangedByGuid" '  statusChangedByGuid String? @db.Uuid'
$schema = Add-ScalarAfterField $schema "ReferralRequest" "reviewedById" "reviewedByGuid" '  reviewedByGuid String? @db.Uuid'
$schema = Add-ScalarAfterField $schema "ReferralRequest" "acceptedById" "acceptedByGuid" '  acceptedByGuid String? @db.Uuid'
$schema = Add-ScalarAfterField $schema "ReferralRequest" "cancelledById" "cancelledByGuid" '  cancelledByGuid String? @db.Uuid'
[System.IO.File]::WriteAllText($schemaPath, $schema, (New-Object System.Text.UTF8Encoding($false)))

$migrationDir = Join-Path $Project "prisma\migrations\20260913014500_phase1_guid_shadow_fk_batch1"
$migrationFile = Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null

$migrationSql = @'
-- Phase 1 GUID Foundation - Shadow FK Batch 1
-- Additive only. Legacy IDs remain authoritative and untouched.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "branchGuid" UUID;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "branchGuid" UUID;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "createdByGuid" UUID;
ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "patientGuid" UUID;
ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "createdByGuid" UUID;
ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "assignedReviewerGuid" UUID;
ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "destinationCenterGuid" UUID;
ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "statusChangedByGuid" UUID;
ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "reviewedByGuid" UUID;
ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "acceptedByGuid" UUID;
ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "cancelledByGuid" UUID;

UPDATE "users" u SET "branchGuid" = b."guid" FROM "branches" b WHERE u."branchId" = b."id" AND u."branchId" IS NOT NULL AND u."branchGuid" IS DISTINCT FROM b."guid";
UPDATE "patients" p SET "branchGuid" = b."guid" FROM "branches" b WHERE p."branchId" = b."id" AND p."branchId" IS NOT NULL AND p."branchGuid" IS DISTINCT FROM b."guid";
UPDATE "patients" p SET "createdByGuid" = u."guid" FROM "users" u WHERE p."createdById" = u."id" AND p."createdById" IS NOT NULL AND p."createdByGuid" IS DISTINCT FROM u."guid";
UPDATE "referral_requests" r SET "patientGuid" = p."guid" FROM "patients" p WHERE r."patientId" = p."id" AND r."patientGuid" IS DISTINCT FROM p."guid";
UPDATE "referral_requests" r SET "createdByGuid" = u."guid" FROM "users" u WHERE r."createdById" = u."id" AND r."createdByGuid" IS DISTINCT FROM u."guid";
UPDATE "referral_requests" r SET "assignedReviewerGuid" = u."guid" FROM "users" u WHERE r."assignedReviewerId" = u."id" AND r."assignedReviewerId" IS NOT NULL AND r."assignedReviewerGuid" IS DISTINCT FROM u."guid";
UPDATE "referral_requests" r SET "destinationCenterGuid" = c."guid" FROM "centers" c WHERE r."destinationCenterId" = c."id" AND r."destinationCenterId" IS NOT NULL AND r."destinationCenterGuid" IS DISTINCT FROM c."guid";
UPDATE "referral_requests" r SET "statusChangedByGuid" = u."guid" FROM "users" u WHERE r."statusChangedById" = u."id" AND r."statusChangedById" IS NOT NULL AND r."statusChangedByGuid" IS DISTINCT FROM u."guid";
UPDATE "referral_requests" r SET "reviewedByGuid" = u."guid" FROM "users" u WHERE r."reviewedById" = u."id" AND r."reviewedById" IS NOT NULL AND r."reviewedByGuid" IS DISTINCT FROM u."guid";
UPDATE "referral_requests" r SET "acceptedByGuid" = u."guid" FROM "users" u WHERE r."acceptedById" = u."id" AND r."acceptedById" IS NOT NULL AND r."acceptedByGuid" IS DISTINCT FROM u."guid";
UPDATE "referral_requests" r SET "cancelledByGuid" = u."guid" FROM "users" u WHERE r."cancelledById" = u."id" AND r."cancelledById" IS NOT NULL AND r."cancelledByGuid" IS DISTINCT FROM u."guid";

CREATE INDEX IF NOT EXISTS "users_branchGuid_idx" ON "users"("branchGuid");
CREATE INDEX IF NOT EXISTS "patients_branchGuid_idx" ON "patients"("branchGuid");
CREATE INDEX IF NOT EXISTS "patients_createdByGuid_idx" ON "patients"("createdByGuid");
CREATE INDEX IF NOT EXISTS "referral_requests_patientGuid_idx" ON "referral_requests"("patientGuid");
CREATE INDEX IF NOT EXISTS "referral_requests_createdByGuid_idx" ON "referral_requests"("createdByGuid");
CREATE INDEX IF NOT EXISTS "referral_requests_assignedReviewerGuid_idx" ON "referral_requests"("assignedReviewerGuid");
CREATE INDEX IF NOT EXISTS "referral_requests_destinationCenterGuid_idx" ON "referral_requests"("destinationCenterGuid");
CREATE INDEX IF NOT EXISTS "referral_requests_statusChangedByGuid_idx" ON "referral_requests"("statusChangedByGuid");
CREATE INDEX IF NOT EXISTS "referral_requests_reviewedByGuid_idx" ON "referral_requests"("reviewedByGuid");
CREATE INDEX IF NOT EXISTS "referral_requests_acceptedByGuid_idx" ON "referral_requests"("acceptedByGuid");
CREATE INDEX IF NOT EXISTS "referral_requests_cancelledByGuid_idx" ON "referral_requests"("cancelledByGuid");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_branchGuid_fkey') THEN ALTER TABLE "users" ADD CONSTRAINT "users_branchGuid_fkey" FOREIGN KEY ("branchGuid") REFERENCES "branches"("guid") ON DELETE SET NULL NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patients_branchGuid_fkey') THEN ALTER TABLE "patients" ADD CONSTRAINT "patients_branchGuid_fkey" FOREIGN KEY ("branchGuid") REFERENCES "branches"("guid") ON DELETE SET NULL NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patients_createdByGuid_fkey') THEN ALTER TABLE "patients" ADD CONSTRAINT "patients_createdByGuid_fkey" FOREIGN KEY ("createdByGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_patientGuid_fkey') THEN ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_patientGuid_fkey" FOREIGN KEY ("patientGuid") REFERENCES "patients"("guid") ON DELETE RESTRICT NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_createdByGuid_fkey') THEN ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_createdByGuid_fkey" FOREIGN KEY ("createdByGuid") REFERENCES "users"("guid") ON DELETE RESTRICT NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_assignedReviewerGuid_fkey') THEN ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_assignedReviewerGuid_fkey" FOREIGN KEY ("assignedReviewerGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_destinationCenterGuid_fkey') THEN ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_destinationCenterGuid_fkey" FOREIGN KEY ("destinationCenterGuid") REFERENCES "centers"("guid") ON DELETE SET NULL NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_statusChangedByGuid_fkey') THEN ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_statusChangedByGuid_fkey" FOREIGN KEY ("statusChangedByGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_reviewedByGuid_fkey') THEN ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_reviewedByGuid_fkey" FOREIGN KEY ("reviewedByGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_acceptedByGuid_fkey') THEN ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_acceptedByGuid_fkey" FOREIGN KEY ("acceptedByGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_cancelledByGuid_fkey') THEN ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_cancelledByGuid_fkey" FOREIGN KEY ("cancelledByGuid") REFERENCES "users"("guid") ON DELETE SET NULL NOT VALID; END IF;
END $$;

ALTER TABLE "users" VALIDATE CONSTRAINT "users_branchGuid_fkey";
ALTER TABLE "patients" VALIDATE CONSTRAINT "patients_branchGuid_fkey";
ALTER TABLE "patients" VALIDATE CONSTRAINT "patients_createdByGuid_fkey";
ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_patientGuid_fkey";
ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_createdByGuid_fkey";
ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_assignedReviewerGuid_fkey";
ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_destinationCenterGuid_fkey";
ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_statusChangedByGuid_fkey";
ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_reviewedByGuid_fkey";
ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_acceptedByGuid_fkey";
ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_cancelledByGuid_fkey";

CREATE OR REPLACE FUNCTION tahili_sync_users_branch_guid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."branchId" IS NULL THEN NEW."branchGuid" := NULL;
  ELSE SELECT "guid" INTO NEW."branchGuid" FROM "branches" WHERE "id" = NEW."branchId"; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_users_branch_guid ON "users";
CREATE TRIGGER trg_tahili_sync_users_branch_guid BEFORE INSERT OR UPDATE OF "branchId", "branchGuid" ON "users" FOR EACH ROW EXECUTE FUNCTION tahili_sync_users_branch_guid();

CREATE OR REPLACE FUNCTION tahili_sync_patients_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."branchId" IS NULL THEN NEW."branchGuid" := NULL;
  ELSE SELECT "guid" INTO NEW."branchGuid" FROM "branches" WHERE "id" = NEW."branchId"; END IF;
  IF NEW."createdById" IS NULL THEN NEW."createdByGuid" := NULL;
  ELSE SELECT "guid" INTO NEW."createdByGuid" FROM "users" WHERE "id" = NEW."createdById"; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_patients_shadow_guids ON "patients";
CREATE TRIGGER trg_tahili_sync_patients_shadow_guids BEFORE INSERT OR UPDATE OF "branchId", "branchGuid", "createdById", "createdByGuid" ON "patients" FOR EACH ROW EXECUTE FUNCTION tahili_sync_patients_shadow_guids();

CREATE OR REPLACE FUNCTION tahili_sync_referral_shadow_guids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT "guid" INTO NEW."patientGuid" FROM "patients" WHERE "id" = NEW."patientId";
  SELECT "guid" INTO NEW."createdByGuid" FROM "users" WHERE "id" = NEW."createdById";
  IF NEW."assignedReviewerId" IS NULL THEN NEW."assignedReviewerGuid" := NULL; ELSE SELECT "guid" INTO NEW."assignedReviewerGuid" FROM "users" WHERE "id" = NEW."assignedReviewerId"; END IF;
  IF NEW."destinationCenterId" IS NULL THEN NEW."destinationCenterGuid" := NULL; ELSE SELECT "guid" INTO NEW."destinationCenterGuid" FROM "centers" WHERE "id" = NEW."destinationCenterId"; END IF;
  IF NEW."statusChangedById" IS NULL THEN NEW."statusChangedByGuid" := NULL; ELSE SELECT "guid" INTO NEW."statusChangedByGuid" FROM "users" WHERE "id" = NEW."statusChangedById"; END IF;
  IF NEW."reviewedById" IS NULL THEN NEW."reviewedByGuid" := NULL; ELSE SELECT "guid" INTO NEW."reviewedByGuid" FROM "users" WHERE "id" = NEW."reviewedById"; END IF;
  IF NEW."acceptedById" IS NULL THEN NEW."acceptedByGuid" := NULL; ELSE SELECT "guid" INTO NEW."acceptedByGuid" FROM "users" WHERE "id" = NEW."acceptedById"; END IF;
  IF NEW."cancelledById" IS NULL THEN NEW."cancelledByGuid" := NULL; ELSE SELECT "guid" INTO NEW."cancelledByGuid" FROM "users" WHERE "id" = NEW."cancelledById"; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tahili_sync_referral_shadow_guids ON "referral_requests";
CREATE TRIGGER trg_tahili_sync_referral_shadow_guids BEFORE INSERT OR UPDATE OF "patientId", "patientGuid", "createdById", "createdByGuid", "assignedReviewerId", "assignedReviewerGuid", "destinationCenterId", "destinationCenterGuid", "statusChangedById", "statusChangedByGuid", "reviewedById", "reviewedByGuid", "acceptedById", "acceptedByGuid", "cancelledById", "cancelledByGuid" ON "referral_requests" FOR EACH ROW EXECUTE FUNCTION tahili_sync_referral_shadow_guids();
'@

if (Test-Path -LiteralPath $migrationFile) {
    $existing = Get-Content -LiteralPath $migrationFile -Raw
    if ($existing.Trim() -ne $migrationSql.Trim()) { throw "Existing shadow FK migration differs from expected content. Stop for review." }
} else {
    [System.IO.File]::WriteAllText($migrationFile, $migrationSql, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "Schema and guarded migration prepared."

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile", "checks", "build", "checks")

Write-Host ""
Write-Host "=== PRISMA VALIDATE ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "prisma", "validate", "--schema", "prisma/schema.prisma")

Write-Host ""
Write-Host "=== MIGRATE DEPLOY (LOCAL CLONE ONLY) ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "prisma", "migrate", "deploy")

$verifySql = @'
SELECT 'users.branchGuid' AS k, count(*) FILTER (WHERE u."branchId" IS NOT NULL AND (u."branchGuid" IS NULL OR u."branchGuid" IS DISTINCT FROM b."guid")) AS bad FROM "users" u LEFT JOIN "branches" b ON b."id"=u."branchId"
UNION ALL SELECT 'patients.branchGuid', count(*) FILTER (WHERE p."branchId" IS NOT NULL AND (p."branchGuid" IS NULL OR p."branchGuid" IS DISTINCT FROM b."guid")) FROM "patients" p LEFT JOIN "branches" b ON b."id"=p."branchId"
UNION ALL SELECT 'patients.createdByGuid', count(*) FILTER (WHERE p."createdById" IS NOT NULL AND (p."createdByGuid" IS NULL OR p."createdByGuid" IS DISTINCT FROM u."guid")) FROM "patients" p LEFT JOIN "users" u ON u."id"=p."createdById"
UNION ALL SELECT 'referral.patientGuid', count(*) FILTER (WHERE r."patientGuid" IS NULL OR r."patientGuid" IS DISTINCT FROM p."guid") FROM "referral_requests" r LEFT JOIN "patients" p ON p."id"=r."patientId"
UNION ALL SELECT 'referral.createdByGuid', count(*) FILTER (WHERE r."createdByGuid" IS NULL OR r."createdByGuid" IS DISTINCT FROM u."guid") FROM "referral_requests" r LEFT JOIN "users" u ON u."id"=r."createdById"
UNION ALL SELECT 'referral.assignedReviewerGuid', count(*) FILTER (WHERE r."assignedReviewerId" IS NOT NULL AND (r."assignedReviewerGuid" IS NULL OR r."assignedReviewerGuid" IS DISTINCT FROM u."guid")) FROM "referral_requests" r LEFT JOIN "users" u ON u."id"=r."assignedReviewerId"
UNION ALL SELECT 'referral.destinationCenterGuid', count(*) FILTER (WHERE r."destinationCenterId" IS NOT NULL AND (r."destinationCenterGuid" IS NULL OR r."destinationCenterGuid" IS DISTINCT FROM c."guid")) FROM "referral_requests" r LEFT JOIN "centers" c ON c."id"=r."destinationCenterId"
UNION ALL SELECT 'referral.statusChangedByGuid', count(*) FILTER (WHERE r."statusChangedById" IS NOT NULL AND (r."statusChangedByGuid" IS NULL OR r."statusChangedByGuid" IS DISTINCT FROM u."guid")) FROM "referral_requests" r LEFT JOIN "users" u ON u."id"=r."statusChangedById"
UNION ALL SELECT 'referral.reviewedByGuid', count(*) FILTER (WHERE r."reviewedById" IS NOT NULL AND (r."reviewedByGuid" IS NULL OR r."reviewedByGuid" IS DISTINCT FROM u."guid")) FROM "referral_requests" r LEFT JOIN "users" u ON u."id"=r."reviewedById"
UNION ALL SELECT 'referral.acceptedByGuid', count(*) FILTER (WHERE r."acceptedById" IS NOT NULL AND (r."acceptedByGuid" IS NULL OR r."acceptedByGuid" IS DISTINCT FROM u."guid")) FROM "referral_requests" r LEFT JOIN "users" u ON u."id"=r."acceptedById"
UNION ALL SELECT 'referral.cancelledByGuid', count(*) FILTER (WHERE r."cancelledById" IS NOT NULL AND (r."cancelledByGuid" IS NULL OR r."cancelledByGuid" IS DISTINCT FROM u."guid")) FROM "referral_requests" r LEFT JOIN "users" u ON u."id"=r."cancelledById"
ORDER BY 1;
'@
$verify = Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $verifySql)
foreach ($line in ($verify -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split '\|'
    if ($parts.Count -ne 2 -or [int64]$parts[1] -ne 0) { throw "Shadow GUID verification failed: $line" }
}

$constraintSql = @'
SELECT count(*)
FROM pg_constraint
WHERE conname IN (
'users_branchGuid_fkey','patients_branchGuid_fkey','patients_createdByGuid_fkey',
'referral_requests_patientGuid_fkey','referral_requests_createdByGuid_fkey','referral_requests_assignedReviewerGuid_fkey',
'referral_requests_destinationCenterGuid_fkey','referral_requests_statusChangedByGuid_fkey','referral_requests_reviewedByGuid_fkey',
'referral_requests_acceptedByGuid_fkey','referral_requests_cancelledByGuid_fkey'
) AND convalidated;
'@
$constraintCount = [int](Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $constraintSql))
if ($constraintCount -ne 11) { throw "Expected 11 validated shadow GUID foreign keys, found $constraintCount" }

$triggerSql = @'
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
'trg_tahili_sync_users_branch_guid','trg_tahili_sync_patients_shadow_guids','trg_tahili_sync_referral_shadow_guids'
) AND tgenabled <> 'D';
'@
$triggerCount = [int](Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $triggerSql))
if ($triggerCount -ne 3) { throw "Expected 3 enabled synchronization triggers, found $triggerCount" }

$postCounts = Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $preSql)
if ($postCounts.Trim() -ne $preCounts.Trim()) { throw "Row counts changed during shadow FK migration.`nBefore:`n$preCounts`nAfter:`n$postCounts" }

Write-Host "Shadow FK database verification: PASS"

Write-Host ""
Write-Host "=== TYPESCRIPT ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "tsc", "--noEmit")

Write-Host ""
Write-Host "=== FULL UNIT TESTS ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "vitest", "run")

Write-Host ""
Write-Host "=== PROJECT AUDIT ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "node", "scripts/audit-project.mjs")

Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "prisma", "migrate", "status")

$login = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/login" -TimeoutSec 20
if ($login.StatusCode -ne 200 -or $login.Content -notmatch '<form') { throw "Login page smoke failed." }
Write-Host "Login page smoke: PASS"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$audit = Join-Path $auditDir "07-PHASE1-GUID-SHADOW-FK-BATCH1.md"
$report = @"
# Phase 1 GUID Foundation - Shadow FK Batch 1

Status: PASS

Gates:
- Phase 0 backup/verify/isolated restore: PASS
- Wave 1 foundation GUIDs: PASS

Shadow GUID foreign keys added and backfilled:
- User -> Branch: branchGuid
- Patient -> Branch: branchGuid
- Patient -> User(createdBy): createdByGuid
- ReferralRequest -> Patient: patientGuid
- ReferralRequest -> User(createdBy): createdByGuid
- ReferralRequest -> User(assignedReviewer): assignedReviewerGuid
- ReferralRequest -> Center(destinationCenter): destinationCenterGuid
- ReferralRequest -> User(statusChangedBy): statusChangedByGuid
- ReferralRequest -> User(reviewedBy): reviewedByGuid
- ReferralRequest -> User(acceptedBy): acceptedByGuid
- ReferralRequest -> User(cancelledBy): cancelledByGuid

Safety:
- Legacy IDs retained and remain authoritative.
- No legacy FK or PK removed or changed.
- 11 UUID FK constraints validated.
- 3 synchronization triggers enabled for legacy writes.
- Source row counts unchanged.
- No prisma db push used.

Verification:
- Shadow GUID mismatch/orphan check: PASS
- TypeScript: PASS
- Full Vitest suite: PASS
- Project audit: PASS
- Prisma migration status: PASS
- Login page smoke: PASS

Rollback snapshot: $rollbackDir
"@
$report | Set-Content -LiteralPath $audit -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 1 GUID SHADOW FK BATCH 1: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
