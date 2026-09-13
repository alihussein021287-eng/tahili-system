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

function Get-SourceHashMap {
    $map = @{}
    $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File)) { $files.Add($f) }
    foreach ($relative in @("prisma\schema.prisma","package.json","package-lock.json")) {
        $p = Join-Path $Project $relative
        if (Test-Path -LiteralPath $p -PathType Leaf) { $files.Add((Get-Item -LiteralPath $p)) }
    }
    foreach ($f in $files) {
        $relative = $f.FullName.Substring($Project.Length + 1).Replace('\','/')
        $map[$relative] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    }
    return $map
}

function Assert-HashMapsEqual {
    param([hashtable]$Before,[hashtable]$After)
    if ($Before.Count -ne $After.Count) { throw "Source write guard failed: file count changed." }
    foreach ($k in $Before.Keys) {
        if (-not $After.ContainsKey($k)) { throw "Source write guard failed: file removed or renamed: $k" }
        if ($Before[$k] -ne $After[$k]) { throw "Source write guard failed: file changed: $k" }
    }
}

function Lines-To-Markdown {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return "- none" }
    return (($Text -split "`r?`n") | ForEach-Object { "- $_" }) -join "`n"
}

Write-Host ""
Write-Host "=== PHASE 6 CLEANUP READINESS INVENTORY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\37-PHASE5-FINAL-GATE.md" "Phase 5 final gate"
Write-Host "Phase 5 prerequisite: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$envMap = @{}
foreach ($line in Get-Content -LiteralPath ".env.saif-dev") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $k=$Matches[1]
        $v=$Matches[2].Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
            $v=$v.Substring(1,$v.Length-2)
        }
        $envMap[$k]=$v
    }
}
$script:dbUser=$envMap["DB_USER"]
$script:dbName=$envMap["DB_NAME"]
if ([string]::IsNullOrWhiteSpace($script:dbUser) -or [string]::IsNullOrWhiteSpace($script:dbName)) { throw "DB_USER/DB_NAME missing." }
if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres"))) -or [string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","app")))) {
    throw "Local Tahili stack is not running."
}

$sourceHashBefore = Get-SourceHashMap

$shapeSql = @'
SELECT CASE WHEN
  to_regclass('public."Employee"') IS NOT NULL
  AND to_regclass('public."CareStage"') IS NOT NULL
  AND to_regclass('public.staff_members') IS NOT NULL
  AND to_regclass('public.patient_work_items') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required Phase 6 database shape is missing." }

$countsSql = @'
SELECT 'employee_total|' || count(*) FROM "Employee"
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'employee_without_staff_link|' || count(*)
FROM "Employee" e
LEFT JOIN "staff_members" s ON s."legacyEmployeeId"=e."id"
WHERE s."id" IS NULL
UNION ALL SELECT 'staff_legacy_orphan|' || count(*)
FROM "staff_members" s
LEFT JOIN "Employee" e ON e."id"=s."legacyEmployeeId"
WHERE s."legacyEmployeeId" IS NOT NULL AND e."id" IS NULL
UNION ALL SELECT 'carestage_total|' || count(*) FROM "CareStage"
UNION ALL SELECT 'carestage_open|' || count(*) FROM "CareStage" WHERE "status"::text IN ('WAITING','IN_PROGRESS')
UNION ALL SELECT 'carestage_historical|' || count(*) FROM "CareStage" WHERE "status"::text NOT IN ('WAITING','IN_PROGRESS')
UNION ALL SELECT 'carestage_open_without_workitem|' || count(*)
FROM "CareStage" c
LEFT JOIN "patient_work_items" w ON w."legacyCareStageId"=c."id"
WHERE c."status"::text IN ('WAITING','IN_PROGRESS') AND w."id" IS NULL
UNION ALL SELECT 'carestage_any_without_workitem|' || count(*)
FROM "CareStage" c
LEFT JOIN "patient_work_items" w ON w."legacyCareStageId"=c."id"
WHERE w."id" IS NULL
UNION ALL SELECT 'workitems_total|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'workitems_legacy_carestage|' || count(*) FROM "patient_work_items" WHERE "legacyCareStageId" IS NOT NULL
UNION ALL SELECT 'stage_status_enum_present|' || count(*)
FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname='public' AND t.typname='StageStatus'
ORDER BY 1;
'@
$dbCountsBefore = Invoke-PsqlText $countsSql
Write-Host $dbCountsBefore

$fkSql = @'
SELECT conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid)
FROM pg_constraint
WHERE contype='f'
  AND confrelid IN (to_regclass('public."Employee"'), to_regclass('public."CareStage"'))
ORDER BY 1;
'@
$legacyFks = Invoke-PsqlText $fkSql

$sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx)
$schemaPath = Join-Path $Project "prisma\schema.prisma"
$scanFiles = New-Object System.Collections.Generic.List[System.IO.FileInfo]
foreach ($f in $sourceFiles) { $scanFiles.Add($f) }
$scanFiles.Add((Get-Item -LiteralPath $schemaPath))

$patterns = [ordered]@{
    CARE_STAGE = '\bcareStage(s)?\b|\bCareStage\b'
    CURRENT_CARE_STAGE = 'currentCareStage'
    STAGE_STATUS = '\bStageStatus\b'
    PATHWAY_DEFAULT = '\bPATHWAY_DEFAULT\b'
    EMPLOYEE = '\bEmployee\b|\bemployee(s)?\b'
    LEGACY_EMPLOYEE_ID = 'legacyEmployeeId'
    RESPONSIBLE_ROLE = 'responsibleRole'
    ASSIGNED_ROLE = 'assignedRole'
    TARGET_ROLE = 'targetRole'
    NOTIFY_ROLE = 'notifyRole(InTransaction)?'
    PATIENT_WORK_ITEM = 'PatientWorkItem|patientWorkItem(s)?'
    STAFF_MEMBER = 'StaffMember|staffMember(s)?'
    USER_UNIT_MEMBERSHIP = 'UserUnitMembership|userUnitMembership'
    COLLABORATION = 'Collaboration|collaboration'
}

$detail = New-Object System.Collections.Generic.List[object]
foreach ($file in $scanFiles) {
    $relative = $file.FullName.Substring($Project.Length + 1).Replace('\','/')
    $text = [System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    foreach ($entry in $patterns.GetEnumerator()) {
        $matches = [regex]::Matches($text,$entry.Value,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($matches.Count -gt 0) {
            $detail.Add([pscustomobject]@{ Pattern=$entry.Key; File=$relative; Hits=$matches.Count })
        }
    }
}

$summary = New-Object System.Collections.Generic.List[object]
foreach ($entry in $patterns.GetEnumerator()) {
    $files = 0
    $hits = 0
    foreach ($row in $detail) {
        if ($row.Pattern -eq $entry.Key) {
            $files++
            $hits += [int]$row.Hits
        }
    }
    $summary.Add([pscustomobject]@{ Pattern=$entry.Key; Files=$files; Hits=$hits })
    Write-Host "$($entry.Key)|files=$files|hits=$hits"
}

$dbCountsAfter = Invoke-PsqlText $countsSql
if ($dbCountsAfter.Trim() -ne $dbCountsBefore.Trim()) { throw "Database write guard failed: cleanup inventory changed core counts." }
Write-Host "Database write guard: PASS"

$sourceHashAfter = Get-SourceHashMap
Assert-HashMapsEqual $sourceHashBefore $sourceHashAfter
Write-Host "Source write guard: PASS"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath = Join-Path $auditDir "38-PHASE6-CLEANUP-READINESS-INVENTORY.md"
$csvPath = Join-Path $auditDir "38-PHASE6-CLEANUP-READINESS-SOURCE.csv"
$detail | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$summaryText = ($summary | ForEach-Object { "- $($_.Pattern): files=$($_.Files), hits=$($_.Hits)" }) -join "`n"
$topRows = New-Object System.Collections.Generic.List[string]
$limit = [Math]::Min(50,$detail.Count)
for ($i=0; $i -lt $limit; $i++) {
    $r=$detail[$i]
    $topRows.Add("- $($r.Pattern) :: $($r.File) :: hits=$($r.Hits)")
}
$topText = if ($topRows.Count -eq 0) { "- none" } else { $topRows -join "`n" }

$report = @"
# Phase 6 - Cleanup Readiness Inventory

Status: PASS

Purpose:
Read-only gate before any legacy cleanup. It inventories legacy Employee/CareStage/StageStatus/PATHWAY_DEFAULT usage, verifies Employee to StaffMember and open CareStage to PatientWorkItem migration coverage, and records remaining source dependencies. It does not authorize deletion by itself.

Database counts:
$(Lines-To-Markdown $dbCountsBefore)

Legacy foreign keys targeting Employee or CareStage:
$(Lines-To-Markdown $legacyFks)

Source pattern summary:
$summaryText

Source matches (first 50 discovery rows; full CSV beside this report):
$topText

Cleanup rules:
- Do not drop Employee until data mapping is complete and operational source writes/read dependencies are removed.
- Do not drop CareStage, StageStatus, or PATHWAY_DEFAULT while patient journey/history/compatibility code still depends on them.
- Do not reinterpret responsibleRole or assignedRole as ownership during cleanup.
- Patient-specific clinical Role notification deferrals from Phase 5 remain a routing-foundation dependency; cleanup must not hide or auto-map them.
- Collaboration remains frozen pending its separate disposition proof.
- Never delete Prisma migration history and never use prisma db push.
- Destructive database changes require a separate forward migration, backup/restore readiness, explicit row-level verification, and rollback plan.

Safety:
- Read-only database queries only.
- No migration created or applied.
- No application source modified.
- Database write guard PASS.
- Source SHA256 write guard PASS.
- Original live server untouched.

Next:
Use this inventory to split Phase 6 into independently reversible cleanup batches. Any blocked legacy dependency stays in place until its replacement is proven with data and source checks.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "==========================================="
Write-Host "PHASE 6 CLEANUP READINESS INVENTORY: PASS"
Write-Host "==========================================="
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
