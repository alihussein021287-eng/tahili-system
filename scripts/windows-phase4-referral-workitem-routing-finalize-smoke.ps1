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

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Invoke-Docker ($Compose + $Arguments)
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
    return $path
}

Write-Host ""
Write-Host "=== PHASE 4 REFERRAL WORKITEM ROUTING - FINAL SMOKE RECOVERY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\18-PHASE4-REFERRAL-ROUTING-INVENTORY.md" "Phase 4 routing inventory" | Out-Null
Write-Host "Prerequisite inventory: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(
    ".env.saif-dev",
    "docker-compose.saif-dev.yml",
    "src\lib\referral-service.ts",
    "src\lib\referral-workitem-routing.ts",
    "tests\unit\referral-workitem-routing.test.ts"
)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required cutover file missing: $file" }
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

$service=[System.IO.File]::ReadAllText((Join-Path $Project "src\lib\referral-service.ts"),[System.Text.Encoding]::UTF8)
foreach ($needle in @(
    'resolveInternalReferralWorkItemRoute',
    'REFERRAL_WORKITEM_ACTOR_GUID_REQUIRED',
    'patientWorkItem.create',
    'assignedReviewerGuid',
    'legacyCareStageId: careStageId',
    'workItemId,'
)) {
    if (-not $service.Contains($needle)) { throw "Local referral routing cutover is incomplete: $needle" }
}
Write-Host "Local source cutover assertions: PASS"

$acceptedInternalSql=@'
SELECT count(*) FROM "referral_requests"
WHERE "destinationScope"::text IN ('INTERNAL_SPECIALIST','INTERNAL_CENTER')
  AND "status"::text='ACCEPTED';
'@
$acceptedInternal=[int64](Invoke-PsqlText $acceptedInternalSql)
if ($acceptedInternal -ne 0) { throw "Accepted internal referrals appeared after inventory ($acceptedInternal). Re-run inventory/backfill before finalizing." }
Write-Host "Database cutover invariant: PASS"

Write-Host ""
Write-Host "=== MIGRATION STATUS RECHECK ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

Write-Host ""
Write-Host "=== RUNNING APP LOGIN SMOKE ==="
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw "curl.exe is required for the strict-mode-safe login smoke." }
$httpCode = (& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Running app login smoke failed: curl exit code $LASTEXITCODE ($httpCode)" }
if ($httpCode -notmatch '^\d{3}$') { throw "Running app login smoke returned an invalid HTTP code: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$rollbackRoot=Join-Path $Project ".secrets\phase4-referral-workitem-routing"
$rollbackDir="(not found)"
if (Test-Path -LiteralPath $rollbackRoot -PathType Container) {
    $latest=Get-ChildItem -LiteralPath $rollbackRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if ($latest) { $rollbackDir=$latest.FullName }
}

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "19-PHASE4-REFERRAL-WORKITEM-ROUTING.md"
$report=@"
# Phase 4 - Referral to PatientWorkItem Routing Cutover

Status: PASS

Recovery note:
- The main routing cutover completed source patching, checks, tests, build, and migration status, then stopped only in the final PowerShell login-smoke catch because StrictMode accessed a missing Exception.Response property.
- This recovery did not reapply the cutover. It verified the local cutover source markers, the accepted-internal-referral database invariant, Prisma migration status, and the running app login endpoint using curl.exe.

Implemented:
- INTERNAL_SPECIALIST routes to the actual assigned reviewer UUID.
- INTERNAL_CENTER routes to the exact matching active Unit UUID.
- Role-only ownership is not used for PatientWorkItem routing.
- Legacy CareStage remains temporarily for compatibility.
- Referral audit data carries workItemId after accepted internal routing.

Accepted internal referrals at finalization: $acceptedInternal
Running app login smoke HTTP: $code

Safety:
- No database row was modified by this recovery finalizer.
- No app container restart.
- Original live server remains untouched.

Rollback snapshot:
$rollbackDir
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 4 REFERRAL WORKITEM ROUTING: PASS"
Write-Host "======================================"
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "Rollback snapshot: $rollbackDir"
