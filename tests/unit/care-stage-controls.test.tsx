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
  it("shows pending review and a separate action only to an eligible physician", () => {
    const extra = { operationalCompletedAt: "2026-10-27T01:01:00.000Z" };
    expect(view("DOCTOR", { ...extra, canPhysicianConfirm: true })).toContain(">تأكيد الطبيب<");
    const denied = view("DOCTOR", extra); expect(denied).not.toContain(">تأكيد الطبيب<"); expect(denied).toContain("بانتظار التأكيد الطبي الصريح");
  });
  it("does not fabricate a medical action for unclassified legacy history", () => {
    const html = view("DOCTOR", { requiresPhysicianConfirmation: null });
    expect(html).toContain("تصنيف التأكيد غير موثق"); expect(html).not.toContain(">تأكيد الطبيب<");
  });
});
