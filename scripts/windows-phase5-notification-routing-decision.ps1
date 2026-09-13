$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

function Require-PassReport {
    param([Parameter(Mandatory = $true)][string]$RelativePath,[Parameter(Mandatory = $true)][string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Read-Utf8 {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required source missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
}

Write-Host ""
Write-Host "=== PHASE 5C NOTIFICATION ROUTING DECISION GATE ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\33-PHASE5-NOTIFICATION-ROLE-CONTEXT.md" "Phase 5C role context"
Require-PassReport "_PHASE01_AUDIT\34-PHASE5-CLINICAL-RECIPIENT-ROUTING-READINESS.md" "Phase 5C clinical routing readiness"
Require-PassReport "_PHASE01_AUDIT\35-PHASE5-ROUTING-FOUNDATION-INVENTORY.md" "Phase 5C routing foundation inventory"
Write-Host "Phase 5C prerequisites: PASS"

$keyFiles = @(
    "src\app\(app)\centers\actions.ts",
    "src\app\(app)\devices\actions.ts",
    "src\app\(app)\finance\expenses\actions.ts",
    "src\app\(app)\patients\actions.ts",
    "src\app\(app)\pharmacy\actions.ts",
    "src\app\(app)\tasks\actions.ts",
    "src\app\(app)\therapy\actions.ts",
    "src\app\(app)\visits\actions.ts",
    "src\app\api\reminders\due\route.ts",
    "src\lib\referral-service.ts",
    "src\lib\referral-workflow.ts",
    "src\lib\patient-work-item.ts",
    "src\lib\notify.ts"
)

$hashBefore = @{}
foreach ($relative in $keyFiles) {
    $full = Join-Path $Project $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Required source missing: $relative" }
    $hashBefore[$relative] = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
}

$patients = Read-Utf8 "src\app\(app)\patients\actions.ts"
$centers = Read-Utf8 "src\app\(app)\centers\actions.ts"
$therapy = Read-Utf8 "src\app\(app)\therapy\actions.ts"
$visits = Read-Utf8 "src\app\(app)\visits\actions.ts"
$devices = Read-Utf8 "src\app\(app)\devices\actions.ts"
$tasks = Read-Utf8 "src\app\(app)\tasks\actions.ts"
$finance = Read-Utf8 "src\app\(app)\finance\expenses\actions.ts"
$pharmacy = Read-Utf8 "src\app\(app)\pharmacy\actions.ts"
$reminders = Read-Utf8 "src\app\api\reminders\due\route.ts"
$workflow = Read-Utf8 "src\lib\referral-workflow.ts"
$service = Read-Utf8 "src\lib\referral-service.ts"
$workItem = Read-Utf8 "src\lib\patient-work-item.ts"
$notify = Read-Utf8 "src\lib\notify.ts"

$checks = [ordered]@{
    referral_pending_print_manager_broadcast = [int]($workflow -match 'PENDING_PRINT[\s\S]{0,250}kind:\s*"ROLE"[\s\S]{0,80}role:\s*"MANAGER"')
    referral_internal_specialist_user = [int]($workflow -match 'INTERNAL_SPECIALIST[\s\S]{0,350}kind:\s*"USER"')
    referral_internal_center_unit = [int]($workflow -match 'destinationUnitId[\s\S]{0,200}kind:\s*"UNIT"')
    referral_service_unit_fanout = [int](($service -match 'recipient\.kind\s*===\s*"UNIT"') -and ($service -match 'notifyUnitInTransaction'))
    notify_unit_fanout_present = [int]($notify -match 'notifyUnitInTransaction')
    pharmacy_stock_broadcast_present = [int](($pharmacy -match 'targetRole:\s*"PHARMACIST"') -or ($reminders -match 'notifyRole\("PHARMACIST"'))
    finance_manager_broadcast_present = [int]($finance -match 'targetRole:\s*"MANAGER"')
    finance_accountant_broadcast_present = [int]($finance -match 'targetRole:\s*"ACCOUNTANT"')
    clinical_next_stage_role_deferred = [int]($patients -match 'notifyRole\(next\.responsibleRole')
    clinical_head_therapist_role_deferred = [int]($patients -match 'notifyRole\("HEAD_THERAPIST"')
    clinical_doctor_role_deferred = [int]($patients -match 'notifyRole\("DOCTOR"')
    center_doctor_role_deferred = [int]($centers -match 'targetRole:\s*"DOCTOR"')
    therapy_doctor_role_deferred = [int]($therapy -match 'targetRole:\s*"DOCTOR"')
    visit_destination_role_deferred = [int]($visits -match 'notifyRoleInTransaction[\s\S]{0,180}destination\.role')
    device_prosthetics_role_deferred = [int]($devices -match 'notifyRole\("PROSTHETICS"')
    generic_task_assigned_role_deferred = [int]($tasks -match 'if\s*\(assignedRole\)[\s\S]{0,160}notifyRole')
}

foreach ($entry in $checks.GetEnumerator()) {
    Write-Host "$($entry.Key)|$($entry.Value)"
}

$mustBeOne = @(
    'referral_pending_print_manager_broadcast',
    'referral_internal_specialist_user',
    'referral_internal_center_unit',
    'referral_service_unit_fanout',
    'notify_unit_fanout_present'
)
foreach ($name in $mustBeOne) {
    if ($checks[$name] -ne 1) { throw "Required Phase 5 routing invariant failed: $name" }
}

$mutationNames = @(
    'createPatientWorkItem',
    'assignPatientWorkItem',
    'claimPatientWorkItem',
    'acceptPatientWorkItem',
    'startPatientWorkItem',
    'completePatientWorkItem'
)

$externalMutationHits = New-Object System.Collections.Generic.List[string]
$sourceRoot = Join-Path $Project "src"
$sourceFiles = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object { $_.Extension -in @('.ts','.tsx') }
foreach ($file in $sourceFiles) {
    $relative = $file.FullName.Substring($Project.Length + 1).Replace('\','/')
    if ($relative -eq 'src/lib/patient-work-item.ts') { continue }
    $text = [System.IO.File]::ReadAllText($file.FullName,[System.Text.Encoding]::UTF8)
    foreach ($name in $mutationNames) {
        if ($text -match ('\b' + [regex]::Escape($name) + '\b')) {
            $externalMutationHits.Add("$name|$relative")
        }
    }
}

if ($externalMutationHits.Count -gt 0) {
    throw "PatientWorkItem mutation service functions are referenced outside the service layer:`n$($externalMutationHits -join "`n")"
}
Write-Host "PatientWorkItem external mutation exposure: NONE"

foreach ($relative in $keyFiles) {
    $full = Join-Path $Project $relative
    $after = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    if ($after -ne $hashBefore[$relative]) { throw "Decision gate changed source file: $relative" }
}
Write-Host "Source write guard: PASS"

$auditDir = Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath = Join-Path $auditDir "36-PHASE5-NOTIFICATION-ROUTING-DECISION.md"

$checkText = ($checks.GetEnumerator() | ForEach-Object { "- $($_.Key): $($_.Value)" }) -join "`n"

$report = @"
# Phase 5C - Notification Routing Decision

Status: PASS

Decision:
- Keep true process/system Role broadcasts. Role remains a capability/broadcast concept, not patient ownership.
- Internal referral routing is already explicit: specialist -> assigned User, center -> destination Unit fanout.
- Do not add Notification.targetUnitId. Unit delivery remains per-user fanout through notifyUnitInTransaction.
- Do not auto-seed Units or memberships from Role/station labels.
- Defer remaining patient-specific clinical Role notifications until a real assigned User or Unit exists. Current local clone has no Units, memberships, or PatientWorkItems, so changing those recipients now would require guessing.
- CareStage.responsibleRole remains compatibility/history only and is not accepted as the new ownership source.
- Generic Task assignedRole and device role-task routing remain deferred for a separate Task ownership review.
- PatientWorkItem mutation functions are not referenced outside src/lib/patient-work-item.ts; My Work remains a read/presentation surface and mutations stay service-authorized.

Source decision checks:
$checkText

Deferred patient-specific clinical patterns:
- patients/actions.ts: next CareStage responsibleRole notification
- patients/actions.ts: HEAD_THERAPIST referral notification
- patients/actions.ts: DOCTOR resident-review referral notification
- centers/actions.ts: DOCTOR return-to-consultancy notification
- therapy/actions.ts: DOCTOR final-evaluation follow-up notification
- visits/actions.ts: destination.role station notification
- devices/actions.ts: PROSTHETICS task notification
- tasks/actions.ts: generic assignedRole task notification

Valid Role broadcast examples retained:
- pharmacy stock/expiry alerts
- finance manager approval queue
- finance accountant payment queue
- report/print process queues
- external referral PENDING_PRINT manager notification

Safety:
- Read-only source inspection only.
- No database commands executed.
- No migration created or applied.
- No application source modified.
- Source SHA256 write guard PASS.
- Original live server untouched.
"@

[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "==============================================="
Write-Host "PHASE 5C NOTIFICATION ROUTING DECISION: PASS"
Write-Host "==============================================="
Write-Host "Report: $reportPath"
