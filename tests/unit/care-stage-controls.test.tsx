import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/app/(app)/patients/actions", () => ({ confirmStage: vi.fn(), reassignStageAction: vi.fn(), completeStageWorkAction: vi.fn() }));
import { CareStageConfirmations } from "@/components/patients/CareStageConfirmations";
const stage = { id: "synthetic-stage", station: "Synthetic center", responsibleRole: "HEAD_THERAPIST", status: "IN_PROGRESS", responsibilityScope: "CENTER", assignedUserId: "head", assignedName: "Synthetic head", specialistBound: false, reassignCandidates: null, requiresPhysicianConfirmation: true, updatedAt: "2026-10-27T01:00:00.000Z" };
function view(role: string, extra: object = {}) { return renderToStaticMarkup(<CareStageConfirmations patientId="synthetic-patient" patientName="Synthetic patient" fileNumber="1" stages={[{ ...stage, ...extra }]} userRole={role} userId={role === "HEAD_THERAPIST" ? "head" : "doctor"} canConfirm canSend={false} canAssign={false} />); }
describe("separate operational and physician controls", () => {
  it("shows the responsible worker completion without offering medical confirmation", () => {
    const html = view("HEAD_THERAPIST", { canCompleteWork: true });
    expect(html).toContain("توثيق إكمال العمل"); expect(html).not.toContain(">تأكيد الطبيب<");
  });
  it("keeps even a named eligible physician pending until designation authority is approved", () => {
    const extra = { operationalCompletedAt: "2026-10-27T01:01:00.000Z" };
    expect(view("DOCTOR", { ...extra, canPhysicianConfirm: true })).not.toContain(">تأكيد الطبيب<");
    const denied = view("DOCTOR", extra); expect(denied).not.toContain(">تأكيد الطبيب<"); expect(denied).toContain("جهة تعيين المراجع الطبي");
  });
  it("offers historical CENTER operational completion without inferring clinical classification", () => {
    const html = view("HEAD_THERAPIST", { requiresPhysicianConfirmation: null, canCompleteWork: true });
    expect(html).toContain("توثيق إكمال العمل"); expect(html).not.toContain(">تأكيد الطبيب<");
    expect(html).toContain("لا اعتماد طبي رجعي");
  });
  it("shows a controlled reconciliation hint for ambiguous ownership without offering an action", () => {
    const html = view("HEAD_THERAPIST", { requiresPhysicianConfirmation: null, responsibleRole: null });
    expect(html).toContain("تسوية موثقة"); expect(html).not.toContain(">توثيق إكمال العمل<");
  });
  it("does not fabricate a medical action for unclassified legacy history", () => {
    const html = view("DOCTOR", { requiresPhysicianConfirmation: null });
    expect(html).toContain("تصنيف التأكيد غير موثق"); expect(html).not.toContain(">تأكيد الطبيب<");
  });
});
