import { describe, expect, it } from "vitest";
import { derivePatientPath, PATH_STAGES } from "@/lib/patient-path";
import { PATIENT_NAV, PATIENT_TABS, patientNavFor } from "@/lib/patient-tab-policy";

const now = new Date("2026-10-10T12:00:00Z");
const statusOf = (result: ReturnType<typeof derivePatientPath>, key: string) => result.stages.find((stage) => stage.key === key)?.status;

describe("patient path", () => {
  it("follows the real order of work, with reception and resident as separate stages", () => {
    expect(PATH_STAGES.map((stage) => stage.label)).toEqual(["الاستقبال", "إدخال البيانات", "السكرتارية", "الطبيب المقيم", "الاختصاص", "العلاج", "الجلسات والتقييم", "المتابعة"]);
  });

  it("puts the patient where the open handoff is, so the bar matches 'now with'", () => {
    const path = derivePatientPath({ dataEntryBy: "علي", handoffs: [{ toRole: "SECRETARY", status: "ACCEPTED", sentAt: now }] }, now);
    expect(statusOf(path, "secretary")).toBe("current");
    expect(statusOf(path, "reception")).toBe("complete");
    expect(statusOf(path, "dataEntry")).toBe("complete");
    expect(statusOf(path, "resident")).toBe("pending");
    expect(path.next?.label).toBe("الطبيب المقيم");
    expect(path.stages.filter((stage) => stage.status === "current")).toHaveLength(1);
  });

  it("shows a stage the patient went past without a record as skipped, not late", () => {
    const path = derivePatientPath({ dataEntryBy: "علي", handoffs: [
      { toRole: "DOCTOR", status: "SENT", sentAt: now },
      { toRole: "SECRETARY", status: "DONE", sentAt: new Date(now.getTime() - 3_600_000) },
    ] }, now);
    expect(statusOf(path, "specialist")).toBe("current");
    expect(statusOf(path, "secretary")).toBe("complete");
    expect(statusOf(path, "resident")).toBe("skipped");
  });

  it("without an open handoff, an active plan means sessions and a finished one means follow-up", () => {
    expect(statusOf(derivePatientPath({ treatmentPlans: [{ status: "ACTIVE" }] }, now), "sessions")).toBe("current");
    expect(statusOf(derivePatientPath({ treatmentPlans: [{ status: "COMPLETED" }] }, now), "followup")).toBe("current");
  });
});

describe("patient file side menu", () => {
  it("keeps every section reachable from exactly one menu entry", () => {
    const covered = PATIENT_NAV.flatMap((item) => item.sections);
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual(PATIENT_TABS.map((tab) => tab.key).sort());
    expect(PATIENT_NAV.length).toBeLessThan(PATIENT_TABS.length);
  });

  it("sends old links to the entry that now holds them", () => {
    expect(patientNavFor("sessions")?.key).toBe("therapyProgram");
    expect(patientNavFor("plan")?.key).toBe("therapyProgram");
    expect(patientNavFor("activity")?.key).toBe("timeline");
    expect(patientNavFor("journey")?.key).toBe("timeline");
    expect(patientNavFor("corr")?.key).toBe("official");
    expect(patientNavFor("rx")?.group).toBe("medical");
  });
});
