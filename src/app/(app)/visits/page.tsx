import { prisma } from "@/lib/db";
import { PatientSearchField } from "@/components/PatientSearchField";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms } from "@/lib/access";
import Link from "next/link";
import { fmtDateTime, fmtDate, PATIENT_STATUS } from "@/lib/labels";
import { receptionCheckIn, recordVisit } from "./actions";
import { CENTER_STATIONS } from "@/lib/stations";
import { activeCenterHallOptions } from "@/lib/center-halls";
import { CenterHallSelect } from "@/components/CenterHallSelect";
import { HubTabs } from "@/components/hub/HubTabs";
import { HandoffDialog } from "@/components/handoffs/HandoffDialog";
import { PATIENTS_CARE_NAV } from "@/lib/hub-nav";
import { baghdadDayRange } from "@/lib/display-utils";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";
import { exactIdentifierLookup, patientScopeWhere, visitScopeWhere } from "@/lib/patient-access";
import { getSession } from "@/lib/access";

export const dynamic = "force-dynamic";

const DESTINATION_GROUPS = [
  { label: "المحطات الطبية", names: ["طبيب/تشخيص", "علاج طبيعي", "تضميد/جروح", "المختبر", "الأشعة", "المتابعة"] },
  { label: "الخدمات", names: ["صيدلية", "أجهزة/أطراف", "مالية"] },
  { label: "الإدارة", names: ["الاستقبال"] },
] as const;

function DestinationOptions() {
  return <>
    <option value="">بدون تحويل</option>
    {DESTINATION_GROUPS.map((group) => (
      <optgroup key={group.label} label={group.label}>
        {group.names.map((name) => {
          const station = CENTER_STATIONS.find((item) => item.name === name);
          return station ? <option key={station.name} value={station.name}>{station.name}</option> : null;
        })}
      </optgroup>
    ))}
  </>;
}

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ q?: string; saved?: string; date?: string; branch?: string }> }) {
  await requirePerm("visits.view");
  const perms = await currentPerms();
  const editable = perms.has("visits.manage");
  const canQueue = perms.has("queue.manage");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const asNum = Number(q);
  const isNum = q !== "" && Number.isInteger(asNum) && asNum > 0 && asNum <= 2147483647; // a phone number must not be sent as an INT4 file number

  const { start: startToday, end: endToday } = baghdadDayRange(new Date());
  // The day list: today by default, or any chosen day; the user's branch by default.
  const chosen = sp.date ? new Date(`${sp.date}T00:00:00`) : null;
  const { start: dayStart, end: dayEnd } = chosen && Number.isFinite(chosen.getTime()) ? baghdadDayRange(chosen) : { start: startToday, end: endToday };
  const isToday = dayStart.getTime() === startToday.getTime();
  const userBranch = await currentUserBranch();
  const activeBranchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const canHandoff = perms.has("handoff.send");
  const viewerSession = await getSession();
  const patientScope = await patientScopeWhere(prisma, { userId: (viewerSession?.user as any)?.id ?? "", role: (viewerSession?.user as any)?.role, permissions: perms });
  const visitScope = await visitScopeWhere(prisma, { userId: (viewerSession?.user as any)?.id ?? "", role: (viewerSession?.user as any)?.role, permissions: perms });

  const [patients, todayVisits, matchedPatients, centers, centerHalls, branches] = await Promise.all([
    Promise.resolve([] as Array<{ id: string; fullName: string; fileNumber: number; phone?: string | null; status?: string }>),
    prisma.visit.findMany({
      where: { visitDate: { gte: dayStart, lt: dayEnd }, AND: [visitScope] },
      include: { patient: { include: {
        branch: { select: { name: true } },
        careStages: {
          where: { createdAt: { gte: dayStart, lt: dayEnd } },
          orderBy: { createdAt: "desc" },
          select: { station: true, status: true, createdAt: true },
        },
      } } },
      orderBy: { visitDate: "desc" },
      take: 300,
    }),
    q
      ? prisma.patient.findMany({
          where: { archivedAt: null, AND: [patientScope], OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            ...(isNum ? [{ fileNumber: asNum }] : []),
          ] },
          include: {
            visits: { orderBy: { visitDate: "desc" }, take: 50 },
            appointments: { orderBy: { scheduledAt: "desc" }, take: 1 },
            queueEntries: { where: { createdAt: { gte: startToday, lt: endToday }, status: { in: ["WAITING", "CALLED", "IN_SESSION"] } }, orderBy: { createdAt: "desc" }, take: 1 },
          },
          take: 10, orderBy: { fullName: "asc" },
        })
      : Promise.resolve([]),
    prisma.center.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    activeCenterHallOptions(prisma),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Patients outside the viewer's record scope: identity only, by exact file number or phone (prevents duplicate registration).
  const limitedPatients = q ? await exactIdentifierLookup(prisma, q, patientScope) : [];

  return (
    <div className="space-y-5">
      <PageHeader title="حضور المراجعين وتوجيههم" subtitle={`${isToday ? "حضور اليوم" : `حضور ${fmtDate(dayStart)}`} — ${todayVisits.length}`} icon="📋" />
      <HubTabs nav={PATIENTS_CARE_NAV} active="visits" label="تبويبات المرضى والرعاية" perms={perms} />

      {sp.saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{sp.saved}</div>}

      {editable && (
        <form action={recordVisit} className="card flex flex-wrap items-end gap-2 p-3">
          <input type="hidden" name="returnTo" value="/visits" />
          <div className="flex-1 min-w-[240px]">
            <label className="label">تسجيل حضور مراجع</label>
            <p className="mb-2 text-xs text-gray-500">يثبت وصول المراجع، ويمكنك تحديد المحطة التي سيتوجه إليها بعد الاستقبال.</p>
            <PatientSearchField name="patientId" required placeholder="اختر المراجع" scope="record" />
          </div>
          <div className="flex-1 min-w-[160px]"><label className="label">ملاحظة</label><input name="notes" className="input" placeholder="اختياري" /></div>
          <div className="min-w-[210px]">
            <label className="label" htmlFor="quick-destination">الوجهة التالية</label>
            <select id="quick-destination" name="destination" className="input" defaultValue="">
              <DestinationOptions />
            </select>
          </div>
          <button className="btn-primary" type="submit">✔ تسجيل الحضور</button>
        </form>
      )}

      <form action="/visits" className="card flex items-end gap-2 p-3">
        <div className="flex-1">
          <label className="label">استعلام عن مراجع (سجل الحضور الكامل)</label>
          <input name="q" className="input" defaultValue={q} placeholder="اسم المراجع، الهاتف، أو رقم الملف" autoFocus />
        </div>
        <button className="btn-primary" type="submit">استعلام</button>
      </form>

      {q && matchedPatients.length > 0 && (
        <div className="grid gap-3">
          {matchedPatients.map((p: any) => {
            const lastVisit = p.visits[0];
            const lastAppt = p.appointments[0];
            const hasQueue = p.queueEntries.length > 0;
            const todayVisit = p.visits.find((v: any) => new Date(v.visitDate) >= startToday && new Date(v.visitDate) < endToday);
            const locked = Boolean(p.archivedAt);
            const inactive = p.status !== "ACTIVE";
            return (
              <div key={p.id} className={`card p-4 ${locked ? "border-red-200 bg-red-50/30" : inactive ? "border-amber-200 bg-amber-50/30" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/patients/${p.id}`} className="text-base font-bold text-brand-700 hover:underline">{p.fullName}</Link>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>ملف #{p.fileNumber}</span>
                      <span>{p.phone || "لا يوجد هاتف"}</span>
                      <span className="badge-neutral">{PATIENT_STATUS[p.status as keyof typeof PATIENT_STATUS]}</span>
                      {locked && <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-700">مؤرشف</span>}
                      {inactive && !locked && <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-700">تنبيه: غير نشط</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 sm:grid-cols-3">
                    <div className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-gray-400">آخر زيارة</div><div className="font-medium text-gray-700">{lastVisit ? fmtDateTime(lastVisit.visitDate) : "—"}</div></div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-gray-400">آخر موعد</div><div className="font-medium text-gray-700">{lastAppt ? fmtDate(lastAppt.scheduledAt) : "—"}</div></div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-gray-400">اليوم</div><div className="font-medium text-gray-700">{todayVisit ? "حاضر" : hasQueue ? "بالطابور" : "لم يسجل"}</div></div>
                  </div>
                </div>

                {editable && !locked && (
                  <form action={receptionCheckIn} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="patientId" value={p.id} />
                    <input type="hidden" name="returnTo" value={`/visits?q=${encodeURIComponent(q)}`} />
                    <div className="min-w-[180px] flex-1">
                      <label className="label">ملاحظة الزيارة</label>
                      <input name="notes" className="input" placeholder="اختياري" />
                    </div>
                    <div className="min-w-[210px]">
                    <label className="label" htmlFor={`destination-${p.id}`}>الوجهة التالية</label>
                    <p className="mb-1 text-xs text-gray-500">القسم المسؤول بعد الاستقبال</p>
                      <select id={`destination-${p.id}`} name="destination" className="input" defaultValue="">
                      <DestinationOptions />
                      </select>
                    </div>
                    <button className="btn-primary" type="submit">تسجيل الحضور والتوجيه</button>
                    {canQueue && (
                      <>
                        <CenterHallSelect
                          centers={centers}
                          halls={centerHalls}
                          hallFieldName="hall"
                          hallValue="name"
                          requiredCenter={false}
                          requiredHall={false}
                          className="grid min-w-[420px] flex-[2] gap-2 md:grid-cols-2"
                        />
                        <button className="btn-ghost" type="submit" name="sendQueue" value="1">تسجيل الحضور وإرسال للطابور</button>
                      </>
                    )}
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {q && matchedPatients.length === 0 && limitedPatients.length === 0 && (
        <p className="text-sm text-gray-400">لا نتائج لـ «{q}».</p>
      )}

      {limitedPatients.length > 0 && (
        <div className="card p-4 text-sm" data-testid="limited-patient-lookup">
          <p className="mb-2 font-medium">مراجع مسجّل خارج نطاق فرعك — يمكن تسجيل حضوره بعد التحقق من الوثيقة الأصلية؛ ولا يُفتح ملفه إلا عبر تحويل أو إحالة معتمدة.</p>
          <ul className="space-y-1">
            {limitedPatients.map((p) => (
              <li key={p.id} className="space-y-2">
                <div><bdi>{p.fullName}</bdi> · رقم الملف <bdi>{p.fileNumber}</bdi></div>
                {editable && (
                  <form action={receptionCheckIn} className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 md:grid-cols-2" data-testid={`cross-branch-checkin-${p.id}`}>
                    <input type="hidden" name="patientId" value={p.id} />
                    <input type="hidden" name="returnTo" value={`/visits?q=${encodeURIComponent(q)}`} />
                    <p className="md:col-span-2 text-xs text-gray-600">تحقّق من الوثيقة الأصلية بحضور المراجع وطابق بياناتها، ثم أدخلها هنا. لا تُحفظ صورة الوثيقة ولا رقمها.</p>
                    <label className="label">تاريخ الميلاد حسب الوثيقة<input type="date" name="documentBirthDate" className="input mt-1" required /></label>
                    <label className="label">اسم الأم حسب الوثيقة<input name="documentMotherName" className="input mt-1" required autoComplete="off" /></label>
                    <label className="md:col-span-2 flex items-start gap-2 text-sm">
                      <input type="checkbox" name="documentAttested" value="1" required className="mt-1" />
                      <span>أقرّ بأنني اطّلعت على الوثيقة الأصلية للمراجع بحضوره وطابقت بياناتها.</span>
                    </label>
                    <div className="min-w-[200px]">
                      <label className="label" htmlFor={`xdest-${p.id}`}>الوجهة التالية</label>
                      <select id={`xdest-${p.id}`} name="destination" className="input mt-1" defaultValue=""><DestinationOptions /></select>
                    </div>
                    <div className="md:col-span-2 flex flex-wrap items-end gap-2">
                      <button className="btn-primary" type="submit">تحقّق وسجّل الحضور</button>
                      {canQueue && (
                        <>
                          <CenterHallSelect centers={centers} halls={centerHalls} hallFieldName="hall" hallValue="name" requiredCenter={false} requiredHall={false} className="grid min-w-[300px] flex-[2] gap-2 md:grid-cols-2" />
                          <button className="btn-ghost" type="submit" name="sendQueue" value="1">تحقّق وسجّل الحضور وإرسال للطابور</button>
                        </>
                      )}
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {q && matchedPatients.map((p: any) => (
        <div key={p.id} className="card overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">
            <Link href={`/patients/${p.id}`} className="text-brand-700 hover:underline">{p.fullName}</Link>
            <span className="text-gray-400"> (#{p.fileNumber}) — {p.visits.length} زيارة</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">#</th><th className="th">التاريخ والوقت</th><th className="th">ملاحظات</th></tr></thead>
              <tbody>
                {p.visits.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={3}>لا توجد زيارات مسجّلة</td></tr>}
                {p.visits.map((v: any) => (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="td">{v.sequenceNo ?? "—"}</td>
                    <td className="td">{fmtDateTime(v.visitDate)}</td>
                    <td className="td">{v.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div className="font-semibold text-gray-700">{isToday ? "حضور اليوم" : `حضور ${fmtDate(dayStart)}`} <span className="text-gray-400">({todayVisits.length})</span></div>
          <form action="/visits" className="flex flex-wrap items-end gap-2">
            <label className="label">اليوم<input type="date" name="date" className="input mt-1" defaultValue={sp.date ?? ""} /></label>
            {branches.length > 0 ? (
              <label className="label">الفرع<select name="branch" className="input mt-1" defaultValue={sp.branch === "all" ? "all" : activeBranchId ? String(activeBranchId) : "all"}>
                <option value="all">كل الفروع</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select></label>
            ) : null}
            <button className="btn-ghost" type="submit">عرض</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">رقم الملف</th><th className="th">الفرع</th><th className="th">الوجهة الحالية</th><th className="th">ملاحظات</th>{canHandoff && <th className="th">التحويل</th>}</tr></thead>
            <tbody>
              {todayVisits.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={canHandoff ? 7 : 6}>لا يوجد حضور مسجّل لهذا اليوم</td></tr>}
              {todayVisits.map((v: any) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="td">{fmtDateTime(v.visitDate)}</td>
                  <td className="td"><Link href={`/patients/${v.patientId}`} className="text-brand-700 hover:underline">{v.patient.fullName}</Link></td>
                  <td className="td">{v.patient.fileNumber}</td>
                  <td className="td">{v.patient.branch?.name ?? "بدون فرع"}</td>
                  <td className="td">{v.patient.careStages.find((stage: any) => ["WAITING", "IN_PROGRESS"].includes(stage.status))?.station ?? v.patient.careStages[0]?.station ?? "بدون تحويل"}</td>
                  <td className="td">{v.notes ?? "—"}</td>
                  {canHandoff && <td className="td"><HandoffDialog patientId={v.patientId} patientName={v.patient.fullName} fileNumber={String(v.patient.fileNumber)} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
