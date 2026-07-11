"use client";
import React from "react";

type Pt = { label: string; value: number };

export function TrendChart({ points, color = "#0f766e", unit = "", height = 140 }: { points: Pt[]; color?: string; unit?: string; height?: number }) {
  const pts = (points || []).filter((p) => typeof p.value === "number" && !isNaN(p.value));
  if (pts.length === 0) return <div className="py-6 text-center text-sm text-gray-400">لا توجد بيانات كافية للرسم.</div>;

  const W = 600, H = height, padX = 38, padY = 18;
  const ys = pts.map((p) => p.value);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  const innerW = W - padX * 2, innerH = H - padY * 2;
  const x = (i: number) => padX + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y = (v: number) => padY + innerH - ((v - min) / range) * innerH;

  const line = pts.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `${padX},${padY + innerH} ${line} ${padX + innerW},${padY + innerH}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {/* خطوط شبكية */}
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={padX} x2={padX + innerW} y1={padY + innerH * t} y2={padY + innerH * t} stroke="#eef2f1" strokeWidth={1} />
      ))}
      {/* قيم المحور */}
      <text x={padX - 6} y={padY + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{max.toFixed(0)}</text>
      <text x={padX - 6} y={padY + innerH + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{min.toFixed(0)}</text>
      {/* المساحة */}
      <polygon points={area} fill={color} opacity={0.08} />
      {/* الخط */}
      <polyline points={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* النقاط + القيمة */}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={3.5} fill="#fff" stroke={color} strokeWidth={2} />
          {(i === 0 || i === pts.length - 1 || pts.length <= 6) && (
            <text x={x(i)} y={y(p.value) - 8} textAnchor="middle" fontSize="10" fill={color} fontWeight="600">{p.value}{unit}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
