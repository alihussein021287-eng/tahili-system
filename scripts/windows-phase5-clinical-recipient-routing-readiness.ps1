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

function Require-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Read-Utf8 {
    param([string]$RelativePath)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required source missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
}

Write-Host ""
Write-Host "=== PHASE 5C CLINICAL RECIPIENT ROUTING READINESS ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\33-PHASE5-NOTIFICATION-ROLE-CONTEXT.md" "Phase 5C notification role context"
Write-Host "Phase 5C role-context prerequisite: PASS"

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

$keyFiles = @(
    "src\app\(app)\centers\actions.ts",
    "src\app\(app)\devices\actions.ts",
    "src\app\(app)\patients\actions.ts",
    "src\app\(app)\tasks\actions.ts",
    "src\app\(app)\therapy\actions.ts",
    "src\app\(app)\visits\actions.ts",
    "src\lib\referral-workflow.ts",
    "src\lib\referral-service.ts",
    "src\lib\patient-work-item.ts",
    "src\lib\notify.ts"
)

$hashBefore=@{}
foreach ($relative in $keyFiles) {
    $full=Join-Path $Project $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Required source missing: $relative" }
    $hashBefore[$relative]=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
}

$shapeSql=@'
SELECT CASE WHEN
  to_regclass('public.units') IS NOT NULL
  AND to_regclass('public.user_unit_memberships') IS NOT NULL
  AND to_regclass('public.users') IS NOT NULL
  AND to_regclass('public.patient_work_items') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required Unit/User/PatientWorkItem database shape is missing." }

$unitRowsSql=@'
SELECT
  u.id::text || '|' || replace(coalesce(u.name,''),'|','/') || '|' ||
  CASE WHEN u.active THEN 'ACTIVE' ELSE 'INACTIVE' END || '|' ||
  count(m."userId") FILTER (WHERE m.active = true) || '|' ||
  count(m."userId") FILTER (WHERE m.active = true AND usr."isActive" = true)
FROM units u
LEFT JOIN user_unit_memberships m ON m."unitId" = u.id
LEFT JOIN users usr ON usr.guid = m."userId"
GROUP BY u.id,u.name,u.active
ORDER BY lower(u.name),u.id;
'@
$unitRows=Invoke-PsqlText $unitRowsSql

$activeWorkItemsSql=@'
SELECT status::text || '|' || count(*)
FROM patient_work_items
WHERE status IN ('OPEN','ASSIGNED','ACCEPTED','PROGRESS_IN','BLOCKED')
GROUP BY status
ORDER BY status::text;
'@
$activeWorkItems=Invoke-PsqlText $activeWorkItemsSql

$patientsActions=Read-Utf8 "src\app\(app)\patients\actions.ts"
$centersActions=Read-Utf8 "src\app\(app)\centers\actions.ts"
$therapyActions=Read-Utf8 "src\app\(app)\therapy\actions.ts"
$visitsActions=Read-Utf8 "src\app\(app)\visits\actions.ts"
$devicesActions=Read-Utf8 "src\app\(app)\devices\actions.ts"
$tasksActions=Read-Utf8 "src\app\(app)\tasks\actions.ts"
$workflow=Read-Utf8 "src\lib\referral-workflow.ts"
$service=Read-Utf8 "src\lib\referral-service.ts"
$workItemService=Read-Utf8 "src\lib\patient-work-item.ts"
$notify=Read-Utf8 "src\lib\notify.ts"

$checks=[ordered]@{
    referral_pending_print_role_manager = [int]($workflow -match 'PENDING_PRINT[\s\S]{0,250}kind:\s*"ROLE"[\s\S]{0,80}role:\s*"MANAGER"')
    referral_internal_specialist_user = [int]($workflow -match 'INTERNAL_SPECIALIST[\s\S]{0,350}kind:\s*"USER"')
    referral_internal_center_unit = [int]($workflow -match 'destinationUnitId[\s\S]{0,200}kind:\s*"UNIT"')
    referral_service_handles_unit = [int]($service -match 'recipient\.kind\s*===\s*"UNIT"')
    notify_has_unit_fanout = [int]($notify -match 'notifyUnitInTransaction')
    workitem_service_present = [int]($workItemService -match 'PatientWorkItem')
    patients_legacy_next_stage_role_notify = [int]($patientsActions -match 'notifyRole\(next\.responsibleRole')
    patients_head_therapist_role_notify = [int]($patientsActions -match 'notifyRole\("HEAD_THERAPIST"')
    patients_doctor_role_notify = [int]($patientsActions -match 'notifyRole\("DOCTOR"')
    centers_doctor_target_role = [int]($centersActions -match 'targetRole:\s*"DOCTOR"')
    therapy_doctor_target_role = [int]($therapyActions -match 'targetRole:\s*"DOCTOR"')
    visits_destination_role_notify = [int]($visitsActions -match 'notifyRoleInTransaction[\s\S]{0,160}destination\.role')
    devices_prosthetics_role_notify = [int]($devicesActions -match 'notifyRole\("PROSTHETICS"')
    tasks_assigned_role_notify = [int]($tasksActions -match 'if\s*\(assignedRole\)[\s\S]{0,120}notifyRole')
}

foreach ($entry in $checks.GetEnumerator()) { Write-Host "$($entry.Key)|$($entry.Value)" }

foreach ($relative in $keyFiles) {
    $full=Join-Path $Project $relative
    $after=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    if ($after -ne $hashBefore[$relative]) { throw "Read-only readiness changed source file: $relative" }
}
Write-Host "Source write guard: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "34-PHASE5-CLINICAL-RECIPIENT-ROUTING-READINESS.md"
$unitCsvPath=Join-Path $auditDir "34-PHASE5-CLINICAL-RECIPIENT-UNITS.csv"

$unitCsv=@("unitId,name,status,activeMemberships,activeUserMemberships")
if (-not [string]::IsNullOrWhiteSpace($unitRows)) {
    foreach ($line in ($unitRows -split "`r?`n")) {
        $parts=$line -split '\|',5
        if ($parts.Count -eq 5) {
            $escaped=@($parts | ForEach-Object { '"' + ($_.Replace('"','""')) + '"' })
            $unitCsv += ($escaped -join ',')
        }
    }
}
[System.IO.File]::WriteAllLines($unitCsvPath,$unitCsv,(New-Object System.Text.UTF8Encoding($true)))

$checkText=($checks.GetEnumerator() | ForEach-Object { "- $($_.Key): $($_.Value)" }) -join "`n"
$unitText=if ([string]::IsNullOrWhiteSpace($unitRows)) { "- none" } else { (($unitRows -split "`r?`n") | ForEach-Object { "- $_" }) -join "`n" }
$workText=if ([string]::IsNullOrWhiteSpace($activeWorkItems)) { "- none" } else { (($activeWorkItems -split "`r?`n") | ForEach-Object { "- $_" }) -join "`n" }

$report=@"
# Phase 5C - Clinical Recipient Routing Readiness

Status: PASS

Purpose:
Read-only readiness check before changing remaining patient-specific clinical Role notifications. This step verifies actual Unit/User routing foundations and distinguishes them from valid process/system Role broadcasts.

Source checks:
$checkText

Active/known Units:
Format: unitId|name|status|activeMemberships|activeUserMemberships
$unitText

Active PatientWorkItem counts:
$workText

Classification boundary:
- Keep true process/system Role broadcasts such as pharmacy stock alerts, finance approval/payment queues, report printing queues, and external referral PENDING_PRINT manager notification.
- Internal referral routing is already User/Unit based and should remain so.
- Do not convert patient-specific clinical Role notifications until an actual User or Unit destination can be resolved without guessing.
- CareStage responsibleRole is compatibility/history only and must not become the new ownership source.
- Do not add Notification.targetUnitId; Unit delivery remains per-user fanout through notifyUnitInTransaction.
- Generic Task assignedRole and device role-task routing require separate Task ownership review if they are patient-specific; do not silently reinterpret them in this notification-only batch.

Safety:
- Read-only database queries only.
- No database writes.
- No migration created or applied.
- No application source modified.
- Source SHA256 write guard PASS.
- Original live server untouched.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "================================================="
Write-Host "PHASE 5C CLINICAL RECIPIENT ROUTING READINESS: PASS"
Write-Host "================================================="
Write-Host "Report: $reportPath"
Write-Host "Unit CSV: $unitCsvPath"
