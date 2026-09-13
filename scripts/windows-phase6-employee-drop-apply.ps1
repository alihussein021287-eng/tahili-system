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

function Wait-LoginSmoke {
    param([int]$Seconds=90)
    $deadline=(Get-Date).AddSeconds($Seconds)
    $last=""
    while ((Get-Date) -lt $deadline) {
        $old=$ErrorActionPreference
        try {
            $ErrorActionPreference="Continue"
            $last=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 10 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
            $code=$LASTEXITCODE
        } finally {
            $ErrorActionPreference=$old
        }
        if ($code -eq 0 -and $last -match '^\d{3}$') {
            $n=[int]$last
            if ($n -ge 200 -and $n -lt 400) { return $n }
        }
        Start-Sleep -Seconds 3
    }
    throw "Login smoke did not become healthy within $Seconds seconds. Last result: $last"
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE DROP MIGRATION APPLY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\45-PHASE6-EMPLOYEE-DROP-BACKUP-RESTORE.md" "Phase 6A backup/restore verification"
Test-PassReport "_PHASE01_AUDIT\46-PHASE6-EMPLOYEE-RUNTIME-CUTOVER.md" "Phase 6A runtime cutover"
Test-PassReport "_PHASE01_AUDIT\47-PHASE6-EMPLOYEE-DROP-MIGRATION-PREPARE.md" "Phase 6A migration preparation"
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
if ([string]::IsNullOrWhiteSpace($script:dbUser) -or [string]::IsNullOrWhiteSpace($script:dbName)) { throw "DB_USER/DB_NAME missing." }

$migrationDirs=@(Get-ChildItem -LiteralPath (Join-Path $Project "prisma\migrations") -Directory | Where-Object { $_.Name -like '*_drop_legacy_employee' })
if ($migrationDirs.Count -ne 1) { throw "Expected exactly one prepared drop_legacy_employee migration, found $($migrationDirs.Count)." }
$migrationDir=$migrationDirs[0]
$migrationName=$migrationDir.Name
if ($migrationName -notmatch '^\d{14}_drop_legacy_employee$') { throw "Unexpected migration name: $migrationName" }
$migrationSqlPath=Join-Path $migrationDir.FullName "migration.sql"
if (-not (Test-Path -LiteralPath $migrationSqlPath -PathType Leaf)) { throw "migration.sql missing: $migrationSqlPath" }
$migrationSql=[System.IO.File]::ReadAllText($migrationSqlPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n").Trim()
if ($migrationSql -notmatch '(?m)^DROP TABLE "Employee";\s*$') { throw "Prepared migration does not contain the expected Employee drop statement." }
if ([regex]::Matches($migrationSql,'(?im)^\s*(DROP|ALTER|DELETE|TRUNCATE|UPDATE|INSERT)\b').Count -ne 1) { throw "Prepared migration contains unexpected additional mutating SQL." }

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=[System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8)
if ([regex]::Matches($schema,'(?m)^model\s+Employee\s*\{').Count -ne 0) { throw "Employee model still exists in schema.prisma." }
if ([regex]::Matches($schema,'\blegacyEmployeeId\b').Count -lt 1) { throw "StaffMember legacyEmployeeId compatibility metadata is missing." }

$srcFiles=Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
$prismaEmployeeHits=0
$employeeLiteralHits=0
foreach ($file in $srcFiles) {
    $text=[System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    $prismaEmployeeHits += [regex]::Matches($text,'prisma\.employee\b').Count
    $employeeLiteralHits += [regex]::Matches($text,'["'']Employee["'']').Count
}
if ($prismaEmployeeHits -ne 0 -or $employeeLiteralHits -ne 0) { throw "Active source still depends on Employee. prisma=$prismaEmployeeHits literal=$employeeLiteralHits" }

$sourceHashBefore=Get-SourceHash
$schemaHashBefore=(Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash
$migrationHashBefore=(Get-FileHash -Algorithm SHA256 -LiteralPath $migrationSqlPath).Hash

$preSql=@'
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
UNION ALL SELECT 'public_table_count|' || count(*) FROM pg_tables WHERE schemaname='public'
ORDER BY 1;
'@
$pre=Invoke-PsqlText $script:dbName $preSql
Write-Host $pre
$preLines=@($pre -split "`r?`n")
if (@($preLines | Where-Object { $_ -eq 'employee_table_present|1' }).Count -ne 1) { throw "Employee table is not present before apply." }
if (@($preLines | Where-Object { $_ -eq 'employee_total|0' }).Count -ne 1) { throw "Employee table is not empty. Apply blocked." }
if (@($preLines | Where-Object { $_ -eq 'employee_fk_inbound|0' }).Count -ne 1) { throw "Inbound Employee foreign keys remain. Apply blocked." }
$preStaff=@($preLines | Where-Object { $_ -like 'staff_*' }) -join "`n"
$preTableLine=@($preLines | Where-Object { $_ -like 'public_table_count|*' })
if ($preTableLine.Count -ne 1) { throw "Could not capture public table count." }
$preTableCount=[int](($preTableLine[0] -split '\|')[1])

$appliedSql=@"
SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '$migrationName' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;
"@
$appliedBefore=Invoke-PsqlText $script:dbName $appliedSql
if ($appliedBefore.Trim() -ne '0') { throw "Prepared migration is already recorded as applied. Stop for review." }

Write-Host ""
Write-Host "=== BUILD CURRENT CHECKS IMAGE ==="
$build=Invoke-ComposeCapture @("--profile","checks","build","checks")
if ($build) { Write-Host $build }
$validate=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
if ($validate) { Write-Host $validate }

Write-Host ""
Write-Host "=== FRESH PRE-APPLY DATABASE BACKUP ==="
$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupDir=Join-Path $Project (Join-Path ".secrets\phase6-employee-drop-apply" $stamp)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$dumpName="tahili-pre-employee-drop-$stamp.dump"
$containerDump="/tmp/$dumpName"
$hostDump=Join-Path $backupDir $dumpName
$postgresId=Invoke-ComposeCapture @("ps","-q","postgres")
if ([string]::IsNullOrWhiteSpace($postgresId)) { throw "Postgres container not found." }
Invoke-ComposeCapture @("exec","-T","postgres","rm","-f",$containerDump) | Out-Null
Invoke-ComposeCapture @("exec","-T","postgres","pg_dump","-Fc","--no-owner","--no-privileges","-U",$script:dbUser,"-d",$script:dbName,"-f",$containerDump) | Out-Null
$listText=Invoke-ComposeCapture @("exec","-T","postgres","pg_restore","--list",$containerDump)
if ($listText -notmatch 'TABLE DATA') { throw "Fresh pre-apply backup archive validation failed." }
Invoke-NativeCapture "docker" @("cp","${postgresId}:$containerDump",$hostDump) | Out-Null
if (-not (Test-Path -LiteralPath $hostDump -PathType Leaf)) { throw "Fresh backup was not copied to host." }
$dumpInfo=Get-Item -LiteralPath $hostDump
if ($dumpInfo.Length -le 0) { throw "Fresh backup file is empty." }
$dumpHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $hostDump).Hash
[System.IO.File]::WriteAllText((Join-Path $backupDir "pg_restore-list.txt"),$listText,(New-Object System.Text.UTF8Encoding($false)))
Write-Host "Backup: $hostDump"
Write-Host "Backup bytes: $($dumpInfo.Length)"
Write-Host "Backup SHA256: $dumpHash"

$deployStarted=$false
try {
    Write-Host ""
    Write-Host "=== APPLY TESTED FORWARD MIGRATION TO LOCAL MAIN DB ==="
    $deployStarted=$true
    $deploy=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","deploy")
    Write-Host $deploy
    if ($deploy -notmatch [regex]::Escape($migrationName)) { throw "migrate deploy output did not report the prepared migration." }

    $postSql=@'
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_members_active|' || count(*) FROM "staff_members" WHERE "active"=true
UNION ALL SELECT 'staff_legacy_linked|' || count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL
UNION ALL SELECT 'public_table_count|' || count(*) FROM pg_tables WHERE schemaname='public'
ORDER BY 1;
'@
    $post=Invoke-PsqlText $script:dbName $postSql
    Write-Host $post
    $postLines=@($post -split "`r?`n")
    if (@($postLines | Where-Object { $_ -eq 'employee_table_present|0' }).Count -ne 1) { throw "Employee table still exists after migrate deploy." }
    $postStaff=@($postLines | Where-Object { $_ -like 'staff_*' }) -join "`n"
    if ($postStaff.Trim() -ne $preStaff.Trim()) { throw "StaffMember counts changed during Employee drop migration." }
    $postTableLine=@($postLines | Where-Object { $_ -like 'public_table_count|*' })
    if ($postTableLine.Count -ne 1) { throw "Could not capture post-migration public table count." }
    $postTableCount=[int](($postTableLine[0] -split '\|')[1])
    if ($postTableCount -ne ($preTableCount - 1)) { throw "Public table count did not decrease by exactly one after Employee drop. before=$preTableCount after=$postTableCount" }

    $appliedAfter=Invoke-PsqlText $script:dbName $appliedSql
    if ($appliedAfter.Trim() -ne '1') { throw "Prepared migration is not recorded exactly once as successfully applied." }

    Write-Host ""
    Write-Host "=== POST-APPLY PRISMA STATUS ==="
    $status=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")
    Write-Host $status
    if ($status -notmatch 'Database schema is up to date!') { throw "Post-apply Prisma migration status is not up to date." }

    $httpCode=Wait-LoginSmoke 120
    Write-Host "Running app login smoke: PASS (HTTP $httpCode)"
    Start-Sleep -Seconds 2
    $logs=Invoke-ComposeCapture @("logs","--since","2m","app")
    $fatalHits=@($logs -split "`r?`n" | Where-Object { $_ -match '(?i)uncaught|unhandled rejection|prisma.*error|fatal error' })
    if ($fatalHits.Count -gt 0) { throw "Fatal-looking app log entries found after Employee drop.`n$($fatalHits -join "`n")" }
    Write-Host "Recent app fatal-log gate: PASS"

    if ((Get-SourceHash) -ne $sourceHashBefore) { throw "Source write guard failed: src/ changed during apply." }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash -ne $schemaHashBefore) { throw "schema.prisma changed during apply." }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $migrationSqlPath).Hash -ne $migrationHashBefore) { throw "migration.sql changed during apply." }
    Write-Host "Source/schema/migration write guards: PASS"

    $auditDir=Join-Path $Project "_PHASE01_AUDIT"
    New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
    $reportPath=Join-Path $auditDir "48-PHASE6-EMPLOYEE-DROP-MIGRATION-APPLY.md"
    $report=@"
# Phase 6A - Employee Drop Migration Apply

Status: PASS

Migration: $migrationName

Verification:
- Reports 45, 46, and 47 prerequisites: PASS.
- Active prisma.employee references: $prismaEmployeeHits.
- Active Employee literals: $employeeLiteralHits.
- Employee table was present, empty, and had zero inbound foreign keys immediately before apply.
- Fresh custom-format PostgreSQL backup created immediately before apply.
- Fresh backup: $hostDump
- Fresh backup SHA256: $dumpHash
- Fresh backup size: $($dumpInfo.Length) bytes.
- Previously proven full backup/restore verification remains report 45.
- Forward migration applied with prisma migrate deploy.
- Employee table absent after migration.
- StaffMember counts unchanged.
- Public table count changed from $preTableCount to $postTableCount, exactly one table removed.
- Migration recorded exactly once as successfully applied.
- Prisma migration status: up to date.
- Existing local app login smoke: PASS (HTTP $httpCode).
- Recent fatal-log gate: PASS.
- Source/schema/migration write guards: PASS.
- Historical migrations were not edited.
- prisma db push was not used.
- Original live server untouched.

Next:
Rebuild and recreate the isolated local app from the post-drop schema, then run the final Phase 6A Employee cleanup gate. Do not start CareStage or other destructive cleanup until that final gate passes.
"@
    [System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

    Write-Host ""
    Write-Host "============================================"
    Write-Host "PHASE 6A EMPLOYEE DROP MIGRATION APPLY: PASS"
    Write-Host "============================================"
    Write-Host "Migration: $migrationName"
    Write-Host "Report: $reportPath"
}
catch {
    Write-Host ""
    Write-Host "EMPLOYEE DROP APPLY FAILED."
    if ($deployStarted) {
        Write-Host "Do not rerun and do not restore automatically. Review database state first."
        Write-Host "Fresh rollback backup: $hostDump"
        Write-Host "Fresh rollback backup SHA256: $dumpHash"
    }
    throw
}
finally {
    try { Invoke-ComposeCapture @("exec","-T","postgres","rm","-f",$containerDump) | Out-Null } catch { }
}
