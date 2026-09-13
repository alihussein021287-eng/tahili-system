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

function Invoke-DockerCapture {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & docker @Arguments 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $old
    }
    $text = (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    if ($code -ne 0) { throw "Docker command failed: docker $($Arguments -join ' ')`n$text" }
    return $text
}

function Invoke-ComposeCapture {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    return Invoke-DockerCapture ($Compose + $Arguments)
}

function Invoke-PsqlText {
    param([Parameter(Mandatory = $true)][string]$Database,[Parameter(Mandatory = $true)][string]$Sql)
    $args = $Compose + @(
        "exec", "-T", "postgres",
        "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", $script:dbUser,
        "-d", $Database,
        "-Atq"
    )
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = $Sql | & docker @args 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $old
    }
    $text = (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    if ($code -ne 0) { throw "psql failed for database $Database.`n$text" }
    return $text
}

function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Get-TableCounts {
    param([Parameter(Mandatory = $true)][string]$Database)
    $sql = @'
SELECT format(
  'SELECT %L || ''|'' || count(*) FROM %I.%I;',
  tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
\gexec
'@
    $text = Invoke-PsqlText $Database $sql
    return (($text -split "`r?`n") | Where-Object { $_ -match '^[^|]+\|\d+$' } | Sort-Object) -join "`n"
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE DROP BACKUP + RESTORE VERIFY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\44-PHASE6-EMPLOYEE-DROP-READINESS.md" "Phase 6A Employee drop readiness"
Write-Host "Phase 6A drop-readiness prerequisite: PASS"

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

$postgresId=(Invoke-ComposeCapture @("ps","-q","postgres")).Trim()
$appId=(Invoke-ComposeCapture @("ps","-q","app")).Trim()
if ([string]::IsNullOrWhiteSpace($postgresId) -or [string]::IsNullOrWhiteSpace($appId)) { throw "Local Tahili postgres/app stack is not running." }

$employeePre = Invoke-PsqlText $script:dbName @'
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'employee_total|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN -1 ELSE (SELECT count(*) FROM "Employee") END
UNION ALL SELECT 'employee_fk_inbound|' || count(*)
FROM pg_constraint c
JOIN pg_class t ON t.oid=c.confrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE c.contype='f' AND n.nspname='public' AND t.relname='Employee'
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_legacy_linked|' || count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL
ORDER BY 1;
'@
Write-Host $employeePre
$employeeLines=@($employeePre -split "`r?`n")
if (@($employeeLines | Where-Object { $_ -eq 'employee_table_present|1' }).Count -ne 1) { throw "Employee table must still exist before backup." }
if (@($employeeLines | Where-Object { $_ -eq 'employee_total|0' }).Count -ne 1) { throw "Employee table is not empty. Destructive work remains blocked." }
if (@($employeeLines | Where-Object { $_ -eq 'employee_fk_inbound|0' }).Count -ne 1) { throw "Employee inbound foreign keys remain." }

Write-Host ""
Write-Host "=== SOURCE ROW-COUNT SNAPSHOT ==="
$sourceCountsBefore = Get-TableCounts $script:dbName
$sourceTableCount = @($sourceCountsBefore -split "`r?`n" | Where-Object { $_ }).Count
if ($sourceTableCount -lt 1) { throw "Could not collect source table counts." }
Write-Host "Source public tables counted: $sourceTableCount"

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupDir=Join-Path $Project (Join-Path ".secrets\phase6-employee-drop-backup" $stamp)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$dumpName="tahili-$stamp.dump"
$hostDump=Join-Path $backupDir $dumpName
$containerDump="/tmp/$dumpName"
$verifyDb=("phase6_emp_verify_" + $stamp.ToLowerInvariant().Replace("-","").Replace(":","").Replace("t","").Replace("z","")).Replace(".","")
if ($verifyDb.Length -gt 60) { $verifyDb=$verifyDb.Substring(0,60) }

$verifyDbCreated=$false
try {
    Write-Host ""
    Write-Host "=== CREATE CUSTOM-FORMAT PG_DUMP ==="
    Invoke-ComposeCapture @("exec","-T","postgres","rm","-f",$containerDump) | Out-Null
    $dumpOut=Invoke-ComposeCapture @("exec","-T","postgres","pg_dump","-Fc","--no-owner","--no-privileges","-U",$script:dbUser,"-d",$script:dbName,"-f",$containerDump)
    if ($dumpOut) { Write-Host $dumpOut }

    Write-Host ""
    Write-Host "=== VALIDATE ARCHIVE LIST ==="
    $listText=Invoke-ComposeCapture @("exec","-T","postgres","pg_restore","--list",$containerDump)
    if ($listText -notmatch 'TABLE DATA') { throw "pg_restore --list did not show TABLE DATA entries." }
    $listPath=Join-Path $backupDir "pg_restore-list.txt"
    [System.IO.File]::WriteAllText($listPath,$listText,(New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Archive list: PASS"

    Write-Host ""
    Write-Host "=== COPY BACKUP TO HOST ==="
    $cpText=Invoke-DockerCapture @("cp","${postgresId}:$containerDump",$hostDump)
    if ($cpText) { Write-Host $cpText }
    if (-not (Test-Path -LiteralPath $hostDump -PathType Leaf)) { throw "Backup file was not copied to host." }
    $dumpInfo=Get-Item -LiteralPath $hostDump
    if ($dumpInfo.Length -le 0) { throw "Backup file is empty." }
    $dumpHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $hostDump).Hash
    Write-Host "Backup bytes: $($dumpInfo.Length)"
    Write-Host "Backup SHA256: $dumpHash"

    Write-Host ""
    Write-Host "=== FULL RESTORE VERIFICATION ==="
    Invoke-ComposeCapture @("exec","-T","postgres","dropdb","--if-exists","-U",$script:dbUser,$verifyDb) | Out-Null
    Invoke-ComposeCapture @("exec","-T","postgres","createdb","-U",$script:dbUser,$verifyDb) | Out-Null
    $verifyDbCreated=$true
    $restoreText=Invoke-ComposeCapture @("exec","-T","postgres","pg_restore","--exit-on-error","--no-owner","--no-privileges","-U",$script:dbUser,"-d",$verifyDb,$containerDump)
    if ($restoreText) { Write-Host $restoreText }

    $verifyCounts=Get-TableCounts $verifyDb
    if ($verifyCounts -ne $sourceCountsBefore) {
        $sourceCountsPath=Join-Path $backupDir "source-table-counts.txt"
        $verifyCountsPath=Join-Path $backupDir "restore-table-counts.txt"
        [System.IO.File]::WriteAllText($sourceCountsPath,$sourceCountsBefore,(New-Object System.Text.UTF8Encoding($false)))
        [System.IO.File]::WriteAllText($verifyCountsPath,$verifyCounts,(New-Object System.Text.UTF8Encoding($false)))
        throw "Restored table counts do not exactly match the source snapshot. Review saved count files."
    }
    Write-Host "Full restore row-count comparison: PASS"

    $verifyEmployee=Invoke-PsqlText $verifyDb @'
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'employee_total|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN -1 ELSE (SELECT count(*) FROM "Employee") END
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_legacy_linked|' || count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL
ORDER BY 1;
'@
    if ($verifyEmployee.Trim() -ne (($employeePre -split "`r?`n" | Where-Object { $_ -notmatch '^employee_fk_inbound\|' }) -join "`n").Trim()) {
        throw "Restored Employee/Staff verification does not match source snapshot."
    }
    Write-Host "Employee/Staff restore verification: PASS"

    Write-Host ""
    Write-Host "=== SOURCE WRITE GUARD ==="
    $sourceCountsAfter=Get-TableCounts $script:dbName
    if ($sourceCountsAfter -ne $sourceCountsBefore) { throw "Source database row counts changed during backup verification. Stop before destructive work." }
    $employeePost=Invoke-PsqlText $script:dbName @'
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'employee_total|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN -1 ELSE (SELECT count(*) FROM "Employee") END
UNION ALL SELECT 'employee_fk_inbound|' || count(*)
FROM pg_constraint c
JOIN pg_class t ON t.oid=c.confrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE c.contype='f' AND n.nspname='public' AND t.relname='Employee'
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_legacy_linked|' || count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL
ORDER BY 1;
'@
    if ($employeePost.Trim() -ne $employeePre.Trim()) { throw "Employee/Staff source guard failed." }
    Write-Host "Source database write guard: PASS"

    $sourceCountsPath=Join-Path $backupDir "source-table-counts.txt"
    [System.IO.File]::WriteAllText($sourceCountsPath,$sourceCountsBefore,(New-Object System.Text.UTF8Encoding($false)))

    $auditDir=Join-Path $Project "_PHASE01_AUDIT"
    New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
    $reportPath=Join-Path $auditDir "45-PHASE6-EMPLOYEE-DROP-BACKUP-RESTORE.md"
    $report=@"
# Phase 6A - Employee Drop Backup and Restore Verification

Status: PASS

Purpose:
Fresh phase-specific PostgreSQL rollback point immediately before the destructive Employee drop migration.

Backup:
- Format: pg_dump custom format (-Fc)
- File: $hostDump
- Bytes: $($dumpInfo.Length)
- SHA256: $dumpHash
- Archive list: $listPath
- Public tables counted: $sourceTableCount

Pre-drop database state:
$employeePre

Verification:
- pg_restore --list: PASS.
- Full restore into temporary database: PASS.
- Exact public-table row-count comparison source vs restored database: PASS.
- Employee/Staff restored-state comparison: PASS.
- Source database row-count write guard: PASS.
- Employee remains present and empty in the source database.
- No migration was created or applied.
- Temporary verification database was used only for restore testing and is removed during cleanup.
- Original live server untouched.

Scope:
This fresh backup is for the Employee schema-drop batch. The earlier Phase 0 backup remains the broader PostgreSQL/MinIO/uploads baseline. No MinIO or upload data is modified by this Employee drop batch.

Next:
Create a separate forward Prisma migration that removes only the legacy Employee model/table. Keep StaffMember.legacyEmployeeId for compatibility/audit. Do not edit historical migrations and do not use prisma db push.
"@
    [System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

    Write-Host ""
    Write-Host "===================================================="
    Write-Host "PHASE 6A EMPLOYEE DROP BACKUP + RESTORE VERIFY: PASS"
    Write-Host "===================================================="
    Write-Host ""
    Write-Host "Backup: $hostDump"
    Write-Host "Report: $reportPath"
}
finally {
    if ($verifyDbCreated) {
        try { Invoke-ComposeCapture @("exec","-T","postgres","dropdb","--if-exists","-U",$script:dbUser,$verifyDb) | Out-Null } catch { Write-Warning "Could not remove temporary verification database $verifyDb : $($_.Exception.Message)" }
    }
    try { Invoke-ComposeCapture @("exec","-T","postgres","rm","-f",$containerDump) | Out-Null } catch { Write-Warning "Could not remove temporary container dump $containerDump : $($_.Exception.Message)" }
}
