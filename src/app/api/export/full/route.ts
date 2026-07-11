import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { apiPermissionResponse, checkApiPermission } from "@/lib/api-permissions";
import { GENDER, MARITAL, PATIENT_STATUS, INVOICE_STATUS, DEVICE_STATUS } from "@/lib/labels";

export const dynamic = "force-dynamic";

function xesc(v: any) {
  const s = v === null || v === undefined ? "" : String(v);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function sheet(name: string, headers: string[], rows: any[][]) {
  const cell = (v: any) => `<Cell><Data ss:Type="String">${xesc(v)}</Data></Cell>`;
  const row = (cells: any[]) => `<Row>${cells.map(cell).join("")}</Row>`;
  const safeName = name.slice(0, 31).replace(/[\\/?*\[\]:]/g, " ");
  return `<Worksheet ss:Name="${xesc(safeName)}"><Table>${row(headers)}${rows.map(row).join("")}</Table></Worksheet>`;
}
function fmt(d: any) {
  if (!d) return "";
  try { return new Intl.DateTimeFormat("ar-IQ", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Baghdad" }).format(new Date(d)); } catch { return ""; }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const uid = (session?.user as any)?.id;
  if (!session) return new Response("غير مصرّح", { status: 401 });
  const permission = await checkApiPermission(uid, role, "patients.export");
  if (permission.allowed === false) return apiPermissionResponse(permission);
  const perms = permission.permissions;

  const canAppointments = perms.has("appointments.view");
  const canFinance = perms.has("finance.view") || perms.has("finance.report");
  const canClinical = perms.has("clinical.view") || perms.has("clinical.session");
  const canDevices = perms.has("devices.view");
  const canPharmacy = perms.has("pharmacy.view");
  const canAttendance = perms.has("attendance.view");
  const canUsers = perms.has("users.view");
  const canTasks = perms.has("tasks.view");
  const canShifts = perms.has("shifts.view");

  const [patients, appts, invoices, sessions, admissions, devices, meds, attendance, users, tasks, shifts, leaves, therAgg] = await Promise.all([
    prisma.patient.findMany({ include: { governorate: true, injuryType: true }, orderBy: { fileNumber: "asc" }, take: 10000 }),
    canAppointments ? prisma.appointment.findMany({ include: { patient: true }, orderBy: { scheduledAt: "desc" }, take: 10000 }) : Promise.resolve([]),
    canFinance ? prisma.invoice.findMany({ include: { patient: true }, orderBy: { issuedAt: "desc" }, take: 10000 }) : Promise.resolve([]),
    canClinical ? prisma.therapySession.findMany({ include: { patient: true }, orderBy: { createdAt: "desc" }, take: 10000 }) : Promise.resolve([]),
    canClinical ? prisma.admission.findMany({ include: { patient: true, center: true }, orderBy: { admissionDate: "desc" }, take: 10000 }) : Promise.resolve([]),
    canDevices ? prisma.device.findMany({ include: { patient: true }, orderBy: { deliveredAt: "desc" }, take: 10000 }) : Promise.resolve([]),
    canPharmacy ? prisma.medication.findMany({ orderBy: { name: "asc" }, take: 10000 }) : Promise.resolve([]),
    canAttendance ? prisma.attendance.findMany({ orderBy: { date: "desc" }, take: 10000 }) : Promise.resolve([]),
    canUsers ? prisma.user.findMany({ orderBy: { fullName: "asc" }, take: 10000 }) : Promise.resolve([]),
    canTasks ? prisma.task.findMany({ include: { assignedTo: { select: { fullName: true } }, patient: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 10000 }) : Promise.resolve([]),
    canShifts ? prisma.shift.findMany({ orderBy: { date: "desc" }, take: 10000 }) : Promise.resolve([]),
    canShifts ? prisma.leave.findMany({ orderBy: { fromDate: "desc" }, take: 10000 }) : Promise.resolve([]),
    canClinical ? prisma.therapySession.groupBy({ by: ["therapist"], _count: { _all: true }, _sum: { actualSessions: true } }) : Promise.resolve([]),
  ]);

  const TSTAT: Record<string,string> = { OPEN:"مفتوحة", IN_PROGRESS:"قيد التنفيذ", DONE:"منجزة", CANCELLED:"ملغاة" };
  const SHTYPE: Record<string,string> = { MORNING:"صباحية", EVENING:"مسائية", NIGHT:"ليلية", FULL:"دوام كامل" };
  const LVTYPE: Record<string,string> = { ANNUAL:"اعتيادية", SICK:"مرضية", EMERGENCY:"اضطرارية", UNPAID:"بدون راتب", OTHER:"أخرى" };
  const LVSTAT: Record<string,string> = { PENDING:"قيد الموافقة", APPROVED:"مقبولة", REJECTED:"مرفوضة" };
  const sheetList = [
    sheet("المراجعون", ["رقم الملف", "الاسم", "الجنس", "التولد", "الهاتف", "المحافظة", "نوع الإصابة", "الحالة"],
      patients.map((p) => [p.fileNumber, p.fullName, GENDER[p.gender as keyof typeof GENDER] ?? "", p.birthYear, p.phone, p.governorate?.name, p.injuryType?.name, PATIENT_STATUS[p.status as keyof typeof PATIENT_STATUS] ?? ""])),
    canAppointments ? sheet("المواعيد", ["المريض", "التاريخ", "النوع", "المعالج", "الحالة"],
      appts.map((a) => [a.patient?.fullName, fmt(a.scheduledAt), a.type, a.assignedTo, a.status])) : "",
    canFinance ? sheet("الفواتير", ["المريض", "المبلغ", "المدفوع", "الحالة", "التاريخ"],
      invoices.map((i) => [i.patient?.fullName, i.amount, i.paidAmount, INVOICE_STATUS[i.status as keyof typeof INVOICE_STATUS] ?? i.status, fmt(i.issuedAt)])) : "",
    canClinical ? sheet("الجلسات", ["المريض", "النوع", "المعالج", "التاريخ"],
      sessions.map((s) => [s.patient?.fullName, s.therapyType, (s as any).therapist, fmt(s.createdAt)])) : "",
    canClinical ? sheet("الرقود", ["المريض", "المركز", "تاريخ الدخول", "المدة (يوم)", "الحالة"],
      admissions.map((a) => [a.patient?.fullName, a.center?.name, fmt(a.admissionDate), (a as any).durationDays, a.status])) : "",
    canDevices ? sheet("الأجهزة", ["المريض", "الجهاز", "تاريخ التسليم", "الحالة"],
      devices.map((d) => [d.patient?.fullName, (d as any).name, fmt((d as any).deliveredAt), DEVICE_STATUS[d.status as keyof typeof DEVICE_STATUS] ?? d.status])) : "",
    canPharmacy ? sheet("المخزون", ["المادة", "الكمية", "حد التنبيه", "الوحدة"],
      meds.map((m) => [m.name, m.quantity, m.minQuantity, (m as any).unit])) : "",
    canAttendance ? sheet("الحضور", ["الموظف", "التاريخ", "الحضور", "الانصراف"],
      attendance.map((a) => [a.name, fmt(a.date), a.checkIn ? fmt(a.checkIn) : "", a.checkOut ? fmt(a.checkOut) : ""])) : "",
    canUsers ? sheet("المستخدمون", ["الاسم", "اسم المستخدم", "الدور", "فعّال"],
      users.map((u) => [u.fullName, u.username, u.role, u.isActive ? "نعم" : "لا"])) : "",
    canTasks ? sheet("المهام", ["العنوان", "الأولوية", "الحالة", "مُسندة إلى", "المريض", "تاريخ الاستحقاق"],
      tasks.map((t: any) => [t.title, t.priority, TSTAT[t.status] ?? t.status, t.assignedTo?.fullName, t.patient?.fullName, fmt(t.dueDate)])) : "",
    canShifts ? sheet("المناوبات", ["الموظف", "التاريخ", "النوع", "من", "إلى"],
      shifts.map((sh: any) => [sh.name, fmt(sh.date), SHTYPE[sh.type] ?? sh.type, sh.startTime, sh.endTime])) : "",
    canShifts ? sheet("الإجازات", ["الموظف", "النوع", "من", "إلى", "الحالة", "السبب"],
      leaves.map((l: any) => [l.name, LVTYPE[l.type] ?? l.type, fmt(l.fromDate), fmt(l.toDate), LVSTAT[l.status] ?? l.status, l.reason])) : "",
    canClinical ? sheet("مؤشرات المعالجين", ["المعالج", "عدد المسارات", "الجلسات الفعلية"],
      therAgg.map((r: any) => [r.therapist ?? "غير محدّد", r._count._all, r._sum.actualSessions ?? 0])) : "",
  ];
  const sheets = sheetList.join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets}</Workbook>`;
  const today = new Date().toISOString().slice(0, 10);
  return new Response("\uFEFF" + xml, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="tahili-export-${today}.xls"`,
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
