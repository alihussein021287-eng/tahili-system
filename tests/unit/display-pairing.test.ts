import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), updateMany: vi.fn(), setCookie: vi.fn(), redirect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { displayDevice: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } } }));
vi.mock("@/lib/display-auth", () => ({
  generateDisplayCredential: () => "screen-token",
  hashDisplayCredential: () => "credential-hash",
  hashPairingCode: () => "pair-hash",
  setDisplayCookie: mocks.setCookie,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { pairDisplay } from "@/app/display/actions";

const form = (code: string) => { const data = new FormData(); data.set("code", code); return data; };

describe("display pairing", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-14T12:00:00Z")); });

  it("rejects malformed and expired one-time codes", async () => {
    expect(await pairDisplay({}, form("123"))).toEqual({ error: "رمز الاقتران غير صالح" });
    mocks.findUnique.mockResolvedValue({ id: "screen-1", status: "PAIRING", pairingExpiresAt: new Date("2026-07-14T11:59:59Z") });
    expect(await pairDisplay({}, form("ABCDEFGH"))).toEqual({ error: "انتهت صلاحية الرمز أو تم استخدامه" });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("exchanges a valid code for one HttpOnly display credential", async () => {
    mocks.findUnique.mockResolvedValue({ id: "screen-1", status: "PAIRING", pairingCodeHash: "pair-hash", pairingExpiresAt: new Date("2026-07-14T12:05:00Z") });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await pairDisplay({}, form("ABCDEFGH"));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE", pairingCodeHash: null, credentialHash: "credential-hash" }) }));
    expect(mocks.setCookie).toHaveBeenCalledWith("screen-1", "screen-token");
    expect(mocks.redirect).toHaveBeenCalledWith("/display");
  });
});
