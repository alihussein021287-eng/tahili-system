$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Get-TreeHash {
    param([string]$Root)
    $rows = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return "" }
    Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel = $_.FullName.Substring($Project.Length + 1).Replace('/','\\')
        $rows.Add("$rel|$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)")
    }
    return ($rows -join "`n")
}

function Require-ReportStatus {
    param([string]$RelativePath,[string]$Expected,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch ("(?mi)^Status:\s*" + [regex]::Escape($Expected) + "\s*$")) { throw "$Label status is not $Expected." }
}

function Add-ContextRecord {
    param(
        [System.Collections.Generic.List[object]]$List,
        [string]$File,
        [string[]]$Lines,
        [int]$Index,
        [string]$Category,
        [string]$Operation
    )
    $start = [Math]::Max(0,$Index - 5)
    $end = [Math]::Min($Lines.Length - 1,$Index + 5)
    $ctx = New-Object System.Collections.Generic.List[string]
    for ($i=$start; $i -le $end; $i++) {
        $ctx.Add(("{0,5}: {1}" -f ($i + 1),$Lines[$i]))
    }
    $nearStart = [Math]::Max(0,$Index - 30)
    $nearEnd = [Math]::Min($Lines.Length - 1,$Index + 30)
    $near = ($Lines[$nearStart..$nearEnd] -join "`n")
    $hasWorkItemNearby = [regex]::IsMatch($near,'(?i)patientWorkItem|PatientWorkItem|patient-work-item|workItem')
    $isWrite = $Operation -match '^(create|createMany|update|updateMany|upsert|delete|deleteMany)$'
    $List.Add([pscustomobject]@{
        File = $File
        Line = $Index + 1
        Category = $Category
        Operation = $Operation
        IsWrite = $isWrite
        WorkItemNearby = $hasWorkItemNearby
        Context = ($ctx -join "`r`n")
    })
}

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 6B CARESTAGE OPERATIONAL CUTOVER DETAIL"
Write-Host "============================================================"
Write-Host "Project: $Project"

Require-ReportStatus "_PHASE01_AUDIT\\54-FULL-AUTO-LOCAL-DEFERRED-FINAL-GATE.md" "PASS_WITH_DEFERRED_DOMAIN_ITEMS" "Deferred final gate"
Require-ReportStatus "_PHASE01_AUDIT\\50-PHASE6-CARESTAGE-DEPENDENCY-INVENTORY.md" "PASS" "CareStage inventory"

$inventoryPath = Join-Path $Project "_PHASE01_AUDIT\\50-PHASE6-CARESTAGE-DEPENDENCY-SOURCE.csv"
if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { throw "CareStage dependency CSV missing: $inventoryPath" }

$srcBefore = Get-TreeHash (Join-Path $Project "src")
$schemaPath = Join-Path $Project "prisma\\schema.prisma"
$schemaHashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash

$inv = @(Import-Csv -LiteralPath $inventoryPath)
$targetFiles = @($inv | Where-Object { $_.Category -in @('PRISMA_CARESTAGE','CARESTAGE_ID','RESPONSIBLE_ROLE') } | Select-Object -ExpandProperty File -Unique | Sort-Object)
if ($targetFiles.Count -eq 0) { throw "No CareStage cutover target files were found in the inventory." }

$records = New-Object System.Collections.Generic.List[object]
$fileSummary = New-Object System.Collections.Generic.List[object]

foreach ($rel in $targetFiles) {
    $full = Join-Path $Project $rel
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Inventory file not found locally: $rel" }
    $lines = [System.IO.File]::ReadAllLines($full,[System.Text.Encoding]::UTF8)
    $text = ($lines -join "`n")

    $readOps = 0
    $writeOps = 0
    $careStageIdHits = 0
    $responsibleRoleHits = 0
    $workItemHits = [regex]::Matches($text,'(?i)patientWorkItem|PatientWorkItem|patient-work-item|workItem').Count

    for ($i=0; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        $m = [regex]::Match($line,'prisma\.careStage\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany)')
        if ($m.Success) {
            $op = $m.Groups[1].Value
            if ($op -match '^(create|createMany|update|updateMany|upsert|delete|deleteMany)$') { $writeOps++ } else { $readOps++ }
            Add-ContextRecord $records $rel $lines $i 'PRISMA_CARESTAGE' $op
        }
        if ($line -match '\bcareStageId\b') {
            $careStageIdHits++
            if (-not ($line -match 'prisma\.careStage\.')) { Add-ContextRecord $records $rel $lines $i 'CARESTAGE_ID' '' }
        }
        if ($line -match '\bresponsibleRole\b') {
            $responsibleRoleHits++
            Add-ContextRecord $records $rel $lines $i 'RESPONSIBLE_ROLE' ''
        }
    }

    $classification = if ($writeOps -gt 0) {
        if ($workItemHits -gt 0) { 'WRITE_WITH_WORKITEM_NEARBY' } else { 'WRITE_LEGACY_ONLY' }
    } elseif ($readOps -gt 0) {
        if ($workItemHits -gt 0) { 'READ_WITH_WORKITEM_NEARBY' } else { 'READ_LEGACY_ONLY' }
    } elseif ($careStageIdHits -gt 0 -or $responsibleRoleHits -gt 0) {
        'FIELD_OR_ROUTING_ONLY'
    } else {
        'UNKNOWN'
    }

    $fileSummary.Add([pscustomobject]@{
        File = $rel
        ReadOps = $readOps
        WriteOps = $writeOps
        CareStageIdHits = $careStageIdHits
        ResponsibleRoleHits = $responsibleRoleHits
        WorkItemHits = $workItemHits
        Classification = $classification
    })
}

$globalFiles = Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
$globalWorkItemFiles = New-Object System.Collections.Generic.List[object]
foreach ($f in $globalFiles) {
    $t = [System.IO.File]::ReadAllText($f.FullName,[System.Text.Encoding]::UTF8)
    $hits = [regex]::Matches($t,'(?i)patientWorkItem|PatientWorkItem|patient-work-item|prisma\.patientWorkItem|workItemService').Count
    if ($hits -gt 0) {
        $rel = $f.FullName.Substring($Project.Length + 1).Replace('/','\\')
        $globalWorkItemFiles.Add([pscustomobject]@{File=$rel;Hits=$hits})
    }
}

Write-Host ""
Write-Host "=== CARESTAGE TARGET FILES ==="
$fileSummary | Sort-Object File | Format-Table -AutoSize | Out-Host

Write-Host ""
Write-Host "=== OPERATION COUNTS ==="
$readTotal = 0
$writeTotal = 0
$idTotal = 0
$roleTotal = 0
foreach ($r in $fileSummary) {
    $readTotal += [int]$r.ReadOps
    $writeTotal += [int]$r.WriteOps
    $idTotal += [int]$r.CareStageIdHits
    $roleTotal += [int]$r.ResponsibleRoleHits
}
Write-Host "carestage_read_ops|$readTotal"
Write-Host "carestage_write_ops|$writeTotal"
Write-Host "careStageId_hits|$idTotal"
Write-Host "responsibleRole_hits|$roleTotal"
Write-Host "workitem_candidate_files|$($globalWorkItemFiles.Count)"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$summaryCsv = Join-Path $auditDir "55-PHASE6-CARESTAGE-CUTOVER-FILE-SUMMARY.csv"
$detailCsv = Join-Path $auditDir "55-PHASE6-CARESTAGE-CUTOVER-DETAIL.csv"
$workItemCsv = Join-Path $auditDir "55-PHASE6-WORKITEM-CANDIDATE-FILES.csv"
$fileSummary | Sort-Object File | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $summaryCsv
$records | Sort-Object File,Line,Category | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $detailCsv
$globalWorkItemFiles | Sort-Object -Property @{Expression='Hits';Descending=$true},File | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $workItemCsv

$reportPath = Join-Path $auditDir "55-PHASE6-CARESTAGE-OPERATIONAL-CUTOVER-DETAIL.md"
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# Phase 6B - CareStage Operational Cutover Detail")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Status: PASS")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Purpose:")
[void]$sb.AppendLine("Map every active CareStage operational dependency in the current local source before source cutover.")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Summary:")
[void]$sb.AppendLine("- Target files: $($targetFiles.Count).")
[void]$sb.AppendLine("- CareStage read operations: $readTotal.")
[void]$sb.AppendLine("- CareStage write operations: $writeTotal.")
[void]$sb.AppendLine("- careStageId hits: $idTotal.")
[void]$sb.AppendLine("- responsibleRole hits: $roleTotal.")
[void]$sb.AppendLine("- WorkItem-related source files found: $($globalWorkItemFiles.Count).")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("File classification:")
foreach ($r in ($fileSummary | Sort-Object File)) {
    [void]$sb.AppendLine("- $($r.File): $($r.Classification); reads=$($r.ReadOps); writes=$($r.WriteOps); careStageId=$($r.CareStageIdHits); responsibleRole=$($r.ResponsibleRoleHits); workItemHits=$($r.WorkItemHits).")
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Detailed contexts:")
foreach ($r in ($records | Sort-Object File,Line,Category)) {
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## $($r.File):$($r.Line) [$($r.Category)] $($r.Operation)")
    [void]$sb.AppendLine("WorkItem nearby: $($r.WorkItemNearby)")
    [void]$sb.AppendLine('```')
    [void]$sb.AppendLine($r.Context)
    [void]$sb.AppendLine('```')
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Safety decision:")
[void]$sb.AppendLine("- This step is read-only.")
[void]$sb.AppendLine("- No source, schema, migration, or database mutation is performed.")
[void]$sb.AppendLine("- Source cutover must replace CareStage behavior with existing PatientWorkItem behavior, not merely delete calls.")
[void]$sb.AppendLine("- No User/Unit ownership may be inferred from Role, station names, labels, or arbitrary users.")
[void]$sb.AppendLine("- Original live server untouched.")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Artifacts:")
[void]$sb.AppendLine("- File summary CSV: $summaryCsv")
[void]$sb.AppendLine("- Detailed context CSV: $detailCsv")
[void]$sb.AppendLine("- WorkItem candidate files CSV: $workItemCsv")

[System.IO.File]::WriteAllText($reportPath,$sb.ToString(),(New-Object System.Text.UTF8Encoding($true)))

if ((Get-TreeHash (Join-Path $Project "src")) -ne $srcBefore) { throw "Source write guard failed." }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash -ne $schemaHashBefore) { throw "Schema write guard failed." }
Write-Host "Source/schema write guard: PASS"

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 6B CARESTAGE OPERATIONAL CUTOVER DETAIL: PASS"
Write-Host "============================================================"
Write-Host "Report: $reportPath"
Write-Host "Summary CSV: $summaryCsv"
Write-Host "Detail CSV: $detailCsv"
Write-Host "WorkItem CSV: $workItemCsv"
Write-Host "No source or database writes were performed."
