// =====================================================================
//  ترحيل المخزون الحالي إلى دفعات افتتاحية (يُشغّل مرة واحدة بعد db push)
//  التشغيل: npx tsx prisma/backfill-pharmacy.ts
//  آمن للتكرار: لا ينشئ دفعة لمادة عندها دفعات مسبقاً.
// =====================================================================
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const meds = await prisma.medication.findMany({ include: { _count: { select: { batches: true } } } });
  let created = 0;
  for (const m of meds) {
    if (m._count.batches > 0) continue; // عندها دفعات — تجاوز
    if ((m.quantity ?? 0) <= 0) continue; // لا رصيد — تجاوز
    await prisma.medicationBatch.create({
      data: { medicationId: m.id, quantity: m.quantity, batchNo: "رصيد افتتاحي", expiryDate: null, note: "مُرحّل من المخزون السابق" },
    });
    created++;
  }
  console.log(`✅ تم إنشاء ${created} دفعة افتتاحية من ${meds.length} مادة.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
