import { prisma } from "@/lib/db";
import { requireSession, currentPerms } from "@/lib/access";
import { CENTER_STATIONS } from "@/lib/stations";
import { designateServiceAction, revokeServiceAction } from "@/app/(app)/scope-closure-actions";
export async function ServiceResponsibilityAdmin() {
  const u = (await requireSession()).user as { role: string };
  const perms = await currentPerms(); if (u.role !== "ADMIN" || !perms.has("services.designate")) return null;
  const [branches, people, rows] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { isActive: true, needsActivation: false, role: { in: CENTER_STATIONS.map(s => s.role) } }, select: { id: true, fullName: true, role: true, branch: { select: { name: true } } } }),
    prisma.serviceResponsibility.findMany({ where: { revokedAt: null }, include: { branch: { select: { name: true } }, responsible: { select: { fullName: true } } }, orderBy: { designatedAt: "desc" }, take: 100 }),
  ]);
  return <section className="card space-y-3 p-4" aria-label="مسؤولو الخدمات"><h2 className="font-semibold">تعيين مسؤولي الخدمات</h2>
    <p className="text-sm">امنح services.assign للمسؤول وservices.execute للممارس من إدارة الصلاحيات عند التفويض. التعيين لا يمنح التنفيذ أو الاعتماد الطبي. يجب أن يطابق دور المسؤول دور الخدمة وفرعها.</p>
    <form action={designateServiceAction} className="grid gap-3 md:grid-cols-3"><label className="label">الخدمة<select className="input" name="serviceKey" required>{CENTER_STATIONS.map(s => <option key={s.key} value={s.key}>{s.name} — {s.role}</option>)}</select></label><label className="label">الفرع<select className="input" name="branchId" required>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className="label">المسؤول<select className="input" name="responsibleId" required>{people.map(p => <option key={p.id} value={p.id}>{p.fullName} — {p.role} — {p.branch?.name ?? "بلا فرع"}</option>)}</select></label><div><button className="btn-primary">تعيين المسؤول صراحة</button></div></form>
    {rows.map(r => <article key={r.id} className="rounded-lg border p-3"><p>{CENTER_STATIONS.find(s => s.key === r.serviceKey)?.name} — {r.branch.name} — {r.responsible.fullName}</p><form action={revokeServiceAction.bind(null, r.id)} className="flex flex-wrap items-end gap-2"><label className="label">سبب سحب المسؤولية<input className="input" name="reason" required /></label><button className="btn-ghost">سحب التفويض</button></form></article>)}
  </section>;
}
