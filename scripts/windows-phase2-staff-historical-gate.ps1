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

function Invoke-PsqlCsv {
    param([Parameter(Mandatory = $true)][string]$Sql,[Parameter(Mandatory = $true)][string]$Path)
    $args = $Compose + @(
        "exec", "-T", "postgres",
        "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", $script:dbUser,
        "-d", $script:dbName,
        "-q"
    )
    $output = $Sql | & docker @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql CSV export failed.`n$($output | Out-String)" }
    [System.IO.File]::WriteAllLines($Path, [string[]]$output, (New-Object System.Text.UTF8Encoding($true)))
}

function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
    return $path
}

Write-Host ""
Write-Host "=== PHASE 2 STAFF HISTORICAL LINKAGE GATE ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\10-PHASE2-STAFF-UNIT-FOUNDATION.md" "Phase 2 foundation" | Out-Null
Test-PassReport "_PHASE01_AUDIT\11-PHASE2-STAFF-OPERATIONAL-IDS.md" "Phase 2 operational IDs" | Out-Null
Test-PassReport "_PHASE01_AUDIT\12-PHASE2-STAFF-CODE-CUTOVER.md" "Phase 2 code cutover" | Out-Null
Write-Host "Prerequisite reports: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml")) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$envMap = @{}
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
if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres")))) { throw "Local PostgreSQL container is not running." }

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$csvPath=Join-Path $auditDir "13-PHASE2-STAFF-HISTORICAL-UNLINKED.csv"
$reportPath=Join-Path $auditDir "13-PHASE2-STAFF-HISTORICAL-GATE.md"

$summarySql=@'
SELECT 'Attendance' AS k, count(*) AS total, count(*) FILTER (WHERE "staffMemberId" IS NOT NULL) AS linked, count(*) FILTER (WHERE "staffMemberId" IS NULL) AS unlinked FROM "Attendance"
UNION ALL
SELECT 'Shift', count(*), count(*) FILTER (WHERE "staffMemberId" IS NOT NULL), count(*) FILTER (WHERE "staffMemberId" IS NULL) FROM "Shift"
UNION ALL
SELECT 'Leave', count(*), count(*) FILTER (WHERE "staffMemberId" IS NOT NULL), count(*) FILTER (WHERE "staffMemberId" IS NULL) FROM "Leave"
ORDER BY 1;
'@
$summary=Invoke-PsqlText $summarySql

$orphanSql=@'
SELECT 'Attendance', count(*) FROM "Attendance" x LEFT JOIN "staff_members" s ON s."id"=x."staffMemberId" WHERE x."staffMemberId" IS NOT NULL AND s."id" IS NULL
UNION ALL SELECT 'Shift', count(*) FROM "Shift" x LEFT JOIN "staff_members" s ON s."id"=x."staffMemberId" WHERE x."staffMemberId" IS NOT NULL AND s."id" IS NULL
UNION ALL SELECT 'Leave', count(*) FROM "Leave" x LEFT JOIN "staff_members" s ON s."id"=x."staffMemberId" WHERE x."staffMemberId" IS NOT NULL AND s."id" IS NULL
ORDER BY 1;
'@
$orphans=Invoke-PsqlText $orphanSql
$orphanTotal=0
foreach ($line in ($orphans -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2) { throw "Unexpected orphan result: $line" }
    $orphanTotal += [int64]$p[1]
}
if ($orphanTotal -ne 0) { throw "Historical staff linkage has UUID orphans. Stop before Phase 3." }

$missedSql=@'
WITH unique_staff AS (
  SELECT lower(btrim("fullName")) AS k
  FROM "staff_members"
  WHERE NULLIF(btrim("fullName"),'') IS NOT NULL
  GROUP BY lower(btrim("fullName"))
  HAVING count(*)=1
), missed AS (
  SELECT 1 FROM "Attendance" x JOIN unique_staff u ON u.k=lower(btrim(x."name")) WHERE x."staffMemberId" IS NULL AND NULLIF(btrim(x."name"),'') IS NOT NULL
  UNION ALL
  SELECT 1 FROM "Shift" x JOIN unique_staff u ON u.k=lower(btrim(x."name")) WHERE x."staffMemberId" IS NULL AND NULLIF(btrim(x."name"),'') IS NOT NULL
  UNION ALL
  SELECT 1 FROM "Leave" x JOIN unique_staff u ON u.k=lower(btrim(x."name")) WHERE x."staffMemberId" IS NULL AND NULLIF(btrim(x."name"),'') IS NOT NULL
)
SELECT count(*) FROM missed;
'@
$deterministicMissed=[int64](Invoke-PsqlText $missedSql)
if ($deterministicMissed -ne 0) { throw "Found $deterministicMissed historical rows with a unique StaffMember match but NULL staffMemberId. Stop for repair." }

$unlinkedSql=@'
SELECT
  (SELECT count(*) FROM "Attendance" WHERE "staffMemberId" IS NULL) +
  (SELECT count(*) FROM "Shift" WHERE "staffMemberId" IS NULL) +
  (SELECT count(*) FROM "Leave" WHERE "staffMemberId" IS NULL);
'@
$unlinkedTotal=[int64](Invoke-PsqlText $unlinkedSql)

$csvSql=@'
COPY (
  WITH rows AS (
    SELECT 'Attendance'::text AS record_type, a."id"::text AS record_id, a."name"::text AS legacy_name, a."date"::text AS event_date
    FROM "Attendance" a WHERE a."staffMemberId" IS NULL
    UNION ALL
    SELECT 'Shift', s."id"::text, s."name"::text, s."date"::text
    FROM "Shift" s WHERE s."staffMemberId" IS NULL
    UNION ALL
    SELECT 'Leave', l."id"::text, l."name"::text, (l."fromDate"::text || ' -> ' || l."toDate"::text)
    FROM "Leave" l WHERE l."staffMemberId" IS NULL
  )
  SELECT r.record_type, r.record_id, r.legacy_name, r.event_date,
         c.candidate_count,
         COALESCE(c.candidates,'') AS candidates
  FROM rows r
  LEFT JOIN LATERAL (
    SELECT count(*) AS candidate_count,
           string_agg(s."id"::text || ':' || s."fullName", ' || ' ORDER BY s."fullName") AS candidates
    FROM "staff_members" s
    WHERE NULLIF(btrim(r.legacy_name),'') IS NOT NULL
      AND lower(btrim(s."fullName"))=lower(btrim(r.legacy_name))
  ) c ON true
  ORDER BY r.record_type, r.legacy_name, r.record_id
) TO STDOUT WITH CSV HEADER;
'@
Invoke-PsqlCsv $csvSql $csvPath

$status = if ($unlinkedTotal -eq 0) { "PASS" } else { "REVIEW_REQUIRED" }
$report=@"
# Phase 2 - Staff Historical Linkage Gate

Status: $status

Summary (table|total|linked|unlinked):
$summary

UUID orphan checks:
$orphans

Deterministic unique-name rows missed by backfill: $deterministicMissed
Unlinked historical rows requiring review: $unlinkedTotal

Unlinked inventory CSV:
$csvPath

Rules:
- No historical row was guessed or auto-linked in this gate.
- A row with zero or multiple matching StaffMember identities remains unresolved.
- Existing legacy name fields remain preserved.
- No database writes were performed by this gate.

Next:
- PASS: Phase 2 is complete and Phase 3 PatientWorkItem foundation may start.
- REVIEW_REQUIRED: resolve the CSV mappings explicitly before final Phase 2 completion.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host "Historical UUID orphan check: PASS"
Write-Host "Unique deterministic missed rows: $deterministicMissed"
Write-Host "Unlinked historical rows: $unlinkedTotal"
Write-Host "CSV: $csvPath"
Write-Host "Report: $reportPath"
Write-Host ""
if ($status -eq "PASS") {
    Write-Host "======================================"
    Write-Host "PHASE 2 STAFF HISTORICAL GATE: PASS"
    Write-Host "======================================"
} else {
    Write-Host "================================================="
    Write-Host "PHASE 2 STAFF HISTORICAL GATE: REVIEW_REQUIRED"
    Write-Host "================================================="
}
