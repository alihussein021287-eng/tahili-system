import { requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { notFound } from "next/navigation";
import { PatientForm } from "@/components/PatientForm";
import { updatePatient } from "../../actions";
import { getLookups } from "@/lib/lookups";

export const dynamic = "force-dynamic";

export default async function EditPatient({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("patients.edit");
  const { id } = await params;
  const [patient, lookups] = await Promise.all([
    prisma.patient.findUnique({ where: { id } }),
    getLookups(),
  ]);
  if (!patient) notFound();
  const action = updatePatient.bind(null, id);
  return (
    <div className="space-y-4">
      <PageHeader title={`تعديل: ${patient.fullName}`} subtitle="تحديث بيانات المراجع" icon="✏" />
      <PatientForm action={action} patient={JSON.parse(JSON.stringify(patient))}
        governorates={JSON.parse(JSON.stringify(lookups.governorates))}
        injuryTypes={lookups.injuryTypes} centers={lookups.centers} formations={lookups.formations} ranks={lookups.ranks} employees={lookups.employees}
        branches={JSON.parse(JSON.stringify(lookups.branches ?? []))} mobilityAids={JSON.parse(JSON.stringify(lookups.mobilityAids ?? []))} prostheticTypes={JSON.parse(JSON.stringify(lookups.prostheticTypes ?? []))} />
    </div>
  );
}
