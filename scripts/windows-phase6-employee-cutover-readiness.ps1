$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Read-Utf8([string]$RelativePath) {
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file missing: $path" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
}

function Test-PassReport([string]$RelativePath,[string]$Label) {
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Get-SourceHash {
    param([string[]]$Paths)
    $rows = @()
    foreach ($relative in $Paths) {
        $full = Join-Path $Project $relative
        if (Test-Path -LiteralPath $full -PathType Leaf) {
            $rows += [pscustomobject]@{ Path=$relative; Hash=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash }
        }
    }
    return @($rows)
}

function Get-Matches {
    param([string]$Pattern,[string[]]$Paths)
    $rows = @()
    foreach ($relative in $Paths) {
        $full = Join-Path $Project $relative
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
        $lineNo = 0
        foreach ($line in Get-Content -LiteralPath $full -Encoding UTF8) {
            $lineNo++
            if ($line -match $Pattern) {
                $rows += [pscustomobject]@{ File=$relative; Line=$lineNo; Text=$line.Trim() }
            }
        }
    }
    return @($rows)
}

Write-Host ""
Write-Host "=== PHASE 6A EMPLOYEE CUTOVER READINESS ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\39-PHASE6-EMPLOYEE-DEPENDENCY-INVENTORY.md" "Phase 6A Employee dependency inventory"
Write-Host "Phase 6A Employee dependency prerequisite: PASS"

$paths = @(
    "src\app\(app)\maintenance\page.tsx",
    "src\app\(app)\maintenance\cats.ts",
    "src\app\(app)\maintenance\actions.ts",
    "src\app\(app)\staff\page.tsx",
    "src\lib\lookups.ts",
    "src\app\(app)\patients\page.tsx",
    "src\app\(app)\patients\new\page.tsx",
    "src\app\(app)\patients\[id]\edit\page.tsx"
)
$before = Get-SourceHash $paths

$definitions = [ordered]@{
    PRISMA_EMPLOYEE='prisma\.employee\.'
    PRISMA_STAFF_MEMBER='prisma\.staffMember\.'
    EMPLOYEE_ROSTER='employeeRoster'
    EMPLOYEE_NAMES='employeeNames'
    GET_EMPLOYEES='\bgetEmployees\b'
    LOOKUPS_EMPLOYEES='lookups\.employees|\bemployees\s*[=:]'
    MAINTENANCE_EMPLOYEE='"Employee"|prisma\.employee\.count'
    STAFF_MEMBER_ID='staffMemberId'
}

$allRows = @()
$summary = @()
foreach ($entry in $definitions.GetEnumerator()) {
    $rows = @(Get-Matches -Pattern $entry.Value -Paths $paths)
    foreach ($row in $rows) {
        $allRows += [pscustomobject]@{ Pattern=$entry.Key; File=$row.File; Line=$row.Line; Text=$row.Text }
    }
    $summary += [pscustomobject]@{ Pattern=$entry.Key; Files=@($rows.File | Sort-Object -Unique).Count; Hits=$rows.Count }
}

foreach ($row in $summary) {
    Write-Host ("{0}|files={1}|hits={2}" -f $row.Pattern,$row.Files,$row.Hits)
}

$patientConsumers = @(Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx | Select-String -Pattern '\bemployees\b|\bgetEmployees\b' -Encoding UTF8)
$patientConsumerRows = @()
foreach ($m in $patientConsumers) {
    $relative = $m.Path.Substring($Project.Length).TrimStart('\')
    if ($relative -match '^src\\app\\\(app\)\\patients|^src\\components|^src\\lib\\lookups\.ts$') {
        $patientConsumerRows += [pscustomobject]@{ File=$relative; Line=$m.LineNumber; Text=$m.Line.Trim() }
    }
}

$employeePrismaRows = @($allRows | Where-Object Pattern -eq 'PRISMA_EMPLOYEE')
if ($employeePrismaRows.Count -ne 4) {
    throw "Expected exactly 4 current prisma.employee hits from report 39, found $($employeePrismaRows.Count). Stop for review."
}

$after = Get-SourceHash $paths
if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) {
    throw "Source write guard failed during readiness inventory."
}
Write-Host "Source write guard: PASS"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath = Join-Path $auditDir "40-PHASE6-EMPLOYEE-CUTOVER-READINESS-SOURCE.csv"
$reportPath = Join-Path $auditDir "40-PHASE6-EMPLOYEE-CUTOVER-READINESS.md"
$allRows | Sort-Object Pattern,File,Line | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$report = New-Object System.Collections.Generic.List[string]
$report.Add('# Phase 6A - Employee Cutover Readiness')
$report.Add('')
$report.Add('Status: PASS')
$report.Add('')
$report.Add('Purpose:')
$report.Add('Read-only source gate immediately before replacing the final operational Prisma Employee reads with StaffMember-backed data. It does not modify application source or authorize dropping the Employee table/model yet.')
$report.Add('')
$report.Add('Pattern summary:')
foreach ($row in $summary) { $report.Add("- $($row.Pattern): files=$($row.Files), hits=$($row.Hits)") }
$report.Add('')
$report.Add('Current prisma.employee reads:')
foreach ($row in $employeePrismaRows) { $report.Add("- $($row.File):$($row.Line) :: $($row.Text)") }
$report.Add('')
$report.Add('Patient/UI employee consumers:')
if ($patientConsumerRows.Count -eq 0) { $report.Add('- none') }
else { foreach ($row in $patientConsumerRows) { $report.Add("- $($row.File):$($row.Line) :: $($row.Text)") } }
$report.Add('')
$report.Add('Cutover boundary:')
$report.Add('- Replace only active operational Employee reads; never edit historical Prisma migrations.')
$report.Add('- Staff lists must come from StaffMember UUID identity. Human names may remain display/snapshot values but are not ownership keys.')
$report.Add('- Maintenance category/table references must be reviewed before Employee table removal so a later raw cleanup action cannot reference a dropped table.')
$report.Add('- Patient employee-selection data must preserve current UI behavior while changing the backing source to StaffMember; do not infer a StaffMember by name at write time.')
$report.Add('- Keep legacyEmployeeId for rollback/audit compatibility until a later explicit cleanup gate.')
$report.Add('- No CareStage, StageStatus, Role routing, PATHWAY_DEFAULT, or Collaboration changes in this batch.')
$report.Add('')
$report.Add('Safety:')
$report.Add('- Read-only source inspection only.')
$report.Add('- No database writes or migrations.')
$report.Add('- No application source modified.')
$report.Add('- Source SHA256 write guard PASS.')
$report.Add('- Original live server untouched.')
[System.IO.File]::WriteAllLines($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "============================================="
Write-Host "PHASE 6A EMPLOYEE CUTOVER READINESS: PASS"
Write-Host "============================================="
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
