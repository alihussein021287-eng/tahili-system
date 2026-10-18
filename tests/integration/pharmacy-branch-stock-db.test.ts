import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { batchViewWhere, orderViewWhere, visibleQuantities, lowStockMedications, type StockViewer } from "@/lib/pharmacy-stock";

// Rehearsal database only. Independent branch pharmacies: stock is owned by one branch; quantities are never merged,
// the database refuses negative stock and conditional decrements make concurrent debits of one batch safe.
const prisma = new PrismaClient();
const tag = `m087b-${randomUUID().slice(0, 8)}`;
let A = 0, B = 0, medId = 0;
const batch: Record<string, number> = {};

const viewer = (branchId: number | null, isAdmin = false): StockViewer => ({ userId: "u", role: isAdmin ? "ADMIN" : "PHARMACIST", isAdmin, branchId });
const qty = async (v: StockViewer) => (await visibleQuantities(v, [medId])).get(medId) ?? 0;

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  A = (await prisma.branch.create({ data: { name: `${tag} A` } })).id;
  B = (await prisma.branch.create({ data: { name: `${tag} B` } })).id;
  medId = (await prisma.medication.create({ data: { name: `${tag} med`, minQuantity: 5, unit: "علبة" } })).id;
  const soon = new Date(Date.now() + 30 * 86400000);
  const later = new Date(Date.now() + 200 * 86400000);
  batch.a1 = (await prisma.medicationBatch.create({ data: { medicationId: medId, branchId: A, quantity: 10, expiryDate: soon, batchNo: `${tag}-a1` } })).id;
  batch.b1 = (await prisma.medicationBatch.create({ data: { medicationId: medId, branchId: B, quantity: 3, expiryDate: later, batchNo: `${tag}-b1` } })).id;
  batch.legacy = (await prisma.medicationBatch.create({ data: { medicationId: medId, branchId: null, quantity: 100, batchNo: `${tag}-legacy` } })).id;
});
afterAll(async () => {
  await prisma.stockMovement.deleteMany({ where: { medicationId: medId } });
  await prisma.medicationBatch.deleteMany({ where: { medicationId: medId } });
  await prisma.medication.delete({ where: { id: medId } }).catch(() => {});
  await prisma.$disconnect();
});

describe("branch-owned stock (database)", () => {
  it("each branch sees only its own quantity; unassigned legacy stock is invisible to branch accounts", async () => {
    expect(await qty(viewer(A))).toBe(10);
    expect(await qty(viewer(B))).toBe(3);
    expect(await qty(viewer(null))).toBe(0);
  });

  it("ADMIN views all branches including unassigned stock (read-only)", async () => {
    expect(await qty(viewer(null, true))).toBe(113);
    expect(batchViewWhere(viewer(null, true))).toEqual({});
  });

  it("low-stock is computed per branch and empty for a branchless non-admin", async () => {
    const lowA = (await lowStockMedications(viewer(A))).some((m) => m.id === medId);
    const lowB = (await lowStockMedications(viewer(B))).some((m) => m.id === medId);
    expect(lowA).toBe(false); // 10 > 5
    expect(lowB).toBe(true); // 3 <= 5
    expect(await lowStockMedications(viewer(null))).toEqual([]);
  });

  it("purchase orders are visible only to the destination branch", async () => {
    expect(orderViewWhere(viewer(A))).toEqual({ branchId: A });
    expect(orderViewWhere(viewer(null))).toEqual({ branchId: -1 });
  });

  it("the database refuses negative stock", async () => {
    await expect(prisma.medicationBatch.update({ where: { id: batch.b1 }, data: { quantity: -1 } })).rejects.toThrow();
    await expect(prisma.medicationBatch.updateMany({ where: { id: batch.b1 }, data: { quantity: { decrement: 4 } } })).rejects.toThrow();
    expect((await prisma.medicationBatch.findUniqueOrThrow({ where: { id: batch.b1 } })).quantity).toBe(3);
  });

  it("concurrent conditional debits of one batch never overdraw it and never touch another branch", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => prisma.medicationBatch.updateMany({
      where: { id: batch.a1, branchId: A, quantity: { gte: 3 } }, data: { quantity: { decrement: 3 } },
    })));
    const won = results.filter((r) => r.count === 1).length;
    expect(won).toBe(3); // 10 -> 3 wins of 3, remainder 1
    expect((await prisma.medicationBatch.findUniqueOrThrow({ where: { id: batch.a1 } })).quantity).toBe(1);
    expect((await prisma.medicationBatch.findUniqueOrThrow({ where: { id: batch.b1 } })).quantity).toBe(3);
  });

  it("a debit scoped to a branch cannot match another branch's or a legacy batch", async () => {
    const cross = await prisma.medicationBatch.updateMany({ where: { id: batch.b1, branchId: A, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
    const legacy = await prisma.medicationBatch.updateMany({ where: { id: batch.legacy, branchId: A, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
    expect(cross.count).toBe(0);
    expect(legacy.count).toBe(0);
    expect((await prisma.medicationBatch.findUniqueOrThrow({ where: { id: batch.legacy } })).quantity).toBe(100);
  });
});
