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

function Add-GuidFieldToModel {
    param(
        [Parameter(Mandatory = $true)][string]$SchemaText,
        [Parameter(Mandatory = $true)][string]$ModelName
    )

    $pattern = "(?ms)(model\s+$([regex]::Escape($ModelName))\s*\{.*?^\})"
    $match = [regex]::Match($SchemaText, $pattern)
    if (-not $match.Success) {
        throw "Model not found in Prisma schema: $ModelName"
    }

    $block = $match.Groups[1].Value
    if ($block -match "(?m)^\s*guid\s+") {
        return $SchemaText
    }

    $lines = $block -split "`r?`n"
    $output = New-Object System.Collections.Generic.List[string]
    $inserted = $false

    foreach ($line in $lines) {
        $output.Add($line)
        if (-not $inserted -and $line -match "^\s*id\s+\S+\s+@id\b") {
            $output.Add('  guid String @unique @default(dbgenerated("gen_random_uuid()")) @db.Uuid')
            $inserted = $true
        }
    }

    if (-not $inserted) {
        throw "Primary id field not found in model: $ModelName"
    }

    $newBlock = $output -join "`n"
    return $SchemaText.Substring(0, $match.Index) + $newBlock + $SchemaText.Substring($match.Index + $match.Length)
}

function Test-Phase0Gate {
    $report = Join-Path $Project "_PHASE01_AUDIT\05-PHASE0-LOCAL-CLONE-BACKUP.md"
    if (-not (Test-Path -LiteralPath $report -PathType Leaf)) {
        throw "Phase 0 PASS report is missing: $report"
    }
    $text = Get-Content -LiteralPath $report -Raw
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$" -or $text -notmatch "(?mi)Isolated restore:\s*") {
        throw "Phase 0 gate is not proven PASS."
    }
    return $report
}

Write-Host ""
Write-Host "=== PHASE 1 GUID FOUNDATION - WAVE 1 ==="
Write-Host "Project: $Project"

# ---------- Hard gate ----------
$phase0Report = Test-Phase0Gate
Write-Host "Phase 0 gate: PASS"
Write-Host "Evidence: $phase0Report"

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Engine is not running."
}

foreach ($file in @(".env.saif-dev", "docker-compose.saif-dev.yml", "prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Required file missing: $file"
    }
}

$envMap = @{}
foreach ($line in Get-Content -LiteralPath ".env.saif-dev") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $key = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
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

# ---------- Pre-change snapshot ----------
$preSql = @'
SELECT 'users', count(*) FROM "users"
UNION ALL SELECT 'patients', count(*) FROM "patients"
UNION ALL SELECT 'branches', count(*) FROM "branches"
UNION ALL SELECT 'centers', count(*) FROM "centers"
UNION ALL SELECT 'referral_requests', count(*) FROM "referral_requests"
ORDER BY 1;
'@
$preCounts = Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $preSql)

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir = Join-Path $Project (Join-Path ".secrets\phase1-guid" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force
$preCounts | Set-Content -LiteralPath (Join-Path $rollbackDir "row-counts.before.txt") -Encoding UTF8

Write-Host "Pre-change snapshot: $rollbackDir"

# ---------- Additive Prisma schema change ----------
$schemaPath = Join-Path $Project "prisma\schema.prisma"
$schema = Get-Content -LiteralPath $schemaPath -Raw
foreach ($model in @("User", "Patient", "Branch", "Center", "ReferralRequest")) {
    $schema = Add-GuidFieldToModel -SchemaText $schema -ModelName $model
}
[System.IO.File]::WriteAllText($schemaPath, $schema, (New-Object System.Text.UTF8Encoding($false)))

# ---------- Additive migration ----------
$migrationDir = Join-Path $Project "prisma\migrations\20260913003000_phase1_guid_foundation_wave1"
$migrationFile = Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null

$migrationSql = @'
-- Phase 1 GUID Foundation - Wave 1
-- Additive only: preserve all legacy primary keys and foreign keys.
-- Database defaults keep the currently running legacy application compatible.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "guid" UUID;
ALTER TABLE "users" ALTER COLUMN "guid" SET DEFAULT gen_random_uuid();
UPDATE "users" SET "guid" = gen_random_uuid() WHERE "guid" IS NULL;
ALTER TABLE "users" ALTER COLUMN "guid" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "users_guid_key" ON "users"("guid");

ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "guid" UUID;
ALTER TABLE "patients" ALTER COLUMN "guid" SET DEFAULT gen_random_uuid();
UPDATE "patients" SET "guid" = gen_random_uuid() WHERE "guid" IS NULL;
ALTER TABLE "patients" ALTER COLUMN "guid" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "patients_guid_key" ON "patients"("guid");

ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "guid" UUID;
ALTER TABLE "branches" ALTER COLUMN "guid" SET DEFAULT gen_random_uuid();
UPDATE "branches" SET "guid" = gen_random_uuid() WHERE "guid" IS NULL;
ALTER TABLE "branches" ALTER COLUMN "guid" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "branches_guid_key" ON "branches"("guid");

ALTER TABLE "centers" ADD COLUMN IF NOT EXISTS "guid" UUID;
ALTER TABLE "centers" ALTER COLUMN "guid" SET DEFAULT gen_random_uuid();
UPDATE "centers" SET "guid" = gen_random_uuid() WHERE "guid" IS NULL;
ALTER TABLE "centers" ALTER COLUMN "guid" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "centers_guid_key" ON "centers"("guid");

ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "guid" UUID;
ALTER TABLE "referral_requests" ALTER COLUMN "guid" SET DEFAULT gen_random_uuid();
UPDATE "referral_requests" SET "guid" = gen_random_uuid() WHERE "guid" IS NULL;
ALTER TABLE "referral_requests" ALTER COLUMN "guid" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "referral_requests_guid_key" ON "referral_requests"("guid");
'@

if (Test-Path -LiteralPath $migrationFile) {
    $existing = Get-Content -LiteralPath $migrationFile -Raw
    if ($existing.Trim() -ne $migrationSql.Trim()) {
        throw "Existing Wave 1 migration differs from the expected guarded migration. Stop for review."
    }
}
else {
    [System.IO.File]::WriteAllText($migrationFile, $migrationSql, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "Schema and migration prepared."

# ---------- Build isolated checks image from current worktree ----------
Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile", "checks", "build", "checks")

# Prisma format is executed against the source inside the checks image only; local schema remains logically identical.
Write-Host ""
Write-Host "=== PRISMA VALIDATE ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "prisma", "validate", "--schema", "prisma/schema.prisma")

# ---------- Apply additive migration to local production clone ----------
Write-Host ""
Write-Host "=== MIGRATE DEPLOY (LOCAL CLONE ONLY) ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "prisma", "migrate", "deploy")

# ---------- Database verification ----------
$verifySql = @'
WITH checks AS (
  SELECT 'users' AS table_name, count(*)::bigint AS rows, count(guid)::bigint AS with_guid, count(DISTINCT guid)::bigint AS distinct_guid FROM "users"
  UNION ALL SELECT 'patients', count(*)::bigint, count(guid)::bigint, count(DISTINCT guid)::bigint FROM "patients"
  UNION ALL SELECT 'branches', count(*)::bigint, count(guid)::bigint, count(DISTINCT guid)::bigint FROM "branches"
  UNION ALL SELECT 'centers', count(*)::bigint, count(guid)::bigint, count(DISTINCT guid)::bigint FROM "centers"
  UNION ALL SELECT 'referral_requests', count(*)::bigint, count(guid)::bigint, count(DISTINCT guid)::bigint FROM "referral_requests"
)
SELECT table_name || '|' || rows || '|' || with_guid || '|' || distinct_guid FROM checks ORDER BY table_name;
'@
$guidMetrics = Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $verifySql)

foreach ($line in ($guidMetrics -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split '\|'
    if ($parts.Count -ne 4) { throw "Unexpected GUID verification row: $line" }
    if ([int64]$parts[1] -ne [int64]$parts[2] -or [int64]$parts[1] -ne [int64]$parts[3]) {
        throw "GUID verification failed for $($parts[0]): $line"
    }
}

$typeSql = @'
SELECT table_name || '|' || data_type || '|' || is_nullable || '|' || COALESCE(column_default,'')
FROM information_schema.columns
WHERE table_schema='public'
  AND column_name='guid'
  AND table_name IN ('users','patients','branches','centers','referral_requests')
ORDER BY table_name;
'@
$columnMetrics = Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $typeSql)
$columnLines = @($columnMetrics -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($columnLines.Count -ne 5) {
    throw "Expected 5 GUID columns but found $($columnLines.Count)."
}
foreach ($line in $columnLines) {
    $parts = $line -split '\|', 4
    if ($parts[1] -ne "uuid" -or $parts[2] -ne "NO" -or $parts[3] -notmatch "gen_random_uuid") {
        throw "Unexpected GUID column definition: $line"
    }
}

Write-Host "GUID backfill and database constraints: PASS"

# ---------- Required verification ----------
Write-Host ""
Write-Host "=== PRISMA GENERATE ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "prisma", "generate")

Write-Host ""
Write-Host "=== TYPESCRIPT ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "tsc", "--noEmit")

Write-Host ""
Write-Host "=== FULL UNIT TEST SUITE ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "vitest", "run")

Write-Host ""
Write-Host "=== PROJECT AUDIT ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "node", "scripts/audit-project.mjs")

Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "prisma", "migrate", "status")

# Running legacy app must remain reachable; DB defaults make this additive migration backward-compatible.
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/login" -UseBasicParsing -TimeoutSec 15
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
        throw "Login page returned HTTP $($response.StatusCode)"
    }
    Write-Host "Login page smoke: PASS"
}
catch {
    throw "Login page smoke failed: $($_.Exception.Message)"
}

$postCounts = Get-ComposeText @("exec", "-T", "postgres", "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $preSql)
if ($postCounts.Trim() -ne $preCounts.Trim()) {
    throw "Row counts changed unexpectedly during Wave 1.`nBefore:`n$preCounts`nAfter:`n$postCounts"
}

# ---------- Documentation ----------
$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$audit = Join-Path $auditDir "06-PHASE1-GUID-FOUNDATION-WAVE1.md"

$report = @"
# Phase 1 - GUID Foundation - Wave 1

Status: PASS

Phase 0 gate evidence:
$phase0Report

Scope:
- User -> users.guid UUID
- Patient -> patients.guid UUID
- Branch -> branches.guid UUID
- Center -> centers.guid UUID
- ReferralRequest -> referral_requests.guid UUID

Migration:
prisma/migrations/20260913003000_phase1_guid_foundation_wave1/migration.sql

Safety properties:
- Additive only.
- Legacy primary keys remain unchanged.
- Legacy foreign keys remain unchanged.
- No direct CUID/Int to UUID cast.
- Existing rows backfilled with real PostgreSQL UUID values.
- Database default gen_random_uuid() protects inserts from the still-running legacy app.
- GUID columns are NOT NULL and UNIQUE after backfill.
- No prisma db push used.
- No application restart performed by this runner.

Row counts before/after:
$preCounts

GUID verification (table|rows|with_guid|distinct_guid):
$guidMetrics

Column verification (table|type|nullable|default):
$columnMetrics

Verification:
- Prisma validate: PASS
- Prisma migrate deploy: PASS
- Prisma generate: PASS
- TypeScript: PASS
- Full Vitest suite: PASS
- Project audit: PASS
- Prisma migration status: PASS
- Login page smoke: PASS
- Row counts unchanged: PASS

Rollback/reference snapshot:
$rollbackDir

Next step:
Wave 2 shadow foreign-key design and dual-operation planning. Do not remove or switch legacy IDs yet.
"@

$report | Set-Content -LiteralPath $audit -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 1 GUID FOUNDATION WAVE 1: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
