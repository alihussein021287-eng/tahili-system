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

function Invoke-PsqlCsv {
    param([Parameter(Mandatory = $true)][string]$Sql,[Parameter(Mandatory = $true)][string]$Path)
    $args = $Compose + @(
        "exec", "-T", "postgres",
        "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", $script:dbUser,
        "-d", $script:dbName,
        "-q"
    )
    $output = $Sql | & docker @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql CSV export failed.`n$($output | Out-String)" }
    [System.IO.File]::WriteAllLines($Path,[string[]]$output,(New-Object System.Text.UTF8Encoding($true)))
}

function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
    return $path
}

Write-Host ""
Write-Host "=== PHASE 3 CARESTAGE MIGRATION INVENTORY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\14-PHASE3-PATIENT-WORKITEM-FOUNDATION.md" "Phase 3 PatientWorkItem Foundation" | Out-Null
Test-PassReport "_PHASE01_AUDIT\15-PHASE3-PATIENT-WORKITEM-SERVICE.md" "Phase 3 PatientWorkItem Service" | Out-Null
Write-Host "Prerequisite reports: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml")) {
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
if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres")))) { throw "Local PostgreSQL container is not running." }

$shapeSql=@'
SELECT CASE WHEN
  to_regclass('public."CareStage"') IS NOT NULL
  AND to_regclass('public.patient_work_items') IS NOT NULL
  AND to_regclass('public.patients') IS NOT NULL
  AND to_regclass('public.users') IS NOT NULL
  AND to_regclass('public.referral_requests') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne "PASS") { throw "Required CareStage/PatientWorkItem tables are missing." }

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "16-PHASE3-CARESTAGE-INVENTORY.csv"
$reportPath=Join-Path $auditDir "16-PHASE3-CARESTAGE-INVENTORY.md"

$summarySql=@'
SELECT 'TOTAL' AS k, count(*) FROM "CareStage"
UNION ALL SELECT 'WAITING', count(*) FROM "CareStage" WHERE "status"::text='WAITING'
UNION ALL SELECT 'IN_PROGRESS', count(*) FROM "CareStage" WHERE "status"::text='IN_PROGRESS'
UNION ALL SELECT 'CONFIRMED', count(*) FROM "CareStage" WHERE "status"::text='CONFIRMED'
UNION ALL SELECT 'SKIPPED', count(*) FROM "CareStage" WHERE "status"::text='SKIPPED'
UNION ALL SELECT 'OPEN_TOTAL', count(*) FROM "CareStage" WHERE "status"::text IN ('WAITING','IN_PROGRESS')
ORDER BY 1;
'@
$summary=Invoke-PsqlText $summarySql

$stationSql=@'
SELECT COALESCE(NULLIF(btrim("station"),''),'(blank)') || '|' || "status"::text || '|' || count(*)
FROM "CareStage"
GROUP BY COALESCE(NULLIF(btrim("station"),''),'(blank)'), "status"
ORDER BY 1,2;
'@
$stationSummary=Invoke-PsqlText $stationSql

$roleSql=@'
SELECT COALESCE("responsibleRole"::text,'(null)') || '|' || "status"::text || '|' || count(*)
FROM "CareStage"
GROUP BY "responsibleRole", "status"
ORDER BY 1,2;
'@
$roleSummary=Invoke-PsqlText $roleSql

$readinessSql=@'
WITH open_stage AS (
  SELECT cs.*,
         p."guid" AS patient_guid,
         cu."guid" AS creator_guid,
         cf."guid" AS confirmer_guid,
         rr."guid" AS referral_guid
  FROM "CareStage" cs
  LEFT JOIN "patients" p ON p."id"=cs."patientId"
  LEFT JOIN "users" cu ON cu."id"=cs."createdById"
  LEFT JOIN "users" cf ON cf."id"=cs."confirmedById"
  LEFT JOIN "referral_requests" rr ON rr."careStageId"=cs."id"
  WHERE cs."status"::text IN ('WAITING','IN_PROGRESS')
)
SELECT 'open_total' || '|' || count(*) FROM open_stage
UNION ALL SELECT 'missing_patient_guid' || '|' || count(*) FROM open_stage WHERE patient_guid IS NULL
UNION ALL SELECT 'missing_created_by_guid' || '|' || count(*) FROM open_stage WHERE creator_guid IS NULL
UNION ALL SELECT 'has_responsible_role' || '|' || count(*) FROM open_stage WHERE "responsibleRole" IS NOT NULL
UNION ALL SELECT 'has_referral' || '|' || count(*) FROM open_stage WHERE referral_guid IS NOT NULL
UNION ALL SELECT 'in_progress_without_confirmer_guid' || '|' || count(*) FROM open_stage WHERE "status"::text='IN_PROGRESS' AND "confirmedById" IS NOT NULL AND confirmer_guid IS NULL
ORDER BY 1;
'@
$readiness=Invoke-PsqlText $readinessSql

$missingPatient=0
$missingCreator=0
foreach ($line in ($readiness -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2) { throw "Unexpected readiness row: $line" }
    if ($p[0] -eq 'missing_patient_guid') { $missingPatient=[int64]$p[1] }
    if ($p[0] -eq 'missing_created_by_guid') { $missingCreator=[int64]$p[1] }
}

$duplicateReferralSql=@'
SELECT count(*) FROM (
  SELECT rr."careStageId"
  FROM "referral_requests" rr
  WHERE rr."careStageId" IS NOT NULL
  GROUP BY rr."careStageId"
  HAVING count(*) > 1
) x;
'@
$duplicateReferralLinks=[int64](Invoke-PsqlText $duplicateReferralSql)
if ($duplicateReferralLinks -ne 0) { throw "ReferralRequest has duplicate careStageId links. Stop for review." }

$existingLegacyKindSql=@'
SELECT count(*) FROM "patient_work_items" WHERE "kind" LIKE 'LEGACY_CARE_STAGE:%';
'@
$existingLegacyItems=[int64](Invoke-PsqlText $existingLegacyKindSql)
if ($existingLegacyItems -ne 0) { throw "Found existing LEGACY_CARE_STAGE work items before migration inventory. Stop for review." }

$csvSql=@'
COPY (
  SELECT
    cs."id" AS care_stage_id,
    cs."patientId" AS legacy_patient_id,
    p."guid" AS patient_guid,
    cs."station",
    cs."responsibleRole"::text AS responsible_role,
    cs."sequence",
    cs."status"::text AS legacy_status,
    cs."createdById" AS legacy_created_by_id,
    cu."guid" AS created_by_guid,
    cs."confirmedById" AS legacy_confirmed_by_id,
    cf."guid" AS confirmed_by_guid,
    rr."id" AS legacy_referral_id,
    rr."guid" AS referral_guid,
    cs."note",
    cs."confirmedAt",
    cs."createdAt",
    cs."updatedAt",
    CASE
      WHEN p."guid" IS NULL THEN 'BLOCK_MISSING_PATIENT_GUID'
      WHEN cu."guid" IS NULL THEN 'BLOCK_MISSING_CREATED_BY_GUID'
      WHEN cs."status"::text IN ('WAITING','IN_PROGRESS') THEN 'OPEN_MIGRATION_CANDIDATE'
      ELSE 'HISTORICAL_ONLY'
    END AS migration_class
  FROM "CareStage" cs
  LEFT JOIN "patients" p ON p."id"=cs."patientId"
  LEFT JOIN "users" cu ON cu."id"=cs."createdById"
  LEFT JOIN "users" cf ON cf."id"=cs."confirmedById"
  LEFT JOIN "referral_requests" rr ON rr."careStageId"=cs."id"
  ORDER BY cs."patientId", cs."sequence", cs."createdAt", cs."id"
) TO STDOUT WITH CSV HEADER;
'@
Invoke-PsqlCsv $csvSql $csvPath

$status = if ($missingPatient -eq 0 -and $missingCreator -eq 0) { "PASS" } else { "REVIEW_REQUIRED" }
$report=@"
# Phase 3 - CareStage Migration Inventory

Status: $status

CareStage status counts:
$summary

Open-stage UUID readiness:
$readiness

Duplicate ReferralRequest.careStageId links: $duplicateReferralLinks
Existing LEGACY_CARE_STAGE PatientWorkItems: $existingLegacyItems

Station/status inventory:
$stationSummary

ResponsibleRole/status inventory:
$roleSummary

CSV inventory:
$csvPath

Rules:
- This gate is read-only against the database.
- No CareStage row was changed or deleted.
- No PatientWorkItem row was created.
- responsibleRole is inventory context only and is NOT converted into user ownership.
- Only explicit legacy IDs are mapped to existing UUID GUID columns.
- WAITING and IN_PROGRESS are the current open-stage migration candidates.
- CONFIRMED and SKIPPED are historical-only in this inventory and are not deleted here.

Next:
- PASS: build the guarded open CareStage -> PatientWorkItem migration using this exact inventory.
- REVIEW_REQUIRED: resolve missing patient/creator identity mappings before any migration write.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host "CareStage inventory CSV: $csvPath"
Write-Host "Report: $reportPath"
Write-Host "Missing patient GUIDs in open stages: $missingPatient"
Write-Host "Missing creator GUIDs in open stages: $missingCreator"
Write-Host ""
if ($status -eq 'PASS') {
    Write-Host "======================================"
    Write-Host "PHASE 3 CARESTAGE INVENTORY: PASS"
    Write-Host "======================================"
} else {
    Write-Host "==============================================="
    Write-Host "PHASE 3 CARESTAGE INVENTORY: REVIEW_REQUIRED"
    Write-Host "==============================================="
}
