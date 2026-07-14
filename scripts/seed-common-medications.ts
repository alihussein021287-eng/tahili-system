import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const medications = [
  ["باراسيتامول 500 ملغ - Paracetamol", "شريط", 20],
  ["إيبوبروفين 400 ملغ - Ibuprofen", "شريط", 20],
  ["ديكلوفيناك 50 ملغ - Diclofenac", "شريط", 15],
  ["ديكلوفيناك جل 1%", "أنبوب", 10],
  ["أسبرين 100 ملغ - Aspirin", "شريط", 15],
  ["أموكسيسيلين 500 ملغ - Amoxicillin", "شريط", 15],
  ["أموكسيسيلين/كلافولانيك 625 ملغ", "علبة", 10],
  ["أزيثروميسين 500 ملغ - Azithromycin", "علبة", 10],
  ["سيفيكسيم 400 ملغ - Cefixime", "علبة", 10],
  ["سيبروفلوكساسين 500 ملغ - Ciprofloxacin", "شريط", 10],
  ["ميترونيدازول 500 ملغ - Metronidazole", "شريط", 15],
  ["أوميبرازول 20 ملغ - Omeprazole", "شريط", 20],
  ["بانتوبرازول 40 ملغ - Pantoprazole", "شريط", 15],
  ["دومبيريدون 10 ملغ - Domperidone", "شريط", 10],
  ["ميتوكلوبراميد 10 ملغ - Metoclopramide", "شريط", 10],
  ["لوراتادين 10 ملغ - Loratadine", "شريط", 10],
  ["سيتريزين 10 ملغ - Cetirizine", "شريط", 10],
  ["سالبوتامول بخاخ 100 مكغ", "بخاخ", 5],
  ["أملوديبين 5 ملغ - Amlodipine", "شريط", 15],
  ["أملوديبين 10 ملغ - Amlodipine", "شريط", 15],
  ["لوسارتان 50 ملغ - Losartan", "شريط", 15],
  ["إنالابريل 5 ملغ - Enalapril", "شريط", 10],
  ["أتورفاستاتين 20 ملغ - Atorvastatin", "شريط", 15],
  ["ميتفورمين 500 ملغ - Metformin", "شريط", 20],
  ["غليميبرايد 2 ملغ - Glimepiride", "شريط", 10],
  ["غابابنتين 300 ملغ - Gabapentin", "شريط", 10],
  ["بريغابالين 75 ملغ - Pregabalin", "شريط", 10],
  ["باكلوفين 10 ملغ - Baclofen", "شريط", 10],
  ["تيزانيدين 2 ملغ - Tizanidine", "شريط", 10],
  ["فيتامين B المركب", "شريط", 15],
  ["فيتامين D3 50000 وحدة", "علبة", 10],
  ["كالسيوم مع فيتامين D", "علبة", 10],
  ["حديد مع حمض الفوليك", "شريط", 10],
  ["محلول ملحي 0.9% سعة 500 مل", "قنينة", 10],
  ["محلول رينغر لاكتات 500 مل", "قنينة", 10],
  ["بيتادين 10% - Povidone Iodine", "قنينة", 10],
  ["كلورهكسيدين مطهر", "قنينة", 10],
  ["مرهم فيوسيديك أسيد 2%", "أنبوب", 10],
  ["كريم سلفاديازين الفضة 1%", "أنبوب", 10],
  ["ليدوكائين جل 2%", "أنبوب", 5],
] as const;

async function main() {
  for (const [name, unit, minQuantity] of medications) {
    await prisma.medication.upsert({
      where: { name }, update: {}, create: { name, unit, minQuantity, quantity: 0 },
    });
  }
  console.log(`Seeded ${medications.length} editable common medication entries with zero stock.`);
}

main().finally(() => prisma.$disconnect());
