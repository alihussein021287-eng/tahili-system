import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import QueueDisplayClient from "./QueueDisplayClient";

export const dynamic = "force-dynamic";

export default async function DisplayPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  return <QueueDisplayClient />;
}
