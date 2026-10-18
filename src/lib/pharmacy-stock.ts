import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/access";

/**
 * Independent branch pharmacies (owner decision 2026-10-18).
 *
 * - Physical stock is owned by exactly one branch: MedicationBatch.branchId (NULL = UNASSIGNED legacy stock, never
 *   dispensable until a verified count assigns it).
 * - The medication CATALOG (name, unit, reorder threshold) is shared; quantities are never merged across branches.
 * - A stock mutation (receive, adjust, dispose, dispense, care consumption) is only possible through the actor's own
 *   ACTIVE branch. There is no ADMIN, central or branchless bypass, no pooling and no transfer.
 * - Read visibility: a branch account sees its own branch; ADMIN may view all branches (read-only).
 */
export type StockActor = { userId: string; role: UserRole; branchId: number; name: string | null };
export type StockViewer = { userId: string; role: UserRole; isAdmin: boolean; branchId: number | null };

export const NO_BRANCH_PHARMACY = "لا يوجد فرع صيدلية فعّال مرتبط بحسابك؛ لا يمكن تنفيذ عمليات المخزون";

async function activeBranchOf(userId: string, role: UserRole) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } },
  });
  if (!user?.isActive || user.role !== role) return null;
  if (user.branchId == null || !user.branch?.isActive) return null;
  return user.branchId;
}

/** The signed-in account with its verified active branch, or null (branchless / inactive / stale role). */
export async function currentStockActor(): Promise<StockActor | null> {
  const session = await getSession();
  const user = session?.user as { id?: string; role?: UserRole; name?: string | null } | undefined;
  if (!user?.id || !user.role) return null;
  const branchId = await activeBranchOf(user.id, user.role);
  return branchId == null ? null : { userId: user.id, role: user.role, branchId, name: user.name ?? null };
}

export async function requireStockActor(): Promise<StockActor> {
  const actor = await currentStockActor();
  if (!actor) throw new Error(NO_BRANCH_PHARMACY);
  return actor;
}

export async function currentStockViewer(): Promise<StockViewer | null> {
  const session = await getSession();
  const user = session?.user as { id?: string; role?: UserRole } | undefined;
  if (!user?.id || !user.role) return null;
  const branchId = await activeBranchOf(user.id, user.role);
  return { userId: user.id, role: user.role, isAdmin: user.role === "ADMIN", branchId };
}

const NONE = -1; // no branch id is ever negative: matches nothing

/** Batches the viewer may SEE. ADMIN: every branch plus unassigned legacy stock (read-only). Others: own branch only. */
export function batchViewWhere(v: StockViewer | null): Prisma.MedicationBatchWhereInput {
  if (!v) return { branchId: NONE };
  if (v.isAdmin) return {};
  return { branchId: v.branchId ?? NONE };
}

export function movementViewWhere(v: StockViewer | null): Prisma.StockMovementWhereInput {
  if (!v) return { branchId: NONE };
  if (v.isAdmin) return {};
  return { branchId: v.branchId ?? NONE };
}

export function orderViewWhere(v: StockViewer | null): Prisma.PurchaseOrderWhereInput {
  if (!v) return { branchId: NONE };
  if (v.isAdmin) return {};
  return { branchId: v.branchId ?? NONE };
}

/** Quantity per medication inside the viewer's visible stock (sum of that branch's batches; never other branches'). */
export async function visibleQuantities(v: StockViewer | null, medicationIds?: number[]) {
  const rows = await prisma.medicationBatch.groupBy({
    by: ["medicationId"],
    where: { ...batchViewWhere(v), ...(medicationIds ? { medicationId: { in: medicationIds } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.medicationId, r._sum.quantity ?? 0]));
}

/** Overlays the viewer's own-branch quantity on a (cached, shared) medication catalog. */
export async function withViewerQuantities<T extends { id: number; quantity: number }>(meds: T[]): Promise<T[]> {
  const qty = await visibleQuantities(await currentStockViewer());
  return meds.map((m) => ({ ...m, quantity: qty.get(m.id) ?? 0 }));
}

/** Medications at or below their reorder threshold within the viewer's visible stock. */
export async function lowStockMedications(v: StockViewer | null) {
  if (!v || (!v.isAdmin && v.branchId == null)) return [];
  const [meds, qty] = await Promise.all([
    prisma.medication.findMany({ select: { id: true, name: true, minQuantity: true, unit: true } }),
    visibleQuantities(v),
  ]);
  return meds
    .map((m) => ({ ...m, quantity: qty.get(m.id) ?? 0 }))
    .filter((m) => m.quantity <= m.minQuantity);
}

/** Pharmacists of a branch (recipients of that branch's stock notices). */
export async function branchPharmacistIds(branchId: number) {
  return (await prisma.user.findMany({ where: { role: "PHARMACIST", isActive: true, branchId }, select: { id: true } })).map((u) => u.id);
}
