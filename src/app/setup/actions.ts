"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { passwordError } from "@/lib/security";

export async function completeSetup(fd: FormData) {
  const activeAdmin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (activeAdmin) redirect("/login");

  const username = fd.get("username")?.toString().trim() || "admin";
  const fullName = fd.get("fullName")?.toString().trim() || "مدير النظام";
  const password = fd.get("password")?.toString() || "";
  const confirm = fd.get("confirm")?.toString() || "";
  if (password !== confirm) throw new Error("كلمتا السر غير متطابقتين");
  const pwErr = passwordError(password);
  if (pwErr) throw new Error(pwErr);

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { fullName, passwordHash, role: "ADMIN", isActive: true, needsActivation: false },
    });
  } else {
    await prisma.user.create({
      data: { username, fullName, passwordHash, role: "ADMIN", isActive: true, needsActivation: false },
    });
  }

  await prisma.orgSetting.upsert({
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

  redirect("/login");
}
