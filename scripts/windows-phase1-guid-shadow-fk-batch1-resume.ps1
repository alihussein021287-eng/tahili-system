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

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Invoke-Docker ($Compose + $Arguments)
}

function Get-ComposeText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & docker @($Compose + $Arguments) 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose command failed: docker $((($Compose + $Arguments) -join ' '))`n$($output | Out-String)"
    }
    return (($output | Out-String).Trim())
}

function Invoke-PsqlText {
    param([Parameter(Mandatory = $true)][string]$Sql)

    # Send SQL over stdin. This preserves PostgreSQL quoted camelCase identifiers
    # on Windows PowerShell 5.1 and avoids native-argument quote stripping.
    $args = $Compose + @(
        "exec", "-T", "postgres",
        "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", $script:dbUser,
        "-d", $script:dbName,
        "-Atq"
    )

    $output = $Sql | & docker @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "psql verification failed.`n$($output | Out-String)"
    }
    return (($output | Out-String).Trim())
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

Write-Host ""
Write-Host "=== RESUME: PHASE 1 GUID SHADOW FK BATCH 1 ==="
Write-Host "Project: $Project"

$phase0 = Test-PassReport -RelativePath "_PHASE01_AUDIT\05-PHASE0-LOCAL-CLONE-BACKUP.md" -Label "Phase 0"
$wave1 = Test-PassReport -RelativePath "_PHASE01_AUDIT\06-PHASE1-GUID-FOUNDATION-WAVE1.md" -Label "Wave 1"
Write-Host "Phase 0 gate: PASS"
Write-Host "Wave 1 gate: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }

foreach ($file in @(".env.saif-dev", "docker-compose.saif-dev.yml", "prisma\schema.prisma", "prisma\migrations\20260913014500_phase1_guid_shadow_fk_batch1\migration.sql")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Required local file missing: $file"
    }
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

$script:dbUser = $envMap["DB_USER"]
$script:dbName = $envMap["DB_NAME"]
if ([string]::IsNullOrWhiteSpace($script:dbUser) -or [string]::IsNullOrWhiteSpace($script:dbName)) {
    throw "DB_USER or DB_NAME is missing from .env.saif-dev"
}

$postgresId = Get-ComposeText @("ps", "-q", "postgres")
$appId = Get-ComposeText @("ps", "-q", "app")
if ([string]::IsNullOrWhiteSpace($postgresId) -or [string]::IsNullOrWhiteSpace($appId)) {
    throw "Local Tahili stack is not running."
}

$schemaText = Get-Content -LiteralPath "prisma\schema.prisma" -Raw
foreach ($field in @("branchGuid", "createdByGuid", "patientGuid", "assignedReviewerGuid", "destinationCenterGuid", "statusChangedByGuid", "reviewedByGuid", "acceptedByGuid", "cancelledByGuid")) {
    if ($schemaText -notmatch "(?m)^\s*$([regex]::Escape($field))\s+") {
        throw "Expected local Prisma shadow field is missing: $field"
    }
}
Write-Host "Local Prisma shadow fields: PASS"

$migrationStateSql = @'
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM "_prisma_migrations"
    WHERE migration_name = '20260913014500_phase1_guid_shadow_fk_batch1'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) THEN 'PASS' ELSE 'FAIL' END;
'@
$migrationState = Invoke-PsqlText $migrationStateSql
if ($migrationState.Trim() -ne "PASS") {
    throw "Shadow FK Batch 1 migration is not recorded as successfully applied."
}
Write-Host "Applied migration record: PASS"

$columnSql = @'
SELECT count(*)
FROM information_schema.columns
WHERE table_schema='public'
  AND data_type='uuid'
  AND (
    (table_name='users' AND column_name='branchGuid') OR
    (table_name='patients' AND column_name IN ('branchGuid','createdByGuid')) OR
    (table_name='referral_requests' AND column_name IN ('patientGuid','createdByGuid','assignedReviewerGuid','destinationCenterGuid','statusChangedByGuid','reviewedByGuid','acceptedByGuid','cancelledByGuid'))
  );
'@
$columnCount = [int](Invoke-PsqlText $columnSql)
if ($columnCount -ne 11) {
    throw "Expected 11 UUID shadow columns, found $columnCount"
}

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
$verify = Invoke-PsqlText $verifySql
foreach ($line in ($verify -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split '\|'
    if ($parts.Count -ne 2 -or [int64]$parts[1] -ne 0) {
        throw "Shadow GUID verification failed: $line"
    }
}
Write-Host "Shadow GUID backfill/mismatch check: PASS"

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
$constraintCount = [int](Invoke-PsqlText $constraintSql)
if ($constraintCount -ne 11) {
    throw "Expected 11 validated shadow GUID foreign keys, found $constraintCount"
}
Write-Host "Validated shadow FK constraints: PASS (11/11)"

$triggerSql = @'
SELECT count(*)
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN (
'trg_tahili_sync_users_branch_guid','trg_tahili_sync_patients_shadow_guids','trg_tahili_sync_referral_shadow_guids'
  )
  AND tgenabled <> 'D';
'@
$triggerCount = [int](Invoke-PsqlText $triggerSql)
if ($triggerCount -ne 3) {
    throw "Expected 3 enabled synchronization triggers, found $triggerCount"
}
Write-Host "Synchronization triggers: PASS (3/3)"

$countsSql = @'
SELECT 'users', count(*) FROM "users"
UNION ALL SELECT 'patients', count(*) FROM "patients"
UNION ALL SELECT 'referral_requests', count(*) FROM "referral_requests"
ORDER BY 1;
'@
$postCounts = Invoke-PsqlText $countsSql

$rollbackRoot = Join-Path $Project ".secrets\phase1-guid-shadow"
$rollbackDir = $null
$preCounts = $null
if (Test-Path -LiteralPath $rollbackRoot -PathType Container) {
    $candidate = Get-ChildItem -LiteralPath $rollbackRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -ne $candidate) {
        $beforePath = Join-Path $candidate.FullName "row-counts.before.txt"
        if (Test-Path -LiteralPath $beforePath -PathType Leaf) {
            $rollbackDir = $candidate.FullName
            $preCounts = (Get-Content -LiteralPath $beforePath -Raw).Trim()
        }
    }
}
if ($null -ne $preCounts -and $postCounts.Trim() -ne $preCounts) {
    throw "Row counts changed during shadow FK migration.`nBefore:`n$preCounts`nAfter:`n$postCounts"
}
if ($null -ne $preCounts) {
    Write-Host "Source row counts unchanged: PASS"
} else {
    Write-Host "Source row-count snapshot not found; database integrity checks remain authoritative."
}

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile", "checks", "build", "checks")

Write-Host ""
Write-Host "=== PRISMA VALIDATE ==="
Invoke-Compose @("--profile", "checks", "run", "--rm", "--no-deps", "checks", "npx", "prisma", "validate", "--schema", "prisma/schema.prisma")

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
if ($login.StatusCode -ne 200 -or $login.Content -notmatch '<form') {
    throw "Login page smoke failed."
}
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

Migration:
- 20260913014500_phase1_guid_shadow_fk_batch1: APPLIED

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
- No prisma db push used.
- No application restart performed.

Verification:
- Applied Prisma migration record: PASS
- 11 UUID shadow columns present: PASS
- Shadow GUID mismatch/orphan check: PASS
- 11 validated FK constraints: PASS
- 3 synchronization triggers: PASS
- Prisma validate: PASS
- TypeScript: PASS
- Full Vitest suite: PASS
- Project audit: PASS
- Prisma migration status: PASS
- Login page smoke: PASS
"@

if ($null -ne $preCounts) {
    $report += "`n- Source row counts unchanged: PASS`n"
}
if ($null -ne $rollbackDir) {
    $report += "`nRollback/reference snapshot: $rollbackDir`n"
}

$report | Set-Content -LiteralPath $audit -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 1 GUID SHADOW FK BATCH 1: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
if ($null -ne $rollbackDir) { Write-Host "Rollback snapshot: $rollbackDir" }
