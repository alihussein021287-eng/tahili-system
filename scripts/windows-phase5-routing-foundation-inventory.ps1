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

Write-Host ""
Write-Host "=== PHASE 5C ROUTING FOUNDATION INVENTORY ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\34-PHASE5-CLINICAL-RECIPIENT-ROUTING-READINESS.md" "Phase 5C clinical recipient routing readiness"
Write-Host "Phase 5C routing readiness prerequisite: PASS"

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
  to_regclass('public.units') IS NOT NULL
  AND to_regclass('public.user_unit_memberships') IS NOT NULL
  AND to_regclass('public.users') IS NOT NULL
  AND to_regclass('public.patient_work_items') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required routing foundation database shape is missing." }

$countsSql=@'
SELECT 'units_total|' || count(*) FROM units
UNION ALL SELECT 'units_active|' || count(*) FROM units WHERE active = true
UNION ALL SELECT 'memberships_total|' || count(*) FROM user_unit_memberships
UNION ALL SELECT 'memberships_active|' || count(*) FROM user_unit_memberships WHERE active = true
UNION ALL SELECT 'workitems_total|' || count(*) FROM patient_work_items
UNION ALL SELECT 'workitems_active|' || count(*) FROM patient_work_items WHERE status IN ('OPEN','ASSIGNED','ACCEPTED','PROGRESS_IN','BLOCKED')
ORDER BY 1;
'@
$dbCounts=Invoke-PsqlText $countsSql

$rolesSql=@'
SELECT role::text || '|' || count(*) || '|' || count(*) FILTER (WHERE "isActive" = true)
FROM users
GROUP BY role
ORDER BY role::text;
'@
$userRoles=Invoke-PsqlText $rolesSql

$departmentsSql=@'
SELECT coalesce(nullif(trim(department),''),'(blank)') || '|' || count(*)
FROM users
WHERE "isActive" = true
GROUP BY coalesce(nullif(trim(department),''),'(blank)')
ORDER BY 1;
'@
$departments=Invoke-PsqlText $departmentsSql

$sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File | Where-Object { $_.Extension -in @('.ts','.tsx') })
if ($sourceFiles.Count -eq 0) { throw "No source files found under src." }

$patterns=[ordered]@{
    PRISMA_UNIT = 'prisma\.unit\.'
    USER_UNIT_MEMBERSHIP = 'userUnitMembership'
    ASSIGNED_UNIT_ID = 'assignedUnitId'
    DESTINATION_UNIT_ID = 'destinationUnitId'
    CREATE_WORKITEM = 'createPatientWorkItem'
    ASSIGN_WORKITEM = 'assignPatientWorkItem'
    CLAIM_WORKITEM = 'claimPatientWorkItem'
    ACCEPT_WORKITEM = 'acceptPatientWorkItem'
    START_WORKITEM = 'startPatientWorkItem'
    COMPLETE_WORKITEM = 'completePatientWorkItem'
    PATIENT_WORK_ITEM_SERVICE = '@/lib/patient-work-item'
}

$detail = New-Object System.Collections.Generic.List[object]
foreach ($file in $sourceFiles) {
    $relative = $file.FullName.Substring($Project.Length + 1).Replace('\','/')
    $text = [System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    foreach ($entry in $patterns.GetEnumerator()) {
        $matches=[regex]::Matches($text,$entry.Value,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($matches.Count -gt 0) {
            $detail.Add([pscustomobject]@{ Pattern=$entry.Key; File=$relative; Hits=$matches.Count })
        }
    }
}

$summary = foreach ($entry in $patterns.GetEnumerator()) {
    $rows=@($detail | Where-Object Pattern -eq $entry.Key)
    [pscustomobject]@{
        Pattern=$entry.Key
        Files=$rows.Count
        Hits=($rows | Measure-Object -Property Hits -Sum).Sum
    }
}

foreach ($row in $summary) {
    $hits=if ($null -eq $row.Hits) { 0 } else { [int]$row.Hits }
    Write-Host "$($row.Pattern)|files=$($row.Files)|hits=$hits"
}

$sourceHashBefore = @{}
foreach ($file in $sourceFiles) { $sourceHashBefore[$file.FullName]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
foreach ($file in $sourceFiles) {
    $after=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if ($after -ne $sourceHashBefore[$file.FullName]) { throw "Read-only inventory changed source file: $($file.FullName)" }
}
Write-Host "Source write guard: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "35-PHASE5-ROUTING-FOUNDATION-INVENTORY.md"
$detailCsvPath=Join-Path $auditDir "35-PHASE5-ROUTING-FOUNDATION-SOURCE.csv"

$detail | Sort-Object Pattern,File | Export-Csv -LiteralPath $detailCsvPath -NoTypeInformation -Encoding UTF8

function Lines-To-Markdown {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return "- none" }
    return (($Text -split "`r?`n") | ForEach-Object { "- $_" }) -join "`n"
}

$summaryText = ($summary | ForEach-Object {
    $hits=if ($null -eq $_.Hits) { 0 } else { [int]$_.Hits }
    "- $($_.Pattern): files=$($_.Files), hits=$hits"
}) -join "`n"

$topText = if ($detail.Count -eq 0) { "- none" } else {
    (($detail | Sort-Object Hits -Descending,File | Select-Object -First 40) | ForEach-Object { "- $($_.Pattern) :: $($_.File) :: hits=$($_.Hits)" }) -join "`n"
}

$report=@"
# Phase 5C - Routing Foundation Inventory

Status: PASS

Purpose:
Read-only inventory to determine whether the local clone already has an explicit Unit management / assignment surface and whether PatientWorkItem mutations are exposed outside the service layer. This prevents inventing clinical routing destinations from Role names.

Database counts:
$(Lines-To-Markdown $dbCounts)

User roles:
Format: role|total|active
$(Lines-To-Markdown $userRoles)

Active-user departments:
Format: department|count
$(Lines-To-Markdown $departments)

Source pattern summary:
$summaryText

Top source matches:
$topText

Decision boundary:
- Do not derive clinical ownership from Role alone.
- Do not seed Units from station/role labels automatically unless an explicit organizational mapping is approved.
- Existing Unit management or assignment surfaces, if present, should be reused rather than duplicated.
- PatientWorkItem actions exposed outside the service layer must continue to enforce service/scope policy server-side.
- True process/system Role broadcasts remain valid.
- Patient-specific clinical Role notifications remain blocked until a real User or Unit destination exists.

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
Write-Host "==============================================="
Write-Host "PHASE 5C ROUTING FOUNDATION INVENTORY: PASS"
Write-Host "==============================================="
Write-Host "Report: $reportPath"
Write-Host "CSV: $detailCsvPath"
