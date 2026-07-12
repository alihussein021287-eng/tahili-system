import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

const access = vi.hoisted(() => ({
  assertPerm: vi.fn(async () => undefined),
  requireSession: vi.fn(async () => ({ user: { id: "user-1", name: "موظف الاستقبال", role: "RECEPTION" } })),
}));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => { throw new RedirectSignal(url); }),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

type Store = {
  patients: any[];
  visits: any[];
  queues: any[];
  stages: any[];
  notifications: any[];
  audits: any[];
};

let store: Store;
let failAt: "notification" | null = null;
let transactionErrors: Array<Error & { code?: string }> = [];
let id = 0;

function cloneStore(value: Store): Store {
  return structuredClone(value);
}

function createTransaction(draft: Store) {
  return {
    patient: {
      findUnique: vi.fn(async ({ where }: any) => draft.patients.find((p) => p.id === where.id) ?? null),
    },
    visit: {
      findFirst: vi.fn(async ({ where }: any) => draft.visits.find((v) =>
        v.patientId === where.patientId && v.visitDate >= where.visitDate.gte && v.visitDate < where.visitDate.lt,
      ) ?? null),
      count: vi.fn(async ({ where }: any) => draft.visits.filter((v) => v.patientId === where.patientId).length),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `visit-${++id}`, visitDate: new Date(), ...data };
        draft.visits.push(row);
        return row;
      }),
    },
    queueEntry: {
      findFirst: vi.fn(async ({ where }: any) => draft.queues.find((q) =>
        q.patientId === where.patientId
        && q.createdAt >= where.createdAt.gte
        && q.createdAt < where.createdAt.lt
        && where.status.in.includes(q.status),
      ) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `queue-${++id}`, status: "WAITING", createdAt: new Date(), ...data };
        draft.queues.push(row);
        return row;
      }),
    },
    careStage: {
      findFirst: vi.fn(async ({ where }: any) => draft.stages.find((s) => {
        const stationMatches = typeof where.station === "string"
          ? s.station === where.station
          : where.station.in.includes(s.station);
        if (s.patientId !== where.patientId || !stationMatches) return false;
        return where.OR.some((condition: any) => condition.status
          ? condition.status.in.includes(s.status)
          : s.createdAt >= condition.createdAt.gte && s.createdAt < condition.createdAt.lt);
      }) ?? null),
      aggregate: vi.fn(async ({ where }: any) => ({
        _max: {
          sequence: draft.stages
            .filter((s) => s.patientId === where.patientId)
            .reduce((max, s) => Math.max(max, s.sequence), -1),
        },
      })),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `stage-${++id}`, status: "WAITING", createdAt: new Date(), ...data };
        draft.stages.push(row);
        return row;
      }),
    },
    notification: {
      findFirst: vi.fn(async ({ where }: any) => draft.notifications.find((n) =>
        n.title === where.title
        && n.body === where.body
        && n.link === where.link
        && n.targetRole === where.targetRole
        && n.createdAt >= where.createdAt.gte,
      ) ?? null),
      create: vi.fn(async ({ data }: any) => {
        if (failAt === "notification") throw new Error("notification failed");
        const row = { id: `notification-${++id}`, read: false, createdAt: new Date(), ...data };
        draft.notifications.push(row);
        return row;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `audit-${++id}`, createdAt: new Date(), ...data };
        draft.audits.push(row);
        return row;
      }),
    },
  };
}

const db = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(async (work: (tx: any) => Promise<any>) => {
      const transactionError = transactionErrors.shift();
      if (transactionError) throw transactionError;
      const draft = cloneStore(store);
      const result = await work(createTransaction(draft));
      store = draft;
      return result;
    }),
  },
}));

vi.mock("@/lib/access", () => access);
vi.mock("@/lib/db", () => db);
vi.mock("next/navigation", () => navigation);
vi.mock("next/cache", () => cache);

import { receptionCheckIn } from "@/app/(app)/visits/actions";

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  data.set("patientId", "patient-1");
  data.set("returnTo", "/visits");
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function submit(values: Record<string, string> = {}) {
  try {
    await receptionCheckIn(form(values));
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("expected redirect");
}

beforeEach(() => {
  id = 0;
  failAt = null;
  transactionErrors = [];
  store = {
    patients: [{ id: "patient-1", fullName: "مراجع تجريبي", fileNumber: 42, archivedAt: null }],
    visits: [], queues: [], stages: [], notifications: [], audits: [],
  };
  vi.clearAllMocks();
  access.assertPerm.mockResolvedValue(undefined);
  access.requireSession.mockResolvedValue({ user: { id: "user-1", name: "موظف الاستقبال", role: "RECEPTION" } });
});

describe("reception check-in workflow", () => {
  it("records attendance without a destination and creates no stage or notification", async () => {
    await submit();
    expect(store.visits).toHaveLength(1);
    expect(store.stages).toHaveLength(0);
    expect(store.notifications).toHaveLength(0);
  });

  it("records attendance with an approved destination", async () => {
    const url = await submit({ destination: "صيدلية" });
    expect(url).toContain(encodeURIComponent("تم التحويل إلى صيدلية"));
    expect(store.visits).toHaveLength(1);
    expect(store.stages).toHaveLength(1);
  });

  it("normalizes a destination alias before creating the stage", async () => {
    await submit({ destination: "الصيدلية" });
    expect(store.stages).toMatchObject([{ station: "صيدلية", responsibleRole: "PHARMACIST" }]);
    expect(store.notifications[0]).toMatchObject({ targetRole: "PHARMACIST" });
  });

  it("derives the responsible role from the central station definition", async () => {
    await submit({ destination: "الأشعة" });
    expect(store.stages[0]).toMatchObject({ station: "الأشعة", responsibleRole: "RADIOLOGY" });
  });

  it("creates one notification for the destination role", async () => {
    await submit({ destination: "صيدلية" });
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0]).toMatchObject({ targetRole: "PHARMACIST", link: "/patients/patient-1" });
  });

  it("adds the patient to today's queue when requested", async () => {
    await submit({ sendQueue: "1", hall: "قاعة العلاج المائي" });
    expect(access.assertPerm).toHaveBeenCalledWith("queue.manage");
    expect(store.queues).toHaveLength(1);
  });

  it("does not create a duplicate queue entry on resubmission", async () => {
    await submit({ sendQueue: "1", hall: "قاعة العلاج المائي" });
    await submit({ sendQueue: "1", hall: "قاعة العلاج المائي" });
    expect(store.queues).toHaveLength(1);
  });

  it("does not create a duplicate visit on resubmission", async () => {
    await submit();
    await submit();
    expect(store.visits).toHaveLength(1);
  });

  it("does not create a duplicate active stage on resubmission", async () => {
    await submit({ destination: "المختبر" });
    await submit({ destination: "المختبر" });
    expect(store.stages).toHaveLength(1);
  });

  it("treats a central station alias as the same active destination", async () => {
    store.stages.push({
      id: "existing-stage",
      patientId: "patient-1",
      station: "الصيدلية",
      responsibleRole: "PHARMACIST",
      sequence: 0,
      status: "WAITING",
      createdAt: new Date(),
    });
    await submit({ destination: "صيدلية" });
    expect(store.stages).toHaveLength(1);
    expect(store.notifications).toHaveLength(0);
  });

  it("does not create a duplicate notification on resubmission", async () => {
    await submit({ destination: "المختبر" });
    await submit({ destination: "المختبر" });
    expect(store.notifications).toHaveLength(1);
  });

  it("does not deduplicate notifications for different destinations", async () => {
    await submit({ destination: "المختبر" });
    await submit({ destination: "الأشعة" });
    expect(store.notifications).toHaveLength(2);
    expect(store.notifications.map((n) => n.targetRole)).toEqual(["LAB", "RADIOLOGY"]);
  });

  it("rejects an unknown destination before opening a transaction", async () => {
    const url = await submit({ destination: "محطة غير موجودة" });
    expect(url).toContain(encodeURIComponent("الوجهة التالية غير معتمدة"));
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a user without visits.manage", async () => {
    access.assertPerm.mockRejectedValueOnce(new Error("غير مصرّح"));
    await expect(receptionCheckIn(form())).rejects.toThrow("غير مصرّح");
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps medical details out of the notification text", async () => {
    await submit({ destination: "طبيب/تشخيص", notes: "تشخيص سري وأدوية حساسة" });
    const notification = store.notifications[0];
    expect(notification.body).toBe("مراجع تجريبي (#42)، الوجهة: طبيب/تشخيص");
    expect(notification.body).not.toContain("تشخيص سري");
  });

  it("rolls back visit, queue, stage, notification, and audit when a step fails", async () => {
    failAt = "notification";
    await expect(receptionCheckIn(form({ destination: "صيدلية", sendQueue: "1" }))).rejects.toThrow("notification failed");
    expect(store.visits).toHaveLength(0);
    expect(store.queues).toHaveLength(0);
    expect(store.stages).toHaveLength(0);
    expect(store.notifications).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("uses a serializable transaction for concurrent deduplication", async () => {
    await submit({ destination: "صيدلية" });
    expect(db.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("retries P2034 conflicts no more than three times", async () => {
    transactionErrors = [
      Object.assign(new Error("conflict 1"), { code: "P2034" }),
      Object.assign(new Error("conflict 2"), { code: "P2034" }),
    ];
    await submit();
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(store.visits).toHaveLength(1);
  });

  it("returns a clear error after the third P2034 conflict", async () => {
    transactionErrors = [1, 2, 3].map((n) => Object.assign(new Error(`conflict ${n}`), { code: "P2034" }));
    await expect(receptionCheckIn(form())).rejects.toThrow("تعذّر تسجيل الحضور بسبب تعارض متزامن. حاول مرة أخرى.");
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(store.visits).toHaveLength(0);
  });

  it("does not retry transaction errors other than P2034", async () => {
    transactionErrors = [Object.assign(new Error("database unavailable"), { code: "P1001" })];
    await expect(receptionCheckIn(form())).rejects.toThrow("database unavailable");
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
