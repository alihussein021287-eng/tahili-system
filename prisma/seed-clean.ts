// =====================================================================
//  بذور البيانات الأولية: مستخدم مدير + قوائم ثابتة
//  التشغيل: npm run db:seed
// =====================================================================
import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Only for a brand-new database after the 21 historical migrations. Those
// migrations insert demonstration centers/halls/resources; never run this
// cleanup against an established environment.
async function removeHistoricalDemoConfiguration() {
  await prisma.$transaction(async (tx) => {
    const applied = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    if (applied[0]?.count !== 21n) throw new Error("Expected exactly 21 applied migrations");

    const centers = await tx.center.findMany({ select: { name: true } });
    const halls = await tx.therapyHall.findMany({ select: { name: true } });
    const resources = await tx.centerResource.findMany({ select: { id: true } });
    if (centers.length === 0 && halls.length === 0 && resources.length === 0) return;

    const expectedCenters = [
      "مركز العلاج الطبيعي", "مركز التأهيل النفسي",
      "مركز النقاء التخصصي", "مركز العلاج الوظيفي",
    ];
    if (centers.length !== 4 ||
        centers.map((item) => item.name).sort().join("\n") !== expectedCenters.sort().join("\n") ||
        halls.length !== 12 || resources.length !== 12 ||
        resources.some((item) => !item.id.startsWith("center_hall_"))) {
      throw new Error("Unexpected center configuration: refusing demo cleanup");
    }

    // Guard every other application table, not only the familiar clinical ones.
    // This avoids triggering a cascading delete if the database is not truly new.
    const tables = await tx.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const permitted = new Set([
      "_prisma_migrations", "centers", "therapy_halls", "center_resources",
      "collaboration_settings",
    ]);
    for (const { tablename } of tables) {
      if (permitted.has(tablename)) continue;
      const quoted = `"${tablename.replaceAll('"', '""')}"`;
      const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM ${quoted}`,
      );
      if (rows[0]?.count !== 0n) {
        throw new Error(`Table ${tablename} is not empty: refusing demo cleanup`);
      }
    }
    await tx.centerResource.deleteMany();
    await tx.center.deleteMany();
    await tx.therapyHall.deleteMany();
  }, { timeout: 30000 });
}

async function main() {
  await removeHistoricalDemoConfiguration();
  // 1) المستخدم المدير الافتراضي
  const existingAdmin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!existingAdmin) {
    const initialAdminPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (!initialAdminPassword || initialAdminPassword.length < 12) {
      throw new Error("Set ADMIN_INITIAL_PASSWORD in .env to a strong initial admin password with at least 12 characters.");
    }

    const passwordHash = await bcrypt.hash(initialAdminPassword, 10);
    await prisma.user.create({
      data: {
        username: "admin",
        passwordHash,
        fullName: "مدير النظام",
        role: UserRole.ADMIN,
      },
    });
  }

  // 2) المحافظات (نموذج — أضف الباقي حسب الحاجة)
  const governorates = [
    "بغداد", "البصرة", "نينوى", "ذي قار", "الأنبار",
    "بابل", "ديالى", "كركوك", "صلاح الدين", "النجف",
    "كربلاء", "واسط", "ميسان", "القادسية", "المثنى",
    "أربيل", "السليمانية", "دهوك", "حلبجة",
  ];
  for (const name of governorates) {
    await prisma.governorate.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 3) مناطق بغداد الأساسية
  const baghdad = await prisma.governorate.findUnique({ where: { name: "بغداد" } });
  if (baghdad) {
    const districts = [
      "الرصافة", "الكرخ", "مدينة الصدر", "الكاظمية", "الأعظمية", "المنصور",
      "الدورة", "البياع", "الشعلة", "الحرية", "الغزالية", "زيونة", "الجادرية",
      "الكرادة", "المدائن", "أبو غريب", "التاجي", "الطارمية", "المحمودية",
      "اليوسفية", "اللطيفية", "النهروان",
    ];
    for (const name of districts) {
      await prisma.district.upsert({
        where: { name_governorateId: { name, governorateId: baghdad.id } },
        update: {},
        create: { name, governorateId: baghdad.id },
      });
    }
  }

  console.log("Clean initialization completed; no example centers were created.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
