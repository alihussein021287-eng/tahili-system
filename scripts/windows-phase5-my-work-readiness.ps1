$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Require-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Read-Utf8 {
    param([string]$RelativePath)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required source missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
}

function Get-ModelBlock {
    param([string]$Schema,[string]$Model)
    $pattern = "(?ms)^model\s+" + [regex]::Escape($Model) + "\s*\{.*?^\}"
    $m = [regex]::Match($Schema,$pattern)
    if (-not $m.Success) { throw "Prisma model missing: $Model" }
    return $m.Value
}

Write-Host ""
Write-Host "=== PHASE 5 MY WORK CUTOVER READINESS ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\27-PHASE5-PRESENTATION-TARGET-INVENTORY.md" "Phase 5 presentation target inventory"
Write-Host "Phase 5 target-inventory prerequisite: PASS"

$targets = @(
    "src\app\(app)\my-work\page.tsx",
    "src\lib\my-work.ts",
    "src\lib\patient-work-item.ts",
    "src\lib\patient-work-item-scope.ts",
    "prisma\schema.prisma"
)

$hashBefore = @{}
foreach ($relative in $targets) {
    $full = Join-Path $Project $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Required file missing: $relative" }
    $hashBefore[$relative] = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
}

$myWork = Read-Utf8 "src\app\(app)\my-work\page.tsx"
$myWorkLib = Read-Utf8 "src\lib\my-work.ts"
$workItemService = Read-Utf8 "src\lib\patient-work-item.ts"
$scope = Read-Utf8 "src\lib\patient-work-item-scope.ts"
$schema = Read-Utf8 "prisma\schema.prisma"

$patientWorkItemModel = Get-ModelBlock $schema "PatientWorkItem"
$userUnitMembershipModel = Get-ModelBlock $schema "UserUnitMembership"
$unitModel = Get-ModelBlock $schema "Unit"
$userModel = Get-ModelBlock $schema "User"

$legacyStageQuery = $myWork.Contains('prisma.careStage.findMany')
$legacyRoleOwner = $myWork.Contains('responsibleRole: role as any')
$alreadyImportsWorkItemService = $myWork -match '@/lib/patient-work-item'
$alreadyImportsScope = $myWork -match '@/lib/patient-work-item-scope'
$workItemTypeHasStage = $myWorkLib -match '"stage"'

foreach ($needle in @('assignedUserId','assignedUnitId','userUnitMembership.findFirst','WORK_ITEM_UNIT_MEMBERSHIP_REQUIRED','WORK_ITEM_ASSIGNED_USER_REQUIRED')) {
    if (-not $workItemService.Contains($needle)) { throw "PatientWorkItem service readiness assertion failed: $needle" }
}
foreach ($needle in @('assignedUserId','assignedUnitId','unitIds','canViewWorkItemScope','isWorkItemInActorUnit')) {
    if (-not $scope.Contains($needle)) { throw "PatientWorkItem scope readiness assertion failed: $needle" }
}
foreach ($needle in @('assignedUserId','assignedUnitId','patientId','status')) {
    if (-not $patientWorkItemModel.Contains($needle)) { throw "PatientWorkItem Prisma model readiness assertion failed: $needle" }
}
foreach ($needle in @('userId','unitId')) {
    if (-not $userUnitMembershipModel.Contains($needle)) { throw "UserUnitMembership Prisma model readiness assertion failed: $needle" }
}
if (-not $userModel.Contains('guid')) { throw "User Prisma model missing guid." }

$exposureRows = New-Object System.Collections.Generic.List[string]
$scanRoots = @(
    (Join-Path $Project "src\app"),
    (Join-Path $Project "src\lib")
)
foreach ($root in $scanRoots) {
    foreach ($f in Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx -ErrorAction Stop) {
        $text = [System.IO.File]::ReadAllText($f.FullName,[System.Text.Encoding]::UTF8)
        if ($text -match '@/lib/patient-work-item' -or $text -match '\b(claim|accept|start|complete|assign|reassign)PatientWorkItem\b') {
            $relative = $f.FullName.Substring($Project.Length + 1).Replace('\','/')
            $exposureRows.Add($relative) | Out-Null
        }
    }
}
$exposureRows = @($exposureRows | Sort-Object -Unique)

$stageBlock = "not found"
$stageMatch = [regex]::Match($myWork,'(?ms)if \(wants\("stage"\).*?\n\s*\}')
if ($stageMatch.Success) { $stageBlock = $stageMatch.Value }

$hashAfter = @{}
foreach ($relative in $targets) {
    $full = Join-Path $Project $relative
    $hashAfter[$relative] = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    if ($hashAfter[$relative] -ne $hashBefore[$relative]) { throw "Read-only readiness audit changed source file: $relative" }
}
Write-Host "Source write guard: PASS"

Write-Host "legacy_stage_query|$([int]$legacyStageQuery)"
Write-Host "legacy_role_owner|$([int]$legacyRoleOwner)"
Write-Host "already_imports_workitem_service|$([int]$alreadyImportsWorkItemService)"
Write-Host "already_imports_scope|$([int]$alreadyImportsScope)"
Write-Host "workitem_type_has_stage|$([int]$workItemTypeHasStage)"
Write-Host "patient_workitem_exposure_files|$($exposureRows.Count)"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath = Join-Path $auditDir "28-PHASE5-MY-WORK-CUTOVER-READINESS.md"

$exposureText = if ($exposureRows.Count -gt 0) { ($exposureRows | ForEach-Object { "- $_" }) -join "`n" } else { "- none" }
$report = @"
# Phase 5 - My Work Cutover Readiness

Status: PASS

Purpose:
Read-only local-source readiness check before replacing the legacy CareStage role-owned row in My Work with PatientWorkItem User/Unit scope.

Current My Work facts:
- legacy CareStage query present: $legacyStageQuery
- legacy responsibleRole ownership present: $legacyRoleOwner
- already imports PatientWorkItem service: $alreadyImportsWorkItemService
- already imports PatientWorkItem scope policy: $alreadyImportsScope
- My Work type list already contains stage: $workItemTypeHasStage

Current legacy stage block:
```ts
$stageBlock
```

PatientWorkItem model:
```prisma
$patientWorkItemModel
```

UserUnitMembership model:
```prisma
$userUnitMembershipModel
```

Unit model:
```prisma
$unitModel
```

PatientWorkItem service/scope exposure files:
$exposureText

Safety:
- No database commands executed.
- No Prisma migration created or applied.
- No application source modified.
- SHA256 source write guard PASS.
- Original live server untouched.

Recommended Batch 5A boundary:
- Change only the My Work patient-specific `stage` source from legacy CareStage/responsibleRole to PatientWorkItem visibility by actual assigned User or active Unit membership.
- Keep the existing WorkItem `stage` presentation contract so filters/labels/deep links remain stable.
- Do not remove CareStage from patient history/journey in this batch.
- Do not change Notification behavior in this batch.
- Any action remains guarded by PatientWorkItem service ownership/membership checks; presentation visibility must not become the authorization layer.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "======================================="
Write-Host "PHASE 5 MY WORK CUTOVER READINESS: PASS"
Write-Host "======================================="
Write-Host "Report: $reportPath"
