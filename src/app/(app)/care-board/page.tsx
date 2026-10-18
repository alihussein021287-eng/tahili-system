import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requirePerm } from "@/lib/access";
import Link from "next/link";
import { HubTabs } from "@/components/hub/HubTabs";
import { PATIENTS_CARE_NAV } from "@/lib/hub-nav";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";
import { handoffDelayColor, handoffLimitMinutes } from "@/lib/handoff-rules";
import { handoffElapsed } from "@/lib/patient-handoff-presentation";

export const dynamic = "force-dynamic";

// One column per stage of the patient's path. A patient sits in the column of whoever holds the
// open handoff, the same source the patient file and the patient list use.
const COLUMNS = [
  { role: "RECEPTION", label: "الاستقبال" },
  { role: "DATA_ENTRY", label: "إدخال البيانات" },
  { role: "SECRETARY", label: "السكرتارية" },
  { role: "RESIDENT", label: "الطبيب المقيم" },
  { role: "DOCTOR", label: "الاختصاص" },
  { role: "HEAD_THERAPIST", label: "رئيس المعالجين" },
  { role: "THERAPIST", label: "المعالج" },
] as const;

const DELAY_STYLE = {
  green: "bg-white text-gray-500",
  yellow: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
} as const;

export default async function CareBoard({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  await requirePerm("journey.view");
  const sp = await searchParams;
  const perms = await currentPerms();
  const userBranch = await currentUserBranch();
  const activeBranchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const now = new Date();

  const open = await prisma.patientHandoff.findMany({
    where: { status: { in: ["SENT", "ACCEPTED"] }, patient: { archivedAt: null, ...(activeBranchId ? { branchId: activeBranchId } : {}) } },
    select: {
      id: true, status: true, toRole: true, sentAt: true, acceptedAt: true, fromCenterId: true, toCenterId: true,
      patient: { select: { id: true, fullName: true, fileNumber: true } },
      toUser: { select: { fullName: true } }, acceptedBy: { select: { fullName: true } }, toCenter: { select: { name: true } },
    },
    orderBy: { sentAt: "asc" },
  });

  // A patient has at most one open handoff; keep the newest if old data has more.
  const byPatient = new Map<string, (typeof open)[number]>();
  for (const handoff of open) byPatient.set(handoff.patient.id, handoff);
  const current = [...byPatient.values()];
  const inColumn = (role: string) => current.filter((handoff) => handoff.toRole === role);
  const known = new Set<string>(COLUMNS.map((column) => column.role));
  const others = current.filter((handoff) => !known.has(handoff.toRole));
  const late = current.filter((handoff) => handoffDelayColor(handoff.sentAt, now, handoffLimitMinutes(handoff)) === "red").length;

  return (
    <div className="space-y-5">
      <PageHeader title="مسار الرعاية" subtitle="وين كل مراجع هسه، حسب منو ماسكه — لمتابعة الزحمة والتأخير" icon="🗺" />
      <HubTabs nav={PATIENTS_CARE_NAV} active="journey" label="تبويبات المرضى والرعاية" perms={perms} />
      {branches.length > 0 ? (
        <form action="/care-board" className="flex items-end gap-2">
          <label className="label">الفرع<select name="branch" className="input mt-1" defaultValue={sp.branch === "all" ? "all" : activeBranchId ? String(activeBranchId) : "all"}>
            <option value="all">كل الفروع</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></label>
          <button className="btn-ghost" type="submit">عرض</button>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-lg bg-brand-50 px-3 py-1 text-brand-700">مراجعون بتحويلة مفتوحة: <b>{current.length}</b></span>
        {late ? <span className="rounded-lg bg-red-50 px-3 py-1 text-red-700">متأخرون عن الوقت المسموح: <b>{late}</b></span> : null}
      </div>

      {current.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
          ماكو مراجع بتحويلة مفتوحة حالياً. المراجع يظهر هنا من يتحوّل بزر «حوّل إلى» من قائمة المراجعين أو ملفه.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[...COLUMNS.map((column) => ({ ...column, items: inColumn(column.role) })), ...(others.length ? [{ role: "OTHER", label: "أخرى", items: others }] : [])].map((column) => (
            <div key={column.role} className="rounded-xl border border-gray-200 bg-gray-50/60">
              <div className="flex items-center justify-between rounded-t-xl bg-brand-600 px-3 py-2 text-white">
                <span className="text-sm font-semibold">{column.label}</span>
                <span className="rounded-full bg-white/20 px-2 text-xs">{column.items.length}</span>
              </div>
              <div className="space-y-2 p-2">
                {column.items.length === 0 && <div className="py-4 text-center text-xs text-gray-400">— لا أحد —</div>}
                {column.items.map((handoff) => {
                  const accepted = handoff.status === "ACCEPTED";
                  const holder = accepted ? handoff.acceptedBy?.fullName ?? handoff.toUser?.fullName : handoff.toUser?.fullName;
                  const delay = handoffDelayColor(handoff.sentAt, now, handoffLimitMinutes(handoff));
                  return (
                    <Link key={handoff.id} href={`/patients/${handoff.patient.id}`} className="block rounded-lg border border-gray-100 bg-white p-2.5 shadow-sm transition hover:border-brand-300 hover:shadow">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-gray-800">{handoff.patient.fullName}</span>
                        <span className="shrink-0 text-xs text-gray-400">#{handoff.patient.fileNumber}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${accepted ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{accepted ? "مستلم" : "بانتظار الاستلام"}</span>
                        {holder ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{holder}</span> : null}
                        {handoff.toCenter?.name ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{handoff.toCenter.name}</span> : null}
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${DELAY_STYLE[delay]}`}>منذ {handoffElapsed(accepted ? handoff.acceptedAt ?? handoff.sentAt : handoff.sentAt, now)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
