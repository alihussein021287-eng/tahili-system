import { requirePerm } from "@/lib/access";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AttendanceLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; date?: string }>;
}) {
  await requirePerm("attendance.view");
  const sp = await searchParams;
  const params = new URLSearchParams({ tab: "attendance" });
  if (sp.saved) params.set("saved", sp.saved);
  if (sp.date) params.set("date", sp.date);
  redirect(`/staff?${params.toString()}`);
}
