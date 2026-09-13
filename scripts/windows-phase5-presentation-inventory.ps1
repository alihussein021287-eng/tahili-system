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

function Count-SourceMatches {
    param([string]$Pattern)
    $count = 0
    foreach ($f in Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx -ErrorAction Stop) {
        $text = [System.IO.File]::ReadAllText($f.FullName,[System.Text.Encoding]::UTF8)
        $count += ([regex]::Matches($text,$Pattern,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count
    }
    return $count
}

Write-Host ""
Write-Host "=== PHASE 5 PRESENTATION / JOURNEY INVENTORY ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\25-PHASE4-FINAL-GATE.md" "Phase 4 final gate"
Write-Host "Phase 4 final-gate prerequisite: PASS"

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

$shapeSql=@'
SELECT 'patient_work_items|' || CASE WHEN to_regclass('public.patient_work_items') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'care_stages|' || CASE WHEN to_regclass('public.care_stages') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'notifications|' || CASE WHEN to_regclass('public."Notification"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'user_unit_memberships|' || CASE WHEN to_regclass('public.user_unit_memberships') IS NULL THEN 0 ELSE 1 END
ORDER BY 1;
'@
$shape=Invoke-PsqlText $shapeSql
Write-Host $shape
foreach ($required in @('patient_work_items|1','care_stages|1','notifications|1','user_unit_memberships|1')) {
    if (($shape -split "`r?`n") -notcontains $required) { throw "Phase 5 inventory required DB shape missing: $required" }
}

$countsSql=@'
SELECT 'carestage_total|' || count(*) FROM "care_stages"
UNION ALL SELECT 'carestage_open|' || count(*) FROM "care_stages" WHERE "status"::text IN ('WAITING','IN_PROGRESS')
UNION ALL SELECT 'carestage_waiting|' || count(*) FROM "care_stages" WHERE "status"::text='WAITING'
UNION ALL SELECT 'carestage_in_progress|' || count(*) FROM "care_stages" WHERE "status"::text='IN_PROGRESS'
UNION ALL SELECT 'carestage_confirmed_or_skipped|' || count(*) FROM "care_stages" WHERE "status"::text IN ('CONFIRMED','SKIPPED')
UNION ALL SELECT 'workitem_total|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'workitem_active|' || count(*) FROM "patient_work_items" WHERE "status"::text IN ('OPEN','ASSIGNED','ACCEPTED','PROGRESS_IN','BLOCKED')
UNION ALL SELECT 'workitem_unit_only|' || count(*) FROM "patient_work_items" WHERE "assignedUnitId" IS NOT NULL AND "assignedUserId" IS NULL
UNION ALL SELECT 'workitem_user_only|' || count(*) FROM "patient_work_items" WHERE "assignedUserId" IS NOT NULL AND "assignedUnitId" IS NULL
UNION ALL SELECT 'workitem_user_and_unit|' || count(*) FROM "patient_work_items" WHERE "assignedUserId" IS NOT NULL AND "assignedUnitId" IS NOT NULL
UNION ALL SELECT 'workitem_unassigned|' || count(*) FROM "patient_work_items" WHERE "assignedUserId" IS NULL AND "assignedUnitId" IS NULL
UNION ALL SELECT 'workitem_legacy_carestage_linked|' || count(*) FROM "patient_work_items" WHERE "legacyCareStageId" IS NOT NULL
UNION ALL SELECT 'notification_total|' || count(*) FROM "Notification"
UNION ALL SELECT 'notification_role_targeted|' || count(*) FROM "Notification" WHERE "targetRole" IS NOT NULL
UNION ALL SELECT 'notification_user_targeted|' || count(*) FROM "Notification" WHERE "targetUserId" IS NOT NULL
UNION ALL SELECT 'notification_unread|' || count(*) FROM "Notification" WHERE "read"=false
ORDER BY 1;
'@
$dbInventory=Invoke-PsqlText $countsSql
Write-Host $dbInventory

$countsBefore=Invoke-PsqlText @'
SELECT 'care_stages|' || count(*) FROM "care_stages"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'notifications|' || count(*) FROM "Notification"
UNION ALL SELECT 'user_unit_memberships|' || count(*) FROM "user_unit_memberships"
ORDER BY 1;
'@

$patterns=[ordered]@{
    CARE_STAGE='\bcareStage(s)?\b|\bCareStage\b'
    CURRENT_CARE_STAGE='currentCareStage'
    PATHWAY_DEFAULT='PATHWAY_DEFAULT'
    PATIENT_WORK_ITEM='PatientWorkItem|patientWorkItem(s)?'
    WORKITEM_SCOPE='patient-work-item-scope|canViewWorkItemScope|canClaimWorkItemScope|canActOnWorkItemScope'
    TARGET_ROLE='targetRole'
    TARGET_USER='targetUserId'
    NOTIFY_ROLE='notifyRole(InTransaction)?'
    NOTIFY_USER='notifyUser(InTransaction)?'
    NOTIFY_UNIT='notifyUnitInTransaction'
    USER_UNIT_MEMBERSHIP='userUnitMembership'
}

$sourceRows = New-Object System.Collections.Generic.List[object]
$sourceRoot=Join-Path $Project "src"
$files=Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx -ErrorAction Stop
foreach ($f in $files) {
    $text=[System.IO.File]::ReadAllText($f.FullName,[System.Text.Encoding]::UTF8)
    $relative=$f.FullName.Substring($Project.Length+1).Replace('\','/')
    foreach ($entry in $patterns.GetEnumerator()) {
        $matches=[regex]::Matches($text,$entry.Value,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($matches.Count -gt 0) {
            $sourceRows.Add([pscustomobject]@{ File=$relative; Pattern=$entry.Key; Count=$matches.Count }) | Out-Null
        }
    }
}

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "26-PHASE5-PRESENTATION-JOURNEY-SOURCE-USAGE.csv"
$sourceRows | Sort-Object File,Pattern | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$summaryLines=New-Object System.Collections.Generic.List[string]
foreach ($key in $patterns.Keys) {
    $sum=($sourceRows | Where-Object Pattern -eq $key | Measure-Object -Property Count -Sum).Sum
    if ($null -eq $sum) { $sum=0 }
    $line="$key|$sum"
    $summaryLines.Add($line) | Out-Null
    Write-Host $line
}

$priorityFiles = $sourceRows | Where-Object { $_.Pattern -in @('CARE_STAGE','CURRENT_CARE_STAGE','PATHWAY_DEFAULT','PATIENT_WORK_ITEM','TARGET_ROLE','NOTIFY_ROLE','NOTIFY_UNIT') } | Sort-Object File,Pattern
$priorityText = if ($priorityFiles.Count -gt 0) {
    ($priorityFiles | ForEach-Object { "- $($_.File) :: $($_.Pattern) ($($_.Count))" }) -join "`n"
} else { "- none" }

$countsAfter=Invoke-PsqlText @'
SELECT 'care_stages|' || count(*) FROM "care_stages"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'notifications|' || count(*) FROM "Notification"
UNION ALL SELECT 'user_unit_memberships|' || count(*) FROM "user_unit_memberships"
ORDER BY 1;
'@
if ($countsAfter.Trim() -ne $countsBefore.Trim()) { throw "Database row counts changed during Phase 5 read-only inventory." }
Write-Host "Database write guard: PASS"

$curl=Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw "curl.exe is required for login smoke." }
$httpCode=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $httpCode -notmatch '^\d{3}$') { throw "Running app login smoke failed: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$reportPath=Join-Path $auditDir "26-PHASE5-PRESENTATION-JOURNEY-INVENTORY.md"
$report=@"
# Phase 5 - Presentation / Journey Inventory

Status: PASS

Purpose:
Read-only inventory before cutting My Work, patient journey, and notification presentation from legacy role/CareStage assumptions to actual PatientWorkItem User/Unit scope.

Database inventory:
$dbInventory

Source usage totals:
$($summaryLines -join "`n")

Priority source locations:
$priorityText

Safety:
- No Prisma migration created or applied.
- No source application code modified.
- Core database row counts unchanged.
- Running app login smoke PASS (HTTP $code).
- Original live server untouched.

Next:
Use this inventory to design the smallest Phase 5 code cutover. Keep legacy CareStage compatibility for historical/journey display until the later cleanup gate; do not delete CareStage or PATHWAY_DEFAULT in this step.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "==============================================="
Write-Host "PHASE 5 PRESENTATION / JOURNEY INVENTORY: PASS"
Write-Host "==============================================="
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
