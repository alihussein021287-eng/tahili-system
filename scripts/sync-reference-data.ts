import { Prisma, PrismaClient } from "@prisma/client";
import {
  APPROVED_REFERENCE_DATA,
  approvedReferenceCounts,
  assertApprovedReferenceData,
  isQaReferenceName,
  normalizeReferenceName,
} from "./reference-data";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type Db = Prisma.TransactionClient | PrismaClient;

function nameMap<T extends { name: string }>(items: T[]) {
  return new Map(items.map((item) => [normalizeReferenceName(item.name), item]));
}

async function snapshot(db: Db) {
  const [governorates, districts, branches, centers, halls, resources, formations, ranks, injuries, mobility, prosthetics, medications, batches] = await Promise.all([
    db.governorate.findMany({ select: { name: true } }),
    db.district.findMany({ select: { name: true, governorate: { select: { name: true } } } }),
    db.branch.findMany({ select: { name: true } }),
    db.center.findMany({ select: { name: true } }),
    db.therapyHall.findMany({ select: { name: true } }),
    db.centerResource.findMany({ select: { name: true, center: { select: { name: true } }, therapyHall: { select: { name: true } } } }),
    db.formation.findMany({ select: { name: true } }),
    db.rank.findMany({ select: { name: true } }),
    db.injuryType.findMany({ select: { name: true } }),
    db.mobilityAid.findMany({ select: { name: true } }),
    db.prostheticType.findMany({ select: { name: true } }),
    db.medication.findMany({ select: { name: true, quantity: true } }),
    db.medicationBatch.findMany({ select: { batchNo: true, note: true, quantity: true, medication: { select: { name: true } } } }),
  ]);

  const qaCount = (values: string[]) => values.filter(isQaReferenceName).length;
  return {
    totals: {
      governorates: governorates.length,
      districts: districts.length,
      branches: branches.length,
      centers: centers.length,
      centerHalls: resources.filter((item) => item.therapyHall).length,
      formations: formations.length,
      ranks: ranks.length,
      injuryTypes: injuries.length,
      mobilityAids: mobility.length,
      prostheticTypes: prosthetics.length,
      medications: medications.length,
      batches: batches.length,
      stockQuantity: batches.reduce((sum, row) => sum + row.quantity, 0),
      legacyMedicationQuantity: medications.reduce((sum, row) => sum + row.quantity, 0),
    },
    qa: {
      governorates: qaCount(governorates.map((item) => item.name)),
      districts: qaCount(districts.map((item) => `${item.governorate.name} ${item.name}`)),
      branches: qaCount(branches.map((item) => item.name)),
      centers: qaCount(centers.map((item) => item.name)),
      centerHalls: qaCount(resources.filter((item) => item.therapyHall).map((item) => `${item.center.name} ${item.name}`)),
      formations: qaCount(formations.map((item) => item.name)),
      ranks: qaCount(ranks.map((item) => item.name)),
      injuryTypes: qaCount(injuries.map((item) => item.name)),
      mobilityAids: qaCount(mobility.map((item) => item.name)),
      prostheticTypes: qaCount(prosthetics.map((item) => item.name)),
      medications: qaCount(medications.map((item) => item.name)),
      batches: qaCount(batches.map((item) => `${item.medication.name} ${item.batchNo ?? ""} ${item.note ?? ""}`)),
    },
    raw: { governorates, districts, branches, centers, halls, resources, formations, ranks, injuries, mobility, prosthetics, medications },
  };
}

async function missingCounts(db: Db) {
  const current = await snapshot(db);
  const raw = current.raw;
  const governors = nameMap(raw.governorates);
  const districtKeys = new Set(raw.districts.map((item) => `${normalizeReferenceName(item.governorate.name)}::${normalizeReferenceName(item.name)}`));
  const centers = nameMap(raw.centers);
  const hallKeys = new Set(raw.resources.map((item) => `${normalizeReferenceName(item.center.name)}::${normalizeReferenceName(item.name)}`));
  const countMissing = (approved: readonly string[], existing: { name: string }[]) => {
    const names = nameMap(existing);
    return approved.filter((name) => !names.has(normalizeReferenceName(name))).length;
  };
  return {
    governorates: Object.keys(APPROVED_REFERENCE_DATA.locations).filter((name) => !governors.has(normalizeReferenceName(name))).length,
    districts: Object.entries(APPROVED_REFERENCE_DATA.locations).reduce((sum, [governorate, rows]) => sum + rows.filter((name) => !districtKeys.has(`${normalizeReferenceName(governorate)}::${normalizeReferenceName(name)}`)).length, 0),
    branches: countMissing(APPROVED_REFERENCE_DATA.branches, raw.branches),
    centers: APPROVED_REFERENCE_DATA.centers.filter((name) => !centers.has(normalizeReferenceName(name))).length,
    centerHalls: APPROVED_REFERENCE_DATA.centerHalls.reduce((sum, row) => sum + row.halls.filter((hall) => !hallKeys.has(`${normalizeReferenceName(row.center)}::${normalizeReferenceName(hall)}`)).length, 0),
    formations: countMissing(APPROVED_REFERENCE_DATA.formations, raw.formations),
    ranks: countMissing(APPROVED_REFERENCE_DATA.ranks, raw.ranks),
    injuryTypes: countMissing(APPROVED_REFERENCE_DATA.injuryTypes, raw.injuries),
    mobilityAids: countMissing(APPROVED_REFERENCE_DATA.mobilityAids, raw.mobility),
    prostheticTypes: countMissing(APPROVED_REFERENCE_DATA.prostheticTypes, raw.prosthetics),
    medications: countMissing(APPROVED_REFERENCE_DATA.medications.map((item) => item.name), raw.medications),
    batches: 0,
    stockQuantity: 0,
  };
}

async function ensureNamed(db: Db, delegate: "branch" | "formation" | "rank" | "injuryType" | "mobilityAid" | "prostheticType", approved: readonly string[]) {
  const model = db[delegate] as any;
  const existing = nameMap(await model.findMany({ select: { name: true } }));
  for (const sourceName of approved) {
    const name = normalizeReferenceName(sourceName);
    if (!existing.has(name)) {
      await model.create({ data: delegate === "branch" ? { name, isActive: true } : { name } });
      existing.set(name, { name });
    }
  }
}

async function synchronize(db: Db) {
  const governors = nameMap(await db.governorate.findMany({ select: { id: true, name: true } }));
  for (const [sourceGovernorate, districtNames] of Object.entries(APPROVED_REFERENCE_DATA.locations)) {
    const governorateName = normalizeReferenceName(sourceGovernorate);
    let governorate = governors.get(governorateName);
    if (!governorate) {
      governorate = await db.governorate.create({ data: { name: governorateName }, select: { id: true, name: true } });
      governors.set(governorateName, governorate);
    }
    const existingDistricts = nameMap(await db.district.findMany({ where: { governorateId: governorate.id }, select: { name: true } }));
    for (const sourceDistrict of districtNames) {
      const name = normalizeReferenceName(sourceDistrict);
      if (!existingDistricts.has(name)) {
        await db.district.create({ data: { name, governorateId: governorate.id } });
        existingDistricts.set(name, { name });
      }
    }
  }

  await ensureNamed(db, "branch", APPROVED_REFERENCE_DATA.branches);
  await ensureNamed(db, "formation", APPROVED_REFERENCE_DATA.formations);
  await ensureNamed(db, "rank", APPROVED_REFERENCE_DATA.ranks);
  await ensureNamed(db, "injuryType", APPROVED_REFERENCE_DATA.injuryTypes);
  await ensureNamed(db, "mobilityAid", APPROVED_REFERENCE_DATA.mobilityAids);
  await ensureNamed(db, "prostheticType", APPROVED_REFERENCE_DATA.prostheticTypes);

  const centers = nameMap(await db.center.findMany({ select: { id: true, name: true } }));
  for (const sourceName of APPROVED_REFERENCE_DATA.centers) {
    const name = normalizeReferenceName(sourceName);
    if (!centers.has(name)) {
      const center = await db.center.create({ data: { name, active: true }, select: { id: true, name: true } });
      centers.set(name, center);
    }
  }

  const halls = nameMap(await db.therapyHall.findMany({ select: { id: true, name: true } }));
  for (const row of APPROVED_REFERENCE_DATA.centerHalls) {
    const center = centers.get(normalizeReferenceName(row.center));
    if (!center) throw new Error(`Approved center is missing: ${row.center}`);
    for (const sourceHall of row.halls) {
      const name = normalizeReferenceName(sourceHall);
      let hall = halls.get(name);
      if (!hall) {
        hall = await db.therapyHall.create({ data: { name, active: true }, select: { id: true, name: true } });
        halls.set(name, hall);
      }
      const resource = await db.centerResource.findFirst({ where: { centerId: center.id, name }, select: { id: true } });
      if (!resource) {
        await db.centerResource.create({ data: { centerId: center.id, name, type: "HALL", status: "AVAILABLE", capacity: 1, therapyHallId: hall.id } });
      }
    }
  }

  const medications = nameMap(await db.medication.findMany({ select: { name: true } }));
  for (const item of APPROVED_REFERENCE_DATA.medications) {
    const name = normalizeReferenceName(item.name);
    if (!medications.has(name)) {
      await db.medication.create({ data: { name, unit: item.unit, minQuantity: item.minQuantity, quantity: 0 } });
      medications.set(name, { name });
    }
  }
}

async function main() {
  assertApprovedReferenceData();
  const before = await snapshot(prisma);
  const planned = await missingCounts(prisma);
  const report: Record<string, unknown> = { mode: apply ? "apply" : "dry-run", approved: approvedReferenceCounts(), before: before.totals, existingQa: before.qa, planned };

  if (apply) {
    await prisma.$transaction(async (tx) => {
      await synchronize(tx);
      await tx.auditLog.create({
        data: {
          action: "SYNC_REFERENCE_DATA",
          tableName: "approved_reference_data",
          recordId: "approved-reference-v1",
          actorUsername: "system",
          actorName: "Reference data sync",
          newValue: { planned, approved: approvedReferenceCounts() },
        },
      });
    }, { timeout: 120_000 });
    const after = await snapshot(prisma);
    report.after = after.totals;
    report.remaining = await missingCounts(prisma);
  }

  console.log(JSON.stringify(report));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Reference sync failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
