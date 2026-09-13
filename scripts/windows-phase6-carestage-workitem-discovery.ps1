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

function Require-ReportStatus {
    param([string]$RelativePath,[string]$Expected,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch ("(?mi)^Status:\s*" + [regex]::Escape($Expected) + "\s*$")) { throw "$Label status is not $Expected." }
}

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

function Invoke-PsqlText {
    param([Parameter(Mandatory=$true)][string]$Database,[Parameter(Mandatory=$true)][string]$Sql)
    $args = $Compose + @("exec","-T","postgres","psql","-X","-v","ON_ERROR_STOP=1","-U",$script:dbUser,"-d",$Database,"-Atq")
    $old = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $out = $Sql | & docker @args 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
    if ($code -ne 0) { throw "psql failed.`n$($out | Out-String)" }
    return (($out | Out-String).Trim())
}

function Add-Context {
    param(
        [System.Collections.Generic.List[object]]$List,
        [string]$File,
        [string[]]$Lines,
        [int]$Index,
        [string]$Category,
        [string]$Operation
    )
    $start = [Math]::Max(0,$Index - 4)
    $end = [Math]::Min($Lines.Length - 1,$Index + 4)
    $ctx = New-Object System.Collections.Generic.List[string]
    for ($i=$start; $i -le $end; $i++) {
        $ctx.Add(("{0,5}: {1}" -f ($i + 1),$Lines[$i]))
    }
    $List.Add([pscustomobject]@{
        File = $File
        Line = $Index + 1
        Category = $Category
        Operation = $Operation
        Context = ($ctx -join "`r`n")
    })
}

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 6B CARESTAGE TO WORKITEM IMPLEMENTATION DISCOVERY"
Write-Host "============================================================"
Write-Host "Project: $Project"

Require-ReportStatus "_PHASE01_AUDIT\55-PHASE6-CARESTAGE-OPERATIONAL-CUTOVER-DETAIL.md" "PASS" "CareStage operational detail"
Require-ReportStatus "_PHASE01_AUDIT\54-FULL-AUTO-LOCAL-DEFERRED-FINAL-GATE.md" "PASS_WITH_DEFERRED_DOMAIN_ITEMS" "Deferred final gate"

$summaryPath = Join-Path $Project "_PHASE01_AUDIT\55-PHASE6-CARESTAGE-CUTOVER-FILE-SUMMARY.csv"
if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) { throw "Report 55 summary CSV missing: $summaryPath" }

foreach ($requiredFile in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
    if (-not (Test-Path -LiteralPath (Join-Path $Project $requiredFile) -PathType Leaf)) { throw "Required file missing: $requiredFile" }
}

$srcBefore = Get-TreeHash (Join-Path $Project "src")
$schemaPath = Join-Path $Project "prisma\schema.prisma"
$schemaHashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash
$schema = [System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")

$modelMatch = [regex]::Match($schema,'(?ms)^model\s+PatientWorkItem\s*\{.*?^\}')
if (-not $modelMatch.Success) { throw "PatientWorkItem model was not found in current local schema." }
$modelBlock = $modelMatch.Value
$mapMatch = [regex]::Match($modelBlock,'@@map\("([^"]+)"\)')
$workItemTable = if ($mapMatch.Success) { $mapMatch.Groups[1].Value } else { "PatientWorkItem" }
Write-Host "PatientWorkItem table mapping: $workItemTable"

$envMap = @{}
foreach ($line in Get-Content -LiteralPath ".env.saif-dev") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $k = $Matches[1]
        $v = $Matches[2].Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1,$v.Length - 2) }
        $envMap[$k] = $v
    }
}
$script:dbUser = $envMap["DB_USER"]
$script:dbName = $envMap["DB_NAME"]
if ([string]::IsNullOrWhiteSpace($script:dbUser) -or [string]::IsNullOrWhiteSpace($script:dbName)) { throw "DB_USER/DB_NAME missing." }

$careStageRows = Invoke-PsqlText $script:dbName 'SELECT count(*) FROM "CareStage";'
$referralLinked = Invoke-PsqlText $script:dbName 'SELECT count(*) FROM "referral_requests" WHERE "careStageId" IS NOT NULL;'
$escapedTable = $workItemTable.Replace('"','""')
$existsSql = 'SELECT CASE WHEN to_regclass(''public."{0}"'') IS NULL THEN 0 ELSE 1 END;' -f $escapedTable
$workItemTablePresent = Invoke-PsqlText $script:dbName $existsSql
$workItemRows = "NA"
if ($workItemTablePresent.Trim() -eq '1') {
    $countSql = 'SELECT count(*) FROM "{0}";' -f $escapedTable
    $workItemRows = Invoke-PsqlText $script:dbName $countSql
}

Write-Host ""
Write-Host "=== DATABASE SAFETY SNAPSHOT ==="
Write-Host "carestage_rows|$careStageRows"
Write-Host "referral_careStageId_linked|$referralLinked"
Write-Host "workitem_table_present|$workItemTablePresent"
Write-Host "workitem_rows|$workItemRows"
if ($careStageRows.Trim() -ne '0') { throw "CareStage is no longer empty. Stop for data migration review." }
if ($referralLinked.Trim() -ne '0') { throw "referral_requests.careStageId gained linked rows. Stop for data migration review." }
if ($workItemTablePresent.Trim() -ne '1') { throw "PatientWorkItem table is not present in the local database." }

$patterns = @(
    [pscustomobject]@{Name='PRISMA_WORKITEM'; Regex='prisma\.patientWorkItem\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany)'; OperationGroup=1},
    [pscustomobject]@{Name='WORKITEM_SERVICE'; Regex='(?i)patient-work-item|patientWorkItemService|workItemService|PatientWorkItemService'; OperationGroup=0},
    [pscustomobject]@{Name='WORKITEM_MODEL'; Regex='\bPatientWorkItem\b'; OperationGroup=0},
    [pscustomobject]@{Name='LEGACY_CARESTAGE_LINK'; Regex='\blegacyCareStageId\b'; OperationGroup=0},
    [pscustomobject]@{Name='ASSIGNED_USER'; Regex='\bassignedUserId\b|\bassignedToUserId\b'; OperationGroup=0},
    [pscustomobject]@{Name='ASSIGNED_UNIT'; Regex='\bassignedUnitId\b|\bassignedToUnitId\b'; OperationGroup=0},
    [pscustomobject]@{Name='WORKITEM_STATUS'; Regex='\bOPEN\b|\bASSIGNED\b|\bACCEPTED\b|\bPROGRESS_IN\b|\bCOMPLETED\b|\bBLOCKED\b|\bCANCELLED\b'; OperationGroup=0}
)

$details = New-Object System.Collections.Generic.List[object]
$fileHits = New-Object System.Collections.Generic.List[object]
$srcFiles = Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx

foreach ($file in $srcFiles) {
    $lines = [System.IO.File]::ReadAllLines($file.FullName,[System.Text.Encoding]::UTF8)
    $text = ($lines -join "`n")
    $rel = $file.FullName.Substring($Project.Length + 1).Replace('/','\')
    $totalHits = 0
    $prismaReads = 0
    $prismaWrites = 0
    foreach ($p in $patterns) {
        $ms = [regex]::Matches($text,$p.Regex)
        if ($ms.Count -gt 0) { $totalHits += $ms.Count }
    }
    if ($totalHits -eq 0) { continue }

    for ($i=0; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        foreach ($p in $patterns) {
            $m = [regex]::Match($line,$p.Regex)
            if (-not $m.Success) { continue }
            $op = ""
            if ($p.OperationGroup -gt 0) {
                $op = $m.Groups[$p.OperationGroup].Value
                if ($op -match '^(create|createMany|update|updateMany|upsert|delete|deleteMany)$') { $prismaWrites++ } else { $prismaReads++ }
            }
            Add-Context $details $rel $lines $i $p.Name $op
        }
    }
    $fileHits.Add([pscustomobject]@{
        File = $rel
        Hits = $totalHits
        PrismaReads = $prismaReads
        PrismaWrites = $prismaWrites
    })
}

if ($fileHits.Count -eq 0) { throw "No PatientWorkItem implementation references were discovered in current local source." }

$legacySummary = @(Import-Csv -LiteralPath $summaryPath)
$targetMap = New-Object System.Collections.Generic.List[object]
foreach ($legacy in $legacySummary) {
    $candidate = @($fileHits | Where-Object { $_.File -eq $legacy.File })
    $wiHits = 0
    $wiReads = 0
    $wiWrites = 0
    if ($candidate.Count -gt 0) {
        $wiHits = [int]$candidate[0].Hits
        $wiReads = [int]$candidate[0].PrismaReads
        $wiWrites = [int]$candidate[0].PrismaWrites
    }
    $legacyReads = [int]$legacy.ReadOps
    $legacyWrites = [int]$legacy.WriteOps
    $classification = if ($legacyWrites -gt 0) {
        if ($wiHits -gt 0) { "WRITE_CUTOVER_WITH_WORKITEM_CONTEXT" } else { "WRITE_CUTOVER_REQUIRES_SERVICE" }
    } elseif ($legacyReads -gt 0) {
        if ($wiHits -gt 0) { "READ_CUTOVER_WITH_WORKITEM_CONTEXT" } else { "READ_CUTOVER_REQUIRES_QUERY" }
    } elseif ($wiHits -gt 0) {
        "COMPAT_ROUTING_WITH_WORKITEM_CONTEXT"
    } else {
        "COMPAT_ROUTING_SEPARATE_REVIEW"
    }
    $targetMap.Add([pscustomobject]@{
        File = $legacy.File
        LegacyReads = $legacyReads
        LegacyWrites = $legacyWrites
        ResponsibleRoleHits = [int]$legacy.ResponsibleRoleHits
        WorkItemHits = $wiHits
        WorkItemReads = $wiReads
        WorkItemWrites = $wiWrites
        Classification = $classification
    })
}

Write-Host ""
Write-Host "=== CARESTAGE TO WORKITEM TARGET MAP ==="
$targetMap | Sort-Object File | Format-Table -AutoSize | Out-Host

Write-Host ""
Write-Host "=== TOP WORKITEM IMPLEMENTATION FILES ==="
$sortedCandidates = @($fileHits | Sort-Object -Property @{Expression='Hits';Descending=$true},@{Expression='File';Descending=$false})
$sortedCandidates | Select-Object -First 25 | Format-Table -AutoSize | Out-Host

$globalReads = 0
$globalWrites = 0
foreach ($f in $fileHits) {
    $globalReads += [int]$f.PrismaReads
    $globalWrites += [int]$f.PrismaWrites
}
Write-Host ""
Write-Host "=== WORKITEM IMPLEMENTATION COUNTS ==="
Write-Host "workitem_source_files|$($fileHits.Count)"
Write-Host "workitem_prisma_reads|$globalReads"
Write-Host "workitem_prisma_writes|$globalWrites"
Write-Host "workitem_table_rows|$workItemRows"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$targetCsv = Join-Path $auditDir "56-PHASE6-CARESTAGE-WORKITEM-TARGET-MAP.csv"
$candidateCsv = Join-Path $auditDir "56-PHASE6-WORKITEM-IMPLEMENTATION-FILES.csv"
$detailCsv = Join-Path $auditDir "56-PHASE6-WORKITEM-IMPLEMENTATION-DETAIL.csv"
$modelPath = Join-Path $auditDir "56-PHASE6-PATIENTWORKITEM-SCHEMA-BLOCK.txt"
$reportPath = Join-Path $auditDir "56-PHASE6-CARESTAGE-WORKITEM-DISCOVERY.md"

$targetMap | Sort-Object File | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $targetCsv
$sortedCandidates | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $candidateCsv
$details | Sort-Object File,Line,Category | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $detailCsv
[System.IO.File]::WriteAllText($modelPath,$modelBlock,(New-Object System.Text.UTF8Encoding($true)))

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# Phase 6B - CareStage to WorkItem Implementation Discovery")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Status: PASS")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Database snapshot:")
[void]$sb.AppendLine("- CareStage rows: $careStageRows.")
[void]$sb.AppendLine("- referral_requests rows linked by careStageId: $referralLinked.")
[void]$sb.AppendLine("- PatientWorkItem table: $workItemTable.")
[void]$sb.AppendLine("- PatientWorkItem rows: $workItemRows.")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Implementation discovery:")
[void]$sb.AppendLine("- WorkItem source files: $($fileHits.Count).")
[void]$sb.AppendLine("- Direct prisma.patientWorkItem reads: $globalReads.")
[void]$sb.AppendLine("- Direct prisma.patientWorkItem writes: $globalWrites.")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Cutover rule:")
[void]$sb.AppendLine("- Read-only CareStage pages may be moved only to proven PatientWorkItem queries or service APIs.")
[void]$sb.AppendLine("- Legacy CareStage write lifecycle must not be deleted until an equivalent WorkItem transition exists.")
[void]$sb.AppendLine("- responsibleRole is not ownership and must not be converted to an arbitrary User or Unit.")
[void]$sb.AppendLine("- referral careStageId compatibility remains separate from the valid referral USER/UNIT routing implemented earlier.")
[void]$sb.AppendLine("- Original live server untouched.")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Artifacts:")
[void]$sb.AppendLine("- Target map: $targetCsv")
[void]$sb.AppendLine("- WorkItem implementation files: $candidateCsv")
[void]$sb.AppendLine("- WorkItem detailed contexts: $detailCsv")
[void]$sb.AppendLine("- PatientWorkItem schema block: $modelPath")
[System.IO.File]::WriteAllText($reportPath,$sb.ToString(),(New-Object System.Text.UTF8Encoding($true)))

if ((Get-TreeHash (Join-Path $Project "src")) -ne $srcBefore) { throw "Source write guard failed." }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash -ne $schemaHashBefore) { throw "Schema write guard failed." }
Write-Host "Source/schema write guard: PASS"

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 6B CARESTAGE TO WORKITEM DISCOVERY: PASS"
Write-Host "============================================================"
Write-Host "Report: $reportPath"
Write-Host "Target map: $targetCsv"
Write-Host "Implementation files: $candidateCsv"
Write-Host "No source or database writes were performed."
