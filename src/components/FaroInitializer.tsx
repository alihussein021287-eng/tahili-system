"use client";
import { useEffect } from "react";
import { initializeFaro } from "@grafana/faro-web-sdk";
import { FARO_AUTOMATIC_INSTRUMENTATIONS } from "@/lib/faro-telemetry-policy";

let started = false;
export function FaroInitializer({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (started || !enabled) return;
    started = true;
    try { initializeFaro({ url: "/api/observability/faro", app: { name: "tahili-frontend", environment: "development", version: process.env.NEXT_PUBLIC_APP_REVISION || "unknown" }, instrumentations: FARO_AUTOMATIC_INSTRUMENTATIONS }); } catch { /* optional telemetry */ }
  }, [enabled]);
  return null;
}
