"use client";

import { useEffect } from "react";

const PING_INTERVAL_MS = 60_000;

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

export function PresencePing() {
  useEffect(() => {
    let stopped = false;
    const pingIfVisible = () => {
      if (stopped || document.visibilityState === "hidden") return;
      void pingPresence();
    };

    pingIfVisible();
    const interval = window.setInterval(pingIfVisible, PING_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
