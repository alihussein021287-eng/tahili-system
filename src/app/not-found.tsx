import Link from "next/link";
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-50 p-8 text-center">
      <div className="mb-1 text-7xl font-extrabold text-brand-300">404</div>
      <h1 className="mb-2 text-2xl font-bold text-brand-900">الصفحة غير موجودة</h1>
      <p className="mb-6 max-w-md text-gray-600">الرابط الذي تبحث عنه غير موجود أو تم نقله.</p>
      <Link href="/" className="rounded-xl bg-brand-600 px-6 py-2.5 font-semibold text-white shadow hover:bg-brand-700">العودة للرئيسية</Link>
    </div>
  );
}
