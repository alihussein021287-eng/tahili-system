import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm } from "@/lib/access";
import Link from "next/link";
import { ROLE_LABELS } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/labels";
import { CENTER_STATIONS, normalizeStationName } from "@/lib/stations";

export const dynamic = "force-dynamic";

// المحطات القياسية بالترتيب (أعمدة اللوحة)
const STATIONS = CENTER_STATIONS.map((station) => station.name);

export default async function CareBoard() {
  await requirePerm("journey.view");

  // كل المحطات غير المؤكّدة/المتجاوَزة (الفعّالة) مع مريضها
  const active = await prisma.careStage.findMany({
    where: { status: { in: ["WAITING", "IN_PROGRESS"] }, patient: { archivedAt: null } },
    include: { patient: { select: { id: true, fullName: true, fileNumber: true } } },
    orderBy: [{ patientId: "asc" }, { sequence: "asc" }],
  });

  // المحطة الحالية لكل مريض = أول محطة فعّالة حسب التسلسل
  const currentByPatient = new Map<string, any>();
  for (const st of active) {
    if (!currentByPatient.has(st.patientId)) currentByPatient.set(st.patientId, st);
  }
  const current = Array.from(currentByPatient.values());

  // تجميع حسب اسم المحطة
  const groups = new Map<string, any[]>();
  for (const st of current) {
    const normalized = normalizeStationName(st.station);
    const key = STATIONS.includes(normalized) ? normalized : "محطات أخرى";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(st);
  }
  const cols = [...STATIONS, "محطات أخرى"].filter((s) => (groups.get(s)?.length ?? 0) > 0 || STATIONS.includes(s));

  const M: any = {
    WAITING: { label: "بالانتظار", clr: "bg-gray-100 text-gray-600" },
    IN_PROGRESS: { label: "قيد التنفيذ", clr: "bg-amber-100 text-amber-700" },
  };

  return (
    <div className="space-y-5">
      <PageHeader title="المرضى حسب المحطة" subtitle="توزيع المراجعين الحاليين على محطات المسار — لإدارة الزحمة" icon="🗺" />

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-lg bg-brand-50 px-3 py-1 text-brand-700">إجمالي قيد المسار: <b>{current.length}</b></span>
        {CENTER_STATIONS.map((s) => (
          <span key={s.name} className="rounded-lg bg-gray-100 px-3 py-1 text-gray-600">{s.name}: <b>{groups.get(s.name)?.length ?? 0}</b></span>
        ))}
      </div>

      {current.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
          لا يوجد مراجعون في مسار متابعة نشط حالياً. ابدأ مساراً من ملف أي مراجع (تبويب «مسار المتابعة»).
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cols.map((station) => {
            const items = groups.get(station) ?? [];
            return (
              <div key={station} className="rounded-xl border border-gray-200 bg-gray-50/60">
                <div className="flex items-center justify-between rounded-t-xl bg-brand-600 px-3 py-2 text-white">
                  <span className="text-sm font-semibold">{station}</span>
                  <span className="rounded-full bg-white/20 px-2 text-xs">{items.length}</span>
                </div>
                <div className="space-y-2 p-2">
                  {items.length === 0 && <div className="py-4 text-center text-xs text-gray-400">— لا أحد —</div>}
                  {items.map((st) => {
                    const m = M[st.status] || M.WAITING;
                    return (
                      <Link key={st.id} href={`/patients/${st.patient.id}`} className="block rounded-lg border border-gray-100 bg-white p-2.5 shadow-sm transition hover:border-brand-300 hover:shadow">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-gray-800">{st.patient.fullName}</span>
                          <span className="shrink-0 text-xs text-gray-400">#{st.patient.fileNumber}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.clr}`}>{m.label}</span>
                          {normalizeStationName(st.station) !== st.station && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-500">أصلها: {st.station}</span>}
                          {st.responsibleRole && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{(ROLE_LABELS as any)[st.responsibleRole]}</span>}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
