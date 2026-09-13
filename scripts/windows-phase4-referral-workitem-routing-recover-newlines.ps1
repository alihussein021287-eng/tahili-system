$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Source = Join-Path $PSScriptRoot "windows-phase4-referral-workitem-routing.ps1"
$Temp = Join-Path $PSScriptRoot (".phase4-referral-workitem-routing-fixed-" + [Guid]::NewGuid().ToString("N") + ".ps1")

Write-Host ""
Write-Host "=== PHASE 4 REFERRAL WORKITEM ROUTING - NEWLINE RECOVERY ==="

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Source routing script not found: $Source"
}

$text = [System.IO.File]::ReadAllText($Source,[System.Text.Encoding]::UTF8)
$old = @'
function Replace-Exact {
    param([string]$Text,[string]$Old,[string]$New,[string]$Label)
    if (-not $Text.Contains($Old)) { throw "Expected source block not found for $Label. Stop for review." }
    return $Text.Replace($Old,$New)
}
'@
$new = @'
function Replace-Exact {
    param([string]$Text,[string]$Old,[string]$New,[string]$Label)
    $Text = $Text.Replace("`r`n","`n")
    $Old = $Old.Replace("`r`n","`n")
    $New = $New.Replace("`r`n","`n")
    if (-not $Text.Contains($Old)) { throw "Expected source block not found for $Label. Stop for review." }
    return $Text.Replace($Old,$New)
}
'@

$textLf = $text.Replace("`r`n","`n")
$oldLf = $old.Replace("`r`n","`n")
$newLf = $new.Replace("`r`n","`n")
if (-not $textLf.Contains($oldLf)) {
    throw "Replace-Exact function shape changed. Stop for review."
}

$fixed = $textLf.Replace($oldLf,$newLf)
[System.IO.File]::WriteAllText($Temp,$fixed,(New-Object System.Text.UTF8Encoding($true)))
Write-Host "Line-ending normalization repair: PASS"
Write-Host "Running guarded Phase 4 routing cutover again..."

try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $Temp
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "Recovered Phase 4 routing cutover failed with exit code $code." }
}
finally {
    if (Test-Path -LiteralPath $Temp) { Remove-Item -LiteralPath $Temp -Force }
}
