"use client";

import { useEffect } from "react";
import { presenceWindows, type PresenceConfig } from "@/lib/presence";

async function pingPresence() {
  try {
    await fetch("/api/presence/ping", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      keepalive: true,
    });
  } catch {
    // Presence should never interrupt the user's workflow.
  }
}

export function PresencePing({ config }: { config?: PresenceConfig }) {
  useEffect(() => {
    const intervalMs = presenceWindows(config).pingIntervalMs;
    let stopped = false;
    const pingIfVisible = () => {
      if (stopped || document.visibilityState === "hidden") return;
      void pingPresence();
    };

    pingIfVisible();
    const interval = window.setInterval(pingIfVisible, intervalMs);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [config?.onlineMinutes, config?.idleMinutes, config?.pingIntervalSeconds]);

  return null;
}
