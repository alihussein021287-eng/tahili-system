export default function PatientsLoading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="جارٍ تحميل قائمة المراجعين">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="space-y-2">
          <div className="h-7 w-40 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-28 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="h-10 w-36 animate-pulse rounded-lg bg-gray-200" />
      </div>
      <div className="card h-14 animate-pulse bg-gray-50" />
      <div className="card space-y-3 p-4">
        <div className="h-10 w-full animate-pulse rounded-lg bg-gray-100" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}
        </div>
      </div>
      <div className="card space-y-3 p-4">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}
      </div>
      <span className="sr-only">جارٍ تحميل قائمة المراجعين...</span>
    </div>
  );
}
