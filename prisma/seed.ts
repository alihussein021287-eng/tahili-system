// =====================================================================
//  بذور البيانات الأولية: مستخدم مدير + قوائم ثابتة
//  التشغيل: npm run db:seed
// =====================================================================
import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
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

  // 3) المراكز العلاجية (نموذج)
  const centers = [
    "مركز العلاج الطبيعي",
    "مركز التأهيل النفسي",
    "مركز العلاج الوظيفي",
    "مركز تأهيل المثانة",
    "مركز الرازي الطبي",
  ];
  for (const name of centers) {
    await prisma.center.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 4) مناطق بغداد الأساسية
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

  console.log("✅ تم إنشاء البيانات الأولية (مستخدم admin + القوائم).");
  console.log("   اسم المستخدم: admin | كلمة السر من ADMIN_INITIAL_PASSWORD في .env  (غيّرها بعد أول دخول)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
