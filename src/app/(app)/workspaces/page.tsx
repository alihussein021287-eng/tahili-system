import Link from "next/link";
import { currentPerms } from "@/lib/access";
import { cardsForPermissions } from "@/lib/role-workspaces";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, SectionCard } from "@/components/Ui";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const perms = await currentPerms();
  const workspaces = cardsForPermissions(perms);

  return (
    <div className="space-y-5">
      <PageHeader title="مساحاتي" subtitle="اختصارات العمل اليومية المتاحة حسب دورك وصلاحياتك" icon="◇" />

      {workspaces.length === 0 ? (
        <EmptyState title="لا توجد مساحات متاحة" description="لا توجد اختصارات مرتبطة بصلاحيات حسابك الحالية. راجع مسؤول النظام عند الحاجة." />
      ) : (
        <div className="grid gap-4">
          {workspaces.map((workspace) => (
            <SectionCard key={workspace.key} title={workspace.title} description={workspace.description}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {workspace.cards.map((card) => (
                  <Link
                    key={`${workspace.key}-${card.href}-${card.title}`}
                    href={card.href}
                    className="group flex min-h-28 items-start gap-3 rounded-lg border border-gray-200 p-4 transition hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-brand-700 transition group-hover:bg-white" aria-hidden="true">↗</span>
                    <span className="min-w-0"><span className="block font-semibold text-gray-900">{card.title}</span><span className="mt-1 block text-sm leading-6 text-gray-600">{card.description}</span></span>
                  </Link>
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
