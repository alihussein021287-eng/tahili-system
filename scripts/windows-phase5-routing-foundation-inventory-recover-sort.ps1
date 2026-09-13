$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

Write-Host ""
Write-Host "=== PHASE 5C ROUTING FOUNDATION INVENTORY RECOVERY: SORT ==="
Write-Host "Project: $Project"

$target = Join-Path $PSScriptRoot "windows-phase5-routing-foundation-inventory.ps1"
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Target helper missing: $target" }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupDir = Join-Path (Split-Path -Parent $Project) ".secrets\phase5-routing-foundation-sort-recovery\$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir "windows-phase5-routing-foundation-inventory.ps1.before") -Force

$text = [System.IO.File]::ReadAllText($target,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
$old = '$detail | Sort-Object Hits -Descending,File | Select-Object -First 40'
$new = '$detail | Sort-Object -Property @{ Expression = { [int]$_.Hits }; Descending = $true }, @{ Expression = { $_.File }; Descending = $false } | Select-Object -First 40'

if (-not $text.Contains($old)) {
    if ($text.Contains($new)) {
        Write-Host "Sort recovery already present."
    } else {
        throw "Expected Sort-Object parser-bug pattern was not found. Stop for review."
    }
} else {
    $text = $text.Replace($old,$new)
    [System.IO.File]::WriteAllText($target,$text,(New-Object System.Text.UTF8Encoding($true)))
    Write-Host "Sort-Object parser bug: PATCHED"
}

$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($target,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host $_.Message }
    throw "PowerShell parser check failed after recovery."
}
Write-Host "PowerShell parser check: PASS"
Write-Host "Recovery snapshot: $backupDir"
Write-Host ""
Write-Host "=== RESUME PHASE 5C ROUTING FOUNDATION INVENTORY ==="

& powershell.exe -ExecutionPolicy Bypass -File $target
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5C routing foundation inventory failed with exit code $LASTEXITCODE." }
