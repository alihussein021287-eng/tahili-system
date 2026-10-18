import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/admin-config", () => ({ getAdminConfig: vi.fn().mockResolvedValue(null) }));
const notifyUserInTransaction = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/notify", async (importOriginal) => ({ ...(await importOriginal<any>()), notifyUserInTransaction: (...args: unknown[]) => notifyUserInTransaction(...args) }));

import { handOverInTransaction } from "@/lib/handoff-service";

const PATIENT = "ckpatient0000000000000001";
const ACTOR = "ckheadtherapist0000000001";
const THERAPIST = "cktherapist00000000000001";

function fakeTx(open: any[]) {
  const handoffs = [...open];
  const audits: any[] = [];
  return {
    handoffs, audits,
    patientHandoff: {
      findMany: async ({ where }: any) => handoffs.filter((h) => h.patientId === where.patientId && where.status.in.includes(h.status)),
      updateMany: async ({ where, data }: any) => { const h = handoffs.find((x) => x.id === where.id && x.status === where.status); if (!h) return { count: 0 }; Object.assign(h, data); return { count: 1 }; },
      create: async ({ data }: any) => { const row = { id: `h${handoffs.length + 1}`, ...data }; handoffs.push(row); return row; },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } },
  };
}

describe("automatic handover in the therapy flow", () => {
  it("closes the open handoff and opens one to the named therapist", async () => {
    const tx = fakeTx([{ id: "old", patientId: PATIENT, status: "ACCEPTED", toRole: "DOCTOR" }]);
    const created = await handOverInTransaction(tx as any, { patientId: PATIENT, actorId: ACTOR, actorRole: "HEAD_THERAPIST", toRole: "THERAPIST", toUserId: THERAPIST, toCenterId: 3, note: "برنامج علاج طبيعي" });
    expect(tx.handoffs.find((h) => h.id === "old")?.status).toBe("DONE");
    expect(created).toMatchObject({ toUserId: THERAPIST, toRole: "THERAPIST", toCenterId: 3, status: "SENT" });
    expect(tx.handoffs.filter((h) => ["SENT", "ACCEPTED"].includes(h.status))).toHaveLength(1);
    expect(tx.audits.some((a) => a.newValue?.automatic === true)).toBe(true);
    expect(notifyUserInTransaction).toHaveBeenCalledWith(tx, THERAPIST, "تسليم مراجع جديد", expect.objectContaining({ link: "/my-work" }));
  });
});

const actions = readFileSync("src/app/(app)/therapy/actions.ts", "utf8");
const referrals = readFileSync("src/lib/referral-service.ts", "utf8");
const tabs = readFileSync("src/components/PatientTabs.tsx", "utf8");
const today = readFileSync("src/app/(app)/therapy/today/page.tsx", "utf8");

describe("therapy flow contracts", () => {
  it("numbers every programme appointment as session n of N", () => {
    expect(actions).toContain("جلسة علاج طبيعي ${index + 1} من ${dates.length}");
    expect(actions).toMatch(/\(تمديد\)/);
  });

  it("hands the patient to the therapist on create and back to the specialist on finish", () => {
    expect(actions).toMatch(/handOverInTransaction\(tx as any, \{[^}]*toRole: "THERAPIST"/s);
    expect(actions).toMatch(/handOverInTransaction\(tx as any, \{[^}]*toRole: "DOCTOR"/s);
    expect(actions).not.toMatch(/careStage\.create/);
  });

  it("lets only the assigned therapist or the centre head reschedule, with a clash check", () => {
    expect(actions).toContain("export async function rescheduleTherapyAppointment");
    expect(actions).toContain('assertPerm("therapy.schedule.reschedule")');
    expect(actions).toContain("assertCenterManager(tx, who, appointment.session.centerId)");
    expect(actions).toContain("تعارض بنفس الوقت مع");
    expect(today).toContain("rescheduleTherapyAppointment");
  });

  it("accepts a suggested therapist only for an internal-centre referral from that centre", () => {
    expect(referrals).toContain("المعالج المقترح ليس معالجاً فعالاً في هذا المركز");
    expect(referrals).toContain("suggestedTherapistId");
  });

  it("keeps one therapy flow in the patient file: no old scheduler or manual session entry", () => {
    expect(tabs).not.toContain("SchedulePlanner");
    expect(tabs).not.toContain('addLabel="+ جلسة"');
    expect(tabs).toContain("سجل قديم (قبل برنامج العلاج)");
  });
});
