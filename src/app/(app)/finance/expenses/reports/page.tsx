import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/access";

// The expenses report is the expenses list itself: same filters, totals and CSV export.
export default async function ExpenseReports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePerm("expenses.reports");
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["from", "to", "patientId", "type", "status", "entity"]) if (sp[key]) params.set(key, sp[key]!);
  const query = params.toString();
  redirect(`/finance/expenses${query ? `?${query}` : ""}`);
}
