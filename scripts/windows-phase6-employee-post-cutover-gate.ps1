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
function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}
function Get-SourceHash {
    $rows = New-Object System.Collections.Generic.List[string]
    Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel = $_.FullName.Substring($Project.Length + 1).Replace('/','\')
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
        $rows.Add("$rel|$hash")
    }
    return ($rows -join "`n")
}
function Find-SourceMatches {
    param([string]$Pattern,[string]$Label)
    $rows = New-Object System.Collections.Generic.List[object]
    Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($Project.Length + 1).Replace('\','/')
        $lineNo = 0
        foreach ($line in [System.IO.File]::ReadAllLines($_.FullName,[System.Text.Encoding]::UTF8)) {
            $lineNo++
            if ($line -match $Pattern) {
                $rows.Add([pscustomobject]@{ Pattern=$Label; File=$relative; Line=$lineNo; Text=$line.Trim() })
            }
        }
    }
    return $rows.ToArray()
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE POST-CUTOVER GATE ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\41-PHASE6-EMPLOYEE-SOURCE-CUTOVER.md" "Phase 6A Employee source cutover"
Write-Host "Phase 6A source-cutover prerequisite: PASS"

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

$sourceBefore = Get-SourceHash

$dbSql=@'
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'employee_total|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN -1 ELSE (SELECT count(*) FROM "Employee") END
UNION ALL SELECT 'employee_fk_inbound|' || count(*)
FROM pg_constraint c
JOIN pg_class t ON t.oid=c.confrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE c.contype='f' AND n.nspname='public' AND t.relname='Employee'
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_members_active|' || count(*) FROM "staff_members" WHERE "active"=true
UNION ALL SELECT 'staff_legacy_linked|' || count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL
ORDER BY 1;
'@
$dbCounts = Invoke-PsqlText $dbSql
Write-Host $dbCounts

$dbLines = @($dbCounts -split "`r?`n")
if (@($dbLines | Where-Object { $_ -eq 'employee_table_present|1' }).Count -ne 1) { throw "Employee table is not present as expected before drop readiness." }
if (@($dbLines | Where-Object { $_ -eq 'employee_total|0' }).Count -ne 1) { throw "Employee table is not empty. Destructive cleanup is blocked." }
if (@($dbLines | Where-Object { $_ -eq 'employee_fk_inbound|0' }).Count -ne 1) { throw "Inbound Employee foreign keys remain. Destructive cleanup is blocked." }

$prismaEmployee = @(Find-SourceMatches 'prisma\.employee\b' 'PRISMA_EMPLOYEE')
$literalEmployeeTable = @(Find-SourceMatches '["'']Employee["'']' 'EMPLOYEE_TABLE_LITERAL')
$getEmployees = @(Find-SourceMatches '\bgetEmployees\b' 'GET_EMPLOYEES')
$legacyEmployeeId = @(Find-SourceMatches '\blegacyEmployeeId\b' 'LEGACY_EMPLOYEE_ID')

Write-Host "PRISMA_EMPLOYEE|files=$(@($prismaEmployee.File | Sort-Object -Unique).Count)|hits=$($prismaEmployee.Count)"
Write-Host "EMPLOYEE_TABLE_LITERAL|files=$(@($literalEmployeeTable.File | Sort-Object -Unique).Count)|hits=$($literalEmployeeTable.Count)"
Write-Host "GET_EMPLOYEES|files=$(@($getEmployees.File | Sort-Object -Unique).Count)|hits=$($getEmployees.Count)"
Write-Host "LEGACY_EMPLOYEE_ID|files=$(@($legacyEmployeeId.File | Sort-Object -Unique).Count)|hits=$($legacyEmployeeId.Count)"

if ($prismaEmployee.Count -ne 0) { throw "Operational prisma.employee references remain under src/." }

$schemaText=[System.IO.File]::ReadAllText((Join-Path $Project "prisma\schema.prisma"),[System.Text.Encoding]::UTF8)
$schemaEmployeeModel = [regex]::Matches($schemaText,'(?m)^model\s+Employee\s*\{').Count
$schemaLegacyEmployeeId = [regex]::Matches($schemaText,'\blegacyEmployeeId\b').Count
Write-Host "SCHEMA_EMPLOYEE_MODEL|$schemaEmployeeModel"
Write-Host "SCHEMA_LEGACY_EMPLOYEE_ID|$schemaLegacyEmployeeId"
if ($schemaEmployeeModel -ne 1) { throw "Expected exactly one legacy Employee model before destructive cleanup." }

$sourceAfter = Get-SourceHash
if ($sourceAfter -ne $sourceBefore) { throw "Source write guard failed: src/ changed during read-only gate." }
Write-Host "Source write guard: PASS"

$dbCountsAfter = Invoke-PsqlText $dbSql
if ($dbCountsAfter.Trim() -ne $dbCounts.Trim()) { throw "Database write guard failed: Employee/Staff counts changed during read-only gate." }
Write-Host "Database write guard: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "42-PHASE6-EMPLOYEE-POST-CUTOVER-SOURCE.csv"
$allRows=@($prismaEmployee + $literalEmployeeTable + $getEmployees + $legacyEmployeeId)
$allRows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$remainingLiteralFiles=@($literalEmployeeTable.File | Sort-Object -Unique)
$remainingGetEmployeeFiles=@($getEmployees.File | Sort-Object -Unique)
$remainingLegacyIdFiles=@($legacyEmployeeId.File | Sort-Object -Unique)

$reportPath=Join-Path $auditDir "42-PHASE6-EMPLOYEE-POST-CUTOVER-GATE.md"
$report=@"
# Phase 6A - Employee Post-Cutover Gate

Status: PASS

Purpose:
Read-only proof after the Employee -> StaffMember source cutover. It verifies zero operational prisma.employee usage, confirms the legacy Employee table remains empty and has no inbound foreign keys, and records the remaining schema/literal compatibility dependencies before any destructive forward migration.

Database:
$dbCounts

Source summary:
- PRISMA_EMPLOYEE: files=$(@($prismaEmployee.File | Sort-Object -Unique).Count), hits=$($prismaEmployee.Count)
- EMPLOYEE_TABLE_LITERAL: files=$($remainingLiteralFiles.Count), hits=$($literalEmployeeTable.Count)
- GET_EMPLOYEES: files=$($remainingGetEmployeeFiles.Count), hits=$($getEmployees.Count)
- LEGACY_EMPLOYEE_ID: files=$($remainingLegacyIdFiles.Count), hits=$($legacyEmployeeId.Count)
- SCHEMA_EMPLOYEE_MODEL: $schemaEmployeeModel
- SCHEMA_LEGACY_EMPLOYEE_ID: $schemaLegacyEmployeeId

Decision:
- Operational prisma.employee dependency is zero: PASS.
- Employee table is empty and has zero inbound foreign keys: PASS.
- Destructive drop is NOT performed by this gate.
- Any remaining source literal such as maintenance category table lists must be removed or explicitly classified before the drop migration.
- Historical Prisma migrations remain immutable and are not cleanup targets.
- legacyEmployeeId remains compatibility/audit metadata until a separate explicit decision removes it.
- CareStage, StageStatus, PATHWAY_DEFAULT, Role routing, Task ownership, and Collaboration remain outside this batch.

Safety:
- Read-only database queries only.
- No source modified.
- No migration created or applied.
- Source write guard PASS.
- Database write guard PASS.
- Original live server untouched.

Next:
Review the remaining EMPLOYEE_TABLE_LITERAL / GET_EMPLOYEES / LEGACY_EMPLOYEE_ID source rows from the CSV. If the only runtime blocker is the maintenance category literal, cut that dependency first. Then create a separate forward migration to remove the Prisma Employee model/table with backup, restore readiness, schema validation, full tests, build, migration status, and smoke verification.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "============================================"
Write-Host "PHASE 6A EMPLOYEE POST-CUTOVER GATE: PASS"
Write-Host "============================================"
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
