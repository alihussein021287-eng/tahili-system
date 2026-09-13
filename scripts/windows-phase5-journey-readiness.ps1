$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Require-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Read-Utf8 {
    param([string]$RelativePath)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required source missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
}

function Count-Matches {
    param([string]$Text,[string]$Pattern)
    return ([regex]::Matches($Text,$Pattern,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count
}

Write-Host ""
Write-Host "=== PHASE 5B JOURNEY PRESENTATION READINESS ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\29-PHASE5-MY-WORK-PATIENTWORKITEM-CUTOVER.md" "Phase 5A My Work cutover"
Write-Host "Phase 5A prerequisite: PASS"

$keyFiles = @(
    "src\lib\patient-journey.ts",
    "src\app\(app)\patients\[id]\page.tsx",
    "src\app\(app)\patients\[id]\journey-print\page.tsx",
    "src\app\portal\[token]\page.tsx",
    "src\app\(app)\patients-care\page.tsx",
    "prisma\schema.prisma"
)

$hashBefore = @{}
foreach ($relative in $keyFiles) {
    $full = Join-Path $Project $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Required file missing: $relative" }
    $hashBefore[$relative] = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
}

$journeyLib = Read-Utf8 "src\lib\patient-journey.ts"
$patientPage = Read-Utf8 "src\app\(app)\patients\[id]\page.tsx"
$journeyPrint = Read-Utf8 "src\app\(app)\patients\[id]\journey-print\page.tsx"
$portalPage = Read-Utf8 "src\app\portal\[token]\page.tsx"
$patientsCare = Read-Utf8 "src\app\(app)\patients-care\page.tsx"
$schema = Read-Utf8 "prisma\schema.prisma"

$checks = [ordered]@{
    journey_lib_has_carestage = [int]($journeyLib -match '(?i)careStage|CareStage')
    journey_lib_has_current_carestage = [int]($journeyLib -match 'currentCareStage')
    journey_lib_has_patient_workitem = [int]($journeyLib -match '(?i)patientWorkItem|PatientWorkItem')
    journey_lib_has_legacy_link = [int]($journeyLib -match 'legacyCareStageId')
    patient_page_uses_journey_lib = [int]($patientPage -match '@/lib/patient-journey')
    patient_page_has_current_carestage = [int]($patientPage -match 'currentCareStage')
    patient_page_has_patient_workitem = [int]($patientPage -match '(?i)patientWorkItem|PatientWorkItem')
    journey_print_uses_journey_lib = [int]($journeyPrint -match '@/lib/patient-journey')
    journey_print_has_carestage = [int]($journeyPrint -match '(?i)careStage|CareStage')
    journey_print_has_patient_workitem = [int]($journeyPrint -match '(?i)patientWorkItem|PatientWorkItem')
    portal_has_carestage = [int]($portalPage -match '(?i)careStage|CareStage')
    portal_has_patient_workitem = [int]($portalPage -match '(?i)patientWorkItem|PatientWorkItem')
    patients_care_has_carestage = [int]($patientsCare -match '(?i)careStage|CareStage')
    patients_care_has_patient_workitem = [int]($patientsCare -match '(?i)patientWorkItem|PatientWorkItem')
    schema_has_patient_workitem = [int]($schema -match '(?m)^model\s+PatientWorkItem\s*\{')
    schema_has_legacy_carestage_link = [int]($schema -match 'legacyCareStageId')
}

foreach ($entry in $checks.GetEnumerator()) {
    Write-Host "$($entry.Key)|$($entry.Value)"
}

$patterns = [ordered]@{
    CARE_STAGE = '\bcareStage(s)?\b|\bCareStage\b'
    CURRENT_CARE_STAGE = 'currentCareStage'
    PATIENT_WORK_ITEM = '\bpatientWorkItem(s)?\b|\bPatientWorkItem\b'
    LEGACY_CARE_STAGE_LINK = 'legacyCareStageId'
    RESPONSIBLE_ROLE = 'responsibleRole'
    JOURNEY_LIB = '@/lib/patient-journey'
    WORKITEM_SCOPE = 'patient-work-item-scope|canViewWorkItemScope'
}

$rows = New-Object System.Collections.Generic.List[object]
foreach ($rootRelative in @("src\app","src\lib")) {
    $root = Join-Path $Project $rootRelative
    foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction Stop) {
        if ($file.Extension -notin @('.ts','.tsx')) { continue }
        $text = [System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
        $relative = $file.FullName.Substring($Project.Length + 1).Replace('\','/')
        foreach ($entry in $patterns.GetEnumerator()) {
            $count = Count-Matches $text $entry.Value
            if ($count -gt 0) {
                $rows.Add([pscustomobject]@{ File=$relative; Pattern=$entry.Key; Count=$count }) | Out-Null
            }
        }
    }
}

$priority = @($rows | Group-Object File | ForEach-Object {
    [pscustomobject]@{
        File = $_.Name
        Hits = ($_.Group | Measure-Object -Property Count -Sum).Sum
        Patterns = (($_.Group | Sort-Object Pattern | ForEach-Object { $_.Pattern }) -join ',')
    }
} | Sort-Object -Property @{Expression='Hits';Descending=$true}, @{Expression='File';Descending=$false})

$exports = @([regex]::Matches($journeyLib,'(?m)^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)

foreach ($relative in $keyFiles) {
    $full = Join-Path $Project $relative
    $after = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    if ($after -ne $hashBefore[$relative]) { throw "Read-only journey readiness changed source file: $relative" }
}
Write-Host "Source write guard: PASS"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath = Join-Path $auditDir "30-PHASE5-JOURNEY-PRESENTATION-READINESS.md"
$csvPath = Join-Path $auditDir "30-PHASE5-JOURNEY-PRESENTATION-SOURCE-USAGE.csv"
$rows | Sort-Object File,Pattern | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$checkText = ($checks.GetEnumerator() | ForEach-Object { "- $($_.Key): $($_.Value)" }) -join "`n"
$exportText = if ($exports.Count -gt 0) { ($exports | ForEach-Object { "- $_" }) -join "`n" } else { "- none" }
$priorityText = if ($priority.Count -gt 0) { ($priority | Select-Object -First 30 | ForEach-Object { "- $($_.File) :: $($_.Patterns) :: hits=$($_.Hits)" }) -join "`n" } else { "- none" }

$report = @"
# Phase 5B - Journey Presentation Readiness

Status: PASS

Purpose:
Read-only local-source inventory before changing patient journey presentation to show operational PatientWorkItem data while retaining legacy CareStage history compatibility.

Key checks:
$checkText

patient-journey exports:
$exportText

Highest journey-related source usage:
$priorityText

Safety:
- No database commands executed.
- No Prisma migration created or applied.
- No application source modified.
- SHA256 source write guard PASS.
- Original live server untouched.

Recommended Phase 5B boundary:
- Keep CareStage as historical/compatibility data for now.
- Add PatientWorkItem as the operational parallel-work source in patient journey presentation.
- Do not infer ownership from responsibleRole.
- Do not change Notification behavior in this batch.
- Preserve current Arabic RTL presentation and patient deep links.
- Any mutation action remains server-authorized by PatientWorkItem service/scope policy; journey visibility alone is not authorization.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "============================================"
Write-Host "PHASE 5B JOURNEY PRESENTATION READINESS: PASS"
Write-Host "============================================"
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
