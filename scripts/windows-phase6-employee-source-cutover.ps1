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
}
function Read-Utf8([string]$RelativePath) {
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file missing: $path" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
}
function Write-Utf8NoBom([string]$RelativePath,[string]$Text) {
    $path = Join-Path $Project $RelativePath
    [System.IO.File]::WriteAllText($path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}
function Replace-Exact {
    param([string]$Text,[string]$Old,[string]$New,[int]$ExpectedCount,[string]$Label)
    $count = 0
    $idx = 0
    while (($idx = $Text.IndexOf($Old,$idx,[System.StringComparison]::Ordinal)) -ge 0) {
        $count++
        $idx += $Old.Length
    }
    if ($count -ne $ExpectedCount) { throw "$Label expected $ExpectedCount anchor(s), found $count. Stop for review." }
    return $Text.Replace($Old,$New)
}
function Get-SourceGuard {
    param([string[]]$ExcludedRelativePaths)
    $exclude = @{}
    foreach ($p in $ExcludedRelativePaths) { $exclude[$p.Replace('/','\').ToLowerInvariant()] = $true }
    $rows = New-Object System.Collections.Generic.List[string]
    Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel = $_.FullName.Substring($Project.Length + 1).Replace('/','\')
        if (-not $exclude.ContainsKey($rel.ToLowerInvariant())) {
            $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
            $rows.Add("$rel|$h")
        }
    }
    return ($rows -join "`n")
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE SOURCE CUTOVER ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\39-PHASE6-EMPLOYEE-DEPENDENCY-INVENTORY.md" "Phase 6A Employee dependency inventory"
Test-PassReport "_PHASE01_AUDIT\40-PHASE6-EMPLOYEE-CUTOVER-READINESS.md" "Phase 6A Employee cutover readiness"
Write-Host "Phase 6A prerequisites: PASS"

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

$preSql=@'
SELECT 'employee_total|' || count(*) FROM "Employee"
UNION ALL SELECT 'staff_members_total|' || count(*) FROM "staff_members"
UNION ALL SELECT 'staff_members_active|' || count(*) FROM "staff_members" WHERE "active"=true
UNION ALL SELECT 'attendance_total|' || count(*) FROM "Attendance"
UNION ALL SELECT 'shift_total|' || count(*) FROM "Shift"
UNION ALL SELECT 'leave_total|' || count(*) FROM "Leave"
UNION ALL SELECT 'patients_total|' || count(*) FROM "patients"
ORDER BY 1;
'@
$countsBefore = Invoke-PsqlText $preSql
Write-Host $countsBefore
if (@($countsBefore -split "`r?`n" | Where-Object { $_ -eq 'employee_total|0' }).Count -ne 1) { throw "Employee table is no longer empty. Stop before source cutover." }

$targets = @(
    "src\lib\lookups.ts",
    "src\app\(app)\staff\page.tsx",
    "src\app\(app)\maintenance\page.tsx"
)
$guardBefore = Get-SourceGuard $targets

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase6-employee-source-cutover" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
foreach ($relative in $targets) {
    $src=Join-Path $Project $relative
    $dst=Join-Path $rollbackDir (($relative -replace '[\\/:*?"<>|]','_') + ".before")
    Copy-Item -LiteralPath $src -Destination $dst -Force
}
$countsBefore | Set-Content -LiteralPath (Join-Path $rollbackDir "db-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

# 1) Lookups: preserve the legacy {id,name} presentation contract, but source it from active StaffMember UUID rows.
$lookups = Read-Utf8 "src\lib\lookups.ts"
$oldLookup='prisma.employee.findMany({ orderBy: { name: "asc" } })'
$newLookup='prisma.staffMember.findMany({ where: { active: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }).then((rows) => rows.map((row) => ({ id: row.id, name: row.fullName })))'
$lookups = Replace-Exact $lookups $oldLookup $newLookup 2 "lookups Employee -> StaffMember"
Write-Utf8NoBom "src\lib\lookups.ts" $lookups

# 2) Staff page roster: preserve downstream name-based display only; operational identity remains StaffMember UUID.
$staff = Read-Utf8 "src\app\(app)\staff\page.tsx"
$oldRoster='canAttendance || canShifts ? prisma.employee.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),'
$newRoster='canAttendance || canShifts ? prisma.staffMember.findMany({ where: { active: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }).then((rows) => rows.map((row) => ({ id: row.id, name: row.fullName }))) : Promise.resolve([]),'
$staff = Replace-Exact $staff $oldRoster $newRoster 1 "staff roster Employee -> StaffMember"
Write-Utf8NoBom "src\app\(app)\staff\page.tsx" $staff

# 3) Maintenance dashboard count: count active StaffMember rows instead of the retired Employee roster.
$maintenance = Read-Utf8 "src\app\(app)\maintenance\page.tsx"
$oldCount='prisma.employee.count(),         // 13'
$newCount='prisma.staffMember.count({ where: { active: true } }), // 13'
$maintenance = Replace-Exact $maintenance $oldCount $newCount 1 "maintenance Employee -> StaffMember count"
Write-Utf8NoBom "src\app\(app)\maintenance\page.tsx" $maintenance

# Source assertions.
$srcFiles = Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
$employeeRefs = @()
foreach ($file in $srcFiles) {
    $text=[System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    if ($text -match 'prisma\.employee\b') {
        $employeeRefs += $file.FullName.Substring($Project.Length + 1)
    }
}
if ($employeeRefs.Count -gt 0) { throw "Operational prisma.employee references remain: $($employeeRefs -join ', ')" }
foreach ($assertion in @(
    @{ P="src\lib\lookups.ts"; N='prisma.staffMember.findMany({ where: { active: true }' },
    @{ P="src\app\(app)\staff\page.tsx"; N='prisma.staffMember.findMany({ where: { active: true }' },
    @{ P="src\app\(app)\maintenance\page.tsx"; N='prisma.staffMember.count({ where: { active: true } })' }
)) {
    $txt=Read-Utf8 $assertion.P
    if (-not $txt.Contains($assertion.N)) { throw "Post-cutover assertion missing in $($assertion.P): $($assertion.N)" }
}
$guardAfter = Get-SourceGuard $targets
if ($guardAfter -ne $guardBefore) { throw "Unexpected source file changed outside the three approved Employee cutover files." }
Write-Host "Source cutover guard: PASS"

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")

Write-Host ""
Write-Host "=== PRISMA VALIDATE + GENERATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","generate")

Write-Host ""
Write-Host "=== TYPESCRIPT + TESTS + AUDIT + BUILD ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")

Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

$countsAfter = Invoke-PsqlText $preSql
if ($countsAfter.Trim() -ne $countsBefore.Trim()) {
    throw "Database row counts changed during Employee source cutover.`nBefore:`n$countsBefore`nAfter:`n$countsAfter"
}
Write-Host "Database write guard: PASS"

Write-Host ""
Write-Host "=== RUNNING APP LOGIN SMOKE ==="
$curl=Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw "curl.exe is required for login smoke." }
$httpCode=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $httpCode -notmatch '^\d{3}$') { throw "Running app login smoke failed: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "41-PHASE6-EMPLOYEE-SOURCE-CUTOVER.md"
$report=@"
# Phase 6A - Employee Source Cutover

Status: PASS

Cutover completed:
- src/lib/lookups.ts now sources employee-style lookup rows from active StaffMember UUID records while preserving the temporary {id,name} presentation shape.
- src/app/(app)/staff/page.tsx now builds its attendance/shift roster from active StaffMember records.
- src/app/(app)/maintenance/page.tsx now counts active StaffMember records instead of Employee rows.
- No operational prisma.employee references remain under src/.

Safety and verification:
- Legacy Employee table was verified empty before cutover.
- No database migration was created or applied in this batch.
- Employee table/model were NOT dropped yet.
- CareStage, StageStatus, PATHWAY_DEFAULT, Role routing, and Collaboration were not changed.
- Prisma validate/generate, TypeScript, full tests, project audit, build, migration status, and login smoke passed.
- Database row-count guard passed.
- Source guard confirmed only the three approved files changed in this batch.
- Rollback snapshot: $rollbackDir
- Original live server remained untouched.

Database counts:
$countsAfter

Next:
Run a post-cutover dependency gate. Only after zero operational Employee dependencies are proven should a separate forward migration remove the Prisma Employee model/table, with maintenance cleanup and rollback/restore readiness.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "========================================="
Write-Host "PHASE 6A EMPLOYEE SOURCE CUTOVER: PASS"
Write-Host "========================================="
Write-Host ""
Write-Host "Report: $reportPath"
