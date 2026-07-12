import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  GENERIC_ACTIVATION_ERROR,
  activateWithTemporaryCredential,
  initialCredentialError,
  type ActivationCandidate,
  type ActivationDependencies,
} from "@/lib/account-activation";

const encode = (password: string) => `hash:${password}`;

function harness(overrides: Partial<ActivationCandidate> = {}) {
  let user: ActivationCandidate | null = {
    id: "user-1",
    username: "new.user",
    passwordHash: encode("Temporary123"),
    isActive: true,
    needsActivation: true,
    failedLoginCount: 0,
    lockedUntil: null,
    authVersion: 0,
    ...overrides,
  };
  const logs: Array<{ userId?: string; username: string; success: boolean; reason: string }> = [];
  const deps: ActivationDependencies = {
    findCandidate: async (username) => user?.username === username ? { ...user } : null,
    comparePassword: async (password, hash) => encode(password) === hash,
    hashPassword: async (password) => encode(password),
    recordFailedProof: async (_candidate, lockUntil) => {
      if (!user) return;
      user.failedLoginCount = lockUntil ? 0 : user.failedLoginCount + 1;
      user.lockedUntil = lockUntil;
    },
    activate: async (candidate, passwordHash) => {
      if (!user || !user.isActive || !user.needsActivation || user.passwordHash !== candidate.passwordHash) return 0;
      user.passwordHash = passwordHash;
      user.needsActivation = false;
      user.authVersion += 1;
      user.failedLoginCount = 0;
      user.lockedUntil = null;
      return 1;
    },
    logAttempt: async (entry) => { logs.push(entry); },
    now: () => new Date("2026-07-12T00:00:00Z"),
  };
  return { deps, logs, getUser: () => user, removeUser: () => { user = null; } };
}

const validInput = {
  username: "new.user",
  temporaryPassword: "Temporary123",
  newPassword: "Permanent456",
  confirmPassword: "Permanent456",
};

describe("secure account activation", () => {
  it("cannot activate with username only", async () => {
    const h = harness();
    const result = await activateWithTemporaryCredential({ ...validInput, temporaryPassword: "" }, h.deps);
    expect(result).toEqual({ ok: false, error: GENERIC_ACTIVATION_ERROR });
    expect(h.getUser()?.needsActivation).toBe(true);
  });

  it("rejects a wrong temporary password and records a safe failed attempt", async () => {
    const h = harness();
    const result = await activateWithTemporaryCredential({ ...validInput, temporaryPassword: "WrongTemporary9" }, h.deps);
    expect(result.ok).toBe(false);
    expect(h.getUser()?.failedLoginCount).toBe(1);
    expect(JSON.stringify(h.logs)).not.toContain("WrongTemporary9");
  });

  it("locks repeated temporary-password failures", async () => {
    const h = harness();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await activateWithTemporaryCredential({ ...validInput, temporaryPassword: "WrongTemporary9" }, h.deps);
    }
    expect(h.getUser()?.lockedUntil).toEqual(new Date("2026-07-12T00:15:00Z"));
    expect((await activateWithTemporaryCredential(validInput, h.deps)).ok).toBe(false);
    expect(h.getUser()?.needsActivation).toBe(true);
  });

  it("uses the same generic failure for a missing user", async () => {
    const h = harness();
    h.removeUser();
    expect(await activateWithTemporaryCredential(validInput, h.deps))
      .toEqual({ ok: false, error: GENERIC_ACTIVATION_ERROR });
  });

  it("rejects an inactive account", async () => {
    const h = harness({ isActive: false });
    expect((await activateWithTemporaryCredential(validInput, h.deps)).ok).toBe(false);
  });

  it("rejects an already activated account", async () => {
    const h = harness({ needsActivation: false });
    expect((await activateWithTemporaryCredential(validInput, h.deps)).ok).toBe(false);
  });

  it("applies password policy and rejects reuse of the temporary password", async () => {
    const h = harness();
    expect((await activateWithTemporaryCredential({ ...validInput, newPassword: "weak", confirmPassword: "weak" }, h.deps)).ok).toBe(false);
    expect((await activateWithTemporaryCredential({ ...validInput, newPassword: "Temporary123", confirmPassword: "Temporary123" }, h.deps)).ok).toBe(false);
  });

  it("activates once, changes the hash, clears activation, and increments authVersion", async () => {
    const h = harness();
    expect((await activateWithTemporaryCredential(validInput, h.deps).then((r) => r.ok))).toBe(true);
    expect(h.getUser()).toMatchObject({
      passwordHash: encode("Permanent456"),
      needsActivation: false,
      failedLoginCount: 0,
      lockedUntil: null,
      authVersion: 1,
    });
  });

  it("allows only one of two concurrent activation requests to win", async () => {
    const h = harness();
    const [first, second] = await Promise.all([
      activateWithTemporaryCredential(validInput, h.deps),
      activateWithTemporaryCredential({ ...validInput, newPassword: "Another789", confirmPassword: "Another789" }, h.deps),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const finalHash = h.getUser()?.passwordHash;
    expect([encode("Permanent456"), encode("Another789")]).toContain(finalHash);
    expect(finalHash).toBe(first.ok ? encode("Permanent456") : encode("Another789"));
  });

  it("rejects user creation without a valid initial credential", () => {
    expect(initialCredentialError("")).toBeTruthy();
    expect(initialCredentialError("NoDigitsHere")).toBeTruthy();
    expect(initialCredentialError("StrongTemp123")).toBeNull();
  });

  it("does not expose fullName in the pre-credential username check", () => {
    const source = readFileSync("src/app/login/actions.ts", "utf8");
    const checkUsername = source.slice(source.indexOf("export async function checkUsername"), source.indexOf("// تفعيل الحساب"));
    expect(checkUsername).not.toContain("fullName");
  });
});
