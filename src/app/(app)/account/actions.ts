"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { passwordError } from "@/lib/security";
import { logAudit } from "@/lib/audit";
import { incrementAuthVersion } from "@/lib/auth-version";
import { getAdminConfig } from "@/lib/admin-config";

export async function changeOwnPassword(fd: FormData) {
  const session = await requireSession();
  const uid = (session?.user as any)?.id;
  if (!uid) throw new Error("غير مصرّح");

  const current = fd.get("current")?.toString() || "";
  const next = fd.get("next")?.toString() || "";
  const confirm = fd.get("confirm")?.toString() || "";

  const policy = await getAdminConfig();
  const pwErr = passwordError(next, policy);
  if (pwErr) redirect("/account?saved=" + encodeURIComponent(pwErr));
  if (next !== confirm) redirect("/account?saved=" + encodeURIComponent("كلمتا السر غير متطابقتين"));

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user) throw new Error("المستخدم غير موجود");
  const ok = await bcrypt.compare(current, user.passwordHash);
  if (!ok) redirect("/account?saved=" + encodeURIComponent("كلمة السر الحالية غير صحيحة"));

  await prisma.user.update({
    where: { id: uid },
    data: { passwordHash: await bcrypt.hash(next, 10), ...incrementAuthVersion() },
  });
  await logAudit({ userId: uid, action: "UPDATE", tableName: "users", recordId: uid, newValue: { selfPasswordChange: true } });
  redirect("/account?saved=" + encodeURIComponent("تم تغيير كلمة السر بنجاح ✅"));
}
