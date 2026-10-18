import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/access";

// The movement log now lives in one place: the "سجل الحركة" tab of the pharmacy section.
export default async function PharmacyLog({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePerm("pharmacy.view");
  const { type } = await searchParams;
  const valid = ["IN", "DISPENSE", "DISPOSE", "ADJUST"].includes(type ?? "");
  redirect(`/pharmacy-inventory?tab=movements${valid ? `&moveType=${type}` : ""}`);
}
