import { currentPerms, getSession, requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { HubTabs } from "@/components/hub/HubTabs";
import { PATIENTS_CARE_NAV } from "@/lib/hub-nav";
import Link from "next/link";
import { PatientForm } from "@/components/PatientForm";
import { PageHeader } from "@/components/PageHeader";
import { createPatient } from "../actions";
import { getLookups } from "@/lib/lookups";
import { currentUserBranch } from "@/lib/branch-context";

export const dynamic = "force-dynamic";

export default async function NewPatient() {
  await requirePerm("patients.create");
  const perms = await currentPerms();
  const session = await getSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [{ governorates, injuryTypes, centers, formations, ranks, employees, branches, mobilityAids, prostheticTypes }, userBranch, justAdded] = await Promise.all([
    getLookups(),
    currentUserBranch(),
    // If the screen came back here right after a save, show the patient that was just registered.
    userId ? prisma.patient.findFirst({ where: { createdById: userId, createdAt: { gte: new Date(Date.now() - 3 * 60_000) } }, orderBy: { createdAt: "desc" }, select: { id: true, fullName: true, fileNumber: true } }) : null,
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="إضافة مراجع جديد" subtitle="تسجيل مراجع في النظام" icon="➕">
        {perms.has("patients.import") ? <Link href="/patients/import" className="btn-ghost bg-white text-brand-700">⤒ استيراد من Excel</Link> : null}
      </PageHeader>
      <HubTabs nav={PATIENTS_CARE_NAV} active="new" label="تبويبات المرضى والرعاية" perms={perms} />
      {justAdded ? <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>آخر مراجع سجلته قبل لحظات: <b>{justAdded.fullName}</b> (ملف #{justAdded.fileNumber})</span><Link href={`/patients/${justAdded.id}`} className="btn-primary btn-sm">فتح ملفه</Link></div> : null}
      {userBranch?.branch?.name && <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">سيتم اختيار فرعك افتراضياً: {userBranch.branch.name}</div>}
      <PatientForm action={createPatient}
        governorates={JSON.parse(JSON.stringify(governorates))}
        injuryTypes={injuryTypes} centers={centers} formations={formations} ranks={ranks} employees={employees} branches={JSON.parse(JSON.stringify(branches))} defaultBranchId={userBranch?.branchId ?? null} mobilityAids={JSON.parse(JSON.stringify(mobilityAids))} prostheticTypes={JSON.parse(JSON.stringify(prostheticTypes))} />
    </div>
  );
}
