"use client";
import { createContext, useContext, useState, useCallback, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type Toast = { id: number; msg: string; type: "success" | "error" };
const ToastCtx = createContext<{ show: (msg: string, type?: "success" | "error") => void }>({ show: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((msg: string, type: "success" | "error" = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <Suspense fallback={null}><ToastFlash /></Suspense>
      <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-2 text-sm text-white shadow-lg ${t.type === "error" ? "bg-red-600" : "bg-emerald-600"}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// يقرأ ?saved من الرابط بعد الحفظ ويعرض رسالة نجاح ثم ينظّف الرابط
function ToastFlash() {
  const sp = useSearchParams();
  const router = useRouter();
  const { show } = useToast();
  useEffect(() => {
    const saved = sp.get("saved");
    if (saved) {
      show(saved === "1" ? "تم الحفظ بنجاح ✅" : decodeURIComponent(saved));
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      router.replace(url.pathname + (url.search || ""));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  return null;
}
