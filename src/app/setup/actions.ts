"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { passwordError } from "@/lib/security";
import { assertInitialSetupAllowed } from "@/lib/setup-security";
import { incrementAuthVersion } from "@/lib/auth-version";
import { getAdminConfig } from "@/lib/admin-config";

export async function completeSetup(fd: FormData) {
  assertInitialSetupAllowed();

  const username = fd.get("username")?.toString().trim() || "admin";
  const fullName = fd.get("fullName")?.toString().trim() || "مدير النظام";
  const password = fd.get("password")?.toString() || "";
  const confirm = fd.get("confirm")?.toString() || "";
  if (password !== confirm) throw new Error("كلمتا السر غير متطابقتين");
  const policy = await getAdminConfig();
  const pwErr = passwordError(password, policy);
  if (pwErr) throw new Error(pwErr);

  const passwordHash = await bcrypt.hash(password, 10);
  const setupCompleted = await prisma.$transaction(async (tx) => {
    const activeAdmin = await tx.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    if (activeAdmin) return false;

    const existing = await tx.user.findUnique({ where: { username } });
    if (existing) {
      await tx.user.update({
        where: { id: existing.id },
        data: {
          fullName,
          passwordHash,
          role: "ADMIN",
          isActive: true,
          needsActivation: false,
          ...incrementAuthVersion(),
        },
      });
    } else {
      await tx.user.create({
        data: { username, fullName, passwordHash, role: "ADMIN", isActive: true, needsActivation: false },
      });
    }

    await tx.orgSetting.upsert({
      where: { id: 1 },
      update: {
        name: fd.get("name")?.toString().trim() || "المجمع التأهيلي الطبي",
        subtitle: fd.get("subtitle")?.toString().trim() || null,
        address: fd.get("address")?.toString().trim() || null,
        phone: fd.get("phone")?.toString().trim() || null,
        logoUrl: fd.get("logoUrl")?.toString().trim() || null,
      },
      create: {
        id: 1,
        name: fd.get("name")?.toString().trim() || "المجمع التأهيلي الطبي",
        subtitle: fd.get("subtitle")?.toString().trim() || null,
        address: fd.get("address")?.toString().trim() || null,
        phone: fd.get("phone")?.toString().trim() || null,
        logoUrl: fd.get("logoUrl")?.toString().trim() || null,
      },
    });
    return true;
  }, { isolationLevel: "Serializable" });

  if (!setupCompleted) throw new Error("التهيئة غير متاحة");

  redirect("/login");
}
