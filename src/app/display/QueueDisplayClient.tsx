"use client";
import { useEffect, useRef, useState } from "react";

type Item = { id: string; name: string; hall?: string | null; time: string };
type Data = { called: Item[]; inSession: Item[]; waiting: Item[] };

function playBeep(ctx: any) {
  try {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.18;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    o.frequency.setValueAtTime(1175, ctx.currentTime + 0.18);
    o.frequency.setValueAtTime(880, ctx.currentTime + 0.36);
    o.stop(ctx.currentTime + 0.6);
  } catch {}
}

export default function QueueDisplayClient() {
  const [data, setData] = useState<Data>({ called: [], inSession: [], waiting: [] });
  const [clock, setClock] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<any>(null);
  const prev = useRef<string>("");
  const first = useRef(true);

  function enableSound() {
    try {
      const C = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!C) return;
      const ctx = audioRef.current ?? new C();
      audioRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume();
      playBeep(ctx);
      setSoundOn(true);
    } catch {}
  }

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/queue/today", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d: Data = await r.json();
        const ids = d.called.map((c) => c.id).join(",");
        if (!first.current && ids && ids !== prev.current && audioRef.current) playBeep(audioRef.current);
        prev.current = ids; first.current = false;
        setData(d);
      } catch {}
    }
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    const fmt = () => new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Baghdad" }).format(new Date());
    setClock(fmt());
    const t = setInterval(() => setClock(fmt()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-brand-900 to-brand-700 p-10 text-white">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-4xl font-extrabold">شاشة الانتظار</h1>
        <div className="flex items-center gap-4">
          {!soundOn && (
            <button onClick={enableSound} className="animate-pulse rounded-2xl bg-amber-400 px-6 py-3 text-xl font-bold text-amber-950 shadow-lg hover:bg-amber-300">
              🔊 تفعيل الصوت
            </button>
          )}
          {soundOn && <span className="rounded-xl bg-white/10 px-4 py-2 text-lg text-brand-100">🔊 الصوت مُفعّل</span>}
          <div className="text-left">
            <div className="text-2xl font-bold text-brand-100">المجمع التأهيلي الطبي</div>
            <div className="text-3xl font-mono tabular-nums text-white/80">{clock}</div>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-3xl bg-white/10 p-8 text-center shadow-xl">
        <div className="mb-5 text-2xl tracking-wide text-brand-100">تتم الآن مناداة</div>
        {data.called.length === 0 && <div className="py-6 text-4xl text-white/50">— لا يوجد —</div>}
        <div className="flex flex-wrap justify-center gap-6">
          {data.called.map((e) => (
            <div key={e.id} className="animate-pulse rounded-2xl bg-white px-12 py-7 text-center shadow-lg">
              <div className="text-6xl font-extrabold text-brand-900">{e.name}</div>
              {e.hall && <div className="mt-2 text-3xl font-bold text-brand-600">← {e.hall}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-3xl bg-white/5 p-6">
          <div className="mb-4 text-2xl font-bold text-amber-200">داخل الجلسة ({data.inSession.length})</div>
          <div className="space-y-3">
            {data.inSession.length === 0 && <div className="text-2xl text-white/40">—</div>}
            {data.inSession.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/10 px-6 py-4">
                <span className="text-3xl font-semibold">{e.name}</span>
                {e.hall && <span className="shrink-0 rounded-lg bg-amber-400/20 px-3 py-1 text-xl font-medium text-amber-100">{e.hall.replace("قاعة ", "")}</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl bg-white/5 p-6">
          <div className="mb-4 text-2xl font-bold text-brand-100">القادمون ({data.waiting.length})</div>
          <div className="space-y-3">
            {data.waiting.length === 0 && <div className="text-2xl text-white/40">—</div>}
            {data.waiting.map((e, i) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/10 px-6 py-4 text-3xl">
                <span className="font-semibold">{e.name}</span>
                <span className="flex items-center gap-3">
                  {e.hall && <span className="rounded-lg bg-brand-400/20 px-3 py-1 text-xl font-medium text-brand-50">{e.hall.replace("قاعة ", "")}</span>}
                  <span className="text-xl text-white/50">#{i + 1} — {e.time}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 text-center text-lg text-white/40">يتم التحديث تلقائياً</div>
    </div>
  );
}
