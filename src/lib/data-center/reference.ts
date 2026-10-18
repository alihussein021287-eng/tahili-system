import type { PrismaClient, Prisma } from "@prisma/client";
import type { RefName } from "./registry";

type Db = PrismaClient | Prisma.TransactionClient;
export type References = Record<RefName, string[]>;

/** Live reference lists exactly as the application's forms use them (same tables, same visibility rules). */
export async function loadReferences(db: Db): Promise<References> {
  const names = (rows: { name: string }[]) => rows.map((r) => r.name.trim()).filter(Boolean);
  const [governorates, injuryTypes, centers, ranks, formations, mobilityAids, prostheticTypes] = await Promise.all([
    db.governorate.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.injuryType.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.center.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
    db.rank.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.formation.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.mobilityAid.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.prostheticType.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  return { governorates: names(governorates), injuryTypes: names(injuryTypes), centers: names(centers), ranks: names(ranks), formations: names(formations), mobilityAids: names(mobilityAids), prostheticTypes: names(prostheticTypes) };
}
