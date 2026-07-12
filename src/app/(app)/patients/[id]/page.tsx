import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { notFound } from "next/navigation";
import Link from "next/link";
import { currentPerms, getSession, requirePerm } from "@/lib/access";
import { Zoom } from "@/components/Zoom";
import { PatientTabs } from "@/components/PatientTabs";
import { getCenters, getMedicationsList, getRooms } from "@/lib/lookups";
import { generatePortalToken, revokePortalToken, archivePatient, restorePatient } from "../actions";
import { createTask } from "../../tasks/actions";
import { GENDER, MARITAL, PATIENT_STATUS, CASE_TYPE, ADMISSION, APPT_STATUS, THERAPY, fmtDate } from "@/lib/labels";
import { ROLE_LABELS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function PatientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePerm("patients.view");
  const [patient, centers, medications, rooms, halls] = await Promise.all([
    prisma.patient.findUnique({
      where: { id },
      include: {
        governorate: true, district: true, injuryType: true, formation: true, branch: true,
        diagnoses: { orderBy: { date: "desc" } },
        careStages: { orderBy: { sequence: "asc" } },
        officialDocuments: { orderBy: { docDate: "desc" } },
        sickLeaves: { orderBy: { startDate: "desc" } },
        medicalReports: { orderBy: { date: "desc" } },
        visits: { orderBy: { visitDate: "desc" }, take: 5 },
        therapySessions: { include: { center: true }, orderBy: { createdAt: "desc" } },
        treatmentPlans: { include: { therapist: true, hall: true, sessions: true, referralRequest: true }, orderBy: { createdAt: "desc" } },
        centerPrograms: { include: { center: true, assignedTo: true }, orderBy: { createdAt: "desc" } },
        referralRequests: { where: { status: "ACCEPTED", destinationScope: "INTERNAL_CENTER" }, include: { treatmentPlan: true }, orderBy: { acceptedAt: "desc" } },
        therapySessionLogs: { include: { session: true, appointment: true }, orderBy: { performedAt: "desc" }, take: 25 },
        prescriptions: { include: { medication: true }, orderBy: { prescribedAt: "desc" } },
        admissions: { include: { center: true, room: true, bed: true }, orderBy: { admissionDate: "desc" } },
        woundAssessments: { include: { photos: true }, orderBy: { assessmentDate: "desc" } },
        residentReviews: { orderBy: { date: "desc" }, take: 25 },
        correspondence: { orderBy: { bookDate: "desc" } },
        appointments: { orderBy: { scheduledAt: "desc" } },
        _count: { select: { treatmentPlans: true } },
      },
    }),
    getCenters(),
    getMedicationsList(),
    getRooms(),
    prisma.therapyHall.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const taskUsers = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, role: true }, orderBy: { fullName: "asc" } });
  const therapyStaff = await prisma.user.findMany({ where: { isActive: true, role: "THERAPIST" }, include: { _count: { select: { therapyPlansAssigned: { where: { status: "ACTIVE" } }, therapyAppointmentsAssigned: { where: { status: "SCHEDULED", scheduledAt: { gte: new Date(new Date().setHours(0,0,0,0)), lt: new Date(new Date().setHours(24,0,0,0)) } } } } } }, orderBy: { fullName: "asc" } });
  if (!patient) notFound();
  const perms = await currentPerms();
  if (!perms.has("centers.central.view")) {
    const accessSession = await getSession();
    const memberships = await prisma.centerMembership.findMany({ where: { userId: (accessSession?.user as any)?.id, status: "ACTIVE" }, select: { centerId: true } });
    const allowed = new Set(memberships.map((membership) => membership.centerId));
    (patient as any).centerPrograms = (patient.centerPrograms || []).filter((program: any) => allowed.has(program.centerId));
  }
  const slApprovals = patient?.sickLeaves?.length
    ? await prisma.reportApproval.findMany({ where: { kind: "sick-leave", refKey: { in: patient.sickLeaves.map((l: any) => l.id) } } })
    : [];
  const _sess = await getSession();
  const myRole = (_sess?.user as any)?.role ?? "";
  const cEdit = perms.has("patients.edit");
  const cArchive = perms.has("patients.archive");
  const cPrint = perms.has("patients.print");
  const cDevices = perms.has("devices.view");
  const cFinance = perms.has("finance.view");
  const cPortal = perms.has("patients.portal");
  const cTask = perms.has("tasks.create");
  const lastVisit = patient.visits?.[0];
  const lastAppointment = patient.appointments?.[0];
  const lastSession = patient.therapySessions?.[0];
  const activeAdmission = patient.admissions?.find((a: any) => a.status === "ADMITTED");
  const latestAdmission = activeAdmission ?? patient.admissions?.[0];
  const summary = [
    ["رقم الملف", `#${patient.fileNumber}`],
    ["الفرع", patient.branch?.name || "بدون فرع"],
    ["الحالة", PATIENT_STATUS[patient.status as keyof typeof PATIENT_STATUS] ?? patient.status],
    ["آخر زيارة", lastVisit ? fmtDate(lastVisit.visitDate) : "لا توجد"],
    ["آخر موعد", lastAppointment ? `${fmtDate(lastAppointment.scheduledAt)} - ${APPT_STATUS[lastAppointment.status as keyof typeof APPT_STATUS] ?? lastAppointment.status}` : "لا يوجد"],
    ["آخر جلسة", lastSession ? `${fmtDate(lastSession.createdAt)} - ${THERAPY[lastSession.therapyType as keyof typeof THERAPY] ?? "جلسة"}` : "لا توجد"],
    ["حالة الرقود", latestAdmission ? `${ADMISSION[latestAdmission.status as keyof typeof ADMISSION] ?? latestAdmission.status}${latestAdmission.center?.name ? ` - ${latestAdmission.center.name}` : ""}` : "لا يوجد رقود"],
  ];
  const quickEvents = [
    { date: patient.registrationDate, type: "تسجيل", title: `فتح ملف رقم ${patient.fileNumber}` },
    ...((patient.visits || []).slice(0, 2).map((v: any) => ({ date: v.visitDate, type: "زيارة", title: v.center || v.notes || "زيارة مسجلة" }))),
    ...((patient.appointments || []).slice(0, 2).map((a: any) => ({ date: a.scheduledAt, type: "موعد", title: `${a.type || "موعد"} - ${APPT_STATUS[a.status as keyof typeof APPT_STATUS] ?? a.status}` }))),
    ...((patient.therapySessions || []).slice(0, 2).map((s: any) => ({ date: s.createdAt, type: "جلسة", title: `${THERAPY[s.therapyType as keyof typeof THERAPY] ?? "جلسة علاجية"}${s.therapist ? ` - ${s.therapist}` : ""}` }))),
    ...((patient.admissions || []).slice(0, 2).map((a: any) => ({ date: a.admissionDate, type: "رقود", title: `${ADMISSION[a.status as keyof typeof ADMISSION] ?? a.status}${a.dischargeDate ? ` - خروج ${fmtDate(a.dischargeDate)}` : ""}` }))),
    ...((patient.diagnoses || []).slice(0, 2).map((d: any) => ({ date: d.date, type: "تشخيص", title: d.text || "تشخيص" }))),
  ]
    .filter((e: any) => e.date)
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 7);

  const info = [
    ["اسم الأم", patient.motherName], ["الجنس", GENDER[patient.gender as keyof typeof GENDER]],
    ["التولد", patient.birthYear], ["الهاتف", patient.phone],
    ["المحافظة", patient.governorate?.name], ["المنطقة", patient.district?.name],
    ["الفرع", patient.branch?.name],
    ["الحالة الزوجية", MARITAL[patient.maritalStatus as keyof typeof MARITAL]],
    ["عدد الأطفال", patient.childrenCount], ["عدد الزوجات", patient.wivesCount],
    ["درجة القرابة", patient.kinshipDegree],
    ["نوع الحالة", CASE_TYPE[patient.caseType as keyof typeof CASE_TYPE]],
    ["يستلم راتب", patient.receivesSalary === true ? "نعم" : patient.receivesSalary === false ? "لا" : null],
    ["التحصيل", patient.education], ["الصفة", patient.rank],
    ["نسبة العجز", patient.disabilityPct ? `${patient.disabilityPct}%` : null],
    ["نوع الإصابة", patient.injuryType?.name], ["التشكيل", patient.formation?.name], ["سبب الإصابة", patient.injuryCause],
    ["موقف الدائرة", patient.militaryStatus],
    ["ضمن الحشد", patient.inMobilization === true ? "نعم" : patient.inMobilization === false ? "لا" : null],
    ["تاريخ الإصابة", patient.injuryDate ? fmtDate(patient.injuryDate) : null],
    ["الحركة", patient.mobility], ["مساعد الحركة", patient.mobilityAid], ["طرف صناعي", patient.prosthetic],
    ["السكن", patient.housing], ["رقم الكتاب", patient.referralBookNo],
    ["تاريخ الكتاب", patient.referralBookDate ? fmtDate(patient.referralBookDate) : null],
    ["المركز المُحال له", patient.referredToCenter],
    ["مدخل البيانات", patient.dataEntryBy],
  ];

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/patients" className="text-sm text-gray-500 hover:underline">→ رجوع للقائمة</Link>
        {patient.archivedAt && <span className="badge bg-amber-50 text-amber-700">مؤرشف — {fmtDate(patient.archivedAt)}</span>}
        <div className="flex flex-wrap justify-end gap-2">
          {cPrint && <Link href={`/patients/${id}/report`} className="btn-ghost">تقرير قابل للطباعة</Link>}
          {cDevices && <Link href={`/devices?patientId=${id}`} className="btn-ghost">🔧 الأجهزة والصيانة</Link>}
          {cFinance && <Link href={`/finance?patientId=${id}`} className="btn-ghost">💰 السجل المالي</Link>}
          {cTask && (
            <details className="relative">
              <summary className="btn-ghost cursor-pointer list-none">📌 مهمة سريعة</summary>
              <div className="fixed inset-x-3 top-24 z-40 rounded-xl border border-gray-200 bg-white p-3 shadow-lg sm:absolute sm:left-0 sm:right-auto sm:top-auto sm:mt-1 sm:w-72">
                <form action={createTask} className="space-y-2">
                  <input type="hidden" name="patientId" value={id} />
                  <input name="title" className="input" placeholder="عنوان المهمة / التحويل" required />
                  <textarea name="description" className="input" rows={2} placeholder="تفاصيل مختصرة" />
                  <div className="grid grid-cols-2 gap-2">
<Combobox name="priority" allowFree={false} defaultValue="NORMAL" options={[{value:"URGENT",label:"عاجلة"},{value:"HIGH",label:"مهمة"},{value:"NORMAL",label:"عادية"},{value:"LOW",label:"منخفضة"}]} />
<Combobox name="assignedToId" allowFree={false} placeholder="بلا إسناد" options={taskUsers.map((u:any)=>({value:String(u.id),label:u.fullName}))} />
                  </div>
                  <Combobox name="assignedRole" allowFree={false} placeholder="أو إسناد لدور" options={Object.entries(ROLE_LABELS).map(([value,label]:any)=>({value,label}))} />
                  <div>
                    <label className="label">موعد الاستحقاق</label>
                    <input name="dueDate" type="date" className="input" />
                  </div>
                  <button className="btn-primary w-full" type="submit">إضافة المهمة</button>
                </form>
              </div>
            </details>
          )}
          {cEdit && <Link href={`/patients/${id}/edit`} className="btn-primary">تعديل البيانات</Link>}
          {cArchive && (patient.archivedAt
            ? <form action={restorePatient.bind(null, id)}><button className="btn-ghost text-emerald-700">↩ استرجاع من الأرشيف</button></form>
            : <form action={archivePatient.bind(null, id)}><button className="btn-ghost text-amber-700">🗄 أرشفة</button></form>)}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-gradient-to-l from-brand-700 to-brand-600 text-white shadow-sm">
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          {patient.photoUrl
            ? <Zoom src={patient.photoUrl} className="h-20 w-20 shrink-0 rounded-2xl border-2 border-white/30 object-cover" />
            : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-3xl font-bold">{patient.fullName?.[0] ?? "؟"}</div>}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{patient.fullName}</h1>
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">ملف #{patient.fileNumber}</span>
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs">{PATIENT_STATUS[patient.status as keyof typeof PATIENT_STATUS]}</span>
              {patient.archivedAt && <span className="rounded-full bg-amber-300 px-2.5 py-0.5 text-xs font-medium text-amber-950">مؤرشف</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-brand-50/90">
              {patient.phone && <span>📞 {patient.phone}</span>}
              {patient.governorate?.name && <span>📍 {patient.governorate.name}{patient.district?.name ? ` — ${patient.district.name}` : ""}</span>}
              {patient.injuryType?.name && <span>🩹 {patient.injuryType.name}</span>}
              <span>🗓 سُجّل {fmtDate(patient.registrationDate)}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-white/15 sm:grid-cols-4">
          {[["الجلسات", patient.therapySessions?.length ?? 0], ["التشخيصات", patient.diagnoses?.length ?? 0], ["حالات الرقود", patient.admissions?.length ?? 0], ["الخطط العلاجية", patient._count?.treatmentPlans ?? 0]].map(([l, v], i) => (
            <div key={l as string} className={`px-4 py-3 text-center ${i > 0 ? "border-r border-white/10" : ""}`}>
              <div className="text-2xl font-bold">{v as number}</div>
              <div className="text-xs text-brand-50/80">{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-500">ملخص المراجع</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {summary.map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="text-xs text-gray-400">{label}</div>
              <div className="mt-1 text-sm font-semibold text-gray-800">{value || "—"}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-500">البيانات التفصيلية</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
          {info.map(([k, v]) => (
            <div key={k as string} className="border-r-2 border-gray-100 pr-3">
              <div className="text-xs text-gray-400">{k}</div>
              <div className="text-sm font-medium text-gray-800">{v || "—"}</div>
            </div>
          ))}
        </div>
        {patient.notes && <p className="mt-5 rounded-xl border-r-4 border-amber-300 bg-amber-50 p-3 text-sm text-gray-700">📝 {patient.notes}</p>}
      </div>

      {cPortal && (() => {
        const base = process.env.NEXTAUTH_URL || "";
        const url = patient.accessToken ? `${base}/portal/${patient.accessToken}` : "";
        const wa = patient.phone ? `https://wa.me/${String(patient.phone).replace(/\D/g, "").replace(/^0/, "964")}?text=${encodeURIComponent("مرحباً " + patient.fullName + "، رابط بوابتك في المجمع التأهيلي: " + url)}` : "";
        return (
          <div className="no-print card p-5">
            <h2 className="mb-3 font-semibold text-gray-700">بوابة المريض والمشاركة</h2>
            {patient.accessToken ? (
              <div className="space-y-3 text-sm">
                <div className="break-all rounded-lg bg-gray-50 p-2 text-gray-600">{url}</div>
                <div className="flex flex-wrap gap-2">
                  <a href={url} target="_blank" className="btn-ghost">فتح البوابة</a>
                  <Link href={`/patients/${id}/card`} className="btn-ghost">بطاقة + QR للطباعة</Link>
                  {wa && <a href={wa} target="_blank" className="btn-ghost text-emerald-700">مشاركة عبر واتساب</a>}
                  <form action={revokePortalToken.bind(null, id)}><button className="btn-ghost text-red-600">إلغاء الرابط</button></form>
                </div>
              </div>
            ) : (
              <form action={generatePortalToken.bind(null, id)}>
                <p className="mb-2 text-sm text-gray-500">أنشئ رابطاً خاصاً يدخل بيه المريض ويشوف مواعيده وجلساته.</p>
                <button className="btn-primary" type="submit">إنشاء رابط البوابة</button>
              </form>
            )}
          </div>
        );
      })()}

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-600">آخر الأحداث المهمة</h2>
          <span className="text-xs text-gray-400">ملخص سريع، والتفاصيل داخل التبويبات</span>
        </div>
        {quickEvents.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {quickEvents.map((event: any, idx: number) => (
              <div key={`${event.type}-${idx}`} className="flex items-start gap-3 rounded-xl border border-gray-100 px-3 py-2">
                <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge-neutral">{event.type}</span>
                    <span className="text-xs text-gray-400">{fmtDate(event.date)}</span>
                  </div>
                  <div className="mt-1 truncate text-sm text-gray-700">{event.title || "—"}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">لا توجد أحداث مهمة بعد.</p>
        )}
      </div>

      <PatientTabs patient={JSON.parse(JSON.stringify(patient))} editable={cEdit} perms={Array.from(perms)} role={myRole} slApprovals={JSON.parse(JSON.stringify(slApprovals))}
        centers={centers} medications={medications} rooms={rooms} halls={JSON.parse(JSON.stringify(halls))} therapyStaff={therapyStaff.map((u:any)=>({id:u.id,fullName:u.fullName,activePlans:u._count.therapyPlansAssigned,todaySessions:u._count.therapyAppointmentsAssigned}))} staffNames={taskUsers.map((u:any)=>u.fullName)} staffUsers={JSON.parse(JSON.stringify(taskUsers))} />
    </div>
  );
}
