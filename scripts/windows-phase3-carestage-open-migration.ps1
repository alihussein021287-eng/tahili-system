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
    $match = [regex]::Match($SchemaText,$pattern)
    if (-not $match.Success) { throw "Model not found: $ModelName" }
    $block = $match.Groups[1].Value
    if ($block -match "(?m)^\s*$([regex]::Escape($Needle))\s+") { return $SchemaText }
    $close = $block.LastIndexOf("}")
    if ($close -lt 0) { throw "Model close not found: $ModelName" }
    $newBlock = $block.Substring(0,$close).TrimEnd() + "`n" + $NewLine + "`n}"
    return $SchemaText.Substring(0,$match.Index) + $newBlock + $SchemaText.Substring($match.Index + $match.Length)
}

Write-Host ""
Write-Host "=== PHASE 3 CARESTAGE OPEN MIGRATION ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\14-PHASE3-PATIENT-WORKITEM-FOUNDATION.md" "Phase 3 foundation" | Out-Null
Test-PassReport "_PHASE01_AUDIT\15-PHASE3-PATIENT-WORKITEM-SERVICE.md" "Phase 3 service" | Out-Null
Test-PassReport "_PHASE01_AUDIT\16-PHASE3-CARESTAGE-INVENTORY.md" "Phase 3 CareStage inventory" | Out-Null
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

$preflightSql=@'
WITH open_stage AS (
  SELECT cs.*, p."guid" AS patient_guid, u."guid" AS creator_guid
  FROM "CareStage" cs
  LEFT JOIN "patients" p ON p."id"=cs."patientId"
  LEFT JOIN "users" u ON u."id"=cs."createdById"
  WHERE cs."status"::text IN ('WAITING','IN_PROGRESS')
)
SELECT CASE WHEN
  to_regclass('public."CareStage"') IS NOT NULL
  AND to_regclass('public.patient_work_items') IS NOT NULL
  AND (SELECT count(*) FROM open_stage WHERE patient_guid IS NULL)=0
  AND (SELECT count(*) FROM open_stage WHERE creator_guid IS NULL)=0
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $preflightSql).Trim() -ne 'PASS') { throw "CareStage migration preflight failed." }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase3-carestage-open-migration" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force

$beforeSql=@'
SELECT 'care_total|' || count(*) FROM "CareStage"
UNION ALL SELECT 'care_open|' || count(*) FROM "CareStage" WHERE "status"::text IN ('WAITING','IN_PROGRESS')
UNION ALL SELECT 'workitems|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'legacy_mapped|' || count(*) FROM "patient_work_items" WHERE "legacyCareStageId" IS NOT NULL;
'@
$before = Invoke-PsqlText $beforeSql
[System.IO.File]::WriteAllText((Join-Path $rollbackDir "counts.before.txt"),$before,(New-Object System.Text.UTF8Encoding($true)))
Write-Host "Rollback snapshot: $rollbackDir"

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=[System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8)
if ($schema -notmatch '(?m)^model\s+PatientWorkItem\s*\{') { throw "PatientWorkItem model missing." }
$schema=Add-ModelLineBeforeClose $schema "PatientWorkItem" "legacyCareStageId" '  legacyCareStageId String? @unique'
[System.IO.File]::WriteAllText($schemaPath,$schema,(New-Object System.Text.UTF8Encoding($false)))

$migrationDir=Join-Path $Project "prisma\migrations\20260913050000_phase3_carestage_open_migration"
$migrationFile=Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
$migrationSql=@'
-- Phase 3 - migrate open CareStage rows into PatientWorkItem.
-- CareStage remains intact. responsibleRole is preserved as provenance only and is not converted to ownership.

ALTER TABLE "patient_work_items" ADD COLUMN IF NOT EXISTS "legacyCareStageId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "patient_work_items_legacyCareStageId_key" ON "patient_work_items"("legacyCareStageId");

INSERT INTO "patient_work_items" (
  "id",
  "patientId",
  "kind",
  "status",
  "assignedUnitId",
  "assignedUserId",
  "createdById",
  "referralRequestId",
  "parentWorkItemId",
  "note",
  "legacyCareStageId",
  "acceptedAt",
  "startedAt",
  "completedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  p."guid",
  'LEGACY_CARE_STAGE:' || COALESCE(NULLIF(btrim(cs."station"),''),'UNKNOWN'),
  CASE WHEN cs."status"::text='IN_PROGRESS' THEN 'PROGRESS_IN'::"PatientWorkItemStatus" ELSE 'OPEN'::"PatientWorkItemStatus" END,
  NULL,
  NULL,
  creator."guid",
  rr."guid",
  NULL,
  concat_ws(E'\n',
    NULLIF(cs."note",''),
    '[legacyCareStageId=' || cs."id" ||
    '; legacyStatus=' || cs."status"::text ||
    '; responsibleRole=' || COALESCE(cs."responsibleRole"::text,'') ||
    '; sequence=' || cs."sequence"::text || ']'
  ),
  cs."id",
  NULL,
  CASE WHEN cs."status"::text='IN_PROGRESS' THEN COALESCE(cs."updatedAt",cs."createdAt") ELSE NULL END,
  NULL,
  cs."createdAt",
  cs."updatedAt"
FROM "CareStage" cs
JOIN "patients" p ON p."id"=cs."patientId"
JOIN "users" creator ON creator."id"=cs."createdById"
LEFT JOIN "referral_requests" rr ON rr."careStageId"=cs."id"
WHERE cs."status"::text IN ('WAITING','IN_PROGRESS')
  AND NOT EXISTS (
    SELECT 1 FROM "patient_work_items" wi WHERE wi."legacyCareStageId"=cs."id"
  );
'@

if (Test-Path -LiteralPath $migrationFile) {
    $existing=[System.IO.File]::ReadAllText($migrationFile,[System.Text.Encoding]::UTF8)
    if ($existing.Trim() -ne $migrationSql.Trim()) { throw "Existing CareStage migration differs from expected content." }
} else {
    [System.IO.File]::WriteAllText($migrationFile,$migrationSql,(New-Object System.Text.UTF8Encoding($false)))
}
Write-Host "Schema and data migration prepared."

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
WITH open_stage AS (
  SELECT cs."id", cs."status"::text AS legacy_status, p."guid" AS patient_guid, u."guid" AS creator_guid, rr."guid" AS referral_guid
  FROM "CareStage" cs
  JOIN "patients" p ON p."id"=cs."patientId"
  JOIN "users" u ON u."id"=cs."createdById"
  LEFT JOIN "referral_requests" rr ON rr."careStageId"=cs."id"
  WHERE cs."status"::text IN ('WAITING','IN_PROGRESS')
), mapped AS (
  SELECT wi.*, os.legacy_status, os.patient_guid, os.creator_guid, os.referral_guid
  FROM open_stage os
  LEFT JOIN "patient_work_items" wi ON wi."legacyCareStageId"=os."id"
)
SELECT 'open_total|' || (SELECT count(*) FROM open_stage)
UNION ALL SELECT 'mapped_total|' || count(*) FROM mapped WHERE "id" IS NOT NULL
UNION ALL SELECT 'missing_mapping|' || count(*) FROM mapped WHERE "id" IS NULL
UNION ALL SELECT 'patient_mismatch|' || count(*) FROM mapped WHERE "id" IS NOT NULL AND "patientId" IS DISTINCT FROM patient_guid
UNION ALL SELECT 'creator_mismatch|' || count(*) FROM mapped WHERE "id" IS NOT NULL AND "createdById" IS DISTINCT FROM creator_guid
UNION ALL SELECT 'referral_mismatch|' || count(*) FROM mapped WHERE "id" IS NOT NULL AND "referralRequestId" IS DISTINCT FROM referral_guid
UNION ALL SELECT 'owner_not_null|' || count(*) FROM mapped WHERE "id" IS NOT NULL AND ("assignedUserId" IS NOT NULL OR "assignedUnitId" IS NOT NULL)
UNION ALL SELECT 'waiting_status_mismatch|' || count(*) FROM mapped WHERE "id" IS NOT NULL AND legacy_status='WAITING' AND "status"::text<>'OPEN'
UNION ALL SELECT 'progress_status_mismatch|' || count(*) FROM mapped WHERE "id" IS NOT NULL AND legacy_status='IN_PROGRESS' AND "status"::text<>'PROGRESS_IN';
'@
$verify=Invoke-PsqlText $verifySql
Write-Host $verify
$bad=0
foreach ($line in ($verify -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2) { throw "Unexpected verification row: $line" }
    if ($p[0] -in @('missing_mapping','patient_mismatch','creator_mismatch','referral_mismatch','owner_not_null','waiting_status_mismatch','progress_status_mismatch')) { $bad += [int64]$p[1] }
}
if ($bad -ne 0) { throw "CareStage to PatientWorkItem verification failed with $bad mismatch rows." }

$careUnchangedSql=@'
SELECT count(*) FROM "CareStage";
'@
$careAfter=[int64](Invoke-PsqlText $careUnchangedSql)
$careBeforeLine=($before -split "`r?`n" | Where-Object { $_ -like 'care_total|*' } | Select-Object -First 1)
if (-not $careBeforeLine) { throw "Missing pre-migration CareStage count." }
$careBefore=[int64](($careBeforeLine -split '\|')[1])
if ($careAfter -ne $careBefore) { throw "CareStage row count changed. Expected $careBefore, got $careAfter." }
Write-Host "CareStage row preservation: PASS"

Write-Host ""
Write-Host "=== PRISMA GENERATE + TYPESCRIPT ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","generate")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")

Write-Host ""
Write-Host "=== WORKITEM UNIT TEST + FULL TESTS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run","tests/unit/patient-work-item.test.ts")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")

Write-Host ""
Write-Host "=== PROJECT AUDIT + BUILD ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")

Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

$login=Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/login" -TimeoutSec 20
if ($login.StatusCode -ne 200 -or $login.Content -notmatch '<form') { throw "Running app login smoke failed." }
Write-Host "Running app login smoke: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "17-PHASE3-CARESTAGE-OPEN-MIGRATION.md"
$report=@"
# Phase 3 - CareStage Open Migration

Status: PASS

Migration rules:
- WAITING CareStage -> OPEN PatientWorkItem.
- IN_PROGRESS CareStage -> PROGRESS_IN PatientWorkItem.
- No responsibleRole was converted into assignedUserId or assignedUnitId.
- legacyCareStageId is retained as a unique transitional mapping key.
- Patient, creator, referral, station, note, sequence/status provenance, createdAt and updatedAt are preserved/mapped.
- CareStage rows were not deleted or modified.
- CONFIRMED and SKIPPED CareStage rows remain historical-only for now.

Verification:
$verify

CareStage rows before/after: $careBefore / $careAfter
Prisma validate/generate: PASS
TypeScript: PASS
PatientWorkItem unit tests: PASS
Full Vitest: PASS
Project audit: PASS
Production build check: PASS
Prisma migrate status: PASS
Running app login smoke: PASS

Rollback snapshot: $rollbackDir

Next:
Resolve operational ownership for migrated open work items and add My Work / Unit Inbox routing before any CareStage cleanup.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 3 CARESTAGE OPEN MIGRATION: PASS"
Write-Host "======================================"
Write-Host "Report: $reportPath"
Write-Host "Rollback snapshot: $rollbackDir"
