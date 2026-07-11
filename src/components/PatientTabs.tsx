"use client";
import React from "react";
import { useState } from "react";
import {
  addDiagnosis, addReport, addSession, addPrescription, addAdmission,
  dischargeAdmission, updateAdmissionDuration, addCorrespondence, addRelative, addWound, addAttachment,
  deleteDiagnosis, deleteReport, deleteSession, deletePrescription, deleteCorrespondence,
  deleteRelative, deleteAdmission, deleteWound, deleteAttachment,
  addProgressMetric, deleteProgressMetric,
  addVitalSign, deleteVitalSign,
  addResidentReview, deleteResidentReview,
  scheduleSessions, addTherapyHall, setTherapyHallActive,
  addTreatmentPlan, setTreatmentPlanStatus, deleteTreatmentPlan, addTherapySessionLog,
  addCareRecord, deleteCareRecord,
  startPathway, addStage, confirmStage, setStageStatus, deleteStage,
  addOfficialDoc, deleteOfficialDoc,
  updateDiagnosis, updateSessionRecord, updateCorrespondence, updateOfficialDocText,
  addSickLeave, deleteSickLeave, approveSickLeave, unapproveSickLeave,
  approveSickLeaveCommittee, unapproveSickLeaveCommittee, setNextCheckup, referToCenter,
  getPatientTabData,
} from "@/app/(app)/patients/actions";
import { THERAPY, DIAGNOSIS, DIRECTION, APPT_STATUS, PLAN_STATUS, CARE_PERIOD, CARE_KIND, fmtDate, fmtDateTime, DOC_TYPE, DOC_DIRECTION } from "@/lib/labels";
import { ROLE_LABELS } from "@/lib/permissions";
import { CENTER_STATION_NAMES } from "@/lib/stations";
import { TrendChart } from "@/components/TrendChart";
import { CareSection } from "@/components/CareSection";
import { Combobox } from "@/components/Combobox";
import { Zoom } from "@/components/Zoom";

const TABS = [
  { key: "timeline", label: "الخط الزمني", icon: "🕒", group: "overview" },
  { key: "journey", label: "مسار المتابعة", icon: "🧭", group: "overview" },
  { key: "diag", label: "التشخيصات", icon: "🩺", group: "medical" },
  { key: "reports", label: "التقارير الطبية", icon: "📋", group: "medical" },
  { key: "resident", label: "الطبيب المقيم", icon: "🩺", group: "medical" },
  { key: "vitals", label: "العلامات الحيوية", icon: "❤️", group: "medical" },
  { key: "wounds", label: "تقييم الجروح", icon: "🩹", group: "medical" },
  { key: "sessions", label: "الجلسات العلاجية", icon: "🏃", group: "therapy" },
  { key: "plan", label: "الخطة العلاجية", icon: "🎯", group: "therapy" },
  { key: "metrics", label: "المقاييس", icon: "📈", group: "therapy" },
  { key: "care", label: "التداوي والتضميد", icon: "🩼", group: "therapy" },
  { key: "rx", label: "الوصفات والتجهيز", icon: "💊", group: "admin" },
  { key: "adm", label: "الرقود", icon: "🛏", group: "admin" },
  { key: "official", label: "الإجراءات الرسمية", icon: "📄", group: "admin" },
  { key: "sickleave", label: "الإجازات المرضية", icon: "🩺", group: "admin" },
  { key: "corr", label: "المخاطبات", icon: "✉", group: "admin" },
  { key: "files", label: "المرفقات", icon: "📎", group: "admin" },
  { key: "rel", label: "ذوو القربى", icon: "👪", group: "admin" },
  { key: "activity", label: "النشاط", icon: "📌", group: "system" },
];
const TAB_GROUPS: Record<string, string> = {
  overview: "نظرة عامة",
  medical: "الملف الطبي",
  therapy: "المسار العلاجي",
  admin: "الملف الإداري",
  system: "النشاط",
};
const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// التبويبات التي تُحمّل بياناتها عند فتحها فقط (لتخفيف تحميل الصفحة)
const LAZY_TABS = ["files", "metrics", "vitals", "plan", "rel", "activity", "care", "resident"];

export function PatientTabs({ patient, editable, perms = [], role = "", slApprovals = [], centers = [], medications = [], rooms = [], halls = [], staffNames = [], staffUsers = [] }: { patient: any; editable: boolean; perms?: string[]; role?: string; slApprovals?: any[]; centers?: any[]; medications?: any[]; rooms?: any[]; halls?: any[]; staffNames?: string[]; staffUsers?: any[] }) {
  const can = (k: string) => perms.includes(k);
  const canDel = role === "ADMIN";
  const canSchedule = role === "HEAD_THERAPIST" || role === "ADMIN";
  const [tab, setTab] = useState("timeline");
  const [lazy, setLazy] = useState<Record<string, any[] | undefined>>({});
  const id = patient.id;

  const loadTab = async (key: string) => {
    try {
      const data = await getPatientTabData(id, key);
      setLazy((p) => ({ ...p, [key]: (data as any[]) ?? [] }));
    } catch {
      setLazy((p) => ({ ...p, [key]: [] }));
    }
  };
  const openTab = (key: string) => {
    setTab(key);
    if (LAZY_TABS.includes(key) && lazy[key] === undefined) loadTab(key);
  };
  // تُستدعى بعد أي إضافة/حذف داخل تبويب مؤجّل لإعادة جلب بياناته
  const reload = (key: string) => () => loadTab(key);

  return (
    <div className="card flex flex-col md:flex-row">
      <div className="flex gap-1.5 overflow-x-auto border-b border-gray-200 p-3 md:w-56 md:shrink-0 md:flex-col md:gap-1 md:overflow-visible md:border-b-0 md:border-l">
        {TABS.map((t, idx) => (
          <React.Fragment key={t.key}>
            {(idx === 0 || TABS[idx - 1].group !== t.group) && (
              <div className="mt-2 px-2 text-[11px] font-semibold text-gray-400 first:mt-0">{TAB_GROUPS[t.group]}</div>
            )}
            <button onClick={() => openTab(t.key)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition md:w-full
                ${tab === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200 md:bg-transparent md:hover:bg-gray-100"}`}>
              <span className="text-base leading-none">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          </React.Fragment>
        ))}
      </div>
      <div className="flex-1 p-5">
        {tab === "timeline" && <Timeline patient={patient} />}
        {tab === "journey" && <Journey patient={patient} can={can} id={id} role={role} />}
        {tab === "official" && <OfficialDocs patient={patient} can={can} id={id} role={role} />}
        {tab === "sickleave" && <SickLeaves patient={patient} can={can} id={id} role={role} approvals={slApprovals} staff={staffNames} staffUsers={staffUsers} />}
        {tab === "diag" && (
          <div className="space-y-4">
          {can("clinical.diagnosis") && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
              <span className="text-sm font-medium text-gray-700">إجراءات الطبيب الاختصاصي:</span>
              <button type="button" onClick={() => setTab("rx")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">💊 وصفة طبية</button>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">↪ إحالة إلى المركز المختص</summary>
                <form action={referToCenter.bind(null, id)} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-white p-2">
                  <div className="min-w-[200px]"><Combobox name="station" label="المركز/الجهة" allowFree options={["مركز العلاج الطبيعي", "مركز التأهيل النفسي", "مركز العلاج الوظيفي", "مركز النقاء", "الأطراف الصناعية"]} placeholder="مثال: مركز العلاج الطبيعي" /></div>
                  <input name="note" className="input !py-1 text-sm" placeholder="ملاحظة (اختياري)" />
                  <button className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700" type="submit">إرسال الإحالة لرئيس المعالجين</button>
                </form>
              </details>
              <span className="text-xs text-gray-400">تُرسل إشعاراً لرئيس المعالجين وتُضاف لمسار المتابعة</span>
            </div>
          )}
          <Section rows={patient.diagnoses} editable={can("clinical.diagnosis")} canDel={canDel} del={deleteDiagnosis.bind(null, id)} action={addDiagnosis.bind(null, id)}
            edit={(rid: string, fd: FormData) => updateDiagnosis(id, rid, fd)}
            editFields={(r: any) => <>
              <Combobox name="type" allowFree={false} defaultValue={r.type} options={[{value:"PRELIMINARY",label:"أولي"},{value:"SPECIALIST",label:"اختصاص"},{value:"GENERAL",label:"عام"}]} />
              <input name="text" className="input min-w-[220px]" defaultValue={r.text ?? ""} />
              <input name="doctor" className="input" defaultValue={r.doctor ?? ""} />
            </>}
            cols={[["النوع", (r: any) => DIAGNOSIS[r.type as keyof typeof DIAGNOSIS]], ["التشخيص", (r: any) => r.text], ["الطبيب", (r: any) => r.doctor], ["التاريخ", (r: any) => fmtDate(r.date)]]}
            fields={<>
              <Combobox name="type" allowFree={false} options={[{value:"PRELIMINARY",label:"أولي"},{value:"SPECIALIST",label:"اختصاص"},{value:"GENERAL",label:"عام"}]} />
              <input name="text" className="input" placeholder="نص التشخيص" />
              <input name="doctor" className="input" placeholder="الطبيب" />
            </>} />
          </div>
        )}
        {tab === "reports" && (
          <Section rows={patient.medicalReports} editable={can("clinical.report")} canDel={canDel} del={deleteReport.bind(null, id)} action={addReport.bind(null, id)}
            cols={[["التقرير", (r: any) => r.content], ["الطبيب", (r: any) => r.doctor], ["التاريخ", (r: any) => fmtDate(r.date)]]}
            fields={<>
              <input name="content" className="input min-w-[280px]" placeholder="نص التقرير الطبي" />
              <input name="doctor" className="input" placeholder="الطبيب" />
            </>} />
        )}
        {tab === "sessions" && canSchedule && (
          <SchedulePlanner patientId={id} centers={centers} halls={halls} />
        )}
        {tab === "sessions" && (
          <div className="space-y-4">
          <Section rows={patient.therapySessions} editable={can("clinical.session")} canDel={canDel} del={deleteSession.bind(null, id)} action={addSession.bind(null, id)}
            edit={(rid: string, fd: FormData) => updateSessionRecord(id, rid, fd)}
            editFields={(r: any) => <>
              <input name="treatmentPlan" className="input min-w-[200px]" defaultValue={r.treatmentPlan ?? ""} placeholder="الخطة العلاجية" />
              <input name="totalSessions" type="number" className="input w-24" defaultValue={r.totalSessions ?? ""} placeholder="الكلي" />
              <input name="actualSessions" type="number" className="input w-24" defaultValue={r.actualSessions ?? ""} placeholder="المنجز" />
              <input name="therapist" className="input" defaultValue={r.therapist ?? ""} placeholder="المعالج" />
              <input name="hall" className="input" defaultValue={r.hall ?? ""} placeholder="القاعة" />
              <input name="notes" className="input min-w-[180px]" defaultValue={r.notes ?? ""} placeholder="ملاحظات المعالج" />
            </>}
            cols={[
              ["المسار", (r: any) => THERAPY[r.therapyType as keyof typeof THERAPY]],
              ["الخطة/الهدف", (r: any) => <div><div>{r.treatmentPlan || "—"}</div>{r.notes && <div className="mt-0.5 text-xs text-gray-400">{r.notes}</div>}</div>],
              ["المعالج", (r: any) => r.therapist],
              ["القاعة", (r: any) => r.hall],
              ["الأيام", (r: any) => formatWeekdays(r.weekdays)],
              ["التوقيت", (r: any) => r.sessionTime || "—"],
              ["الفترة", (r: any) => `${fmtDate(r.startDate)} ← ${fmtDate(r.endDate)}`],
              ["المنجز/المخطط", (r: any) => sessionProgressCell(r, patient.appointments || [])],
            ]}
            fields={<>
              <Combobox name="therapyType" allowFree={false} options={Object.entries(THERAPY).map(([value,label]:any)=>({value,label}))} />
              <Combobox name="centerId" allowFree={false} placeholder="المركز" options={centers.map((c:any)=>({value:String(c.id),label:c.name}))} />
              <input name="treatmentPlan" className="input" placeholder="الخطة العلاجية" />
              <input name="totalSessions" type="number" className="input w-28" placeholder="عدد الجلسات" />
              <input name="therapist" className="input" placeholder="المعالج" />
            </>} />
            <TherapySessionLogs patient={patient} editable={can("clinical.session")} patientId={id} />
          </div>
        )}
        {tab === "rx" && (
          <Section rows={patient.prescriptions} editable={can("clinical.prescription")} canDel={canDel} del={deletePrescription.bind(null, id)} action={addPrescription.bind(null, id)}
            cols={[["المادة/العلاج", (r: any) => r.medication?.name ?? r.materialName], ["الاستخدام", (r: any) => r.usage], ["الكمية", (r: any) => r.quantity], ["المدة", (r: any) => r.duration], ["التاريخ", (r: any) => fmtDate(r.prescribedAt)], ["التجهيز", (r: any) => rxStatusBadge(r)]]}
            fields={<>
              {(() => {
                const low = medications.filter((m: any) => (m.quantity ?? 0) <= (m.minQuantity ?? 0));
                if (!low.length) return null;
                return (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <span>⚠ {low.length} مادة منخفضة/نافذة بالمخزون</span>
                    <a href="/inventory" className="shrink-0 rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-700">راجع المخزون ←</a>
                  </div>
                );
              })()}
              <Combobox name="medicationId" allowFree={false} placeholder="من القائمة" options={medications.map((m:any)=>({value:String(m.id),label:`${m.name} — متبقّي: ${m.quantity ?? 0}${(m.quantity ?? 0)<=(m.minQuantity ?? 0)?" ⚠ منخفض":""}`}))} />
              <input name="materialName" className="input" placeholder="أو اكتب المادة" />
              <input name="usage" className="input" placeholder="الاستخدام" />
              <input name="quantity" className="input w-24" placeholder="الكمية" />
              <input name="duration" className="input w-24" placeholder="المدة" />
              <input name="doctor" className="input" placeholder="الطبيب" />
            </>} />
        )}
        {tab === "adm" && (
          <SectionAdm rows={patient.admissions} editable={can("clinical.admission")} patientId={id} centers={centers} rooms={rooms} role={role} />
        )}
        {tab === "wounds" && (
          <SectionWound rows={patient.woundAssessments} editable={can("clinical.wound")} patientId={id} role={role} />
        )}
        {tab === "corr" && (
          <Section rows={patient.correspondence} editable={can("clinical.report")} canDel={canDel} del={deleteCorrespondence.bind(null, id)} action={addCorrespondence.bind(null, id)}
            edit={(rid: string, fd: FormData) => updateCorrespondence(id, rid, fd)}
            editFields={(r: any) => <>
              <input name="subject" className="input min-w-[220px]" defaultValue={r.subject ?? ""} placeholder="الموضوع" />
              <input name="body" className="input min-w-[220px]" defaultValue={r.body ?? ""} placeholder="النص" />
            </>}
            cols={[["النوع", (r: any) => DIRECTION[r.direction as keyof typeof DIRECTION]], ["رقم الكتاب", (r: any) => r.bookNo], ["الموضوع", (r: any) => r.subject], ["التاريخ", (r: any) => fmtDate(r.bookDate)]]}
            fields={<>
              <Combobox name="direction" allowFree={false} options={[{value:"INCOMING",label:"وارد"},{value:"OUTGOING",label:"صادر"}]} />
              <input name="bookNo" className="input w-28" placeholder="رقم الكتاب" />
              <input name="subject" className="input" placeholder="الموضوع" />
              <input name="body" className="input min-w-[220px]" placeholder="النص" />
              <input name="bookDate" type="date" className="input" />
            </>} />
        )}
        {tab === "files" && (
          lazy.files === undefined ? <TabLoading /> :
          <SectionFiles rows={lazy.files} officialDocs={can("officialdocs.view") ? (patient.officialDocuments ?? []) : []} editable={can("clinical.report")} patientId={id} afterMutate={reload("files")} />
        )}
        {tab === "metrics" && (
          lazy.metrics === undefined ? <TabLoading /> :
          <SectionMetrics rows={lazy.metrics} editable={can("clinical.metrics")} patientId={id} afterMutate={reload("metrics")} />
        )}
        {tab === "plan" && (
          lazy.plan === undefined ? <TabLoading /> :
          <SectionPlan rows={lazy.plan} sessionsCount={completedTherapySessions(patient)} plannedCount={plannedTherapySessions(patient)} editable={can("clinical.plan")} patientId={id} afterMutate={reload("plan")} />
        )}
        {tab === "resident" && (lazy.resident === undefined ? <TabLoading /> : <SectionResidentReview rows={lazy.resident} editable={can("clinical.metrics")} patientId={id} afterMutate={reload("resident")} />)}
        {tab === "vitals" && (lazy.vitals === undefined ? <TabLoading /> : <SectionVitals rows={lazy.vitals} editable={can("clinical.metrics")} patientId={id} afterMutate={reload("vitals")} />)}
        {tab === "activity" && (lazy.activity === undefined ? <TabLoading /> : <ActivityLog logs={lazy.activity} />)}
        {tab === "care" && (lazy.care === undefined ? <TabLoading /> : <CareSection rows={lazy.care} editable={can("clinical.care")} patientId={id} medications={medications} afterMutate={reload("care")} />)}
        {tab === "rel" && (
          lazy.rel === undefined ? <TabLoading /> :
          <Section rows={lazy.rel} editable={can("patients.edit")}
            del={(async (...a: any[]) => { await (deleteRelative as any)(id, ...a); reload("rel")(); })}
            action={(async (fd: FormData) => { await addRelative(id, fd); reload("rel")(); })}
            cols={[["الاسم", (r: any) => r.name], ["الوظيفة", (r: any) => r.job], ["مكان العمل", (r: any) => r.workplace], ["الحالة الاجتماعية", (r: any) => r.socialStatus]]}
            fields={<>
              <input name="name" className="input" placeholder="اسم القريب/الجريح/الشهيد" />
              <input name="job" className="input" placeholder="الوظيفة" />
              <input name="workplace" className="input" placeholder="مكان العمل" />
              <input name="socialStatus" className="input" placeholder="الحالة الاجتماعية" />
            </>} />
        )}
      </div>
    </div>
  );
}

function rxStatusBadge(r: any) {
  const map: Record<string, [string, string]> = {
    PENDING: ["بانتظار", "bg-gray-100 text-gray-600"],
    DISPENSED: ["جُهّزت", "bg-green-50 text-green-700"],
    PARTIAL: ["جزئية", "bg-amber-50 text-amber-700"],
    REJECTED: ["مرفوضة", "bg-red-50 text-red-700"],
  };
  const s = r.status || (r.isDispensed ? "DISPENSED" : "PENDING");
  const [label, cls] = map[s] ?? map.PENDING;
  return <span className={`badge ${cls}`}>{label}</span>;
}

function TabLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" />
      جارٍ التحميل…
    </div>
  );
}

function Section({ rows, cols, editable, action, fields, del, canDel, edit, editFields }: any) {
  const extra = (editable && (edit || (canDel && del))) ? 1 : 0;
  return (
    <div className="space-y-4">
      {editable && (
        <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
          {fields}<button className="btn-primary" type="submit">إضافة</button>
        </form>
      )}
      <table className="w-full">
        <thead><tr>{cols.map(([h]: any) => <th key={h} className="th">{h}</th>)}{extra ? <th className="th"></th> : null}</tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <React.Fragment key={r.id}>
              <tr className="hover:bg-gray-50">
                {cols.map(([h, fn]: any, i: number) => <td key={i} className="td">{fn(r) || "—"}</td>)}
                {extra ? (
                  <td className="td">
                    <div className="flex items-center gap-2">
                      {editable && edit && <button type="button" className="text-brand-600 hover:text-brand-800" title="تعديل" onClick={(e) => { const row = (e.currentTarget.closest("tr") as any)?.nextElementSibling; if (row) row.hidden = !row.hidden; }}>✎</button>}
                      {canDel && del && <form action={del.bind(null, r.id)}><button className="btn-icon-danger" title="حذف (أدمن)">×</button></form>}
                    </div>
                  </td>
                ) : null}
              </tr>
              {editable && edit && editFields && (
                <tr hidden>
                  <td className="td bg-gray-50" colSpan={cols.length + extra}>
                    <form action={edit.bind(null, r.id)} className="flex flex-wrap items-end gap-2">
                      {editFields(r)}<button className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700" type="submit">حفظ التعديل</button>
                    </form>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
          {rows.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={cols.length + extra}>لا توجد سجلات.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SectionAdm({ rows, editable, patientId, centers = [], rooms = [], role }: any) {
  return (
    <div className="space-y-4">
      {editable && (
        <form action={addAdmission.bind(null, patientId)} className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
          <input name="admissionDate" type="date" className="input" />
          <input name="durationDays" type="number" min="1" className="input !w-32" placeholder="المدة (أيام)" />
          <Combobox name="centerId" allowFree={false} placeholder="المركز" options={centers.map((c:any)=>({value:String(c.id),label:c.name}))} />
          <Combobox name="roomId" allowFree={false} placeholder="الغرفة/السرير" options={rooms.map((r:any)=>({value:String(r.id),label:r.name}))} />
          <input name="notes" className="input" placeholder="ملاحظات" />
          <button className="btn-primary" type="submit">تسجيل رقود</button>
        </form>
      )}
      <table className="w-full">
        <thead><tr><th className="th">الدخول</th><th className="th">المدة</th><th className="th">ينتهي بتاريخ</th><th className="th">الخروج</th><th className="th">المركز</th><th className="th">الغرفة</th><th className="th">الحالة</th><th className="th">ملاحظات</th><th className="th"></th></tr></thead>
        <tbody>
          {rows.map((r: any) => {
            const end = r.durationDays ? new Date(new Date(r.admissionDate).getTime() + r.durationDays * 86400000) : null;
            const over = r.status === "ADMITTED" && end && new Date() >= end;
            return (
            <tr key={r.id} className={`hover:bg-gray-50 ${over ? "bg-red-50/40" : ""}`}>
              <td className="td">{fmtDate(r.admissionDate)}</td>
              <td className="td">{r.durationDays ? `${r.durationDays} يوم` : "—"}</td>
              <td className={`td ${over ? "font-bold text-red-700" : ""}`}>{end ? fmtDate(end) : "—"}{over ? " ⚠ انتهى" : ""}</td>
              <td className="td">{fmtDate(r.dischargeDate)}</td>
              <td className="td">{r.center?.name || "—"}</td>
              <td className="td">{r.room?.name || "—"}</td>
              <td className="td">{r.status === "ADMITTED" ? <span className="badge-warning">راقد</span> : <span className="badge-neutral">خرج</span>}</td>
              <td className="td">{r.notes || "—"}</td>
              <td className="td">{editable && (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateAdmissionDuration.bind(null, patientId, r.id)} className="flex items-center gap-1">
                    <input name="durationDays" type="number" min="1" defaultValue={r.durationDays ?? ""} className="input !w-16 !py-0.5 text-xs" placeholder="أيام" title="مدة الرقود بالأيام" />
                    <button className="text-xs text-brand-700 hover:underline">حفظ المدة</button>
                  </form>
                  {r.status === "ADMITTED" && <form action={dischargeAdmission.bind(null, patientId, r.id)} className="flex items-center gap-1"><input name="dischargeDate" type="date" className="input !w-32 !py-0.5 text-xs" title="تاريخ الخروج (اختياري — فارغ = اليوم)" /><button className="text-sm text-brand-700 hover:underline">تسجيل خروج</button></form>}
                  {role === "ADMIN" && <form action={deleteAdmission.bind(null, patientId, r.id)}><button className="btn-icon-danger" title="حذف">×</button></form>}
                </div>
              )}</td>
            </tr>
            );
          })}
          {rows.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={9}>لا توجد سجلات رقود.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function formatWeekdays(value?: string | null) {
  const days = String(value || "")
    .split(",")
    .map((x) => Number(x))
    .filter((n) => n >= 0 && n <= 6)
    .map((n) => WEEKDAYS[n]);
  return days.length ? days.join("، ") : "—";
}

function appointmentsForSession(session: any, appointments: any[]) {
  return (appointments || []).filter((a) => a.sessionId === session.id);
}

function completedTherapySessions(patient: any) {
  const completed = (patient.appointments || []).filter((a: any) => a.sessionId && a.status === "COMPLETED").length;
  if (completed > 0) return completed;
  return (patient.therapySessions || []).reduce((sum: number, s: any) => sum + (Number(s.actualSessions) || 0), 0);
}

function plannedTherapySessions(patient: any) {
  const scheduled = (patient.appointments || []).filter((a: any) => a.sessionId).length;
  if (scheduled > 0) return scheduled;
  return (patient.therapySessions || []).reduce((sum: number, s: any) => sum + (Number(s.totalSessions) || 0), 0);
}

function sessionProgressCell(session: any, appointments: any[]) {
  const list = appointmentsForSession(session, appointments);
  const done = list.filter((a: any) => a.status === "COMPLETED").length || Number(session.actualSessions) || 0;
  const planned = list.length || Number(session.totalSessions) || 0;
  const upcoming = list.filter((a: any) => a.status === "SCHEDULED" && new Date(a.scheduledAt) >= new Date()).length;
  const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0;
  return (
    <div className="min-w-[150px]">
      <div className="mb-1 flex justify-between text-xs text-gray-500"><span>{done} / {planned || "—"}</span><span>{upcoming} قادمة</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} /></div>
      {list.length > 0 && <div className="mt-1 text-xs text-gray-400">آخر موعد: {fmtDate(list[list.length - 1]?.scheduledAt)}</div>}
    </div>
  );
}

function TherapySessionLogs({ patient, editable, patientId, afterMutate }: any) {
  const logs = patient.therapySessionLogs ?? [];
  const sessions = patient.therapySessions ?? [];
  const appointments = (patient.appointments ?? []).filter((a: any) => a.sessionId);
  const today = new Date().toISOString().slice(0, 10);
  const w = (action: any) => async (fd: FormData) => { await action(fd); afterMutate?.(); };
  const recentExercise = logs.find((l: any) => l.exercises)?.exercises;
  const recentRecommendation = logs.find((l: any) => l.nextRecommendation)?.nextRecommendation;
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-800">سجل نتيجة الجلسات اليومية</h3>
          <p className="mt-1 text-xs text-gray-500">يوثق المعالج ما تم تنفيذه فعلياً في كل جلسة، منفصلاً عن الخطة والجدولة.</p>
        </div>
        <span className="badge-brand">{logs.length} سجل</span>
      </div>

      {editable && (
        <form action={w(addTherapySessionLog.bind(null, patientId))} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-3 md:grid-cols-4">
          <div>
            <label className="label">المسار/الجدولة</label>
            <select name="sessionId" className="input">
              <option value="">بدون ربط</option>
              {sessions.map((s: any) => <option key={s.id} value={s.id}>{THERAPY[s.therapyType as keyof typeof THERAPY]} - {s.therapist || "بدون معالج"}{s.hall ? ` - ${s.hall}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="label">موعد مرتبط</label>
            <select name="appointmentId" className="input">
              <option value="">بدون ربط</option>
              {appointments.slice(0, 40).map((a: any) => <option key={a.id} value={a.id}>{fmtDate(a.scheduledAt)} - {a.assignedTo || "بدون مسؤول"}</option>)}
            </select>
          </div>
          <div><label className="label">المعالج</label><input name="therapist" className="input" placeholder="اسم المعالج" defaultValue={sessions[0]?.therapist ?? ""} /></div>
          <div><label className="label">تاريخ التنفيذ</label><input name="performedAt" type="date" className="input" defaultValue={today} /></div>
          <div className="md:col-span-2"><label className="label">التمارين المنفذة</label><textarea name="exercises" className="input" rows={2} placeholder="مثال: تمارين مدى الحركة، تقوية، مشي متدرج..." /></div>
          <div className="md:col-span-2"><label className="label">استجابة المراجع</label><textarea name="response" className="input" rows={2} placeholder="تحمل جيد، تعب سريع، تحسن بالتوازن..." /></div>
          <div><label className="label">الألم قبل (0-10)</label><input name="painBefore" type="number" min={0} max={10} className="input" /></div>
          <div><label className="label">الألم بعد (0-10)</label><input name="painAfter" type="number" min={0} max={10} className="input" /></div>
          <div className="md:col-span-2"><label className="label">ملاحظات المعالج</label><input name="notes" className="input" placeholder="ملاحظات مختصرة" /></div>
          <div className="md:col-span-4"><label className="label">توصية الجلسة القادمة</label><input name="nextRecommendation" className="input" placeholder="ما الذي يركز عليه المعالج في الجلسة القادمة؟" /></div>
          <div className="md:col-span-4"><button className="btn-primary" type="submit">تسجيل نتيجة الجلسة</button></div>
        </form>
      )}

      {(recentExercise || recentRecommendation) && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {recentExercise && <div className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600"><span className="font-semibold text-gray-700">آخر تمارين:</span> {recentExercise}</div>}
          {recentRecommendation && <div className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600"><span className="font-semibold text-gray-700">توصية قادمة:</span> {recentRecommendation}</div>}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {logs.length === 0 && <p className="text-sm text-gray-400">لا توجد نتائج جلسات مسجلة بعد.</p>}
        {logs.slice(0, 8).map((l: any) => (
          <div key={l.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge-brand">{fmtDate(l.performedAt)}</span>
                {l.therapist && <span className="badge-neutral">{l.therapist}</span>}
                {l.session?.therapyType && <span className="badge-neutral">{THERAPY[l.session.therapyType as keyof typeof THERAPY]}</span>}
              </div>
              {(l.painBefore != null || l.painAfter != null) && <span className="text-xs text-gray-500">الألم: {l.painBefore ?? "—"} ← {l.painAfter ?? "—"}</span>}
            </div>
            <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
              {l.exercises && <div><span className="text-xs font-semibold text-gray-400">التمارين</span><div className="text-gray-700">{l.exercises}</div></div>}
              {l.response && <div><span className="text-xs font-semibold text-gray-400">الاستجابة</span><div className="text-gray-700">{l.response}</div></div>}
              {l.notes && <div><span className="text-xs font-semibold text-gray-400">ملاحظات</span><div className="text-gray-700">{l.notes}</div></div>}
              {l.nextRecommendation && <div><span className="text-xs font-semibold text-gray-400">الجلسة القادمة</span><div className="text-gray-700">{l.nextRecommendation}</div></div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionPlan({ rows, sessionsCount, plannedCount, editable, patientId, afterMutate }: any) {
  const w = (action: any) => async (fd: FormData) => { await action(fd); afterMutate?.(); };
  const PLAN_CLR: Record<string, string> = { ACTIVE: "bg-emerald-50 text-emerald-700", COMPLETED: "bg-green-50 text-green-700", PAUSED: "bg-amber-50 text-amber-700" };
  const overallPct = plannedCount > 0 ? Math.min(100, Math.round((sessionsCount / plannedCount) * 100)) : null;
  return (
    <div className="space-y-5">
      {editable && (
        <form action={w(addTreatmentPlan.bind(null, patientId))} className="grid gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-2">
          <input name="title" className="input" placeholder="عنوان الخطة (مثل: تأهيل حركي للطرف السفلي)" />
          <input name="plannedSessions" type="number" min="1" className="input" placeholder="عدد الجلسات المخطّطة" />
          <input name="goals" className="input md:col-span-2" placeholder="هدف الخطة العلاجي" />
          <div><label className="label">تاريخ البدء</label><input name="startDate" type="date" className="input" /></div>
          <input name="notes" className="input" placeholder="ملاحظات المعالج" />
          <div className="md:col-span-2"><button className="btn-primary" type="submit">إضافة خطة</button></div>
        </form>
      )}
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-gray-700">تقدم المسار العلاجي العام</span>
          <span className="text-gray-500">المنجز: <b className="text-gray-800">{sessionsCount}</b> / المخطط: <b className="text-gray-800">{plannedCount || "—"}</b></span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white">
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${overallPct ?? 0}%` }} />
        </div>
        <div className="mt-1 text-xs text-gray-400">{overallPct === null ? "لا توجد جلسات مخططة بعد." : `نسبة التقدم ${overallPct}% حسب المواعيد العلاجية المرتبطة.`}</div>
      </div>
      {rows.length === 0 && <p className="text-sm text-gray-400">لا توجد خطة علاجية بعد.</p>}
      <div className="space-y-3">
        {rows.map((p: any) => {
          const planned = p.plannedSessions || 0;
          const pct = planned > 0 ? Math.min(100, Math.round((sessionsCount / planned) * 100)) : 0;
          return (
            <div key={p.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-gray-800">{p.title}</div>
                <span className={`badge ${PLAN_CLR[p.status]}`}>{PLAN_STATUS[p.status as keyof typeof PLAN_STATUS]}</span>
              </div>
              {p.goals && <div className="mt-1 text-sm text-gray-600">هدف الخطة: {p.goals}</div>}
              {planned > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-gray-500"><span>المنجز: {sessionsCount} / {planned} جلسة</span><span>{pct}%</span></div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} /></div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                {p.startDate && <span>البدء: {fmtDate(p.startDate)}</span>}
                {p.notes && <span>{p.notes}</span>}
              </div>
              {editable && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                  {p.status !== "COMPLETED" && <form action={w(setTreatmentPlanStatus.bind(null, patientId, p.id, "COMPLETED"))}><button className="text-xs text-green-700 hover:underline">إنهاء</button></form>}
                  {p.status !== "PAUSED" && <form action={w(setTreatmentPlanStatus.bind(null, patientId, p.id, "PAUSED"))}><button className="text-xs text-amber-700 hover:underline">إيقاف</button></form>}
                  {p.status !== "ACTIVE" && <form action={w(setTreatmentPlanStatus.bind(null, patientId, p.id, "ACTIVE"))}><button className="text-xs text-brand-700 hover:underline">تنشيط</button></form>}
                  <form action={w(deleteTreatmentPlan.bind(null, patientId, p.id))}><button className="text-red-400 hover:text-red-600" title="حذف">×</button></form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniChart({ values }: { values: number[] }) {
  const W = 320, H = 90, pad = 10;
  if (values.length === 0) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const n = values.length;
  const coords = values.map((v, i) => {
    const x = n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1);
    const y = H - pad - ((v - min) / span) * (H - 2 * pad);
    return [x, y] as [number, number];
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }} preserveAspectRatio="xMidYMid meet">
      {n > 1 && <polyline points={coords.map((c) => c.join(",")).join(" ")} fill="none" stroke="#0f766e" strokeWidth="2" />}
      {coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.5" fill="#0f766e" />)}
    </svg>
  );
}

function SectionMetrics({ rows, editable, patientId, afterMutate }: any) {
  const w = (action: any) => async (fd: FormData) => { await action(fd); afterMutate?.(); };
  const groups: Record<string, any[]> = {};
  for (const r of rows) (groups[r.label] ||= []).push(r);
  return (
    <div className="space-y-5">
      {editable && (
        <>
        <div className="flex flex-wrap gap-2">
          {[["مدى الحركة (ROM)", "0-180"], ["مقياس الألم", "0-10"], ["مؤشر بارثيل", "0-100"]].map(([lbl, rng]) => (
            <form key={lbl} action={w(addProgressMetric.bind(null, patientId))} className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1">
              <input type="hidden" name="label" value={lbl} />
              <span className="text-xs text-gray-500">{lbl}<span className="text-gray-300"> {rng}</span></span>
              <input name="value" type="number" step="any" className="input !w-16 !py-0.5 text-xs" placeholder="القيمة" />
              <button className="text-xs text-brand-700 hover:underline">+ سجّل</button>
            </form>
          ))}
        </div>
        <form action={w(addProgressMetric.bind(null, patientId))} className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
          <input name="label" className="input !w-44" placeholder="اسم المقياس (مثل: مدى الحركة)" />
          <input name="value" type="number" step="any" className="input !w-28" placeholder="القيمة" />
          <input name="date" type="date" className="input" />
          <input name="notes" className="input flex-1 min-w-[140px]" placeholder="ملاحظات" />
          <button className="btn-primary" type="submit">إضافة قياس</button>
        </form>
        </>
      )}

      {Object.keys(groups).length === 0 && <p className="text-sm text-gray-400">لا توجد مقاييس بعد. أضف قياساً لمتابعة تطوّر الحالة عبر الزمن.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(groups).map(([label, list]: any) => {
          const last = list[list.length - 1], first = list[0];
          const diff = list.length > 1 ? +(last.value - first.value).toFixed(2) : 0;
          return (
            <div key={label} className="rounded-xl border border-gray-200 p-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-gray-700">{label}</span>
                <span className="text-sm text-gray-500">آخر قيمة: <b className="text-gray-800">{last.value}</b>
                  {list.length > 1 && <span className={diff >= 0 ? "text-green-700" : "text-red-700"}> ({diff >= 0 ? "▲ +" : "▼ "}{diff})</span>}
                </span>
              </div>
              <TrendChart points={list.map((r: any) => ({ label: fmtDate(r.date), value: r.value }))} height={130} />
              <div className="mt-1 flex justify-between text-[11px] text-gray-400">
                <span>{fmtDate(first.date)}</span><span>{fmtDate(last.date)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr><th className="th">التاريخ</th><th className="th">المقياس</th><th className="th">القيمة</th><th className="th">ملاحظات</th>{editable && <th className="th"></th>}</tr></thead>
          <tbody>
            {[...rows].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((r: any) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="td">{fmtDate(r.date)}</td>
                <td className="td">{r.label}</td>
                <td className="td font-medium">{r.value}</td>
                <td className="td">{r.notes || "—"}</td>
                {editable && <td className="td"><form action={w(deleteProgressMetric.bind(null, patientId, r.id))}><button className="btn-icon-danger" title="حذف">×</button></form></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SectionWound({ rows, editable, patientId, role }: any) {
  // كل صور الجروح مرتّبة زمنياً (الأقدم لليمين) للمقارنة البصرية
  const photos = [...rows]
    .flatMap((r: any) => (r.photos || []).map((p: any) => ({ ...p, date: r.assessmentDate })))
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return (
    <div className="space-y-4">
      {photos.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium text-gray-600">تتبّع تطوّر الجرح (من الأقدم للأحدث):</div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {photos.map((ph: any) => (
              <div key={ph.id} className="shrink-0 text-center">
                <Zoom src={ph.fileUrl} className="h-28 w-28 rounded-lg border border-gray-200 object-cover" />
                <div className="mt-1 text-[10px] text-gray-400">{fmtDate(ph.date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {editable && (
        <form action={addWound.bind(null, patientId)} className="grid gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-3">
          <input name="woundType" className="input" placeholder="نوع الجرح/القرحة" />
          <input name="exudate" className="input" placeholder="الإفرازات" />
          <input name="photo" type="file" accept="image/*" className="input" />
          <input name="nextPlan" className="input md:col-span-3" placeholder="خطوات الخطة التالية" />
          <div className="flex flex-wrap gap-4 text-sm md:col-span-3">
            <label className="flex items-center gap-1"><input type="checkbox" name="redness" /> احمرار</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="swelling" /> تورم</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="odor" /> رائحة</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="warmth" /> حرارة</label>
            <button className="btn-primary mr-auto" type="submit">إضافة تقييم</button>
          </div>
        </form>
      )}
      <div className="space-y-3">
        {rows.map((r: any) => (
          <div key={r.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{r.woundType || "تقييم جرح"}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">{fmtDate(r.assessmentDate)}</span>
                {role === "ADMIN" && <form action={deleteWound.bind(null, patientId, r.id)}><button className="btn-icon-danger" title="حذف">×</button></form>}
              </div>
            </div>
            <div className="mt-1 text-sm text-gray-600">
              الإفرازات: {r.exudate || "—"} ·
              {r.redness && " احمرار"}{r.swelling && " تورم"}{r.odor && " رائحة"}{r.warmth && " حرارة"}
            </div>
            {r.nextPlan && <div className="mt-1 text-sm text-gray-500">الخطة: {r.nextPlan}</div>}
            {r.photos?.map((ph: any) => (
              <a key={ph.id} href={ph.fileUrl} target="_blank" className="mt-2 inline-block text-sm text-brand-700 hover:underline">📷 {ph.fileName}</a>
            ))}
          </div>
        ))}
        {rows.length === 0 && <p className="text-center text-sm text-gray-400">لا توجد تقييمات.</p>}
      </div>
    </div>
  );
}

function SectionFiles({ rows, officialDocs = [], editable, patientId, afterMutate }: any) {
  const [filter, setFilter] = useState("ALL");
  const w = (action: any) => async (fd: FormData) => { await action(fd); afterMutate?.(); };
  const isImg = (r: any) => r.type === "IMAGE" || r.type === "WOUND" || /\.(png|jpe?g|gif|webp|bmp)$/i.test(r.fileName || "");
  const TYPES: Record<string, string> = { DOCUMENT: "وثيقة", IMAGE: "صورة", WOUND: "صورة جرح", OTHER: "أخرى" };
  const woundRows = rows.filter((r: any) => r.type === "WOUND" || r.woundId).map((r: any) => ({ ...r, source: "wound", sourceLabel: "مرتبط بتقييم جرح" }));
  const patientRows = rows.filter((r: any) => r.type !== "WOUND" && !r.woundId).map((r: any) => ({ ...r, source: "patient", sourceLabel: "ملف المراجع" }));
  const officialRows = officialDocs.filter((d: any) => d.attachmentUrl).map((d: any) => ({
    id: `official-${d.id}`,
    fileName: d.subject || d.number || "مرفق وثيقة رسمية",
    fileUrl: d.attachmentUrl,
    type: "DOCUMENT",
    uploadedAt: d.docDate,
    source: "official",
    sourceLabel: "وثيقة رسمية",
    official: d,
  }));
  const allRows = [...patientRows, ...woundRows, ...officialRows].sort((a: any, b: any) => +new Date(b.uploadedAt ?? 0) - +new Date(a.uploadedAt ?? 0));
  const filtered = allRows.filter((r: any) => filter === "ALL" || r.type === filter || r.source === filter);
  const imageRows = filtered.filter(isImg);
  const fileRows = filtered.filter((r: any) => !isImg(r));
  const counts = {
    ALL: allRows.length,
    DOCUMENT: allRows.filter((r: any) => r.type === "DOCUMENT").length,
    IMAGE: allRows.filter((r: any) => r.type === "IMAGE").length,
    WOUND: allRows.filter((r: any) => r.type === "WOUND" || r.source === "wound").length,
    OTHER: allRows.filter((r: any) => r.type === "OTHER").length,
    official: allRows.filter((r: any) => r.source === "official").length,
  };
  const chip = (value: string, label: string, count: number) => (
    <button type="button" onClick={() => setFilter(value)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === value ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
      {label} <span className={filter === value ? "text-white/80" : "text-gray-400"}>{count}</span>
    </button>
  );
  return (
    <div className="space-y-5">
      {editable && (
        <form action={w(addAttachment.bind(null, patientId))} className="grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
          <div>
            <label className="label">الملف</label>
            <input name="file" type="file" className="input" />
          </div>
          <div>
            <label className="label">العنوان/الوصف</label>
            <input name="displayName" className="input" placeholder="اختياري" />
          </div>
          <Combobox name="type" label="التصنيف" allowFree={false} defaultValue="DOCUMENT" options={[{value:"DOCUMENT",label:"وثيقة"},{value:"IMAGE",label:"صورة / أشعة"},{value:"WOUND",label:"صورة جرح"},{value:"OTHER",label:"أخرى"}]} />
          <button className="btn-primary" type="submit">رفع مرفق</button>
        </form>
      )}

      <div className="card flex flex-wrap gap-2 p-3">
        {chip("ALL", "الكل", counts.ALL)}
        {chip("DOCUMENT", "وثائق", counts.DOCUMENT)}
        {chip("IMAGE", "صور", counts.IMAGE)}
        {chip("WOUND", "جروح", counts.WOUND)}
        {chip("OTHER", "أخرى", counts.OTHER)}
        {chip("official", "وثائق رسمية", counts.official)}
      </div>

      {imageRows.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-600">الصور والمرفقات المرئية ({imageRows.length})</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {imageRows.map((r: any) => (
              <div key={r.id} className={`group relative overflow-hidden rounded-xl border ${r.source === "wound" ? "border-rose-200 bg-rose-50/30" : "border-gray-200"}`}>
                <Zoom src={r.fileUrl} alt={r.fileName} className="h-32 w-full object-cover" />
                <div className="px-2 py-1 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-gray-700">{r.fileName}</span>
                    {editable && !r.official && <form action={w(deleteAttachment.bind(null, patientId, r.id))}><button className="btn-icon-danger" title="حذف">×</button></form>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-gray-400">
                    <span>{fmtDate(r.uploadedAt)}</span><span>·</span><span>{r.sourceLabel}</span>
                  </div>
                  <a href={r.fileUrl} target="_blank" className="mt-1 inline-block text-brand-700 hover:underline">فتح/تحميل</a>
                </div>
                <div className="absolute right-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{TYPES[r.type] || r.type}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {fileRows.length > 0 && (
        <div className="table-wrap">
          <table className="w-full">
            <thead><tr><th className="th">العنوان/الملف</th><th className="th">التصنيف</th><th className="th">الارتباط</th><th className="th">تاريخ الرفع/الوثيقة</th><th className="th">رابط</th>{editable && <th className="th"></th>}</tr></thead>
            <tbody>
              {fileRows.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="td">
                    <div className="font-medium text-gray-800">{r.fileName}</div>
                    {r.official && <div className="text-xs text-gray-400">العدد: {r.official.number} · {(DOC_DIRECTION as any)[r.official.direction]}</div>}
                  </td>
                  <td className="td"><span className="badge-neutral">{TYPES[r.type] || r.type}</span></td>
                  <td className="td">
                    <span className={`badge ${r.source === "official" ? "bg-sky-100 text-sky-700" : r.source === "wound" ? "bg-rose-100 text-rose-700" : "bg-gray-100 text-gray-700"}`}>{r.sourceLabel}</span>
                  </td>
                  <td className="td">{fmtDate(r.uploadedAt)}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-2">
                      <a href={r.fileUrl} target="_blank" className="text-brand-700 hover:underline">فتح/تحميل</a>
                      {r.official && <a href={`/official-docs/${r.official.id}`} className="text-brand-700 hover:underline">الوثيقة</a>}
                    </div>
                  </td>
                  {editable && <td className="td">{!r.official && <form action={w(deleteAttachment.bind(null, patientId, r.id))}><button className="btn-icon-danger" title="حذف">×</button></form>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length === 0 && <p className="text-sm text-gray-400">لا توجد مرفقات مطابقة لهذا الفلتر.</p>}
    </div>
  );
}

function Timeline({ patient }: { patient: any }) {
  type Ev = { date: any; type: string; title: string; color: string };
  const evs: Ev[] = [];
  (patient.diagnoses || []).forEach((r: any) => evs.push({ date: r.date, type: "تشخيص", title: `${DIAGNOSIS[r.type as keyof typeof DIAGNOSIS] || ""}: ${r.text || ""}`, color: "bg-sky-500" }));
  (patient.medicalReports || []).forEach((r: any) => evs.push({ date: r.date, type: "تقرير طبي", title: r.content || "", color: "bg-indigo-500" }));
  (patient.therapySessions || []).forEach((r: any) => evs.push({ date: r.createdAt, type: "جلسة علاجية", title: `${THERAPY[r.therapyType as keyof typeof THERAPY] || ""}${r.center?.name ? " - " + r.center.name : ""}`, color: "bg-brand-500" }));
  (patient.prescriptions || []).forEach((r: any) => evs.push({ date: r.prescribedAt, type: "وصفة", title: r.medication?.name || r.materialName || "", color: "bg-emerald-500" }));
  (patient.admissions || []).forEach((r: any) => evs.push({ date: r.admissionDate, type: "رقود", title: `${r.center?.name || ""}${r.dischargeDate ? " (خرج " + fmtDate(r.dischargeDate) + ")" : " (راقد)"}`, color: "bg-amber-500" }));
  (patient.woundAssessments || []).forEach((r: any) => evs.push({ date: r.assessmentDate, type: "تقييم جرح", title: r.woundType || "تقييم جرح", color: "bg-rose-500" }));
  (patient.correspondence || []).forEach((r: any) => evs.push({ date: r.bookDate || r.createdAt, type: "مخاطبة", title: `${DIRECTION[r.direction as keyof typeof DIRECTION] || ""}: ${r.subject || ""}`, color: "bg-gray-500" }));
  (patient.appointments || []).forEach((r: any) => evs.push({ date: r.scheduledAt, type: "موعد", title: `${r.type || ""} — ${APPT_STATUS[r.status as keyof typeof APPT_STATUS] || ""}`, color: "bg-purple-500" }));

  evs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (evs.length === 0) return <p className="text-center text-sm text-gray-400">لا أحداث بعد.</p>;
  return (
    <div className="relative space-y-4 pr-4">
      <div className="absolute right-1.5 top-2 bottom-2 w-px bg-gray-200" />
      {evs.map((e, i) => (
        <div key={i} className="relative flex gap-3">
          <div className={`absolute right-0 mt-1.5 h-3 w-3 -translate-x-1/2 rounded-full ${e.color} ring-2 ring-white`} style={{ right: "-2px" }} />
          <div className="mr-3 flex-1">
            <div className="flex items-center gap-2">
              <span className="badge-neutral">{e.type}</span>
              <span className="text-xs text-gray-400">{fmtDate(e.date)}</span>
            </div>
            <div className="text-sm text-gray-800">{e.title || "—"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityLog({ logs }: { logs: any[] }) {
  const ACT: Record<string, string> = { CREATE: "أنشأ", UPDATE: "عدّل", DELETE: "حذف", VIEW: "فتح الملف" };
  const ACT_CLR: Record<string, string> = { CREATE: "text-green-700", UPDATE: "text-amber-700", DELETE: "text-red-700", VIEW: "text-gray-500" };
  return (
    <div>
      <p className="mb-3 text-xs text-gray-400">آخر النشاط على ملف هذا المراجع (من فتح أو عدّل).</p>
      {(!logs || logs.length === 0) && <p className="text-sm text-gray-400">لا يوجد نشاط مسجّل.</p>}
      <div className="space-y-1.5">
        {logs?.map((l) => (
          <div key={l.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
            <span><span className={`font-medium ${ACT_CLR[l.action] ?? "text-gray-600"}`}>{ACT[l.action] ?? l.action}</span> — {l.user?.fullName ?? "غير معروف"}</span>
            <span className="text-xs text-gray-400">{fmtDateTime(l.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SchedulePlanner({ patientId, centers, halls }: any) {
  const [open, setOpen] = useState(false);
  const WEEKDAYS = [
    { v: 6, l: "السبت" }, { v: 0, l: "الأحد" }, { v: 1, l: "الإثنين" },
    { v: 2, l: "الثلاثاء" }, { v: 3, l: "الأربعاء" }, { v: 4, l: "الخميس" }, { v: 5, l: "الجمعة" },
  ];
  const THERAPY_OPTS = Object.entries(THERAPY).map(([value, label]: any) => ({ value, label }));
  const activeHalls = (halls || []).filter((h: any) => h.active);
  return (
    <div className="rounded-xl border-2 border-brand-200 bg-brand-50 p-4">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-right">
        <span className="flex items-center gap-2 font-semibold text-brand-800">📅 جدولة الجلسات العلاجية <span className="text-xs font-normal text-brand-600">(رئيس المعالجين)</span></span>
        <span className="text-brand-600">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <form action={scheduleSessions.bind(null, patientId)} className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-gray-600">نوع العلاج
              <select name="therapyType" className="input mt-1 w-full">
                {THERAPY_OPTS.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">المركز
              <select name="centerId" className="input mt-1 w-full">
                <option value="">—</option>
                {(centers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">القاعة المعالِجة
              <Combobox name="hall" allowFree options={activeHalls.map((h: any) => h.name)} placeholder="اختر أو اكتب..." />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-gray-600">المعالج<input name="therapist" className="input mt-1 w-full" placeholder="اسم المعالج" /></label>
            <label className="text-xs text-gray-600">عدد الجلسات<input name="totalSessions" type="number" min={1} max={60} defaultValue={6} className="input mt-1 w-full" /></label>
            <label className="text-xs text-gray-600">وقت الجلسة<input name="sessionTime" type="time" defaultValue="10:00" className="input mt-1 w-full" /></label>
          </div>

          <label className="block text-xs text-gray-600">الخطة العلاجية
            <input name="treatmentPlan" className="input mt-1 w-full" placeholder="وصف الخطة العلاجية" />
          </label>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-gray-600">أيام المراجعة بالأسبوع</div>
              <div className="text-[11px] text-gray-400">اختر يومًا أو أكثر، وسيتم توزيع الجلسات بالتتابع حسب التاريخ والوقت.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <label key={d.v} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-100 has-[:checked]:font-semibold has-[:checked]:text-brand-800">
                  <input type="checkbox" name="weekdays" value={d.v} className="h-3.5 w-3.5 accent-brand-600" />{d.l}
                </label>
              ))}
            </div>
          </div>

          <label className="block text-xs text-gray-600">تاريخ بداية الجدولة
            <input name="startDate" type="date" required className="input mt-1 w-full md:w-64" />
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-brand-200 bg-white p-3 text-xs text-gray-500">
              سيوزّع النظام الجلسات على الأيام المختارة ابتداءً من تاريخ البداية، وينشئ موعداً لكل جلسة في المواعيد تلقائياً. لا يُحذف أي موعد أو جلسة سابقة.
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              قبل الحفظ يتم فحص التضارب القوي: نفس المعالج أو نفس القاعة في نفس وقت الجلسة. إذا ظهر تضارب لن يتم إنشاء الجدولة.
            </div>
          </div>

          <button className="btn-primary" type="submit">جدولة الجلسات وإضافتها للمواعيد</button>
        </form>
      )}
      {open && <HallManager halls={halls} />}
    </div>
  );
}

function HallManager({ halls }: any) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-3 border-t border-brand-200 pt-3">
      <button type="button" onClick={() => setShow(!show)} className="text-xs font-medium text-brand-700 hover:underline">
        {show ? "▲ إخفاء إدارة القاعات" : "⚙ إدارة القاعات"}
      </button>
      {show && (
        <div className="mt-2 space-y-2">
          <form action={addTherapyHall} className="flex gap-2">
            <input name="name" className="input flex-1" placeholder="اسم قاعة جديدة" />
            <button className="btn-primary btn-sm" type="submit">+ إضافة</button>
          </form>
          <ul className="space-y-1">
            {(halls || []).map((h: any) => (
              <li key={h.id} className="flex items-center justify-between rounded bg-white px-3 py-1.5 text-sm">
                <span className={h.active ? "text-gray-800" : "text-gray-400 line-through"}>{h.name}</span>
                <form action={setTherapyHallActive.bind(null, h.id, !h.active)}>
                  <button className={h.active ? "text-xs text-amber-700 hover:underline" : "text-xs text-emerald-700 hover:underline"}>{h.active ? "تعطيل" : "تفعيل"}</button>
                </form>
              </li>
            ))}
            {(!halls || halls.length === 0) && <li className="text-xs text-gray-400">لا توجد قاعات. أضف قاعة أعلاه.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function SectionResidentReview({ rows, editable, patientId, afterMutate }: any) {
  const w = (action: any) => async (fd: FormData) => { await action(fd); afterMutate?.(); };
  const [refer, setRefer] = useState(false);
  const SPECIALTIES = ["كسور", "جراحة عامة", "عظام", "باطنية", "جراحة أعصاب", "مسالك بولية", "أنف وأذن وحنجرة", "عيون", "جلدية", "أوعية دموية"];
  const sorted = [...rows].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return (
    <div className="space-y-5">
      {editable && (
        <form action={w(addResidentReview.bind(null, patientId))} className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-brand-700">🩺 تقييم الطبيب المقيم</div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-xs text-gray-500">التاريخ<input name="date" type="date" className="input mt-1 w-full" /></label>
            <label className="text-xs text-gray-500 md:col-span-3">اسم الطبيب المقيم<input name="residentDoctor" className="input mt-1 w-full" placeholder="د. ..." /></label>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-gray-600">العلامات الحيوية</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <label className="text-xs text-gray-500">الضغط الانقباضي<input name="systolic" type="number" className="input mt-1 w-full" placeholder="120" /></label>
              <label className="text-xs text-gray-500">الضغط الانبساطي<input name="diastolic" type="number" className="input mt-1 w-full" placeholder="80" /></label>
              <label className="text-xs text-gray-500">السكر mg/dL<input name="glucose" type="number" className="input mt-1 w-full" placeholder="110" /></label>
              <label className="text-xs text-gray-500">النبض<input name="pulse" type="number" className="input mt-1 w-full" placeholder="75" /></label>
              <label className="text-xs text-gray-500">الحرارة °C<input name="temp" type="number" step="0.1" className="input mt-1 w-full" placeholder="37" /></label>
              <label className="text-xs text-gray-500">الأكسجين %<input name="spo2" type="number" className="input mt-1 w-full" placeholder="98" /></label>
              <label className="text-xs text-gray-500">التنفّس<input name="respRate" type="number" className="input mt-1 w-full" placeholder="18" /></label>
              <label className="text-xs text-gray-500">الوزن kg<input name="weight" type="number" step="0.1" className="input mt-1 w-full" placeholder="70" /></label>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" name="referralNeeded" value="1" checked={refer} onChange={(e) => setRefer(e.target.checked)} className="h-4 w-4 accent-brand-600" />
              إحالة إلى طبيب اختصاص
            </label>
            {refer && (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <label className="text-xs text-gray-500">نوع الاختصاص
                  <Combobox name="specialtyType" allowFree options={SPECIALTIES} placeholder="اختر أو اكتب..." />
                </label>
                <label className="text-xs text-gray-500">سبب الإحالة<input name="referralReason" className="input mt-1 w-full" placeholder="مثال: كسر مغلق يحتاج تقييم" /></label>
                <label className="text-xs text-gray-500 md:col-span-2">ملاحظات الإحالة<input name="referralNotes" className="input mt-1 w-full" /></label>
              </div>
            )}
          </div>

          <input name="generalNotes" className="input w-full" placeholder="ملاحظات عامة للطبيب المقيم" />
          <button className="btn-primary" type="submit">حفظ تقييم الطبيب المقيم</button>
        </form>
      )}

      {rows.length === 0 && <p className="text-sm text-gray-400">لا توجد تقييمات بعد. يسجّل الطبيب المقيم العلامات الحيوية والإحالة قبل التشخيص.</p>}

      <div className="space-y-3">
        {sorted.map((r: any) => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="badge-brand">{fmtDate(r.date)}</span>
                {r.residentDoctor && <span className="text-sm font-medium text-gray-700">{r.residentDoctor}</span>}
              </div>
              {editable && <form action={w(deleteResidentReview.bind(null, patientId, r.id))}><button className="btn-icon-danger" title="حذف">×</button></form>}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700">
              {(r.systolic && r.diastolic) ? <span>الضغط: <b>{r.systolic}/{r.diastolic}</b></span> : null}
              {r.glucose != null ? <span>السكر: <b>{r.glucose}</b> mg/dL</span> : null}
              {r.pulse != null ? <span>النبض: <b>{r.pulse}</b></span> : null}
              {r.temp != null ? <span>الحرارة: <b>{r.temp}°</b></span> : null}
              {r.spo2 != null ? <span>الأكسجين: <b>{r.spo2}%</b></span> : null}
              {r.respRate != null ? <span>التنفّس: <b>{r.respRate}</b></span> : null}
              {r.weight != null ? <span>الوزن: <b>{r.weight}</b> kg</span> : null}
            </div>

            {r.referralNeeded && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-amber-800">↪ إحالة إلى اختصاص: {r.specialtyType || "غير محدد"}</div>
                {r.referralReason && <div className="mt-1 text-amber-700">السبب: {r.referralReason}</div>}
                {r.referralNotes && <div className="mt-0.5 text-amber-700">ملاحظات: {r.referralNotes}</div>}
              </div>
            )}

            {r.generalNotes && <div className="mt-2 text-sm text-gray-500">ملاحظات: {r.generalNotes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionVitals({ rows, editable, patientId, afterMutate }: any) {
  const w = (action: any) => async (fd: FormData) => { await action(fd); afterMutate?.(); };
  const sorted = [...rows].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const pts = (key: string) => sorted.filter((r: any) => r[key] !== null && r[key] !== undefined).map((r: any) => ({ label: fmtDate(r.date), value: r[key] }));
  const charts: { key: string; label: string; unit: string; color: string }[] = [
    { key: "pulse", label: "النبض", unit: " ن/د", color: "#dc2626" },
    { key: "temp", label: "الحرارة", unit: "°", color: "#d97706" },
    { key: "systolic", label: "الضغط الانقباضي", unit: "", color: "#0d655e" },
    { key: "spo2", label: "تشبّع الأكسجين", unit: "%", color: "#0284c7" },
  ];
  const latest = sorted[sorted.length - 1];
  return (
    <div className="space-y-5">
      {editable && (
        <form action={w(addVitalSign.bind(null, patientId))} className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 md:grid-cols-4">
          <label className="text-xs text-gray-500">التاريخ<input name="date" type="date" className="input mt-1 w-full" /></label>
          <label className="text-xs text-gray-500">الضغط الانقباضي<input name="systolic" type="number" className="input mt-1 w-full" placeholder="120" /></label>
          <label className="text-xs text-gray-500">الضغط الانبساطي<input name="diastolic" type="number" className="input mt-1 w-full" placeholder="80" /></label>
          <label className="text-xs text-gray-500">النبض<input name="pulse" type="number" className="input mt-1 w-full" placeholder="75" /></label>
          <label className="text-xs text-gray-500">الحرارة °C<input name="temp" type="number" step="0.1" className="input mt-1 w-full" placeholder="37" /></label>
          <label className="text-xs text-gray-500">الأكسجين %<input name="spo2" type="number" className="input mt-1 w-full" placeholder="98" /></label>
          <label className="text-xs text-gray-500">السكر mg/dL<input name="glucose" type="number" className="input mt-1 w-full" placeholder="110" /></label>
          <label className="text-xs text-gray-500">التنفّس<input name="respRate" type="number" className="input mt-1 w-full" placeholder="18" /></label>
          <label className="text-xs text-gray-500">الوزن kg<input name="weight" type="number" step="0.1" className="input mt-1 w-full" placeholder="70" /></label>
          <input name="notes" className="input col-span-2 md:col-span-3" placeholder="ملاحظات" />
          <button className="btn-primary" type="submit">تسجيل القراءة</button>
        </form>
      )}

      {latest && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["الضغط", latest.systolic && latest.diastolic ? `${latest.systolic}/${latest.diastolic}` : "—"], ["النبض", latest.pulse ?? "—"], ["الحرارة", latest.temp ? `${latest.temp}°` : "—"], ["الأكسجين", latest.spo2 ? `${latest.spo2}%` : "—"]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl border border-gray-200 p-3 text-center">
              <div className="text-xl font-bold text-gray-800">{v as any}</div>
              <div className="text-xs text-gray-400">{l}</div>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 && <p className="text-sm text-gray-400">لا توجد قراءات بعد. سجّل العلامات الحيوية بكل زيارة لمتابعتها عبر الزمن.</p>}

      {rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {charts.filter((c) => pts(c.key).length > 0).map((c) => (
            <div key={c.key} className="rounded-xl border border-gray-200 p-4">
              <div className="mb-1 font-semibold text-gray-700">{c.label}</div>
              <TrendChart points={pts(c.key)} unit={c.unit} color={c.color} height={120} />
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead><tr><th className="th">التاريخ</th><th className="th">الضغط</th><th className="th">السكر</th><th className="th">النبض</th><th className="th">الحرارة</th><th className="th">O₂</th><th className="th">التنفّس</th><th className="th">الوزن</th><th className="th">ملاحظات</th>{editable && <th className="th"></th>}</tr></thead>
            <tbody>
              {[...rows].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="td">{fmtDate(r.date)}</td>
                  <td className="td">{r.systolic && r.diastolic ? `${r.systolic}/${r.diastolic}` : "—"}</td>
                  <td className="td">{r.glucose ?? "—"}</td>
                  <td className="td">{r.pulse ?? "—"}</td>
                  <td className="td">{r.temp ? `${r.temp}°` : "—"}</td>
                  <td className="td">{r.spo2 ? `${r.spo2}%` : "—"}</td>
                  <td className="td">{r.respRate ?? "—"}</td>
                  <td className="td">{r.weight ?? "—"}</td>
                  <td className="td">{r.notes || "—"}</td>
                  {editable && <td className="td"><form action={w(deleteVitalSign.bind(null, patientId, r.id))}><button className="btn-icon-danger" title="حذف">×</button></form></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Journey({ patient, can, id, role }: any) {
  const stages = patient.careStages ?? [];
  const M: any = {
    WAITING: { label: "بالانتظار", dot: "bg-gray-300", badge: "bg-gray-100 text-gray-600" },
    IN_PROGRESS: { label: "قيد التنفيذ", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700" },
    CONFIRMED: { label: "مؤكّدة", dot: "bg-emerald-600", badge: "bg-emerald-100 text-emerald-700" },
    SKIPPED: { label: "متجاوَزة", dot: "bg-gray-300", badge: "bg-gray-100 text-gray-400" },
  };
  const isOverride = role === "ADMIN" || role === "MANAGER";
  const mayConfirm = (st: any) => can("journey.confirm") && (isOverride || !st.responsibleRole || st.responsibleRole === role);
  const roleLabel = (r: string) => (r ? (ROLE_LABELS as any)[r] ?? r : "أي مخوّل");
  const current = stages.find((s: any) => s.status === "WAITING" || s.status === "IN_PROGRESS");
  const done = stages.filter((s: any) => s.status === "CONFIRMED").length;
  const ROLES = ["RECEPTION", "DATA_ENTRY", "DOCTOR", "RESIDENT", "HEAD_THERAPIST", "LAB", "RADIOLOGY", "PHARMACIST", "THERAPIST", "DRESSING", "PROSTHETICS", "ACCOUNTANT"];

  if (stages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
        <p className="mb-1 text-sm font-medium text-gray-600">لا يوجد مسار متابعة لهذا المراجع بعد.</p>
        <p className="mb-4 text-xs text-gray-400">سلسلة محطّات، كل محطة يؤكّدها الدور المسؤول عنها فقط (الصيدلية ← صيدلي، الفحص ← طبيب...).</p>
        {can("journey.manage") && (
          <form action={startPathway.bind(null, id)}><button className="btn-primary" type="submit">🧭 بدء المسار القياسي</button></form>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="text-sm text-gray-600">التقدّم: <b className="text-gray-800">{done}/{stages.length}</b></div>
        {current ? <span className="badge-brand">المحطة الحالية: {current.station}</span> : <span className="badge-success">اكتمل المسار ✔</span>}
        <a href={`/patients/${id}/journey-print`} target="_blank" className="mr-auto rounded-lg border border-brand-200 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">🖨 طباعة المسار</a>
      </div>
      <ol className="relative border-r-2 border-gray-200 pr-6">
        {stages.map((st: any) => {
          const m = M[st.status] || M.WAITING;
          const allowed = mayConfirm(st);
          return (
            <li key={st.id} className="relative mb-5">
              <span className={`absolute -right-[31px] top-1 h-4 w-4 rounded-full ring-4 ring-white ${m.dot}`} />
              <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-gray-800">{st.station}</div>
                  <div className="flex items-center gap-2">
                    <span className="badge bg-slate-100 text-slate-600">المسؤول: {roleLabel(st.responsibleRole)}</span>
                    <span className={`badge ${m.badge}`}>{m.label}</span>
                  </div>
                </div>
                {st.note && <div className="mt-1 text-xs text-gray-500">{st.note}</div>}
                {st.status === "CONFIRMED" && st.confirmedBy && (
                  <div className="mt-1 text-xs text-emerald-700">✔ أكّدها {st.confirmedBy}{st.confirmedAt ? ` — ${fmtDateTime(st.confirmedAt)}` : ""}</div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {allowed ? (
                    <>
                      {st.status !== "CONFIRMED" && (
                        <>
                          {st.status !== "IN_PROGRESS" && <form action={setStageStatus.bind(null, id, st.id, "IN_PROGRESS")}><button className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">قيد التنفيذ</button></form>}
                          <form action={confirmStage.bind(null, id, st.id)}><button className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">تأكيد ✔</button></form>
                          <form action={setStageStatus.bind(null, id, st.id, "SKIPPED")}><button className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-500 hover:bg-gray-200">تجاوز</button></form>
                        </>
                      )}
                      {st.status === "CONFIRMED" && <form action={setStageStatus.bind(null, id, st.id, "WAITING")}><button className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-500 hover:bg-gray-200">إلغاء التأكيد</button></form>}
                    </>
                  ) : (
                    st.status !== "CONFIRMED" && <span className="text-xs text-gray-400">🔒 بانتظار تأكيد «{roleLabel(st.responsibleRole)}»</span>
                  )}
                  {role === "ADMIN" && <form action={deleteStage.bind(null, id, st.id)}><button className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">حذف</button></form>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {can("journey.manage") && (
        <form action={addStage.bind(null, id)} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-gray-100 p-3">
          <div className="min-w-[150px] flex-1">
            <label className="label">إضافة محطة</label>
            <Combobox name="station" allowFree required options={CENTER_STATION_NAMES} placeholder="مثال: علاج طبيعي" />
          </div>
          <div className="min-w-[130px]">
            <label className="label">الدور المسؤول</label>
            <Combobox name="responsibleRole" allowFree={false} placeholder="أي مخوّل" options={ROLES.map((r:any)=>({value:r,label:(ROLE_LABELS as any)[r]}))} />
          </div>
          <input name="note" className="input min-w-[130px] flex-1" placeholder="ملاحظة (اختياري)" />
          <button className="btn-primary" type="submit">إضافة</button>
        </form>
      )}
    </div>
  );
}

function OfficialDocs({ patient, can, id, role }: any) {
  const docs = patient.officialDocuments ?? [];
  const manage = can("officialdocs.manage");
  return (
    <div className="space-y-4">
      {docs.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-sm text-gray-400">لا توجد إجراءات رسمية مؤرشفة لهذا المراجع.</div>}
      {docs.map((d: any) => (
        <div key={d.id} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge-brand">{(DOC_TYPE as any)[d.docType]}</span>
              <span className={`badge ${d.direction === "OUTGOING" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>{(DOC_DIRECTION as any)[d.direction]}</span>
              <a href={`/official-docs/${d.id}`} className="font-semibold text-brand-700 hover:underline">{d.subject}</a>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>العدد: {d.number}</span><span>•</span><span>{fmtDate(d.docDate)}</span>
            </div>
          </div>
          {d.entity && <div className="mt-1 text-xs text-gray-500">الجهة: {d.entity}</div>}
          {d.body && <div className="mt-1 text-sm text-gray-600">{d.body}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a href={`/official-docs/${d.id}`} className="text-xs font-medium text-brand-600 hover:underline">عرض/طباعة</a>
            {d.attachmentUrl && <a href={d.attachmentUrl} target="_blank" className="text-xs font-medium text-brand-600 hover:underline">📎 عرض المرفق</a>}
            {manage && (
              <details>
                <summary className="cursor-pointer text-xs text-brand-600 hover:underline">✎ تعديل</summary>
                <form action={updateOfficialDocText.bind(null, id, d.id)} className="mt-2 flex flex-wrap items-end gap-2">
                  <input name="subject" className="input min-w-[180px]" defaultValue={d.subject ?? ""} placeholder="الموضوع" />
                  <input name="entity" className="input" defaultValue={d.entity ?? ""} placeholder="الجهة" />
                  <input name="body" className="input min-w-[180px]" defaultValue={d.body ?? ""} placeholder="ملاحظات" />
                  <button className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700" type="submit">حفظ</button>
                </form>
              </details>
            )}
            {role === "ADMIN" && <form action={deleteOfficialDoc.bind(null, id, d.id)}><button className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline">حذف</button></form>}
          </div>
        </div>
      ))}
      {manage && (
        <form action={addOfficialDoc.bind(null, id)} className="grid gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-2">
          <div className="sm:col-span-2 font-medium text-gray-700">إضافة إجراء رسمي</div>
          <div><label className="label">النوع</label><Combobox name="docType" allowFree={false} defaultValue="LETTER" options={Object.entries(DOC_TYPE).map(([value,label]:any)=>({value,label}))} /></div>
          <div><label className="label">الاتجاه</label><Combobox name="direction" allowFree={false} defaultValue="INCOMING" options={Object.entries(DOC_DIRECTION).map(([value,label]:any)=>({value,label}))} /></div>
          <div><label className="label">الرقم <span className="text-red-600">*</span></label><input name="number" className="input" required /></div>
          <div><label className="label">التاريخ <span className="text-red-600">*</span></label><input name="docDate" type="date" className="input" required /></div>
          <div className="sm:col-span-2"><label className="label">الموضوع <span className="text-red-600">*</span></label><input name="subject" className="input" required /></div>
          <div className="sm:col-span-2"><label className="label">الجهة (صادر إلى / وارد من)</label><input name="entity" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">ملاحظات</label><textarea name="body" className="input" rows={2} /></div>
          <div className="sm:col-span-2"><label className="label">مرفق (اختياري)</label><input name="attachment" type="file" className="input" /></div>
          <div className="sm:col-span-2"><button className="btn-primary" type="submit">إضافة للأرشيف</button></div>
        </form>
      )}
    </div>
  );
}

function SickLeaves({ patient, can, id, role, approvals = [], staff = [], staffUsers = [] }: any) {
  const leaves = patient.sickLeaves ?? [];
  const manage = can("sickleave.manage");
  const canApprove = can("reports.approve");
  const canCommittee = can("clinical.metrics"); // اللجنة الطبية
  const apOf = (lid: string) => approvals.find((a: any) => a.refKey === lid);
  const [days, setDays] = useState<number | null>(null);
  const calcDays = (form: HTMLFormElement) => {
    const sd = (form.elements.namedItem("startDate") as HTMLInputElement)?.value;
    const ed = (form.elements.namedItem("endDate") as HTMLInputElement)?.value;
    if (sd && ed && !Number.isNaN(Date.parse(sd)) && !Number.isNaN(Date.parse(ed))) {
      const d = Math.round((Date.parse(ed) - Date.parse(sd)) / 86400000) + 1;
      setDays(d >= 1 ? d : null);
    } else setDays(null);
  };
  const memberDone = (l: any, m: number) => (m === 1 ? l.approved1At : m === 2 ? l.approved2At : l.approved3At);
  const memberName = (l: any, m: number) => (m === 1 ? l.committee1 : m === 2 ? l.committee2 : l.committee3);
  const memberById = (l: any, m: number) => (m === 1 ? l.approved1ById : m === 2 ? l.approved2ById : l.approved3ById);
  const staffName = (uid?: string | null) => staffUsers.find((u: any) => u.id === uid)?.fullName;

  return (
    <div className="space-y-4">
      {/* موعد الفحص القادم */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
        <span className="text-sm font-medium text-gray-700">🗓 موعد الفحص القادم:</span>
        <b className="text-brand-700">{patient.nextCheckupAt ? fmtDate(patient.nextCheckupAt) : "غير محدّد"}</b>
        {can("appointments.edit") && (
          <form action={setNextCheckup.bind(null, id)} className="flex items-center gap-2">
            <input name="nextCheckupAt" type="date" className="input !py-1 text-sm" defaultValue={patient.nextCheckupAt ? new Date(patient.nextCheckupAt).toISOString().slice(0, 10) : ""} />
            <button className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700" type="submit">تحديد</button>
          </form>
        )}
      </div>

      {leaves.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-sm text-gray-400">لا توجد إجازات مرضية.</div>}
      {leaves.map((l: any) => {
        const ap = apOf(l.id);
        const committeeCount = [1, 2, 3].filter((m) => memberDone(l, m)).length;
        const committeeTotal = [1, 2, 3].filter((m) => memberName(l, m)).length;
        const committeeComplete = committeeTotal === 0 || committeeCount === committeeTotal;
        const managerComplete = !l.needsManagerApproval || Boolean(ap);
        const complete = committeeComplete && managerComplete;
        return (
          <div key={l.id} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge-brand">{l.days} يوم</span>
                <span className="font-semibold text-gray-800">{fmtDate(l.startDate)} ← {fmtDate(l.endDate)}</span>
                {complete ? <span className="badge-success">مكتملة ✔</span> : <span className="badge-warning">غير مكتملة</span>}
                {ap ? <span className="badge-success">اعتماد مدير ✔</span> : l.needsManagerApproval ? <span className="badge-warning">بانتظار المدير</span> : <span className="badge-info">لا تحتاج مدير</span>}
                {committeeTotal > 0 && <span className={committeeCount === committeeTotal ? "badge-success" : "badge-warning"}>لجنة {committeeCount}/{committeeTotal}</span>}
              </div>
              <div className="text-xs text-gray-400">{l.number ? `رقم ${l.number} • ` : ""}الطبيب: {l.doctorName ?? "—"}</div>
            </div>
            <div className="mt-1 text-sm text-gray-600">التشخيص: {l.diagnosisText}</div>
            {l.notes && <div className="mt-1 text-xs text-gray-500">{l.notes}</div>}

            {/* لجنة المصادقة */}
            {committeeTotal > 0 && (
              <div className="mt-2 space-y-1 rounded-lg border border-gray-100 bg-gray-50 p-2">
                <div className="text-xs font-medium text-gray-600">لجنة المصادقة الطبية</div>
                {[1, 2, 3].map((m) => {
                  const nm = memberName(l, m);
                  if (!nm) return null;
                  const done = memberDone(l, m);
                  const by = staffName(memberById(l, m));
                  return (
                    <div key={m} className="flex items-center justify-between text-sm">
                      <span className={done ? "text-emerald-700" : "text-gray-700"}>{done ? "✔ " : "○ "}{nm}{done ? ` — ${by ? `اعتمدها ${by} — ` : ""}${fmtDateTime(done)}` : ""}</span>
                      {canCommittee && (done
                        ? <form action={unapproveSickLeaveCommittee.bind(null, id, l.id, m)}><button className="text-xs text-gray-400 hover:underline">تراجع</button></form>
                        : <form action={approveSickLeaveCommittee.bind(null, id, l.id, m)}><button className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700">مصادقة</button></form>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {ap && <div className="mt-1 text-xs text-emerald-700">✔ اعتمدها المدير {ap.approvedBy}{ap.title ? ` (${ap.title})` : ""} — {fmtDateTime(ap.approvedAt)}</div>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a href={`/patients/${id}/sick-leave/${l.id}`} target="_blank" className="rounded bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">🖨 شهادة</a>
              <a href={`/patients/${id}/sick-leave/${l.id}/official`} target="_blank" className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">📄 نموذج رسمي</a>
              {canApprove && l.needsManagerApproval && !ap && committeeComplete && (
                <form action={approveSickLeave.bind(null, id, l.id)} className="flex items-center gap-1">
                  <input name="title" className="input !py-1 text-xs" placeholder="الصفة (مدير المركز)" />
                  <button className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">اعتماد المدير ✔</button>
                </form>
              )}
              {canApprove && l.needsManagerApproval && !ap && !committeeComplete && <span className="text-xs text-amber-700">أكمل مصادقة اللجنة قبل اعتماد المدير</span>}
              {canApprove && ap && <form action={unapproveSickLeave.bind(null, id, l.id)}><button className="text-xs text-gray-400 hover:underline">إلغاء الاعتماد</button></form>}
              {role === "ADMIN" && <form action={deleteSickLeave.bind(null, id, l.id)}><button className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline">حذف</button></form>}
            </div>
          </div>
        );
      })}

      {manage && (
        <form action={addSickLeave.bind(null, id)} onChange={(e) => calcDays(e.currentTarget)} className="grid gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-2">
          <div className="sm:col-span-2 font-medium text-gray-700">إصدار إجازة مرضية</div>
          <div><label className="label">من <span className="text-red-600">*</span></label><input name="startDate" type="date" className="input" required /></div>
          <div><label className="label">إلى <span className="text-red-600">*</span></label><input name="endDate" type="date" className="input" required /></div>
          {days !== null && <div className="sm:col-span-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">عدد الأيام: <b>{days}</b> يوم</div>}
          <div><label className="label">الرقم الرسمي</label><input name="number" className="input" placeholder="رقم مرجعي للتوثيق" /></div>
          <div><label className="label">الطبيب الموصي</label><input name="doctorName" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">التشخيص المستند إليه <span className="text-red-600">*</span></label><input name="diagnosisText" className="input" required /></div>

          {/* لجنة المصادقة */}
          <div className="sm:col-span-2 mt-1 rounded-lg border border-gray-100 bg-gray-50 p-2">
            <div className="mb-2 text-xs font-medium text-gray-600">لجنة المصادقة الطبية (3 أطباء) — اختياري</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Combobox name="committee1" allowFree options={staff} placeholder="العضو الأول" />
              <Combobox name="committee2" allowFree options={staff} placeholder="العضو الثاني" />
              <Combobox name="committee3" allowFree options={staff} placeholder="العضو الثالث" />
            </div>
          </div>

          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700">
            <input type="hidden" name="needsManagerApproval" value="0" />
            <input type="checkbox" name="needsManagerApproval" value="1" defaultChecked className="h-4 w-4 accent-brand-600" />
            تحتاج اعتماد المدير (فوق مصادقة اللجنة)
          </label>

          <details className="sm:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-2">
            <summary className="cursor-pointer text-xs font-medium text-gray-600">📄 بيانات النموذج الرسمي (اختياري — للطباعة الرسمية)</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div><label className="label">العدد الرسمي</label><input name="officialNumber" className="input" placeholder="عدد كتاب المخاطبة" /></div>
              <div><label className="label">تاريخ الكتاب</label><input name="officialDate" type="date" className="input" /></div>
              <div><label className="label">المديرية/التشكيل</label><input name="directorate" className="input" placeholder="المنسوب إليه" /></div>
              <div><label className="label">اختصاص الطبيب</label><input name="doctorSpecialty" className="input" /></div>
              <div><label className="label">رقم كتاب الإرسال</label><input name="sendBookNumber" className="input" /></div>
              <div><label className="label">تاريخ كتاب الإرسال</label><input name="sendBookDate" className="input" placeholder="/ / 2026" /></div>
              <div className="sm:col-span-2"><label className="label">الصادر من (جهة كتاب الإرسال)</label><input name="sendBookFrom" className="input" /></div>
            </div>
          </details>

          <div className="sm:col-span-2"><label className="label">ملاحظات</label><input name="notes" className="input" /></div>
          <div className="sm:col-span-2"><button className="btn-primary" type="submit">إصدار الإجازة</button></div>
        </form>
      )}
    </div>
  );
}
