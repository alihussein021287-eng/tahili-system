"use client";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button with a «saving» state.
 *
 * Now and then the browser gets the server's answer to a save but never applies it, and the button
 * stays on «جارٍ الحفظ...» although the record was saved. The button watches for the server's answer
 * to this page's save request; if the screen is still waiting two seconds after that answer arrived,
 * the page is reloaded once so the user sees the saved result instead of pressing save again.
 */
export function SubmitButton({ children = "حفظ", className = "btn-primary" }: { children?: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  const [slow, setSlow] = useState(false);
  const reloaded = useRef(false);

  useEffect(() => {
    if (!pending) { setSlow(false); return; }
    const slowTimer = window.setTimeout(() => setSlow(true), 8_000);
    if (typeof PerformanceObserver === "undefined") return () => window.clearTimeout(slowTimer);
    const started = performance.now();
    const href = window.location.href;
    let answeredAt = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (entry.initiatorType === "fetch" && entry.name === href && entry.startTime >= started - 50) answeredAt = performance.now();
      }
    });
    try { observer.observe({ type: "resource" }); } catch { /* older browsers: keep the slow message only */ }
    const check = window.setInterval(() => {
      if (answeredAt && !reloaded.current && performance.now() - answeredAt > 2_000) {
        reloaded.current = true;
        window.location.reload();
      }
    }, 500);
    return () => { window.clearTimeout(slowTimer); window.clearInterval(check); observer.disconnect(); };
  }, [pending]);

  return (
    <>
      <button type="submit" className={className} disabled={pending} data-save-watch="">
        {pending ? "جارٍ الحفظ..." : children}
      </button>
      {pending && slow ? (
        <span role="status" className="mr-2 inline-flex flex-wrap items-center gap-2 text-sm text-amber-800">
          الحفظ ياخذ وقت أطول من المعتاد.
          <button type="button" className="btn-ghost btn-sm" onClick={() => window.location.reload()}>تحديث الصفحة والتأكد</button>
        </span>
      ) : null}
    </>
  );
}
