"use client";
import { useState } from "react";

export function Zoom({ src, alt = "", className = "" }: { src: string; alt?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <img src={src} alt={alt} onClick={() => setOpen(true)} className={`cursor-zoom-in transition hover:opacity-90 ${className}`} />
      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onClick={() => setOpen(false)}>
          <img src={src} alt={alt} className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <button className="absolute right-5 top-4 text-4xl leading-none text-white/90 hover:text-white" onClick={() => setOpen(false)} title="إغلاق">×</button>
        </div>
      )}
    </>
  );
}
