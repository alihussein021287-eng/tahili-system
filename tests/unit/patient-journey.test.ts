import { describe, expect, it } from "vitest";
import { derivePatientJourney, nextPatientStep } from "@/lib/patient-journey";

const registrationDate = new Date("2026-07-20T07:00:00.000Z");
const now = new Date("2026-07-24T09:00:00.000Z");

describe("derived patient journey", () => {
  it("does not assume that referral and therapy are required without evidence", () => {
    const stages = derivePatientJourney({ id: "p1", registrationDate }, now);
    expect(stages.find((stage) => stage.key === "registration")?.status).toBe("complete");
    expect(stages.find((stage) => stage.key === "referral")?.status).toBe("not_required");
    expect(stages.find((stage) => stage.key === "sessions")?.status).toBe("not_required");
  });

  it("derives a blocked referral and current treatment only from existing records", () => {
    const stages = derivePatientJourney({
      id: "p1",
      registrationDate,
      visits: [{ visitDate: new Date("2026-07-21T08:00:00.000Z") }],
      residentReviews: [{ date: new Date("2026-07-21T09:00:00.000Z"), referralNeeded: true }],
      referralRequests: [{ status: "SENT", createdAt: new Date("2026-07-21T10:00:00.000Z"), updatedAt: new Date("2026-07-22T10:00:00.000Z") }],
      treatmentPlans: [{ status: "ACTIVE", createdAt: new Date("2026-07-23T10:00:00.000Z"), periodicEvaluations: [] }],
    }, now);
    expect(stages.find((stage) => stage.key === "referral")?.status).toBe("complete");
    expect(stages.find((stage) => stage.key === "sessions")?.status).toBe("current");
    expect(stages.find((stage) => stage.key === "evaluation")?.status).toBe("upcoming");
  });

  it("selects the next step only when one of its route permissions is effective", () => {
    const stages = derivePatientJourney({
      id: "p1",
      registrationDate,
      visits: [{ visitDate: new Date("2026-07-21T08:00:00.000Z") }],
    }, now);
    expect(nextPatientStep(stages, new Set(["visits.view"]))?.key).toBe("intake");
    expect(nextPatientStep(stages, new Set())).toBeNull();
  });
});
