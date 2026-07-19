import Link from "next/link";
import { SERVICE_LABELS } from "@/lib/center-workspaces";

export function PatientCenterPrograms({ programs }: { programs: any[] }) {
  return <section className="space-y-3"><h2 className="text-lg font-bold">برامج المراكز التخصصية</h2>{programs.length === 0 ? <p className="text-sm text-gray-500">لا توجد برامج مركزية مرتبطة بهذا الملف.</p> : programs.map((program)=><article key={program.id} className="rounded-xl border border-gray-200 p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-bold">{SERVICE_LABELS[program.serviceType] || program.serviceType}</h3><p className="text-sm text-gray-600">{program.center.name}، {program.assignedTo?.fullName || "غير مسند"}</p></div><span className={program.status === "COMPLETED" ? "badge-success" : "badge-info"}>{program.status === "COMPLETED" ? "مكتمل" : "نشط"}</span></div><p className="mt-3 whitespace-pre-wrap break-words text-sm">{program.goals || program.initialSummary}</p><Link href="/therapy-centers?tab=centers" className="btn-ghost mt-3 inline-flex">فتح مساحة المركز</Link></article>)}</section>;
}
