$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $PSScriptRoot "windows-phase3-carestage-inventory.ps1"
$Temp = Join-Path $PSScriptRoot (".phase3-carestage-inventory-fixed-" + [Guid]::NewGuid().ToString("N") + ".ps1")

Write-Host ""
Write-Host "=== PHASE 3 CARESTAGE INVENTORY - ORDER BY RECOVERY ==="

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Source inventory script not found: $Source"
}

$text = [System.IO.File]::ReadAllText($Source, [System.Text.Encoding]::UTF8)
$needle = "ORDER BY 1,2;"
$count = ([regex]::Matches($text, [regex]::Escape($needle))).Count
if ($count -ne 2) {
    throw "Expected exactly 2 invalid ORDER BY 1,2 clauses, found $count. Stop for review."
}

$fixed = $text.Replace($needle, "ORDER BY 1;")
[System.IO.File]::WriteAllText($Temp, $fixed, (New-Object System.Text.UTF8Encoding($true)))
Write-Host "ORDER BY repair prepared: 2 clauses fixed"
Write-Host "Running read-only inventory again..."

try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $Temp
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "Recovered CareStage inventory failed with exit code $code."
    }
}
finally {
    if (Test-Path -LiteralPath $Temp) {
        Remove-Item -LiteralPath $Temp -Force
    }
}
