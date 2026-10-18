#!/usr/bin/env node
/**
 * Branch pharmacy stock initialization & reconciliation (independent branch pharmacies, owner decision 2026-10-18).
 *
 * Legacy stock (batches/prescriptions/purchase orders created before branch ownership) has NO branch and is never
 * dispensable. It is assigned only by this operator procedure, from a VERIFIED physical count, with an audit record.
 * The script never invents a quantity, never splits a batch across branches by guessing, never transfers stock.
 *
 * Dry run is the default. Nothing is written without --apply.
 *
 *   node scripts/pharmacy-branch-stock.cjs report
 *   node scripts/pharmacy-branch-stock.cjs opening-balance --file counts.csv [--apply]
 *   node scripts/pharmacy-branch-stock.cjs assign-batch --batch-id 12 --branch-id 3 --counted-quantity 40 --counted-by "اسم" [--apply]
 *   node scripts/pharmacy-branch-stock.cjs assign-prescription --id <rxId> --branch-id 3 --reason "..." --counted-by "اسم" [--apply]
 *   node scripts/pharmacy-branch-stock.cjs assign-prescription-visit --id <rxId> --visit-id <visitId> --reason "..." --counted-by "اسم" [--apply]
 *   node scripts/pharmacy-branch-stock.cjs assign-order --id <orderId> --branch-id 3 --counted-by "اسم" [--apply]
 *
 * counts.csv header: branchId,medication,unit,batchNo,expiryDate,quantity,countedBy,countDate,evidenceRef,approvedBy,purchaseRef
 *   (expiryDate YYYY-MM-DD or empty; medication = exact catalog name; unit must equal the catalog unit; quantity = verified physical
 *    count >= 0; evidenceRef = signed count sheet / stock-take document id; approvedBy = authorized approver; purchaseRef optional)
 */
const fs = require("node:fs");
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes("--apply");
const prisma = new PrismaClient();
const fail = (msg) => { console.error(`ERROR: ${msg}`); process.exitCode = 1; };
const mode = apply ? "APPLY" : "DRY-RUN (nothing written; add --apply)";

async function branchOrFail(id) {
  const branch = Number.isInteger(id) ? await prisma.branch.findUnique({ where: { id } }) : null;
  if (!branch || !branch.isActive) throw new Error(`branch ${id} does not exist or is inactive`);
  return branch;
}

function parseCsv(text) {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length);
  const split = (line) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = split(rows[0]);
  const need = ["branchId", "medication", "unit", "batchNo", "expiryDate", "quantity", "countedBy", "countDate", "evidenceRef", "approvedBy", "purchaseRef"];
  for (const h of need) if (!header.includes(h)) throw new Error(`CSV header missing column ${h}`);
  return rows.slice(1).map((line, i) => {
    const cells = split(line);
    const row = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""]));
    row._line = i + 2;
    return row;
  });
}

async function report() {
  const [unBatches, unRx, unOrders, perBranch, branches] = await Promise.all([
    prisma.medicationBatch.findMany({ where: { branchId: null, quantity: { gt: 0 } }, include: { medication: { select: { name: true } } }, orderBy: { id: "asc" } }),
    prisma.prescription.count({ where: { prescriptionType: "INTERNAL", originBranchId: null, status: { in: ["PENDING", "PARTIAL"] } } }),
    prisma.purchaseOrder.count({ where: { branchId: null } }),
    prisma.medicationBatch.groupBy({ by: ["branchId"], where: { branchId: { not: null } }, _sum: { quantity: true }, _count: { _all: true } }),
    prisma.branch.findMany({ select: { id: true, name: true, isActive: true } }),
  ]);
  console.log("== UNASSIGNED legacy batches (not dispensable; require verified count) ==");
  for (const b of unBatches) console.log(`batch ${b.id}  ${b.medication.name}  batchNo=${b.batchNo ?? "-"}  qty=${b.quantity}  expiry=${b.expiryDate ? b.expiryDate.toISOString().slice(0, 10) : "-"}`);
  console.log(`unassigned batches with stock: ${unBatches.length}`);
  console.log(`open INTERNAL prescriptions without origin branch: ${unRx}`);
  console.log(`purchase orders without destination branch: ${unOrders}`);
  console.log("== BRANCH STOCK ==");
  for (const br of branches) {
    const row = perBranch.find((p) => p.branchId === br.id);
    console.log(`branch ${br.id} ${br.name}${br.isActive ? "" : " (inactive)"}: batches=${row?._count._all ?? 0} units=${row?._sum.quantity ?? 0}`);
  }
}

async function openingBalance() {
  const file = flag("file");
  if (!file) throw new Error("--file counts.csv is required");
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const planned = [];
  const problems = [];
  for (const r of rows) {
    const branchId = Number(r.branchId);
    const qty = Number(r.quantity);
    if (!Number.isInteger(qty) || qty < 0) { problems.push(`line ${r._line}: quantity must be a whole number >= 0`); continue; }
    if (!r.countedBy) { problems.push(`line ${r._line}: countedBy is required (verified count)`); continue; }
    if (!r.evidenceRef) { problems.push(`line ${r._line}: evidenceRef is required (count sheet / stock-take document)`); continue; }
    if (!r.approvedBy) { problems.push(`line ${r._line}: approvedBy is required (authorized approver)`); continue; }
    if (!r.unit) { problems.push(`line ${r._line}: unit is required`); continue; }
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.countDate)) { problems.push(`line ${r._line}: countDate must be YYYY-MM-DD`); continue; }
    const exp = r.expiryDate ? new Date(`${r.expiryDate}T00:00:00Z`) : null;
    if (r.expiryDate && Number.isNaN(exp.getTime())) { problems.push(`line ${r._line}: bad expiryDate`); continue; }
    let branch;
    try { branch = await branchOrFail(branchId); } catch (e) { problems.push(`line ${r._line}: ${e.message}`); continue; }
    const med = await prisma.medication.findUnique({ where: { name: r.medication } });
    if (!med) { problems.push(`line ${r._line}: medication "${r.medication}" not in catalog`); continue; }
    if (med.unit && med.unit !== r.unit) { problems.push(`line ${r._line}: unit "${r.unit}" differs from catalog unit "${med.unit}"`); continue; }
    const dup = await prisma.medicationBatch.findFirst({ where: { branchId, medicationId: med.id, batchNo: r.batchNo || null, expiryDate: exp } });
    if (dup) { problems.push(`line ${r._line}: batch already exists for branch ${branchId} (batch ${dup.id}); opening balance is not applied twice`); continue; }
    planned.push({ branch, med, qty, exp, batchNo: r.batchNo || null, countedBy: r.countedBy, countDate: r.countDate, evidenceRef: r.evidenceRef, approvedBy: r.approvedBy, purchaseRef: r.purchaseRef || null });
  }
  console.log(`[${mode}] opening-balance: ${planned.length} batch(es) valid, ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  PROBLEM ${p}`);
  for (const p of planned) console.log(`  + branch ${p.branch.id} ${p.med.name} batchNo=${p.batchNo ?? "-"} qty=${p.qty} expiry=${p.exp ? p.exp.toISOString().slice(0, 10) : "-"} counted by ${p.countedBy}`);
  if (problems.length) { process.exitCode = 1; console.log("Nothing applied: fix the problems first (all-or-nothing)."); return; }
  if (!apply) return;
  await prisma.$transaction(async (tx) => {
    for (const p of planned) {
      const batch = await tx.medicationBatch.create({ data: { medicationId: p.med.id, branchId: p.branch.id, quantity: p.qty, batchNo: p.batchNo, expiryDate: p.exp, note: `رصيد افتتاحي مُتحقَّق منه — عدّ: ${p.countedBy}؛ اعتماد: ${p.approvedBy}؛ إثبات: ${p.evidenceRef}${p.purchaseRef ? `؛ مرجع شراء: ${p.purchaseRef}` : ""} (${p.countDate})` } });
      if (p.qty > 0) await tx.stockMovement.create({ data: { type: "IN", medicationId: p.med.id, batchId: batch.id, quantity: p.qty, branchId: p.branch.id, reason: `OPENING_BALANCE ref:${p.evidenceRef} approved:${p.approvedBy}`, byName: p.countedBy } });
      await tx.auditLog.create({ data: { action: "CREATE", tableName: "medication_batches", recordId: String(batch.id), newValue: { operation: "OPENING_BALANCE", branchId: p.branch.id, medicationId: p.med.id, quantity: p.qty, unit: p.med.unit, countedBy: p.countedBy, countDate: p.countDate, evidenceRef: p.evidenceRef, approvedBy: p.approvedBy, purchaseRef: p.purchaseRef } } });
      const agg = await tx.medicationBatch.aggregate({ where: { medicationId: p.med.id }, _sum: { quantity: true } });
      await tx.medication.update({ where: { id: p.med.id }, data: { quantity: agg._sum.quantity ?? 0 } });
    }
  });
  console.log("APPLIED.");
}

async function assignBatch() {
  const batchId = Number(flag("batch-id"));
  const branch = await branchOrFail(Number(flag("branch-id")));
  const counted = Number(flag("counted-quantity"));
  const countedBy = flag("counted-by");
  if (!Number.isInteger(batchId)) throw new Error("--batch-id required");
  if (!Number.isInteger(counted) || counted < 0) throw new Error("--counted-quantity must be a whole number >= 0 (verified physical count)");
  if (!countedBy) throw new Error("--counted-by required");
  const b = await prisma.medicationBatch.findUnique({ where: { id: batchId }, include: { medication: true } });
  if (!b) throw new Error("batch not found");
  if (b.branchId != null) throw new Error(`batch already belongs to branch ${b.branchId}; no transfer between branches`);
  const delta = counted - b.quantity;
  console.log(`[${mode}] assign batch ${b.id} (${b.medication.name}) to branch ${branch.id} ${branch.name}: recorded ${b.quantity}, counted ${counted}, adjustment ${delta >= 0 ? "+" : ""}${delta}`);
  if (!apply) return;
  await prisma.$transaction(async (tx) => {
    const upd = await tx.medicationBatch.updateMany({ where: { id: batchId, branchId: null }, data: { branchId: branch.id, quantity: counted } });
    if (upd.count !== 1) throw new Error("batch changed concurrently; nothing applied");
    await tx.stockMovement.create({ data: { type: "ADJUST", medicationId: b.medicationId, batchId, quantity: Math.abs(delta), branchId: branch.id, reason: `RECONCILIATION ${delta >= 0 ? "+" : "-"} assigned from legacy shared stock`, byName: countedBy } });
    await tx.auditLog.create({ data: { action: "UPDATE", tableName: "medication_batches", recordId: String(batchId), newValue: { operation: "ASSIGN_LEGACY_BATCH", branchId: branch.id, recorded: b.quantity, counted, countedBy } } });
    const agg = await tx.medicationBatch.aggregate({ where: { medicationId: b.medicationId }, _sum: { quantity: true } });
    await tx.medication.update({ where: { id: b.medicationId }, data: { quantity: agg._sum.quantity ?? 0 } });
  });
  console.log("APPLIED.");
}

async function assignPrescription() {
  const id = flag("id");
  const branch = await branchOrFail(Number(flag("branch-id")));
  const reason = flag("reason");
  const countedBy = flag("counted-by");
  if (!id || !reason || !countedBy) throw new Error("--id, --reason and --counted-by are required");
  const rx = await prisma.prescription.findUnique({ where: { id } });
  if (!rx) throw new Error("prescription not found");
  if (rx.originBranchId != null) throw new Error(`prescription already has origin branch ${rx.originBranchId}`);
  console.log(`[${mode}] assign prescription ${id} origin -> branch ${branch.id} ${branch.name} (reason: ${reason})`);
  if (!apply) return;
  await prisma.$transaction(async (tx) => {
    const upd = await tx.prescription.updateMany({ where: { id, originBranchId: null }, data: { originBranchId: branch.id } });
    if (upd.count !== 1) throw new Error("prescription changed concurrently; nothing applied");
    await tx.auditLog.create({ data: { action: "UPDATE", tableName: "prescriptions", recordId: id, newValue: { operation: "ASSIGN_LEGACY_PRESCRIPTION_ORIGIN", branchId: branch.id, reason, by: countedBy } } });
  });
  console.log("APPLIED.");
}

// Legacy prescription -> an exact, verified Visit of the SAME patient (never inferred). The origin branch becomes the visit's branch.
async function assignPrescriptionVisit() {
  const id = flag("id");
  const visitId = flag("visit-id");
  const reason = flag("reason");
  const countedBy = flag("counted-by");
  if (!id || !visitId || !reason || !countedBy) throw new Error("--id, --visit-id, --reason and --counted-by are required");
  const rx = await prisma.prescription.findUnique({ where: { id } });
  if (!rx) throw new Error("prescription not found");
  if (rx.visitId != null) throw new Error(`prescription already linked to visit ${rx.visitId}`);
  if (rx.dispensedQty > 0) throw new Error("prescription already (partly) dispensed; provenance cannot be rewritten");
  const visit = await prisma.visit.findFirst({ where: { id: visitId, patientId: rx.patientId }, include: { branch: true } });
  if (!visit) throw new Error("visit does not exist for this prescription's patient");
  if (visit.branchId == null || !visit.branch.isActive) throw new Error("visit has no active receiving branch");
  if (rx.originBranchId != null && rx.originBranchId !== visit.branchId) throw new Error(`prescription origin branch ${rx.originBranchId} differs from the visit's branch ${visit.branchId}; resolve manually`);
  console.log(`[${mode}] link prescription ${id} -> visit ${visitId} (branch ${visit.branchId} ${visit.branch.name}); reason: ${reason}`);
  if (!apply) return;
  await prisma.$transaction(async (tx) => {
    const upd = await tx.prescription.updateMany({ where: { id, visitId: null, dispensedQty: 0 }, data: { visitId, originBranchId: visit.branchId } });
    if (upd.count !== 1) throw new Error("prescription changed concurrently; nothing applied");
    await tx.auditLog.create({ data: { action: "UPDATE", tableName: "prescriptions", recordId: id, newValue: { operation: "ASSIGN_LEGACY_PRESCRIPTION_VISIT", visitId, branchId: visit.branchId, reason, by: countedBy } } });
  });
  console.log("APPLIED.");
}

async function assignOrder() {
  const id = flag("id");
  const branch = await branchOrFail(Number(flag("branch-id")));
  const countedBy = flag("counted-by");
  if (!id || !countedBy) throw new Error("--id and --counted-by are required");
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!order) throw new Error("purchase order not found");
  if (order.branchId != null) throw new Error(`order already belongs to branch ${order.branchId}`);
  console.log(`[${mode}] assign purchase order ${order.orderNo} -> branch ${branch.id} ${branch.name}`);
  if (!apply) return;
  await prisma.$transaction(async (tx) => {
    const upd = await tx.purchaseOrder.updateMany({ where: { id, branchId: null }, data: { branchId: branch.id } });
    if (upd.count !== 1) throw new Error("order changed concurrently; nothing applied");
    await tx.auditLog.create({ data: { action: "UPDATE", tableName: "purchase_orders", recordId: id, newValue: { operation: "ASSIGN_LEGACY_ORDER_BRANCH", branchId: branch.id, by: countedBy } } });
  });
  console.log("APPLIED.");
}

const commands = { report, "opening-balance": openingBalance, "assign-batch": assignBatch, "assign-prescription": assignPrescription, "assign-prescription-visit": assignPrescriptionVisit, "assign-order": assignOrder };

(async () => {
  if (!commands[cmd]) { console.error(`usage: node scripts/pharmacy-branch-stock.cjs <${Object.keys(commands).join("|")}> [--apply]`); process.exitCode = 2; return; }
  try { await commands[cmd](); } catch (e) { fail(e.message); }
})().finally(() => prisma.$disconnect());
