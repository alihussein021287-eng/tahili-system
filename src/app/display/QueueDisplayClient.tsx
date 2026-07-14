"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Item = { id: string; name: string; hall: string | null; time: string; queueNumber: number; eventId?: string };
type Data = {
  device: { id: string; name: string; centerName: string; callDisplaySeconds: number };
  called: Item | null; inSession: Item[]; waiting: Item[]; inSessionTotal: number; waitingTotal: number; updatedAt: string;
};

function playCall(ctx: AudioContext) {
  const notes = [880, 1175, 880];
  notes.forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine"; oscillator.frequency.value = frequency; gain.gain.value = 0.16;
    oscillator.connect(gain); gain.connect(ctx.destination);
    oscillator.start(ctx.currentTime + index * 0.2); oscillator.stop(ctx.currentTime + index * 0.2 + 0.17);
  });
}

export default function QueueDisplayClient({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [started, setStarted] = useState(false);
  const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState(new Date());
  const [cursorHidden, setCursorHidden] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const alive = useRef(true);
  const firstLoad = useRef(true);
  const lastSuccess = useRef(Date.now());
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callKey = `tahili-display-last-call:${deviceId}`;

  const load = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch("/api/display/feed", { cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) { window.location.reload(); return; }
      if (!response.ok) throw new Error("display feed unavailable");
      const next = await response.json() as Data;
      if (!alive.current) return;
      const eventId = next.called?.eventId ?? "";
      const previous = localStorage.getItem(callKey) ?? "";
      if (firstLoad.current) {
        if (eventId) localStorage.setItem(callKey, eventId);
        firstLoad.current = false;
      } else if (eventId && eventId !== previous) {
        localStorage.setItem(callKey, eventId);
        if (started && audio.current) playCall(audio.current);
      }
      setData(next); setConnected(true); lastSuccess.current = Date.now();
    } catch {
      if (alive.current) setConnected(false);
    } finally {
      clearTimeout(timeout);
    }
  }, [callKey, started]);

  useEffect(() => {
    alive.current = true; void load();
    const poll = setInterval(() => void load(), 5_000);
    const watchdog = setInterval(() => { if (Date.now() - lastSuccess.current > 10 * 60_000) window.location.reload(); }, 60_000);
    return () => { alive.current = false; clearInterval(poll); clearInterval(watchdog); };
  }, [load]);

  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 1_000); return () => clearInterval(timer); }, []);

  useEffect(() => {
    const activity = () => {
      setCursorHidden(false);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => setCursorHidden(true), 3_000);
    };
    activity(); window.addEventListener("mousemove", activity); window.addEventListener("touchstart", activity);
    return () => { window.removeEventListener("mousemove", activity); window.removeEventListener("touchstart", activity); if (cursorTimer.current) clearTimeout(cursorTimer.current); };
  }, []);

  async function start() {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) { audio.current = audio.current ?? new Ctx(); await audio.current.resume(); }
      await document.documentElement.requestFullscreen?.();
    } catch {}
    setStarted(true);
  }

  const time = new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Baghdad" }).format(clock);
  const date = new Intl.DateTimeFormat("ar-IQ", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Baghdad" }).format(clock);
  const lastUpdate = data?.updatedAt ? new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Baghdad" }).format(new Date(data.updatedAt)) : "—";

  if (!started) return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white" dir="rtl"><div className="max-w-xl text-center"><div className="text-7xl">📺</div><h1 className="mt-5 text-4xl font-black">{deviceName}</h1><p className="mt-3 text-lg text-slate-300">ابدأ العرض لتفعيل صوت المناداة ومحاولة ملء الشاشة.</p><button onClick={start} className="mt-8 rounded-2xl bg-teal-400 px-8 py-4 text-2xl font-black text-slate-950 shadow-xl hover:bg-teal-300">تشغيل شاشة الانتظار</button></div></main>;

  return <main className={`h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-teal-950 to-slate-900 p-[clamp(1rem,2vw,3rem)] text-white ${cursorHidden ? "cursor-none" : ""}`} dir="rtl">
    <header className="flex h-[12%] items-start justify-between gap-6">
      <div><h1 className="text-[clamp(1.6rem,3vw,4rem)] font-black">{data?.device.centerName || deviceName}</h1><p className="text-[clamp(.9rem,1.3vw,1.5rem)] text-teal-100/70">{deviceName}</p></div>
      <div className="text-left"><div dir="ltr" className="font-mono text-[clamp(2rem,4vw,5rem)] font-black tabular-nums">{time}</div><div className="text-[clamp(.8rem,1.3vw,1.4rem)] text-slate-300">{date}</div></div>
    </header>

    <section className="flex h-[47%] flex-col items-center justify-center rounded-[2rem] border border-white/10 bg-white/10 px-6 text-center shadow-2xl">
      <div className="text-[clamp(1rem,1.6vw,2rem)] font-bold text-teal-200">تتم الآن مناداة</div>
      {data?.called ? <><div className="mt-3 max-w-full truncate text-[clamp(3rem,7vw,8rem)] font-black leading-tight">{data.called.name}</div><div className="mt-4 rounded-2xl bg-amber-300 px-[clamp(1rem,3vw,3rem)] py-3 text-[clamp(1.5rem,3vw,3.5rem)] font-black text-slate-950">← {data.called.hall || "يرجى التوجه إلى الاستقبال"}</div></> : <div className="mt-6 text-[clamp(2rem,4vw,5rem)] font-bold text-white/30">بانتظار المناداة</div>}
    </section>

    <section className="grid h-[35%] grid-cols-2 gap-[clamp(.75rem,1.5vw,2rem)] pt-[clamp(.75rem,1.5vw,2rem)]">
      <QueueList title="داخل الجلسة" items={data?.inSession ?? []} total={data?.inSessionTotal ?? 0} tone="amber" />
      <QueueList title="قائمة الانتظار" items={data?.waiting ?? []} total={data?.waitingTotal ?? 0} tone="teal" />
    </section>

    <footer className="flex h-[6%] items-end justify-between text-[clamp(.7rem,1vw,1rem)] text-white/45"><span className={connected ? "" : "rounded-full bg-amber-300/15 px-3 py-1 text-amber-200"}>{connected ? "متصل" : "إعادة الاتصال…"}</span><span>آخر تحديث: {lastUpdate}</span></footer>
  </main>;
}

function QueueList({ title, items, total, tone }: { title: string; items: Item[]; total: number; tone: "amber" | "teal" }) {
  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const [page, setPage] = useState(0);
  useEffect(() => { setPage((current) => Math.min(current, pageCount - 1)); }, [pageCount]);
  useEffect(() => {
    if (pageCount < 2) return;
    const timer = setInterval(() => setPage((current) => (current + 1) % pageCount), 7_000);
    return () => clearInterval(timer);
  }, [pageCount]);
  const visible = items.slice(page * pageSize, page * pageSize + pageSize);
  const first = total ? page * pageSize + 1 : 0;
  const last = Math.min((page + 1) * pageSize, total);
  return <div className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-[clamp(.75rem,1.3vw,1.5rem)]"><div className="mb-2 flex items-center justify-between gap-2"><h2 className={`text-[clamp(1rem,1.6vw,2rem)] font-black ${tone === "amber" ? "text-amber-200" : "text-teal-200"}`}>{title} <span className="text-white/40">({total})</span></h2>{total > pageSize && <span className="shrink-0 text-[clamp(.65rem,.9vw,1rem)] text-white/55">{first}–{last} من {total}</span>}</div><div className="grid gap-2">{visible.map((item) => <div key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-white/10 px-4 py-2 text-[clamp(.9rem,1.35vw,1.7rem)]"><span className="min-w-0 truncate font-bold">{item.name}</span><span className="shrink-0 text-[.75em] text-white/60">{item.hall ?? item.time}</span></div>)}{items.length === 0 && <div className="py-8 text-center text-2xl text-white/20">—</div>}</div></div>;
}
