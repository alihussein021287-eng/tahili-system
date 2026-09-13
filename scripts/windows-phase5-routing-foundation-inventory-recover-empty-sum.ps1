$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

$target = Join-Path $PSScriptRoot "windows-phase5-routing-foundation-inventory.ps1"
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Target inventory helper missing: $target" }

Write-Host ""
Write-Host "=== PHASE 5C ROUTING FOUNDATION INVENTORY RECOVERY: EMPTY SUM ==="
Write-Host "Project: $Project"

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$recoveryDir = Join-Path (Split-Path -Parent $Project) ".secrets\phase5-routing-foundation-empty-sum-recovery\$stamp"
New-Item -ItemType Directory -Force -Path $recoveryDir | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $recoveryDir "windows-phase5-routing-foundation-inventory.ps1.before") -Force

$text = [System.IO.File]::ReadAllText($target,[System.Text.Encoding]::UTF8).Replace("`r`n","`n")
$old = @'
$summary = foreach ($entry in $patterns.GetEnumerator()) {
    $rows=@($detail | Where-Object Pattern -eq $entry.Key)
    [pscustomobject]@{
        Pattern=$entry.Key
        Files=$rows.Count
        Hits=($rows | Measure-Object -Property Hits -Sum).Sum
    }
}
'@
$new = @'
$summary = foreach ($entry in $patterns.GetEnumerator()) {
    $rows=@($detail | Where-Object Pattern -eq $entry.Key)
    $hitTotal=0
    foreach ($item in $rows) { $hitTotal += [int]$item.Hits }
    [pscustomobject]@{
        Pattern=$entry.Key
        Files=$rows.Count
        Hits=$hitTotal
    }
}
'@
$old=$old.Replace("`r`n","`n")
$new=$new.Replace("`r`n","`n")
if ($text.Contains($old)) {
    $text=$text.Replace($old,$new)
    Write-Host "Empty-summary Sum bug: PATCHED"
} elseif ($text.Contains('Hits=$hitTotal')) {
    Write-Host "Empty-summary Sum bug: ALREADY PATCHED"
} else {
    throw "Expected summary block not found. Stop for review."
}

$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($target,$text,$utf8Bom)

$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($target,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host $_.Message }
    throw "PowerShell parser check failed after empty-summary recovery."
}
Write-Host "PowerShell parser check: PASS"
Write-Host "Recovery snapshot: $recoveryDir"
Write-Host ""
Write-Host "=== RESUME PHASE 5C ROUTING FOUNDATION INVENTORY ==="
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $target
if ($LASTEXITCODE -ne 0) { throw "Recovered Phase 5C routing foundation inventory failed with exit code $LASTEXITCODE." }
