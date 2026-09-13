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
    return $path
}

Write-Host ""
Write-Host "=== PHASE 4 NOTIFICATION SCOPE INVENTORY ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\20-PHASE4-WORKITEM-SCOPE-INVENTORY.md" "Phase 4 WorkItem scope inventory" | Out-Null
Write-Host "Phase 4 WorkItem scope prerequisite: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml")) {
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
if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres")))) { throw "Local PostgreSQL container is not running." }

$tableSql=@'
SELECT table_name
FROM information_schema.columns
WHERE table_schema='public'
GROUP BY table_name
HAVING bool_or(column_name='targetRole')
   AND bool_or(column_name='targetUserId')
   AND bool_or(column_name='title')
ORDER BY table_name
LIMIT 1;
'@
$notificationTable=(Invoke-PsqlText $tableSql).Trim()
if ([string]::IsNullOrWhiteSpace($notificationTable)) { throw "Notification table could not be discovered." }
if ($notificationTable -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Unsafe Notification table name discovered: $notificationTable" }
$quotedTable='"' + $notificationTable + '"'

$unitColumnSql="SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='$notificationTable' AND column_name='targetUnitId';"
$hasTargetUnit=([int](Invoke-PsqlText $unitColumnSql) -gt 0)

if ($hasTargetUnit) {
    $statsSql=@"
SELECT 'total|' || count(*) FROM $quotedTable
UNION ALL SELECT 'role_only|' || count(*) FROM $quotedTable WHERE "targetRole" IS NOT NULL AND "targetUserId" IS NULL AND "targetUnitId" IS NULL
UNION ALL SELECT 'user_only|' || count(*) FROM $quotedTable WHERE "targetRole" IS NULL AND "targetUserId" IS NOT NULL AND "targetUnitId" IS NULL
UNION ALL SELECT 'unit_only|' || count(*) FROM $quotedTable WHERE "targetRole" IS NULL AND "targetUserId" IS NULL AND "targetUnitId" IS NOT NULL
UNION ALL SELECT 'multiple_targets|' || count(*) FROM $quotedTable WHERE ((CASE WHEN "targetRole" IS NULL THEN 0 ELSE 1 END)+(CASE WHEN "targetUserId" IS NULL THEN 0 ELSE 1 END)+(CASE WHEN "targetUnitId" IS NULL THEN 0 ELSE 1 END)) > 1
UNION ALL SELECT 'no_target|' || count(*) FROM $quotedTable WHERE "targetRole" IS NULL AND "targetUserId" IS NULL AND "targetUnitId" IS NULL
UNION ALL SELECT 'target_user_missing|' || count(*) FROM $quotedTable n LEFT JOIN "users" u ON u."id"=n."targetUserId" WHERE n."targetUserId" IS NOT NULL AND u."id" IS NULL
UNION ALL SELECT 'target_unit_missing|' || count(*) FROM $quotedTable n LEFT JOIN "units" un ON un."id"=n."targetUnitId" WHERE n."targetUnitId" IS NOT NULL AND un."id" IS NULL
UNION ALL SELECT 'unread_total|' || count(*) FROM $quotedTable WHERE "read"=false;
"@
    $badKeys=@('multiple_targets','no_target','target_user_missing','target_unit_missing')
} else {
    $statsSql=@"
SELECT 'total|' || count(*) FROM $quotedTable
UNION ALL SELECT 'role_only|' || count(*) FROM $quotedTable WHERE "targetRole" IS NOT NULL AND "targetUserId" IS NULL
UNION ALL SELECT 'user_only|' || count(*) FROM $quotedTable WHERE "targetRole" IS NULL AND "targetUserId" IS NOT NULL
UNION ALL SELECT 'both_role_user|' || count(*) FROM $quotedTable WHERE "targetRole" IS NOT NULL AND "targetUserId" IS NOT NULL
UNION ALL SELECT 'neither_role_user|' || count(*) FROM $quotedTable WHERE "targetRole" IS NULL AND "targetUserId" IS NULL
UNION ALL SELECT 'target_user_missing|' || count(*) FROM $quotedTable n LEFT JOIN "users" u ON u."id"=n."targetUserId" WHERE n."targetUserId" IS NOT NULL AND u."id" IS NULL
UNION ALL SELECT 'unread_total|' || count(*) FROM $quotedTable WHERE "read"=false;
"@
    $badKeys=@('both_role_user','neither_role_user','target_user_missing')
}

$stats=Invoke-PsqlText $statsSql
$bad=0
foreach ($line in ($stats -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2) { throw "Unexpected Notification stats row: $line" }
    if ($p[0] -in $badKeys) { $bad += [int64]$p[1] }
}

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "21-PHASE4-NOTIFICATION-SOURCE-USAGE.csv"
$reportPath=Join-Path $auditDir "21-PHASE4-NOTIFICATION-SCOPE-INVENTORY.md"

$patterns=[ordered]@{
    'NOTIFICATION_DB'='(?i)\b(?:prisma|tx)\.notification\.(?:findMany|findFirst|count|updateMany|create|createMany|update|delete)\b'
    'TARGET_ROLE'='\btargetRole\b'
    'TARGET_USER'='\btargetUserId\b'
    'TARGET_UNIT'='\btargetUnitId\b'
    'NOTIFY_ROLE'='\bnotifyRole(?:InTransaction)?\s*\('
    'NOTIFY_USER'='\bnotifyUser(?:InTransaction)?\s*\('
    'NOTIFY_UNIT'='\bnotifyUnit(?:InTransaction)?\s*\('
    'WORKITEM_ACTION'='\b(?:assign|claim|accept|start|complete|reassign)PatientWorkItem\b'
    'SCOPE_GUARD'='\b(?:assertPerm|requirePerm|currentPerms|userUnitMembership|UserUnitMembership)\b'
}

$rows=New-Object System.Collections.Generic.List[object]
$sourceRoot=Join-Path $Project "src"
$sourceFiles=Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object { $_.Extension -in @('.ts','.tsx') }
foreach ($file in $sourceFiles) {
    $lines=[System.IO.File]::ReadAllLines($file.FullName,[System.Text.Encoding]::UTF8)
    $relative=$file.FullName.Substring($Project.Length).TrimStart([char[]]@('\','/'))
    for ($i=0; $i -lt $lines.Length; $i++) {
        $text=$lines[$i].Trim()
        foreach ($entry in $patterns.GetEnumerator()) {
            if ($lines[$i] -match $entry.Value) {
                $snippet=$text
                if ($snippet.Length -gt 400) { $snippet=$snippet.Substring(0,400) }
                $rows.Add([PSCustomObject]@{
                    Kind=$entry.Key
                    File=$relative
                    Line=$i+1
                    Text=$snippet
                })
            }
        }
    }
}

if ($rows.Count -gt 0) {
    $rows | Sort-Object Kind,File,Line | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8
} else {
    'Kind,File,Line,Text' | Set-Content -LiteralPath $csvPath -Encoding UTF8
}

$summaryLines=@()
if ($rows.Count -gt 0) {
    $summaryLines=$rows | Group-Object Kind | Sort-Object Name | ForEach-Object { "$($_.Name)|$($_.Count)" }
}
$sourceSummary=if ($summaryLines.Count -gt 0) { $summaryLines -join "`r`n" } else { '(no matching source usage)' }

$status=if ($bad -eq 0) { 'PASS' } else { 'REVIEW_REQUIRED' }
$unitState=if ($hasTargetUnit) { 'present' } else { 'absent' }
$report=@"
# Phase 4 - Notification Scope Inventory

Status: $status

Notification table: $notificationTable
Target Unit column: $unitState

Database target integrity:
$stats

Local source usage counts:
$sourceSummary

Source usage CSV:
$csvPath

Rules:
- This inventory is read-only against PostgreSQL and source code.
- The only writes are this report and the source-usage CSV.
- A Notification must have one valid target. Role-only rows are informational because targetRole remains valid for true broadcasts.
- Patient-specific workflow must not rely on Role as ownership or scope.
- targetUnitId being absent is expected before the additive Unit-notification cutover and does not fail this inventory.
- The source scan reads the current local worktree, including local runtime cutovers that are not yet pushed to GitHub.

Next:
- PASS: add server-side WorkItem scope policy plus additive Unit-targeted Notification support, then cut patient-specific referral notifications away from Role targeting.
- REVIEW_REQUIRED: repair only malformed Notification target rows before changing Notification schema or routing.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host "Notification table: $notificationTable"
Write-Host "Target Unit column: $unitState"
Write-Host "Notification source CSV: $csvPath"
Write-Host "Report: $reportPath"
Write-Host ""
Write-Host $stats
Write-Host ""
Write-Host "Source usage counts:"
Write-Host $sourceSummary
Write-Host ""
if ($status -eq 'PASS') {
    Write-Host "======================================"
    Write-Host "PHASE 4 NOTIFICATION SCOPE INVENTORY: PASS"
    Write-Host "======================================"
} else {
    Write-Host "==============================================="
    Write-Host "PHASE 4 NOTIFICATION SCOPE INVENTORY: REVIEW_REQUIRED"
    Write-Host "==============================================="
}
