"use client";
import { useActionState, useMemo, useState } from "react";
import { createDisplayDevice, deleteDisplayDevice, generateDisplayPairingCode, revokeDisplayDevice, updateDisplayDevice, type PairCodeState } from "./display-actions";
import type { CenterHallOption } from "@/lib/center-halls";

type Center = { id: number; name: string };
type Device = {
  id: string; name: string; centerId: number | null; halls: string[]; status: string; nameMode: string;
  callDisplaySeconds: number; lastSeenAt: string | Date | null; center: Center | null;
};

const STATUS: Record<string, string> = { UNPAIRED: "غير مرتبطة", PAIRING: "بانتظار الاقتران", ACTIVE: "متصلة", REVOKED: "ملغاة" };

function Fields({ device, centers, centerHalls }: { device?: Device; centers: Center[]; centerHalls: CenterHallOption[] }) {
  const [centerId, setCenterId] = useState(device?.centerId ? String(device.centerId) : "");
  const visibleHalls = useMemo(() => {
    const rows = centerId ? centerHalls.filter((hall) => String(hall.centerId) === centerId) : centerHalls;
    return Array.from(new Map(rows.filter((hall) => hall.active && hall.status === "AVAILABLE").map((hall) => [hall.hallName, hall])).values());
  }, [centerHalls, centerId]);
  return <>
    <label className="label">اسم الشاشة<input name="name" required maxLength={80} className="input mt-1" defaultValue={device?.name ?? ""} placeholder="مثال: شاشة الاستقبال" /></label>
    <label className="label">المركز<select name="centerId" className="input mt-1" value={centerId} onChange={(event) => setCenterId(event.target.value)}><option value="">كل المراكز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
    <label className="label">وضع عرض الاسم<select name="nameMode" className="input mt-1" defaultValue={device?.nameMode ?? "INITIALS"}><option value="INITIALS">الاسم الأول مع الأحرف الأولى</option><option value="FULL">الاسم الكامل</option><option value="QUEUE_NUMBER">رقم انتظار فقط</option></select></label>
    <label className="label">مدة بقاء المناداة (ثانية)<input name="callDisplaySeconds" type="number" min={10} max={300} className="input mt-1" defaultValue={device?.callDisplaySeconds ?? 45} /></label>
    <fieldset className="md:col-span-2"><legend className="label">القاعة أو مجموعة القاعات</legend><p className="mb-2 text-xs text-gray-500">اتركها دون تحديد لعرض جميع القاعات.</p><div className="flex max-h-40 flex-wrap gap-3 overflow-y-auto rounded-xl bg-gray-50 p-3">{visibleHalls.map((hall) => <label key={`${hall.centerId}-${hall.resourceId}`} className="text-sm text-gray-700"><input type="checkbox" name="halls" value={hall.hallName} defaultChecked={device?.halls.includes(hall.hallName)} /> {hall.hallName}</label>)}</div></fieldset>
  </>;
}

function PairingControl({ deviceId }: { deviceId: string }) {
  const action = generateDisplayPairingCode.bind(null, deviceId);
  const [state, submit, pending] = useActionState<PairCodeState, FormData>(action, {});
  return <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/50 p-3">
    <form action={submit}><button type="submit" disabled={pending} className="btn-primary btn-sm">{pending ? "جارٍ الإنشاء…" : "إنشاء رمز اقتران مؤقت"}</button></form>
    {state.code && <div className="mt-3"><div className="text-xs text-gray-500">صالح لعشر دقائق ويظهر مرة واحدة</div><div dir="ltr" className="mt-1 select-all font-mono text-2xl font-bold tracking-[.25em] text-brand-800">{state.code}</div></div>}
    {state.error && <div className="mt-2 text-sm text-red-600">{state.error}</div>}
  </div>;
}

export function DisplaySettings({ devices, centers, centerHalls }: { devices: Device[]; centers: Center[]; centerHalls: CenterHallOption[] }) {
  const date = (value: Device["lastSeenAt"]) => value ? new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }).format(new Date(value)) : "لم تتصل";
  return <section id="شاشات الانتظار" className="card p-5">
    <div className="mb-4"><h2 className="text-lg font-semibold text-gray-800">شاشات الانتظار</h2><p className="text-sm text-gray-500">اعتماد مستقل ومحدود لقراءة طابور العرض فقط. إنشاء رمز جديد يلغي الاعتماد السابق.</p></div>
    <details className="rounded-xl border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 font-medium text-brand-700">إضافة شاشة جديدة</summary>
      <form action={createDisplayDevice} className="grid gap-3 border-t p-4 md:grid-cols-2"><Fields centers={centers} centerHalls={centerHalls} /><div className="md:col-span-2"><button className="btn-primary">إضافة شاشة</button></div></form>
    </details>
    <div className="mt-5 space-y-4">
      {devices.map((device) => <article key={device.id} className="rounded-2xl border border-gray-200 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-gray-800">{device.name}</h3><p className="text-xs text-gray-500">{device.center?.name ?? "كل المراكز"} · آخر اتصال: {date(device.lastSeenAt)}</p></div><span className={`badge ${device.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : device.status === "REVOKED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{STATUS[device.status] ?? device.status}</span></div>
        <p className="mb-3 text-xs text-gray-500">{device.halls.length ? device.halls.join("، ") : "كل القاعات"}</p>
        <details className="rounded-xl border bg-gray-50"><summary className="cursor-pointer px-3 py-2 text-sm font-medium">تعديل الإعدادات</summary><form action={updateDisplayDevice.bind(null, device.id)} className="grid gap-3 border-t p-3 md:grid-cols-2"><Fields device={device} centers={centers} centerHalls={centerHalls} /><div className="md:col-span-2"><button className="btn-ghost" type="submit">حفظ إعدادات الشاشة</button></div></form></details>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]"><PairingControl deviceId={device.id} /><div className="flex flex-wrap items-end gap-2"><form action={revokeDisplayDevice.bind(null, device.id)}><button className="btn-danger" type="submit">إلغاء الاعتماد</button></form><form action={deleteDisplayDevice.bind(null, device.id)} onSubmit={(event) => { if (!window.confirm("حذف الشاشة نهائياً؟ سيتوقف اعتمادها فوراً.")) event.preventDefault(); }}><button className="btn-danger" type="submit">حذف الشاشة</button></form></div></div>
      </article>)}
      {devices.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">لا توجد شاشات مسجلة.</div>}
    </div>
  </section>;
}
