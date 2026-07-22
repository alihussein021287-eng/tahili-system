"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-red-200 bg-red-50 text-2xl font-bold text-red-700" aria-hidden="true">!</div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">تعذر إكمال الطلب</h1>
      <p className="mb-6 max-w-md text-gray-600">حدث خطأ أثناء تحميل الصفحة. حاول مرّة أخرى، وإذا تكرّر راجع مدير النظام.</p>
      <div className="flex gap-3">
        <button onClick={reset} className="btn-primary">إعادة المحاولة</button>
        <a href="/" className="btn-ghost">الصفحة الرئيسية</a>
      </div>
    </div>
  );
}
