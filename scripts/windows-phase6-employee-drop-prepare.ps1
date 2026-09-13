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

function Invoke-NativeCapture {
    param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string[]]$Arguments)
    $old=$ErrorActionPreference
    try {
        $ErrorActionPreference="Continue"
        $out=& $Exe @Arguments 2>&1
        $code=$LASTEXITCODE
    } finally {
        $ErrorActionPreference=$old
    }
    if ($code -ne 0) { throw "$Exe failed with exit code $code.`n$($out | Out-String)" }
    return (($out | Out-String).Trim())
}
function Invoke-ComposeCapture {
    param([Parameter(Mandatory=$true)][string[]]$Arguments)
    return Invoke-NativeCapture "docker" @($Compose + $Arguments)
}
function Invoke-PsqlText {
    param([Parameter(Mandatory=$true)][string]$Database,[Parameter(Mandatory=$true)][string]$Sql)
    $args=$Compose + @("exec","-T","postgres","psql","-X","-v","ON_ERROR_STOP=1","-U",$script:dbUser,"-d",$Database,"-Atq")
    $old=$ErrorActionPreference
    try {
        $ErrorActionPreference="Continue"
        $out=$Sql | & docker @args 2>&1
        $code=$LASTEXITCODE
    } finally {
        $ErrorActionPreference=$old
    }
    if ($code -ne 0) { throw "psql failed.`n$($out | Out-String)" }
    return (($out | Out-String).Trim())
}
function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path=Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text=[System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}
function Get-SourceHash {
    $rows=New-Object System.Collections.Generic.List[string]
    Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel=$_.FullName.Substring($Project.Length+1).Replace('/','\')
        $rows.Add("$rel|$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)")
    }
    return ($rows -join "`n")
}
function Write-Utf8NoBom {
    param([string]$Path,[string]$Text)
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE DROP MIGRATION PREPARE ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\46-PHASE6-EMPLOYEE-RUNTIME-CUTOVER.md" "Phase 6A runtime cutover"
Test-PassReport "_PHASE01_AUDIT\45-PHASE6-EMPLOYEE-DROP-BACKUP-RESTORE.md" "Phase 6A backup/restore verification"
Write-Host "Phase 6A prerequisites: PASS"

Invoke-NativeCapture "docker" @("info") | Out-Null
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
$dbPassword=$envMap["DB_PASSWORD"]
if ([string]::IsNullOrWhiteSpace($script:dbUser) -or [string]::IsNullOrWhiteSpace($script:dbName) -or [string]::IsNullOrWhiteSpace($dbPassword)) { throw "DB_USER/DB_NAME/DB_PASSWORD missing." }

$sourceHashBefore=Get-SourceHash
$dbSql=@'
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'employee_total|' || (SELECT count(*) FROM "Employee")
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
$dbBefore=Invoke-PsqlText $script:dbName $dbSql
Write-Host $dbBefore
$dbLines=@($dbBefore -split "`r?`n")
if (@($dbLines | Where-Object { $_ -eq 'employee_table_present|1' }).Count -ne 1) { throw "Employee table must exist before preparing the drop migration." }
if (@($dbLines | Where-Object { $_ -eq 'employee_total|0' }).Count -ne 1) { throw "Employee table is not empty. Stop." }
if (@($dbLines | Where-Object { $_ -eq 'employee_fk_inbound|0' }).Count -ne 1) { throw "Inbound Employee foreign keys remain. Stop." }

$srcFiles=Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
$prismaEmployeeHits=0
$employeeLiteralHits=0
foreach ($file in $srcFiles) {
    $text=[System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    $prismaEmployeeHits += [regex]::Matches($text,'prisma\.employee\b').Count
    $employeeLiteralHits += [regex]::Matches($text,'["'']Employee["'']').Count
}
if ($prismaEmployeeHits -ne 0 -or $employeeLiteralHits -ne 0) { throw "Active source still depends on Employee. prisma=$prismaEmployeeHits literal=$employeeLiteralHits" }

Write-Host ""
Write-Host "=== CURRENT MIGRATION STATUS ==="
$statusBefore=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")
Write-Host $statusBefore
if ($statusBefore -notmatch 'Database schema is up to date!') { throw "Main database must be migration-current before preparing a new forward migration." }

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=[System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
$employeePattern='(?ms)^model\s+Employee\s*\{\n.*?^\}\n?'
$employeeMatches=[regex]::Matches($schema,$employeePattern)
if ($employeeMatches.Count -ne 1) { throw "Expected exactly one Employee model block, found $($employeeMatches.Count)." }
if ([regex]::Matches($schema,'\blegacyEmployeeId\b').Count -lt 1) { throw "legacyEmployeeId compatibility metadata must remain." }

$existingDropMigrations=@(Get-ChildItem -LiteralPath (Join-Path $Project "prisma\migrations") -Directory | Where-Object { $_.Name -like '*_drop_legacy_employee' })
if ($existingDropMigrations.Count -gt 0) { throw "A drop_legacy_employee migration already exists. Stop for review: $($existingDropMigrations.Name -join ', ')" }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
$migrationName="${stamp}_drop_legacy_employee"
$migrationDir=Join-Path $Project (Join-Path "prisma\migrations" $migrationName)
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase6-employee-drop-prepare" ((Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")))
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $schemaPath -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force
Write-Host "Rollback snapshot: $rollbackDir"

$prepared=$false
$tempDb=$null
$containerDump=$null
try {
    $schemaAfter=[regex]::Replace($schema,$employeePattern,'',1)
    if ([regex]::Matches($schemaAfter,'(?m)^model\s+Employee\s*\{').Count -ne 0) { throw "Employee model removal assertion failed." }
    if ([regex]::Matches($schemaAfter,'\blegacyEmployeeId\b').Count -lt 1) { throw "legacyEmployeeId was unexpectedly removed." }
    Write-Utf8NoBom $schemaPath $schemaAfter

    New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
    $migrationSql='-- Phase 6A: remove empty legacy Employee table after StaffMember cutover.' + "`n" + 'DROP TABLE "Employee";' + "`n"
    Write-Utf8NoBom (Join-Path $migrationDir "migration.sql") $migrationSql
    Write-Host "Prepared migration: $migrationName"

    if ((Get-SourceHash) -ne $sourceHashBefore) { throw "src/ changed while preparing schema/migration. Stop." }

    Write-Host ""
    Write-Host "=== BUILD + STATIC VERIFICATION ==="
    $build=Invoke-ComposeCapture @("--profile","checks","build","checks")
    if ($build) { Write-Host $build }
    foreach ($cmd in @(
        @("npx","prisma","validate","--schema","prisma/schema.prisma"),
        @("npx","prisma","generate","--schema","prisma/schema.prisma"),
        @("npx","tsc","--noEmit"),
        @("npx","vitest","run"),
        @("npm","run","build")
    )) {
        $out=Invoke-ComposeCapture (@("--profile","checks","run","--rm","--no-deps","checks") + $cmd)
        if ($out) { Write-Host $out }
    }

    Write-Host ""
    Write-Host "=== TEMP DATABASE MIGRATION TEST ==="
    $verifyStamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
    $tempDb="phase6_emp_drop_$verifyStamp"
    $containerDump="/tmp/phase6-emp-drop-$verifyStamp.dump"
    Invoke-ComposeCapture @("exec","-T","postgres","pg_dump","-Fc","--no-owner","--no-privileges","-U",$script:dbUser,"-d",$script:dbName,"-f",$containerDump) | Out-Null
    Invoke-ComposeCapture @("exec","-T","postgres","dropdb","--if-exists","-U",$script:dbUser,$tempDb) | Out-Null
    Invoke-ComposeCapture @("exec","-T","postgres","createdb","-U",$script:dbUser,$tempDb) | Out-Null
    Invoke-ComposeCapture @("exec","-T","postgres","pg_restore","--exit-on-error","--no-owner","--no-privileges","-U",$script:dbUser,"-d",$tempDb,$containerDump) | Out-Null

    $tempUrl="postgresql://${script:dbUser}:$dbPassword@postgres:5432/$tempDb"
    $deploy=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","-e","DATABASE_URL=$tempUrl","checks","npx","prisma","migrate","deploy")
    Write-Host $deploy
    if ($deploy -notmatch [regex]::Escape($migrationName)) { throw "Temporary migrate deploy did not report the prepared Employee drop migration." }

    $verifySql=@'
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_members_active|' || count(*) FROM "staff_members" WHERE "active"=true
UNION ALL SELECT 'staff_legacy_linked|' || count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL
ORDER BY 1;
'@
    $tempVerify=Invoke-PsqlText $tempDb $verifySql
    Write-Host $tempVerify
    if (@($tempVerify -split "`r?`n" | Where-Object { $_ -eq 'employee_table_present|0' }).Count -ne 1) { throw "Employee table still exists in temporary migrated database." }
    $beforeStaff=@($dbLines | Where-Object { $_ -like 'staff_*' }) -join "`n"
    $afterStaff=@($tempVerify -split "`r?`n" | Where-Object { $_ -like 'staff_*' }) -join "`n"
    if ($beforeStaff.Trim() -ne $afterStaff.Trim()) { throw "StaffMember counts changed in temporary migration test." }

    $tempStatus=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","-e","DATABASE_URL=$tempUrl","checks","npx","prisma","migrate","status")
    Write-Host $tempStatus
    if ($tempStatus -notmatch 'Database schema is up to date!') { throw "Temporary migrated database is not schema-current." }

    $dbAfter=Invoke-PsqlText $script:dbName $dbSql
    if ($dbAfter.Trim() -ne $dbBefore.Trim()) { throw "Main database changed during migration preparation." }
    Write-Host "Main database write guard: PASS"

    $auditDir=Join-Path $Project "_PHASE01_AUDIT"
    New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
    $reportPath=Join-Path $auditDir "47-PHASE6-EMPLOYEE-DROP-MIGRATION-PREPARE.md"
    $report=@"
# Phase 6A - Employee Drop Migration Prepare

Status: PASS

Prepared migration: $migrationName

Verification:
- Reports 45 and 46 prerequisites: PASS.
- Active prisma.employee references: 0.
- Active Employee literals: 0.
- Main Employee table present and empty before apply.
- Main Employee inbound FKs: 0.
- StaffMember.legacyEmployeeId retained.
- Prisma validate/generate PASS.
- TypeScript, Vitest, and production build PASS.
- Fresh temporary database restored from the current local source database.
- Prepared migration applied successfully to temporary database only.
- Temporary Employee table absent after migration.
- Temporary StaffMember counts unchanged.
- Temporary Prisma migration status: up to date.
- Main database write guard: PASS; no migration applied to the main local database.
- Historical migrations were not edited.
- prisma db push was not used.
- Rollback schema snapshot: $rollbackDir
- Original live server untouched.

Next:
Apply this already-tested forward migration to the isolated local main database under rollback protection, then rebuild/recreate the local app against the post-drop schema and run final gates.
"@
    [System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))
    $prepared=$true
    Write-Host ""
    Write-Host "=============================================="
    Write-Host "PHASE 6A EMPLOYEE DROP MIGRATION PREPARE: PASS"
    Write-Host "=============================================="
    Write-Host "Migration: $migrationName"
    Write-Host "Report: $reportPath"
}
catch {
    Write-Host ""
    Write-Host "Preparation failed. Restoring schema and removing the new migration directory..."
    if (Test-Path -LiteralPath (Join-Path $rollbackDir "schema.prisma.before")) {
        Copy-Item -LiteralPath (Join-Path $rollbackDir "schema.prisma.before") -Destination $schemaPath -Force
    }
    if (Test-Path -LiteralPath $migrationDir) { Remove-Item -LiteralPath $migrationDir -Recurse -Force }
    throw
}
finally {
    if ($tempDb) {
        try { Invoke-ComposeCapture @("exec","-T","postgres","dropdb","--if-exists","-U",$script:dbUser,$tempDb) | Out-Null } catch { Write-Host "WARNING: temp DB cleanup failed: $($_.Exception.Message)" }
    }
    if ($containerDump) {
        try { Invoke-ComposeCapture @("exec","-T","postgres","rm","-f",$containerDump) | Out-Null } catch { }
    }
    if ($prepared) { Write-Host "Prepared schema + forward migration remain locally for the next controlled apply step." }
}
