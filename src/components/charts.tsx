import React from "react";

const PALETTE = ["#0f766e", "#2a9489", "#d99512", "#1687ad", "#7c65bd", "#d74a55", "#2b9b61", "#536fc4"];

export function BarChart({ data, height = 160 }: { data: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  const bw = 100 / n;
  return (
    <div dir="ltr">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: "100%", height }}>
        {data.map((d, i) => {
          const h = (d.value / max) * 52;
          return (
            <rect key={i} x={i * bw + bw * 0.18} y={56 - h} width={bw * 0.64} height={h} fill="var(--color-brand-text)" rx="0.6">
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-gray-400">
        {data.map((d, i) => <div key={i} className="text-center" style={{ width: `${bw}%` }}>{d.label}</div>)}
      </div>
    </div>
  );
}

export function Donut({ data, size = 150 }: { data: { label: string; value: number }[]; size?: number }) {
  const realTotal = data.reduce((a, b) => a + b.value, 0);
  const total = realTotal || 1;
  const r = 60, c = 2 * Math.PI * r;
  let offset = 0;
  if (realTotal === 0) return <p className="py-8 text-center text-sm text-gray-400">لا توجد بيانات.</p>;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 160 160" style={{ width: size, height: size }}>
        <g transform="rotate(-90 80 80)">
          <circle cx="80" cy="80" r={r} fill="none" stroke="var(--chart-grid)" strokeWidth="22" />
          {data.map((d, i) => {
            const dash = (d.value / total) * c;
            const seg = (
              <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={PALETTE[i % PALETTE.length]}
                strokeWidth="22" strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset}>
                <title>{`${d.label}: ${d.value}`}</title>
              </circle>
            );
            offset += dash;
            return seg;
          })}
        </g>
        <text x="80" y="86" textAnchor="middle" className="fill-gray-700" style={{ fontSize: 22, fontWeight: 700 }}>{realTotal}</text>
      </svg>
      <div className="space-y-1 text-sm">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="text-gray-600">{d.label}</span>
            <span className="font-medium text-gray-800">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex justify-between text-sm"><span>{d.label}</span><span className="font-medium">{d.value}</span></div>
          <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
      {data.length === 0 && <p className="text-sm text-gray-400">لا توجد بيانات.</p>}
    </div>
  );
}
