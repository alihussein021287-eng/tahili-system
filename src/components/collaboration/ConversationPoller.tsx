"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function ConversationPoller({ conversationId, lastMessageId }: { conversationId: string; lastMessageId?: string | null }) {
  const router = useRouter();
  const latestRef = useRef(lastMessageId || "");
  useEffect(() => { latestRef.current = lastMessageId || ""; }, [lastMessageId]);
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/collaboration/conversations/${conversationId}/messages`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const latest = data.messages?.[data.messages.length - 1]?.id || "";
        if (!stopped && latest && latest !== latestRef.current) {
          latestRef.current = latest;
          router.refresh();
        }
      } catch {}
    };
    const id = window.setInterval(tick, 8000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [conversationId, router]);
  return null;
}
