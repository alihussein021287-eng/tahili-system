$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

$MigrationName = "20260913032000_phase2_staff_unit_foundation"
$MigrationFile = Join-Path $Project "prisma\migrations\$MigrationName\migration.sql"
$SchemaFile = Join-Path $Project "prisma\schema.prisma"

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
}

Write-Host ""
Write-Host "=== PHASE 2 RECOVERY: min(uuid) ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\05-PHASE0-LOCAL-CLONE-BACKUP.md" "Phase 0"
Test-PassReport "_PHASE01_AUDIT\06-PHASE1-GUID-FOUNDATION-WAVE1.md" "Phase 1 Wave 1"
Test-PassReport "_PHASE01_AUDIT\07-PHASE1-GUID-SHADOW-FK-BATCH1.md" "Phase 1 Batch 1"
Test-PassReport "_PHASE01_AUDIT\08-PHASE1-GUID-SHADOW-FK-BATCH2.md" "Phase 1 Batch 2"
Test-PassReport "_PHASE01_AUDIT\09-PHASE1-GUID-SHADOW-FK-BATCH3.md" "Phase 1 Batch 3"
Write-Host "Previous gates: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml",$SchemaFile,$MigrationFile)) {
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

# The failed statement used min(uuid), which PostgreSQL does not provide.
# Cast to text only for the unique-row aggregate, then cast the result back to uuid.
$migration = Get-Content -LiteralPath $MigrationFile -Raw
$bad = 'min("guid") AS user_guid'
$good = 'min("guid"::text)::uuid AS user_guid'
if ($migration.Contains($bad)) {
    $migration = $migration.Replace($bad,$good)
    [System.IO.File]::WriteAllText($MigrationFile,$migration,(New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Migration SQL min(uuid) fix: APPLIED"
} elseif ($migration.Contains($good)) {
    Write-Host "Migration SQL min(uuid) fix: already present"
} else {
    throw "Expected min(uuid) expression was not found. Stop for review."
}

$schema = Get-Content -LiteralPath $SchemaFile -Raw
foreach ($model in @("Unit","StaffMember","UserUnitMembership")) {
    if ($schema -notmatch "(?m)^model\s+$model\s*\{") { throw "Expected Phase 2 model missing from local Prisma schema: $model" }
}
Write-Host "Phase 2 Prisma schema additions: PRESENT"

# Locate the original pre-migration legacy count snapshot from the failed attempt.
$rollbackRoot = Join-Path $Project ".secrets\phase2-staff-unit"
$rollbackDir = $null
$legacyCountsBefore = $null
if (Test-Path -LiteralPath $rollbackRoot -PathType Container) {
    $candidate = Get-ChildItem -LiteralPath $rollbackRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -ne $candidate) {
        $beforePath = Join-Path $candidate.FullName "legacy-row-counts.before.txt"
        if (Test-Path -LiteralPath $beforePath -PathType Leaf) {
            $rollbackDir = $candidate.FullName
            $legacyCountsBefore = (Get-Content -LiteralPath $beforePath -Raw).Trim()
        }
    }
}
if ($null -eq $legacyCountsBefore) { throw "Phase 2 pre-migration legacy row-count snapshot not found. Stop for review." }
Write-Host "Original rollback snapshot: $rollbackDir"

$failedSql = @'
SELECT count(*)
FROM "_prisma_migrations"
WHERE migration_name='20260913032000_phase2_staff_unit_foundation'
  AND finished_at IS NULL
  AND rolled_back_at IS NULL;
'@
$failedCount = [int](Invoke-PsqlText $failedSql)

Write-Host ""
Write-Host "=== REBUILD CHECKS IMAGE WITH FIXED MIGRATION ==="
Invoke-Compose @("--profile","checks","build","checks")

if ($failedCount -gt 0) {
    Write-Host ""
    Write-Host "=== MARK FAILED MIGRATION ROLLED BACK ==="
    Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","resolve","--rolled-back",$MigrationName)
} else {
    Write-Host "No unresolved failed migration row found; continuing with guarded deploy."
}

Write-Host ""
Write-Host "=== PRISMA VALIDATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")

Write-Host ""
Write-Host "=== MIGRATE DEPLOY ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","deploy")

$migrationStateSql = @'
SELECT count(*)
FROM "_prisma_migrations"
WHERE migration_name='20260913032000_phase2_staff_unit_foundation'
  AND finished_at IS NOT NULL
  AND rolled_back_at IS NULL;
'@
if ([int](Invoke-PsqlText $migrationStateSql) -lt 1) { throw "Phase 2 migration is not recorded as successfully applied." }

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

$legacyCountsSql=@'
SELECT 'employees', count(*) FROM "Employee"
UNION ALL SELECT 'users', count(*) FROM "users"
UNION ALL SELECT 'attendance', count(*) FROM "Attendance"
UNION ALL SELECT 'shifts', count(*) FROM "Shift"
UNION ALL SELECT 'leaves', count(*) FROM "Leave"
ORDER BY 1;
'@
$legacyCountsAfter=Invoke-PsqlText $legacyCountsSql
if ($legacyCountsAfter.Trim() -ne $legacyCountsBefore.Trim()) {
    throw "Legacy row counts changed unexpectedly.`nBefore:`n$legacyCountsBefore`nAfter:`n$legacyCountsAfter"
}

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

Recovery:
- Original deploy stopped at PostgreSQL error 42883: min(uuid) does not exist.
- Migration expression corrected to min(guid::text)::uuid for the unique-name CTE.
- Failed Prisma migration record was marked rolled back before guarded re-deploy when required.
- Migration is additive/idempotent, so pre-error tables/data were safely reconciled on re-run.

New UUID models:
- Unit
- StaffMember
- UserUnitMembership

Safety:
- Existing Employee, Attendance, Shift and Leave tables remain untouched.
- No existing PK/FK removed.
- 4 new UUID FK constraints validated.
- Legacy row counts unchanged from the original pre-migration snapshot.
- No prisma db push.

Verification mappings (label|expected|actual):
$verify

Orphan checks:
$orphans

Ambiguous normalized names intentionally left without automatic Employee-to-User matching: $ambiguousNames

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

Original rollback snapshot: $rollbackDir

Next:
Attendance/Shift/Leave -> StaffMember UUID migration while preserving legacy name fields until cleanup.
"@
$report | Set-Content -LiteralPath $audit -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 2 STAFF + UNIT FOUNDATION: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Original rollback snapshot: $rollbackDir"
