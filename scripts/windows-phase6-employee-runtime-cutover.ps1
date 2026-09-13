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
    param([Parameter(Mandatory = $true)][string]$Exe,[Parameter(Mandatory = $true)][string[]]$Arguments)
    $old = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $out = & $Exe @Arguments 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
    if ($code -ne 0) { throw "$Exe failed with exit code $code.`n$($out | Out-String)" }
    return (($out | Out-String).Trim())
}

function Invoke-ComposeCapture {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    return Invoke-NativeCapture "docker" @($Compose + $Arguments)
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

function Wait-LoginSmoke {
    param([int]$Seconds = 90)
    $deadline = (Get-Date).AddSeconds($Seconds)
    $last = ""
    while ((Get-Date) -lt $deadline) {
        $old = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $last = (& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 10 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $old
        }
        if ($code -eq 0 -and $last -match '^\d{3}$') {
            $n = [int]$last
            if ($n -ge 200 -and $n -lt 400) { return $n }
        }
        Start-Sleep -Seconds 3
    }
    throw "Login smoke did not become healthy within $Seconds seconds. Last result: $last"
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE RUNTIME CUTOVER ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\43-PHASE6-EMPLOYEE-MAINTENANCE-CUTOVER.md" "Phase 6A maintenance cutover"
Test-PassReport "_PHASE01_AUDIT\44-PHASE6-EMPLOYEE-DROP-READINESS.md" "Phase 6A drop readiness"
Test-PassReport "_PHASE01_AUDIT\45-PHASE6-EMPLOYEE-DROP-BACKUP-RESTORE.md" "Phase 6A backup/restore verification"
Write-Host "Phase 6A prerequisites: PASS"

Invoke-NativeCapture "docker" @("info") | Out-Null
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$sourceBefore = Get-SourceHash

$srcFiles = Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
$prismaEmployeeHits = 0
$employeeLiteralHits = 0
foreach ($file in $srcFiles) {
    $text = [System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    $prismaEmployeeHits += [regex]::Matches($text,'prisma\.employee\b').Count
    $employeeLiteralHits += [regex]::Matches($text,'["'']Employee["'']').Count
}
if ($prismaEmployeeHits -ne 0) { throw "Runtime cutover blocked: prisma.employee hits=$prismaEmployeeHits" }
if ($employeeLiteralHits -ne 0) { throw "Runtime cutover blocked: Employee runtime literal hits=$employeeLiteralHits" }

$schemaText = [System.IO.File]::ReadAllText((Join-Path $Project "prisma\schema.prisma"),[System.Text.Encoding]::UTF8)
if ([regex]::Matches($schemaText,'(?m)^model\s+Employee\s*\{').Count -ne 1) { throw "Expected legacy Employee model to still exist before DB drop." }
if ([regex]::Matches($schemaText,'\blegacyEmployeeId\b').Count -lt 1) { throw "legacyEmployeeId compatibility metadata is missing." }

$envMap=@{}
foreach ($line in Get-Content -LiteralPath ".env.saif-dev") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $k=$Matches[1]; $v=$Matches[2].Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v=$v.Substring(1,$v.Length-2) }
        $envMap[$k]=$v
    }
}
$dbUser=$envMap["DB_USER"]
$dbName=$envMap["DB_NAME"]
if ([string]::IsNullOrWhiteSpace($dbUser) -or [string]::IsNullOrWhiteSpace($dbName)) { throw "DB_USER/DB_NAME missing." }

$dbSql = @'
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
$dbArgs = $Compose + @("exec","-T","postgres","psql","-X","-v","ON_ERROR_STOP=1","-U",$dbUser,"-d",$dbName,"-Atq","-c",$dbSql)
$dbBefore = Invoke-NativeCapture "docker" $dbArgs
Write-Host $dbBefore
$dbLines=@($dbBefore -split "`r?`n")
if (@($dbLines | Where-Object { $_ -eq 'employee_table_present|1' }).Count -ne 1) { throw "Employee table is not present before runtime cutover." }
if (@($dbLines | Where-Object { $_ -eq 'employee_total|0' }).Count -ne 1) { throw "Employee table is not empty. Runtime cutover is blocked." }
if (@($dbLines | Where-Object { $_ -eq 'employee_fk_inbound|0' }).Count -ne 1) { throw "Employee inbound FK remains. Runtime cutover is blocked." }

$oldContainer = Invoke-ComposeCapture @("ps","-q","app")
if ([string]::IsNullOrWhiteSpace($oldContainer)) { throw "Running app container was not found." }
$oldImageId = Invoke-NativeCapture "docker" @("inspect","-f","{{.Image}}",$oldContainer)
$oldImageName = Invoke-NativeCapture "docker" @("inspect","-f","{{.Config.Image}}",$oldContainer)
$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackTag="tahili-phase6-employee-runtime-rollback:$stamp"
Invoke-NativeCapture "docker" @("tag",$oldImageId,$rollbackTag) | Out-Null
Write-Host "Rollback image tag: $rollbackTag"
Write-Host "Old app image: $oldImageId"

$cutoverSucceeded=$false
try {
    Write-Host ""
    Write-Host "=== BUILD CURRENT APP SOURCE ==="
    $buildOut=Invoke-ComposeCapture @("build","app")
    if ($buildOut) { Write-Host $buildOut }

    Write-Host ""
    Write-Host "=== RECREATE LOCAL APP ONLY ==="
    $upOut=Invoke-ComposeCapture @("up","-d","--no-deps","--force-recreate","app")
    if ($upOut) { Write-Host $upOut }

    $httpCode=Wait-LoginSmoke 120
    Write-Host "Running app login smoke: PASS (HTTP $httpCode)"

    $newContainer=Invoke-ComposeCapture @("ps","-q","app")
    if ([string]::IsNullOrWhiteSpace($newContainer)) { throw "New app container was not found after recreate." }
    $newImageId=Invoke-NativeCapture "docker" @("inspect","-f","{{.Image}}",$newContainer)
    Write-Host "New app image: $newImageId"

    Write-Host ""
    Write-Host "=== NEW APP PRISMA STATUS ==="
    $status=Invoke-ComposeCapture @("exec","-T","app","npx","prisma","migrate","status")
    Write-Host $status
    if ($status -notmatch 'Database schema is up to date!') { throw "New app container does not report an up-to-date Prisma schema." }

    $dbAfter=Invoke-NativeCapture "docker" $dbArgs
    if ($dbAfter.Trim() -ne $dbBefore.Trim()) { throw "Database Employee/Staff counts changed during runtime cutover." }
    Write-Host "Database write guard: PASS"

    $sourceAfter=Get-SourceHash
    if ($sourceAfter -ne $sourceBefore) { throw "Source write guard failed: src/ changed during runtime cutover." }
    Write-Host "Source write guard: PASS"

    $logs=Invoke-ComposeCapture @("logs","--since","2m","app")
    $fatalHits=@($logs -split "`r?`n" | Where-Object { $_ -match '(?i)uncaught|unhandled rejection|prisma.*error|fatal error' })
    if ($fatalHits.Count -gt 0) { throw "Fatal-looking app log entries found after recreate.`n$($fatalHits -join "`n")" }
    Write-Host "Recent app fatal-log gate: PASS"

    $auditDir=Join-Path $Project "_PHASE01_AUDIT"
    New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
    $reportPath=Join-Path $auditDir "46-PHASE6-EMPLOYEE-RUNTIME-CUTOVER.md"
    $report=@"
# Phase 6A - Employee Runtime Cutover

Status: PASS

Purpose:
Rebuild and recreate the isolated local app from the already-cut-over source before any destructive Employee table migration.

Verification:
- Phase 6A reports 43, 44, 45: PASS.
- Runtime prisma.employee hits: $prismaEmployeeHits.
- Runtime Employee literal hits: $employeeLiteralHits.
- Employee table remained present and empty during this step.
- Employee inbound foreign keys remained zero.
- Old app image: $oldImageId
- Rollback image tag: $rollbackTag
- New app image: $newImageId
- New app Prisma migrate status: up to date.
- Login smoke: PASS (HTTP $httpCode).
- Recent fatal-log gate: PASS.
- Source write guard: PASS.
- Database write guard: PASS.
- No database migration was created or applied.
- Original live server untouched.

Next:
Prepare a separate forward Prisma migration that removes only the legacy Employee model/table while retaining StaffMember.legacyEmployeeId compatibility metadata. Do not use prisma db push and do not edit historical migrations.
"@
    [System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))
    $cutoverSucceeded=$true

    Write-Host ""
    Write-Host "========================================="
    Write-Host "PHASE 6A EMPLOYEE RUNTIME CUTOVER: PASS"
    Write-Host "========================================="
    Write-Host ""
    Write-Host "Report: $reportPath"
}
catch {
    Write-Host ""
    Write-Host "Runtime cutover failed. Attempting local app image rollback..."
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
    if ($cutoverSucceeded) {
        Write-Host "Local app runtime now uses the rebuilt current source."
    }
}
