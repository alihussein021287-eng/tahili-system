"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-50 p-8 text-center">
      <div className="mb-4 text-6xl">⚠️</div>
      <h1 className="mb-2 text-2xl font-bold text-brand-900">صار خطأ غير متوقّع</h1>
      <p className="mb-6 max-w-md text-gray-600">حدث خطأ أثناء تحميل الصفحة. حاول مرّة أخرى، وإذا تكرّر راجع مدير النظام.</p>
      <div className="flex gap-3">
        <button onClick={reset} className="rounded-xl bg-brand-600 px-6 py-2.5 font-semibold text-white shadow hover:bg-brand-700">إعادة المحاولة</button>
        <a href="/" className="rounded-xl border border-gray-300 px-6 py-2.5 font-semibold text-gray-700 hover:bg-gray-50">الصفحة الرئيسية</a>
      </div>
    </div>
  );
}
