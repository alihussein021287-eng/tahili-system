$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5 TARGET INVENTORY RECOVERY: SORT SYNTAX ==="
Write-Host "Project: $Project"

$targetPath = Join-Path $Project "scripts\windows-phase5-presentation-target-inventory.ps1"
if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { throw "Target inventory script missing: $targetPath" }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase5-presentation-target-sort-recovery" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $targetPath -Destination (Join-Path $rollbackDir "windows-phase5-presentation-target-inventory.ps1.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text=[System.IO.File]::ReadAllText($targetPath,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")

$old='$fileGroups=@($priorityRows | Group-Object File | Sort-Object Count -Descending,Name)'
$new='$fileGroups=@($priorityRows | Group-Object File | Sort-Object -Property @{Expression="Count";Descending=$true}, @{Expression="Name";Descending=$false})'

if ($text.Contains($old)) {
    $text=$text.Replace($old,$new)
    [System.IO.File]::WriteAllText($targetPath,$text,$utf8NoBom)
    Write-Host "Priority file sort syntax: RECOVERED"
} elseif ($text.Contains($new)) {
    Write-Host "Priority file sort syntax: already recovered"
} else {
    throw "Target inventory sort line is not in expected pre/post recovery form. Stop for review."
}

$tokens=$null
$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($targetPath,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) {
    $detail=($errors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n"
    throw "Recovered target inventory parser validation failed:`n$detail"
}
Write-Host "PowerShell parser check: PASS"

Write-Host ""
Write-Host "=== RESUME PHASE 5 PRESENTATION TARGET INVENTORY ==="
& powershell -ExecutionPolicy Bypass -File $targetPath
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5 presentation target inventory failed with exit code $LASTEXITCODE." }
