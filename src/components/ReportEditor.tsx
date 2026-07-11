"use client";
import { useState } from "react";
import { GENDER, MARITAL, THERAPY, DIAGNOSIS, DIRECTION, PATIENT_STATUS, RX_STATUS, ADMISSION, PLAN_STATUS, fmtDate } from "@/lib/labels";
import { PrintButton } from "./PrintButton";

export function ReportEditor({ p, org, approval }: { p: any; org?: any; approval?: any }) {
  const completedSessions = (p.therapySessions || []).reduce((sum: number, s: any) => sum + (Number(s.actualSessions) || 0), 0);
  const plannedSessions = (p.therapySessions || []).reduce((sum: number, s: any) => sum + (Number(s.totalSessions) || 0), 0);
  const activeAdmission = (p.admissions || []).find((a: any) => a.status === "ADMITTED");
  const summary: [string, any][] = [
    ["رقم الملف", `#${p.fileNumber}`],
    ["الحالة", PATIENT_STATUS[p.status as keyof typeof PATIENT_STATUS] ?? p.status],
    ["آخر تشخيص", p.diagnoses?.[0]?.text],
    ["الجلسات", plannedSessions ? `${completedSessions} / ${plannedSessions}` : completedSessions],
    ["الوصفات", p.prescriptions?.length ?? 0],
    ["الرقود", activeAdmission ? `راقد منذ ${fmtDate(activeAdmission.admissionDate)}` : ((p.admissions?.length ?? 0) ? `${p.admissions.length} حالة` : "لا يوجد")],
  ];
  const kvPersonal: [string, any][] = [
    ["الاسم الرباعي", p.fullName], ["اسم الأم", p.motherName],
    ["الجنس", GENDER[p.gender as keyof typeof GENDER]], ["التولد", p.birthYear],
    ["الهاتف", p.phone], ["الحالة الزوجية", MARITAL[p.maritalStatus as keyof typeof MARITAL]],
    ["المحافظة", p.governorate?.name], ["المنطقة", p.district?.name],
    ["التحصيل", p.education], ["السكن", p.housing],
  ];
  const kvInjury: [string, any][] = [
    ["الصفة", p.rank], ["نسبة العجز", p.disabilityPct ? `${p.disabilityPct}%` : null],
    ["مدخل البيانات", p.dataEntryBy],
    ["نوع الإصابة", p.injuryType?.name], ["سبب الإصابة", p.injuryCause],
    ["الحركة", p.mobility], ["رقم الكتاب", p.referralBookNo],
    ["المركز المُحال له", p.referredToCenter],
  ];
  const tables: { id: string; title: string; rows: any[]; cols: [string, (r: any) => any][] }[] = [
    { id: "diagnoses", title: "التشخيصات", rows: p.diagnoses || [], cols: [["النوع", (r) => DIAGNOSIS[r.type as keyof typeof DIAGNOSIS]], ["التشخيص", (r) => r.text], ["الطبيب", (r) => r.doctor], ["التاريخ", (r) => fmtDate(r.date)]] },
    { id: "reports", title: "التقارير الطبية", rows: p.medicalReports || [], cols: [["التقرير", (r) => r.content], ["الطبيب", (r) => r.doctor], ["التاريخ", (r) => fmtDate(r.date)]] },
    { id: "sessions", title: "الجلسات العلاجية", rows: p.therapySessions || [], cols: [["المسار", (r) => THERAPY[r.therapyType as keyof typeof THERAPY]], ["المركز", (r) => r.center?.name], ["الخطة", (r) => r.treatmentPlan], ["المعالج", (r) => r.therapist], ["القاعة", (r) => r.hall], ["المنجز/المخطط", (r) => `${r.actualSessions ?? 0} / ${r.totalSessions ?? "—"}`]] },
    { id: "plans", title: "الخطة العلاجية", rows: p.treatmentPlans || [], cols: [["العنوان", (r) => r.title], ["الهدف", (r) => r.goals], ["المخطط", (r) => r.plannedSessions], ["الحالة", (r) => PLAN_STATUS[r.status as keyof typeof PLAN_STATUS]], ["ملاحظات", (r) => r.notes]] },
    { id: "prescriptions", title: "الوصفات والتجهيز", rows: p.prescriptions || [], cols: [["المادة", (r) => r.medication?.name ?? r.materialName], ["الكمية", (r) => r.quantity], ["المصروف", (r) => r.dispensedQty], ["الحالة", (r) => RX_STATUS[r.status as keyof typeof RX_STATUS]], ["المدة", (r) => r.duration]] },
    { id: "admissions", title: "الرقود", rows: p.admissions || [], cols: [["الدخول", (r) => fmtDate(r.admissionDate)], ["الخروج", (r) => fmtDate(r.dischargeDate)], ["المركز", (r) => r.center?.name], ["الحالة", (r) => ADMISSION[r.status as keyof typeof ADMISSION]], ["ملاحظات", (r) => r.notes]] },
    { id: "wounds", title: "تقييم الجروح", rows: p.woundAssessments || [], cols: [["النوع", (r) => r.woundType], ["الإفرازات", (r) => r.exudate], ["الخطة التالية", (r) => r.nextPlan], ["التاريخ", (r) => fmtDate(r.assessmentDate)]] },
    { id: "correspondence", title: "المخاطبات", rows: p.correspondence || [], cols: [["النوع", (r) => DIRECTION[r.direction as keyof typeof DIRECTION]], ["رقم الكتاب", (r) => r.bookNo], ["الموضوع", (r) => r.subject], ["التاريخ", (r) => fmtDate(r.bookDate)]] },
    { id: "relatives", title: "ذوو القربى", rows: p.relatives || [], cols: [["الاسم", (r) => r.name], ["الوظيفة", (r) => r.job], ["الحالة الاجتماعية", (r) => r.socialStatus]] },
  ];
  const allSections = [{ id: "personal", title: "البيانات الشخصية" }, { id: "injury", title: "الإصابة والإحالة" }, ...tables.map((t) => ({ id: t.id, title: t.title }))];

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(allSections.map((s) => [s.id, true])));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const toggle = (id: string) => setEnabled((e) => ({ ...e, [id]: !e[id] }));
  const excludeRow = (id: string) => setExcluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 space-y-3 rounded-lg border bg-gray-50 p-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-gray-700">تخصيص التقرير قبل الطباعة</span>
          <PrintButton />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {allSections.map((sec) => (
            <label key={sec.id} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={enabled[sec.id]} onChange={() => toggle(sec.id)} /> {sec.title}
            </label>
          ))}
        </div>
        <div>
          <label className="label">ملاحظات إضافية (تظهر بالتقرير)</label>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اكتب أي ملاحظة تريد إضافتها للتقرير..." />
        </div>
        <p className="text-xs text-gray-500">لإخفاء سطر من جدول اضغط ✕ بجانبه. الأقسام غير المؤشّرة لا تُطبع.</p>
      </div>

      <div className="card p-8" id="report">
        <div className="print-header mb-6 border-b-2 border-brand-700 pb-4 text-center">
          <h1 className="text-2xl font-extrabold text-brand-800">{org?.officialHeader4 || org?.name || "المجمع التأهيلي الطبي"}</h1>
          {(org?.officialHeader1 || org?.officialHeader2 || org?.officialHeader3) && <p className="text-sm text-gray-600">{[org?.officialHeader1, org?.officialHeader2, org?.officialHeader3].filter(Boolean).join(" - ")}</p>}
          {org?.subtitle && <p className="text-sm text-gray-600">{org.subtitle}</p>}
          {(org?.officialAddress || org?.address || org?.officialPhone || org?.phone) && <p className="text-xs text-gray-500">{[org?.officialAddress || org?.address, org?.officialPhone || org?.phone].filter(Boolean).join(" — ")}</p>}
          <p className="mt-2 inline-block rounded bg-brand-50 px-3 py-0.5 text-sm font-medium text-brand-700">تقرير المراجع — ملف #{p.fileNumber}</p>
        </div>

        <Kv title="ملخص التقرير" items={summary} />
        {enabled.personal && <Kv title="البيانات الشخصية" items={kvPersonal} />}
        {enabled.injury && <Kv title="الإصابة والإحالة" items={kvInjury} />}
        {tables.map((t) => enabled[t.id] ? (
          <Tbl key={t.id} title={t.title} rows={t.rows.filter((r) => !excluded.has(r.id))} cols={t.cols} onExclude={excludeRow} />
        ) : null)}

        {notes.trim() && (
          <div className="mb-5">
            <h2 className="mb-2 font-bold text-brand-700">ملاحظات إضافية</h2>
            <p className="whitespace-pre-wrap text-sm">{notes}</p>
          </div>
        )}

        <div className="mt-4 text-sm text-gray-500">تاريخ الطباعة: {fmtDate(new Date())}</div>
        <div className="print-sign mt-10 flex justify-between gap-10 text-center text-sm text-gray-600">
          <div className="flex-1 border-t border-gray-400 pt-2">توقيع الطبيب المعالج</div>
          {approval ? (
            <div className="flex-1">
              <div className="font-semibold text-gray-800">{approval.approvedBy}</div>
              {approval.title && <div className="text-xs text-gray-500">{approval.title}</div>}
              <div className="mt-1 inline-block rounded border-2 border-emerald-600 px-3 py-1 text-xs font-bold text-emerald-700">معتمد إلكترونياً ✔ — {fmtDate(approval.approvedAt)}</div>
            </div>
          ) : (
            <div className="flex-1 border-t border-gray-400 pt-2">ختم وتوقيع المدير</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kv({ title, items }: { title: string; items: [string, any][] }) {
  return (
    <div className="mb-5">
      <h2 className="mb-2 font-bold text-brand-700">{title}</h2>
      <div className="grid grid-cols-2 gap-x-8">
        {items.map(([k, v], i) => (
          <div key={i} className="flex gap-2 py-1 text-sm"><span className="w-32 text-gray-500">{k}:</span><span className="font-medium">{v || "—"}</span></div>
        ))}
      </div>
    </div>
  );
}

function Tbl({ title, rows, cols, onExclude }: any) {
  if (!rows?.length) return null;
  return (
    <div className="mb-5">
      <h2 className="mb-2 font-bold text-brand-700">{title}</h2>
      <table className="w-full border border-gray-300 text-sm">
        <thead><tr className="bg-gray-50">{cols.map(([h]: any) => <th key={h} className="border border-gray-300 px-2 py-1 text-right">{h}</th>)}<th className="no-print border border-gray-300 px-2 py-1"></th></tr></thead>
        <tbody>{rows.map((r: any) => (
          <tr key={r.id}>
            {cols.map(([h, fn]: any, i: number) => <td key={i} className="border border-gray-300 px-2 py-1">{fn(r) || "—"}</td>)}
            <td className="no-print border border-gray-300 px-2 py-1 text-center"><button onClick={() => onExclude(r.id)} className="btn-icon-danger" title="إخفاء من التقرير">✕</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
