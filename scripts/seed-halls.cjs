// إضافة القاعات الأولية (يُشغّل مرة واحدة بعد db push)
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const HALLS = ["قاعة التمارين الميكانيكية", "قاعة الأجهزة الفيزياوية", "قاعة العلاج المائي"];
(async () => {
  for (const name of HALLS) {
    await prisma.therapyHall.upsert({ where: { name }, update: {}, create: { name } }).catch(() => {});
  }
  const count = await prisma.therapyHall.count();
  console.log(`✅ القاعات الأولية جاهزة (${count} قاعة)`);
  await prisma.$disconnect();
})();
