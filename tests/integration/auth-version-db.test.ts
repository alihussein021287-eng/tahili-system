import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { incrementAuthVersion, incrementAuthVersionIf } from "@/lib/auth-version";

const prisma = new PrismaClient();
const id = "auth-version-integration-user";

describe("authVersion on PostgreSQL 16", () => {
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { id } });
    await prisma.user.create({
      data: {
        id,
        username: `auth-version-integration-${Date.now()}`,
        passwordHash: "integration-test-only",
        fullName: "Integration User",
        role: "VIEWER",
      },
    });
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id } });
  });

  it("increments atomically with a security change", async () => {
    const changed = await prisma.user.update({
      where: { id },
      data: { role: "MANAGER", ...incrementAuthVersion() },
      select: { role: true, authVersion: true },
    });
    expect(changed).toEqual({ role: "MANAGER", authVersion: 1 });
  });

  it("does not increment for a name-only change", async () => {
    const changed = await prisma.user.update({
      where: { id },
      data: { fullName: "Renamed Integration User", ...incrementAuthVersionIf(false) },
      select: { fullName: true, authVersion: true },
    });
    expect(changed).toEqual({ fullName: "Renamed Integration User", authVersion: 0 });
  });
});
