"use client";
import { useEffect } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isField = (node: Element): node is Field => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;
const defaultOf = (field: Field) => {
  if (field instanceof HTMLSelectElement) return [...field.options].find((option) => option.defaultSelected)?.value ?? field.options[0]?.value ?? "";
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) return String(field.defaultChecked);
  return field.defaultValue;
};
const valueOf = (field: Field) => (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio") ? String(field.checked) : field.value);

/**
 * Safety net for every save form (server action) on every page.
 *
 * Now and then the browser receives the server's answer to a save but never applies it: the record
 * is saved, yet the screen keeps the old state (or «جارٍ الحفظ...»), and users press save again.
 * After a save the form normally leaves the page or is reset; if two seconds after the server
 * answered the same form is still there with the values that were sent, the page is reloaded once.
 * Forms with their own watcher (SubmitButton, the handoff buttons) carry data-save-watch and are skipped.
 */
export function SaveWatcher() {
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let reloaded = false;
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || !(form.getAttribute("action") || "").startsWith("javascript:")) return; // not a server action form
      if (form.querySelector("[data-save-watch]") || form.hasAttribute("data-save-watch")) return;
      const changed = [...form.elements].filter(isField).filter((field) => field.name && field.type !== "hidden" && valueOf(field) !== defaultOf(field)).map((field) => [field, valueOf(field)] as const);
      const started = performance.now();
      const href = window.location.href;
      let answeredAt = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (entry.initiatorType === "fetch" && entry.name === href && entry.startTime >= started - 50) answeredAt = performance.now();
        }
      });
      try { observer.observe({ type: "resource" }); } catch { return; }
      const check = window.setInterval(() => {
        if (!answeredAt || performance.now() - answeredAt < 2_000) {
          if (performance.now() - started > 60_000) stop();
          return;
        }
        stop();
        if (reloaded || !form.isConnected || window.location.href !== href) return;
        const stuck = changed.length ? changed.some(([field, sent]) => field.isConnected && valueOf(field) === sent) : true;
        if (stuck) { reloaded = true; window.location.reload(); }
      }, 500);
      function stop() { window.clearInterval(check); observer.disconnect(); }
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}
