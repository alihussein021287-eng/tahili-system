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
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: docker $($Arguments -join ' ')" }
}

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Invoke-Docker ($Compose + $Arguments)
}

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

function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = Get-Content -LiteralPath $path -Raw
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
    return $path
}

function Add-LineAfterField {
    param([string]$SchemaText,[string]$ModelName,[string]$AfterField,[string]$NewField,[string]$NewLine)
    $pattern = "(?ms)(model\s+$([regex]::Escape($ModelName))\s*\{.*?^\})"
    $match = [regex]::Match($SchemaText, $pattern)
    if (-not $match.Success) { throw "Model not found: $ModelName" }
    $block = $match.Groups[1].Value
    if ($block -match "(?m)^\s*$([regex]::Escape($NewField))\s+") { return $SchemaText }
    $lines = $block -split "`r?`n"
    $out = New-Object System.Collections.Generic.List[string]
    $inserted = $false
    foreach ($line in $lines) {
        $out.Add($line)
        if (-not $inserted -and $line -match "^\s*$([regex]::Escape($AfterField))\s+") {
            $out.Add($NewLine)
            $inserted = $true
        }
    }
    if (-not $inserted) { throw "Field $AfterField not found in $ModelName" }
    $newBlock = $out -join "`n"
    return $SchemaText.Substring(0,$match.Index) + $newBlock + $SchemaText.Substring($match.Index + $match.Length)
}

function Add-ModelLineBeforeClose {
    param([string]$SchemaText,[string]$ModelName,[string]$Needle,[string]$NewLine)
    $pattern = "(?ms)(model\s+$([regex]::Escape($ModelName))\s*\{.*?^\})"
    $match = [regex]::Match($SchemaText, $pattern)
    if (-not $match.Success) { throw "Model not found: $ModelName" }
    $block = $match.Groups[1].Value
    if ($block -match [regex]::Escape($Needle)) { return $SchemaText }
    $close = $block.LastIndexOf("}")
    if ($close -lt 0) { throw "Model close not found: $ModelName" }
    $newBlock = $block.Substring(0,$close).TrimEnd() + "`n`n" + $NewLine + "`n}"
    return $SchemaText.Substring(0,$match.Index) + $newBlock + $SchemaText.Substring($match.Index + $match.Length)
}

Write-Host ""
Write-Host "=== PHASE 2 STAFF OPERATIONAL IDS ==="
Write-Host "Project: $Project"

$phase2 = Test-PassReport "_PHASE01_AUDIT\10-PHASE2-STAFF-UNIT-FOUNDATION.md" "Phase 2 Staff + Unit Foundation"
Write-Host "Phase 2 foundation: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(".env.saif-dev","docker-compose.saif-dev.yml","prisma\schema.prisma")) {
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
if ([string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","postgres"))) -or [string]::IsNullOrWhiteSpace((Get-ComposeText @("ps","-q","app")))) { throw "Local Tahili stack is not running." }

$foundationSql=@'
SELECT CASE WHEN
  to_regclass('public.staff_members') IS NOT NULL AND
  to_regclass('public.units') IS NOT NULL AND
  to_regclass('public.user_unit_memberships') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $foundationSql).Trim() -ne "PASS") { throw "Phase 2 UUID foundation tables are missing." }

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase2-staff-operational-ids" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath "prisma\schema.prisma" -Destination (Join-Path $rollbackDir "schema.prisma.before") -Force

$countsSql=@'
SELECT 'Attendance', count(*) FROM "Attendance"
UNION ALL SELECT 'Shift', count(*) FROM "Shift"
UNION ALL SELECT 'Leave', count(*) FROM "Leave"
ORDER BY 1;
'@
$preCounts=Invoke-PsqlText $countsSql
$preCounts | Set-Content -LiteralPath (Join-Path $rollbackDir "row-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

$schemaPath=Join-Path $Project "prisma\schema.prisma"
$schema=Get-Content -LiteralPath $schemaPath -Raw
if ($schema -notmatch '(?m)^model\s+StaffMember\s*\{') { throw "StaffMember model is missing from local Prisma schema." }

$schema=Add-LineAfterField $schema "Attendance" "name" "staffMemberId" '  staffMemberId String?      @db.Uuid'
$schema=Add-LineAfterField $schema "Attendance" "staffMemberId" "staffMember" '  staffMember   StaffMember? @relation("AttendanceStaffMember", fields: [staffMemberId], references: [id], onDelete: SetNull)'
$schema=Add-ModelLineBeforeClose $schema "Attendance" '@@index([staffMemberId])' '  @@index([staffMemberId])'

$schema=Add-LineAfterField $schema "Shift" "name" "staffMemberId" '  staffMemberId String?      @db.Uuid'
$schema=Add-LineAfterField $schema "Shift" "staffMemberId" "staffMember" '  staffMember   StaffMember? @relation("ShiftStaffMember", fields: [staffMemberId], references: [id], onDelete: SetNull)'
$schema=Add-ModelLineBeforeClose $schema "Shift" '@@index([staffMemberId])' '  @@index([staffMemberId])'

$schema=Add-LineAfterField $schema "Leave" "name" "staffMemberId" '  staffMemberId String?      @db.Uuid'
$schema=Add-LineAfterField $schema "Leave" "staffMemberId" "staffMember" '  staffMember   StaffMember? @relation("LeaveStaffMember", fields: [staffMemberId], references: [id], onDelete: SetNull)'
$schema=Add-ModelLineBeforeClose $schema "Leave" '@@index([staffMemberId])' '  @@index([staffMemberId])'

$schema=Add-LineAfterField $schema "StaffMember" "updatedAt" "attendances" '  attendances      Attendance[] @relation("AttendanceStaffMember")'
$schema=Add-LineAfterField $schema "StaffMember" "attendances" "shifts" '  shifts           Shift[]      @relation("ShiftStaffMember")'
$schema=Add-LineAfterField $schema "StaffMember" "shifts" "leaves" '  leaves           Leave[]      @relation("LeaveStaffMember")'

[System.IO.File]::WriteAllText($schemaPath,$schema,(New-Object System.Text.UTF8Encoding($false)))

$migrationDir=Join-Path $Project "prisma\migrations\20260913034500_phase2_staff_operational_ids"
$migrationFile=Join-Path $migrationDir "migration.sql"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
$migrationSql=@'
-- Phase 2 - Attendance / Shift / Leave -> StaffMember UUID identity
-- Additive only. Legacy name fields are intentionally preserved for verification and rollback.

ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "staffMemberId" UUID;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "staffMemberId" UUID;
ALTER TABLE "Leave" ADD COLUMN IF NOT EXISTS "staffMemberId" UUID;

-- One-time deterministic backfill only where normalized staff name maps to exactly one StaffMember.
-- Ambiguous/unmatched historical rows remain NULL and keep their original name for manual review.
WITH unique_staff AS (
  SELECT lower(btrim("fullName")) AS k, min("id"::text)::uuid AS staff_id
  FROM "staff_members"
  WHERE NULLIF(btrim("fullName"),'') IS NOT NULL
  GROUP BY lower(btrim("fullName"))
  HAVING count(*)=1
)
UPDATE "Attendance" a
SET "staffMemberId"=u.staff_id
FROM unique_staff u
WHERE NULLIF(btrim(a."name"),'') IS NOT NULL
  AND lower(btrim(a."name"))=u.k
  AND a."staffMemberId" IS DISTINCT FROM u.staff_id;

WITH unique_staff AS (
  SELECT lower(btrim("fullName")) AS k, min("id"::text)::uuid AS staff_id
  FROM "staff_members"
  WHERE NULLIF(btrim("fullName"),'') IS NOT NULL
  GROUP BY lower(btrim("fullName"))
  HAVING count(*)=1
)
UPDATE "Shift" s
SET "staffMemberId"=u.staff_id
FROM unique_staff u
WHERE NULLIF(btrim(s."name"),'') IS NOT NULL
  AND lower(btrim(s."name"))=u.k
  AND s."staffMemberId" IS DISTINCT FROM u.staff_id;

WITH unique_staff AS (
  SELECT lower(btrim("fullName")) AS k, min("id"::text)::uuid AS staff_id
  FROM "staff_members"
  WHERE NULLIF(btrim("fullName"),'') IS NOT NULL
  GROUP BY lower(btrim("fullName"))
  HAVING count(*)=1
)
UPDATE "Leave" l
SET "staffMemberId"=u.staff_id
FROM unique_staff u
WHERE NULLIF(btrim(l."name"),'') IS NOT NULL
  AND lower(btrim(l."name"))=u.k
  AND l."staffMemberId" IS DISTINCT FROM u.staff_id;

CREATE INDEX IF NOT EXISTS "Attendance_staffMemberId_idx" ON "Attendance"("staffMemberId");
CREATE INDEX IF NOT EXISTS "Shift_staffMemberId_idx" ON "Shift"("staffMemberId");
CREATE INDEX IF NOT EXISTS "Leave_staffMemberId_idx" ON "Leave"("staffMemberId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Attendance_staffMemberId_fkey') THEN
    ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "staff_members"("id") ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Shift_staffMemberId_fkey') THEN
    ALTER TABLE "Shift" ADD CONSTRAINT "Shift_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "staff_members"("id") ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Leave_staffMemberId_fkey') THEN
    ALTER TABLE "Leave" ADD CONSTRAINT "Leave_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "staff_members"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

ALTER TABLE "Attendance" VALIDATE CONSTRAINT "Attendance_staffMemberId_fkey";
ALTER TABLE "Shift" VALIDATE CONSTRAINT "Shift_staffMemberId_fkey";
ALTER TABLE "Leave" VALIDATE CONSTRAINT "Leave_staffMemberId_fkey";
'@

if (Test-Path -LiteralPath $migrationFile) {
    $existing=Get-Content -LiteralPath $migrationFile -Raw
    if ($existing.Trim() -ne $migrationSql.Trim()) { throw "Existing Phase 2 operational IDs migration differs from expected content." }
} else {
    [System.IO.File]::WriteAllText($migrationFile,$migrationSql,(New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "Schema and migration prepared."
Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")
Write-Host ""
Write-Host "=== PRISMA VALIDATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
Write-Host ""
Write-Host "=== MIGRATE DEPLOY ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","deploy")

$orphanSql=@'
SELECT 'Attendance' AS k, count(*) FROM "Attendance" a LEFT JOIN "staff_members" s ON s."id"=a."staffMemberId" WHERE a."staffMemberId" IS NOT NULL AND s."id" IS NULL
UNION ALL SELECT 'Shift', count(*) FROM "Shift" x LEFT JOIN "staff_members" s ON s."id"=x."staffMemberId" WHERE x."staffMemberId" IS NOT NULL AND s."id" IS NULL
UNION ALL SELECT 'Leave', count(*) FROM "Leave" x LEFT JOIN "staff_members" s ON s."id"=x."staffMemberId" WHERE x."staffMemberId" IS NOT NULL AND s."id" IS NULL
ORDER BY 1;
'@
$orphans=Invoke-PsqlText $orphanSql
foreach ($line in ($orphans -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2 -or [int64]$p[1] -ne 0) { throw "Staff operational UUID orphan verification failed: $line" }
}

$constraintSql=@'
SELECT count(*) FROM pg_constraint WHERE conname IN (
'Attendance_staffMemberId_fkey','Shift_staffMemberId_fkey','Leave_staffMemberId_fkey'
) AND convalidated;
'@
if ([int](Invoke-PsqlText $constraintSql) -ne 3) { throw "Expected 3 validated staffMemberId foreign keys." }

$mappingSql=@'
SELECT 'Attendance' || '|' || count(*) || '|' || count("staffMemberId") || '|' || count(*) FILTER (WHERE "staffMemberId" IS NULL) FROM "Attendance"
UNION ALL SELECT 'Shift' || '|' || count(*) || '|' || count("staffMemberId") || '|' || count(*) FILTER (WHERE "staffMemberId" IS NULL) FROM "Shift"
UNION ALL SELECT 'Leave' || '|' || count(*) || '|' || count("staffMemberId") || '|' || count(*) FILTER (WHERE "staffMemberId" IS NULL) FROM "Leave"
ORDER BY 1;
'@
$mapping=Invoke-PsqlText $mappingSql
foreach ($line in ($mapping -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 4 -or [int64]$p[1] -ne ([int64]$p[2] + [int64]$p[3])) { throw "Unexpected staff mapping metrics: $line" }
}

$mismatchSql=@'
SELECT 'Attendance' AS k, count(*) FROM "Attendance" a JOIN "staff_members" s ON s."id"=a."staffMemberId" WHERE lower(btrim(a."name")) IS DISTINCT FROM lower(btrim(s."fullName"))
UNION ALL SELECT 'Shift', count(*) FROM "Shift" x JOIN "staff_members" s ON s."id"=x."staffMemberId" WHERE lower(btrim(x."name")) IS DISTINCT FROM lower(btrim(s."fullName"))
UNION ALL SELECT 'Leave', count(*) FROM "Leave" x JOIN "staff_members" s ON s."id"=x."staffMemberId" WHERE lower(btrim(x."name")) IS DISTINCT FROM lower(btrim(s."fullName"))
ORDER BY 1;
'@
$mismatches=Invoke-PsqlText $mismatchSql
foreach ($line in ($mismatches -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $p=$line -split '\|'
    if ($p.Count -ne 2 -or [int64]$p[1] -ne 0) { throw "Backfilled staff identity/name mismatch detected: $line" }
}

$postCounts=Invoke-PsqlText $countsSql
if ($postCounts.Trim() -ne $preCounts.Trim()) { throw "Attendance/Shift/Leave row counts changed.`nBefore:`n$preCounts`nAfter:`n$postCounts" }
Write-Host "Staff operational ID database verification: PASS"
Write-Host "Mapping metrics (table|total|mapped|unresolved):"
Write-Host $mapping

Write-Host ""
Write-Host "=== PRISMA GENERATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","generate")
Write-Host ""
Write-Host "=== TYPESCRIPT ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")
Write-Host ""
Write-Host "=== FULL UNIT TESTS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run")
Write-Host ""
Write-Host "=== PROJECT AUDIT ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")
Write-Host ""
Write-Host "=== MIGRATION STATUS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","migrate","status")

$login=Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/login" -TimeoutSec 20
if ($login.StatusCode -ne 200 -or $login.Content -notmatch '<form') { throw "Login page smoke failed." }
Write-Host "Login page smoke: PASS"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$audit=Join-Path $auditDir "11-PHASE2-STAFF-OPERATIONAL-IDS.md"
$report=@"
# Phase 2 - Staff Operational UUID IDs

Status: PASS

Gate:
- Staff + Unit Foundation: PASS

Scope:
- Attendance.staffMemberId -> staff_members.id UUID
- Shift.staffMemberId -> staff_members.id UUID
- Leave.staffMemberId -> staff_members.id UUID

Migration policy:
- Legacy name fields are preserved in this phase.
- Historical rows are backfilled only when normalized name maps to exactly one StaffMember.
- Ambiguous or unmatched rows are deliberately left with staffMemberId = NULL for manual review; no guess is made.
- No runtime name-resolution trigger is introduced.
- Future application writes must be moved to staffMemberId in the next batch.

Mapping metrics (table|total|mapped|unresolved):
$mapping

Orphan checks:
$orphans

Backfilled name/identity mismatch checks:
$mismatches

Safety:
- Additive only.
- 3 UUID foreign keys validated.
- Attendance/Shift/Leave row counts unchanged.
- Legacy names retained.
- No prisma db push.
- No application restart performed.

Verification:
- Prisma validate: PASS
- Prisma migrate deploy: PASS
- Zero UUID FK orphans: PASS
- Backfill mismatch checks: PASS
- Prisma generate: PASS
- TypeScript: PASS
- Full Vitest: PASS
- Project audit: PASS
- Prisma migration status: PASS
- Login smoke: PASS

Rollback snapshot: $rollbackDir

Next:
Update Attendance and Shift/Leave server actions to write staffMemberId directly while preserving name only as compatibility/display data during dual-operation.
"@
$report | Set-Content -LiteralPath $audit -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host "PHASE 2 STAFF OPERATIONAL IDS: PASS"
Write-Host "======================================"
Write-Host "Report: $audit"
Write-Host "Rollback snapshot: $rollbackDir"
