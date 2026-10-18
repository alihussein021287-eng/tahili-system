"use client";
import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";

/** Last activity in any tab of this site: the sign-out is for the whole browser, so idleness must be too. */
export const IDLE_ACTIVITY_KEY = "tahili:last-activity";

function readShared(): number {
  try { return Number(window.localStorage.getItem(IDLE_ACTIVITY_KEY)) || 0; } catch { return 0; }
}
function writeShared(at: number) {
  try { window.localStorage.setItem(IDLE_ACTIVITY_KEY, String(at)); } catch {}
}

/** Pure rule (tested): sign out only when no tab has seen activity for the whole period. */
export function idleExpired(now: number, localActivity: number, sharedActivity: number, minutes: number) {
  return now - Math.max(localActivity, sharedActivity) >= minutes * 60 * 1000;
}

// خروج تلقائي بعد فترة خمول (افتراضي 20 دقيقة) — الخمول محسوب على كل التبويبات، مو التبويب الحالي بس:
// تبويب منسي بالخلفية ما يطلّع المستخدم وهو يشتغل بتبويب ثاني.
export function IdleTimeout({ minutes = 20 }: { minutes?: number }) {
  const last = useRef(Date.now());
  const written = useRef(0);
  useEffect(() => {
    const touch = () => {
      const now = Date.now();
      last.current = now;
      // At most every 15 seconds: mousemove fires constantly.
      if (now - written.current > 15000) { written.current = now; writeShared(now); }
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    touch();
    const check = window.setInterval(() => {
      if (idleExpired(Date.now(), last.current, readShared(), minutes)) {
        window.clearInterval(check);
        signOut({ callbackUrl: "/login" });
      }
    }, 30000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(check);
    };
  }, [minutes]);
  return null;
}
