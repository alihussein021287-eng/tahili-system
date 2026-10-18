"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/data-center/access";
import { cancelImport, confirmImport, DataCenterDenied, previewImport } from "@/lib/data-center/operations";
import { UploadRejected } from "@/lib/data-center/spreadsheet";

const back = (msg: string) => redirect(`/data-center?tab=import&err=${encodeURIComponent(msg)}`);

export async function previewImportAction(fd: FormData) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const file = fd.get("file");
  const domain = fd.get("domain")?.toString() ?? "";
  const branchRaw = fd.get("branchId")?.toString();
  if (!(file instanceof File) || file.size === 0) return back("اختر ملفاً للرفع");
  let id: string;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    id = (await previewImport(prisma, actor, { domain, branchId: branchRaw ? Number(branchRaw) : null, fileName: file.name, bytes })).operationId;
  } catch (e) {
    if (e instanceof DataCenterDenied || e instanceof UploadRejected) return back(e.message);
    throw e;
  }
  revalidatePath("/data-center");
  redirect(`/data-center/import/${id}`);
}

export async function confirmImportAction(id: string, planSha256: string) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  let msg = "";
  try {
    const r = await confirmImport(prisma, actor, id, planSha256);
    msg = r.status === "APPLIED" ? "" : (r.message ?? "اكتمل التنفيذ جزئياً");
  } catch (e) {
    if (e instanceof DataCenterDenied) msg = e.message;
    else throw e;
  }
  revalidatePath("/data-center");
  redirect(`/data-center/import/${id}${msg ? `?err=${encodeURIComponent(msg)}` : ""}`);
}

export async function cancelImportAction(id: string) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  try { await cancelImport(prisma, actor, id); } catch (e) { if (!(e instanceof DataCenterDenied)) throw e; }
  revalidatePath("/data-center");
  redirect("/data-center?tab=history");
}
