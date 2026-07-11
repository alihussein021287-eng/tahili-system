"use client";
import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";

// خروج تلقائي بعد فترة خمول (افتراضي 20 دقيقة)
export function IdleTimeout({ minutes = 20 }: { minutes?: number }) {
  const timer = useRef<any>(null);
  useEffect(() => {
    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => signOut({ callbackUrl: "/login" }), minutes * 60 * 1000);
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [minutes]);
  return null;
}
