$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

$target = Join-Path $Project "scripts\windows-phase2-staff-code-cutover.ps1"
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Cutover script is missing: $target"
}

Write-Host ""
Write-Host "=== PHASE 2 STAFF CODE CUTOVER - SOURCE UTF-8 RECOVERY ==="

# Read/write with .NET UTF-8 explicitly. This avoids Windows PowerShell 5.1
# interpreting BOM-less UTF-8 source files as the active ANSI code page.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$text = [System.IO.File]::ReadAllText($target, [System.Text.Encoding]::UTF8)

$replacements = @(
    @('$schema = Get-Content -LiteralPath "prisma\schema.prisma" -Raw', '$schema = Get-Content -LiteralPath "prisma\schema.prisma" -Raw -Encoding UTF8'),
    @('$attendance = Get-Content -LiteralPath $attendancePath -Raw', '$attendance = Get-Content -LiteralPath $attendancePath -Raw -Encoding UTF8'),
    @('$shifts = Get-Content -LiteralPath $shiftsPath -Raw', '$shifts = Get-Content -LiteralPath $shiftsPath -Raw -Encoding UTF8'),
    @('$staff = Get-Content -LiteralPath $staffPath -Raw', '$staff = Get-Content -LiteralPath $staffPath -Raw -Encoding UTF8'),
    @('$attendanceNow = Get-Content -LiteralPath $attendancePath -Raw', '$attendanceNow = Get-Content -LiteralPath $attendancePath -Raw -Encoding UTF8'),
    @('$shiftsNow = Get-Content -LiteralPath $shiftsPath -Raw', '$shiftsNow = Get-Content -LiteralPath $shiftsPath -Raw -Encoding UTF8'),
    @('$staffNow = Get-Content -LiteralPath $staffPath -Raw', '$staffNow = Get-Content -LiteralPath $staffPath -Raw -Encoding UTF8')
)

$changed = 0
foreach ($pair in $replacements) {
    $old = $pair[0]
    $new = $pair[1]
    if ($text.Contains($new)) { continue }
    if (-not $text.Contains($old)) {
        throw "Expected cutover read expression not found: $old"
    }
    $text = $text.Replace($old, $new)
    $changed++
}

# Keep BOM on the PowerShell script itself so PS5 parses its Arabic here-strings correctly.
[System.IO.File]::WriteAllText($target, $text, $utf8Bom)
Write-Host "Explicit UTF-8 source reads patched: $changed"
Write-Host "Running cutover script again..."

& powershell -ExecutionPolicy Bypass -File $target
if ($LASTEXITCODE -ne 0) {
    throw "Phase 2 staff code cutover failed with exit code $LASTEXITCODE."
}
