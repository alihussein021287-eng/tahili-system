import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms, getSession } from "@/lib/access";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

import Link from "next/link";
import { fmtTime } from "@/lib/labels";
import { addMedDose, toggleMedGiven, deleteMedDose } from "./actions";

export const dynamic = "force-dynamic";

export default async function Meds() {
  const session = await getSession();
  await requirePerm("meds.view");
  const perms = await currentPerms();
  const isAdminRole = ((await getSession())?.user as any)?.role === "ADMIN";
  const editable = perms.has("meds.manage");
  const startToday = new Date(new Date().toDateString());

  const [admitted, doses] = await Promise.all([
    prisma.admission.findMany({ where: { status: "ADMITTED" }, include: { patient: true } }),
    prisma.medDose.findMany({ where: { date: { gte: startToday } }, include: { patient: true }, orderBy: [{ given: "asc" }, { timeLabel: "asc" }] }),
  ]);
  const patients = admitted.map((a) => a.patient).filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
  const pending = doses.filter((d) => !d.given).length;

  return (
    <div className="space-y-5">
      <PageHeader title="أدوية الراقدين" subtitle={`جرعات اليوم — متبقّي ${pending}`} icon="💊" />

      {editable && (
        <form action={addMedDose} className="card flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-[180px]">
            <label className="label">المريض (راقد)</label>
            <Combobox name="patientId" required allowFree={false} options={patients.map((p:any)=>({value:String(p.id),label:`${p.fullName} (#${p.fileNumber})`}))} />
          </div>
          <div className="flex-1 min-w-[140px]"><label className="label">الدواء</label><input name="drug" className="input" required /></div>
          <div><label className="label">الجرعة</label><input name="dose" className="input !w-28" placeholder="مثل: 500mg" /></div>
          <div><label className="label">الوقت</label><input name="timeLabel" className="input !w-28" placeholder="مثل: 8 صباحاً" required /></div>
          <button className="btn-primary" type="submit">➕ إضافة</button>
        </form>
      )}

      {patients.length === 0 && <p className="text-sm text-gray-400">لا يوجد مرضى راقدون حالياً.</p>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr><th className="th">الحالة</th><th className="th">المريض</th><th className="th">الدواء</th><th className="th">الجرعة</th><th className="th">الوقت</th><th className="th">أُعطي في</th>{editable && <th className="th"></th>}</tr></thead>
          <tbody>
            {doses.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={7}>لا توجد جرعات مسجّلة اليوم.</td></tr>}
            {doses.map((d) => (
              <tr key={d.id} className={`hover:bg-gray-50 ${d.given ? "opacity-60" : ""}`}>
                <td className="td">
                  {editable ? (
                    <form action={toggleMedGiven.bind(null, d.id, !d.given)}>
                      <button className={`rounded px-2 py-1 text-xs font-medium ${d.given ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{d.given ? "✓ أُعطي" : "تأشير كمُعطى"}</button>
                    </form>
                  ) : (d.given ? "✓ أُعطي" : "بانتظار")}
                </td>
                <td className="td"><Link href={`/patients/${d.patientId}`} className="text-brand-700 hover:underline">{d.patient.fullName}</Link></td>
                <td className="td font-medium">{d.drug}</td>
                <td className="td">{d.dose || "—"}</td>
                <td className="td">{d.timeLabel}</td>
                <td className="td">{d.givenAt ? fmtTime(d.givenAt) : "—"}</td>
                {isAdminRole && <td className="td"><form action={deleteMedDose.bind(null, d.id)}><button className="text-red-400 hover:text-red-600" title="حذف">×</button></form></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
