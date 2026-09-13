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

Write-Host ""
Write-Host "=== PHASE 5C NOTIFICATION ROLE CONTEXT INSPECTION ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\32-PHASE5-NOTIFICATION-RECIPIENT-INVENTORY.md" "Phase 5C recipient inventory"
Write-Host "Phase 5C inventory prerequisite: PASS"

$candidates = @(
    "src\app\(app)\centers\actions.ts",
    "src\app\(app)\devices\actions.ts",
    "src\app\(app)\finance\expenses\actions.ts",
    "src\app\(app)\patients\actions.ts",
    "src\app\(app)\pharmacy\actions.ts",
    "src\app\(app)\tasks\actions.ts",
    "src\app\(app)\therapy\actions.ts",
    "src\app\(app)\visits\actions.ts",
    "src\app\api\reminders\due\route.ts",
    "src\lib\referral-service.ts"
)

$hashBefore = @{}
foreach ($relative in $candidates) {
    $full = Join-Path $Project $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Candidate file missing: $relative" }
    $hashBefore[$relative] = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
}

$rows = New-Object System.Collections.Generic.List[object]
$contextBlocks = New-Object System.Collections.Generic.List[string]

foreach ($relative in $candidates) {
    $full = Join-Path $Project $relative
    $lines = [System.IO.File]::ReadAllLines($full,[System.Text.Encoding]::UTF8)
    for ($i=0; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        $patterns = @()
        if ($line -match '\btargetRole\b') { $patterns += "TARGET_ROLE" }
        if ($line -match '\bnotifyRole(?:InTransaction)?\b') { $patterns += "NOTIFY_ROLE" }
        if ($patterns.Count -eq 0) { continue }

        $start = [Math]::Max(0,$i-6)
        $end = [Math]::Min($lines.Length-1,$i+8)
        $windowLines = for ($j=$start; $j -le $end; $j++) { $lines[$j] }
        $window = ($windowLines -join "`n")
        $hasPatient = [int]($window -match '(?i)patientId|patient\b|fileNumber')
        $hasReferral = [int]($window -match '(?i)referral|assignedReviewer|destinationUnit|destinationCenter')
        $hasWorkItem = [int]($window -match '(?i)workItem|PatientWorkItem|assignedUnitId|assignedUserId')
        $hasExplicitUser = [int]($window -match '(?i)targetUserId|notifyUser|assignedReviewerId|assignedToId')
        $hasExplicitUnit = [int]($window -match '(?i)notifyUnitInTransaction|destinationUnitId|assignedUnitId')

        foreach ($pattern in $patterns) {
            $rows.Add([pscustomobject]@{
                File=$relative.Replace('\','/')
                Line=$i+1
                Pattern=$pattern
                PatientContext=$hasPatient
                ReferralContext=$hasReferral
                WorkItemContext=$hasWorkItem
                ExplicitUserNearby=$hasExplicitUser
                ExplicitUnitNearby=$hasExplicitUnit
            }) | Out-Null
        }

        $header = "--- $($relative.Replace('\','/')):$($i+1) [$($patterns -join ',')] ---"
        $numbered = New-Object System.Collections.Generic.List[string]
        for ($j=$start; $j -le $end; $j++) {
            $mark = if ($j -eq $i) { ">" } else { " " }
            $numbered.Add(("{0}{1,5}: {2}" -f $mark,($j+1),$lines[$j])) | Out-Null
        }
        $contextBlocks.Add($header + "`n" + ($numbered -join "`n")) | Out-Null
    }
}

foreach ($relative in $candidates) {
    $full = Join-Path $Project $relative
    $after = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    if ($after -ne $hashBefore[$relative]) { throw "Read-only inspection changed source file: $relative" }
}
Write-Host "Source write guard: PASS"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath = Join-Path $auditDir "33-PHASE5-NOTIFICATION-ROLE-CONTEXT.md"
$csvPath = Join-Path $auditDir "33-PHASE5-NOTIFICATION-ROLE-CONTEXT.csv"
$rows | Sort-Object File,Line,Pattern | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$summary = @($rows | Group-Object File | ForEach-Object {
    $group=$_.Group
    [pscustomobject]@{
        File=$_.Name
        Hits=$group.Count
        Patient=($group | Measure-Object -Property PatientContext -Maximum).Maximum
        Referral=($group | Measure-Object -Property ReferralContext -Maximum).Maximum
        WorkItem=($group | Measure-Object -Property WorkItemContext -Maximum).Maximum
    }
} | Sort-Object File)

$summaryText = if ($summary.Count -gt 0) {
    ($summary | ForEach-Object { "- $($_.File) :: hits=$($_.Hits) :: patient=$($_.Patient) referral=$($_.Referral) workitem=$($_.WorkItem)" }) -join "`n"
} else { "- none" }
$contextText = if ($contextBlocks.Count -gt 0) { $contextBlocks -join "`n`n" } else { "No role-recipient occurrences found." }

$report = @"
# Phase 5C - Notification Role Context Inspection

Status: PASS

Purpose:
Read-only exact local-source context around every remaining targetRole / notifyRole occurrence in the patient/referral candidate files. This report is for manual classification before any notification recipient cutover.

Summary:
$summaryText

Exact contexts:

````text
$contextText
````

Safety:
- No database commands executed.
- No Prisma migration created or applied.
- No application source modified.
- SHA256 source write guard PASS.
- Original live server untouched.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host "Candidate role-recipient hits: $($rows.Count)"
Write-Host ""
foreach ($block in $contextBlocks) {
    Write-Host $block
    Write-Host ""
}
Write-Host "==============================================="
Write-Host "PHASE 5C NOTIFICATION ROLE CONTEXT: PASS"
Write-Host "==============================================="
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
