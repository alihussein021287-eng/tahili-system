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

function Require-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Get-Surface([string]$relative,[string]$text) {
    if ($relative -match '/app/.*/layout\.(ts|tsx)$') { return 'LAYOUT' }
    if ($relative -match '/app/.*/page\.(ts|tsx)$') { return 'PAGE' }
    if ($relative -match '/app/api/.*/route\.(ts|tsx)$') { return 'API' }
    if ($relative -match 'actions\.(ts|tsx)$' -or $text -match '(?m)^\s*["'']use server["''];?\s*$') { return 'SERVER_ACTION' }
    if ($relative -match '^src/lib/') { return 'LIB' }
    if ($relative -match '^src/components/') { return 'COMPONENT' }
    return 'OTHER'
}

Write-Host ""
Write-Host "=== PHASE 5 PRESENTATION TARGET INVENTORY ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\26-PHASE5-PRESENTATION-JOURNEY-INVENTORY.md" "Phase 5 presentation inventory"
Write-Host "Phase 5 inventory prerequisite: PASS"

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
if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres"))) -or [string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","app")))) { throw "Local Tahili stack is not running." }

$countsSql=@'
SELECT 'carestage|' || count(*) FROM "CareStage"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'notifications|' || count(*) FROM "Notification"
UNION ALL SELECT 'user_unit_memberships|' || count(*) FROM "user_unit_memberships"
ORDER BY 1;
'@
$countsBefore=Invoke-PsqlText $countsSql

$patterns=[ordered]@{
    CURRENT_CARE_STAGE='currentCareStage'
    CARE_STAGE='\bcareStage(s)?\b|\bCareStage\b'
    PATIENT_WORK_ITEM='PatientWorkItem|patientWorkItem(s)?'
    WORKITEM_SCOPE='patient-work-item-scope|canViewWorkItemScope|canClaimWorkItemScope|canActOnWorkItemScope|assertWorkItem'
    TARGET_ROLE='targetRole'
    TARGET_USER='targetUserId'
    NOTIFY_ROLE='notifyRole(InTransaction)?'
    NOTIFY_USER='notifyUser(InTransaction)?'
    NOTIFY_UNIT='notifyUnitInTransaction'
    USER_UNIT_MEMBERSHIP='userUnitMembership'
}

$rows = New-Object System.Collections.Generic.List[object]
$files=Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx -ErrorAction Stop
foreach ($f in $files) {
    $text=[System.IO.File]::ReadAllText($f.FullName,[System.Text.Encoding]::UTF8)
    $relative=$f.FullName.Substring($Project.Length+1).Replace('\','/')
    $surface=Get-Surface $relative $text
    $lines=$text.Replace("`r`n","`n").Replace("`r","`n").Split("`n")
    for ($i=0; $i -lt $lines.Length; $i++) {
        $lineText=$lines[$i]
        foreach ($entry in $patterns.GetEnumerator()) {
            if ([regex]::IsMatch($lineText,$entry.Value,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
                $trim=$lineText.Trim()
                if ($trim.Length -gt 240) { $trim=$trim.Substring(0,240) }
                $rows.Add([pscustomobject]@{
                    File=$relative
                    Surface=$surface
                    Line=$i+1
                    Pattern=$entry.Key
                    Text=$trim
                }) | Out-Null
            }
        }
    }
}

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "27-PHASE5-PRESENTATION-TARGETS.csv"
$rows | Sort-Object File,Line,Pattern | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$priorityPatterns=@('CURRENT_CARE_STAGE','CARE_STAGE','PATIENT_WORK_ITEM','WORKITEM_SCOPE','TARGET_ROLE','NOTIFY_ROLE','NOTIFY_UNIT')
$prioritySurfaces=@('PAGE','LAYOUT','SERVER_ACTION','API','LIB')
$priorityRows=@($rows | Where-Object { $_.Pattern -in $priorityPatterns -and $_.Surface -in $prioritySurfaces })

$fileGroups=@($priorityRows | Group-Object File | Sort-Object Count -Descending,Name)
$topLines=New-Object System.Collections.Generic.List[string]
$limit=[Math]::Min(30,$fileGroups.Count)
for ($i=0; $i -lt $limit; $i++) {
    $g=$fileGroups[$i]
    $patternsForFile=@($g.Group | Select-Object -ExpandProperty Pattern -Unique | Sort-Object)
    $surfaces=@($g.Group | Select-Object -ExpandProperty Surface -Unique | Sort-Object)
    $topLines.Add("- $($g.Name) :: $($surfaces -join ',') :: $($patternsForFile -join ',') :: hits=$($g.Count)") | Out-Null
}
if ($topLines.Count -eq 0) { $topLines.Add('- none') | Out-Null }

$summaryLines=New-Object System.Collections.Generic.List[string]
foreach ($key in $patterns.Keys) {
    $matches=@($rows | Where-Object Pattern -eq $key)
    $summaryLines.Add("$key|$($matches.Count)") | Out-Null
    Write-Host "$key|$($matches.Count)"
}
foreach ($surface in @('PAGE','LAYOUT','SERVER_ACTION','API','LIB','COMPONENT','OTHER')) {
    $matches=@($rows | Where-Object Surface -eq $surface)
    Write-Host "SURFACE_$surface|$($matches.Count)"
}

$countsAfter=Invoke-PsqlText $countsSql
if ($countsAfter.Trim() -ne $countsBefore.Trim()) { throw "Database row counts changed during Phase 5 target inventory." }
Write-Host "Database write guard: PASS"

$curl=Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw "curl.exe is required for login smoke." }
$httpCode=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $httpCode -notmatch '^\d{3}$') { throw "Running app login smoke failed: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$reportPath=Join-Path $auditDir "27-PHASE5-PRESENTATION-TARGET-INVENTORY.md"
$report=@"
# Phase 5 - Presentation Target Inventory

Status: PASS

Purpose:
Identify exact source files and line-level targets for the Phase 5 My Work / patient journey / notification presentation cutover, without modifying application source or database rows.

Pattern totals:
$($summaryLines -join "`n")

Top priority files:
$($topLines -join "`n")

CSV:
$csvPath

Safety:
- Read-only against application source.
- No Prisma migration created or applied.
- Core CareStage / PatientWorkItem / Notification / UserUnitMembership row counts unchanged.
- Running app login smoke PASS (HTTP $code).
- Original live server untouched.

Next:
Use this line-level inventory to split Phase 5 into small code-only cutovers. Preserve legacy CareStage as compatibility/history until its later cleanup gate; patient-specific active work remains User/Unit scoped.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "=========================================="
Write-Host "PHASE 5 PRESENTATION TARGET INVENTORY: PASS"
Write-Host "=========================================="
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "CSV: $csvPath"
