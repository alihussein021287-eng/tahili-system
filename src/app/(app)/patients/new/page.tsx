import { requirePerm } from "@/lib/access";
import Link from "next/link";
import { PatientForm } from "@/components/PatientForm";
import { PageHeader } from "@/components/PageHeader";
import { createPatient } from "../actions";
import { getLookups } from "@/lib/lookups";
import { currentUserBranch } from "@/lib/branch-context";

export const dynamic = "force-dynamic";

export default async function NewPatient() {
  await requirePerm("patients.create");
  const [{ governorates, injuryTypes, centers, formations, ranks, employees, branches, mobilityAids, prostheticTypes }, userBranch] = await Promise.all([
    getLookups(),
    currentUserBranch(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="إضافة مراجع جديد" subtitle="تسجيل مراجع في النظام" icon="➕">
        <Link href="/patients-care?tab=new" className="btn-ghost bg-white text-brand-700">لوحة المرضى والرعاية</Link>
      </PageHeader>
      {userBranch?.branch?.name && <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">سيتم اختيار فرعك افتراضياً: {userBranch.branch.name}</div>}
      <PatientForm action={createPatient}
        governorates={JSON.parse(JSON.stringify(governorates))}
        injuryTypes={injuryTypes} centers={centers} formations={formations} ranks={ranks} employees={employees} branches={JSON.parse(JSON.stringify(branches))} defaultBranchId={userBranch?.branchId ?? null} mobilityAids={JSON.parse(JSON.stringify(mobilityAids))} prostheticTypes={JSON.parse(JSON.stringify(prostheticTypes))} />
    </div>
  );
}
