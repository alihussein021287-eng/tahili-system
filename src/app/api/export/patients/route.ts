import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadPerms } from "@/lib/access";
import { GENDER, MARITAL, PATIENT_STATUS } from "@/lib/labels";

export const dynamic = "force-dynamic";

function esc(v: any) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("غير مصرّح", { status: 401 });
  const perms = await loadPerms((session.user as any)?.id, (session.user as any)?.role);
  if (!perms.has("patients.export")) return new Response("لا تملك صلاحية التصدير", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const where: any = {};
  const q = sp.get("q")?.trim();
  const name = sp.get("name")?.trim();
  const phone = sp.get("phone")?.trim();
  const file = Number(sp.get("file"));
  if (q) {
    const qNum = Number(q);
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      ...(!Number.isNaN(qNum) ? [{ fileNumber: qNum }] : []),
    ];
  }
  if (name) where.fullName = { contains: name, mode: "insensitive" };
  if (phone) where.phone = { contains: phone };
  if (sp.get("file") && !Number.isNaN(file)) where.fileNumber = file;
  if (sp.get("gov")) where.governorateId = Number(sp.get("gov"));
  if (sp.get("status")) where.status = sp.get("status");
  if (sp.get("injury")) where.injuryTypeId = Number(sp.get("injury"));
  if (sp.get("branch")) where.branchId = Number(sp.get("branch"));
  if (sp.get("dataEntry")) where.dataEntryBy = { contains: sp.get("dataEntry")?.trim(), mode: "insensitive" };
  if (sp.get("from") || sp.get("to")) {
    where.registrationDate = {
      ...(sp.get("from") ? { gte: new Date(sp.get("from")!) } : {}),
      ...(sp.get("to") ? { lt: new Date(new Date(sp.get("to")!).getTime() + 86400000) } : {}),
    };
  }
  if (sp.get("archived")) where.archivedAt = { not: null };
  else where.archivedAt = null;

  const patients = await prisma.patient.findMany({
    where, include: { governorate: true, district: true, injuryType: true, formation: true, branch: true },
    orderBy: { fileNumber: "asc" }, take: 5000,
  });

  const headers = ["رقم الملف","الاسم الرباعي","اسم الأم","الجنس","التولد","الهاتف","المحافظة","المنطقة",
    "الفرع","الحالة الزوجية","التحصيل","الصفة","التشكيل","نسبة العجز","نوع الإصابة","سبب الإصابة","السكن","الحالة","رقم الكتاب","مدخل البيانات","تاريخ التسجيل"];
  const rows = patients.map((p) => [
    p.fileNumber, p.fullName, p.motherName, GENDER[p.gender as keyof typeof GENDER] ?? "", p.birthYear, p.phone,
    p.governorate?.name, p.district?.name, p.branch?.name, MARITAL[p.maritalStatus as keyof typeof MARITAL] ?? "", p.education,
    p.rank, p.formation?.name, p.disabilityPct, p.injuryType?.name, p.injuryCause, p.housing,
    PATIENT_STATUS[p.status as keyof typeof PATIENT_STATUS] ?? "", p.referralBookNo, p.dataEntryBy, p.registrationDate?.toISOString().slice(0, 10),
  ]);

  // BOM لضمان قراءة العربي صح في Excel
  const csv = "\uFEFFsep=,\r\n" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="patients_${new Date().toISOString().slice(0,10)}.csv"`,
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
