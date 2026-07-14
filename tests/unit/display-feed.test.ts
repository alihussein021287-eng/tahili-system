import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDisplayDevice: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/display-auth", () => ({ getDisplayDevice: mocks.getDisplayDevice }));
vi.mock("@/lib/db", () => ({ prisma: { queueEntry: { findMany: mocks.findMany }, displayDevice: { update: mocks.update } } }));

import { GET } from "@/app/api/display/feed/route";

describe("display-only queue feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    mocks.getDisplayDevice.mockResolvedValue({
      id: "screen-1", name: "شاشة 1", centerId: 4, center: { name: "مركز الأطراف" }, halls: ["قاعة أ"],
      status: "ACTIVE", nameMode: "INITIALS", callDisplaySeconds: 45, lastSeenAt: null,
    });
  });

  it("rejects a missing or revoked display credential", async () => {
    mocks.getDisplayDevice.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("filters center and halls and orders the visible call by calledAt", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "wait", status: "WAITING", hall: "قاعة أ", createdAt: new Date("2026-07-14T10:00:00Z"), calledAt: null, patient: { fullName: "سالم كامل علي" } },
      { id: "old-call", status: "CALLED", hall: "قاعة أ", createdAt: new Date("2026-07-14T10:01:00Z"), calledAt: new Date("2026-07-14T11:59:20Z"), patient: { fullName: "حسن محمد كريم" } },
      { id: "new-call", status: "CALLED", hall: "قاعة أ", createdAt: new Date("2026-07-14T10:02:00Z"), calledAt: new Date("2026-07-14T11:59:50Z"), patient: { fullName: "علي حسين جاسم" } },
    ]);
    const response = await GET();
    const body = await response.json();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ centerId: 4, hall: { in: ["قاعة أ"] } }) }));
    expect(body.called).toMatchObject({ id: "new-call", name: "علي ح. ج." });
    expect(body.waiting[0]).toMatchObject({ id: "wait", name: "سالم ك. ع." });
    expect(body.called.eventId).toContain("2026-07-14T11:59:50.000Z");
  });
});
