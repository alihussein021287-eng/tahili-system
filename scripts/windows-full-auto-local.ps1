$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Invoke-ChildScript {
    param([Parameter(Mandatory=$true)][string]$RelativePath)
    $path=Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required automation script missing: $path" }
    Write-Host ""
    Write-Host "============================================================"
    Write-Host "AUTO STEP: $RelativePath"
    Write-Host "============================================================"
    $old=$ErrorActionPreference
    try {
        $ErrorActionPreference="Continue"
        $childOutput=@(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $path 2>&1)
        $code=[int]$LASTEXITCODE
    } finally {
        $ErrorActionPreference=$old
    }
    if ($childOutput.Count -gt 0) { $childOutput | Out-Host }
    return [int]$code
}

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

function Write-AutoSummary {
    param([string]$Status,[string[]]$Lines)
    $auditDir=Join-Path $Project "_PHASE01_AUDIT"
    New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
    $path=Join-Path $auditDir "53-FULL-AUTO-LOCAL-SUMMARY.md"
    $body="# Full Auto Local Orchestrator`r`n`r`nStatus: $Status`r`n`r`n"
    foreach ($line in $Lines) { $body += "- $line`r`n" }
    $body += "`r`nSafety:`r`n- Runs only against the isolated local compose project tahili-saif-dev.`r`n- Original live server untouched.`r`n- Historical Prisma migrations are not edited.`r`n- prisma db push is not used.`r`n- Destructive work is allowed only after deterministic guards and fresh backup/restore proof.`r`n- Domain/ownership ambiguity stops automation instead of guessing.`r`n"
    [System.IO.File]::WriteAllText($path,$body,(New-Object System.Text.UTF8Encoding($true)))
    Write-Host "Auto summary: $path"
}

Write-Host ""
Write-Host "============================================================"
Write-Host "TAHILI FULL AUTO LOCAL"
Write-Host "============================================================"
Write-Host "Project: $Project"
Write-Host "Mode: isolated local clone only"
Write-Host "Original live server: untouched"

$required=@(
    ".env.saif-dev",
    "docker-compose.saif-dev.yml",
    "prisma\schema.prisma",
    "_PHASE01_AUDIT\49-PHASE6-EMPLOYEE-FINAL-RUNTIME-GATE.md"
)
foreach ($r in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Project $r))) { throw "Required prerequisite missing: $r" }
}
Invoke-NativeCapture "docker" @("info") | Out-Null

$inventoryCode=Invoke-ChildScript "scripts\windows-phase6-carestage-dependency-inventory.ps1"
if ($inventoryCode -ne 0) {
    Write-AutoSummary "FAILED" @("CareStage dependency inventory failed with exit code $inventoryCode.","Automation stopped before destructive CareStage work.")
    exit $inventoryCode
}

$cleanupCode=Invoke-ChildScript "scripts\windows-phase6-carestage-auto-cleanup.ps1"
if ($cleanupCode -eq 20) {
    $csv=Join-Path $Project "_PHASE01_AUDIT\50-PHASE6-CARESTAGE-DEPENDENCY-SOURCE.csv"
    $details=New-Object System.Collections.Generic.List[string]
    $details.Add("CareStage inventory completed successfully.")
    $details.Add("CareStage destructive cleanup was blocked safely because active semantic/runtime dependencies remain.")
    if (Test-Path -LiteralPath $csv) {
        $rows=@(Import-Csv -LiteralPath $csv)
        foreach ($cat in @('PRISMA_CARESTAGE','CARESTAGE_ID','CARESTAGE_TYPE','STAGE_STATUS','PATHWAY_DEFAULT','RESPONSIBLE_ROLE')) {
            $m=@($rows | Where-Object { $_.Category -eq $cat })
            if ($m.Count -gt 0) {
                $hits=0
                foreach ($x in $m) { $hits += [int]$x.Hits }
                $details.Add("$cat files=$($m.Count) hits=$hits")
            }
        }
    }
    $details.Add("No automatic ownership mapping was fabricated from Role, names, stations, or labels.")
    $details.Add("Employee cleanup remains complete.")
    Write-AutoSummary "BLOCKED_SAFE" @($details)
    Write-Host ""
    Write-Host "FULL AUTO LOCAL STOPPED AT A REAL DOMAIN SAFETY BOUNDARY."
    Write-Host "No destructive CareStage change was made."
    exit 20
}
if ($cleanupCode -ne 0) {
    Write-AutoSummary "FAILED" @("CareStage auto cleanup failed with exit code $cleanupCode.","Do not rerun blindly if the child output says destructive apply had started.")
    exit $cleanupCode
}

Write-Host ""
Write-Host "=== FINAL AUTOMATED VERIFICATION ==="
$Compose=@("compose","-p","tahili-saif-dev","--env-file",".env.saif-dev","-f","docker-compose.saif-dev.yml")
function Invoke-ComposeCapture {
    param([Parameter(Mandatory=$true)][string[]]$Arguments)
    return Invoke-NativeCapture "docker" @($Compose + $Arguments)
}

$checksBuild=Invoke-ComposeCapture @("--profile","checks","build","checks")
if ($checksBuild) { Write-Host $checksBuild }
foreach ($cmd in @(
    @("npx","prisma","validate","--schema","prisma/schema.prisma"),
    @("npx","prisma","generate","--schema","prisma/schema.prisma"),
    @("npx","tsc","--noEmit"),
    @("npx","vitest","run"),
    @("npm","run","build")
)) {
    $o=Invoke-ComposeCapture (@("--profile","checks","run","--rm","--no-deps","checks") + $cmd)
    if ($o) { Write-Host $o }
}
$status=Invoke-ComposeCapture @("exec","-T","app","npx","prisma","migrate","status")
Write-Host $status
if ($status -notmatch 'Database schema is up to date!') { throw "Final Prisma migration status failed." }
$http=Wait-LoginSmoke 120
Write-Host "Final login smoke: PASS (HTTP $http)"
$logs=Invoke-ComposeCapture @("logs","--since","3m","app")
$fatal=@($logs -split "`r?`n" | Where-Object { $_ -match '(?i)uncaught|unhandled rejection|prisma.*error|fatal error' })
if ($fatal.Count -gt 0) { throw "Final runtime fatal-log gate failed.`n$($fatal -join "`n")" }
Write-Host "Final runtime fatal-log gate: PASS"

$schema=[System.IO.File]::ReadAllText((Join-Path $Project "prisma\schema.prisma"),[System.Text.Encoding]::UTF8)
$srcFiles=Get-ChildItem -LiteralPath (Join-Path $Project "src") -Recurse -File -Include *.ts,*.tsx
$allText=($srcFiles | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName,[System.Text.Encoding]::UTF8) }) -join "`n"
$legacyEmployee=[regex]::Matches($allText,'prisma\.employee\b').Count
$legacyCareStage=[regex]::Matches($allText,'prisma\.careStage\b').Count
$pathway=[regex]::Matches($allText,'\bPATHWAY_DEFAULT\b').Count
$taskRole=[regex]::Matches($allText,'\bassignedRole\b').Count
$targetRole=[regex]::Matches($allText,'\btargetRole\b').Count
$collaboration=[regex]::Matches($schema + "`n" + $allText,'\bCollaboration(File|Quota|QuotaTarget)?\b').Count

$summary=New-Object System.Collections.Generic.List[string]
$summary.Add("Employee legacy operational Prisma references: $legacyEmployee.")
$summary.Add("CareStage legacy operational Prisma references: $legacyCareStage.")
$summary.Add("PATHWAY_DEFAULT source hits: $pathway.")
$summary.Add("Task assignedRole hits: $taskRole (separate Task ownership review; not auto-mapped).")
$summary.Add("Notification targetRole hits: $targetRole (true broadcasts may remain; patient-specific role routing requires explicit destination).")
$summary.Add("Collaboration-related schema/source hits: $collaboration (frozen pending proof/disposition).")
$summary.Add("Prisma validate/generate, TypeScript, Vitest, production build, migration status, login smoke, and runtime log gate passed.")

$deferred=($taskRole -gt 0 -or $targetRole -gt 0 -or $collaboration -gt 0)
if ($legacyEmployee -ne 0 -or $legacyCareStage -ne 0 -or $pathway -ne 0) {
    Write-AutoSummary "FAILED" @($summary)
    throw "Legacy operational cleanup assertions remain after auto pipeline."
}
if ($deferred) {
    Write-AutoSummary "PASS_WITH_DEFERRED_DOMAIN_ITEMS" @($summary)
    Write-Host ""
    Write-Host "FULL AUTO LOCAL: PASS FOR DETERMINISTIC CLEANUP"
    Write-Host "Deferred domain items remain intentionally frozen for explicit ownership/routing decisions."
    exit 0
}

Write-AutoSummary "PASS" @($summary)
Write-Host ""
Write-Host "FULL AUTO LOCAL: PASS"
