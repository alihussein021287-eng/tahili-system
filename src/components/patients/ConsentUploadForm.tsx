"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ConsentUploadForm({ patientId }: { patientId: string }) {
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false); const router = useRouter();
  return <form className="grid gap-3 md:grid-cols-2" onSubmit={async event => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setMessage("");
    try { const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/consents`, { method: "POST", body: data });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "تعذر التسجيل");
      form.reset(); setMessage("حُفظت الموافقة الموقعة ودليلها"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر التسجيل"); } finally { setBusy(false); }
  }}>
    <label className="label">الإجراء المعني / مرجعه<input className="input mt-1" name="procedure" maxLength={300} required /></label>
    <label className="label">رمز مستند الموافقة<input className="input mt-1" name="documentCode" maxLength={300} required /></label>
    <label className="label">إصدار المستند<input className="input mt-1" name="documentVersion" maxLength={300} required /></label>
    <label className="label">اسم الموقّع<input className="input mt-1" name="signerName" maxLength={300} required /></label>
    <label className="label">صفة الموقّع<select className="input mt-1" name="signerCapacity"><option value="PATIENT">المراجع نفسه</option><option value="GUARDIAN">ولي / وصي</option><option value="REPRESENTATIVE">ممثل مخول</option></select></label>
    <label className="label">سند الصفة عند التمثيل<input className="input mt-1" name="representationBasis" maxLength={1000} /></label>
    <label className="label">تاريخ التوقيع<input className="input mt-1" name="signedAt" type="date" max={new Date().toISOString().slice(0, 10)} required /></label>
    <label className="label">النموذج الموقع — PDF/PNG/JPEG، حتى 20MB<input className="input mt-1" name="signedFile" type="file" accept="application/pdf,image/png,image/jpeg" required /></label>
    <label className="flex min-h-11 items-center gap-2 md:col-span-2"><input type="checkbox" name="attestedSigned" value="1" required />أؤكد أن الدليل المرفق نموذج موقع فعلاً، وأن بيانات الموقّع مطابقة له.</label>
    <p className="text-sm md:col-span-2">هذا حفظ لدليل موقع، وليس شهادة توقيع إلكتروني قانوني. النسخة الجديدة تُسجل مستقلة ولا تستبدل السابقة.</p>
    <div><button className="btn-primary" disabled={busy}>{busy ? "جارٍ الفحص والحفظ…" : "تسجيل الموافقة الموقعة"}</button></div><p role="status" className="text-sm md:col-span-2">{message}</p>
  </form>;
}
