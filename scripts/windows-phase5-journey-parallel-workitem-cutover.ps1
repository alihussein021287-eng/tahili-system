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

function Require-PassReport {
    param([string]$RelativePath,[string]$Label)
    $path = Join-Path $Project $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Label PASS report missing: $path" }
    $text = [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
    if ($text -notmatch "(?mi)^Status:\s*PASS\s*$") { throw "$Label is not PASS: $path" }
}

function Normalize-Lf {
    param([Parameter(Mandatory = $true)][string]$Text)
    return $Text.Replace("`r`n","`n").Replace("`r","`n")
}

function Join-Lines {
    param([Parameter(Mandatory = $true)][string[]]$Lines)
    return ($Lines -join "`n")
}

Write-Host ""
Write-Host "=== PHASE 5B JOURNEY PARALLEL PATIENTWORKITEM CUTOVER ==="
Write-Host "Project: $Project"

Require-PassReport "_PHASE01_AUDIT\30-PHASE5-JOURNEY-PRESENTATION-READINESS.md" "Phase 5B journey readiness"
Write-Host "Phase 5B readiness prerequisite: PASS"

& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running." }
foreach ($file in @(
    ".env.saif-dev",
    "docker-compose.saif-dev.yml",
    "prisma\schema.prisma",
    "src\lib\patient-journey.ts",
    "src\app\(app)\patients\[id]\page.tsx"
)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

$envMap=@{}
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

$shapeSql=@'
SELECT CASE WHEN
  to_regclass('public.patient_work_items') IS NOT NULL
  AND to_regclass('public."CareStage"') IS NOT NULL
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patients' AND column_name='guid' AND data_type='uuid')
THEN 'PASS' ELSE 'FAIL' END;
'@
if ((Invoke-PsqlText $shapeSql).Trim() -ne 'PASS') { throw "Required Phase 5B database shape is missing." }

$countsSql=@'
SELECT 'care_stages|' || count(*) FROM "CareStage"
UNION ALL SELECT 'patient_work_items|' || count(*) FROM "patient_work_items"
UNION ALL SELECT 'notifications|' || count(*) FROM "notifications"
ORDER BY 1;
'@
$countsBefore=Invoke-PsqlText $countsSql

$stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$rollbackDir=Join-Path $Project (Join-Path ".secrets\phase5-journey-parallel-workitem-cutover" $stamp)
New-Item -ItemType Directory -Force -Path $rollbackDir | Out-Null
$journeyPath=Join-Path $Project "src\lib\patient-journey.ts"
$pagePath=Join-Path $Project "src\app\(app)\patients\[id]\page.tsx"
Copy-Item -LiteralPath $journeyPath -Destination (Join-Path $rollbackDir "patient-journey.ts.before") -Force
Copy-Item -LiteralPath $pagePath -Destination (Join-Path $rollbackDir "patient-page.tsx.before") -Force
$countsBefore | Set-Content -LiteralPath (Join-Path $rollbackDir "db-counts.before.txt") -Encoding UTF8
Write-Host "Rollback snapshot: $rollbackDir"

$journey=Normalize-Lf ([System.IO.File]::ReadAllText($journeyPath,[System.Text.Encoding]::UTF8))
$page=Normalize-Lf ([System.IO.File]::ReadAllText($pagePath,[System.Text.Encoding]::UTF8))

if (-not $journey.Contains('export type DerivedJourneyWorkItem = {')) {
    $typeMarker='type JourneyInput = {'
    $typeIndex=$journey.IndexOf($typeMarker,[System.StringComparison]::Ordinal)
    if ($typeIndex -lt 0) { throw "patient-journey type insertion marker missing. Stop for review." }
    $typeBlock=Join-Lines @(
        'export type DerivedJourneyWorkItem = {',
        '  id: string;',
        '  kind: string;',
        '  title: string;',
        '  status: string;',
        '  statusLabel: string;',
        '  assignedTo: string;',
        '  lastActionAt: Date;',
        '  note: string | null;',
        '  href: string;',
        '  terminal: boolean;',
        '};',
        '',
        'type JourneyWorkItemInput = {',
        '  id: string;',
        '  kind: string;',
        '  status: string;',
        '  note?: string | null;',
        '  cancellationReason?: string | null;',
        '  createdAt: Date;',
        '  updatedAt: Date;',
        '  acceptedAt?: Date | null;',
        '  startedAt?: Date | null;',
        '  completedAt?: Date | null;',
        '  assignedUser?: { fullName: string } | null;',
        '  assignedUnit?: { name: string } | null;',
        '};',
        ''
    )
    $journey=$journey.Substring(0,$typeIndex) + $typeBlock + $journey.Substring($typeIndex)
}

if (-not $journey.Contains('export function deriveJourneyWorkItems(')) {
    $helperMarker='export function nextPatientStep('
    $helperIndex=$journey.IndexOf($helperMarker,[System.StringComparison]::Ordinal)
    if ($helperIndex -lt 0) { throw "patient-journey helper insertion marker missing. Stop for review." }
    $helperBlock=Join-Lines @(
        'function patientWorkItemJourneyTitle(kind: string) {',
        '  if (kind.startsWith("LEGACY_CARE_STAGE:")) return kind.slice("LEGACY_CARE_STAGE:".length).trim() || "\u0639\u0645\u0644 \u0631\u0639\u0627\u064a\u0629";',
        '  if (kind === "REFERRAL_INTERNAL_SPECIALIST") return "\u0625\u062d\u0627\u0644\u0629 \u062f\u0627\u062e\u0644\u064a\u0629 \u0625\u0644\u0649 \u0627\u062e\u062a\u0635\u0627\u0635\u064a";',
        '  if (kind === "REFERRAL_INTERNAL_CENTER") return "\u0625\u062d\u0627\u0644\u0629 \u062f\u0627\u062e\u0644\u064a\u0629 \u0625\u0644\u0649 \u0648\u062d\u062f\u0629";',
        '  return "\u0639\u0645\u0644 \u0631\u0639\u0627\u064a\u0629";',
        '}',
        '',
        'function patientWorkItemJourneyStatus(status: string) {',
        '  const labels: Record<string, string> = {',
        '    OPEN: "\u0645\u0641\u062a\u0648\u062d",',
        '    ASSIGNED: "\u0645\u064f\u0633\u0646\u062f",',
        '    ACCEPTED: "\u0645\u0642\u0628\u0648\u0644",',
        '    PROGRESS_IN: "\u0642\u064a\u062f \u0627\u0644\u062a\u0646\u0641\u064a\u0630",',
        '    COMPLETED: "\u0645\u0643\u062a\u0645\u0644",',
        '    BLOCKED: "\u0645\u062a\u0648\u0642\u0641",',
        '    CANCELLED: "\u0645\u0644\u063a\u0649",',
        '  };',
        '  return labels[status] ?? status;',
        '}',
        '',
        'export function deriveJourneyWorkItems(patientId: string, items: JourneyWorkItemInput[]): DerivedJourneyWorkItem[] {',
        '  return items.map((item) => ({',
        '    id: item.id,',
        '    kind: item.kind,',
        '    title: patientWorkItemJourneyTitle(item.kind),',
        '    status: item.status,',
        '    statusLabel: patientWorkItemJourneyStatus(item.status),',
        '    assignedTo: item.assignedUser?.fullName ?? item.assignedUnit?.name ?? "\u063a\u064a\u0631 \u0645\u0639\u064a\u0651\u0646",',
        '    lastActionAt: item.completedAt ?? item.startedAt ?? item.acceptedAt ?? item.updatedAt ?? item.createdAt,',
        '    note: item.note ?? item.cancellationReason ?? null,',
        '    href: item.kind.startsWith("REFERRAL_") ? `/patients/${patientId}?tab=referrals` : `/patients/${patientId}?tab=journey`,',
        '    terminal: ["COMPLETED", "CANCELLED"].includes(item.status),',
        '  })).sort((a, b) => Number(a.terminal) - Number(b.terminal) || b.lastActionAt.getTime() - a.lastActionAt.getTime());',
        '}',
        '',
        ''
    )
    $journey=$journey.Substring(0,$helperIndex) + $helperBlock + $journey.Substring($helperIndex)
}

$journeyImportPattern='(?m)^import\s+\{[^\r\n]*derivePatientJourney[^\r\n]*\}\s+from\s+"@/lib/patient-journey";\s*$'
$journeyImportMatch=[regex]::Match($page,$journeyImportPattern)
if (-not $page.Contains('deriveJourneyWorkItems')) {
    if (-not $journeyImportMatch.Success) { throw "Patient page journey import line could not be located. Stop for review." }
    $newImport='import { derivePatientJourney, deriveJourneyWorkItems, nextPatientStep, type DerivedJourneyStage, type DerivedJourneyWorkItem } from "@/lib/patient-journey";'
    $page=$page.Substring(0,$journeyImportMatch.Index) + $newImport + $page.Substring($journeyImportMatch.Index + $journeyImportMatch.Length)
}

if (-not $page.Contains('const derivedJourneyWorkItems = deriveJourneyWorkItems(patient.id, journeyWorkItems);')) {
    $derivedMarker='  const derivedJourney = derivePatientJourney({ ...patient, referralRequests: journeyReferrals });'
    $derivedIndex=$page.IndexOf($derivedMarker,[System.StringComparison]::Ordinal)
    if ($derivedIndex -lt 0) { throw "Patient page derived journey marker missing. Stop for review." }
    $queryBlock=Join-Lines @(
        '  const journeyWorkItems = perms.has("journey.view")',
        '    ? await prisma.patientWorkItem.findMany({',
        '        where: { patientId: patient.guid },',
        '        select: {',
        '          id: true,',
        '          kind: true,',
        '          status: true,',
        '          note: true,',
        '          cancellationReason: true,',
        '          createdAt: true,',
        '          updatedAt: true,',
        '          acceptedAt: true,',
        '          startedAt: true,',
        '          completedAt: true,',
        '          assignedUser: { select: { fullName: true } },',
        '          assignedUnit: { select: { name: true } },',
        '        },',
        '        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],',
        '        take: 100,',
        '      })',
        '    : [];',
        '  const derivedJourneyWorkItems = deriveJourneyWorkItems(patient.id, journeyWorkItems);',
        ''
    )
    $page=$page.Substring(0,$derivedIndex) + $queryBlock + $page.Substring($derivedIndex)
}

if (-not $page.Contains('workItems={derivedJourneyWorkItems}')) {
    $componentPattern='<PatientJourneySummary\s+stages=\{derivedJourney\}\s+nextStep=\{nextStep\}\s+canExecuteResidentReview=\{perms\.has\("clinical\.metrics"\)\}\s*/>'
    $componentMatch=[regex]::Match($page,$componentPattern)
    if (-not $componentMatch.Success) { throw "PatientJourneySummary call was not found in expected form. Stop for review." }
    $componentReplacement='<PatientJourneySummary stages={derivedJourney} workItems={derivedJourneyWorkItems} nextStep={nextStep} canExecuteResidentReview={perms.has("clinical.metrics")} />'
    $page=$page.Substring(0,$componentMatch.Index) + $componentReplacement + $page.Substring($componentMatch.Index + $componentMatch.Length)
}

if (-not $page.Contains('workItems: DerivedJourneyWorkItem[];')) {
    $signaturePattern='function\s+PatientJourneySummary\(\{\s*stages,\s*nextStep,\s*canExecuteResidentReview\s*\}:\s*\{\s*stages:\s*DerivedJourneyStage\[\];\s*nextStep:\s*DerivedJourneyStage\s*\|\s*null;\s*canExecuteResidentReview:\s*boolean\s*\}\)\s*\{'
    $signatureMatch=[regex]::Match($page,$signaturePattern)
    if (-not $signatureMatch.Success) { throw "PatientJourneySummary signature was not found in expected form. Stop for review." }
    $signatureReplacement='function PatientJourneySummary({ stages, workItems, nextStep, canExecuteResidentReview }: { stages: DerivedJourneyStage[]; workItems: DerivedJourneyWorkItem[]; nextStep: DerivedJourneyStage | null; canExecuteResidentReview: boolean }) {'
    $page=$page.Substring(0,$signatureMatch.Index) + $signatureReplacement + $page.Substring($signatureMatch.Index + $signatureMatch.Length)
}

if (-not $page.Contains('patient-parallel-workitems')) {
    $listMarker="      </ol>`n      {nextStep ? ("
    $listIndex=$page.IndexOf($listMarker,[System.StringComparison]::Ordinal)
    if ($listIndex -lt 0) { throw "Patient journey list insertion marker missing. Stop for review." }
    $workItemUi=Join-Lines @(
        '      </ol>',
        '      <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4" aria-labelledby="patient-parallel-workitems">',
        '        <div className="flex flex-wrap items-center justify-between gap-2">',
        '          <div>',
        '            <h3 id="patient-parallel-workitems" className="font-medium text-gray-900">{"\u0627\u0644\u0623\u0639\u0645\u0627\u0644 \u0627\u0644\u062a\u0634\u063a\u064a\u0644\u064a\u0629 \u0627\u0644\u0645\u062a\u0648\u0627\u0632\u064a\u0629"}</h3>',
        '            <p className="mt-1 text-xs text-gray-500">{"\u0627\u0644\u0645\u0644\u0643\u064a\u0629 \u0627\u0644\u062a\u0634\u063a\u064a\u0644\u064a\u0629 \u0647\u0646\u0627 \u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0623\u0648 \u0648\u062d\u062f\u0629 \u0641\u0639\u0644\u064a\u0629\u060c \u0648\u0644\u064a\u0633\u062a \u0645\u0644\u0643\u064a\u0629 \u0628\u0627\u0644\u062f\u0648\u0631."}</p>',
        '          </div>',
        '          <span className="badge-neutral">{workItems.length}</span>',
        '        </div>',
        '        {workItems.length ? (',
        '          <div className="mt-3 grid gap-2 md:grid-cols-2">',
        '            {workItems.map((item) => (',
        '              <Link key={item.id} href={item.href} className="rounded-lg border border-gray-100 bg-white p-3 transition hover:border-brand-200">',
        '                <div className="flex items-start justify-between gap-2">',
        '                  <span className="font-medium text-gray-800">{item.title}</span>',
        '                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${item.status === "BLOCKED" ? "bg-amber-50 text-amber-700" : item.terminal ? "bg-gray-100 text-gray-600" : "bg-brand-50 text-brand-700"}`}>{item.statusLabel}</span>',
        '                </div>',
        '                <div className="mt-2 text-xs text-gray-600">{"\u0645\u0633\u0646\u062f \u0641\u0639\u0644\u064a\u0627\u064b \u0625\u0644\u0649: "}{item.assignedTo}</div>',
        '                <div className="mt-1 text-xs text-gray-400">{"\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b: "}{fmtDate(item.lastActionAt)}</div>',
        '                {item.note ? <div className="mt-2 line-clamp-2 text-xs leading-5 text-gray-500">{item.note}</div> : null}',
        '              </Link>',
        '            ))}',
        '          </div>',
        '        ) : (',
        '          <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-white p-3 text-sm text-gray-500">{"\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0639\u0645\u0627\u0644 \u062a\u0634\u063a\u064a\u0644\u064a\u0629 \u0645\u062a\u0648\u0627\u0632\u064a\u0629 \u0645\u0633\u062c\u0644\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0631\u0627\u062c\u0639."}</div>',
        '        )}',
        '      </div>',
        '      {nextStep ? ('
    )
    $page=$page.Substring(0,$listIndex) + $workItemUi + $page.Substring($listIndex + $listMarker.Length)
}

if (-not $page.Contains('{"\u0623\u062f\u0648\u0627\u0631 \u0645\u0631\u062a\u0628\u0637\u0629: "}{roleNames(stage.responsibleRoles)}')) {
    $rolePattern='<div className="mt-2 text-xs text-gray-500">[^<\r\n]*\{roleNames\(stage\.responsibleRoles\)\}</div>'
    $roleMatch=[regex]::Match($page,$rolePattern)
    if (-not $roleMatch.Success) { throw "Legacy journey role label could not be located safely. Stop for review." }
    $roleReplacement='<div className="mt-2 text-xs text-gray-500">{"\u0623\u062f\u0648\u0627\u0631 \u0645\u0631\u062a\u0628\u0637\u0629: "}{roleNames(stage.responsibleRoles)}</div>'
    $page=$page.Substring(0,$roleMatch.Index) + $roleReplacement + $page.Substring($roleMatch.Index + $roleMatch.Length)
}

[System.IO.File]::WriteAllText($journeyPath,$journey,(New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText($pagePath,$page,(New-Object System.Text.UTF8Encoding($false)))

$journeyCheck=[System.IO.File]::ReadAllText($journeyPath,[System.Text.Encoding]::UTF8)
$pageCheck=[System.IO.File]::ReadAllText($pagePath,[System.Text.Encoding]::UTF8)
foreach ($needle in @(
    'export type DerivedJourneyWorkItem = {',
    'export function deriveJourneyWorkItems(',
    'assignedUser?.fullName ?? item.assignedUnit?.name',
    'terminal: ["COMPLETED", "CANCELLED"].includes(item.status)'
)) {
    if (-not $journeyCheck.Contains($needle)) { throw "Phase 5B journey source assertion failed: $needle" }
}
foreach ($needle in @(
    'prisma.patientWorkItem.findMany',
    'where: { patientId: patient.guid }',
    'assignedUser: { select: { fullName: true } }',
    'assignedUnit: { select: { name: true } }',
    'deriveJourneyWorkItems(patient.id, journeyWorkItems)',
    'workItems={derivedJourneyWorkItems}',
    'patient-parallel-workitems',
    'workItems: DerivedJourneyWorkItem[];'
)) {
    if (-not $pageCheck.Contains($needle)) { throw "Phase 5B patient page source assertion failed: $needle" }
}
if (-not $journeyCheck.Contains('careStages')) { throw "Legacy CareStage journey compatibility was unexpectedly removed." }
if (-not $journeyCheck.Contains('currentCareStage')) { throw "Legacy currentCareStage compatibility was unexpectedly removed." }
Write-Host "Journey parallel PatientWorkItem presentation cutover: PASS"

Write-Host ""
Write-Host "=== BUILD CHECKS IMAGE ==="
Invoke-Compose @("--profile","checks","build","checks")

Write-Host ""
Write-Host "=== PRISMA VALIDATE + GENERATE ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","validate","--schema","prisma/schema.prisma")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","prisma","generate")

Write-Host ""
Write-Host "=== TYPESCRIPT + TARGETED TESTS ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npx","tsc","--noEmit")
$targetTests=@()
foreach ($candidate in @(
    "tests/unit/patient-journey.test.ts",
    "tests/unit/patient-work-item.test.ts",
    "tests/unit/patient-work-item-scope.test.ts"
)) {
    if (Test-Path -LiteralPath (Join-Path $Project $candidate)) { $targetTests += $candidate }
}
if ($targetTests.Count -gt 0) {
    Invoke-Compose (@("--profile","checks","run","--rm","--no-deps","checks","npx","vitest","run") + $targetTests)
}

Write-Host ""
Write-Host "=== PROJECT AUDIT + BUILD ==="
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","node","scripts/audit-project.mjs")
Invoke-Compose @("--profile","checks","run","--rm","--no-deps","checks","npm","run","build")

$countsAfter=Invoke-PsqlText $countsSql
if ($countsAfter.Trim() -ne $countsBefore.Trim()) { throw "Database row counts changed during Phase 5B code-only cutover." }
Write-Host "Database write guard: PASS"

$httpCode=(& curl.exe -sS -L -o NUL -w "%{http_code}" --max-time 15 "http://localhost:3000/api/auth/signin" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $httpCode -notmatch '^\d{3}$') { throw "Running app login smoke failed: $httpCode" }
$code=[int]$httpCode
if ($code -lt 200 -or $code -ge 400) { throw "Running app login smoke failed with HTTP $code" }
Write-Host "Running app login smoke: PASS (HTTP $code)"

$auditDir=Join-Path $Project "_PHASE01_AUDIT"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$reportPath=Join-Path $auditDir "31-PHASE5-JOURNEY-PARALLEL-WORKITEM-CUTOVER.md"
$report=@"
# Phase 5B - Journey Parallel PatientWorkItem Cutover

Status: PASS

Implemented:
- Patient detail journey now loads PatientWorkItem rows by Patient.guid and presents them as parallel operational work.
- Operational assignment is shown from actual assigned User or Unit only; Role is not used as PatientWorkItem ownership.
- Legacy CareStage/currentCareStage-derived journey remains in place for history and compatibility in this batch.
- Legacy journey role text is presentation-only and is relabeled as related roles, not operational ownership.
- PatientWorkItem status, assignee, latest activity, note, and preserved patient deep links are shown without adding mutation controls.
- Referral work items link to the patient referrals tab; other work items link to the journey tab.
- No notification behavior changed in this batch.
- No PatientWorkItem mutation action or API was added; server-side mutation authorization remains in the PatientWorkItem service/scope layer.

Verification:
- Prisma validate + generate PASS.
- TypeScript PASS.
- Available targeted journey/work-item tests PASS.
- project audit PASS.
- production build PASS.
- database write guard PASS.
- running app login smoke PASS (HTTP $code).

Safety:
- Code-only cutover; no migration created or applied.
- CareStage and PATHWAY_DEFAULT were not deleted.
- No app container restart.
- Original live server untouched.

Rollback snapshot:
$rollbackDir

Next:
- Inventory/cut over the remaining journey presentation surfaces (journey print, portal, patients-care) without deleting legacy history yet, then continue patient-specific notification classification.
"@
[System.IO.File]::WriteAllText($reportPath,$report,(New-Object System.Text.UTF8Encoding($true)))

Write-Host ""
Write-Host "=================================================="
Write-Host "PHASE 5B JOURNEY PARALLEL WORKITEM CUTOVER: PASS"
Write-Host "=================================================="
Write-Host ""
Write-Host "Report: $reportPath"
Write-Host "Rollback snapshot: $rollbackDir"
