import type { CenterMembershipRole, PatientHandoff, UserRole } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptHandoff, cancelHandoff, closeOpenHandoffsForPatient, currentHolder, finishHandoff,
  history, listInbox, listSentToday, listTargets, redirectHandoff, resolveRecipients, sortInboxHandoffs,
  returnHandoff, sendHandoff, type HandoffActor, type HandoffRepository,
} from "@/lib/handoff-service";
import { logAudit } from "@/lib/audit";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/admin-config", () => ({ getAdminConfig: vi.fn().mockResolvedValue(null) }));

type Row = Record<string, unknown>;
type User = { id: string; fullName: string; role: UserRole; branchId: number | null; isActive: boolean };
type Member = { userId: string; centerId: number; role: CenterMembershipRole; status: string; specialty: string | null; startDate?: Date; endDate?: Date | null };
type Queue = { id: string; patientId: string; centerId: number | null; status: string; createdAt: Date };
const now = new Date("2026-10-09T21:30:00.000Z"); // October 10 in Baghdad.
const actor = (userId = "sender", permissions = ["handoff.send", "handoff.receive"]): HandoffActor => ({
  userId, role: "RESIDENT", permissions: new Set(permissions),
});
const user = (id: string, role: UserRole = "RESIDENT", branchId = 1, isActive = true): User => ({
  id, fullName: "علي حسين", role, branchId, isActive,
});
const handoff = (overrides: Partial<PatientHandoff> = {}): PatientHandoff => ({
  id: "handoff-1", patientId: "patient-1", fromUserId: "sender", fromRole: "RESIDENT", fromCenterId: 1,
  toUserId: null, toRole: "DOCTOR", toCenterId: 2, status: "SENT", note: null, returnReason: null,
  sentAt: now, acceptedAt: null, acceptedById: null, doneAt: null, previousHandoffId: null, careStageId: null,
  createdAt: now, updatedAt: now, ...overrides,
});

/** Evaluates the Prisma predicate rather than returning canned successful answers. */
function matches(record: Row, where: unknown): boolean {
  if (!where) return true;
  return Object.entries(where as Row).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === "OR") return (expected as unknown[]).some((part) => matches(record, part));
    if (key === "AND") return (Array.isArray(expected) ? expected : [expected]).every((part) => matches(record, part));
    const actual = record[key];
    if (expected !== null && typeof expected === "object" && !(expected instanceof Date)) {
      return Object.entries(expected as Row).every(([operator, operand]) => {
        if (operator === "some") return Array.isArray(actual) && actual.some(row => matches(row as Row, operand));
        if (operator === "not") return operand === null ? actual != null : actual !== operand;
        if (operator === "in") return (operand as unknown[]).includes(actual);
        if (operator === "gte") return Number(actual) >= Number(operand);
        if (operator === "lte") return Number(actual) <= Number(operand);
        if (operator === "is") return matches((actual ?? {}) as Row, operand);
        if (operator === "lt") return Number(actual) < Number(operand);
        if (operator === "equals") return actual === operand;
        return matches((actual ?? {}) as Row, { [operator]: operand });
      });
    }
    return actual === expected;
  });
}
function ordered<T extends object>(rows: T[], orderBy: unknown): T[] {
  const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Row[];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      for (const [key, direction] of Object.entries(order)) {
        const av = (a as Row)[key];
        const bv = (b as Row)[key];
        const comparison = av === bv ? 0 : av! < bv! ? -1 : 1;
        if (comparison) return direction === "desc" ? -comparison : comparison;
      }
    }
    return 0;
  });
}
function fake() {
  const state = {
    users: [user("sender"), user("doctor-a", "DOCTOR"), user("doctor-b", "DOCTOR")],
    members: [
      { userId: "sender", centerId: 1, role: "RESIDENT", status: "ACTIVE", specialty: null },
      { userId: "doctor-a", centerId: 2, role: "SPECIALIST", status: "ACTIVE", specialty: "تأهيل" },
      { userId: "doctor-b", centerId: 2, role: "SPECIALIST", status: "ACTIVE", specialty: null },
    ] as Member[],
    patients: [{ id: "patient-1", fullName: "مراجع اختباري", branchId: 1 }, { id: "patient-2", fullName: "مراجع ثاني", branchId: 2 }] as { id: string; fullName: string; branchId: number | null; treatmentPlans?: Row[]; centerPrograms?: Row[]; visits?: Row[] }[],
    centers: [{ id: 1, name: "المركز الأول" }, { id: 2, name: "المركز الثاني" }],
    handoffs: [] as PatientHandoff[], queues: [] as Queue[],
    rolePermissions: [] as { role: UserRole; permKey: string; allowed: boolean }[],
    userPermissions: [] as { userId: string; permKey: string; allowed: boolean }[],
    notifications: [] as Row[], audits: [] as Row[],
    failNotificationFor: "", failAuditCreate: false,
    failHandoffCreate: false, failQueueCreate: false, conflicts: 0, transactions: 0, groupByCalls: 0,
  };
  let sequence = 0;
  let inTransaction = false;
  let transactionTail = Promise.resolve();
  const expanded = (row: PatientHandoff) => ({ ...row, patient: state.patients.find((patient) => patient.id === row.patientId), previousHandoff: state.handoffs.find(h => h.id === row.previousHandoffId), fromUser: state.users.find((candidate) => candidate.id === row.fromUserId) ?? null });
  const db: HandoffRepository = {
    $queryRaw: async (query, actorId) => {
      expect(inTransaction).toBe(true);
      expect(query.join("?")).toMatch(/SELECT id FROM (users|center_memberships).*FOR SHARE/);
      expect(typeof actorId).toBe("string");
      return [];
    },
    rolePermission: { findMany: async ({ where }) => state.rolePermissions.filter((row) => matches(row, where)) },
    userPermission: { findMany: async ({ where }) => state.userPermissions.filter((row) => matches(row, where)) },
    auditLog: { create: async ({ data }) => {
      expect(inTransaction).toBe(true);
      if (state.failAuditCreate) throw new Error("audit insert failed");
      state.audits.push(data as Row);
    } },
    notification: {
      findFirst: async ({ where }) => {
        expect(inTransaction).toBe(true);
        return state.notifications.find((row) => matches(row, where)) as { id: string } | undefined ?? null;
      },
      create: async ({ data }) => {
        expect(inTransaction).toBe(true);
        if (data.targetUserId === state.failNotificationFor) throw new Error("notification insert failed");
        state.notifications.push({ id: `notification-${++sequence}`, createdAt: new Date(), ...data });
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state.notifications) if (matches(row, where)) { Object.assign(row, data); count++; }
        return { count };
      },
    },
    user: {
      findFirst: async ({ where }) => state.users.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }) => state.users.filter((row) => matches(row, where)),
    },
    centerMembership: { findMany: async ({ where }) => state.members.map((member) => ({
      startDate: new Date("2026-01-01"), endDate: null, ...member, center: { active: true }, user: state.users.find((candidate) => candidate.id === member.userId)!,
    })).filter((row) => matches(row, where)) },
    patient: { findUnique: async ({ where }) => state.patients.find((row) => matches(row, where)) ?? null },
    center: { findUnique: async ({ where }) => state.centers.find((row) => matches(row, where)) ?? null },
    patientHandoff: {
      findFirst: async ({ where, orderBy }) => ordered(state.handoffs.filter((row) => matches(expanded(row), where)), orderBy)[0] ?? null,
      findMany: async ({ where, orderBy }) => ordered(state.handoffs.filter((row) => matches(expanded(row), where)), orderBy),
      count: async ({ where }) => state.handoffs.filter((row) => matches(expanded(row), where)).length,
      groupBy: async ({ by, where }) => {
        state.groupByCalls++;
        const groups = new Map<string, { status: "SENT" | "ACCEPTED"; toUserId: string | null; acceptedById: string | null; _count: { _all: number } }>();
        for (const row of state.handoffs.filter((item) => matches(expanded(item), where))) {
          const key = by.map((field) => row[field]).join(":");
          const group = groups.get(key) ?? { status: row.status as "SENT" | "ACCEPTED", toUserId: row.toUserId, acceptedById: row.acceptedById, _count: { _all: 0 } };
          group._count._all++;
          groups.set(key, group);
        }
        return [...groups.values()];
      },
      create: async ({ data }) => {
        if (state.failHandoffCreate) throw new Error("handoff insert failed");
        const row = handoff({ id: `created-${++sequence}`, fromCenterId: null, toCenterId: null, ...data } as Partial<PatientHandoff>);
        state.handoffs.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state.handoffs) if (matches(expanded(row), where)) { Object.assign(row, data); count++; }
        return { count };
      },
    },
    queueEntry: {
      findFirst: async ({ where }) => state.queues.find((row) => matches(row, where)) ?? null,
      create: async ({ data }) => {
        if (state.failQueueCreate) throw new Error("queue insert failed");
        const row = { id: `queue-${++sequence}`, createdAt: new Date(), ...data } as Queue;
        state.queues.push(row);
        return row;
      },
    },
    async $transaction(work, options) {
      expect(options?.isolationLevel).toBe("Serializable");
      state.transactions++;
      if (state.conflicts-- > 0) throw Object.assign(new Error("retry"), { code: "P2034" });
      // Serialize transactions and snapshot their writes to model isolation and rollback.
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const snapshot = structuredClone({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits });
      inTransaction = true;
      try { return await work(db); }
      catch (error) { Object.assign(state, snapshot); throw error; }
      finally { inTransaction = false; release(); }
    },
  };
  return { state, db };
}
const send = { patientId: "patient-1", toCenterId: 2, toRole: "DOCTOR" as const };

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe("handoff recipient resolution", () => {
  it("requires explicit recipients to match the requested center role", async () => {
    const { db } = fake();
    expect(await resolveRecipients({ toUserId: "sender", toCenterId: 2, toRole: "DOCTOR" }, db)).toEqual([]);
    expect(await resolveRecipients({ toUserId: "doctor-a", toCenterId: 2, toRole: "DOCTOR" }, db)).toEqual(["doctor-a"]);
    expect(await resolveRecipients({ toUserId: "sender" }, db)).toEqual(["sender"]);
  });
  it("does not resolve a missing or inactive explicit user", async () => {
    const { db, state } = fake();
    state.users[0].isActive = false;
    for (const toUserId of ["sender", "missing"]) expect(await resolveRecipients({ toUserId, toRole: "DOCTOR" }, db)).toEqual([]);
  });
  it("resolves DOCTOR to active SPECIALIST members of the selected center only", async () => {
    const { db, state } = fake();
    state.users.push(user("inactive", "DOCTOR", 1, false), user("resident"), user("elsewhere", "DOCTOR"), user("revoked", "DOCTOR"));
    state.members.push(
      { userId: "inactive", centerId: 2, role: "SPECIALIST", status: "ACTIVE", specialty: null },
      { userId: "resident", centerId: 2, role: "RESIDENT", status: "ACTIVE", specialty: null },
      { userId: "elsewhere", centerId: 3, role: "SPECIALIST", status: "ACTIVE", specialty: null },
      { userId: "revoked", centerId: 2, role: "SPECIALIST", status: "INACTIVE", specialty: null },
    );
    expect(await resolveRecipients({ toCenterId: 2, toRole: "DOCTOR" }, db)).toEqual(["doctor-a", "doctor-b"]);
  });
  it.each(["RECEPTION", "DATA_ENTRY"] as const)("resolves active %s users in the patient's branch only", async (role) => {
    const { db, state } = fake();
    state.users.push(user("right", role), user("other-branch", role, 2), user("inactive", role, 1, false));
    expect(await resolveRecipients({ toRole: role, patientBranchId: 1 }, db)).toEqual(["right"]);
    expect(await resolveRecipients({ toRole: role, patientBranchId: null }, db)).toEqual([]);
  });
  it("rejects unknown recipient fields", async () => {
    const { db } = fake();
    await expect(resolveRecipients({ toRole: "DOCTOR", untrusted: true } as never, db)).rejects.toThrow();
  });
});

describe("sendHandoff", () => {
  it.each(["expired", "revoked", "wrong-center", "wrong-role"])("rejects %s responsibility before any implicit handoff transition", async (reason) => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-a", status: "ACCEPTED", acceptedById: "doctor-a", acceptedAt: now }));
    const member = state.members.find(m => m.userId === "doctor-a")!;
    if (reason === "expired") member.endDate = new Date(now.getTime() - 1);
    if (reason === "revoked") member.status = "INACTIVE";
    if (reason === "wrong-center") member.centerId = 999;
    if (reason === "wrong-role") state.users.find(u => u.id === "doctor-a")!.role = "RESIDENT";
    // Own-branch patient access stays legitimate; it is not authority over the old task.
    expect(state.users.find(u => u.id === "doctor-a")!.branchId).toBe(state.patients[0].branchId);
    const before = structuredClone({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits });
    await expect(sendHandoff(actor("doctor-a"), { patientId: "patient-1", toRole: "RESIDENT", toCenterId: 1 }, db)).rejects.toThrow();
    expect({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits }).toEqual(before);
  });

  it("preserves forwarding by a currently eligible owner with independent branch access", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-a", status: "ACCEPTED", acceptedById: "doctor-a", acceptedAt: now }));
    const next = await sendHandoff(actor("doctor-a"), { patientId: "patient-1", toRole: "RESIDENT", toCenterId: 1 }, db);
    expect(state.handoffs[0].status).toBe("DONE");
    expect(next).toMatchObject({ status: "SENT", fromCenterId: 2, previousHandoffId: "handoff-1" });
  });
  it("requires the same completion permission for direct and implicit completion", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-a", status: "ACCEPTED", acceptedById: "doctor-a" }));
    const before = structuredClone({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits });
    const sender = actor("doctor-a", ["handoff.send"]);
    await expect(finishHandoff(sender, "handoff-1", db)).rejects.toThrow();
    await expect(sendHandoff(sender, { patientId: "patient-1", toRole: "RESIDENT", toCenterId: 1 }, db)).rejects.toThrow();
    expect({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits }).toEqual(before);
  });
  it.each(["MANAGER", "ADMIN"] as const)("does not let %s complete obsolete personal ownership through takeover", async (role) => {
    const { db, state } = fake();
    state.users[0].role = role;
    state.handoffs.push(handoff({ status: "ACCEPTED", acceptedById: "sender" }));
    const before = structuredClone({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits });
    await expect(sendHandoff(actor("sender", ["handoff.send", "handoff.manage"]), send, db)).rejects.toThrow();
    expect({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits }).toEqual(before);
  });
  it("rejects an empty center with the Arabic label and makes no changes", async () => {
    const { db, state } = fake();
    await expect(sendHandoff(actor(), { ...send, toCenterId: 99 }, db)).rejects.toThrow(/^هذا المركز ما بيه طبيب اختصاص/);
    expect(state.handoffs).toEqual([]);
    expect(logAudit).not.toHaveBeenCalled();
  });
  it("completes the sender's accepted handoff and links the new handoff atomically", async () => {
    const { db, state } = fake();
    state.members[0].centerId = 2;
    state.handoffs.push(handoff({ toRole: "RESIDENT", status: "ACCEPTED", acceptedById: "sender", acceptedAt: now }));
    const created = await sendHandoff(actor(), { ...send, fromCenterId: 1 } as never, db);
    expect(state.handoffs[0]).toMatchObject({ status: "DONE", doneAt: now });
    expect(created).toMatchObject({ status: "SENT", previousHandoffId: "handoff-1", fromUserId: "sender", fromRole: "RESIDENT", fromCenterId: 2 });
    expect(state.audits).toEqual([expect.objectContaining({ newValue: {
      toUserId: null, toRole: "DOCTOR", toCenterId: 2, fromCenterId: 2, previousHandoffId: "handoff-1", cancelledHandoffIds: [],
    } })]);
  });
  it("does not complete another user's accepted handoff", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ status: "ACCEPTED", acceptedById: "doctor-a" }));
    await expect(sendHandoff(actor(), send, db)).rejects.toThrow(/^المريض حالياً عند/);
    expect(state.handoffs[0].status).toBe("ACCEPTED");
    expect(state.handoffs).toHaveLength(1);
    expect(state.audits).toEqual([]);
    expect(state.notifications).toEqual([]);
  });
  it("rolls back the old DONE status when creating its successor fails", async () => {
    const { db, state } = fake();
    state.members[0].centerId = 2;
    state.handoffs.push(handoff({ toRole: "RESIDENT", status: "ACCEPTED", acceptedById: "sender", acceptedAt: now }));
    state.failHandoffCreate = true;
    await expect(sendHandoff(actor(), send, db)).rejects.toThrow("handoff insert failed");
    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0]).toMatchObject({ status: "ACCEPTED", doneAt: null });
    expect(logAudit).not.toHaveBeenCalled();
  });
  it("rejects missing permission, inactive users, and missing patients", async () => {
    const { db, state } = fake();
    await expect(sendHandoff(actor("sender", []), send, db)).rejects.toThrow("غير مصرح");
    await expect(sendHandoff(actor("missing"), send, db)).rejects.toThrow("غير مصرح");
    await expect(sendHandoff(actor(), { ...send, patientId: "missing" }, db)).rejects.toThrow();
    state.users[0].isActive = false;
    await expect(sendHandoff(actor(), send, db)).rejects.toThrow("غير مصرح");
    expect(state.handoffs).toEqual([]);
    expect(logAudit).not.toHaveBeenCalled();
  });
  it.each([{ acceptedById: "attacker" }, { status: "ACCEPTED" }, { patientBranchId: 2 }, { fromRole: "ADMIN" }])("rejects injected fields %j", async (extra) => {
    const { db, state } = fake();
    await expect(sendHandoff(actor(), { ...send, ...extra } as never, db)).rejects.toThrow();
    expect(state.transactions).toBe(0);
  });
  it("uses the database actor role instead of the supplied role", async () => {
    const { db } = fake();
    const created = await sendHandoff({ ...actor(), role: "ADMIN" }, send, db);
    expect(created.fromRole).toBe("RESIDENT");
  });
  it("retries serialization failures without duplicating handoffs or audits", async () => {
    const { db, state } = fake();
    state.conflicts = 2;
    await sendHandoff(actor(), send, db);
    expect(state.transactions).toBe(3);
    expect(state.handoffs).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(state.notifications).toHaveLength(2);
  });
});

describe("acceptHandoff and queue enrollment", () => {
  it.each(["direct", "implicit"])("preserves %s completion of the designated centerless physician follow-up", async (completion) => {
    const { db, state } = fake();
    state.members.find(m => m.userId === "doctor-a")!.status = "INACTIVE";
    state.patients[0].treatmentPlans = [{ status: "COMPLETED", finalDecision: "END", closedAt: now, evaluatedAt: now, specialistDoctorId: "doctor-a" }];
    state.handoffs.push(handoff({ toUserId: "doctor-a", toCenterId: null }));
    await acceptHandoff(actor("doctor-a"), "handoff-1", db);
    if (completion === "direct") await finishHandoff(actor("doctor-a"), "handoff-1", db);
    else await sendHandoff(actor("doctor-a"), { patientId: "patient-1", toRole: "RESIDENT", toCenterId: 1 }, db);
    expect(state.handoffs[0].status).toBe("DONE");
    expect(state.queues).toEqual([]);
  });
  it.each(["reviewer", "creator"])("preserves the named center-program follow-up to its %s", async (source) => {
    const { db, state } = fake();
    state.patients[0].centerPrograms = [{ status: "COMPLETED", returnToConsultancy: true, closedAt: now,
      referralRequest: { assignedReviewerId: source === "reviewer" ? "doctor-a" : null, createdById: source === "creator" ? "doctor-a" : "sender" } }];
    state.handoffs.push(handoff({ toUserId: "doctor-a", toCenterId: null }));
    await acceptHandoff(actor("doctor-a"), "handoff-1", db);
    expect(state.handoffs[0].acceptedById).toBe("doctor-a");
  });
  it.each(["no-program", "wrong-doctor", "active-program", "linked-stage", "not-root", "pool"])("rejects a centerless physician task with %s instead of granting by name", async (invalid) => {
    const { db, state } = fake();
    state.patients[0].treatmentPlans = invalid === "no-program" ? [] : [{ status: invalid === "active-program" ? "ACTIVE" : "COMPLETED", finalDecision: "END", closedAt: now, evaluatedAt: now, specialistDoctorId: invalid === "wrong-doctor" ? "doctor-b" : "doctor-a" }];
    state.handoffs.push(handoff({ toUserId: invalid === "pool" ? null : "doctor-a", toCenterId: null,
      careStageId: invalid === "linked-stage" ? "stage-1" : null, previousHandoffId: invalid === "not-root" ? "old" : null }));
    const before = structuredClone({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits });
    await expect(acceptHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow();
    expect({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits }).toEqual(before);
  });
  it.each(["valid", "not-returned", "wrong-sender", "unverified", "wrong-branch", "inactive-branch", "pool", "changed-role"])("checks %s receiving-branch return authority independently of registration branch", async (scenario) => {
    const { db, state } = fake();
    state.users.push(user("reception", scenario === "changed-role" ? "DATA_ENTRY" : "RECEPTION"));
    state.patients[1].visits = [{ branchId: scenario === "wrong-branch" ? 9 : 1, branch: { isActive: scenario !== "inactive-branch" },
      verifiedAt: scenario === "unverified" ? null : now, verificationMethod: "PHYSICAL_DOCUMENT_ATTESTED" }];
    state.handoffs.push(handoff({ id: "returned", patientId: "patient-2", status: scenario === "not-returned" ? "DONE" : "RETURNED", fromUserId: scenario === "wrong-sender" ? "sender" : "reception", fromRole: "RECEPTION" }),
      handoff({ id: "back", patientId: "patient-2", toRole: "RECEPTION", toUserId: scenario === "pool" ? null : "reception", toCenterId: null, previousHandoffId: "returned" }));
    const before = structuredClone({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits });
    if (scenario === "valid") {
      await acceptHandoff(actor("reception"), "back", db);
      await finishHandoff(actor("reception"), "back", db);
      expect(state.handoffs[1].status).toBe("DONE");
      expect(state.queues).toEqual([]);
    } else {
      await expect(acceptHandoff(actor("reception"), "back", db)).rejects.toThrow();
      expect({ handoffs: state.handoffs, queues: state.queues, notifications: state.notifications, audits: state.audits }).toEqual(before);
    }
  });
  it("fails closed before mutation when the transaction cannot coordinate authorization locks", async () => {
    const { db, state } = fake();
    delete db.$queryRaw;
    state.handoffs.push(handoff({ toUserId: "doctor-a" }));
    await expect(acceptHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow();
    expect(state.handoffs[0].status).toBe("SENT");
    expect(state.queues).toEqual([]);
    expect(state.audits).toEqual([]);
    expect(state.notifications).toEqual([]);
  });
  it.each(["expired", "revoked", "wrong-role", "wrong-center"])("rejects a named recipient with %s eligibility without side effects", async (reason) => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-a" }));
    const member = state.members.find(m => m.userId === "doctor-a")!;
    if (reason === "expired") member.endDate = new Date(now.getTime() - 1);
    if (reason === "revoked") member.status = "INACTIVE";
    if (reason === "wrong-center") member.centerId = 999;
    if (reason === "wrong-role") state.users.find(u => u.id === "doctor-a")!.role = "RESIDENT";
    const before = structuredClone({ handoffs: state.handoffs, queues: state.queues, audits: state.audits, notifications: state.notifications });
    await expect(acceptHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow();
    expect({ handoffs: state.handoffs, queues: state.queues, audits: state.audits, notifications: state.notifications }).toEqual(before);
    expect((await listInbox(actor("doctor-a"), { page: 1, pageSize: 20 }, db)).items).toEqual([]);
  });

  it("does not retain accepted ownership access or completion authority after membership revocation", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-a", status: "ACCEPTED", acceptedById: "doctor-a", acceptedAt: now }));
    state.members.find(m => m.userId === "doctor-a")!.status = "INACTIVE";
    expect((await listInbox(actor("doctor-a"), { page: 1, pageSize: 20 }, db)).items).toEqual([]);
    await expect(finishHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow();
    expect(state.handoffs[0].status).toBe("ACCEPTED");
    expect(state.queues).toEqual([]);
    expect(state.audits).toEqual([]);
  });
  it("allows exactly one concurrent acceptance and removes the handoff from the loser's inbox", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff());
    state.notifications.push(
      { id: "notice-a", handoffId: "handoff-1", read: false, title: "تسليم مراجع جديد" },
      { id: "notice-b", handoffId: "handoff-1", read: false, title: "تسليم مراجع جديد" },
    );
    expect((await listInbox(actor("doctor-a"), { page: 1, pageSize: 20 }, db)).items).toHaveLength(1);
    expect((await listInbox(actor("doctor-b"), { page: 1, pageSize: 20 }, db)).items).toHaveLength(1);
    const results = await Promise.allSettled([acceptHandoff(actor("doctor-a"), "handoff-1", db), acceptHandoff(actor("doctor-b"), "handoff-1", db)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("استلمها شخص آخر");
    const winner = state.handoffs[0].acceptedById!;
    expect(state.notifications.every((notice) => notice.read === true)).toBe(true);
    const loser = winner === "doctor-a" ? "doctor-b" : "doctor-a";
    expect((await listInbox(actor(loser), { page: 1, pageSize: 20 }, db)).items).toEqual([]);
    expect((await listInbox(actor(winner), { page: 1, pageSize: 20 }, db)).items).toHaveLength(1);
    expect(state.handoffs[0]).toMatchObject({ status: "ACCEPTED", acceptedAt: now });
    expect(state.queues).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });
  it.each(["SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST"] as const)("enrolls a %s center recipient once in today's waiting queue", async (toRole) => {
    const { db, state } = fake();
    state.users.find(u => u.id === "doctor-a")!.role = toRole;
    state.members.find(m => m.userId === "doctor-a")!.role = ({ SECRETARY: "SECRETARY", RESIDENT: "RESIDENT", DOCTOR: "SPECIALIST", HEAD_THERAPIST: "HEAD_THERAPIST" } as const)[toRole];
    state.handoffs.push(handoff({ toRole, toUserId: "doctor-a" }), handoff({ id: "handoff-2", toRole, toUserId: "doctor-a" }));
    await Promise.all([acceptHandoff(actor("doctor-a"), "handoff-1", db), acceptHandoff(actor("doctor-a"), "handoff-2", db)]);
    expect(state.queues).toHaveLength(1);
    expect(state.queues[0]).toMatchObject({ patientId: "patient-1", centerId: 2, status: "WAITING" });
    expect(state.audits.filter((entry) => entry.tableName === "queue_entries")).toEqual([expect.objectContaining({ recordId: state.queues[0].id })]);
  });
  it("does not queue a THERAPIST handoff", async () => {
    const { db, state } = fake();
    state.users.find(u => u.id === "doctor-a")!.role = "THERAPIST";
    state.members.find(m => m.userId === "doctor-a")!.role = "THERAPIST";
    state.handoffs.push(handoff({ toRole: "THERAPIST", toUserId: "doctor-a" }));
    await acceptHandoff(actor("doctor-a"), "handoff-1", db);
    expect(state.queues).toEqual([]);
  });
  it("uses Baghdad's day boundaries and ignores other patients, centers and days", async () => {
    const { db, state } = fake();
    const baseline = { id: "queue-existing", patientId: "patient-1", centerId: 2, status: "WAITING", createdAt: new Date("2026-10-09T20:59:59.999Z") };
    state.queues.push(baseline, { ...baseline, id: "other-patient", patientId: "patient-2", createdAt: now }, { ...baseline, id: "other-center", centerId: 1, createdAt: now }, { ...baseline, id: "tomorrow", createdAt: new Date("2026-10-10T21:00:00Z") });
    state.handoffs.push(handoff());
    await acceptHandoff(actor("doctor-a"), "handoff-1", db);
    expect(state.queues).toHaveLength(5);
  });
  it.each(["WAITING", "CALLED", "IN_SESSION", "DONE", "CANCELLED"])("does not duplicate a %s entry from today", async (status) => {
    const { db, state } = fake();
    state.queues.push({ id: "queue-existing", patientId: "patient-1", centerId: 2, status, createdAt: now });
    state.handoffs.push(handoff());
    await acceptHandoff(actor("doctor-a"), "handoff-1", db);
    expect(state.queues.map((entry) => entry.id)).toEqual(["queue-existing"]);
    expect(state.audits.filter((entry) => entry.tableName === "queue_entries")).toEqual([]);
  });
  it("reuses an entry at the start of the Baghdad day", async () => {
    const { db, state } = fake();
    state.queues.push({ id: "queue-existing", patientId: "patient-1", centerId: 2, status: "WAITING", createdAt: new Date("2026-10-09T21:00:00Z") });
    state.handoffs.push(handoff());
    await acceptHandoff(actor("doctor-a"), "handoff-1", db);
    expect(state.queues.map((entry) => entry.id)).toEqual(["queue-existing"]);
  });
  it("does not enroll a valid named branch target", async () => {
    const { db, state } = fake();
    state.users.find(u => u.id === "doctor-a")!.role = "RECEPTION";
    state.handoffs.push(handoff({ toUserId: "doctor-a", toRole: "RECEPTION", toCenterId: null }));
    await acceptHandoff(actor("doctor-a"), "handoff-1", db);
    expect(state.queues).toEqual([]);
  });
  it("rejects a named center-role target without a destination center", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-a", toCenterId: null }));
    await expect(acceptHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow();
    expect(state.handoffs[0].status).toBe("SENT");
    expect(state.queues).toEqual([]);
  });
  it("rolls back acceptance if queue creation fails", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff()); state.failQueueCreate = true;
    await expect(acceptHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow("queue insert failed");
    expect(state.handoffs[0]).toMatchObject({ status: "SENT", acceptedById: null, acceptedAt: null });
    expect(logAudit).not.toHaveBeenCalled();
  });
  it("rejects another user's explicit handoff even for an eligible center member", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-b" }));
    await expect(acceptHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow("استلمها شخص آخر");
    expect((await listInbox(actor("doctor-a"), { page: 1, pageSize: 20 }, db)).items).toEqual([]);
    expect(state.handoffs[0].status).toBe("SENT");
  });
  it("rejects missing receive permission and inactive actors", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff());
    await expect(acceptHandoff(actor("doctor-a", []), "handoff-1", db)).rejects.toThrow("غير مصرح");
    state.users[1].isActive = false;
    await expect(acceptHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow("غير مصرح");
    expect(state.handoffs[0].status).toBe("SENT");
  });
});

describe("returnHandoff", () => {
  it("permits an eligible return with handoff.send alone", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-a" }));
    await returnHandoff(actor("doctor-a", ["handoff.send"]), "handoff-1", "إكمال المعلومات", db);
    expect(state.handoffs[0].status).toBe("RETURNED");
  });
  it.each(["SENT", "ACCEPTED"] as const)("rejects empty reasons without changing a %s handoff", async (status) => {
    const { db, state } = fake(); state.handoffs.push(handoff({ status, acceptedById: status === "ACCEPTED" ? "doctor-a" : null }));
    for (const reason of ["", "   ", "\n\t"]) await expect(returnHandoff(actor("doctor-a"), "handoff-1", reason, db)).rejects.toThrow("سبب الإرجاع مطلوب");
    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0].status).toBe(status);
    expect(logAudit).not.toHaveBeenCalled();
  });
  it.each(["SENT", "ACCEPTED"] as const)("returns a %s handoff to its original sender with a trimmed reason", async (status) => {
    const { db, state } = fake(); state.handoffs.push(handoff({ status, acceptedById: status === "ACCEPTED" ? "doctor-a" : null }));
    const returned = await returnHandoff(actor("doctor-a"), "handoff-1", "  إكمال المعلومات  ", db);
    expect(state.handoffs[0]).toMatchObject({ status: "RETURNED", returnReason: "إكمال المعلومات" });
    expect(returned).toMatchObject({ status: "SENT", toUserId: "sender", toRole: "RESIDENT", toCenterId: 1, previousHandoffId: "handoff-1", fromUserId: "doctor-a", fromCenterId: 2, note: "إكمال المعلومات" });
    expect((await listInbox(actor("sender"), { page: 1, pageSize: 20 }, db)).items).toEqual([returned]);
    expect(state.notifications).toEqual([expect.objectContaining({ targetUserId: "sender", link: "/my-work" })]);
    expect(JSON.stringify(state.notifications)).not.toContain("إكمال المعلومات");
  });
  it("rejects return of another user's accepted handoff", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff({ status: "ACCEPTED", acceptedById: "doctor-b" }));
    await expect(returnHandoff(actor("doctor-a"), "handoff-1", "إكمال المعلومات", db)).rejects.toThrow("استلمها شخص آخر");
    expect(state.handoffs[0].status).toBe("ACCEPTED");
  });
  it("rolls back RETURNED when creating the return handoff fails", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff()); state.failHandoffCreate = true;
    await expect(returnHandoff(actor("doctor-a"), "handoff-1", "إكمال المعلومات", db)).rejects.toThrow("handoff insert failed");
    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0]).toMatchObject({ status: "SENT", returnReason: null });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("handoff reads and auditing", () => {
  it("sorts SENT by delay colour and oldest inside each colour before ACCEPTED", () => {
    const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    const rows = [
      handoff({ id: "accepted", status: "ACCEPTED", sentAt: at(120) }),
      handoff({ id: "green", sentAt: at(5) }),
      handoff({ id: "yellow-new", sentAt: at(31) }),
      handoff({ id: "red-new", sentAt: at(46) }),
      handoff({ id: "yellow-old", sentAt: at(40) }),
      handoff({ id: "red-old", sentAt: at(80) }),
    ];
    expect(sortInboxHandoffs(rows, now).map((row) => row.id)).toEqual(["red-old", "red-new", "yellow-old", "yellow-new", "green", "accepted"]);
    expect(rows[0].id).toBe("accepted");
  });

  it("filters before paging and returns only twenty authorized inbox items per page", async () => {
    const { db, state } = fake();
    for (let i = 0; i < 25; i++) state.handoffs.push(handoff({ id: `target-${i}`, sentAt: new Date(now.getTime() - i * 60_000) }));
    state.handoffs.push(handoff({ id: "other-center", toCenterId: 3, toUserId: "doctor-a" }));
    const first = await listInbox(actor("doctor-a"), { centerId: 2, page: 1, pageSize: 20 }, db);
    const second = await listInbox(actor("doctor-a"), { centerId: 2, page: 2, pageSize: 20 }, db);
    expect(first).toMatchObject({ total: 25, page: 1, pageSize: 20 });
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    expect([...first.items, ...second.items].map((row) => row.id)).not.toContain("other-center");
    await expect(listInbox(actor("doctor-a"), { page: 1, pageSize: 21 }, db)).rejects.toThrow();
  });

  it("lists only the actor's Baghdad-day sends and resolves the acceptor", async () => {
    const { db, state } = fake();
    state.handoffs.push(
      handoff({ id: "today", status: "ACCEPTED", acceptedById: "doctor-a", sentAt: new Date("2026-10-09T21:00:00Z") }),
      handoff({ id: "yesterday", sentAt: new Date("2026-10-09T20:59:59Z") }),
      handoff({ id: "other-sender", fromUserId: "doctor-b" }),
    );
    expect((await listSentToday(actor("sender"), db)).map((row) => ({ id: row.id, acceptorName: row.acceptorName }))).toEqual([{ id: "today", acceptorName: "علي حسين" }]);
    await expect(listSentToday(actor("sender", []), db)).rejects.toThrow("غير مصرح");
  });
  it("filters inbox by active membership or branch, explicit recipient, and accepted holder", async () => {
    const { db, state } = fake(); state.users.push(user("reception", "RECEPTION"));
    state.handoffs.push(
      handoff(), handoff({ id: "other-center", toCenterId: 3 }), handoff({ id: "other-role", toRole: "RESIDENT" }),
      handoff({ id: "assigned-other", toUserId: "doctor-b" }), handoff({ id: "mine-accepted", status: "ACCEPTED", acceptedById: "doctor-a" }),
      handoff({ id: "other-accepted", status: "ACCEPTED", acceptedById: "doctor-b" }), handoff({ id: "closed", status: "DONE", toUserId: "doctor-a" }),
      handoff({ id: "branch-mine", toRole: "RECEPTION", toCenterId: null }), handoff({ id: "branch-other", toRole: "RECEPTION", patientId: "patient-2" }),
    );
    expect((await listInbox(actor("doctor-a"), { page: 1, pageSize: 20 }, db)).items.map((row) => row.id).sort()).toEqual(["handoff-1", "mine-accepted"]);
    expect((await listInbox(actor("reception"), { page: 1, pageSize: 20 }, db)).items.map((row) => row.id)).toEqual(["branch-mine"]);
    await expect(acceptHandoff(actor("reception"), "branch-other", db)).rejects.toThrow();
    state.members.find((member) => member.userId === "doctor-a")!.status = "INACTIVE";
    expect((await listInbox(actor("doctor-a"), { page: 1, pageSize: 20 }, db)).items.map((row) => row.id)).toEqual([]);
    await expect(acceptHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow();
  });
  it("rejects inbox reads without receive permission", async () => {
    const { db } = fake();
    await expect(listInbox(actor("doctor-a", []), { page: 1, pageSize: 20 }, db)).rejects.toThrow("غير مصرح");
  });
  it("lists targets with names, specialties and load bands in one groupBy", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ toUserId: "doctor-a" }), handoff({ id: "accepted", status: "ACCEPTED", acceptedById: "doctor-a" }), handoff({ id: "closed", status: "DONE", toUserId: "doctor-a" }), handoff({ id: "unassigned" }));
    expect(await listTargets(actor(), 2, "DOCTOR", db)).toEqual([
      { userId: "doctor-a", name: "علي حسين", specialty: "تأهيل", load: "light" },
      { userId: "doctor-b", name: "علي حسين", specialty: null, load: "light" },
    ]);
    expect(state.groupByCalls).toBe(1);
  });
  it("uses the accepted holder for accepted rows and changes bands at 3 and 6", async () => {
    const { db, state } = fake();
    for (let i = 0; i < 3; i++) state.handoffs.push(handoff({ id: `sent-${i}`, toUserId: "doctor-a" }));
    for (let i = 0; i < 6; i++) state.handoffs.push(handoff({ id: `accepted-${i}`, status: "ACCEPTED", toUserId: "doctor-a", acceptedById: "doctor-b" }));
    expect((await listTargets(actor(), 2, "DOCTOR", db)).map((target) => target.load)).toEqual(["medium", "busy"]);
    expect(state.groupByCalls).toBe(1);
  });
  it("limits targets to the actor branch unless central view is granted", async () => {
    const { db, state } = fake();
    state.users.find((candidate) => candidate.id === "doctor-b")!.branchId = 2;
    expect((await listTargets(actor(), 2, "DOCTOR", db)).map((target) => target.userId)).toEqual(["doctor-a"]);
    expect((await listTargets(actor("sender", ["handoff.send", "centers.central.view"]), 2, "DOCTOR", db)).map((target) => target.userId)).toEqual(["doctor-a", "doctor-b"]);
    state.users.find((candidate) => candidate.id === "doctor-b")!.branchId = null;
    expect((await listTargets(actor(), 2, "DOCTOR", db)).map((target) => target.userId)).toEqual(["doctor-a", "doctor-b"]);
  });
  it("center pool delivery and acceptance follow the sender's branch (same rule as the selector)", async () => {
    const { db, state } = fake();
    state.users.find((candidate) => candidate.id === "doctor-b")!.branchId = 2; // another branch
    state.users.push(user("doctor-free", "DOCTOR", null as unknown as number));
    state.members.push({ userId: "doctor-free", centerId: 2, role: "SPECIALIST", status: "ACTIVE", specialty: null });
    // Sender (branch 1) reaches same-branch and branchless staff only; central view reaches all.
    expect(await resolveRecipients({ toCenterId: 2, toRole: "DOCTOR", senderBranchId: 1 }, db)).toEqual(["doctor-a", "doctor-free"]);
    expect(await resolveRecipients({ toCenterId: 2, toRole: "DOCTOR", senderBranchId: 1, senderCentral: true }, db)).toEqual(["doctor-a", "doctor-b", "doctor-free"]);
    // Acceptance: a pool handoff sent from branch 1 cannot be taken by the branch-2 member, even by direct request.
    state.handoffs.push(handoff({ id: "pool", toUserId: null, toCenterId: 2, fromUserId: "sender" }));
    await expect(acceptHandoff(actor("doctor-b", ["handoff.receive"]), "pool", db)).rejects.toThrow();
    expect(state.handoffs.find((row) => row.id === "pool")!.status).toBe("SENT");
    await expect(acceptHandoff(actor("doctor-a", ["handoff.receive"]), "pool", db)).resolves.toMatchObject({ status: "ACCEPTED" });
  });
  it("returns the latest open holder and ordered patient-only history", async () => {
    const { db, state } = fake();
    const older = new Date(now.getTime() - 60_000);
    state.handoffs.push(handoff({ sentAt: older }), handoff({ id: "current", status: "ACCEPTED", acceptedById: "doctor-a", acceptedAt: now }), handoff({ id: "closed", status: "DONE", sentAt: new Date(now.getTime() + 60_000) }), handoff({ id: "other-patient", patientId: "patient-2" }));
    expect(await currentHolder("patient-1", db)).toEqual({ handoffId: "current", person: { id: "doctor-a", name: "علي حسين" }, role: "DOCTOR", center: { id: 2, name: "المركز الثاني" }, since: now });
    expect((await history("patient-1", db)).map((row) => row.id)).toEqual(["closed", "current", "handoff-1"]);
    expect(await currentHolder("missing", db)).toBeNull();
  });
  it("returns the intended recipient and sent time for SENT handoffs", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff({ toUserId: "doctor-a" }));
    expect(await currentHolder("patient-1", db)).toMatchObject({ person: { id: "doctor-a" }, since: now });
    state.handoffs[0].toUserId = null;
    expect(await currentHolder("patient-1", db)).toMatchObject({ person: null, role: "DOCTOR" });
  });
  it("audits each successful send, accept and return exactly once without sensitive values", async () => {
    const { db, state } = fake();
    const sent = await sendHandoff(actor(), { ...send, note: "ملاحظة سرية" }, db);
    await acceptHandoff(actor("doctor-a"), sent.id, db);
    await returnHandoff(actor("doctor-a"), sent.id, "سبب سري", db);
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(state.audits.filter((entry) => entry.tableName === "queue_entries")).toEqual([expect.objectContaining({ recordId: state.queues[0].id })]);
    const calls = [...state.audits.filter((entry) => entry.tableName === "patient_handoffs"), ...vi.mocked(logAudit).mock.calls.map(([entry]) => entry)];
    expect(calls.map((entry) => entry.tableName)).toEqual(["patient_handoffs", "patient_handoffs", "patient_handoffs"]);
    expect(calls.map((entry) => entry.userId)).toEqual(["sender", "doctor-a", "doctor-a"]);
    expect(calls.map((entry) => entry.recordId)).toEqual([sent.id, sent.id, sent.id]);
    expect(JSON.stringify(calls)).not.toMatch(/ملاحظة سرية|سبب سري|علي حسين/);
  });
});

describe("send ownership, provenance and atomic side effects", () => {
  it.each(["SENT", "ACCEPTED"] as const)("rejects another holder's %s without any writes", async (status) => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ status, toUserId: "doctor-a", acceptedById: status === "ACCEPTED" ? "doctor-a" : null }));
    const before = structuredClone(state.handoffs);
    await expect(sendHandoff(actor(), send, db)).rejects.toThrow("المريض حالياً عند طبيب اختصاص – المركز الثاني");
    expect(state.handoffs).toEqual(before);
    expect(state.audits).toEqual([]);
    expect(state.notifications).toEqual([]);
  });

  it("an accepted holder cannot bypass a second open handoff", async () => {
    const { db, state } = fake();
    state.members[0].centerId = 2;
    state.handoffs.push(handoff({ toRole: "RESIDENT", status: "ACCEPTED", acceptedById: "sender" }), handoff({ id: "other-open" }));
    await expect(sendHandoff(actor(), send, db)).rejects.toThrow(/^المريض حالياً عند/);
    expect(state.handoffs.map((row) => row.status)).toEqual(["ACCEPTED", "SENT"]);
  });

  it.each(["permission", "MANAGER", "ADMIN"] as const)("permits takeover with %s and audits every cancellation", async (grant) => {
    const { db, state } = fake();
    if (grant !== "permission") state.users[0].role = grant;
    else state.members[0].centerId = 2;
    // Management takeover cancels others' tasks; it does not complete stale personal ownership.
    const ownsEligibleTask = grant === "permission";
    state.handoffs.push(
      handoff({ id: "sent-other" }),
      handoff({ id: "accepted-other", status: "ACCEPTED", acceptedById: "doctor-a" }),
      handoff({ id: "third", toRole: ownsEligibleTask ? "RESIDENT" : "DOCTOR", status: "ACCEPTED", acceptedById: ownsEligibleTask ? "sender" : "doctor-b" }),
      handoff({ id: "closed", status: "DONE" }),
      handoff({ id: "other-patient", patientId: "patient-2" }),
    );
    const sender = actor("sender", ["handoff.send", ...(grant === "permission" ? ["handoff.manage"] : [])]);
    const sent = await sendHandoff(sender, send, db);
    expect(state.handoffs.map((row) => row.status)).toEqual(["CANCELLED", "CANCELLED", ownsEligibleTask ? "DONE" : "CANCELLED", "DONE", "SENT", "SENT"]);
    expect(state.audits).toEqual([expect.objectContaining({ recordId: sent.id, userId: "sender", newValue: {
      toUserId: null, toRole: "DOCTOR", toCenterId: 2, fromCenterId: ownsEligibleTask ? 2 : 1,
      ...(ownsEligibleTask ? { previousHandoffId: "third" } : {}), cancelledHandoffIds: ownsEligibleTask ? ["sent-other", "accepted-other"] : ["third", "sent-other", "accepted-other"],
    } })]);
    expect(state.notifications).toHaveLength(2);
  });

  it("does not accept a forged ADMIN role as takeover authority", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff());
    await expect(sendHandoff({ ...actor(), role: "ADMIN" }, send, db)).rejects.toThrow(/^المريض حالياً عند/);
    expect(state.handoffs).toHaveLength(1);
  });

  it("allows only one of two concurrent sends for the same patient", async () => {
    const { db, state } = fake();
    const results = await Promise.allSettled([sendHandoff(actor(), send, db), sendHandoff(actor(), send, db)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(state.handoffs).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(state.notifications).toHaveLength(2);
  });

  it.each(["single", "none", "multiple", "expired", "future", "inactive"] as const)("derives source from %s active membership and ignores client data", async (scenario) => {
    const { db, state } = fake();
    const membership = state.members[0];
    membership.role = "SECRETARY"; // Source derivation is independent of role.
    if (scenario === "none") state.members.shift();
    if (scenario === "multiple") state.members.push({ ...membership, centerId: 2 });
    if (scenario === "expired") membership.endDate = new Date(now.getTime() - 1);
    if (scenario === "future") membership.startDate = new Date(now.getTime() + 1);
    if (scenario === "inactive") membership.status = "SUSPENDED";
    const created = await sendHandoff(actor(), { ...send, fromCenterId: 999 } as never, db);
    const expected = scenario === "single" ? 1 : null;
    expect(created.fromCenterId).toBe(expected);
    expect(state.audits[0].newValue).toMatchObject({ fromCenterId: expected });
  });

  it("preserves a null source on the accepted handoff instead of falling back to membership", async () => {
    const { db, state } = fake();
    state.users[0].role = "RECEPTION";
    state.handoffs.push(handoff({ toRole: "RECEPTION", status: "ACCEPTED", acceptedById: "sender", toCenterId: null }));
    expect((await sendHandoff(actor(), send, db)).fromCenterId).toBeNull();
  });

  it.each(["RECEPTION", "DATA_ENTRY"] as const)("rejects branchless %s targets including explicitly named users", async (toRole) => {
    const { db, state } = fake(); state.patients[0].branchId = null;
    state.users.push(user("reception", toRole));
    for (const toUserId of [undefined, "reception"]) {
      await expect(sendHandoff(actor(), { patientId: "patient-1", toRole, toUserId }, db)).rejects.toThrow("المراجع بلا فرع؛ حدّد فرعه أولاً قبل التحويل للاستقبال أو إدخال البيانات");
    }
    expect(state.handoffs).toEqual([]);
    expect(state.audits).toEqual([]);
    expect(state.notifications).toEqual([]);
  });

  it("notifies each resolved recipient with the patient and destination context", async () => {
    const { db, state } = fake();
    state.members.push({ ...state.members[1] });
    const first = await sendHandoff(actor(), { ...send, note: "ملاحظة سرية" }, db);
    const second = await sendHandoff(actor(), { ...send, patientId: "patient-2" }, db);
    expect(state.notifications).toHaveLength(4);
    for (const [sent, name] of [[first, "مراجع اختباري"], [second, "مراجع ثاني"]] as const) {
      expect(state.notifications.filter((row) => row.body === `المراجع: ${name}\nالوجهة: طبيب اختصاص - المركز الثاني\nرقم التحويلة: ${sent.id}`).map((row) => row.targetUserId)).toEqual(["doctor-a", "doctor-b"]);
    }
    expect(state.notifications.every((row) => row.link === "/my-work")).toBe(true);
    expect(JSON.stringify(state.notifications)).not.toMatch(/ملاحظة سرية|علي حسين|patient-1|patient-2/);
  });

  it("notifies only the named eligible recipient and audits that target", async () => {
    const { db, state } = fake();
    await sendHandoff(actor(), { ...send, toUserId: "doctor-b" }, db);
    expect(state.notifications.map((row) => row.targetUserId)).toEqual(["doctor-b"]);
    expect(state.audits[0].newValue).toMatchObject({ toUserId: "doctor-b", toRole: "DOCTOR", toCenterId: 2, fromCenterId: 1 });
  });

  it.each(["handoff", "audit", "notification"])("rolls back cancellation, completion, creation and side effects on %s failure", async (failure) => {
    const { db, state } = fake();
    state.members[0].centerId = 2;
    state.handoffs.push(handoff({ id: "mine", toRole: "RESIDENT", status: "ACCEPTED", acceptedById: "sender" }), handoff({ id: "other" }));
    const before = structuredClone(state.handoffs);
    state.failHandoffCreate = failure === "handoff";
    state.failAuditCreate = failure === "audit";
    state.failNotificationFor = failure === "notification" ? "doctor-b" : "";
    await expect(sendHandoff(actor("sender", ["handoff.send", "handoff.manage"]), send, db)).rejects.toThrow(`${failure} insert failed`);
    expect(state.handoffs).toEqual(before);
    expect(state.audits).toEqual([]);
    expect(state.notifications).toEqual([]);
  });
});

describe("dated membership and effective recipient permissions", () => {
  it.each(["DOCTOR", "SECRETARY"] as const)("uses inclusive date windows for %s resolution and target lists", async (toRole) => {
    const { db, state } = fake();
    const role = toRole === "DOCTOR" ? "SPECIALIST" : "SECRETARY";
    state.members = [];
    for (const id of ["current", "expired", "future"]) {
      state.users.push(user(id, toRole));
      state.members.push({ userId: id, role, centerId: 2, status: "ACTIVE", specialty: null,
        startDate: new Date(now.getTime() + (id === "future" ? 1 : 0)),
        endDate: new Date(now.getTime() - (id === "expired" ? 1 : 0)),
      });
    }
    expect(await resolveRecipients({ toRole, toCenterId: 2 }, db)).toEqual(["current"]);
    expect((await listTargets(actor(), 2, toRole, db)).map((row) => row.userId)).toEqual(["current"]);
    for (const toUserId of ["expired", "future"]) {
      expect(await resolveRecipients({ toRole, toCenterId: 2, toUserId }, db)).toEqual([]);
      await expect(sendHandoff(actor(), { ...send, toRole, toUserId }, db)).rejects.toThrow(/^هذا المركز ما بيه/);
    }
    expect(state.handoffs).toEqual([]);
  });

  it.each(["handoff.receive", "handoff.send"])("excludes role and user denials of %s, with user overrides applied last", async (permKey) => {
    const { db, state } = fake();
    state.userPermissions.push({ userId: "doctor-a", permKey, allowed: false });
    expect(await resolveRecipients({ toRole: "DOCTOR", toCenterId: 2 }, db)).toEqual(["doctor-b"]);
    expect(await resolveRecipients({ toUserId: "doctor-a" }, db)).toEqual([]);
    expect((await listTargets(actor(), 2, "DOCTOR", db)).map((row) => row.userId)).toEqual(["doctor-b"]);
    await expect(sendHandoff(actor(), { ...send, toUserId: "doctor-a" }, db)).rejects.toThrow(/^هذا المركز ما بيه/);
    state.rolePermissions.push({ role: "DOCTOR", permKey, allowed: false });
    expect(await resolveRecipients({ toRole: "DOCTOR", toCenterId: 2 }, db)).toEqual([]);
    expect(await listTargets(actor(), 2, "DOCTOR", db)).toEqual([]);
    state.userPermissions.push({ userId: "doctor-b", permKey, allowed: true });
    expect(await resolveRecipients({ toRole: "DOCTOR", toCenterId: 2 }, db)).toEqual(["doctor-b"]);
    await sendHandoff(actor(), send, db);
    expect(state.notifications.map((row) => row.targetUserId)).toEqual(["doctor-b"]);
  });

  it("checks branch and explicit recipients' effective permissions too", async () => {
    const { db, state } = fake();
    state.users.push(user("reception", "RECEPTION"));
    state.userPermissions.push({ userId: "reception", permKey: "handoff.receive", allowed: false });
    expect(await resolveRecipients({ toRole: "RECEPTION", patientBranchId: 1 }, db)).toEqual([]);
    expect(await resolveRecipients({ toUserId: "reception" }, db)).toEqual([]);
    expect(await resolveRecipients({ toUserId: "reception", toRole: "RECEPTION", patientBranchId: 2 }, db)).toEqual([]);
  });

  it("fails closed if the permission store cannot be read", async () => {
    const { db, state } = fake();
    db.userPermission.findMany = async () => { throw new Error("private database error"); };
    await expect(sendHandoff(actor(), send, db)).rejects.toThrow("تعذر التحقق من الصلاحيات");
    expect(state.handoffs).toEqual([]);
    expect(state.audits).toEqual([]);
    expect(state.notifications).toEqual([]);
  });
});

describe("finish, cancel, and redirect handoffs", () => {
  it("lets only the accepting user finish ACCEPTED and records the transition", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ status: "ACCEPTED", acceptedById: "doctor-a", acceptedAt: now }));
    state.notifications.push({ id: "notice", handoffId: "handoff-1", read: false, title: "تسليم مراجع جديد", body: "رقم التسليم: handoff-1" });
    await finishHandoff(actor("doctor-a"), "handoff-1", db);
    expect(state.handoffs[0]).toMatchObject({ status: "DONE", doneAt: now });
    expect(state.notifications[0]).toMatchObject({ read: true });
    expect(state.audits).toEqual([expect.objectContaining({ userId: "doctor-a", recordId: "handoff-1",
      oldValue: expect.objectContaining({ status: "ACCEPTED" }), newValue: expect.objectContaining({ status: "DONE" }) })]);
  });

  it.each([
    ["another user", "ACCEPTED", "doctor-a"],
    ["unaccepted", "SENT", null],
  ] as const)("rejects finishing %s without changing the handoff", async (_case, status, acceptedById) => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ status, acceptedById }));
    await expect(finishHandoff(actor("doctor-b"), "handoff-1", db)).rejects.toThrow("استلمها شخص آخر");
    expect(state.handoffs[0]).toMatchObject({ status, doneAt: null });
    expect(state.audits).toEqual([]);
  });

  it("lets the sender cancel SENT and audits the transition", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff());
    state.notifications.push({ id: "legacy-notice", read: false, title: "تسليم مراجع جديد", body: "رقم التسليم: handoff-1" });
    await cancelHandoff(actor("sender"), "handoff-1", db);
    expect(state.handoffs[0].status).toBe("CANCELLED");
    expect(state.notifications[0]).toMatchObject({ read: true });
    expect(state.audits).toEqual([expect.objectContaining({ userId: "sender", recordId: "handoff-1",
      oldValue: expect.objectContaining({ status: "SENT" }), newValue: expect.objectContaining({ status: "CANCELLED" }) })]);
  });

  it("lets a real manager cancel, but rejects a forged manager role", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff());
    state.users.push(user("manager", "MANAGER"));
    await expect(cancelHandoff({ ...actor("doctor-a"), role: "MANAGER" }, "handoff-1", db)).rejects.toThrow();
    expect(state.handoffs[0].status).toBe("SENT");
    await cancelHandoff({ ...actor("manager", []), role: "MANAGER" }, "handoff-1", db);
    expect(state.handoffs[0].status).toBe("CANCELLED");
  });

  it.each(["ACCEPTED", "DONE"] as const)("rejects cancellation after %s", async (status) => {
    const { db, state } = fake(); state.handoffs.push(handoff({ status }));
    await expect(cancelHandoff(actor("sender"), "handoff-1", db)).rejects.toThrow("استلمها شخص آخر");
    expect(state.handoffs[0].status).toBe(status);
    expect(state.audits).toEqual([]);
  });

  it("rejects cancellation by an unrelated active user", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff());
    await expect(cancelHandoff(actor("doctor-a"), "handoff-1", db)).rejects.toThrow();
    expect(state.handoffs[0].status).toBe("SENT");
    expect(state.audits).toEqual([]);
  });

  it("redirects within the target center and preserves the note with audited atomic writes", async () => {
    const { db, state } = fake();
    state.users.push(user("secretary", "SECRETARY"));
    state.members.push({ userId: "secretary", centerId: 2, role: "SECRETARY", status: "ACTIVE", specialty: null });
    state.handoffs.push(handoff({ note: "ملاحظة سرية" }));
    const created = await redirectHandoff({ ...actor("secretary"), role: "SECRETARY" }, "handoff-1", { toRole: "DOCTOR", toUserId: "doctor-b" }, db);
    expect(state.handoffs[0].status).toBe("CANCELLED");
    expect(created).toMatchObject({ patientId: "patient-1", status: "SENT", toCenterId: 2, toUserId: "doctor-b", toRole: "DOCTOR", note: "ملاحظة سرية", previousHandoffId: "handoff-1" });
    expect(state.notifications.map((row) => row.targetUserId)).toEqual(["doctor-b"]);
    expect(state.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "secretary", recordId: "handoff-1", oldValue: expect.objectContaining({ status: "SENT" }), newValue: expect.objectContaining({ status: "CANCELLED" }) }),
      expect.objectContaining({ userId: "secretary", recordId: created.id, newValue: expect.objectContaining({ status: "SENT" }) }),
    ]));
    expect(JSON.stringify(state.audits)).not.toContain("ملاحظة سرية");
  });

  it("rejects a non-member, expired membership, wrong-center target, and accepted handoff", async () => {
    const { db, state } = fake(); state.handoffs.push(handoff());
    const target = { toRole: "DOCTOR" as const, toUserId: "doctor-b" };
    await expect(redirectHandoff(actor("doctor-a"), "handoff-1", target, db)).rejects.toThrow();
    state.users.push(user("secretary", "SECRETARY"));
    state.members.push({ userId: "secretary", centerId: 1, role: "SECRETARY", status: "ACTIVE", specialty: null });
    const secretary = { ...actor("secretary"), role: "SECRETARY" as const };
    await expect(redirectHandoff(secretary, "handoff-1", target, db)).rejects.toThrow();
    state.members.at(-1)!.centerId = 2;
    state.members.at(-1)!.endDate = new Date(now.getTime() - 1);
    await expect(redirectHandoff(secretary, "handoff-1", target, db)).rejects.toThrow();
    state.members.at(-1)!.endDate = null;
    await expect(redirectHandoff(secretary, "handoff-1", { ...target, toCenterId: 1 } as never, db)).rejects.toThrow();
    state.handoffs[0].status = "ACCEPTED";
    await expect(redirectHandoff(secretary, "handoff-1", target, db)).rejects.toThrow();
    expect(state.handoffs).toHaveLength(1);
    expect(state.notifications).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it.each(["handoff", "audit", "notification"])("rolls redirect back on %s failure", async (failure) => {
    const { db, state } = fake();
    state.users.push(user("secretary", "SECRETARY"));
    state.members.push({ userId: "secretary", centerId: 2, role: "SECRETARY", status: "ACTIVE", specialty: null });
    state.handoffs.push(handoff());
    state.failHandoffCreate = failure === "handoff";
    state.failAuditCreate = failure === "audit";
    state.failNotificationFor = failure === "notification" ? "doctor-b" : "";
    await expect(redirectHandoff({ ...actor("secretary"), role: "SECRETARY" }, "handoff-1", { toRole: "DOCTOR", toUserId: "doctor-b" }, db)).rejects.toThrow();
    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0].status).toBe("SENT");
    expect(state.audits).toEqual([]);
    expect(state.notifications).toEqual([]);
  });
});

describe("transition permissions and archived patients", () => {
  it("rejects finishing without handoff.receive, unless the user manages handoffs", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff({ status: "ACCEPTED", acceptedById: "doctor-a", acceptedAt: now }));
    await expect(finishHandoff(actor("doctor-a", ["handoff.send"]), "handoff-1", db)).rejects.toThrow("غير مصرح");
    expect(state.handoffs[0].status).toBe("ACCEPTED");
    await finishHandoff(actor("doctor-a", ["handoff.manage"]), "handoff-1", db);
    expect(state.handoffs[0].status).toBe("DONE");
  });

  it("rejects cancel and redirect without handoff.send", async () => {
    const { db, state } = fake();
    state.users.push(user("secretary", "SECRETARY"));
    state.members.push({ userId: "secretary", centerId: 2, role: "SECRETARY", status: "ACTIVE", specialty: null });
    state.handoffs.push(handoff());
    await expect(cancelHandoff(actor("sender", ["handoff.receive"]), "handoff-1", db)).rejects.toThrow("غير مصرح");
    await expect(redirectHandoff({ ...actor("secretary", ["handoff.receive"]), role: "SECRETARY" }, "handoff-1", { toRole: "DOCTOR", toUserId: "doctor-b" }, db)).rejects.toThrow("غير مصرح");
    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0].status).toBe("SENT");
    expect(state.audits).toEqual([]);
  });

  it("refuses to send or redirect for an archived patient", async () => {
    const { db, state } = fake();
    (state.patients[0] as Record<string, unknown>).archivedAt = now;
    await expect(sendHandoff(actor(), send, db)).rejects.toThrow("ملف المراجع غير متاح");
    expect(state.handoffs).toEqual([]);
    state.users.push(user("secretary", "SECRETARY"));
    state.members.push({ userId: "secretary", centerId: 2, role: "SECRETARY", status: "ACTIVE", specialty: null });
    state.handoffs.push(handoff());
    await expect(redirectHandoff({ ...actor("secretary"), role: "SECRETARY" }, "handoff-1", { toRole: "DOCTOR", toUserId: "doctor-b" }, db)).rejects.toThrow("ملف المراجع غير متاح");
    expect(state.handoffs).toHaveLength(1);
    expect(state.handoffs[0].status).toBe("SENT");
  });
});

describe("patient handoff closure", () => {
  it("closes only the patient's open handoffs and audits each transition", async () => {
    const { db, state } = fake();
    state.handoffs.push(handoff(), handoff({ id: "accepted", status: "ACCEPTED", acceptedById: "doctor-a" }), handoff({ id: "closed", status: "CANCELLED" }), handoff({ id: "other-patient", patientId: "patient-2" }));
    state.notifications.push(
      { id: "open-notice", handoffId: "handoff-1", read: false },
      { id: "accepted-notice", handoffId: "accepted", read: false },
      { id: "other-notice", handoffId: "other-patient", read: false },
    );
    await db.$transaction((tx) => closeOpenHandoffsForPatient(tx, "patient-1", "sender", "ARCHIVED"), { isolationLevel: "Serializable" });
    expect(state.handoffs.map((row) => row.status)).toEqual(["DONE", "DONE", "CANCELLED", "SENT"]);
    expect(state.handoffs[0].doneAt).toEqual(expect.any(Date));
    expect(state.handoffs[1].doneAt).toEqual(expect.any(Date));
    expect(state.audits).toHaveLength(2);
    expect(state.audits.map((entry) => entry.recordId).sort()).toEqual(["accepted", "handoff-1"]);
    expect(state.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "sender", recordId: "handoff-1", oldValue: { status: "SENT" }, newValue: { status: "DONE", reason: "ARCHIVED" } }),
      expect.objectContaining({ userId: "sender", recordId: "accepted", oldValue: { status: "ACCEPTED" }, newValue: { status: "DONE", reason: "ARCHIVED" } }),
    ]));
    expect(state.notifications.map((row) => row.read)).toEqual([true, true, false]);
  });
});
