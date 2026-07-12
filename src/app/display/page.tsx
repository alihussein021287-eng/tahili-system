import { requireSession } from "@/lib/access";
import { redirect } from "next/navigation";
import QueueDisplayClient from "./QueueDisplayClient";

export const dynamic = "force-dynamic";

export default async function DisplayPage() {
  const session = await requireSession();
  if (!session) redirect("/login");
  return <QueueDisplayClient />;
}
