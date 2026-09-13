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

function Count-Matches {
    param([string]$Text,[string]$Pattern)
    return ([regex]::Matches($Text,$Pattern,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count
}

Write-Host ""
Write-Host "=== PHASE 5C NOTIFICATION RECIPIENT INVENTORY ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\31-PHASE5-JOURNEY-PARALLEL-WORKITEM-CUTOVER.md" "Phase 5B journey cutover"
Write-Host "Phase 5B prerequisite: PASS"

$roots = @("src\app","src\lib")
$files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
foreach ($rootRelative in $roots) {
    $root = Join-Path $Project $rootRelative
    foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction Stop) {
        if ($file.Extension -in @('.ts','.tsx')) { $files.Add($file) | Out-Null }
    }
}

$hashBefore = @{}
foreach ($file in $files) { $hashBefore[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }

$patterns = [ordered]@{
    TARGET_ROLE = '\btargetRole\b'
    TARGET_USER = '\btargetUserId\b'
    NOTIFY_ROLE = '\bnotifyRole(?:InTransaction)?\b'
    NOTIFY_USER = '\bnotifyUser(?:InTransaction)?\b'
    NOTIFY_UNIT = '\bnotifyUnitInTransaction\b'
    PATIENT_CONTEXT = '\bpatientId\b|\bpatientGuid\b|\bpatient\b'
    REFERRAL_CONTEXT = '\breferralRequestId\b|\breferral\b'
    WORKITEM_CONTEXT = '\bPatientWorkItem\b|\bpatientWorkItem\b|\bworkItemId\b'
}

$summaryRows = New-Object System.Collections.Generic.List[object]
$detailRows = New-Object System.Collections.Generic.List[object]

foreach ($file in $files) {
    $text = [System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    $relative = $file.FullName.Substring($Project.Length + 1).Replace('\','/')
    $lineArray = $text.Replace("`r`n","`n").Replace("`r","`n").Split("`n")
    $fileHasPatient = [regex]::IsMatch($text,$patterns.PATIENT_CONTEXT,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $fileHasReferral = [regex]::IsMatch($text,$patterns.REFERRAL_CONTEXT,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $fileHasWorkItem = [regex]::IsMatch($text,$patterns.WORKITEM_CONTEXT,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

    foreach ($entry in $patterns.GetEnumerator()) {
        if ($entry.Key -in @('PATIENT_CONTEXT','REFERRAL_CONTEXT','WORKITEM_CONTEXT')) { continue }
        $count = Count-Matches $text $entry.Value
        if ($count -gt 0) {
            $summaryRows.Add([pscustomobject]@{
                File = $relative
                Pattern = $entry.Key
                Count = $count
                PatientContext = [int]$fileHasPatient
                ReferralContext = [int]$fileHasReferral
                WorkItemContext = [int]$fileHasWorkItem
            }) | Out-Null
        }
    }

    for ($i=0; $i -lt $lineArray.Length; $i++) {
        $line = $lineArray[$i]
        foreach ($entry in $patterns.GetEnumerator()) {
            if ($entry.Key -in @('PATIENT_CONTEXT','REFERRAL_CONTEXT','WORKITEM_CONTEXT')) { continue }
            if ($line -match $entry.Value) {
                $start = [Math]::Max(0,$i-2)
                $end = [Math]::Min($lineArray.Length-1,$i+2)
                $snippet = (($lineArray[$start..$end] -join ' ') -replace '\s+',' ').Trim()
                $detailRows.Add([pscustomobject]@{
                    File = $relative
                    Line = $i + 1
                    Pattern = $entry.Key
                    PatientContext = [int]$fileHasPatient
                    ReferralContext = [int]$fileHasReferral
                    WorkItemContext = [int]$fileHasWorkItem
                    Snippet = $snippet
                }) | Out-Null
            }
        }
    }
}

foreach ($file in $files) {
    $after = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if ($after -ne $hashBefore[$file.FullName]) { throw "Read-only notification inventory changed source file: $($file.FullName)" }
}
Write-Host "Source write guard: PASS"

$totals = [ordered]@{}
foreach ($name in @('TARGET_ROLE','TARGET_USER','NOTIFY_ROLE','NOTIFY_USER','NOTIFY_UNIT')) {
    $value = ($summaryRows | Where-Object Pattern -eq $name | Measure-Object -Property Count -Sum).Sum
    if ($null -eq $value) { $value = 0 }
    $totals[$name] = [int]$value
    Write-Host "$name|$value"
}

$patientSpecificRoleCandidates = @($summaryRows | Where-Object { $_.Pattern -in @('TARGET_ROLE','NOTIFY_ROLE') -and ($_.PatientContext -eq 1 -or $_.ReferralContext -eq 1 -or $_.WorkItemContext -eq 1) } | Sort-Object File,Pattern)
Write-Host "ROLE_RECIPIENT_PATIENT_CONTEXT_FILES|$($patientSpecificRoleCandidates.Count)"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath = Join-Path $auditDir "32-PHASE5-NOTIFICATION-RECIPIENT-INVENTORY.md"
$summaryCsv = Join-Path $auditDir "32-PHASE5-NOTIFICATION-RECIPIENT-SUMMARY.csv"
$detailCsv = Join-Path $auditDir "32-PHASE5-NOTIFICATION-RECIPIENT-DETAIL.csv"
$summaryRows | Sort-Object File,Pattern | Export-Csv -LiteralPath $summaryCsv -NoTypeInformation -Encoding UTF8
$detailRows | Sort-Object File,Line,Pattern | Export-Csv -LiteralPath $detailCsv -NoTypeInformation -Encoding UTF8

$top = @($summaryRows | Group-Object File | ForEach-Object {
    $sum = ($_.Group | Measure-Object -Property Count -Sum).Sum
    if ($null -eq $sum) { $sum = 0 }
    [pscustomobject]@{
        File = $_.Name
        Hits = [int]$sum
        Patterns = (($_.Group | Sort-Object Pattern | ForEach-Object Pattern) -join ',')
        PatientContext = [int](($_.Group | Measure-Object PatientContext -Maximum).Maximum)
        ReferralContext = [int](($_.Group | Measure-Object ReferralContext -Maximum).Maximum)
        WorkItemContext = [int](($_.Group | Measure-Object WorkItemContext -Maximum).Maximum)
    }
} | Sort-Object -Property @{Expression='Hits';Descending=$true}, @{Expression='File';Descending=$false})

$topText = if ($top.Count -gt 0) { ($top | Select-Object -First 40 | ForEach-Object { "- $($_.File) :: $($_.Patterns) :: hits=$($_.Hits) :: patient=$($_.PatientContext) referral=$($_.ReferralContext) workitem=$($_.WorkItemContext)" }) -join "`n" } else { "- none" }
$candidateText = if ($patientSpecificRoleCandidates.Count -gt 0) { ($patientSpecificRoleCandidates | ForEach-Object { "- $($_.File) :: $($_.Pattern) :: hits=$($_.Count) :: patient=$($_.PatientContext) referral=$($_.ReferralContext) workitem=$($_.WorkItemContext)" }) -join "`n" } else { "- none" }
$totalText = ($totals.GetEnumerator() | ForEach-Object { "- $($_.Key): $($_.Value)" }) -join "`n"

$report = @"
# Phase 5C - Notification Recipient Inventory

Status: PASS

Purpose:
Read-only local-source inventory to classify remaining notification recipient patterns before changing any patient-specific Role targeting.

Totals:
$totalText

Highest source usage:
$topText

Role-recipient candidates in files that also contain patient/referral/work-item context:
$candidateText

Interpretation rules for the next batch:
- Role is a capability/broadcast concept only, not patient-specific ownership.
- Patient-specific specialist routing should target the actual assigned User.
- Patient-specific Unit routing should fan out individual targetUserId rows through notifyUnitInTransaction so read state remains per user.
- Valid true-broadcast Role notifications may remain after manual classification.
- Do not add targetUnitId to Notification.

Safety:
- Read-only source inspection only.
- No database commands executed.
- No Prisma migration created or applied.
- No application source modified.
- Source SHA256 write guard PASS.
- Original live server untouched.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "=============================================="
Write-Host "PHASE 5C NOTIFICATION RECIPIENT INVENTORY: PASS"
Write-Host "=============================================="
Write-Host "Report: $reportPath"
Write-Host "Summary CSV: $summaryCsv"
Write-Host "Detail CSV: $detailCsv"
