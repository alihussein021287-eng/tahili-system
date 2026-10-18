"use client";
import { useEffect, useRef, useState } from "react";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [errorId] = useState(() => crypto.randomUUID());
  const sent = useRef(false);
  const [reason, setReason] = useState<string | null>(null);
  // A rejected save (a clash, a missing field) comes here with only a digest: ask for its reason.
  useEffect(() => {
    if (!error.digest) return;
    fetch(`/api/observability/user-error?digest=${encodeURIComponent(error.digest)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data?.message) setReason(data.message); })
      .catch(() => {});
  }, [error.digest]);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch("/api/observability/client-error", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ errorId, route: location.pathname, errorCode: "CLIENT_RENDER_ERROR", fingerprint: error.digest || "boundary" }) }).catch(() => {});
  }, [error.digest, errorId]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-red-200 bg-red-50 text-2xl font-bold text-red-700" aria-hidden="true">!</div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">تعذر إكمال الطلب</h1>
      {reason ? (
        <p role="alert" className="mb-6 max-w-md rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 font-medium text-amber-900">{reason}</p>
      ) : (
        <p className="mb-6 max-w-md text-gray-600">حدث خطأ أثناء تحميل الصفحة. حاول مرّة أخرى، وإذا تكرّر راجع مدير النظام.</p>
      )}
      <p className="mb-6 text-sm text-gray-500">رقم الخطأ: {errorId}</p>
      <div className="flex gap-3">
        {reason ? <button onClick={() => history.back()} className="btn-primary">رجوع وتعديل</button> : <button onClick={reset} className="btn-primary">إعادة المحاولة</button>}
        <a href="/" className="btn-ghost">الصفحة الرئيسية</a>
      </div>
    </div>
  );
}
