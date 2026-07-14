import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { activateAccount } from "@/app/login/actions";

const prisma = new PrismaClient();

function credential() {
  return `${randomBytes(24).toString("base64url")}A1`;
}

async function withActivationUser<T>(test: (fixture: {
  id: string;
  username: string;
  temporaryPassword: string;
  permanentPassword: string;
  alternatePassword: string;
  wrongPassword: string;
}) => Promise<T>) {
  const nonce = randomUUID();
  const fixture = {
    id: `activation-${nonce}`,
    username: `activation.${nonce}`,
    temporaryPassword: credential(),
    permanentPassword: credential(),
    alternatePassword: credential(),
    wrongPassword: credential(),
  };

  await prisma.user.create({
    data: {
      id: fixture.id,
      username: fixture.username,
      passwordHash: await bcrypt.hash(fixture.temporaryPassword, 10),
      fullName: `Secure Activation ${nonce}`,
      role: "VIEWER",
      needsActivation: true,
    },
  });

  try {
    return await test(fixture);
  } finally {
    await prisma.loginLog.deleteMany({ where: { userId: fixture.id } });
    await prisma.user.deleteMany({ where: { id: fixture.id } });
  }
}

describe("secure activation on PostgreSQL 16", () => {
  afterAll(async () => prisma.$disconnect());

  it("rejects a wrong temporary password without changing the hash", async () => {
    await withActivationUser(async (fixture) => {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: fixture.id }, select: { passwordHash: true } });
      expect((await activateAccount(
        fixture.username,
        fixture.wrongPassword,
        fixture.permanentPassword,
        fixture.permanentPassword,
      )).ok).toBe(false);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: fixture.id },
        select: { passwordHash: true, needsActivation: true },
      });
      expect(after).toEqual({ passwordHash: before.passwordHash, needsActivation: true });
    });
  });

  it("rejects inactive and already activated users", async () => {
    await withActivationUser(async (fixture) => {
      await prisma.user.update({ where: { id: fixture.id }, data: { isActive: false } });
      expect((await activateAccount(
        fixture.username,
        fixture.temporaryPassword,
        fixture.permanentPassword,
        fixture.permanentPassword,
      )).ok).toBe(false);
      await prisma.user.update({ where: { id: fixture.id }, data: { isActive: true, needsActivation: false } });
      expect((await activateAccount(
        fixture.username,
        fixture.temporaryPassword,
        fixture.permanentPassword,
        fixture.permanentPassword,
      )).ok).toBe(false);
    });
  });

  it("changes the hash, clears activation, increments authVersion, and logs no credential", async () => {
    await withActivationUser(async (fixture) => {
      expect((await activateAccount(
        fixture.username,
        fixture.temporaryPassword,
        fixture.permanentPassword,
        fixture.permanentPassword,
      )).ok).toBe(true);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.id } });
      expect(user).toMatchObject({ needsActivation: false, authVersion: 1, failedLoginCount: 0, lockedUntil: null });
      expect(await bcrypt.compare(fixture.permanentPassword, user.passwordHash)).toBe(true);
      expect(await bcrypt.compare(fixture.temporaryPassword, user.passwordHash)).toBe(false);
      const logs = await prisma.loginLog.findMany({ where: { userId: fixture.id }, select: { reason: true } });
      const serializedLogs = JSON.stringify(logs);
      expect(serializedLogs).not.toContain(fixture.temporaryPassword);
      expect(serializedLogs).not.toContain(fixture.permanentPassword);
    });
  });

  it("allows exactly one concurrent activation and the loser cannot overwrite the winner", async () => {
    await withActivationUser(async (fixture) => {
      const [first, second] = await Promise.all([
        activateAccount(
          fixture.username,
          fixture.temporaryPassword,
          fixture.permanentPassword,
          fixture.permanentPassword,
        ),
        activateAccount(
          fixture.username,
          fixture.temporaryPassword,
          fixture.alternatePassword,
          fixture.alternatePassword,
        ),
      ]);
      expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.id } });
      expect(user.needsActivation).toBe(false);
      expect(user.authVersion).toBe(1);
      const winningPassword = first.ok ? fixture.permanentPassword : fixture.alternatePassword;
      const losingPassword = first.ok ? fixture.alternatePassword : fixture.permanentPassword;
      expect(await bcrypt.compare(winningPassword, user.passwordHash)).toBe(true);
      expect(await bcrypt.compare(losingPassword, user.passwordHash)).toBe(false);
    });
  });
});
