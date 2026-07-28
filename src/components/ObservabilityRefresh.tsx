"use client";

import { useRouter } from "next/navigation";

export function ObservabilityRefresh() {
  const router = useRouter();
  return <button type="button" className="btn-ghost" onClick={() => router.refresh()}>تحديث الحالة</button>;
}
