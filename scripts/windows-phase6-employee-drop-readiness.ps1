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
        $rel = $_.FullName.Substring($Project.Length + 1).Replace('/','\\')
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
        $rows.Add("$rel|$hash")
    }
    return ($rows -join "`n")
}

function Find-SourceMatches {
    param([string]$Pattern,[string]$Label)
    $rows = New-Object System.Collections.Generic.List[object]
    Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($Project.Length + 1).Replace('\\','/')
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

function Get-UniqueFileCount {
    param([object[]]$Rows)
    if ($null -eq $Rows -or $Rows.Count -eq 0) { return 0 }
    return @($Rows | ForEach-Object { $_.File } | Sort-Object -Unique).Count
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE DROP READINESS ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\43-PHASE6-EMPLOYEE-MAINTENANCE-CUTOVER.md" "Phase 6A Employee maintenance cutover"
Write-Host "Phase 6A maintenance-cutover prerequisite: PASS"

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
if (@($dbLines | Where-Object { $_ -eq 'employee_table_present|1' }).Count -ne 1) { throw "Employee table is not present before the planned drop." }
if (@($dbLines | Where-Object { $_ -eq 'employee_total|0' }).Count -ne 1) { throw "Employee table is not empty. Drop is blocked." }
if (@($dbLines | Where-Object { $_ -eq 'employee_fk_inbound|0' }).Count -ne 1) { throw "Inbound Employee foreign keys remain. Drop is blocked." }

$prismaEmployee = @(Find-SourceMatches 'prisma\.employee\b' 'PRISMA_EMPLOYEE')
$employeeLiteral = @(Find-SourceMatches '["'']Employee["'']' 'EMPLOYEE_LITERAL')
$getEmployees = @(Find-SourceMatches '\bgetEmployees\b' 'GET_EMPLOYEES')
$legacyEmployeeIdSrc = @(Find-SourceMatches '\blegacyEmployeeId\b' 'LEGACY_EMPLOYEE_ID_SOURCE')

Write-Host "PRISMA_EMPLOYEE|files=$(Get-UniqueFileCount $prismaEmployee)|hits=$($prismaEmployee.Count)"
Write-Host "EMPLOYEE_LITERAL|files=$(Get-UniqueFileCount $employeeLiteral)|hits=$($employeeLiteral.Count)"
Write-Host "GET_EMPLOYEES|files=$(Get-UniqueFileCount $getEmployees)|hits=$($getEmployees.Count)"
Write-Host "LEGACY_EMPLOYEE_ID_SOURCE|files=$(Get-UniqueFileCount $legacyEmployeeIdSrc)|hits=$($legacyEmployeeIdSrc.Count)"

if ($prismaEmployee.Count -ne 0) { throw "Operational prisma.employee references remain under src/." }
if ($employeeLiteral.Count -ne 0) { throw "Runtime Employee table/name literal remains under src/. Review before drop." }

$catsPath=Join-Path $Project "src\app\(app)\maintenance\cats.ts"
$pagePath=Join-Path $Project "src\app\(app)\maintenance\page.tsx"
$catsText=[System.IO.File]::ReadAllText($catsPath,[System.Text.Encoding]::UTF8)
$pageText=[System.IO.File]::ReadAllText($pagePath,[System.Text.Encoding]::UTF8)
if ($catsText -match 'Employee') { throw "Maintenance categories still reference Employee." }
if ($pageText -match 'count:\s*c\[12\]\s*\+\s*c\[13\]') { throw "Maintenance attendance delete count still includes StaffMember compatibility count." }
Write-Host "Maintenance Employee dependency: PASS"

$schemaText=[System.IO.File]::ReadAllText((Join-Path $Project "prisma\schema.prisma"),[System.Text.Encoding]::UTF8)
$schemaEmployeeModel=[regex]::Matches($schemaText,'(?m)^model\s+Employee\s*\{').Count
$schemaLegacyEmployeeId=[regex]::Matches($schemaText,'\blegacyEmployeeId\b').Count
Write-Host "SCHEMA_EMPLOYEE_MODEL|$schemaEmployeeModel"
Write-Host "SCHEMA_LEGACY_EMPLOYEE_ID|$schemaLegacyEmployeeId"
if ($schemaEmployeeModel -ne 1) { throw "Expected exactly one legacy Employee Prisma model before the forward drop migration." }
if ($schemaLegacyEmployeeId -lt 1) { throw "Expected legacyEmployeeId compatibility metadata to remain for rollback/audit." }

Write-Host ""
Write-Host "=== PRISMA MIGRATION STATUS ==="
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    $migrateStatus = & docker @($Compose + @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")) 2>&1
    $migrateExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($migrateExitCode -ne 0) { throw "Prisma migrate status failed.`n$($migrateStatus | Out-String)" }
$migrateText=($migrateStatus | Out-String).Trim()
Write-Host $migrateText
if ($migrateText -notmatch 'Database schema is up to date!') { throw "Database schema is not reported up to date. Drop is blocked." }

$sourceAfter = Get-SourceHash
if ($sourceAfter -ne $sourceBefore) { throw "Source write guard failed: src/ changed during read-only readiness gate." }
Write-Host "Source write guard: PASS"

$dbCountsAfter=Invoke-PsqlText $dbSql
if ($dbCountsAfter.Trim() -ne $dbCounts.Trim()) { throw "Database write guard failed: Employee/Staff counts changed during read-only readiness gate." }
Write-Host "Database write guard: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "44-PHASE6-EMPLOYEE-DROP-READINESS-SOURCE.csv"
$allRows=@($prismaEmployee + $employeeLiteral + $getEmployees + $legacyEmployeeIdSrc)
$allRows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$reportPath=Join-Path $auditDir "44-PHASE6-EMPLOYEE-DROP-READINESS.md"
$report=@"
# Phase 6A - Employee Drop Readiness

Status: PASS

Purpose:
Final read-only dependency gate before creating any destructive forward migration for the legacy Employee model/table.

Database:
$dbCounts

Source:
- PRISMA_EMPLOYEE: files=$(Get-UniqueFileCount $prismaEmployee), hits=$($prismaEmployee.Count)
- EMPLOYEE_LITERAL: files=$(Get-UniqueFileCount $employeeLiteral), hits=$($employeeLiteral.Count)
- GET_EMPLOYEES: files=$(Get-UniqueFileCount $getEmployees), hits=$($getEmployees.Count) (semantic compatibility helper name only; implementation is StaffMember after source cutover)
- LEGACY_EMPLOYEE_ID_SOURCE: files=$(Get-UniqueFileCount $legacyEmployeeIdSrc), hits=$($legacyEmployeeIdSrc.Count)
- SCHEMA_EMPLOYEE_MODEL: $schemaEmployeeModel
- SCHEMA_LEGACY_EMPLOYEE_ID: $schemaLegacyEmployeeId

Verification:
- Employee table present and empty: PASS.
- Employee inbound foreign keys: zero.
- Operational prisma.employee usage: zero.
- Runtime Employee literal under src/: zero.
- Maintenance Employee dependency removed: PASS.
- Prisma migration status: up to date.
- Source write guard: PASS.
- Database write guard: PASS.

Decision:
- Dependency readiness for a separate Employee drop migration is PASS.
- This gate does NOT create or apply a migration.
- A fresh phase-specific PostgreSQL backup plus restore/list verification is required immediately before destructive migration work.
- legacyEmployeeId remains compatibility/audit metadata in StaffMember and is not part of this drop batch.
- Historical Prisma migrations remain immutable.
- No prisma db push.
- CareStage, StageStatus, PATHWAY_DEFAULT, Role routing, Task ownership, and Collaboration remain outside this batch.
- Original live server untouched.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "==========================================="
Write-Host "PHASE 6A EMPLOYEE DROP READINESS: PASS"
Write-Host "==========================================="
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
