$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Get-TreeHash {
    param([string]$Root)
    $rows = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return "" }
    Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel = $_.FullName.Substring($Project.Length + 1).Replace('/','\')
        $rows.Add("$rel|$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)")
    }
    return ($rows -join "`n")
}

function Add-Hit {
    param(
        [System.Collections.Generic.List[object]]$List,
        [string]$File,
        [string[]]$Lines,
        [int]$Index,
        [string]$Kind
    )
    $start = [Math]::Max(0,$Index - 5)
    $end = [Math]::Min($Lines.Length - 1,$Index + 7)
    $ctx = New-Object System.Collections.Generic.List[string]
    for ($i=$start; $i -le $end; $i++) {
        $mark = if ($i -eq $Index) { ">" } else { " " }
        $ctx.Add(("{0} {1,5}: {2}" -f $mark,($i + 1),$Lines[$i]))
    }
    $List.Add([pscustomobject]@{
        File = $File
        Line = $Index + 1
        Kind = $Kind
        Context = ($ctx -join "`r`n")
    })
}

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 6B WORKITEM API CONTRACT DISCOVERY"
Write-Host "============================================================"
Write-Host "Project: $Project"

$required = @(
    "_PHASE01_AUDIT\56-PHASE6-CARESTAGE-WORKITEM-DISCOVERY.md",
    "_PHASE01_AUDIT\56-PHASE6-CARESTAGE-WORKITEM-TARGET-MAP.csv",
    "prisma\schema.prisma"
)
foreach ($r in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Project $r) -PathType Leaf)) { throw "Required file missing: $r" }
}

$report56 = [System.IO.File]::ReadAllText((Join-Path $Project "_PHASE01_AUDIT\56-PHASE6-CARESTAGE-WORKITEM-DISCOVERY.md"),[System.Text.Encoding]::UTF8)
if ($report56 -notmatch '(?mi)^Status:\s*PASS\s*$') { throw "Report 56 is not PASS." }

$srcBefore = Get-TreeHash (Join-Path $Project "src")
$schemaPath = Join-Path $Project "prisma\schema.prisma"
$schemaHashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash

$schema = [System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
$modelMatch = [regex]::Match($schema,'(?ms)^model\s+PatientWorkItem\s*\{.*?^\}')
if (-not $modelMatch.Success) { throw "PatientWorkItem model missing from current local schema." }
$modelBlock = $modelMatch.Value

$patterns = @(
    [pscustomobject]@{Kind='DIRECT_PRISMA'; Regex='prisma\.patientWorkItem\.'},
    [pscustomobject]@{Kind='MODEL_NAME'; Regex='\bPatientWorkItem\b'},
    [pscustomobject]@{Kind='LEGACY_LINK'; Regex='\blegacyCareStageId\b'},
    [pscustomobject]@{Kind='WORKITEM_FUNCTION'; Regex='(?i)\b(create|open|assign|claim|accept|start|complete|block|cancel|update)[A-Za-z0-9_]*(Patient)?WorkItem[A-Za-z0-9_]*\b|\b(Patient)?WorkItem[A-Za-z0-9_]*(create|open|assign|claim|accept|start|complete|block|cancel|update)\b'},
    [pscustomobject]@{Kind='WORKITEM_IMPORT'; Regex='(?i)(from\s+["''][^"'']*(work-item|workitem)[^"'']*["''])|(import\s+.*(work-item|workitem))'},
    [pscustomobject]@{Kind='CARESTAGE_DIRECT'; Regex='prisma\.careStage\.'}
)

$hits = New-Object System.Collections.Generic.List[object]
$srcFiles = Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
foreach ($file in $srcFiles) {
    $lines = [System.IO.File]::ReadAllLines($file.FullName,[System.Text.Encoding]::UTF8)
    $rel = $file.FullName.Substring($Project.Length + 1).Replace('/','\')
    for ($i=0; $i -lt $lines.Length; $i++) {
        foreach ($p in $patterns) {
            if ([regex]::IsMatch($lines[$i],$p.Regex)) {
                Add-Hit $hits $rel $lines $i $p.Kind
            }
        }
    }
}

if ($hits.Count -eq 0) { throw "No WorkItem/CareStage contract hits found." }

$importantFiles = @(
    'src\app\(app)\patients\actions.ts',
    'src\app\(app)\my-work\page.tsx',
    'src\lib\patient-journey.ts',
    'src\lib\referral-service.ts',
    'src\app\(app)\page.tsx',
    'src\app\(app)\care-board\page.tsx',
    'src\app\(app)\patients-care\page.tsx',
    'src\app\(app)\station-kpis\page.tsx'
)

Write-Host ""
Write-Host "=== WORKITEM CONTRACT FILE COUNTS ==="
$counts = @($hits | Group-Object File | ForEach-Object {
    $group = $_.Group
    [pscustomobject]@{
        File = $_.Name
        DirectPrisma = @($group | Where-Object Kind -eq 'DIRECT_PRISMA').Count
        FunctionHits = @($group | Where-Object Kind -eq 'WORKITEM_FUNCTION').Count
        LegacyLinkHits = @($group | Where-Object Kind -eq 'LEGACY_LINK').Count
        CareStageOps = @($group | Where-Object Kind -eq 'CARESTAGE_DIRECT').Count
        TotalHits = $group.Count
    }
} | Sort-Object -Property @{Expression='TotalHits';Descending=$true},@{Expression='File';Descending=$false})
$counts | Select-Object -First 30 | Format-Table -AutoSize | Out-Host

Write-Host ""
Write-Host "=== IMPORTANT LOCAL CONTRACT CONTEXTS ==="
$selected = @($hits | Where-Object {
    ($importantFiles -contains $_.File) -or
    ($_.Kind -eq 'WORKITEM_FUNCTION') -or
    ($_.Kind -eq 'WORKITEM_IMPORT') -or
    ($_.Kind -eq 'DIRECT_PRISMA')
} | Sort-Object File,Line,Kind)

foreach ($h in $selected) {
    Write-Host ""
    Write-Host ("--- {0}:{1} [{2}] ---" -f $h.File,$h.Line,$h.Kind)
    Write-Host $h.Context
}

Write-Host ""
Write-Host "=== PATIENTWORKITEM SCHEMA CONTRACT ==="
Write-Host $modelBlock

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$detailCsv = Join-Path $auditDir "57-PHASE6-WORKITEM-API-CONTRACT-DETAIL.csv"
$countCsv = Join-Path $auditDir "57-PHASE6-WORKITEM-API-CONTRACT-FILES.csv"
$schemaTxt = Join-Path $auditDir "57-PHASE6-PATIENTWORKITEM-SCHEMA-CONTRACT.txt"
$reportPath = Join-Path $auditDir "57-PHASE6-WORKITEM-API-CONTRACT.md"

$hits | Sort-Object File,Line,Kind | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $detailCsv
$counts | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $countCsv
[System.IO.File]::WriteAllText($schemaTxt,$modelBlock,(New-Object System.Text.UTF8Encoding($true)))

$directFiles = @($hits | Where-Object Kind -eq 'DIRECT_PRISMA' | Select-Object -ExpandProperty File -Unique)
$functionFiles = @($hits | Where-Object Kind -eq 'WORKITEM_FUNCTION' | Select-Object -ExpandProperty File -Unique)
$careFiles = @($hits | Where-Object Kind -eq 'CARESTAGE_DIRECT' | Select-Object -ExpandProperty File -Unique)

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# Phase 6B - WorkItem API Contract Discovery")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Status: PASS")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("- Direct prisma.patientWorkItem files: $($directFiles.Count).")
[void]$sb.AppendLine("- WorkItem function/import candidate files: $($functionFiles.Count).")
[void]$sb.AppendLine("- Direct prisma.careStage files: $($careFiles.Count).")
[void]$sb.AppendLine("- Source and schema were not modified.")
[void]$sb.AppendLine("- This report captures the current local worktree, not a remote-source assumption.")
[void]$sb.AppendLine("- Role is not converted to User or Unit ownership by this discovery.")
[void]$sb.AppendLine("- Original live server untouched.")
[System.IO.File]::WriteAllText($reportPath,$sb.ToString(),(New-Object System.Text.UTF8Encoding($true)))

$srcAfter = Get-TreeHash (Join-Path $Project "src")
$schemaHashAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash
if ($srcBefore -ne $srcAfter -or $schemaHashBefore -ne $schemaHashAfter) { throw "Source/schema write guard failed." }
Write-Host ""
Write-Host "Source/schema write guard: PASS"
Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 6B WORKITEM API CONTRACT DISCOVERY: PASS"
Write-Host "============================================================"
Write-Host "Report: $reportPath"
Write-Host "Detail CSV: $detailCsv"
Write-Host "No source or database writes were performed."
