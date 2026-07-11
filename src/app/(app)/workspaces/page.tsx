import Link from "next/link";
import { currentPerms } from "@/lib/access";
import { cardsForPermissions } from "@/lib/role-workspaces";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const perms = await currentPerms();
  const workspaces = cardsForPermissions(perms);

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-500">لوحة عمل حسب الصلاحيات</p>
          <h1 className="text-2xl font-bold text-slate-900">مساحات العمل</h1>
          <p className="max-w-3xl text-sm leading-7 text-slate-600">
            هذه الصفحة تجمع أهم الاختصارات لكل فئة داخل المجمع التأهيلي، وتعرض للمستخدم فقط ما تسمح به صلاحياته.
          </p>
        </div>
      </section>

      {workspaces.length === 0 ? (
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">لا توجد مساحات متاحة</h2>
          <p className="mt-2 text-sm text-slate-600">
            لا توجد صلاحيات كافية لعرض اختصارات العمل. راجع مسؤول النظام.
          </p>
        </section>
      ) : (
        <section className="grid gap-5">
          {workspaces.map((workspace) => (
            <div key={workspace.key} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-xl font-bold text-slate-900">{workspace.title}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{workspace.description}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {workspace.cards.map((card) => (
                  <Link
                    key={`${workspace.key}-${card.href}-${card.title}`}
                    href={card.href}
                    className="rounded-xl border p-4 transition hover:bg-slate-50"
                  >
                    <div className="font-semibold text-slate-900">{card.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
                    <div className="mt-3 text-xs text-slate-400">{card.href}</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
