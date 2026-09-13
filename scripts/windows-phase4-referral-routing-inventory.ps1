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
Write-Host "=== PHASE 4 REFERRAL ROUTING INVENTORY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\17-PHASE3-CARESTAGE-OPEN-MIGRATION.md" "Phase 3 CareStage open migration" | Out-Null
Write-Host "Phase 3 prerequisite: PASS"

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
  to_regclass('public.referral_requests') IS NOT NULL
  AND to_regclass('public.users') IS NOT NULL
  AND to_regclass('public.centers') IS NOT NULL
  AND to_regclass('public.units') IS NOT NULL
  AND to_regclass('public.patient_work_items') IS NOT NULL
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='referral_requests' AND column_name='assignedReviewerGuid' AND data_type='uuid')
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='referral_requests' AND column_name='destinationCenterGuid' AND data_type='uuid')
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patient_work_items' AND column_name='legacyCareStageId')
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required Phase 1/2/3 routing columns are missing." }

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "18-PHASE4-REFERRAL-ROUTING-INVENTORY.csv"
$reportPath=Join-Path $auditDir "18-PHASE4-REFERRAL-ROUTING-INVENTORY.md"

$summarySql=@'
SELECT 'internal_total|' || count(*) FROM "referral_requests" WHERE "destinationScope"::text IN ('INTERNAL_SPECIALIST','INTERNAL_CENTER')
UNION ALL SELECT 'internal_specialist|' || count(*) FROM "referral_requests" WHERE "destinationScope"::text='INTERNAL_SPECIALIST'
UNION ALL SELECT 'internal_center|' || count(*) FROM "referral_requests" WHERE "destinationScope"::text='INTERNAL_CENTER'
UNION ALL SELECT 'accepted_internal|' || count(*) FROM "referral_requests" WHERE "destinationScope"::text IN ('INTERNAL_SPECIALIST','INTERNAL_CENTER') AND "status"::text='ACCEPTED'
UNION ALL SELECT 'open_internal|' || count(*) FROM "referral_requests" WHERE "destinationScope"::text IN ('INTERNAL_SPECIALIST','INTERNAL_CENTER') AND "status"::text NOT IN ('REVIEWED','ACCEPTED','CANCELLED');
'@
$summary=Invoke-PsqlText $summarySql

$readinessSql=@'
WITH r AS (
  SELECT rr.*,
         reviewer."guid" AS reviewer_guid_check,
         c."name" AS center_name,
         c."guid" AS center_guid_check,
         u."id" AS matched_unit_id,
         wi."id" AS migrated_work_item_id
  FROM "referral_requests" rr
  LEFT JOIN "users" reviewer ON reviewer."id"=rr."assignedReviewerId"
  LEFT JOIN "centers" c ON c."id"=rr."destinationCenterId"
  LEFT JOIN "units" u ON lower(btrim(u."name"))=lower(btrim(c."name"))
  LEFT JOIN "patient_work_items" wi ON wi."legacyCareStageId"=rr."careStageId"
  WHERE rr."destinationScope"::text IN ('INTERNAL_SPECIALIST','INTERNAL_CENTER')
)
SELECT 'specialist_missing_reviewer_guid|' || count(*) FROM r WHERE "destinationScope"::text='INTERNAL_SPECIALIST' AND "assignedReviewerGuid" IS NULL
UNION ALL SELECT 'specialist_reviewer_shadow_mismatch|' || count(*) FROM r WHERE "destinationScope"::text='INTERNAL_SPECIALIST' AND "assignedReviewerGuid" IS DISTINCT FROM reviewer_guid_check
UNION ALL SELECT 'center_missing_center_guid|' || count(*) FROM r WHERE "destinationScope"::text='INTERNAL_CENTER' AND "destinationCenterGuid" IS NULL
UNION ALL SELECT 'center_guid_shadow_mismatch|' || count(*) FROM r WHERE "destinationScope"::text='INTERNAL_CENTER' AND "destinationCenterGuid" IS DISTINCT FROM center_guid_check
UNION ALL SELECT 'center_missing_unit_match|' || count(*) FROM r WHERE "destinationScope"::text='INTERNAL_CENTER' AND matched_unit_id IS NULL
UNION ALL SELECT 'accepted_with_carestage_missing_workitem|' || count(*) FROM r WHERE "status"::text='ACCEPTED' AND "careStageId" IS NOT NULL AND migrated_work_item_id IS NULL
UNION ALL SELECT 'accepted_specialist_routable|' || count(*) FROM r WHERE "status"::text='ACCEPTED' AND "destinationScope"::text='INTERNAL_SPECIALIST' AND "assignedReviewerGuid" IS NOT NULL AND migrated_work_item_id IS NOT NULL
UNION ALL SELECT 'accepted_center_routable|' || count(*) FROM r WHERE "status"::text='ACCEPTED' AND "destinationScope"::text='INTERNAL_CENTER' AND matched_unit_id IS NOT NULL AND migrated_work_item_id IS NOT NULL;
'@
$readiness=Invoke-PsqlText $readinessSql

$badKeys=@(
  'specialist_missing_reviewer_guid',
  'specialist_reviewer_shadow_mismatch',
  'center_missing_center_guid',
  'center_guid_shadow_mismatch',
  'center_missing_unit_match',
  'accepted_with_carestage_missing_workitem'
)
$bad=0
foreach ($line in ($readiness -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2) { throw "Unexpected readiness row: $line" }
    if ($p[0] -in $badKeys) { $bad += [int64]$p[1] }
}

$centerMapSql=@'
SELECT COALESCE(c."name",'(null)') || '|' || COALESCE(u."name",'(no-unit-match)') || '|' || count(*)
FROM "referral_requests" rr
LEFT JOIN "centers" c ON c."id"=rr."destinationCenterId"
LEFT JOIN "units" u ON lower(btrim(u."name"))=lower(btrim(c."name"))
WHERE rr."destinationScope"::text='INTERNAL_CENTER'
GROUP BY c."name",u."name"
ORDER BY 1;
'@
$centerMap=Invoke-PsqlText $centerMapSql

$csvSql=@'
COPY (
  SELECT
    rr."id" AS legacy_referral_id,
    rr."guid" AS referral_guid,
    rr."status"::text AS referral_status,
    rr."destinationScope"::text AS destination_scope,
    rr."type"::text AS referral_type,
    rr."requestedService" AS requested_service,
    rr."assignedReviewerId" AS legacy_reviewer_id,
    rr."assignedReviewerGuid" AS reviewer_guid,
    reviewer."fullName" AS reviewer_name,
    rr."destinationCenterId" AS legacy_center_id,
    rr."destinationCenterGuid" AS center_guid,
    c."name" AS center_name,
    u."id" AS matched_unit_id,
    u."name" AS matched_unit_name,
    rr."careStageId" AS legacy_care_stage_id,
    wi."id" AS migrated_work_item_id,
    wi."status"::text AS migrated_work_item_status,
    wi."assignedUserId" AS current_work_item_user,
    wi."assignedUnitId" AS current_work_item_unit,
    CASE
      WHEN rr."destinationScope"::text='INTERNAL_SPECIALIST' AND rr."assignedReviewerGuid" IS NOT NULL THEN 'TARGET_USER_READY'
      WHEN rr."destinationScope"::text='INTERNAL_CENTER' AND u."id" IS NOT NULL THEN 'TARGET_UNIT_READY'
      WHEN rr."destinationScope"::text='INTERNAL_CENTER' AND u."id" IS NULL THEN 'BLOCK_NO_UNIT_MATCH'
      ELSE 'BLOCK_MISSING_TARGET'
    END AS routing_class
  FROM "referral_requests" rr
  LEFT JOIN "users" reviewer ON reviewer."id"=rr."assignedReviewerId"
  LEFT JOIN "centers" c ON c."id"=rr."destinationCenterId"
  LEFT JOIN "units" u ON lower(btrim(u."name"))=lower(btrim(c."name"))
  LEFT JOIN "patient_work_items" wi ON wi."legacyCareStageId"=rr."careStageId"
  WHERE rr."destinationScope"::text IN ('INTERNAL_SPECIALIST','INTERNAL_CENTER')
  ORDER BY rr."createdAt",rr."id"
) TO STDOUT WITH CSV HEADER;
'@
Invoke-PsqlCsv $csvSql $csvPath

$status = if ($bad -eq 0) { 'PASS' } else { 'REVIEW_REQUIRED' }
$report=@"
# Phase 4 - Referral Routing Inventory

Status: $status

Referral counts:
$summary

Routing readiness:
$readiness

Center to Unit exact-name mapping:
$centerMap

CSV inventory:
$csvPath

Rules:
- Read-only database inventory; no ReferralRequest, CareStage, Unit, or PatientWorkItem row is modified.
- INTERNAL_SPECIALIST must route to the actual assigned reviewer GUID.
- INTERNAL_CENTER must route to an actual Unit UUID; role-only ownership is not accepted.
- Center to Unit matching in this inventory is exact normalized name only; no fuzzy or guessed mapping is performed.
- Existing CareStage-linked migrated PatientWorkItems are checked but not reassigned here.

Next:
- PASS: build guarded Phase 4 routing cutover and reassign eligible migrated work items.
- REVIEW_REQUIRED: resolve only the reported missing target mappings before any routing write.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host "Routing inventory CSV: $csvPath"
Write-Host "Report: $reportPath"
Write-Host ""
Write-Host $readiness
Write-Host ""
if ($status -eq 'PASS') {
    Write-Host "======================================"
    Write-Host "PHASE 4 REFERRAL ROUTING INVENTORY: PASS"
    Write-Host "======================================"
} else {
    Write-Host "==============================================="
    Write-Host "PHASE 4 REFERRAL ROUTING INVENTORY: REVIEW_REQUIRED"
    Write-Host "==============================================="
}
