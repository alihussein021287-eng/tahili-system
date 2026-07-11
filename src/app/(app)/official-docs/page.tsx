import { currentPerms, requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { DOC_DIRECTION, DOC_TYPE, fmtDate } from "@/lib/labels";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { addOfficialDocument } from "./actions";

export const dynamic = "force-dynamic";

function dateInput(d?: Date | string | null) {
  if (!d) return "";
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function docWhere(sp: { q?: string; number?: string; subject?: string; entity?: string; patient?: string; date?: string; type?: string; direction?: string }) {
  const and: any[] = [];
  const q = (sp.q ?? "").trim();
  if (q) {
    and.push({ OR: [
      { number: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { entity: { contains: q, mode: "insensitive" } },
      { body: { contains: q, mode: "insensitive" } },
      { patient: { fullName: { contains: q, mode: "insensitive" } } },
    ] });
  }
  if (sp.number) and.push({ number: { contains: sp.number.trim(), mode: "insensitive" } });
  if (sp.subject) and.push({ subject: { contains: sp.subject.trim(), mode: "insensitive" } });
  if (sp.entity) and.push({ entity: { contains: sp.entity.trim(), mode: "insensitive" } });
  if (sp.patient) and.push({ patient: { fullName: { contains: sp.patient.trim(), mode: "insensitive" } } });
  if (sp.type) and.push({ docType: sp.type });
  if (sp.direction) and.push({ direction: sp.direction });
  if (sp.date) {
    const start = new Date(sp.date);
    const end = new Date(start.getTime() + 86400000);
    and.push({ docDate: { gte: start, lt: end } });
  }
  return and.length ? { AND: and } : {};
}

export default async function OfficialDocsPage({ searchParams }: { searchParams: Promise<{ q?: string; number?: string; subject?: string; entity?: string; patient?: string; date?: string; type?: string; direction?: string; msg?: string; err?: string }> }) {
  await requirePerm("officialdocs.view");
  const perms = await currentPerms();
  const canManage = perms.has("officialdocs.manage");
  const sp = await searchParams;
  const where = docWhere(sp);

  const [docs, patients] = await Promise.all([
    prisma.officialDocument.findMany({
      where,
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } } },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    canManage ? prisma.patient.findMany({ where: { archivedAt: null }, select: { id: true, fullName: true, fileNumber: true }, orderBy: { fullName: "asc" }, take: 500 }) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="أرشيف الوثائق الرسمية" subtitle="بحث وأرشفة الكتب والقرارات والإحالات" icon="📄" />
      {sp.msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{sp.msg}</div>}
      {sp.err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{sp.err}</div>}

      <form action="/official-docs" className="card grid gap-3 p-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="label">بحث عام</label>
          <input name="q" className="input" defaultValue={sp.q ?? ""} placeholder="رقم كتاب، موضوع، جهة، اسم مراجع..." autoFocus />
        </div>
        <div><label className="label">رقم الكتاب</label><input name="number" className="input" defaultValue={sp.number ?? ""} /></div>
        <div><label className="label">التاريخ</label><input name="date" type="date" className="input" defaultValue={sp.date ?? ""} /></div>
        <div><label className="label">الموضوع</label><input name="subject" className="input" defaultValue={sp.subject ?? ""} /></div>
        <div><label className="label">الجهة</label><input name="entity" className="input" defaultValue={sp.entity ?? ""} /></div>
        <div><label className="label">اسم المراجع</label><input name="patient" className="input" defaultValue={sp.patient ?? ""} /></div>
        <Combobox name="type" label="النوع" allowFree={false} defaultValue={sp.type ?? ""} placeholder="الكل" options={[{ value: "", label: "الكل" }, ...Object.entries(DOC_TYPE).map(([value, label]: any) => ({ value, label }))]} />
        <Combobox name="direction" label="الاتجاه" allowFree={false} defaultValue={sp.direction ?? ""} placeholder="الكل" options={[{ value: "", label: "الكل" }, ...Object.entries(DOC_DIRECTION).map(([value, label]: any) => ({ value, label }))]} />
        <div className="flex items-end gap-2 md:col-span-2">
          <button className="btn-primary" type="submit">بحث</button>
          <Link href="/official-docs" className="btn-ghost">مسح</Link>
        </div>
      </form>

      {canManage && (
        <form action={addOfficialDocument} className="card grid gap-3 p-4 md:grid-cols-4">
          <div className="md:col-span-4 font-semibold text-gray-700">إضافة وثيقة رسمية</div>
          <div><label className="label">رقم الكتاب *</label><input name="number" className="input" required /></div>
          <div><label className="label">التاريخ *</label><input name="docDate" type="date" className="input" defaultValue={dateInput(new Date())} required /></div>
          <Combobox name="docType" label="النوع" allowFree={false} defaultValue="LETTER" options={Object.entries(DOC_TYPE).map(([value, label]: any) => ({ value, label }))} />
          <Combobox name="direction" label="الاتجاه" allowFree={false} defaultValue="INCOMING" options={Object.entries(DOC_DIRECTION).map(([value, label]: any) => ({ value, label }))} />
          <div className="md:col-span-2"><label className="label">الموضوع *</label><input name="subject" className="input" required /></div>
          <div><label className="label">الجهة</label><input name="entity" className="input" placeholder="وارد من / صادر إلى" /></div>
          <Combobox name="patientId" label="المراجع المرتبط" allowFree={false} placeholder="وثيقة عامة" options={[{ value: "", label: "وثيقة عامة" }, ...patients.map((p: any) => ({ value: String(p.id), label: `${p.fullName} (#${p.fileNumber})` }))]} />
          <div className="md:col-span-3"><label className="label">ملاحظات</label><textarea name="body" className="input" rows={2} /></div>
          <div><label className="label">المرفق</label><input name="attachment" type="file" className="input" /></div>
          <div className="md:col-span-4"><button className="btn-primary" type="submit">أرشفة الوثيقة</button></div>
        </form>
      )}

      <div className="grid gap-3">
        {docs.length === 0 && <div className="card p-6 text-center text-sm text-gray-400">لا توجد وثائق مطابقة.</div>}
        {docs.map((d: any) => (
          <div key={d.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge-brand">{DOC_TYPE[d.docType as keyof typeof DOC_TYPE]}</span>
                  <span className={`badge ${d.direction === "OUTGOING" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>{DOC_DIRECTION[d.direction as keyof typeof DOC_DIRECTION]}</span>
                  <Link href={`/official-docs/${d.id}`} className="font-semibold text-brand-700 hover:underline">{d.subject}</Link>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>العدد: {d.number}</span>
                  <span>التاريخ: {fmtDate(d.docDate)}</span>
                  <span>الجهة: {d.entity || "—"}</span>
                  {d.patient ? <Link href={`/patients/${d.patient.id}`} className="text-brand-700 hover:underline">المراجع: {d.patient.fullName} #{d.patient.fileNumber}</Link> : <span>وثيقة عامة</span>}
                </div>
                {d.body && <div className="mt-2 max-h-12 overflow-hidden text-sm text-gray-600">{d.body}</div>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link href={`/official-docs/${d.id}`} className="btn-ghost btn-sm">عرض/طباعة</Link>
                {d.attachmentUrl && <a href={d.attachmentUrl} target="_blank" className="btn-ghost btn-sm">المرفق</a>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
