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

function Invoke-NativeCapture {
    param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string[]]$Arguments)
    $old=$ErrorActionPreference
    try {
        $ErrorActionPreference="Continue"
        $out=& $Exe @Arguments 2>&1
        $code=$LASTEXITCODE
    } finally {
        $ErrorActionPreference=$old
    }
    if ($code -ne 0) { throw "$Exe failed with exit code $code.`n$($out | Out-String)" }
    return (($out | Out-String).Trim())
}

function Invoke-ComposeCapture {
    param([Parameter(Mandatory=$true)][string[]]$Arguments)
    return Invoke-NativeCapture "docker" @($Compose + $Arguments)
}

function Invoke-PsqlText {
    param([Parameter(Mandatory=$true)][string]$Database,[Parameter(Mandatory=$true)][string]$Sql)
    $args=$Compose + @("exec","-T","postgres","psql","-X","-v","ON_ERROR_STOP=1","-U",$script:dbUser,"-d",$Database,"-Atq")
    $old=$ErrorActionPreference
    try {
        $ErrorActionPreference="Continue"
        $out=$Sql | & docker @args 2>&1
        $code=$LASTEXITCODE
    } finally {
        $ErrorActionPreference=$old
    }
    if ($code -ne 0) { throw "psql failed.`n$($out | Out-String)" }
    return (($out | Out-String).Trim())
}

function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path=Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text=[System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Get-TreeHash {
    param([string]$Root)
    $rows=New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return "" }
    Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel=$_.FullName.Substring($Project.Length+1).Replace('/','\')
        $rows.Add("$rel|$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)")
    }
    return ($rows -join "`n")
}

Write-Host ""
Write-Host "=== PHASE 6B CARESTAGE DEPENDENCY INVENTORY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\49-PHASE6-EMPLOYEE-FINAL-RUNTIME-GATE.md" "Phase 6A Employee final runtime gate"
Write-Host "Employee cleanup prerequisite: PASS"

Invoke-NativeCapture "docker" @("info") | Out-Null
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

$srcHashBefore=Get-TreeHash (Join-Path $Project "src")
$schemaHashBefore=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Project "prisma\schema.prisma")).Hash

$dbSummarySql=@'
SELECT 'carestage_table_present|' || CASE WHEN to_regclass('public."CareStage"') IS NULL THEN 0 ELSE 1 END
UNION ALL SELECT 'stage_status_enum_present|' || CASE WHEN EXISTS (
  SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE n.nspname='public' AND t.typname='StageStatus'
) THEN 1 ELSE 0 END
UNION ALL SELECT 'carestage_inbound_fk_count|' || count(*)
FROM pg_constraint c
JOIN pg_class t ON t.oid=c.confrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE c.contype='f' AND n.nspname='public' AND t.relname='CareStage'
UNION ALL SELECT 'carestage_outbound_fk_count|' || count(*)
FROM pg_constraint c
JOIN pg_class s ON s.oid=c.conrelid
JOIN pg_namespace n ON n.oid=s.relnamespace
WHERE c.contype='f' AND n.nspname='public' AND s.relname='CareStage'
ORDER BY 1;
'@
$dbSummary=Invoke-PsqlText $script:dbName $dbSummarySql
Write-Host $dbSummary
$dbLines=@($dbSummary -split "`r?`n")
if (@($dbLines | Where-Object { $_ -eq 'carestage_table_present|1' }).Count -ne 1) { throw "CareStage table is not present; stop for separate review." }

$careStageCount=Invoke-PsqlText $script:dbName 'SELECT count(*) FROM "CareStage";'
Write-Host "carestage_total|$careStageCount"

$referralColumnSql=@'
SELECT count(*)
FROM information_schema.columns
WHERE table_schema='public' AND table_name='referral_requests' AND column_name='careStageId';
'@
$referralColumnPresent=Invoke-PsqlText $script:dbName $referralColumnSql
Write-Host "referral_care_stage_column_present|$referralColumnPresent"
$referralLinked="NA"
if ($referralColumnPresent.Trim() -eq '1') {
    $referralLinked=Invoke-PsqlText $script:dbName 'SELECT count(*) FROM "referral_requests" WHERE "careStageId" IS NOT NULL;'
}
Write-Host "referral_care_stage_linked|$referralLinked"

$fkSql=@'
SELECT
  CASE WHEN c.confrelid = '"CareStage"'::regclass THEN 'INBOUND' ELSE 'OUTBOUND' END || '|' ||
  conrelid::regclass::text || '|' || c.conname || '|' || confrelid::regclass::text
FROM pg_constraint c
WHERE c.contype='f'
  AND (c.confrelid='"CareStage"'::regclass OR c.conrelid='"CareStage"'::regclass)
ORDER BY 1;
'@
$fkRows=Invoke-PsqlText $script:dbName $fkSql
Write-Host ""
Write-Host "=== CARESTAGE FOREIGN KEYS ==="
if ([string]::IsNullOrWhiteSpace($fkRows)) { Write-Host "NONE" } else { Write-Host $fkRows }

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=[System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8)
$schemaCareStageModel=[regex]::Matches($schema,'(?m)^model\s+CareStage\s*\{').Count
$schemaStageStatusEnum=[regex]::Matches($schema,'(?m)^enum\s+StageStatus\s*\{').Count
$schemaPathwayDefault=[regex]::Matches($schema,'\bPATHWAY_DEFAULT\b').Count
Write-Host "schema_carestage_model|$schemaCareStageModel"
Write-Host "schema_stage_status_enum|$schemaStageStatusEnum"
Write-Host "schema_pathway_default_hits|$schemaPathwayDefault"

$patterns=@(
    [pscustomobject]@{Name='PRISMA_CARESTAGE'; Regex='prisma\.careStage\b'},
    [pscustomobject]@{Name='CARESTAGE_ID'; Regex='\bcareStageId\b'},
    [pscustomobject]@{Name='CARESTAGE_TYPE'; Regex='\bCareStage\b'},
    [pscustomobject]@{Name='STAGE_STATUS'; Regex='\bStageStatus\b'},
    [pscustomobject]@{Name='PATHWAY_DEFAULT'; Regex='\bPATHWAY_DEFAULT\b'},
    [pscustomobject]@{Name='RESPONSIBLE_ROLE'; Regex='\bresponsibleRole\b'},
    [pscustomobject]@{Name='TARGET_ROLE'; Regex='\btargetRole\b'}
)

$inventory=New-Object System.Collections.Generic.List[object]
$srcFiles=Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
foreach ($file in $srcFiles) {
    $text=[System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    $rel=$file.FullName.Substring($Project.Length+1).Replace('/','\')
    foreach ($p in $patterns) {
        $count=[regex]::Matches($text,$p.Regex).Count
        if ($count -gt 0) {
            $inventory.Add([pscustomobject]@{Category=$p.Name;File=$rel;Hits=$count})
        }
    }
}

Write-Host ""
Write-Host "=== SOURCE DEPENDENCY COUNTS ==="
foreach ($p in $patterns) {
    $rows=@($inventory | Where-Object { $_.Category -eq $p.Name })
    $files=$rows.Count
    $hits=0
    foreach ($r in $rows) { $hits += [int]$r.Hits }
    Write-Host "$($p.Name)|files=$files|hits=$hits"
}

Write-Host ""
Write-Host "=== PRISMA MIGRATION STATUS ==="
$status=Invoke-ComposeCapture @("exec","-T","app","npx","prisma","migrate","status")
Write-Host $status
if ($status -notmatch 'Database schema is up to date!') { throw "Prisma migration status is not up to date." }

if ((Get-TreeHash (Join-Path $Project "src")) -ne $srcHashBefore) { throw "Source write guard failed: src/ changed during inventory." }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash -ne $schemaHashBefore) { throw "Schema write guard failed." }
Write-Host "Source/schema write guard: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "50-PHASE6-CARESTAGE-DEPENDENCY-SOURCE.csv"
$inventory | Sort-Object Category,File | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $csvPath

$inboundLine=@($dbLines | Where-Object { $_ -like 'carestage_inbound_fk_count|*' })
$outboundLine=@($dbLines | Where-Object { $_ -like 'carestage_outbound_fk_count|*' })
$inboundCount=if ($inboundLine.Count -eq 1) { [int](($inboundLine[0] -split '\|')[1]) } else { -1 }
$outboundCount=if ($outboundLine.Count -eq 1) { [int](($outboundLine[0] -split '\|')[1]) } else { -1 }

$reportPath=Join-Path $auditDir "50-PHASE6-CARESTAGE-DEPENDENCY-INVENTORY.md"
$report=@"
# Phase 6B - CareStage Dependency Inventory

Status: PASS

Purpose:
Read-only inventory before any CareStage, StageStatus, or PATHWAY_DEFAULT cleanup.

Database:
- CareStage table present: yes.
- CareStage rows: $careStageCount.
- CareStage inbound FK count: $inboundCount.
- CareStage outbound FK count: $outboundCount.
- referral_requests.careStageId column present: $referralColumnPresent.
- referral_requests rows with careStageId: $referralLinked.

Prisma schema:
- CareStage model count: $schemaCareStageModel.
- StageStatus enum count: $schemaStageStatusEnum.
- PATHWAY_DEFAULT schema hits: $schemaPathwayDefault.

Safety decision:
- This inventory does NOT authorize dropping CareStage or StageStatus.
- Any inbound/outbound FK, prisma.careStage usage, careStageId usage, or patient-specific role-routing dependency must be cut over and verified first.
- CareStage responsibleRole remains compatibility/history until actual User/Unit ownership is proven where required.
- Do not infer ownership from Role, names, or labels.
- Do not edit historical migrations and do not use prisma db push.
- Employee cleanup remains complete and separate.
- Original live server untouched.

Artifacts:
- Source inventory CSV: $csvPath

Next:
Classify the exact CareStage and careStageId dependencies, then prepare non-destructive cutovers before any destructive migration.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "========================================="
Write-Host "PHASE 6B CARESTAGE DEPENDENCY INVENTORY: PASS"
Write-Host "========================================="
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
Write-Host "No database or source writes were performed."
