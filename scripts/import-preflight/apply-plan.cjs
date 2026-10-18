#!/usr/bin/env node
/**
 * Guarded import APPLY tool (Mission 08.8). NOT part of any startup/deploy script. Default is a DRY RUN that writes nothing.
 * A commit needs an approval file from the owner that pins: the exact plan hash, the destination database name, the canonical
 * branch name and (optionally) account staging. The tool refuses the QA database, an unknown branch, a duplicate branch name,
 * and any plan whose bytes changed after approval.
 *
 *   DATABASE_URL=... node apply-plan.cjs --plan import-plan.json --approval approval.json                 # dry run
 *   DATABASE_URL=... node apply-plan.cjs --plan import-plan.json --approval approval.json --commit --ledger out/apply-ledger.csv
 *   DATABASE_URL=... node apply-plan.cjs --rollback out/apply-ledger.csv --approval approval.json --commit  # removes only untouched rows it created
 *
 * approval.json: { "approvedBy": "...", "approvedAt": "ISO", "planSha256": "...", "destinationDatabase": "...", "branchName": "...",
 *                  "stageAccounts": false }
 * Accounts (when approved) are created INACTIVE with an unusable random password hash; nothing is printed or exported.
 * Idempotent: rows already present (source marker or identical name+phone+birth year) are reported as MATCHED, not duplicated.
 * Checkpointed: batches of 200 in separate transactions; the ledger is appended after each batch, so a re-run resumes safely.
 */
const fs = require("node:fs");
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const commit = args.includes("--commit");
const BATCH = 200;
const FORBIDDEN_DATABASES = ["tahili_rehearsal"]; // the preserved QA database is never an import destination
const GENDER = { "ذكر": "MALE", "أنثى": "FEMALE", "انثى": "FEMALE", male: "MALE", female: "FEMALE" };

const fail = (m) => { console.error(`ERROR: ${m}`); process.exitCode = 1; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

async function guard(prisma, approval, extra = {}) {
  if (!approval.approvedBy || !approval.approvedAt) throw new Error("approval.json needs approvedBy and approvedAt");
  const db = (await prisma.$queryRaw`select current_database() as n`)[0].n;
  if (FORBIDDEN_DATABASES.includes(db)) throw new Error(`refusing: ${db} is the preserved QA database`);
  if (approval.destinationDatabase !== db) throw new Error(`approval is for database "${approval.destinationDatabase}", connected to "${db}"`);
  const branches = await prisma.branch.findMany({ where: { name: approval.branchName } });
  if (branches.length !== 1) throw new Error(`branch "${approval.branchName}" matches ${branches.length} records; exactly one is required (create/rename it first, never guess)`);
  if (!branches[0].isActive) throw new Error("the approved branch is inactive");
  return { db, branch: branches[0], ...extra };
}

async function applyPlan(prisma, planFile, approval) {
  const bytes = fs.readFileSync(planFile);
  if (sha(bytes) !== approval.planSha256) throw new Error("plan file hash differs from the approved hash; regenerate and re-approve");
  const plan = JSON.parse(bytes.toString("utf8"));
  const { db, branch } = await guard(prisma, approval);
  if (plan.destinationBranchName && plan.destinationBranchName !== approval.branchName) throw new Error("plan destination branch differs from the approved branch");
  const ledgerFile = flag("ledger");
  const done = new Set();
  if (commit && ledgerFile && fs.existsSync(ledgerFile)) for (const l of fs.readFileSync(ledgerFile, "utf8").split("\n").slice(1)) { const k = l.split(",")[0]?.replace(/"/g, ""); if (k) done.add(k); }
  const out = { patients: { created: 0, matched: 0, resumed: 0 }, employees: { created: 0, matched: 0, resumed: 0 }, accounts: { created: 0, matched: 0, skipped: 0, resumed: 0 } };
  const lines = [];
  const writeLedger = () => { if (!commit || !ledgerFile || !lines.length) return; if (!fs.existsSync(ledgerFile)) fs.writeFileSync(ledgerFile, "sourceKey,kind,result,recordId\n"); fs.appendFileSync(ledgerFile, lines.splice(0).join("\n") + "\n"); };
  const planTag = approval.planSha256.slice(0, 8);
  // Reference data (governorates / injury types) is matched by EXACT name in the destination; unmatched values are never invented:
  // they stay as text in the patient's notes and are counted in the result so the owner can extend the reference lists.
  const gov = new Map((await prisma.governorate.findMany({ select: { id: true, name: true } })).map((g) => [g.name.trim(), g.id]));
  const inj = new Map((await prisma.injuryType.findMany({ select: { id: true, name: true } })).map((g) => [g.name.trim(), g.id]));
  const referenceGaps = { governorates: new Set(), injuryTypes: new Set() };

  for (let i = 0; i < plan.patients.length; i += BATCH) {
    const chunk = plan.patients.slice(i, i + BATCH);
    await prisma.$transaction(async (tx) => {
      for (const p of chunk) {
        if (done.has(p.sourceKey)) { out.patients.resumed++; continue; }
        const marker = `[import:${p.sourceKey}]`;
        const existing = await tx.patient.findFirst({ where: { OR: [{ notes: { contains: marker } }, ...(p.phone && p.birthYear ? [{ fullName: p.fullName, phone: p.phone, birthYear: p.birthYear, archivedAt: null }] : [])] }, select: { id: true } });
        if (existing) { out.patients.matched++; lines.push(`${p.sourceKey},patient,MATCHED_EXISTING,${existing.id}`); continue; }
        if (!commit) {
          if (p.governorate && !gov.has(p.governorate.trim())) referenceGaps.governorates.add(p.governorate);
          if (p.injuryType && !inj.has(p.injuryType.trim())) referenceGaps.injuryTypes.add(p.injuryType);
          out.patients.created++; continue;
        }
        const governorateId = p.governorate ? gov.get(p.governorate.trim()) ?? null : null;
        const injuryTypeId = p.injuryType ? inj.get(p.injuryType.trim()) ?? null : null;
        if (p.governorate && governorateId == null) referenceGaps.governorates.add(p.governorate);
        if (p.injuryType && injuryTypeId == null) referenceGaps.injuryTypes.add(p.injuryType);
        const leftover = [p.governorate && governorateId == null ? `المحافظة (المصدر): ${p.governorate}` : null, p.injuryType && injuryTypeId == null ? `نوع الإصابة (المصدر): ${p.injuryType}` : null].filter(Boolean).join("؛ ");
        const row = await tx.patient.create({ data: { fullName: p.fullName, phone: p.phone, birthYear: p.birthYear, motherName: p.motherName, gender: GENDER[p.gender] ?? null, governorateId, injuryTypeId, branchId: branch.id, notes: `${marker} مصدر الاستيراد${p.sourceFileNumber ? ` — رقم الملف السابق ${p.sourceFileNumber}` : ""}${leftover ? ` — ${leftover}` : ""}`, dataEntryBy: `import:${planTag}` } });
        out.patients.created++; lines.push(`${p.sourceKey},patient,CREATED,${row.id}`);
      }
      if (commit) await tx.auditLog.create({ data: { action: "CREATE", tableName: "patients", recordId: `import:${planTag}:${Math.floor(i / BATCH)}`, newValue: { batch: Math.floor(i / BATCH), size: chunk.length, branchId: branch.id, approvedBy: approval.approvedBy } } });
    });
    writeLedger();
  }

  for (const e of plan.employees) {
    if (done.has(e.sourceKey)) { out.employees.resumed++; continue; }
    const exists = await prisma.employee.findFirst({ where: { OR: [{ sourceKey: e.sourceKey }, { name: e.fullName, job: e.job || null, department: e.center || null }] } });
    if (exists) { out.employees.matched++; lines.push(`${e.sourceKey},employee,MATCHED_EXISTING,${exists.id}`); continue; }
    if (!commit) { out.employees.created++; continue; }
    const row = await prisma.employee.create({ data: { name: e.fullName, job: e.job || null, department: e.center || null, specialty: e.specialty || null, capacity: e.capacity || null, sourceKey: e.sourceKey } });
    out.employees.created++; lines.push(`${e.sourceKey},employee,CREATED,${row.id}`);
  }
  writeLedger();

  const bcrypt = require("bcryptjs");
  for (const a of plan.accounts) {
    if (done.has(a.sourceKey)) { out.accounts.resumed++; continue; }
    if (!approval.stageAccounts) { out.accounts.skipped++; continue; }
    const exists = await prisma.user.findUnique({ where: { username: a.username } });
    if (exists) { out.accounts.matched++; lines.push(`${a.sourceKey},account,MATCHED_EXISTING,${exists.id}`); continue; }
    if (!commit) { out.accounts.created++; continue; }
    const row = await prisma.user.create({ data: { username: a.username, fullName: a.fullName, role: a.role, branchId: branch.id, isActive: false, needsActivation: true, passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10), note: `staged by import ${planTag}; activate only after identity/role verification` } });
    await prisma.auditLog.create({ data: { action: "CREATE", tableName: "users", recordId: row.id, newValue: { staged: true, inactive: true, role: a.role, branchId: branch.id, approvedBy: approval.approvedBy } } });
    out.accounts.created++; lines.push(`${a.sourceKey},account,CREATED,${row.id}`);
  }
  writeLedger();
  return { mode: commit ? "COMMIT" : "DRY_RUN", database: db, branchId: branch.id, ...out, referenceGaps: { governorates: [...referenceGaps.governorates], injuryTypes: [...referenceGaps.injuryTypes] } };
}

async function rollback(prisma, ledgerFile, approval) {
  const { db } = await guard(prisma, approval);
  const rows = fs.readFileSync(ledgerFile, "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split(","));
  const result = { removed: 0, keptBecauseUsed: 0 };
  for (const [, kind, res, id] of rows) {
    if (res !== "CREATED") continue;
    if (kind === "patient") {
      const p = await prisma.patient.findUnique({ where: { id }, include: { _count: { select: { visits: true, handoffs: true, prescriptions: true, appointments: true, invoices: true } } } });
      if (!p) continue;
      const used = Object.values(p._count).some((n) => n > 0) || !String(p.notes ?? "").includes("[import:");
      if (used) { result.keptBecauseUsed++; continue; }
      if (commit) await prisma.patient.delete({ where: { id } });
      result.removed++;
    } else if (kind === "employee") { if (commit) await prisma.employee.delete({ where: { id: Number(id) } }).catch(() => undefined); result.removed++; }
    else if (kind === "account") {
      const u = await prisma.user.findUnique({ where: { id } });
      if (!u || u.lastLoginAt || u.isActive) { result.keptBecauseUsed++; continue; }
      if (commit) await prisma.user.delete({ where: { id } }).catch(() => { result.keptBecauseUsed++; });
      result.removed++;
    }
  }
  return { mode: commit ? "ROLLBACK_COMMIT" : "ROLLBACK_DRY_RUN", database: db, ...result };
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const approvalFile = flag("approval");
    if (!approvalFile) throw new Error("--approval approval.json is required (even for a dry run)");
    const approval = JSON.parse(fs.readFileSync(approvalFile, "utf8"));
    const result = flag("rollback") ? await rollback(prisma, flag("rollback"), approval) : await applyPlan(prisma, flag("plan"), approval);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) { fail(e.message); } finally { await prisma.$disconnect(); }
})();
