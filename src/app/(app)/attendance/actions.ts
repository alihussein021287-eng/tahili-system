"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function checkIn(fd: FormData) {
  await assertPerm("attendance.manage");
  const returnTo = fd.get("returnTo")?.toString();
  const name = fd.get("name")?.toString().trim();
  if (!name) {
    const target = returnTo === "staff" ? "/staff?tab=attendance" : "/attendance";
    redirect(`${target}${target.includes("?") ? "&" : "?"}saved=${encodeURIComponent("اختر الموظف")}`);
  }
  const created = await prisma.attendance.create({ data: { name: name!, checkIn: new Date() } });
  await logAudit({ action: "CREATE", tableName: "attendance", recordId: created.id });
  revalidatePath("/attendance");
  revalidatePath("/staff");
}
export async function checkOut(id: string) {
  await assertPerm("attendance.manage");
  await prisma.attendance.update({ where: { id }, data: { checkOut: new Date() } });
  await logAudit({ action: "UPDATE", tableName: "attendance", recordId: id, newValue: { checkOut: true } });
  revalidatePath("/attendance");
  revalidatePath("/staff");
}
export async function deleteAttendance(id: string) {
  await assertAdminDelete();
  await assertPerm("attendance.manage");
  await prisma.attendance.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "attendance", recordId: id });
  revalidatePath("/attendance");
  revalidatePath("/staff");
}
