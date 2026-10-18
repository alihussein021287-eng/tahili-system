import { describe, expect, it } from "vitest";
import type { HandoffActor } from "@/lib/handoff-service";
import { loadSecretaryHandoffHistory, type SecretaryHandoffRow } from "@/lib/secretary-handoff-history";

const actor = (permissions = ["patients.view", "handoff.send", "handoff.receive"]): HandoffActor => ({
  userId: "secretary", role: "SECRETARY", permissions: new Set(permissions),
});
const sentAt = new Date("2026-10-09T10:00:00.000Z");
const row = (id: string, data: Record<string, unknown>) => ({
  id, patientId: "patient-1", fromUserId: "other", toUserId: null, acceptedById: null,
  fromCenterId: 1, toCenterId: 1, toRole: "DOCTOR", status: "SENT", sentAt,
  ...data,
});

function matches(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Record<string, unknown>[]).some((item) => matches(record, item));
    const actual = record[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("in" in expected) return (expected.in as unknown[]).includes(actual);
      return false;
    }
    return actual === expected;
  });
}

function fake() {
  const state = {
    userActive: true, userRole: "SECRETARY", membershipActive: true,
    members: [{ centerId: 1, role: "SECRETARY", status: "ACTIVE", startDate: new Date("2020-01-01"), endDate: null as Date | null }],
    rows: [
      row("own", { fromUserId: "secretary", toCenterId: 2 }),
      row("assigned", { toUserId: "secretary" }),
      row("accepted", { acceptedById: "secretary", status: "DONE" }),
      row("pool", { toRole: "SECRETARY" }),
      row("unrelated", { toRole: "DOCTOR" }),
      row("cross-center-assigned", { toUserId: "secretary", toCenterId: 2 }),
      row("cross-center-pool", { toRole: "SECRETARY", toCenterId: 2 }),
      row("cross-center-own", { fromUserId: "secretary", fromCenterId: 2, toCenterId: 2 }),
      row("other-patient", { patientId: "patient-2", fromUserId: "secretary" }),
    ],
    queryCount: 0, select: null as Record<string, unknown> | null,
    membershipWhere: null as Record<string, unknown> | null,
  };
  const db = {
    user: { findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      state.userActive && state.userRole === where.role ? { id: "secretary", role: state.userRole } : null },
    centerMembership: { findMany: async ({ where }: { where: Record<string, unknown> }) => {
      state.membershipWhere = where;
      const now = new Date();
      return state.members.filter((member) => state.membershipActive && member.status === where.status && member.role === where.role &&
        member.startDate <= now && (!member.endDate || member.endDate >= now)).map(({ centerId }) => ({ centerId }));
    } },
    patientHandoff: { findMany: async ({ where, select }: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
      state.queryCount++;
      state.select = select;
      return state.rows.filter((item) => matches(item, where)).map((item) => {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(select)) result[key] = item[key] ?? null;
        return result as SecretaryHandoffRow;
      });
    } },
  };
  return { state, db: db as Parameters<typeof loadSecretaryHandoffHistory>[2] };
}

describe("secretary operational handoff history", () => {
  it("shows own, assigned, accepted, and active secretary pool handoffs only", async () => {
    const { db } = fake();
    const result = await loadSecretaryHandoffHistory(actor(), "patient-1", db);
    expect(result.map(({ id }) => id)).toEqual(["own", "assigned", "accepted", "pool"]);
  });

  it("scopes sender and receiver branches by their respective effective permissions", async () => {
    const { db } = fake();
    expect((await loadSecretaryHandoffHistory(actor(["patients.view", "handoff.send"]), "patient-1", db)).map(({ id }) => id)).toEqual(["own"]);
    expect((await loadSecretaryHandoffHistory(actor(["patients.view", "handoff.receive"]), "patient-1", db)).map(({ id }) => id)).toEqual(["assigned", "accepted", "pool"]);
  });

  it("denies inactive, wrong-role, or membershipless accounts before querying history", async () => {
    const { state, db } = fake();
    state.userActive = false;
    await expect(loadSecretaryHandoffHistory(actor(), "patient-1", db)).rejects.toThrow();
    state.userActive = true;
    state.userRole = "DOCTOR";
    await expect(loadSecretaryHandoffHistory(actor(), "patient-1", db)).rejects.toThrow();
    state.userRole = "SECRETARY";
    state.membershipActive = false;
    expect(await loadSecretaryHandoffHistory(actor(), "patient-1", db)).toEqual([]);
    expect(state.queryCount).toBe(0);
    expect(state.membershipWhere).toMatchObject({
      userId: "secretary", role: "SECRETARY", status: "ACTIVE",
      user: { is: { isActive: true } },
    });
    expect(state.membershipWhere).toHaveProperty("startDate.lte");
    expect(state.membershipWhere).toHaveProperty("OR");
  });

  it("denies missing effective permission", async () => {
    const { state, db } = fake();
    await expect(loadSecretaryHandoffHistory(actor([]), "patient-1", db)).rejects.toThrow();
    await expect(loadSecretaryHandoffHistory(actor(["handoff.receive"]), "patient-1", db)).rejects.toThrow();
    expect(state.queryCount).toBe(0);
  });

  it("selects only operational fields, excluding free-text clinical details", async () => {
    const { state, db } = fake();
    await loadSecretaryHandoffHistory(actor(), "patient-1", db);
    expect(state.select).not.toHaveProperty("note");
    expect(state.select).not.toHaveProperty("returnReason");
    expect(state.select).not.toHaveProperty("patient");
    expect(state.select).not.toHaveProperty("diagnosis");
  });
});
