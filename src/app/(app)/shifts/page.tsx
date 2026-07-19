import { requirePerm } from "@/lib/access";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ShiftsLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; tab?: string; from?: string; to?: string }>;
}) {
  await requirePerm("shifts.view");
  const sp = await searchParams;
  const params = new URLSearchParams({ tab: sp.tab === "leaves" ? "leaves" : "shifts" });
  if (sp.saved) params.set("saved", sp.saved);
  if (sp.from) params.set("from", sp.from);
  if (sp.to) params.set("to", sp.to);
  redirect(`/staff?${params.toString()}`);
}
