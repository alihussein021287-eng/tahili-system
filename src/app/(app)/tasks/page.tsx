import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import Link from "next/link";
import { Fragment } from "react";
import { getSession, currentPerms, requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { ROLE_LABELS } from "@/lib/permissions";
import { fmtDate } from "@/lib/labels";
import { createTask, startTask, completeTask, reopenTask, deleteTask } from "./actions";

export const dynamic = "force-dynamic";

const PRIO: Record<string, { label: string; cls: string }> = {
  URGENT: { label: "عاجلة", cls: "bg-red-100 text-red-700" },
  HIGH: { label: "مهمة", cls: "bg-orange-100 text-orange-700" },
  NORMAL: { label: "عادية", cls: "bg-gray-100 text-gray-600" },
  LOW: { label: "منخفضة", cls: "bg-slate-100 text-slate-500" },
};
const STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "مفتوحة", cls: "bg-sky-50 text-sky-700" },
  IN_PROGRESS: { label: "قيد التنفيذ", cls: "bg-amber-50 text-amber-700" },
  DONE: { label: "منجزة", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "ملغاة", cls: "bg-gray-100 text-gray-500" },
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ saved?: string; scope?: string; status?: string; role?: string }> }) {
  await requirePerm("tasks.view");
  const sp = await searchParams;
  const session = await getSession();
  const uid = (session?.user as any)?.id;
  const role = (session?.user as any)?.role;
  const perms = await currentPerms();
  const canCreate = perms.has("tasks.create");
  const canComplete = perms.has("tasks.complete");
  const canDelete = perms.has("tasks.delete") && role === "ADMIN";
  const now = new Date();
  const scope = sp.scope || "mine";
  const statusFilter = sp.status || "open";
  const roleFilter = sp.role || "";

  const filteredWhere: any = {};
  if (scope === "mine") filteredWhere.OR = [{ assignedToId: uid }, { assignedRole: role }];
  if (scope === "created") filteredWhere.createdById = uid;
  if (scope === "role") filteredWhere.assignedRole = roleFilter || role;
  if (statusFilter === "open") filteredWhere.status = { in: ["OPEN", "IN_PROGRESS"] };
  if (statusFilter === "done") filteredWhere.status = "DONE";
  if (statusFilter === "overdue") {
    filteredWhere.status = { in: ["OPEN", "IN_PROGRESS"] };
    filteredWhere.dueDate = { lt: now };
  }

  const [users, patients, filteredTasks, mine, created, done] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    prisma.patient.findMany({ select: { id: true, fullName: true, fileNumber: true }, orderBy: { fullName: "asc" }, take: 500 }),
    prisma.task.findMany({
      where: filteredWhere,
      include: {
        patient: { select: { id: true, fullName: true, fileNumber: true } },
        assignedTo: { select: { fullName: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.task.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ assignedToId: uid }, { assignedRole: role }] },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedTo: { select: { fullName: true } }, createdBy: { select: { fullName: true } } },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
    }),
    prisma.task.findMany({
      where: { createdById: uid, status: { in: ["OPEN", "IN_PROGRESS"] } },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedTo: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.task.findMany({
      where: { status: "DONE", OR: [{ assignedToId: uid }, { createdById: uid }, { assignedRole: role }] },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedTo: { select: { fullName: true } } },
      orderBy: { completedAt: "desc" }, take: 20,
    }),
  ]);

  const Row = ({ t, who }: { t: any; who?: string }) => {
    const overdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "DONE";
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-50 px-4 py-3 last:border-0 hover:bg-gray-50 sm:flex-nowrap ${overdue ? "bg-red-50/30" : ""}`}>
        <div className="flex w-20 shrink-0 justify-start">
          <span className={`badge ${PRIO[t.priority]?.cls}`}>{PRIO[t.priority]?.label}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-gray-800">{t.title}</div>
            <span className={`badge ${STATUS[t.status]?.cls}`}>{STATUS[t.status]?.label}</span>
          </div>
          {t.description && <div className="truncate text-xs text-gray-500">{t.description}</div>}
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-400">
            {who && <span>{who}</span>}
            {t.patient && <Link href={`/patients/${t.patient.id}`} className="text-brand-700 hover:underline">👤 {t.patient.fullName}{t.patient.fileNumber ? ` #${t.patient.fileNumber}` : ""}</Link>}
            {t.dueDate && <span className={overdue ? "font-semibold text-red-600" : ""}>⏰ {fmtDate(t.dueDate)}{overdue ? " (متأخرة)" : ""}</span>}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
          {canComplete && t.status === "OPEN" && (
            <form action={startTask.bind(null, t.id)}><button className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">بدء</button></form>
          )}
          {canComplete && t.status !== "DONE" && (
            <form action={completeTask.bind(null, t.id)}><button className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">إنجاز ✓</button></form>
          )}
          {canComplete && t.status === "DONE" && (
            <form action={reopenTask.bind(null, t.id)}><button className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200">إعادة فتح</button></form>
          )}
          {canDelete && (
            <form action={deleteTask.bind(null, t.id)}><button className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50">حذف</button></form>
          )}
        </div>
      </div>
    );
  };

  const Section = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) => (
    <div className="card overflow-hidden">
      <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">
        {title} <span className="text-sm font-normal text-gray-400">({count})</span>
      </div>
      {children}
    </div>
  );
  const filterUrl = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.scope) p.set("scope", sp.scope);
    if (sp.status) p.set("status", sp.status);
    if (sp.role) p.set("role", sp.role);
    Object.entries(extra).forEach(([k, v]) => v ? p.set(k, v) : p.delete(k));
    const s = p.toString();
    return `/tasks${s ? `?${s}` : ""}`;
  };
  const scopeOptions = [
    { value: "mine", label: "مهامي" },
    { value: "created", label: "أنشأتها" },
    { value: "role", label: "حسب الدور" },
    { value: "all", label: "كل المهام" },
  ];
  const statusOptions = [
    { value: "open", label: "مفتوحة" },
    { value: "overdue", label: "متأخرة" },
    { value: "done", label: "مكتملة" },
    { value: "all", label: "كل الحالات" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="المهام والتحويلات" subtitle="تكليف ومتابعة المهام بين الموظفين" icon="📌" />

      {sp.saved && <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-800">{sp.saved}</div>}

      {canCreate && (
        <form action={createTask} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2"><label className="label">عنوان المهمة *</label><input name="title" className="input" required /></div>
          <div><label className="label">الأولوية</label>
<Combobox name="priority" allowFree={false} defaultValue="NORMAL" options={[{value:"URGENT",label:"عاجلة"},{value:"HIGH",label:"مهمة"},{value:"NORMAL",label:"عادية"},{value:"LOW",label:"منخفضة"}]} />
          </div>
          <div className="lg:col-span-3"><label className="label">التفاصيل</label><textarea name="description" className="input" rows={2} /></div>
          <div><label className="label">إسناد لموظف</label>
<Combobox name="assignedToId" allowFree={false} placeholder="لا أحد محدد" options={users.map((u:any)=>({value:String(u.id),label:u.fullName}))} />
          </div>
          <div><label className="label">أو إسناد لدور كامل</label>
<Combobox name="assignedRole" allowFree={false} placeholder="بدون" options={Object.entries(ROLE_LABELS).map(([value,label]:any)=>({value,label}))} />
          </div>
          <div><label className="label">ربط بمريض (اختياري)</label>
<Combobox name="patientId" allowFree={false} placeholder="بدون" options={patients.map((p:any)=>({value:String(p.id),label:`${p.fullName} — ${p.fileNumber}`}))} />
          </div>
          <div><label className="label">موعد الاستحقاق</label><input name="dueDate" type="date" className="input" /></div>
          <div className="flex items-end lg:col-span-3"><button className="btn-primary" type="submit">إضافة المهمة</button></div>
        </form>
      )}

      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap gap-2">
          {scopeOptions.map((item) => (
            <Link key={item.value} href={filterUrl({ scope: item.value })}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${scope === item.value ? "border-brand-400 bg-brand-50 text-brand-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
              {item.label}
            </Link>
          ))}
        </div>
        <form action="/tasks" className="grid gap-2 md:grid-cols-4">
          <input type="hidden" name="scope" value={scope} />
          <Combobox name="status" label="الحالة" allowFree={false} defaultValue={statusFilter} options={statusOptions} />
          <Combobox name="role" label="الدور" allowFree={false} defaultValue={roleFilter} placeholder="دوري الحالي"
            options={[{ value: "", label: "دوري الحالي" }, ...Object.entries(ROLE_LABELS).map(([value, label]: any) => ({ value, label }))]} />
          <div className="flex items-end gap-2 md:col-span-2">
            <button className="btn-primary" type="submit">تصفية</button>
            <Link href="/tasks" className="btn-ghost">مسح</Link>
          </div>
        </form>
      </div>

      <Section title="نتائج الفلتر" count={filteredTasks.length}>
        {filteredTasks.length === 0 ? <div className="px-5 py-6 text-center text-sm text-gray-400">لا توجد مهام مطابقة للفلاتر الحالية.</div>
          : filteredTasks.map((t: any) => <Row key={t.id} t={t} who={[
            t.assignedTo ? `إلى: ${t.assignedTo.fullName}` : (t.assignedRole ? `إلى دور: ${ROLE_LABELS[t.assignedRole as keyof typeof ROLE_LABELS]}` : "غير مُسندة"),
            t.createdBy ? `من: ${t.createdBy.fullName}` : "",
          ].filter(Boolean).join(" · ")} />)}
      </Section>

      <Section title="مهامي" count={mine.length}>
        {mine.length === 0 ? <div className="px-5 py-6 text-center text-sm text-gray-400">لا مهام مسندة لك حالياً 🎉</div>
          : mine.map((t: any) => <Row key={t.id} t={t} who={[
            t.assignedTo ? `إلى: ${t.assignedTo.fullName}` : (t.assignedRole ? `إلى دور: ${ROLE_LABELS[t.assignedRole as keyof typeof ROLE_LABELS]}` : ""),
            t.createdBy ? `من: ${t.createdBy.fullName}` : "",
          ].filter(Boolean).join(" · ")} />)}
      </Section>

      <Section title="مهام أنشأتها" count={created.length}>
        {created.length === 0 ? <div className="px-5 py-6 text-center text-sm text-gray-400">لم تُنشئ مهاماً مفتوحة.</div>
          : created.map((t: any) => <Row key={t.id} t={t} who={t.assignedTo ? `إلى: ${t.assignedTo.fullName}` : (t.assignedRole ? `إلى دور: ${ROLE_LABELS[t.assignedRole as keyof typeof ROLE_LABELS]}` : "غير مُسندة")} />)}
      </Section>

      {done.length > 0 && (
        <Section title="منجزة مؤخراً" count={done.length}>
          {done.map((t: any) => <Row key={t.id} t={t} who={t.assignedTo ? `${t.assignedTo.fullName}` : undefined} />)}
        </Section>
      )}
    </div>
  );
}
