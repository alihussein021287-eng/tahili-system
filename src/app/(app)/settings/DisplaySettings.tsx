"use client";
import { useActionState } from "react";
import { createDisplayDevice, generateDisplayPairingCode, revokeDisplayDevice, updateDisplayDevice, type PairCodeState } from "./display-actions";

type Center = { id: number; name: string };
type Hall = { id: number; name: string };
type Device = {
  id: string; name: string; centerId: number | null; halls: string[]; status: string; nameMode: string;
  callDisplaySeconds: number; lastSeenAt: string | Date | null; center: Center | null;
};

const STATUS: Record<string, string> = { UNPAIRED: "غير مرتبطة", PAIRING: "بانتظار الاقتران", ACTIVE: "متصلة", REVOKED: "ملغاة" };

function Fields({ device, centers, halls }: { device?: Device; centers: Center[]; halls: Hall[] }) {
  return <>
    <label className="label">اسم الشاشة<input name="name" required maxLength={80} className="input mt-1" defaultValue={device?.name ?? ""} placeholder="مثال: شاشة الاستقبال" /></label>
    <label className="label">المركز<select name="centerId" className="input mt-1" defaultValue={device?.centerId ?? ""}><option value="">كل المراكز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
    <label className="label">وضع عرض الاسم<select name="nameMode" className="input mt-1" defaultValue={device?.nameMode ?? "INITIALS"}><option value="INITIALS">الاسم الأول مع الأحرف الأولى</option><option value="FULL">الاسم الكامل</option><option value="QUEUE_NUMBER">رقم انتظار فقط</option></select></label>
    <label className="label">مدة بقاء المناداة (ثانية)<input name="callDisplaySeconds" type="number" min={10} max={300} className="input mt-1" defaultValue={device?.callDisplaySeconds ?? 45} /></label>
    <fieldset className="md:col-span-2"><legend className="label">القاعة أو مجموعة القاعات</legend><div className="flex flex-wrap gap-3 rounded-xl bg-gray-50 p-3">{halls.map((hall) => <label key={hall.id} className="text-sm text-gray-700"><input type="checkbox" name="halls" value={hall.name} defaultChecked={device?.halls.includes(hall.name)} /> {hall.name}</label>)}{halls.length === 0 && <span className="text-sm text-gray-400">لا توجد قاعات علاجية فعالة؛ ستعرض الشاشة كل القاعات.</span>}</div></fieldset>
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

export function DisplaySettings({ devices, centers, halls }: { devices: Device[]; centers: Center[]; halls: Hall[] }) {
  const date = (value: Device["lastSeenAt"]) => value ? new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }).format(new Date(value)) : "لم تتصل";
  return <section id="شاشات الانتظار" className="card p-5">
    <div className="mb-4"><h2 className="text-lg font-semibold text-gray-800">شاشات الانتظار</h2><p className="text-sm text-gray-500">اعتماد مستقل ومحدود لقراءة طابور العرض فقط. إنشاء رمز جديد يلغي الاعتماد السابق.</p></div>
    <form action={createDisplayDevice} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-2">
      <Fields centers={centers} halls={halls} />
      <div className="md:col-span-2"><button className="btn-primary">إضافة شاشة</button></div>
    </form>
    <div className="mt-5 space-y-4">
      {devices.map((device) => <article key={device.id} className="rounded-2xl border border-gray-200 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-gray-800">{device.name}</h3><p className="text-xs text-gray-500">{device.center?.name ?? "كل المراكز"} · آخر اتصال: {date(device.lastSeenAt)}</p></div><span className={`badge ${device.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : device.status === "REVOKED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{STATUS[device.status] ?? device.status}</span></div>
        <form action={updateDisplayDevice.bind(null, device.id)} className="grid gap-3 md:grid-cols-2"><Fields device={device} centers={centers} halls={halls} /><div className="md:col-span-2"><button className="btn-ghost" type="submit">حفظ إعدادات الشاشة</button></div></form>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"><PairingControl deviceId={device.id} /><form action={revokeDisplayDevice.bind(null, device.id)} className="self-end"><button className="btn-danger" type="submit">إلغاء اعتماد الشاشة</button></form></div>
      </article>)}
      {devices.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">لا توجد شاشات مسجلة.</div>}
    </div>
  </section>;
}
