// إضافة القاعات/الفروع الأولية وربطها بالمراكز
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const CENTER_HALLS = [
  ["مركز العلاج الطبيعي", ["قاعة العلاج الميكانيكي", "قاعة العلاج الفيزيائي", "قاعة العلاج المائي"]],
  ["مركز التأهيل النفسي", ["استشارية", "أجهزة", "تأهيل كبار", "تأهيل أطفال"]],
  ["مركز النقاء التخصصي", ["القروح", "الألم", "الهايبر أوكسجين"]],
  ["مركز العلاج الوظيفي", ["التأهيل", "الفنون"]],
];
(async () => {
  for (const [centerName, halls] of CENTER_HALLS) {
    const center = await prisma.center.upsert({ where: { name: centerName }, update: {}, create: { name: centerName } });
    for (const name of halls) {
      const hall = await prisma.therapyHall.upsert({ where: { name }, update: { active: true }, create: { name } });
      await prisma.centerResource.upsert({
        where: { centerId_name: { centerId: center.id, name } },
        update: { type: "HALL", therapyHallId: hall.id },
        create: { centerId: center.id, name, type: "HALL", therapyHallId: hall.id },
      });
    }
  }
  const count = await prisma.therapyHall.count();
  console.log(`✅ القاعات الأولية جاهزة (${count} قاعة)`);
  await prisma.$disconnect();
})();
