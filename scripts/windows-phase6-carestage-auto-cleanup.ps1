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

function Write-Utf8NoBom {
    param([string]$Path,[string]$Text)
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}

function Wait-LoginSmoke {
    param([int]$Seconds=120)
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
    throw "Login smoke failed. Last result: $last"
}

function Write-BlockedReport {
    param([string[]]$Blockers)
    $auditDir=Join-Path $Project "_PHASE01_AUDIT"
    New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
    $path=Join-Path $auditDir "51-PHASE6-CARESTAGE-AUTO-CLEANUP-READINESS.md"
    $body="# Phase 6B - CareStage Auto Cleanup Readiness`r`n`r`nStatus: BLOCKED`r`n`r`nThe automatic cleanup stopped before source/schema/database writes because operational CareStage dependencies still exist.`r`n`r`nBlockers:`r`n"
    foreach ($b in $Blockers) { $body += "- $b`r`n" }
    $body += "`r`nRules:`r`n- No Role/name/label ownership inference.`r`n- No destructive migration while runtime dependencies remain.`r`n- No historical migration edits and no prisma db push.`r`n- Original live server untouched.`r`n"
    [System.IO.File]::WriteAllText($path,$body,(New-Object System.Text.UTF8Encoding($true)))
    Write-Host "AUTO CLEANUP BLOCKED SAFELY"
    Write-Host "Report: $path"
}

Write-Host ""
Write-Host "=== PHASE 6B CARESTAGE FULL-AUTO LOCAL CLEANUP ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\49-PHASE6-EMPLOYEE-FINAL-RUNTIME-GATE.md" "Employee final runtime gate"
Test-PassReport "_PHASE01_AUDIT\50-PHASE6-CARESTAGE-DEPENDENCY-INVENTORY.md" "CareStage dependency inventory"

$csvPath=Join-Path $Project "_PHASE01_AUDIT\50-PHASE6-CARESTAGE-DEPENDENCY-SOURCE.csv"
if (-not (Test-Path -LiteralPath $csvPath -PathType Leaf)) { throw "CareStage source inventory CSV missing." }
$rows=@(Import-Csv -LiteralPath $csvPath)
$blockCats=@('PRISMA_CARESTAGE','CARESTAGE_ID','CARESTAGE_TYPE','STAGE_STATUS','PATHWAY_DEFAULT','RESPONSIBLE_ROLE')
$blockers=New-Object System.Collections.Generic.List[string]
foreach ($cat in $blockCats) {
    $matches=@($rows | Where-Object { $_.Category -eq $cat })
    if ($matches.Count -gt 0) {
        $hits=0
        foreach ($m in $matches) { $hits += [int]$m.Hits }
        $files=($matches | Select-Object -ExpandProperty File -Unique | Sort-Object) -join ', '
        $blockers.Add("$cat files=$($matches.Count) hits=$hits :: $files")
    }
}
if ($blockers.Count -gt 0) {
    Write-BlockedReport @($blockers)
    exit 20
}

Invoke-NativeCapture "docker" @("info") | Out-Null
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
if ([string]::IsNullOrWhiteSpace($script:dbUser) -or [string]::IsNullOrWhiteSpace($script:dbName) -or [string]::IsNullOrWhiteSpace($dbPassword)) { throw "DB settings missing." }

$preSql=@'
SELECT 'carestage_present|' || CASE WHEN to_regclass('public."CareStage"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'carestage_rows|' || count(*) FROM "CareStage"
UNION ALL SELECT 'referral_column|' || count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='referral_requests' AND column_name='careStageId'
UNION ALL SELECT 'referral_linked|' || count(*) FROM "referral_requests" WHERE "careStageId" IS NOT NULL
UNION ALL SELECT 'stage_enum|' || CASE WHEN EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='StageStatus') THEN 1 ELSE 0 END
UNION ALL SELECT 'stage_enum_external_usage|' || count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname='public' AND t.typname='StageStatus' AND c.relname <> 'CareStage' AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL SELECT 'inbound_fk|' || count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE c.contype='f' AND n.nspname='public' AND t.relname='CareStage'
UNION ALL SELECT 'outbound_fk|' || count(*) FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace n ON n.oid=s.relnamespace WHERE c.contype='f' AND n.nspname='public' AND s.relname='CareStage'
ORDER BY 1;
'@
$pre=Invoke-PsqlText $script:dbName $preSql
Write-Host $pre
$preLines=@($pre -split "`r?`n")
$required=@('carestage_present|1','carestage_rows|0','referral_column|1','referral_linked|0','stage_enum|1','stage_enum_external_usage|0','inbound_fk|1','outbound_fk|1')
foreach ($r in $required) { if (@($preLines | Where-Object { $_ -eq $r }).Count -ne 1) { throw "CareStage destructive precondition failed: $r" } }

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=[System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
if ([regex]::Matches($schema,'(?m)^model\s+CareStage\s*\{').Count -ne 1) { throw "Expected one CareStage model." }
if ([regex]::Matches($schema,'(?m)^enum\s+StageStatus\s*\{').Count -ne 1) { throw "Expected one StageStatus enum." }
if ([regex]::Matches($schema,'(?m)^\s*careStages\s+CareStage\[\]\s*$').Count -ne 1) { throw "Expected one Patient.careStages relation line." }
if ([regex]::Matches($schema,'(?m)^\s*careStageId\s+String\?\s+@unique\s*$').Count -ne 1) { throw "Expected one ReferralRequest.careStageId field." }
if ([regex]::Matches($schema,'(?m)^\s*careStage\s+CareStage\?\s+@relation\("ReferralCareStage".*$').Count -ne 1) { throw "Expected one ReferralRequest.careStage relation field." }

$existing=@(Get-ChildItem -LiteralPath (Join-Path $Project "prisma\migrations") -Directory | Where-Object { $_.Name -like '*_drop_legacy_carestage' })
if ($existing.Count -gt 0) { throw "CareStage drop migration already exists: $($existing.Name -join ', ')" }

Write-Host ""
Write-Host "=== FRESH BACKUP + RESTORE VERIFY ==="
$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupDir=Join-Path $Project (Join-Path ".secrets\phase6-carestage-auto" $stamp)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$containerDump="/tmp/tahili-pre-carestage-$stamp.dump"
$hostDump=Join-Path $backupDir "tahili-pre-carestage-$stamp.dump"
$postgresId=Invoke-ComposeCapture @("ps","-q","postgres")
Invoke-ComposeCapture @("exec","-T","postgres","pg_dump","-Fc","--no-owner","--no-privileges","-U",$script:dbUser,"-d",$script:dbName,"-f",$containerDump) | Out-Null
$list=Invoke-ComposeCapture @("exec","-T","postgres","pg_restore","--list",$containerDump)
if ($list -notmatch 'TABLE DATA') { throw "Backup archive list validation failed." }
Invoke-NativeCapture "docker" @("cp","${postgresId}:$containerDump",$hostDump) | Out-Null
$dumpHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $hostDump).Hash
Write-Host "Backup: $hostDump"
Write-Host "Backup SHA256: $dumpHash"

$verifyDb="phase6_carestage_verify_" + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
Invoke-ComposeCapture @("exec","-T","postgres","dropdb","--if-exists","-U",$script:dbUser,$verifyDb) | Out-Null
Invoke-ComposeCapture @("exec","-T","postgres","createdb","-U",$script:dbUser,$verifyDb) | Out-Null
try {
    Invoke-ComposeCapture @("exec","-T","postgres","pg_restore","--exit-on-error","--no-owner","--no-privileges","-U",$script:dbUser,"-d",$verifyDb,$containerDump) | Out-Null
    $v=Invoke-PsqlText $verifyDb 'SELECT count(*) FROM "CareStage";'
    if ($v.Trim() -ne '0') { throw "Backup restore verification CareStage count mismatch." }
    Write-Host "Backup full restore verification: PASS"
} finally {
    Invoke-ComposeCapture @("exec","-T","postgres","dropdb","--if-exists","-U",$script:dbUser,$verifyDb) | Out-Null
}

$rollbackSchema=Join-Path $backupDir "schema.prisma.before"
Copy-Item -LiteralPath $schemaPath -Destination $rollbackSchema -Force
$migrationName=(Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss") + "_drop_legacy_carestage"
$migrationDir=Join-Path $Project (Join-Path "prisma\migrations" $migrationName)
$applyStarted=$false
$appRebuilt=$false
$tempDb=$null
try {
    $next=$schema
    $next=[regex]::Replace($next,'(?m)^\s*careStages\s+CareStage\[\]\s*\n','',1)
    $next=[regex]::Replace($next,'(?m)^\s*careStageId\s+String\?\s+@unique\s*\n','',1)
    $next=[regex]::Replace($next,'(?m)^\s*careStage\s+CareStage\?\s+@relation\("ReferralCareStage".*\n','',1)
    $next=[regex]::Replace($next,'(?ms)^model\s+CareStage\s*\{\n.*?^\}\n?','',1)
    $next=[regex]::Replace($next,'(?ms)^enum\s+StageStatus\s*\{\n.*?^\}\n?','',1)
    if ([regex]::Matches($next,'(?m)^model\s+CareStage\s*\{').Count -ne 0) { throw "CareStage model removal failed." }
    if ([regex]::Matches($next,'(?m)^enum\s+StageStatus\s*\{').Count -ne 0) { throw "StageStatus enum removal failed." }
    if ($next -match '\bcareStageId\b|\bCareStage\b|\bStageStatus\b') { throw "Schema still contains CareStage/StageStatus compatibility references after guarded removal." }
    Write-Utf8NoBom $schemaPath $next

    New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
    $migrationSql=@'
-- Phase 6B: remove empty legacy CareStage workflow after PatientWorkItem cutover.
ALTER TABLE "referral_requests" DROP COLUMN "careStageId";
DROP TABLE "CareStage";
DROP TYPE "StageStatus";
'@
    Write-Utf8NoBom (Join-Path $migrationDir "migration.sql") ($migrationSql + "`n")
    Write-Host "Prepared migration: $migrationName"

    Write-Host ""
    Write-Host "=== BUILD + TEST CURRENT SOURCE ==="
    $out=Invoke-ComposeCapture @("--profile","checks","build","checks"); if ($out) { Write-Host $out }
    foreach ($cmd in @(
        @("npx","prisma","validate","--schema","prisma/schema.prisma"),
        @("npx","prisma","generate","--schema","prisma/schema.prisma"),
        @("npx","tsc","--noEmit"),
        @("npx","vitest","run"),
        @("npm","run","build")
    )) {
        $o=Invoke-ComposeCapture (@("--profile","checks","run","--rm","--no-deps","checks") + $cmd)
        if ($o) { Write-Host $o }
    }

    Write-Host ""
    Write-Host "=== TEMP MIGRATION PROOF ==="
    $tempDb="phase6_carestage_test_" + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
    Invoke-ComposeCapture @("exec","-T","postgres","createdb","-U",$script:dbUser,$tempDb) | Out-Null
    Invoke-ComposeCapture @("exec","-T","postgres","pg_restore","--exit-on-error","--no-owner","--no-privileges","-U",$script:dbUser,"-d",$tempDb,$containerDump) | Out-Null
    $tempUrl="postgresql://${script:dbUser}:$dbPassword@postgres:5432/$tempDb"
    $d=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","-e","DATABASE_URL=$tempUrl","checks","npx","prisma","migrate","deploy")
    Write-Host $d
    $tempCheck=Invoke-PsqlText $tempDb @'
SELECT 'carestage|' || CASE WHEN to_regclass('public."CareStage"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'referral_column|' || count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='referral_requests' AND column_name='careStageId'
UNION ALL SELECT 'stage_enum|' || CASE WHEN EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='StageStatus') THEN 1 ELSE 0 END
ORDER BY 1;
'@
    Write-Host $tempCheck
    foreach ($x in @('carestage|0','referral_column|0','stage_enum|0')) { if (@($tempCheck -split "`r?`n" | Where-Object { $_ -eq $x }).Count -ne 1) { throw "Temp migration proof failed: $x" } }
    $ts=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","-e","DATABASE_URL=$tempUrl","checks","npx","prisma","migrate","status")
    if ($ts -notmatch 'Database schema is up to date!') { throw "Temp migration status failed." }
    Invoke-ComposeCapture @("exec","-T","postgres","dropdb","--if-exists","-U",$script:dbUser,$tempDb) | Out-Null
    $tempDb=$null

    Write-Host ""
    Write-Host "=== APPLY TO ISOLATED LOCAL MAIN DB ==="
    $applyStarted=$true
    $deploy=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","deploy")
    Write-Host $deploy
    $post=Invoke-PsqlText $script:dbName @'
SELECT 'carestage|' || CASE WHEN to_regclass('public."CareStage"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'referral_column|' || count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='referral_requests' AND column_name='careStageId'
UNION ALL SELECT 'stage_enum|' || CASE WHEN EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='StageStatus') THEN 1 ELSE 0 END
ORDER BY 1;
'@
    Write-Host $post
    foreach ($x in @('carestage|0','referral_column|0','stage_enum|0')) { if (@($post -split "`r?`n" | Where-Object { $_ -eq $x }).Count -ne 1) { throw "Main DB post-migration check failed: $x" } }

    Write-Host ""
    Write-Host "=== REBUILD LOCAL APP ==="
    $buildApp=Invoke-ComposeCapture @("build","app"); if ($buildApp) { Write-Host $buildApp }
    $up=Invoke-ComposeCapture @("up","-d","--no-deps","--force-recreate","app"); if ($up) { Write-Host $up }
    $appRebuilt=$true
    $http=Wait-LoginSmoke 120
    Write-Host "Login smoke: PASS (HTTP $http)"
    $status=Invoke-ComposeCapture @("exec","-T","app","npx","prisma","migrate","status")
    Write-Host $status
    if ($status -notmatch 'Database schema is up to date!') { throw "Runtime Prisma status failed." }
    $logs=Invoke-ComposeCapture @("logs","--since","2m","app")
    $fatal=@($logs -split "`r?`n" | Where-Object { $_ -match '(?i)uncaught|unhandled rejection|prisma.*error|fatal error' })
    if ($fatal.Count -gt 0) { throw "Fatal runtime logs detected.`n$($fatal -join "`n")" }

    $auditDir=Join-Path $Project "_PHASE01_AUDIT"
    $report=Join-Path $auditDir "52-PHASE6-CARESTAGE-AUTO-CLEANUP-FINAL.md"
    $text=@"
# Phase 6B - CareStage Auto Cleanup Final

Status: PASS

Migration: $migrationName
Backup: $hostDump
Backup SHA256: $dumpHash

Verified:
- CareStage source dependency gate was zero for destructive categories.
- CareStage table was empty.
- referral_requests.careStageId had zero linked rows.
- Fresh PostgreSQL backup and full restore verification passed.
- Prisma validate/generate, TypeScript, Vitest, and production build passed.
- Forward migration passed against a restored temporary database first.
- CareStage table removed from isolated local main DB.
- referral_requests.careStageId removed.
- StageStatus enum removed.
- Local app rebuilt from post-drop schema and login smoke passed.
- Prisma migration status is up to date.
- Historical migrations were not edited.
- prisma db push was not used.
- Original live server untouched.
"@
    [System.IO.File]::WriteAllText($report,$text,(New-Object System.Text.UTF8Encoding($true)))
    Write-Host ""
    Write-Host "==========================================="
    Write-Host "PHASE 6B CARESTAGE AUTO CLEANUP: PASS"
    Write-Host "==========================================="
    Write-Host "Report: $report"
}
catch {
    if (-not $applyStarted) {
        if (Test-Path -LiteralPath $rollbackSchema) { Copy-Item -LiteralPath $rollbackSchema -Destination $schemaPath -Force }
        if (Test-Path -LiteralPath $migrationDir) { Remove-Item -LiteralPath $migrationDir -Recurse -Force }
        Write-Host "Pre-apply failure: schema/migration preparation rolled back locally."
    } else {
        Write-Host "DESTRUCTIVE APPLY HAD STARTED. Do not rerun automatically."
        Write-Host "Rollback database backup: $hostDump"
        Write-Host "Rollback backup SHA256: $dumpHash"
    }
    throw
}
finally {
    if ($tempDb) { try { Invoke-ComposeCapture @("exec","-T","postgres","dropdb","--if-exists","-U",$script:dbUser,$tempDb) | Out-Null } catch {} }
    try { Invoke-ComposeCapture @("exec","-T","postgres","rm","-f",$containerDump) | Out-Null } catch {}
}
