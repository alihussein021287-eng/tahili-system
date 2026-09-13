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
Write-Host "=== PHASE 4 WORKITEM SCOPE INVENTORY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\19-PHASE4-REFERRAL-WORKITEM-ROUTING.md" "Phase 4 referral WorkItem routing" | Out-Null
Write-Host "Phase 4 routing prerequisite: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml")) {
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
if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres")))) { throw "Local PostgreSQL container is not running." }

$shapeSql=@'
SELECT CASE WHEN
  to_regclass('public.patient_work_items') IS NOT NULL
  AND to_regclass('public.users') IS NOT NULL
  AND to_regclass('public.units') IS NOT NULL
  AND to_regclass('public.user_unit_memberships') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required WorkItem/User/Unit scope tables are missing." }

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "20-PHASE4-WORKITEM-SCOPE-INVENTORY.csv"
$reportPath=Join-Path $auditDir "20-PHASE4-WORKITEM-SCOPE-INVENTORY.md"

$readinessSql=@'
WITH active_wi AS (
  SELECT wi.*,
         usr."isActive" AS assigned_user_active,
         unt."active" AS assigned_unit_active,
         EXISTS (
           SELECT 1
           FROM "user_unit_memberships" uum
           JOIN "users" mu ON mu."guid"=uum."userId"
           WHERE uum."unitId"=wi."assignedUnitId"
             AND uum."active"=true
             AND mu."isActive"=true
         ) AS unit_has_active_member,
         EXISTS (
           SELECT 1
           FROM "user_unit_memberships" uum
           WHERE uum."unitId"=wi."assignedUnitId"
             AND uum."userId"=wi."assignedUserId"
             AND uum."active"=true
         ) AS owner_is_unit_member
  FROM "patient_work_items" wi
  LEFT JOIN "users" usr ON usr."guid"=wi."assignedUserId"
  LEFT JOIN "units" unt ON unt."id"=wi."assignedUnitId"
  WHERE wi."status"::text NOT IN ('COMPLETED','CANCELLED')
)
SELECT 'active_total|' || count(*) FROM active_wi
UNION ALL SELECT 'open_with_owner|' || count(*) FROM active_wi WHERE "status"::text='OPEN' AND ("assignedUserId" IS NOT NULL OR "assignedUnitId" IS NOT NULL)
UNION ALL SELECT 'assigned_without_target|' || count(*) FROM active_wi WHERE "status"::text='ASSIGNED' AND "assignedUserId" IS NULL AND "assignedUnitId" IS NULL
UNION ALL SELECT 'accepted_without_user|' || count(*) FROM active_wi WHERE "status"::text='ACCEPTED' AND "assignedUserId" IS NULL
UNION ALL SELECT 'progress_without_user|' || count(*) FROM active_wi WHERE "status"::text='PROGRESS_IN' AND "assignedUserId" IS NULL
UNION ALL SELECT 'assigned_user_missing_or_inactive|' || count(*) FROM active_wi WHERE "assignedUserId" IS NOT NULL AND COALESCE(assigned_user_active,false)=false
UNION ALL SELECT 'assigned_unit_missing_or_inactive|' || count(*) FROM active_wi WHERE "assignedUnitId" IS NOT NULL AND COALESCE(assigned_unit_active,false)=false
UNION ALL SELECT 'unit_only_without_active_member|' || count(*) FROM active_wi WHERE "status"::text='ASSIGNED' AND "assignedUnitId" IS NOT NULL AND "assignedUserId" IS NULL AND unit_has_active_member=false
UNION ALL SELECT 'claimed_user_not_unit_member|' || count(*) FROM active_wi WHERE "assignedUnitId" IS NOT NULL AND "assignedUserId" IS NOT NULL AND owner_is_unit_member=false;
'@
$readiness=Invoke-PsqlText $readinessSql

$badKeys=@(
  'open_with_owner',
  'assigned_without_target',
  'accepted_without_user',
  'progress_without_user',
  'assigned_user_missing_or_inactive',
  'assigned_unit_missing_or_inactive',
  'unit_only_without_active_member',
  'claimed_user_not_unit_member'
)
$bad=0
foreach ($line in ($readiness -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2) { throw "Unexpected readiness row: $line" }
    if ($p[0] -in $badKeys) { $bad += [int64]$p[1] }
}

$csvSql=@'
COPY (
  SELECT
    wi."id" AS work_item_id,
    wi."kind",
    wi."status"::text AS status,
    wi."patientId" AS patient_guid,
    wi."assignedUserId" AS assigned_user_guid,
    usr."fullName" AS assigned_user_name,
    usr."isActive" AS assigned_user_active,
    wi."assignedUnitId" AS assigned_unit_id,
    unt."name" AS assigned_unit_name,
    unt."active" AS assigned_unit_active,
    EXISTS (
      SELECT 1
      FROM "user_unit_memberships" uum
      JOIN "users" mu ON mu."guid"=uum."userId"
      WHERE uum."unitId"=wi."assignedUnitId"
        AND uum."active"=true
        AND mu."isActive"=true
    ) AS unit_has_active_member,
    EXISTS (
      SELECT 1
      FROM "user_unit_memberships" uum
      WHERE uum."unitId"=wi."assignedUnitId"
        AND uum."userId"=wi."assignedUserId"
        AND uum."active"=true
    ) AS assigned_user_is_unit_member,
    wi."referralRequestId" AS referral_guid,
    wi."legacyCareStageId" AS legacy_care_stage_id,
    wi."createdAt",
    wi."updatedAt"
  FROM "patient_work_items" wi
  LEFT JOIN "users" usr ON usr."guid"=wi."assignedUserId"
  LEFT JOIN "units" unt ON unt."id"=wi."assignedUnitId"
  WHERE wi."status"::text NOT IN ('COMPLETED','CANCELLED')
  ORDER BY wi."createdAt",wi."id"
) TO STDOUT WITH CSV HEADER;
'@
Invoke-PsqlCsv $csvSql $csvPath

$notifyPath=Join-Path $Project "src\lib\notify.ts"
$referralPath=Join-Path $Project "src\lib\referral-service.ts"
$notificationSource="unknown"
if ((Test-Path -LiteralPath $notifyPath) -and (Test-Path -LiteralPath $referralPath)) {
    $notifyText=[System.IO.File]::ReadAllText($notifyPath,[System.Text.Encoding]::UTF8)
    $referralText=[System.IO.File]::ReadAllText($referralPath,[System.Text.Encoding]::UTF8)
    $hasRoleNotify=$referralText.Contains('notifyRoleInTransaction')
    $hasUnitNotify=$notifyText.Contains('notifyUnitInTransaction')
    $notificationSource="referral_role_notify=$hasRoleNotify; unit_notify_helper=$hasUnitNotify"
}

$status=if ($bad -eq 0) { 'PASS' } else { 'REVIEW_REQUIRED' }
$report=@"
# Phase 4 - WorkItem Scope Inventory

Status: $status

Ownership and claim readiness:
$readiness

Notification source state:
$notificationSource

CSV inventory:
$csvPath

Rules:
- This step is read-only against PostgreSQL.
- OPEN items must be unowned.
- ACCEPTED and PROGRESS_IN items must have an actual assigned User UUID.
- Unit-only ASSIGNED items must have at least one active Unit member who can claim them.
- A WorkItem retaining both Unit and User after claim is valid only when that User has an active membership in that Unit.
- Role is never accepted as PatientWorkItem ownership.
- Existing role notifications are not rewritten in this inventory.

Next:
- PASS: add server-side WorkItem scope policy and Unit-targeted notification support.
- REVIEW_REQUIRED: repair only the reported ownership/scope rows without guessing a User from a Role.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host "WorkItem scope CSV: $csvPath"
Write-Host "Report: $reportPath"
Write-Host ""
Write-Host $readiness
Write-Host "Notification source: $notificationSource"
Write-Host ""
if ($status -eq 'PASS') {
    Write-Host "======================================"
    Write-Host "PHASE 4 WORKITEM SCOPE INVENTORY: PASS"
    Write-Host "======================================"
} else {
    Write-Host "==============================================="
    Write-Host "PHASE 4 WORKITEM SCOPE INVENTORY: REVIEW_REQUIRED"
    Write-Host "==============================================="
}
