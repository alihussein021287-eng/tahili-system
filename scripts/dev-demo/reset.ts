// Resets the LOCAL working copy (localhost:3001) to a clean demo state:
//   1. wipes every table except the migration history, keeping only ADMIN accounts;
//   2. restores the approved reference lists (locations, centres, halls, lookups, medicines);
//   3. adds demo branches, opening stock, and three Arabic-named staff accounts for every role.
// Run inside the 3001 app container:  npx tsx scripts/dev-demo/reset.ts --confirm-wipe-dev-3001
// It refuses to run anywhere else (see assertLocalDevCopy) and refuses when no ADMIN account exists.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { APPROVED_REFERENCE_DATA, normalizeReferenceName } from "../reference-data";
import { assertLocalDevCopy, demoPrisma } from "./db";
import { DEMO_BRANCHES, DEMO_USERS } from "./people";

const CONFIRM = "--confirm-wipe-dev-3001";
const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const OUT = outArg ? outArg.slice("--out=".length) : "/tmp/demo-credentials.tsv";

const log = (message: string) => process.stderr.write(`${message}\n`);

async function wipe(prisma: PrismaClient) {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true, username: true } });
  if (!admins.length) throw new Error("لا يوجد حساب أدمن؛ أوقفت المسح حتى لا يُقفل النظام.");
  const tables = (await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'users') ORDER BY tablename`,
  )).map((row) => row.tablename);
  const userFks = await prisma.$queryRawUnsafe<{ column_name: string }[]>(`
    SELECT kcu.column_name::text AS column_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.columns c ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name AND c.column_name = kcu.column_name
    WHERE tc.table_schema = 'public' AND tc.table_name = 'users' AND tc.constraint_type = 'FOREIGN KEY' AND c.is_nullable = 'YES'`);
  await prisma.$transaction(async (tx) => {
    // Foreign keys are checked by triggers; replica mode lets every table be emptied in any order.
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    for (const { column_name } of userFks) await tx.$executeRawUnsafe(`UPDATE "users" SET "${column_name}" = NULL WHERE "role" = 'ADMIN'`);
    for (const table of tables) await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
    await tx.$executeRawUnsafe(`DELETE FROM "users" WHERE "role" <> 'ADMIN'`);
    await tx.$executeRawUnsafe(`UPDATE "users" SET "failedLoginCount" = 0, "lockedUntil" = NULL WHERE "role" = 'ADMIN'`);
    const sequences = await tx.$queryRawUnsafe<{ name: string }[]>(`SELECT sequence_name::text AS name FROM information_schema.sequences WHERE sequence_schema = 'public'`);
    for (const { name } of sequences) await tx.$executeRawUnsafe(`ALTER SEQUENCE "${name}" RESTART WITH 1`);
  }, { timeout: 300_000 });
  log(`مسح: ${tables.length} جدول، وبقي ${admins.length} حساب أدمن (${admins.map((a) => a.username).join("، ")}).`);
}

async function referenceData(prisma: PrismaClient) {
  for (const [governorateName, districts] of Object.entries(APPROVED_REFERENCE_DATA.locations)) {
    const governorate = await prisma.governorate.create({ data: { name: normalizeReferenceName(governorateName) } });
    await prisma.district.createMany({ data: [...new Set(districts.map(normalizeReferenceName))].map((name) => ({ name, governorateId: governorate.id })) });
  }
  const named = async (model: any, names: readonly string[]) => model.createMany({ data: [...new Set(names.map(normalizeReferenceName))].map((name) => ({ name })) });
  await named(prisma.formation, APPROVED_REFERENCE_DATA.formations);
  await named(prisma.rank, APPROVED_REFERENCE_DATA.ranks);
  await named(prisma.injuryType, APPROVED_REFERENCE_DATA.injuryTypes);
  await named(prisma.mobilityAid, APPROVED_REFERENCE_DATA.mobilityAids);
  await named(prisma.prostheticType, APPROVED_REFERENCE_DATA.prostheticTypes);
  for (const name of APPROVED_REFERENCE_DATA.centers) await prisma.center.create({ data: { name: normalizeReferenceName(name), active: true } });
  for (const row of APPROVED_REFERENCE_DATA.centerHalls) {
    const center = await prisma.center.findUniqueOrThrow({ where: { name: normalizeReferenceName(row.center) } });
    for (const hallName of row.halls) {
      const name = normalizeReferenceName(hallName);
      const hall = await prisma.therapyHall.create({ data: { name, active: true } });
      await prisma.centerResource.create({ data: { centerId: center.id, name, type: "HALL", status: "AVAILABLE", capacity: 4, therapyHallId: hall.id } });
    }
  }
  for (const item of APPROVED_REFERENCE_DATA.medications) {
    await prisma.medication.create({ data: { name: normalizeReferenceName(item.name), unit: item.unit, minQuantity: item.minQuantity, quantity: 0 } });
  }
  log("القوائم الأساسية رجعت: المحافظات، المراكز، القاعات، الإصابات، التشكيلات، الرتب، الأدوية.");
}

/** Opening stock so prescriptions can be dispensed: most items healthy, a few near or past the expiry warnings. */
async function openingStock(prisma: PrismaClient) {
  const supplier = await prisma.supplier.create({ data: { name: "مذخر الرافدين (تجريبي)", phone: "07700009999" } });
  const medications = await prisma.medication.findMany({ orderBy: { id: "asc" }, take: 24 });
  const day = 86_400_000;
  for (const [index, medication] of medications.entries()) {
    // index 0..19 healthy (one year); 20,21 near expiry (60 days); 22 urgent (20 days); 23 low stock.
    const expiresIn = index >= 22 ? 20 : index >= 20 ? 60 : 365;
    const quantity = index === 23 ? Math.max(1, medication.minQuantity - 5) : 300;
    const batch = await prisma.medicationBatch.create({ data: {
      medicationId: medication.id, supplierId: supplier.id, batchNo: `OPEN-${String(index + 1).padStart(3, "0")}`,
      quantity, expiryDate: new Date(Date.now() + expiresIn * day), note: "رصيد افتتاحي للتجربة",
    } });
    await prisma.medication.update({ where: { id: medication.id }, data: { quantity } });
    await prisma.stockMovement.create({ data: { type: "IN", medicationId: medication.id, batchId: batch.id, quantity, reason: "رصيد افتتاحي للتجربة", byName: "النظام" } });
  }
  log(`رصيد افتتاحي: ${medications.length} مادة.`);
}

/** Wards and beds so admissions can be tried. */
async function wards(prisma: PrismaClient) {
  const rooms: [string, number][] = [["ردهة الرجال 1", 4], ["ردهة الرجال 2", 4], ["ردهة النساء", 3]];
  for (const [name, beds] of rooms) {
    const room = await prisma.room.create({ data: { name, capacity: beds, notes: "ردهة تجريبية" } });
    await prisma.bed.createMany({ data: Array.from({ length: beds }, (_, index) => ({ roomId: room.id, label: `سرير ${index + 1}` })) });
  }
  log(`الردهات: ${rooms.length} ردهة بأسرّتها.`);
}

async function staff(prisma: PrismaClient) {
  const password = `Demo-${randomBytes(6).toString("base64url")}-3001`;
  const passwordHash = await bcrypt.hash(password, 10);
  const branches = new Map<string, number>();
  for (const name of DEMO_BRANCHES) branches.set(name, (await prisma.branch.create({ data: { name, isActive: true } })).id);
  const centers = new Map((await prisma.center.findMany({ select: { id: true, name: true } })).map((center) => [center.name, center.id]));
  const rows: string[] = ["# role\tusername\tpassword\tfullName\tbranch\tcenters"];
  for (const person of DEMO_USERS) {
    const user = await prisma.user.create({ data: {
      username: person.username, passwordHash, fullName: person.fullName, role: person.role, isActive: true,
      jobTitle: person.jobTitle, department: person.department, branchId: person.branch ? branches.get(person.branch) ?? null : null,
      phone: `0780000${String(rows.length).padStart(4, "0")}`, note: "حساب تجريبي — نسخة 3001",
    } });
    for (const membership of person.memberships) {
      const centerId = centers.get(membership.center);
      if (!centerId) throw new Error(`المركز غير موجود: ${membership.center}`);
      await prisma.centerMembership.create({ data: { centerId, userId: user.id, role: membership.role, specialty: membership.specialty ?? null, status: "ACTIVE", startDate: new Date(Date.now() - 86_400_000) } });
    }
    rows.push([person.role, person.username, password, person.fullName, person.branch ?? "كل الفروع (مركز)", person.memberships.map((m) => `${m.center}/${m.role}`).join("، ")].join("\t"));
  }
  writeFileSync(OUT, `${rows.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  log(`الموظفون: ${DEMO_USERS.length} حساب بثلاثة لكل دور. كلمات الدخول بالملف ${OUT}`);
}

async function main() {
  if (!process.argv.includes(CONFIRM)) throw new Error(`للتأكيد شغّل الأمر مع ${CONFIRM}`);
  assertLocalDevCopy();
  const prisma = await demoPrisma();
  try {
    await wipe(prisma);
    await referenceData(prisma);
    await openingStock(prisma);
    await wards(prisma);
    await staff(prisma);
    await prisma.auditLog.create({ data: { action: "DEMO_RESET", tableName: "all", recordId: "dev-3001", actorUsername: "system", actorName: "تصفير نسخة التجربة", newValue: { users: DEMO_USERS.length } } });
    log("تم: نسخة 3001 جاهزة للفحص الشامل.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
