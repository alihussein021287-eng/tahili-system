"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function dateOnly(v: string | undefined) {
  if (!v) return null;
  const d = new Date(v + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function savedPath(fd: FormData, tab: "shifts" | "leaves", message: string) {
  const target = fd.get("returnTo")?.toString() === "staff" ? `/staff?tab=${tab}` : "/shifts";
  return `${target}${target.includes("?") ? "&" : "?"}saved=${encodeURIComponent(message)}`;
}

export async function addShift(fd: FormData) {
  await assertPerm("shifts.manage");
  const name = fd.get("name")?.toString().trim();
  const date = dateOnly(fd.get("date")?.toString());
  if (!name || !date) redirect(savedPath(fd, "shifts", "أدخل الموظف والتاريخ"));
  const t = await prisma.shift.create({ data: {
    name: name!, date: date!,
    type: (fd.get("type")?.toString() as any) || "MORNING",
    startTime: fd.get("startTime")?.toString() || null,
    endTime: fd.get("endTime")?.toString() || null,
    notes: fd.get("notes")?.toString() || null,
  }});
  await logAudit({ action: "CREATE", tableName: "shifts", recordId: t.id });
  revalidatePath("/shifts"); revalidatePath("/attendance");
  revalidatePath("/staff");
}

export async function deleteShift(id: string) {
  await assertAdminDelete();
  await assertPerm("shifts.manage");
  await prisma.shift.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "shifts", recordId: id });
  revalidatePath("/shifts"); revalidatePath("/attendance");
  revalidatePath("/staff");
}

export async function requestLeave(fd: FormData) {
  await assertPerm("shifts.manage");
  const name = fd.get("name")?.toString().trim();
  const from = dateOnly(fd.get("fromDate")?.toString());
  const to = dateOnly(fd.get("toDate")?.toString());
  if (!name || !from || !to) redirect(savedPath(fd, "leaves", "أدخل الموظف وتاريخي الإجازة"));
  if (to! < from!) redirect(savedPath(fd, "leaves", "تاريخ النهاية قبل البداية"));
  const l = await prisma.leave.create({ data: {
    name: name!, fromDate: from!, toDate: to!,
    type: (fd.get("type")?.toString() as any) || "ANNUAL",
    reason: fd.get("reason")?.toString() || null,
  }});
  await logAudit({ action: "CREATE", tableName: "leaves", recordId: l.id });
  revalidatePath("/shifts"); revalidatePath("/attendance");
  revalidatePath("/staff");
}

export async function setLeaveStatus(id: string, status: string) {
  await assertPerm("shifts.approve");
  if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) throw new Error("حالة الإجازة غير صحيحة");
  await prisma.leave.update({ where: { id }, data: { status: status as any } });
  await logAudit({ action: "UPDATE", tableName: "leaves", recordId: id, newValue: { status } });
  revalidatePath("/shifts"); revalidatePath("/attendance");
  revalidatePath("/staff");
}

export async function deleteLeave(id: string) {
  await assertAdminDelete();
  await assertPerm("shifts.manage");
  await prisma.leave.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "leaves", recordId: id });
  revalidatePath("/shifts"); revalidatePath("/attendance");
  revalidatePath("/staff");
}
