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

function Wait-LoginSmoke {
    param([int]$Seconds=120)
    $deadline=(Get-Date).AddSeconds($Seconds)
    $last=""
    while ((Get-Date) -lt $deadline) {
        $old=$ErrorActionPreference
        try {
            $ErrorActionPreference="Continue"
            $last=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 10 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
            $code=$LASTEXITCODE
        } finally {
            $ErrorActionPreference=$old
        }
        if ($code -eq 0 -and $last -match '^\d{3}$') {
            $n=[int]$last
            if ($n -ge 200 -and $n -lt 400) { return $n }
        }
        Start-Sleep -Seconds 3
    }
    throw "Login smoke failed. Last result: $last"
}

function Require-ReportStatus {
    param([string]$RelativePath,[string]$Expected,[string]$Label)
    $path=Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label report missing: $path" }
    $text=[System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch ("(?mi)^Status:\s*" + [regex]::Escape($Expected) + "\s*$")) { throw "$Label status is not $Expected." }
}

function Get-TreeHash {
    param([string]$Root)
    $rows=New-Object System.Collections.Generic.List[string]
    Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel=$_.FullName.Substring($Project.Length+1).Replace('/','\')
        $rows.Add("$rel|$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)")
    }
    return ($rows -join "`n")
}

Write-Host ""
Write-Host "============================================================"
Write-Host "TAHILI FULL AUTO LOCAL - SAFE CONTINUATION"
Write-Host "============================================================"
Write-Host "Project: $Project"
Write-Host "CareStage destructive cleanup: deferred by safety gate"
Write-Host "Original live server: untouched"

Require-ReportStatus "_PHASE01_AUDIT\49-PHASE6-EMPLOYEE-FINAL-RUNTIME-GATE.md" "PASS" "Employee final runtime gate"
Require-ReportStatus "_PHASE01_AUDIT\50-PHASE6-CARESTAGE-DEPENDENCY-INVENTORY.md" "PASS" "CareStage inventory"
Require-ReportStatus "_PHASE01_AUDIT\51-PHASE6-CARESTAGE-AUTO-CLEANUP-READINESS.md" "BLOCKED" "CareStage cleanup readiness"

$csvPath=Join-Path $Project "_PHASE01_AUDIT\50-PHASE6-CARESTAGE-DEPENDENCY-SOURCE.csv"
if (-not (Test-Path -LiteralPath $csvPath -PathType Leaf)) { throw "CareStage dependency CSV missing." }

Invoke-NativeCapture "docker" @("info") | Out-Null
$srcBefore=Get-TreeHash (Join-Path $Project "src")
$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schemaHashBefore=(Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash

Write-Host ""
Write-Host "=== DEFERRED CARESTAGE BLOCKERS ==="
$rows=@(Import-Csv -LiteralPath $csvPath)
$deferredLines=New-Object System.Collections.Generic.List[string]
foreach ($cat in @('PRISMA_CARESTAGE','CARESTAGE_ID','RESPONSIBLE_ROLE','TARGET_ROLE')) {
    $m=@($rows | Where-Object { $_.Category -eq $cat })
    if ($m.Count -gt 0) {
        $hits=0
        foreach ($x in $m) { $hits += [int]$x.Hits }
        $files=($m | Select-Object -ExpandProperty File -Unique | Sort-Object) -join ', '
        $line="$cat files=$($m.Count) hits=$hits :: $files"
        Write-Host $line
        $deferredLines.Add($line)
    }
}

Write-Host ""
Write-Host "=== DETERMINISTIC FINAL VERIFICATION ==="
$build=Invoke-ComposeCapture @("--profile","checks","build","checks")
if ($build) { Write-Host $build }
foreach ($cmd in @(
    @("npx","prisma","validate","--schema","prisma/schema.prisma"),
    @("npx","prisma","generate","--schema","prisma/schema.prisma"),
    @("npx","tsc","--noEmit"),
    @("npx","vitest","run"),
    @("npm","run","build")
)) {
    $out=Invoke-ComposeCapture (@("--profile","checks","run","--rm","--no-deps","checks") + $cmd)
    if ($out) { Write-Host $out }
}

$status=Invoke-ComposeCapture @("exec","-T","app","npx","prisma","migrate","status")
Write-Host $status
if ($status -notmatch 'Database schema is up to date!') { throw "Runtime Prisma migration status failed." }

$http=Wait-LoginSmoke 120
Write-Host "Login smoke: PASS (HTTP $http)"
$logs=Invoke-ComposeCapture @("logs","--since","3m","app")
$fatal=@($logs -split "`r?`n" | Where-Object { $_ -match '(?i)uncaught|unhandled rejection|prisma.*error|fatal error' })
if ($fatal.Count -gt 0) { throw "Runtime fatal-log gate failed.`n$($fatal -join "`n")" }
Write-Host "Runtime fatal-log gate: PASS"

$schema=[System.IO.File]::ReadAllText($schemaPath,[System.Text.Encoding]::UTF8)
$srcFiles=Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
$allText=($srcFiles | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName,[System.Text.Encoding]::UTF8) }) -join "`n"

$employeeHits=[regex]::Matches($allText,'prisma\.employee\b').Count
$careStageHits=[regex]::Matches($allText,'prisma\.careStage\b').Count
$pathwayHits=[regex]::Matches($allText,'\bPATHWAY_DEFAULT\b').Count
$taskRoleHits=[regex]::Matches($allText,'\bassignedRole\b').Count
$targetRoleHits=[regex]::Matches($allText,'\btargetRole\b').Count
$collaborationHits=[regex]::Matches($schema + "`n" + $allText,'\bCollaboration(File|Quota|QuotaTarget)?\b').Count

if ($employeeHits -ne 0) { throw "Employee operational Prisma references returned: $employeeHits" }
if ($pathwayHits -ne 0) { throw "PATHWAY_DEFAULT source references remain unexpectedly: $pathwayHits" }
if ($careStageHits -le 0) { throw "CareStage was marked deferred but no prisma.careStage references remain. Re-run the normal cleanup gate instead." }

if ((Get-TreeHash (Join-Path $Project "src")) -ne $srcBefore) { throw "Source write guard failed." }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath).Hash -ne $schemaHashBefore) { throw "Schema write guard failed." }
Write-Host "Source/schema write guard: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "54-FULL-AUTO-LOCAL-DEFERRED-FINAL-GATE.md"
$report=@"
# Full Auto Local - Deferred Final Gate

Status: PASS_WITH_DEFERRED_DOMAIN_ITEMS

Completed deterministic cleanup:
- Legacy Employee cleanup is complete.
- Employee operational Prisma references: $employeeHits.
- PATHWAY_DEFAULT source hits: $pathwayHits.
- Prisma validate/generate PASS.
- TypeScript, Vitest, and production build PASS.
- Runtime migration status: up to date.
- Login smoke: PASS (HTTP $http).
- Runtime fatal-log gate: PASS.
- Source/schema write guards: PASS.

Deferred by explicit domain-safety rules:
- CareStage operational Prisma references: $careStageHits.
- Task assignedRole hits: $taskRoleHits.
- Notification targetRole hits: $targetRoleHits.
- Collaboration-related schema/source hits: $collaborationHits.

CareStage blocker details:
$($deferredLines -join "`r`n")

Decision:
- Do not drop CareStage or StageStatus while operational CareStage/responsibleRole dependencies remain.
- Do not fabricate User/Unit ownership from Role, station names, labels, or the first available user.
- Patient-specific routing requires an actual User or Unit destination.
- Task ownership and Collaboration remain separate reviews.
- Historical migrations were not edited.
- prisma db push was not used.
- Original live server untouched.

Result:
The automatic pipeline completed every deterministic cleanup and verification step that is currently safe. Remaining items are deferred domain decisions, not automation failures.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "============================================================"
Write-Host "FULL AUTO LOCAL: PASS WITH DEFERRED DOMAIN ITEMS"
Write-Host "============================================================"
Write-Host "Report: $reportPath"
Write-Host "CareStage was preserved intentionally; no destructive CareStage change was made."
Write-Host "Original live server untouched."
