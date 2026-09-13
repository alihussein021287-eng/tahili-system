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

function Get-TrackedSourceFiles {
    $roots = @("src","prisma")
    $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    foreach ($root in $roots) {
        $path = Join-Path $Project $root
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $path -Recurse -File | Where-Object {
            $_.Extension -in @('.ts','.tsx','.js','.jsx','.prisma','.sql')
        } | ForEach-Object { $files.Add($_) }
    }
    return @($files)
}

function Get-SourceHashes {
    param([System.IO.FileInfo[]]$Files)
    $map=@{}
    foreach ($file in $Files) {
        $map[$file.FullName]=(Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
    }
    return $map
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE DEPENDENCY INVENTORY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\38-PHASE6-CLEANUP-READINESS-INVENTORY.md" "Phase 6 cleanup readiness inventory"
Write-Host "Phase 6 cleanup readiness prerequisite: PASS"

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

$dbCountsSql=@'
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'employee_total|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE (SELECT count(*) FROM "Employee") END
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_with_legacy_employee_id|' || count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL
UNION ALL SELECT 'staff_legacy_orphan|' || count(*) FROM "staff_members" s WHERE s."legacyEmployeeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e.id=s."legacyEmployeeId")
ORDER BY 1;
'@
$dbCounts=Invoke-PsqlText $dbCountsSql
Write-Host $dbCounts

$fkSql=@'
SELECT tc.table_name || '|' || tc.constraint_name || '|' || pg_get_constraintdef(pc.oid)
FROM information_schema.table_constraints tc
JOIN pg_constraint pc ON pc.conname=tc.constraint_name
WHERE tc.constraint_type='FOREIGN KEY'
  AND pg_get_constraintdef(pc.oid) ILIKE '%"Employee"%'
ORDER BY tc.table_name, tc.constraint_name;
'@
$employeeFks=Invoke-PsqlText $fkSql
if ([string]::IsNullOrWhiteSpace($employeeFks)) { $employeeFks="(none)" }
Write-Host "Employee foreign keys:"
Write-Host $employeeFks

$sourceFiles=Get-TrackedSourceFiles
$sourceHashBefore=Get-SourceHashes $sourceFiles

$patterns=[ordered]@{
    PRISMA_EMPLOYEE='\bprisma\.employee\b'
    EMPLOYEE_MODEL='(?m)^\s*model\s+Employee\s*\{'
    EMPLOYEE_TYPE='\bEmployee\b'
    EMPLOYEE_LOWER='\bemployee(s)?\b'
    LEGACY_EMPLOYEE_ID='\blegacyEmployeeId\b'
    STAFF_MEMBER='\bstaffMember(s)?\b|\bStaffMember\b'
    EMPLOYEE_API_PATH='employee'
}

$detail = New-Object System.Collections.Generic.List[object]
foreach ($file in $sourceFiles) {
    $relative=$file.FullName.Substring($Project.Length + 1).Replace('\','/')
    $lines=[System.IO.File]::ReadAllLines($file.FullName,[System.Text.Encoding]::UTF8)
    for ($i=0; $i -lt $lines.Length; $i++) {
        $line=$lines[$i]
        foreach ($entry in $patterns.GetEnumerator()) {
            if ([regex]::IsMatch($line,$entry.Value,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
                $detail.Add([pscustomobject]@{
                    Pattern=$entry.Key
                    File=$relative
                    Line=$i+1
                    Text=$line.Trim()
                })
            }
        }
    }
}

$summary = New-Object System.Collections.Generic.List[object]
foreach ($entry in $patterns.GetEnumerator()) {
    $rows=@($detail | Where-Object { $_.Pattern -eq $entry.Key })
    $filesCount=@($rows | Select-Object -ExpandProperty File -Unique).Count
    $summary.Add([pscustomobject]@{ Pattern=$entry.Key; Files=$filesCount; Hits=$rows.Count })
}

foreach ($row in $summary) {
    Write-Host "$($row.Pattern)|files=$($row.Files)|hits=$($row.Hits)"
}

$sourceHashAfter=Get-SourceHashes $sourceFiles
foreach ($path in $sourceHashBefore.Keys) {
    if (-not $sourceHashAfter.ContainsKey($path) -or $sourceHashBefore[$path] -ne $sourceHashAfter[$path]) {
        throw "Source write guard failed: $path"
    }
}
Write-Host "Source write guard: PASS"

$dbCountsAfter=Invoke-PsqlText $dbCountsSql
if ($dbCountsAfter.Trim() -ne $dbCounts.Trim()) { throw "Database write guard failed: row counts changed." }
Write-Host "Database write guard: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "39-PHASE6-EMPLOYEE-DEPENDENCY-INVENTORY.md"
$csvPath=Join-Path $auditDir "39-PHASE6-EMPLOYEE-DEPENDENCY-SOURCE.csv"

$detail | Sort-Object -Property File,Line,Pattern | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$summaryText=($summary | ForEach-Object { "- $($_.Pattern): files=$($_.Files), hits=$($_.Hits)" }) -join "`n"
$fkText=if ($employeeFks -eq "(none)") { "- none" } else { (($employeeFks -split "`r?`n") | ForEach-Object { "- $_" }) -join "`n" }
$dbText=(($dbCounts -split "`r?`n") | ForEach-Object { "- $_" }) -join "`n"
$topRows=@($detail | Sort-Object -Property File,Line | Select-Object -First 80)
$topText=if ($topRows.Count -eq 0) { "- none" } else { ($topRows | ForEach-Object { "- $($_.Pattern) :: $($_.File):$($_.Line) :: $($_.Text)" }) -join "`n" }

$report=@"
# Phase 6A - Employee Dependency Inventory

Status: PASS

Purpose:
Read-only focused inventory before any Employee cleanup. It distinguishes real Prisma/model dependencies from incidental employee wording and records whether the empty legacy Employee table still has database foreign-key dependencies.

Database counts:
$dbText

Foreign keys referencing Employee:
$fkText

Source pattern summary:
$summaryText

Source matches (first 80; full CSV beside this report):
$topText

Decision boundary:
- Employee table/model removal is not authorized by this inventory alone.
- Remove operational Prisma Employee reads/writes before any schema/table drop.
- Keep legacyEmployeeId only as long as rollback/audit compatibility requires it; do not infer identity from names.
- Replace employee-selection UI/data reads with StaffMember only after exact source dependency review.
- No changes to CareStage, StageStatus, PATHWAY_DEFAULT, Role routing, or Collaboration in this batch.
- Never edit historical Prisma migrations and never use prisma db push.

Safety:
- Read-only database queries only.
- No migration created or applied.
- No application source modified.
- Database write guard PASS.
- Source SHA256 write guard PASS.
- Original live server untouched.

Next:
Classify every real Employee dependency from this report. Only then prepare a reversible source cutover batch; destructive schema cleanup remains a later gate.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "=============================================="
Write-Host "PHASE 6A EMPLOYEE DEPENDENCY INVENTORY: PASS"
Write-Host "=============================================="
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
