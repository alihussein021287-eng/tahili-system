import { prisma } from "@/lib/db";
import { PatientSearchField } from "@/components/PatientSearchField";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms, getSession } from "@/lib/access";

import Link from "next/link";
import { fmtTime } from "@/lib/labels";
import { addToQueue, assignQueueHall, setQueueStatus, removeQueue, clearDoneQueue } from "./actions";
import { handoffParty } from "@/lib/patient-handoff-presentation";
import { baghdadDayRange } from "@/lib/display-utils";
import { queueScopeAllows, queueVisibilityWhere } from "@/lib/queue-transitions";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";
import { queueHallNames } from "@/lib/queue";
import { activeCenterHallNames, activeCenterHallOptions } from "@/lib/center-halls";
import { CenterHallSelect } from "@/components/CenterHallSelect";
import { SubmitButton } from "@/components/SubmitButton";
import { HubTabs } from "@/components/hub/HubTabs";
import { HandoffDialog } from "@/components/handoffs/HandoffDialog";
import { PATIENTS_CARE_NAV } from "@/lib/hub-nav";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";

export const dynamic = "force-dynamic";

const SHARED_COLS = [
  { key: "CALLED", label: "تم الاستدعاء", clr: "border-sky-300", head: "bg-sky-100 text-sky-700", next: "IN_SESSION", nextLabel: "إدخال للجلسة" },
  { key: "IN_SESSION", label: "داخل الجلسة", clr: "border-amber-300", head: "bg-amber-100 text-amber-700", next: "DONE", nextLabel: "إنهاء" },
  { key: "DONE", label: "خلص", clr: "border-green-300", head: "bg-green-100 text-green-700", next: null, nextLabel: "" },
];

export default async function Queue({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const session = await getSession();
  await requirePerm("queue.view");
  const perms = await currentPerms();
  const editable = perms.has("queue.manage");
  const canDeleteQueue = (session?.user as any)?.role === "ADMIN";
  const { start: startToday, end: endToday } = baghdadDayRange(new Date());
  const sp = await searchParams;
  const userBranch = await currentUserBranch();
  const activeBranchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const canHandoff = perms.has("handoff.send");
  // Mirror the server scope so users are not shown actions that would be refused.
  const sessionUser = session?.user as { id?: string; role?: any } | undefined;
  const centralActor = sessionUser?.role === "ADMIN";
  const memberRole = sessionUser?.role ? centerRoleForUserRole(sessionUser.role) : null;
  const myCenterIds = memberRole && sessionUser?.id
    ? (await prisma.centerMembership.findMany({ where: { userId: sessionUser.id, ...activeMembershipWhere(memberRole), center: { active: true } }, select: { centerId: true } })).map((m) => m.centerId)
    : [];
  const userBranchActive = userBranch?.branch?.isActive === true;
  const canAct = (entry: { centerId: number | null; branchId: number | null; patient: { branchId: number | null } }) => queueScopeAllows({
    central: centralActor, userBranchId: userBranch?.branchId ?? null, userBranchActive,
    entryBranchId: entry.branchId ?? entry.patient.branchId, entryCenterId: entry.centerId, memberCenterIds: myCenterIds,
  });
  const visibility = queueVisibilityWhere({
    central: centralActor, requestedBranchId: centralActor ? activeBranchId : null,
    userBranchId: userBranch?.branchId ?? null, userBranchActive, memberCenterIds: myCenterIds,
  });

  const [entries, patients, centers, centerHalls, branches] = await Promise.all([
    prisma.queueEntry.findMany({
      where: { createdAt: { gte: startToday, lt: endToday }, ...visibility },
      // Who holds the patient now comes from the open handoff (same as the patient file and list).
      include: { patient: { include: { handoffs: { where: { status: { in: ["SENT", "ACCEPTED"] } }, orderBy: { sentAt: "desc" }, take: 1, select: { toRole: true, status: true, toUser: { select: { fullName: true } }, acceptedBy: { select: { fullName: true } }, toCenter: { select: { name: true } } } } } } },
      orderBy: { createdAt: "asc" },
    }),
    // Patients that can be queued from this scope: own branch (or no branch yet); ADMIN sees all.
    Promise.resolve([] as Array<{ id: string; fullName: string; fileNumber: number; phone?: string | null; status?: string }>),
    prisma.center.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    activeCenterHallOptions(prisma),
    centralActor ? prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([] as { id: number; name: string }[]),
  ]);
  const activeHalls = queueHallNames(activeCenterHallNames(centerHalls));
  const historicalEntryHalls = entries.map((entry) => entry.hall).filter((hall): hall is string => Boolean(hall));
  const halls = queueHallNames([...activeHalls, ...historicalEntryHalls]);
  const unassignedEntries = entries.filter((entry) => entry.status === "WAITING" && !entry.hall);

  return (
    <div className="space-y-5">
      <PageHeader title="طابور المراجعين" subtitle={`طابور اليوم — ${entries.length}${unassignedEntries.length ? ` · ${unassignedEntries.length} بحاجة لتحديد القاعة` : ""}`} icon="⏳" />
      <HubTabs nav={PATIENTS_CARE_NAV} active="queue" label="تبويبات المرضى والرعاية" perms={perms} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {branches.length > 0 ? (
          <form action="/queue" className="flex items-end gap-2">
            <label className="label">الفرع<select name="branch" className="input mt-1" defaultValue={sp.branch === "all" ? "all" : activeBranchId ? String(activeBranchId) : "all"}>
              <option value="all">كل الفروع</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select></label>
            <button className="btn-ghost" type="submit">عرض</button>
          </form>
        ) : <span />}
        <div className="flex items-center gap-2">
          <a href="/display" target="_blank" className="btn-ghost text-sm">📺 شاشة العرض</a>
          {canDeleteQueue && <form action={clearDoneQueue}><button className="btn-ghost text-sm">🧹 تفريغ المنتهين</button></form>}
        </div>
      </div>

      {editable && (
        <form action={addToQueue} className="card flex flex-wrap items-end gap-2 p-3">
          <div className="flex-1 min-w-[220px]">
            <label className="label">إضافة مراجع للطابور</label>
<PatientSearchField name="patientId" required placeholder="اختر المريض" scope="record" />
          </div>
          <CenterHallSelect
            centers={centers}
            halls={centerHalls}
            hallFieldName="hall"
            hallValue="name"
            requiredCenter
            requiredHall
            className="grid min-w-[420px] flex-[2] gap-2 md:grid-cols-2"
          />
          <div className="flex-1 min-w-[160px]"><label className="label">ملاحظة</label><input name="note" className="input" placeholder="اختياري" /></div>
          <button className="btn-primary" type="submit">➕ للطابور</button>
        </form>
      )}

      {unassignedEntries.length > 0 && (
        <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4" aria-label="مراجعون بانتظار تحديد القاعة">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-semibold text-amber-900">بالانتظار — تحتاج القاعة إلى التحديد ({unassignedEntries.length})</h2>
              <p className="mt-1 text-xs text-amber-800">هذا تعيين لنفس مدخل الطابور؛ لا ينشئ مراجعاً أو دوراً جديداً.</p>
            </div>
          </div>
          <div className="space-y-2">
            {unassignedEntries.map((entry) => {
              const fixedCenter = entry.centerId ? centers.find((center) => center.id === entry.centerId) : null;
              return (
                <div key={entry.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 bg-white p-3">
                  <div className="min-w-[180px] flex-1">
                    <Link href={`/patients/${entry.patientId}`} className="font-medium text-brand-700 hover:underline">{entry.patient.fullName}</Link>
                    <p className="text-xs text-gray-500">{fixedCenter ? `المركز: ${fixedCenter.name}` : "المركز غير محدد"} · دخل {fmtTime(entry.createdAt)}</p>
                  </div>
                  {editable && canAct(entry) && (
                    <form action={assignQueueHall} className="flex flex-1 flex-wrap items-end gap-2">
                      <input type="hidden" name="queueEntryId" value={entry.id} />
                      {fixedCenter ? (
                        <>
                          <input type="hidden" name="centerId" value={fixedCenter.id} />
                          <label className="label min-w-[180px]">القاعة
                            <select name="hall" className="input mt-1" required defaultValue="">
                              <option value="" disabled>اختر القاعة</option>
                              {centerHalls.filter((hall) => hall.centerId === fixedCenter.id).map((hall) => <option key={`${hall.centerId}-${hall.resourceId}`} value={hall.hallName}>{hall.hallName}</option>)}
                            </select>
                          </label>
                        </>
                      ) : (
                        <CenterHallSelect centers={centers} halls={centerHalls} hallFieldName="hall" hallValue="name" requiredCenter requiredHall className="grid min-w-[360px] flex-1 gap-2 md:grid-cols-2" />
                      )}
                      <SubmitButton className="btn-primary">تعيين القاعة</SubmitButton>
                    </form>
                  )}
                  {canDeleteQueue && <form action={removeQueue.bind(null, entry.id)}><button className="text-red-400 hover:text-red-600" title="إزالة من الطابور">×</button></form>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* الانتظار: مربع لكل قاعة */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {halls.map((hall) => {
          const list = entries.filter((e) => e.status === "WAITING" && e.hall === hall);
          return (
            <div key={hall} className="rounded-xl border-2 border-gray-300 bg-white">
              <div className="rounded-t-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700">⏳ {hall} <span className="opacity-70">({list.length})</span></div>
              <div className="space-y-2 p-3">
                {list.length === 0 && <p className="py-4 text-center text-xs text-gray-400">—</p>}
                {list.map((e) => (
                  <div key={e.id} className="rounded-lg border border-gray-200 p-3">
                    <Link href={`/patients/${e.patientId}`} className="font-medium text-brand-700 hover:underline">{e.patient.fullName}</Link>
                    <div className="text-xs text-gray-400">دخل الطابور {fmtTime(e.createdAt)}{e.note ? ` — ${e.note}` : ""}</div>
                    {e.patient.handoffs?.[0] && <div className="mt-1 text-xs text-slate-500">{e.patient.handoffs[0].status === "SENT" ? "بانتظار" : "عند"}: <b>{handoffParty(e.patient.handoffs[0].status === "ACCEPTED" ? e.patient.handoffs[0].acceptedBy?.fullName ?? e.patient.handoffs[0].toUser?.fullName : e.patient.handoffs[0].toUser?.fullName, e.patient.handoffs[0].toRole, e.patient.handoffs[0].toCenter?.name)}</b></div>}
                    {canHandoff && <div className="mt-2"><HandoffDialog patientId={e.patientId} patientName={e.patient.fullName} fileNumber={String(e.patient.fileNumber)} /></div>}
                    {editable && canAct(e) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <form action={setQueueStatus.bind(null, e.id, "CALLED")}><button className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">استدعاء ←</button></form>
                        {canDeleteQueue && <form action={removeQueue.bind(null, e.id)}><button className="text-red-400 hover:text-red-600" title="إزالة">×</button></form>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* المراحل المشتركة */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SHARED_COLS.map((col) => {
          const list = entries.filter((e) => e.status === col.key);
          return (
            <div key={col.key} className={`rounded-xl border-2 ${col.clr} bg-white`}>
              <div className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${col.head}`}>{col.label} <span className="opacity-70">({list.length})</span></div>
              <div className="space-y-2 p-3">
                {list.length === 0 && <p className="py-4 text-center text-xs text-gray-400">—</p>}
                {list.map((e) => (
                  <div key={e.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/patients/${e.patientId}`} className="font-medium text-brand-700 hover:underline">{e.patient.fullName}</Link>
                      {e.hall && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{e.hall.replace("قاعة ", "")}</span>}
                    </div>
                    <div className="text-xs text-gray-400">دخل الطابور {fmtTime(e.createdAt)}{e.note ? ` — ${e.note}` : ""}</div>
                    {e.patient.handoffs?.[0] && <div className="mt-1 text-xs text-slate-500">{e.patient.handoffs[0].status === "SENT" ? "بانتظار" : "عند"}: <b>{handoffParty(e.patient.handoffs[0].status === "ACCEPTED" ? e.patient.handoffs[0].acceptedBy?.fullName ?? e.patient.handoffs[0].toUser?.fullName : e.patient.handoffs[0].toUser?.fullName, e.patient.handoffs[0].toRole, e.patient.handoffs[0].toCenter?.name)}</b></div>}
                    {canHandoff && <div className="mt-2"><HandoffDialog patientId={e.patientId} patientName={e.patient.fullName} fileNumber={String(e.patient.fileNumber)} /></div>}
                    {editable && canAct(e) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {col.next && <form action={setQueueStatus.bind(null, e.id, col.next)}><button className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">{col.nextLabel} ←</button></form>}
                        {col.next && <form action={setQueueStatus.bind(null, e.id, "WAITING")}><button className="text-xs text-gray-400 hover:underline">رجوع</button></form>}
                        {canDeleteQueue && <form action={removeQueue.bind(null, e.id)}><button className="text-red-400 hover:text-red-600" title="إزالة">×</button></form>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
