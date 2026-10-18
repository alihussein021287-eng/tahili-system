import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/access";

// Purchase totals are part of the one pharmacy reports page.
export default async function PurchaseReports() {
  await requirePerm("pharmacy.purchase.view");
  redirect("/pharmacy/reports");
}
