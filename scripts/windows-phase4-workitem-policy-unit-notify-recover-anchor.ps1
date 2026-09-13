$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Normalize-Lf([string]$Text) { return $Text.Replace("`r`n","`n") }
function Write-Utf8NoBom([string]$Path,[string]$Text) {
    [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding($false)))
}
function Test-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

Write-Host ""
Write-Host "=== PHASE 4 RECOVERY: UNIT NOTIFY ANCHOR ==="
Write-Host "Project: $Project"

Test-PassReport "_PHASE01_AUDIT\21-PHASE4-NOTIFICATION-SCOPE-INVENTORY.md" "Phase 4 notification scope inventory"
Write-Host "Phase 4 notification inventory prerequisite: PASS"

$notifyPath = Join-Path $Project "src\lib\notify.ts"
$mainPath = Join-Path $Project "scripts\windows-phase4-workitem-policy-unit-notify.ps1"
foreach ($path in @($notifyPath,$mainPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file missing: $path" }
}

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase4-workitem-policy-unit-notify-recover" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
Copy-Item -LiteralPath $notifyPath -Destination (Join-Path $rollbackDir "notify.ts.before") -Force
Write-Host "Recovery snapshot: $rollbackDir"

$notify=Normalize-Lf ([System.IO.File]::ReadAllText($notifyPath,[System.Text.Encoding]::UTF8))

if (-not $notify.Contains('export async function notifyUnitInTransaction')) {
    $oldType='type NotificationClient = Pick<typeof prisma, "notification">;'
    $newType='type NotificationClient = Pick<typeof prisma, "notification" | "userUnitMembership">;'
    if ($notify.Contains($oldType)) {
        $notify=$notify.Replace($oldType,$newType)
    } elseif (-not $notify.Contains($newType)) {
        throw "NotificationClient type is neither the old nor expected new form. Stop for review."
    }

    $pattern='(?ms)(export async function notifyUserInTransaction\(.*?^\})\n'
    $matches=[regex]::Matches($notify,$pattern)
    if ($matches.Count -ne 1) {
        throw "Could not identify exactly one notifyUserInTransaction function using structural matching. Found: $($matches.Count). Stop for review."
    }

    $addition=@'

export async function notifyUnitInTransaction(
  client: NotificationClient,
  unitId: string,
  title: string,
  opts: { body?: string; link?: string } = {},
) {
  const targetUnitId = unitId.trim();
  if (!targetUnitId) return 0;

  const memberships = await client.userUnitMembership.findMany({
    where: { unitId: targetUnitId, active: true },
    select: { user: { select: { id: true, isActive: true } } },
  });
  const userIds = [...new Set(memberships.filter((row) => row.user.isActive).map((row) => row.user.id))];

  let created = 0;
  for (const userId of userIds) {
    if (await createNotification(
      client,
      { targetUserId: userId, title, body: opts.body ?? null, link: opts.link ?? null },
      { includeReadInDedupe: true },
    )) created += 1;
  }
  return created;
}
'@

    $m=$matches[0]
    $insertAt=$m.Index+$m.Length
    $notify=$notify.Substring(0,$insertAt)+$addition+$notify.Substring($insertAt)
    Write-Utf8NoBom $notifyPath $notify
    Write-Host "Unit notification fanout helper: RECOVERED"
} else {
    Write-Host "Unit notification fanout helper: already present"
}

$check=Normalize-Lf ([System.IO.File]::ReadAllText($notifyPath,[System.Text.Encoding]::UTF8))
foreach ($needle in @(
    'type NotificationClient = Pick<typeof prisma, "notification" | "userUnitMembership">;',
    'export async function notifyUnitInTransaction',
    'userUnitMembership.findMany',
    'targetUserId: userId',
    'row.user.isActive'
)) {
    if (-not $check.Contains($needle)) { throw "Recovery source assertion failed: $needle" }
}
Write-Host "Recovery source assertions: PASS"

Write-Host ""
Write-Host "=== RESUME MAIN PHASE 4 POLICY + UNIT NOTIFY STEP ==="
& powershell -ExecutionPolicy Bypass -File $mainPath
$exit=$LASTEXITCODE
if ($exit -ne 0) { throw "Resumed Phase 4 policy/unit notify step failed with exit code $exit." }
