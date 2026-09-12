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

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed: docker $($Arguments -join ' ')"
    }
}

function Get-DockerText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed: docker $($Arguments -join ' ')"
    }
    return (($output | Out-String).Trim())
}

function Get-ComposeContainerId {
    param([Parameter(Mandatory = $true)][string]$Service)
    return Get-DockerText ($Compose + @("ps", "-q", $Service))
}

function Get-VolumeStats {
    param([Parameter(Mandatory = $true)][string]$Volume)

    $script = 'f=$(find /source -type f | wc -l | tr -d " "); b=$(find /source -type f -exec wc -c {} + 2>/dev/null | awk ''{s+=$1} END {print s+0}''); printf "%s|%s\n" "$f" "$b"'
    $text = Get-DockerText @(
        "run", "--rm",
        "-v", "${Volume}:/source:ro",
        "--entrypoint", "sh",
        "postgres:16-alpine",
        "-ceu", $script
    )
    $parts = $text -split '\|'
    if ($parts.Count -ne 2) { throw "Unexpected volume statistics output for $Volume" }

    return @{
        Files = [int64]$parts[0]
        Bytes = [int64]$parts[1]
    }
}

Write-Host ""
Write-Host "=== PHASE 0 LOCAL CLONE BACKUP GATE ==="
Write-Host "Project: $Project"

# Preflight
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }

foreach ($file in @(".env.saif-dev", "docker-compose.saif-dev.yml")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Required file missing: $file"
    }
}

$envMap = @{}
foreach ($line in Get-Content -LiteralPath ".env.saif-dev") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $key = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $envMap[$key] = $value
    }
}

$dbUser = $envMap["DB_USER"]
$dbName = $envMap["DB_NAME"]
if ([string]::IsNullOrWhiteSpace($dbUser) -or [string]::IsNullOrWhiteSpace($dbName)) {
    throw "DB_USER or DB_NAME is missing from .env.saif-dev"
}

$pgId = Get-ComposeContainerId "postgres"
$minioId = Get-ComposeContainerId "minio"
$appId = Get-ComposeContainerId "app"
if ([string]::IsNullOrWhiteSpace($pgId) -or [string]::IsNullOrWhiteSpace($minioId) -or [string]::IsNullOrWhiteSpace($appId)) {
    throw "Tahili local containers are not all running. Start the local stack first."
}

$minioVolume = Get-DockerText @(
    "inspect", "-f",
    '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}',
    $minioId
)
$uploadsVolume = Get-DockerText @(
    "inspect", "-f",
    '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}',
    $appId
)
if ([string]::IsNullOrWhiteSpace($minioVolume) -or [string]::IsNullOrWhiteSpace($uploadsVolume)) {
    throw "Unable to locate MinIO or uploads volume."
}

$sql = @'
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
  (SELECT count(*) FROM "_prisma_migrations"),
  (SELECT count(*) FROM pg_constraint
     WHERE contype = 'f'
       AND connamespace = 'public'::regnamespace);
'@

$dbMetrics = Get-DockerText ($Compose + @(
    "exec", "-T", "postgres",
    "psql", "-U", $dbUser, "-d", $dbName, "-Atqc", $sql
))
$dbParts = $dbMetrics -split '\|'
if ($dbParts.Count -ne 3) { throw "Unexpected source database metrics: $dbMetrics" }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupRoot = Join-Path $Project ".secrets\phase0-backups"
$backupDir = Join-Path $backupRoot "phase0-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Write-Host ""
Write-Host "=== BACKUP ==="
Write-Host "Backup directory: $backupDir"

# PostgreSQL custom-format dump
Invoke-Docker ($Compose + @(
    "exec", "-T", "postgres",
    "pg_dump", "-U", $dbUser, "-d", $dbName,
    "-Fc", "-f", "/tmp/tahili-phase0.dump"
))
try {
    Invoke-Docker @("cp", "${pgId}:/tmp/tahili-phase0.dump", (Join-Path $backupDir "postgres.dump"))
}
finally {
    & docker @($Compose + @("exec", "-T", "postgres", "rm", "-f", "/tmp/tahili-phase0.dump")) *> $null
}

# MinIO and uploads volume archives
Invoke-Docker @(
    "run", "--rm",
    "-v", "${minioVolume}:/source:ro",
    "-v", "${backupDir}:/backup",
    "--entrypoint", "sh",
    "postgres:16-alpine",
    "-ceu", "tar -C /source -czf /backup/minio.tar.gz ."
)
Invoke-Docker @(
    "run", "--rm",
    "-v", "${uploadsVolume}:/source:ro",
    "-v", "${backupDir}:/backup",
    "--entrypoint", "sh",
    "postgres:16-alpine",
    "-ceu", "tar -C /source -czf /backup/uploads.tar.gz ."
)

$minioStats = Get-VolumeStats $minioVolume
$uploadsStats = Get-VolumeStats $uploadsVolume

$manifest = [ordered]@{
    format = 1
    createdAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    database = [ordered]@{
        tables = [int]$dbParts[0]
        migrations = [int]$dbParts[1]
        foreignKeys = [int]$dbParts[2]
    }
    minio = [ordered]@{
        files = $minioStats.Files
        bytes = $minioStats.Bytes
    }
    uploads = [ordered]@{
        files = $uploadsStats.Files
        bytes = $uploadsStats.Bytes
    }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backupDir "manifest.json") -Encoding UTF8

$hashFiles = @("postgres.dump", "minio.tar.gz", "uploads.tar.gz", "manifest.json")
$hashLines = foreach ($file in $hashFiles) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $backupDir $file) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $file"
}
$hashLines | Set-Content -LiteralPath (Join-Path $backupDir "SHA256SUMS") -Encoding ASCII

Write-Host ""
Write-Host "=== VERIFY BACKUP ==="
foreach ($line in Get-Content -LiteralPath (Join-Path $backupDir "SHA256SUMS")) {
    if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw "Invalid SHA256SUMS format." }
    $expected = $Matches[1]
    $file = $Matches[2]
    $actual = (Get-FileHash -LiteralPath (Join-Path $backupDir $file) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Checksum mismatch: $file" }
}
Invoke-Docker @(
    "run", "--rm",
    "-v", "${backupDir}:/backup:ro",
    "--entrypoint", "sh",
    "postgres:16-alpine",
    "-ceu", "pg_restore -l /backup/postgres.dump >/dev/null"
)
Invoke-Docker @(
    "run", "--rm",
    "-v", "${backupDir}:/backup:ro",
    "--entrypoint", "sh",
    "postgres:16-alpine",
    "-ceu", "tar -tzf /backup/minio.tar.gz >/dev/null && tar -tzf /backup/uploads.tar.gz >/dev/null"
)
Write-Host "Backup verification: PASS"

Write-Host ""
Write-Host "=== ISOLATED RESTORE DRILL ==="
$safeStamp = $stamp.ToLowerInvariant()
$network = "tahili-phase0-$safeStamp-net"
$dbVolume = "tahili-phase0-$safeStamp-db"
$minioRestore = "tahili-phase0-$safeStamp-minio"
$uploadsRestore = "tahili-phase0-$safeStamp-uploads"
$restoreDb = "tahili-phase0-$safeStamp-postgres"

try {
    Invoke-Docker @("network", "create", "--internal", $network)
    Invoke-Docker @("volume", "create", $dbVolume)
    Invoke-Docker @("volume", "create", $minioRestore)
    Invoke-Docker @("volume", "create", $uploadsRestore)

    Invoke-Docker @(
        "run", "-d",
        "--name", $restoreDb,
        "--network", $network,
        "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
        "-e", "POSTGRES_DB=restore",
        "-v", "${dbVolume}:/var/lib/postgresql/data",
        "postgres:16-alpine"
    )

    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        & docker run --rm --network $network --entrypoint pg_isready postgres:16-alpine -h $restoreDb -U postgres -d restore *> $null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Restore PostgreSQL did not become ready." }

    Invoke-Docker @(
        "run", "--rm",
        "--network", $network,
        "-v", "${backupDir}:/backup:ro",
        "--entrypoint", "pg_restore",
        "postgres:16-alpine",
        "--exit-on-error", "--no-owner", "--no-privileges",
        "-h", $restoreDb, "-U", "postgres", "-d", "restore",
        "/backup/postgres.dump"
    )

    Invoke-Docker @(
        "run", "--rm",
        "-v", "${backupDir}:/backup:ro",
        "-v", "${minioRestore}:/restore",
        "--entrypoint", "sh",
        "postgres:16-alpine",
        "-ceu", "tar -xzf /backup/minio.tar.gz -C /restore"
    )
    Invoke-Docker @(
        "run", "--rm",
        "-v", "${backupDir}:/backup:ro",
        "-v", "${uploadsRestore}:/restore",
        "--entrypoint", "sh",
        "postgres:16-alpine",
        "-ceu", "tar -xzf /backup/uploads.tar.gz -C /restore"
    )

    $restoredDbMetrics = Get-DockerText @(
        "run", "--rm",
        "--network", $network,
        "postgres:16-alpine",
        "psql", "-h", $restoreDb, "-U", "postgres", "-d", "restore", "-Atqc", $sql
    )
    if ($restoredDbMetrics.Trim() -ne $dbMetrics.Trim()) {
        throw "Database aggregate comparison failed. Source=$dbMetrics Restored=$restoredDbMetrics"
    }

    $restoredMinio = Get-VolumeStats $minioRestore
    $restoredUploads = Get-VolumeStats $uploadsRestore
    if ($restoredMinio.Files -ne $minioStats.Files -or $restoredMinio.Bytes -ne $minioStats.Bytes) {
        throw "MinIO restore comparison failed."
    }
    if ($restoredUploads.Files -ne $uploadsStats.Files -or $restoredUploads.Bytes -ne $uploadsStats.Bytes) {
        throw "Uploads restore comparison failed."
    }

    Write-Host "Isolated restore drill: PASS"

    $auditDir = Join-Path $Project "_PHASE01_AUDIT"
    New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
    $audit = Join-Path $auditDir "05-PHASE0-LOCAL-CLONE-BACKUP.md"
    $report = @"
# Phase 0 - Local Production Clone Backup Gate

Status: PASS

Backup: `$backupDir

PostgreSQL:
- Tables: $($dbParts[0])
- Prisma migrations: $($dbParts[1])
- Foreign keys: $($dbParts[2])

MinIO:
- Files: $($minioStats.Files)
- Bytes: $($minioStats.Bytes)

Uploads:
- Files: $($uploadsStats.Files)
- Bytes: $($uploadsStats.Bytes)

Verification:
- SHA256: PASS
- PostgreSQL archive: PASS
- MinIO archive: PASS
- Uploads archive: PASS

Isolated restore:
- PostgreSQL aggregate comparison: PASS
- MinIO aggregate comparison: PASS
- Uploads aggregate comparison: PASS

The local production clone remained running during backup and verification.
No prisma db push was used.
No source volume was modified.
"@
    $report | Set-Content -LiteralPath $audit -Encoding UTF8

    Write-Host ""
    Write-Host "======================================"
    Write-Host "PHASE 0 BACKUP GATE: PASS"
    Write-Host "======================================"
    Write-Host "Backup: $backupDir"
    Write-Host "Report: $audit"
}
finally {
    & docker rm -f $restoreDb *> $null
    & docker network rm $network *> $null
    & docker volume rm $dbVolume $minioRestore $uploadsRestore *> $null
}
