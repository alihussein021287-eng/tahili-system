import { prisma } from "@/lib/db";
import { currentPerms, requireSession } from "@/lib/access";
import { currentTherapyActor } from "@/lib/therapy-session-lock";
import { centerStationByName } from "@/lib/stations";
import type { ClinicalActor } from "@/lib/clinical-review-service";
import { assignServiceAction, executeServiceAction } from "@/app/(app)/scope-closure-actions";
export async function ServiceAssignmentControls({ patientId }: { patientId: string }) {
  const perms = await currentPerms(); if (!perms.has("services.assign") && !perms.has("services.execute")) return null;
  const u = (await requireSession()).user as { id: string; role: ClinicalActor["role"]; authVersion: number };
  const patient = await prisma.patient.findFirst({ where: { id: patientId, archivedAt: null }, select: { branchId: true } });
  if (!patient?.branchId) return null;
  const current = await currentTherapyActor(prisma, { id: u.id, role: u.role, authVersion: u.authVersion }, perms.has("services.assign") ? "services.assign" : "services.execute", patientId);
  const stages = await prisma.careStage.findMany({ where: { patientId, responsibilityScope: "SERVICE", status: { in: ["WAITING", "IN_PROGRESS"] } }, orderBy: { sequence: "asc" }, include: { serviceAuthority: true } });
  const items = [];
  for (const s of stages) {
    const catalog = centerStationByName(s.station); if (!catalog || catalog.role !== s.responsibleRole) continue;
    const a = await prisma.serviceResponsibility.findFirst({ where: { branchId: patient.branchId, serviceKey: catalog.key, responsibleId: u.id, revokedAt: null } });
    const canAssign = !!a && current.role === catalog.role && perms.has("services.assign") && !s.operationalCompletedAt;
    const mine = s.assignedUserId === u.id && !!s.serviceAssignmentId && !s.serviceAuthority?.revokedAt && perms.has("services.execute");
    if (!canAssign && !mine) continue;
    const people: { id: string; fullName: string }[] = [];
    if (canAssign) for (const p of await prisma.user.findMany({ where: { branchId: patient.branchId, isActive: true, needsActivation: false, role: catalog.role, id: { not: u.id } }, select: { id: true, fullName: true, role: true, authVersion: true } })) {
      try { await currentTherapyActor(prisma, { id: p.id, role: p.role, authVersion: p.authVersion }, "services.execute", patientId); people.push(p); } catch { /* fail closed */ }
    }
    items.push(<article key={s.id} className="space-y-2 rounded-lg border p-3"><h3 className="font-semibold">{s.station}</h3>
      {canAssign && a && (!s.assignedUserId || s.serviceAuthority?.revokedAt) ? <form action={assignServiceAction.bind(null, patientId, s.id, a.id, s.updatedAt.toISOString())} className="flex flex-wrap items-end gap-2"><label className="label">الممارس المؤهل<select className="input" name="workerId" required defaultValue=""><option value="" disabled>اختر ممارساً</option>{people.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></label>{s.assignedUserId ? <label className="label">سبب تسوية الإسناد<input className="input" name="reason" required /></label> : null}<button className="btn-primary">إسناد صريح للعمل</button></form> : null}
      {mine && !s.operationalCompletedAt ? <div className="flex flex-wrap gap-2">{s.status === "WAITING" ? <form action={executeServiceAction.bind(null, patientId, s.id, s.serviceAssignmentId!, false)}><button className="btn-ghost">بدء العمل المسند</button></form> : null}<form action={executeServiceAction.bind(null, patientId, s.id, s.serviceAssignmentId!, true)}><button className="btn-primary">توثيق إكمال عمل الخدمة</button></form></div> : null}
      {s.operationalCompletedAt ? <p>العمل مكتمل تشغيلياً؛ لا يعني ذلك اعتماداً طبياً.</p> : null}
    </article>);
  }
  return items.length ? <section className="card space-y-3 p-4" aria-label="عمل الخدمات المسند"><h2 className="text-lg font-semibold">عمل الخدمات المسند</h2>{items}</section> : null;
}
