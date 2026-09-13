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
}

function Normalize-Lf([string]$Text) { return $Text.Replace("`r`n","`n") }
function Write-Utf8NoBom([string]$Path,[string]$Text) {
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ""
Write-Host "=== PHASE 4 REFERRAL DESTINATION UNIT BINDING ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\18-PHASE4-REFERRAL-ROUTING-INVENTORY.md" "Phase 4 referral routing inventory"
Test-PassReport "_PHASE01_AUDIT\19-PHASE4-REFERRAL-WORKITEM-ROUTING.md" "Phase 4 referral WorkItem routing"
Test-PassReport "_PHASE01_AUDIT\20-PHASE4-WORKITEM-SCOPE-INVENTORY.md" "Phase 4 WorkItem scope inventory"
Test-PassReport "_PHASE01_AUDIT\21-PHASE4-NOTIFICATION-SCOPE-INVENTORY.md" "Phase 4 notification scope inventory"
Test-PassReport "_PHASE01_AUDIT\22-PHASE4-WORKITEM-POLICY-UNIT-NOTIFY.md" "Phase 4 WorkItem policy + Unit notify"
Write-Host "Prerequisite reports: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$envMap=@{}
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

$mappingPreflight=@'
WITH unit_names AS (
  SELECT lower(btrim("name")) AS k, count(*) AS c
  FROM "units"
  WHERE "active"=true AND NULLIF(btrim("name"),'') IS NOT NULL
  GROUP BY lower(btrim("name"))
), center_routes AS (
  SELECT r."id", r."destinationCenterId", c."name", un.c
  FROM "referral_requests" r
  LEFT JOIN "centers" c ON c."id"=r."destinationCenterId"
  LEFT JOIN unit_names un ON un.k=lower(btrim(c."name"))
  WHERE r."destinationScope"::text='INTERNAL_CENTER'
)
SELECT 'ambiguous_active_unit_names|' || (SELECT count(*) FROM unit_names WHERE c>1)
UNION ALL
SELECT 'internal_center_missing_unique_unit|' || (SELECT count(*) FROM center_routes WHERE "destinationCenterId" IS NULL OR "name" IS NULL OR c IS DISTINCT FROM 1)
ORDER BY 1;
'@
$preflight=Invoke-PsqlText $mappingPreflight
Write-Host $preflight
foreach ($line in ($preflight -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts=$line -split '\|'
    if ($parts.Count -ne 2 -or [int64]$parts[1] -ne 0) { throw "Referral destination Unit preflight failed: $line" }
}
Write-Host "Destination Unit mapping preflight: PASS"

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-referral-unit-binding" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force

$coreCountsSql=@'
SELECT 'referral_requests|' || count(*) FROM "referral_requests"
UNION ALL SELECT 'units|' || count(*) FROM "units"
UNION ALL SELECT 'centers|' || count(*) FROM "centers"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'notifications|' || count(*) FROM "Notification"
ORDER BY 1;
'@
$coreCountsBefore=Invoke-PsqlText $coreCountsSql
[System.IO.File]::WriteAllText((Join-Path $rollbackDir "row-counts.before.txt"),$coreCountsBefore,(New-Object System.Text.UTF8Encoding($true)))
Write-Host "Rollback snapshot: $rollbackDir"

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=Normalize-Lf ([System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8))
$modelPattern='(?ms)model\s+ReferralRequest\s*\{.*?^\}'
$modelMatch=[regex]::Match($schema,$modelPattern)
if (-not $modelMatch.Success) { throw "ReferralRequest model not found in local Prisma schema." }
$block=$modelMatch.Value

if ($block -notmatch '(?m)^\s*destinationUnitId\s+String\?\s+@db\.Uuid\s*$') {
    $anchor=[regex]::Match($block,'(?m)^\s*destinationCenter\s+Center\?.*$')
    if (-not $anchor.Success) { throw "ReferralRequest destinationCenter relation anchor not found. Stop for review." }
    $insertAt=$anchor.Index+$anchor.Length
    $block=$block.Substring(0,$insertAt)+"`n  destinationUnitId String? @db.Uuid"+$block.Substring($insertAt)
}
if ($block -notmatch '(?m)^\s*@@index\(\[destinationUnitId\]\)\s*$') {
    $close=$block.LastIndexOf("}")
    if ($close -lt 0) { throw "ReferralRequest model close not found." }
    $block=$block.Substring(0,$close).TrimEnd()+"`n`n  @@index([destinationUnitId])`n}"
}
$schema=$schema.Substring(0,$modelMatch.Index)+$block+$schema.Substring($modelMatch.Index+$modelMatch.Length)
Write-Utf8NoBom $schemaPath $schema
Write-Host "Prisma destinationUnitId field/index: PREPARED"

$migrationName="20260913060000_phase4_referral_unit_binding"
$migrationDir=Join-Path $Project "prisma\migrations\$migrationName"
$migrationFile=Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
$migrationSql=@'
-- Phase 4 - bind INTERNAL_CENTER referrals to an actual Unit UUID.
-- Additive only. destinationCenterId remains intact for compatibility.

ALTER TABLE "referral_requests" ADD COLUMN IF NOT EXISTS "destinationUnitId" UUID;

WITH unit_names AS (
  SELECT lower(btrim("name")) AS k,
         min("id"::text)::uuid AS unit_id,
         count(*) AS c
  FROM "units"
  WHERE "active"=true AND NULLIF(btrim("name"),'') IS NOT NULL
  GROUP BY lower(btrim("name"))
), resolved AS (
  SELECT r."id" AS referral_id, un.unit_id
  FROM "referral_requests" r
  JOIN "centers" c ON c."id"=r."destinationCenterId"
  JOIN unit_names un ON un.k=lower(btrim(c."name")) AND un.c=1
  WHERE r."destinationScope"::text='INTERNAL_CENTER'
)
UPDATE "referral_requests" r
SET "destinationUnitId"=resolved.unit_id
FROM resolved
WHERE r."id"=resolved.referral_id
  AND r."destinationUnitId" IS DISTINCT FROM resolved.unit_id;

CREATE INDEX IF NOT EXISTS "referral_requests_destinationUnitId_idx" ON "referral_requests"("destinationUnitId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='referral_requests_destinationUnitId_fkey') THEN
    ALTER TABLE "referral_requests"
      ADD CONSTRAINT "referral_requests_destinationUnitId_fkey"
      FOREIGN KEY ("destinationUnitId") REFERENCES "units"("id") ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE "referral_requests" VALIDATE CONSTRAINT "referral_requests_destinationUnitId_fkey";
'@
if (Test-Path -LiteralPath $migrationFile -PathType Leaf) {
    $existing=Normalize-Lf ([System.IO.File]::ReadAllText($migrationFile,[System.Text.Encoding]::UTF8))
    if ($existing.Trim() -ne (Normalize-Lf $migrationSql).Trim()) { throw "Existing Phase 4 referral Unit migration differs from expected content. Stop for review." }
} else {
    Write-Utf8NoBom $migrationFile $migrationSql
}
Write-Host "Migration prepared: $migrationName"

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")

Write-Host ""
Write-Host "=== PRISMA VALIDATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")

Write-Host ""
Write-Host "=== MIGRATE DEPLOY (LOCAL CLONE ONLY) ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","deploy")

Write-Host ""
Write-Host "=== PRISMA GENERATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","generate")

$verifySql=@'
WITH unit_names AS (
  SELECT lower(btrim("name")) AS k,
         min("id"::text)::uuid AS unit_id,
         count(*) AS c
  FROM "units"
  WHERE "active"=true AND NULLIF(btrim("name"),'') IS NOT NULL
  GROUP BY lower(btrim("name"))
), center_routes AS (
  SELECT r."id", r."destinationUnitId", un.unit_id, un.c
  FROM "referral_requests" r
  LEFT JOIN "centers" c ON c."id"=r."destinationCenterId"
  LEFT JOIN unit_names un ON un.k=lower(btrim(c."name"))
  WHERE r."destinationScope"::text='INTERNAL_CENTER'
)
SELECT 'column_uuid|' || count(*) FROM information_schema.columns
 WHERE table_schema='public' AND table_name='referral_requests' AND column_name='destinationUnitId' AND data_type='uuid'
UNION ALL
SELECT 'fk_validated|' || count(*) FROM pg_constraint WHERE conname='referral_requests_destinationUnitId_fkey' AND convalidated
UNION ALL
SELECT 'internal_center_missing_binding|' || count(*) FROM center_routes WHERE unit_id IS NULL OR c IS DISTINCT FROM 1 OR "destinationUnitId" IS NULL
UNION ALL
SELECT 'internal_center_binding_mismatch|' || count(*) FROM center_routes WHERE unit_id IS NOT NULL AND "destinationUnitId" IS DISTINCT FROM unit_id
UNION ALL
SELECT 'non_center_has_unit_binding|' || count(*) FROM "referral_requests" WHERE "destinationScope"::text<>'INTERNAL_CENTER' AND "destinationUnitId" IS NOT NULL
ORDER BY 1;
'@
$verify=Invoke-PsqlText $verifySql
Write-Host $verify
$expected=@{
    'column_uuid'=1
    'fk_validated'=1
    'internal_center_missing_binding'=0
    'internal_center_binding_mismatch'=0
    'non_center_has_unit_binding'=0
}
foreach ($line in ($verify -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2 -or -not $expected.ContainsKey($p[0]) -or [int64]$p[1] -ne [int64]$expected[$p[0]]) {
        throw "Referral destination Unit verification failed: $line"
    }
}
Write-Host "Destination Unit database verification: PASS"

$coreCountsAfter=Invoke-PsqlText $coreCountsSql
if ($coreCountsAfter.Trim() -ne $coreCountsBefore.Trim()) {
    throw "Core row counts changed unexpectedly during additive Unit binding migration.`nBefore:`n$coreCountsBefore`nAfter:`n$coreCountsAfter"
}
Write-Host "Core row-count guard: PASS"

Write-Host ""
Write-Host "=== TYPESCRIPT + TESTS + PROJECT AUDIT + BUILD ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")

Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

Write-Host ""
Write-Host "=== RUNNING APP LOGIN SMOKE ==="
$curl=Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw "curl.exe is required for login smoke." }
$httpCode=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Running app login smoke failed: curl exit code $LASTEXITCODE ($httpCode)" }
if ($httpCode -notmatch '^\d{3}$') { throw "Running app login smoke returned invalid HTTP code: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "23-PHASE4-REFERRAL-UNIT-BINDING.md"
$report=@"
# Phase 4 - Referral Destination Unit Binding

Status: PASS

Implemented:
- Added nullable PostgreSQL UUID `destinationUnitId` to ReferralRequest.
- Backfilled INTERNAL_CENTER referrals using only one exact normalized active Unit-name match to the selected Center.
- Added and validated a real DB FK from referral_requests.destinationUnitId to units.id.
- Existing destinationCenterId remains intact for compatibility.
- Non-center referrals remain without a Unit binding.

Preflight:
$preflight

Verification:
$verify

Safety:
- Additive migration only; no legacy ID removed or changed.
- Existing table row counts unchanged.
- No prisma db push.
- No app container restart.
- Original live server untouched.

Checks:
- Prisma validate/generate: PASS
- TypeScript: PASS
- Full Vitest: PASS
- Project audit: PASS
- Production build check: PASS
- Prisma migration status: PASS
- Running app login smoke: PASS (HTTP $code)

Rollback snapshot:
$rollbackDir

Next:
Cut referral acceptance/notifications over to the explicit destinationUnitId and actual active UserUnitMembership; remove patient-specific DOCTOR role notification in favor of the assigned reviewer User.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "==========================================="
Write-Host "PHASE 4 REFERRAL DESTINATION UNIT: PASS"
Write-Host "==========================================="
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "Rollback snapshot: $rollbackDir"
