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
    throw "Login smoke did not become healthy within $Seconds seconds. Last result: $last"
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE FINAL RUNTIME GATE ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\48-PHASE6-EMPLOYEE-DROP-MIGRATION-APPLY.md" "Phase 6A Employee drop apply"
Write-Host "Phase 6A apply prerequisite: PASS"

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
if ($migrationDirs.Count -ne 1) { throw "Expected exactly one drop_legacy_employee migration, found $($migrationDirs.Count)." }
$migrationName=$migrationDirs[0].Name
if ($migrationName -notmatch '^\d{14}_drop_legacy_employee$') { throw "Unexpected migration name: $migrationName" }
$migrationSqlPath=Join-Path $migrationDirs[0].FullName "migration.sql"
if (-not (Test-Path -LiteralPath $migrationSqlPath -PathType Leaf)) { throw "migration.sql missing: $migrationSqlPath" }
$migrationSql=[System.IO.File]::ReadAllText($migrationSqlPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n").Trim()
if ($migrationSql -notmatch '(?m)^DROP TABLE "Employee";\s*$') { throw "Employee drop migration content is unexpected." }
if ([regex]::Matches($migrationSql,'(?im)^\s*(DROP|ALTER|DELETE|TRUNCATE|UPDATE|INSERT)\b').Count -ne 1) { throw "Employee drop migration has unexpected additional mutating SQL." }

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=[System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8)
if ([regex]::Matches($schema,'(?m)^model\s+Employee\s*\{').Count -ne 0) { throw "Employee model still exists in schema.prisma." }
if ([regex]::Matches($schema,'\blegacyEmployeeId\b').Count -lt 1) { throw "legacyEmployeeId compatibility metadata is missing." }

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

$dbSql=@"
SELECT 'employee_table_present|' || CASE WHEN to_regclass('public."Employee"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_members_active|' || count(*) FROM "staff_members" WHERE "active"=true
UNION ALL SELECT 'staff_legacy_linked|' || count(*) FROM "staff_members" WHERE "legacyEmployeeId" IS NOT NULL
UNION ALL SELECT 'migration_applied|' || count(*) FROM "_prisma_migrations" WHERE migration_name = '$migrationName' AND finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL SELECT 'public_table_count|' || count(*) FROM pg_tables WHERE schemaname='public'
ORDER BY 1;
"@
$dbBefore=Invoke-PsqlText $script:dbName $dbSql
Write-Host $dbBefore
$dbLines=@($dbBefore -split "`r?`n")
if (@($dbLines | Where-Object { $_ -eq 'employee_table_present|0' }).Count -ne 1) { throw "Employee table still exists." }
if (@($dbLines | Where-Object { $_ -eq 'migration_applied|1' }).Count -ne 1) { throw "Employee drop migration is not recorded exactly once." }

Write-Host ""
Write-Host "=== STATIC FINAL VERIFICATION ==="
$checksBuild=Invoke-ComposeCapture @("--profile","checks","build","checks")
if ($checksBuild) { Write-Host $checksBuild }
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

$statusChecks=Invoke-ComposeCapture @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")
Write-Host $statusChecks
if ($statusChecks -notmatch 'Database schema is up to date!') { throw "Checks image does not report an up-to-date Prisma schema." }

$oldContainer=Invoke-ComposeCapture @("ps","-q","app")
if ([string]::IsNullOrWhiteSpace($oldContainer)) { throw "Running app container was not found." }
$oldImageId=Invoke-NativeCapture "docker" @("inspect","-f","{{.Image}}",$oldContainer)
$oldImageName=Invoke-NativeCapture "docker" @("inspect","-f","{{.Config.Image}}",$oldContainer)
$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackTag="tahili-phase6-employee-final-rollback:$stamp"
Invoke-NativeCapture "docker" @("tag",$oldImageId,$rollbackTag) | Out-Null
Write-Host "Rollback image tag: $rollbackTag"
Write-Host "Previous app image: $oldImageId"

$cutoverSucceeded=$false
try {
    Write-Host ""
    Write-Host "=== BUILD POST-DROP APP IMAGE ==="
    $appBuild=Invoke-ComposeCapture @("build","app")
    if ($appBuild) { Write-Host $appBuild }

    Write-Host ""
    Write-Host "=== RECREATE LOCAL APP ONLY ==="
    $up=Invoke-ComposeCapture @("up","-d","--no-deps","--force-recreate","app")
    if ($up) { Write-Host $up }

    $httpCode=Wait-LoginSmoke 120
    Write-Host "Running app login smoke: PASS (HTTP $httpCode)"

    $newContainer=Invoke-ComposeCapture @("ps","-q","app")
    if ([string]::IsNullOrWhiteSpace($newContainer)) { throw "New app container was not found." }
    $newImageId=Invoke-NativeCapture "docker" @("inspect","-f","{{.Image}}",$newContainer)
    Write-Host "New app image: $newImageId"

    $runtimeStatus=Invoke-ComposeCapture @("exec","-T","app","npx","prisma","migrate","status")
    Write-Host $runtimeStatus
    if ($runtimeStatus -notmatch 'Database schema is up to date!') { throw "Post-drop app runtime does not report an up-to-date Prisma schema." }

    $clientCheck="const {Prisma}=require('@prisma/client'); const emp=Prisma.dmmf.datamodel.models.some(m=>m.name==='Employee'); const staff=Prisma.dmmf.datamodel.models.find(m=>m.name==='StaffMember'); const legacy=!!staff && staff.fields.some(f=>f.name==='legacyEmployeeId'); process.exit((!emp && legacy)?0:9);"
    Invoke-ComposeCapture @("exec","-T","app","node","-e",$clientCheck) | Out-Null
    Write-Host "Runtime Prisma client gate: PASS"

    $dbAfter=Invoke-PsqlText $script:dbName $dbSql
    if ($dbAfter.Trim() -ne $dbBefore.Trim()) { throw "Database guard failed: Employee/Staff/migration/table-count state changed during final runtime cutover." }
    Write-Host "Database write guard: PASS"

    $logs=Invoke-ComposeCapture @("logs","--since","2m","app")
    $fatalHits=@($logs -split "`r?`n" | Where-Object { $_ -match '(?i)uncaught|unhandled rejection|prisma.*error|fatal error' })
    if ($fatalHits.Count -gt 0) { throw "Fatal-looking app log entries found after post-drop runtime cutover.`n$($fatalHits -join "`n")" }
    Write-Host "Recent app fatal-log gate: PASS"

    if ((Get-SourceHash) -ne $sourceHashBefore) { throw "Source write guard failed: src/ changed during final runtime gate." }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash -ne $schemaHashBefore) { throw "schema.prisma changed during final runtime gate." }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $migrationSqlPath).Hash -ne $migrationHashBefore) { throw "migration.sql changed during final runtime gate." }
    Write-Host "Source/schema/migration write guards: PASS"

    $auditDir=Join-Path $Project "_PHASE01_AUDIT"
    New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
    $reportPath=Join-Path $auditDir "49-PHASE6-EMPLOYEE-FINAL-RUNTIME-GATE.md"
    $report=@"
# Phase 6A - Employee Final Runtime Gate

Status: PASS

Migration: $migrationName

Verification:
- Report 48 apply prerequisite: PASS.
- Employee table absent.
- Employee drop migration recorded exactly once.
- Active prisma.employee references: $prismaEmployeeHits.
- Active Employee literals: $employeeLiteralHits.
- Employee model absent from current Prisma schema.
- StaffMember.legacyEmployeeId retained.
- Prisma validate/generate PASS.
- TypeScript, full Vitest, and production build PASS.
- Prisma migration status: up to date in checks image and rebuilt runtime app.
- Post-drop app rebuilt and recreated from current local source/schema.
- Runtime Prisma client has no Employee model and retains StaffMember.legacyEmployeeId.
- Login smoke: PASS (HTTP $httpCode).
- Recent fatal-log gate: PASS.
- Database write guard: PASS.
- Source/schema/migration write guards: PASS.
- Previous app image: $oldImageId
- Rollback image tag: $rollbackTag
- New app image: $newImageId
- Historical migrations were not edited.
- prisma db push was not used.
- Original live server untouched.

Decision:
Phase 6A legacy Employee cleanup is complete in the isolated local clone. Do not treat CareStage, StageStatus, Task ownership, role-routed clinical notifications, or Collaboration as cleared by this gate; each remains a separate dependency/cutover decision.
"@
    [System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))
    $cutoverSucceeded=$true

    Write-Host ""
    Write-Host "========================================="
    Write-Host "PHASE 6A EMPLOYEE FINAL RUNTIME GATE: PASS"
    Write-Host "========================================="
    Write-Host "Report: $reportPath"
}
catch {
    Write-Host ""
    Write-Host "Final runtime gate failed. Attempting local app image rollback only..."
    try {
        Invoke-NativeCapture "docker" @("tag",$rollbackTag,$oldImageName) | Out-Null
        $rollbackUp=Invoke-ComposeCapture @("up","-d","--no-deps","--force-recreate","app")
        if ($rollbackUp) { Write-Host $rollbackUp }
        $rollbackHttp=Wait-LoginSmoke 120
        Write-Host "Rollback login smoke: PASS (HTTP $rollbackHttp)"
    } catch {
        Write-Host "WARNING: automatic local app rollback also failed: $($_.Exception.Message)"
    }
    throw
}
finally {
    if ($cutoverSucceeded) { Write-Host "Local app runtime now uses the rebuilt post-drop Employee-free Prisma schema." }
}
