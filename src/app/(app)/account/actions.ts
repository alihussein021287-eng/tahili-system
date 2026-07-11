"use server";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { passwordError } from "@/lib/security";
import { logAudit } from "@/lib/audit";

export async function changeOwnPassword(fd: FormData) {
  const session = await getServerSession(authOptions);
  const uid = (session?.user as any)?.id;
  if (!uid) throw new Error("غير مصرّح");

  const current = fd.get("current")?.toString() || "";
  const next = fd.get("next")?.toString() || "";
  const confirm = fd.get("confirm")?.toString() || "";

  const pwErr = passwordError(next);
  if (pwErr) redirect("/account?saved=" + encodeURIComponent(pwErr));
  if (next !== confirm) redirect("/account?saved=" + encodeURIComponent("كلمتا السر غير متطابقتين"));

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user) throw new Error("المستخدم غير موجود");
  const ok = await bcrypt.compare(current, user.passwordHash);
  if (!ok) redirect("/account?saved=" + encodeURIComponent("كلمة السر الحالية غير صحيحة"));

  await prisma.user.update({ where: { id: uid }, data: { passwordHash: await bcrypt.hash(next, 10) } });
  await logAudit({ userId: uid, action: "UPDATE", tableName: "users", recordId: uid, newValue: { selfPasswordChange: true } });
  redirect("/account?saved=" + encodeURIComponent("تم تغيير كلمة السر بنجاح ✅"));
}
