import { requirePerm, requireSession } from "@/lib/access";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function mappedTaskStatus(status?: string) {
  if (status === "done") return "DONE";
  if (status === "overdue") return "overdue";
  if (status === "all") return "all";
  return "open";
}

export default async function TasksLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; scope?: string; status?: string; role?: string }>;
}) {
  await requirePerm("tasks.view");
  const sp = await searchParams;
  const params = new URLSearchParams({ tab: "tasks" });
  if (sp.saved) params.set("saved", sp.saved);
  params.set("taskStatus", mappedTaskStatus(sp.status));
  if (sp.scope === "mine") params.set("assignee", "mine");
  if (sp.scope === "created") params.set("assignee", "created");
  if (sp.scope === "role") {
    const session = await requireSession();
    params.set("assignee", `role:${sp.role || (session.user as any)?.role || ""}`);
  }
  redirect(`/staff?${params.toString()}`);
}
