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
    [System.IO.File]::WriteAllText((Join-Path $Project $RelativePath),$Text,(New-Object System.Text.UTF8Encoding($false)))
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
            $rows.Add("$rel|$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)")
        }
    }
    return ($rows -join "`n")
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE MAINTENANCE CUTOVER ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\42-PHASE6-EMPLOYEE-POST-CUTOVER-GATE.md" "Phase 6A Employee post-cutover gate"
Write-Host "Phase 6A post-cutover prerequisite: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$targets = @(
    "src\app\(app)\maintenance\cats.ts",
    "src\app\(app)\maintenance\page.tsx"
)
$guardBefore = Get-SourceGuard $targets

$cats = Read-Utf8 "src\app\(app)\maintenance\cats.ts"
$page = Read-Utf8 "src\app\(app)\maintenance\page.tsx"

$oldCat='  attendance: { label: "الحضور والموظفون", tables: [''"public"."Attendance"'', ''"public"."Employee"''] },'
$newCat='  attendance: { label: "الحضور", tables: [''"public"."Attendance"''], note: "يمسح سجلات الحضور فقط؛ ملفات الموظفين تبقى محفوظة." },'
$oldCard='    { key: "attendance", count: c[12] + c[13] },'
$newCard='    { key: "attendance", count: c[12] },'

if (-not $page.Contains('prisma.staffMember.count({ where: { active: true } }), // 13')) {
    throw "Expected StaffMember compatibility count from source cutover is missing. Stop for review."
}

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase6-employee-maintenance-cutover" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
foreach ($relative in $targets) {
    $src=Join-Path $Project $relative
    $dst=Join-Path $rollbackDir (($relative -replace '[\\/:*?"<>|]','_') + ".before")
    Copy-Item -LiteralPath $src -Destination $dst -Force
}
Write-Host "Rollback snapshot: $rollbackDir"

$cats = Replace-Exact $cats $oldCat $newCat 1 "maintenance attendance category"
$page = Replace-Exact $page $oldCard $newCard 1 "maintenance attendance count"
Write-Utf8NoBom "src\app\(app)\maintenance\cats.ts" $cats
Write-Utf8NoBom "src\app\(app)\maintenance\page.tsx" $page

$srcFiles = Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
$prismaEmployeeHits = 0
$employeeTableLiteralHits = 0
foreach ($file in $srcFiles) {
    $text=[System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    $prismaEmployeeHits += [regex]::Matches($text,'prisma\.employee\b').Count
    $employeeTableLiteralHits += [regex]::Matches($text,'["'']Employee["'']').Count
}
if ($prismaEmployeeHits -ne 0) { throw "Operational prisma.employee references remain after maintenance cutover: $prismaEmployeeHits" }
if ($employeeTableLiteralHits -ne 0) { throw "Runtime Employee table literal remains after maintenance cutover: $employeeTableLiteralHits" }

$catsAfter = Read-Utf8 "src\app\(app)\maintenance\cats.ts"
$pageAfter = Read-Utf8 "src\app\(app)\maintenance\page.tsx"
if (-not $catsAfter.Contains($newCat)) { throw "Attendance maintenance category assertion failed." }
if (-not $pageAfter.Contains($newCard)) { throw "Attendance maintenance count assertion failed." }
if ($pageAfter.Contains('count: c[12] + c[13]')) { throw "Maintenance still mixes StaffMember count into attendance delete confirmation." }

$guardAfter = Get-SourceGuard $targets
if ($guardAfter -ne $guardBefore) { throw "Unexpected source file changed outside the two approved maintenance cutover files." }
Write-Host "Source cutover guard: PASS"

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")

Write-Host ""
Write-Host "=== VALIDATE + TYPESCRIPT + TESTS + BUILD ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

Write-Host ""
Write-Host "=== RUNNING APP LOGIN SMOKE ==="
$httpCode=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $httpCode -notmatch '^\d{3}$') { throw "Running app login smoke failed: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "43-PHASE6-EMPLOYEE-MAINTENANCE-CUTOVER.md"
$report=@"
# Phase 6A - Employee Maintenance Cutover

Status: PASS

Changes:
- Maintenance attendance category now truncates Attendance only.
- Employee table literal was removed from runtime maintenance code.
- Attendance delete confirmation count now uses Attendance rows only and no longer includes StaffMember rows.
- StaffMember remains staff identity and is not treated as part of the attendance wipe category.

Verification:
- prisma.employee runtime hits: $prismaEmployeeHits
- Employee table literal runtime hits: $employeeTableLiteralHits
- Prisma validate PASS.
- TypeScript PASS.
- Tests PASS.
- Build PASS.
- Migration status checked.
- Login smoke PASS (HTTP $code).
- Source guard PASS.
- No database migration was created or applied.
- Rollback snapshot: $rollbackDir
- Original live server untouched.

Next:
Run an Employee destructive-drop readiness gate. The Employee Prisma model/table must still be removed only by a separate forward migration after backup/restore readiness and final dependency proof.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "============================================="
Write-Host "PHASE 6A EMPLOYEE MAINTENANCE CUTOVER: PASS"
Write-Host "============================================="
Write-Host ""
Write-Host "Report: $reportPath"
