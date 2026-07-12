import { describe, expect, it, vi } from "vitest";
import { applyUserClaims } from "@/lib/auth";
import { getApiSession } from "@/lib/access";
import {
  SessionStoreUnavailableError,
  validateCurrentSession,
  type SessionUserRecord,
} from "@/lib/session-validation";

const session = (authVersion: number | undefined = 3) => ({
  user: { id: "user-1", name: "JWT name", role: "VIEWER", authVersion },
});

const currentUser = (overrides: Partial<SessionUserRecord> = {}): SessionUserRecord => ({
  id: "user-1",
  fullName: "Current name",
  role: "ADMIN",
  isActive: true,
  needsActivation: false,
  authVersion: 3,
  ...overrides,
});

describe("auth-version session validation", () => {
  it("puts uid, role, and authVersion in the JWT at login", () => {
    expect(applyUserClaims({}, { id: "user-1", role: "VIEWER", authVersion: 7 }))
      .toMatchObject({ uid: "user-1", role: "VIEWER", authVersion: 7 });
  });

  it("rejects a JWT without authVersion", async () => {
    expect(await validateCurrentSession(session(undefined), vi.fn())).toBeNull();
  });

  it("rejects a missing user", async () => {
    expect(await validateCurrentSession(session(), async () => null)).toBeNull();
  });

  it("rejects an inactive user", async () => {
    expect(await validateCurrentSession(session(), async () => currentUser({ isActive: false }))).toBeNull();
  });

  it("rejects a user who still needs activation", async () => {
    expect(await validateCurrentSession(session(), async () => currentUser({ needsActivation: true }))).toBeNull();
  });

  it("rejects an authVersion mismatch", async () => {
    expect(await validateCurrentSession(session(), async () => currentUser({ authVersion: 4 }))).toBeNull();
  });

  it("accepts a match and replaces the JWT role with the current DB role", async () => {
    const result = await validateCurrentSession(session(), async () => currentUser());
    expect(result?.user).toMatchObject({ id: "user-1", role: "ADMIN", authVersion: 3, name: "Current name" });
  });

  it("fails closed with a classified error when the user store is unavailable", async () => {
    await expect(validateCurrentSession(session(), async () => { throw new Error("database details"); }))
      .rejects.toBeInstanceOf(SessionStoreUnavailableError);
  });

  it("returns API 401 for a rejected session", async () => {
    const result = await getApiSession(async () => null);
    expect(result.response?.status).toBe(401);
  });

  it("returns API 503 when session verification cannot reach its store", async () => {
    const result = await getApiSession(async () => { throw new SessionStoreUnavailableError(); });
    expect(result.response?.status).toBe(503);
  });
});
