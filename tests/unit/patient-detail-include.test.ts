import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { roleDefaultSet } from "@/lib/perms";
import { buildPatientDetailInclude, patientClientPayload } from "@/lib/patient-detail-include";

const clinicalRelations = ["diagnoses", "medicalReports", "residentReviews", "correspondence", "woundAssessments"] as const;

describe("buildPatientDetailInclude", () => {
  it.each(["SECRETARY", "RECEPTION", "DATA_ENTRY"] as const)("omits clinical payload for %s", (role) => {
    const include = buildPatientDetailInclude(roleDefaultSet(role));
    for (const relation of [...clinicalRelations, "prescriptions"]) {
      expect(include).not.toHaveProperty(relation);
    }
  });

  it("loads diagnoses and reports for a doctor with their existing query shape", () => {
    const include = buildPatientDetailInclude(roleDefaultSet("DOCTOR"));
    expect(include).toHaveProperty("diagnoses", { orderBy: { date: "desc" } });
    expect(include).toHaveProperty("medicalReports", { orderBy: { date: "desc" } });
  });

  it.each([
    ["diagnoses", "clinical.diagnosis"],
    ["medicalReports", "clinical.report"],
    ["residentReviews", "clinical.metrics"],
    ["correspondence", "clinical.report"],
    ["woundAssessments", "clinical.wound"],
  ] as const)("includes %s only with its clinical permission", (relation, permission) => {
    expect(buildPatientDetailInclude(new Set())).not.toHaveProperty(relation);
    expect(buildPatientDetailInclude(new Set([permission]))).toHaveProperty(relation);
  });

  it.each([
    ["prescriptions", "clinical.prescription", "pharmacy.view"],
    ["admissions", "clinical.admission", "beds.view"],
  ] as const)("includes %s with either authorized permission", (relation, first, second) => {
    expect(buildPatientDetailInclude(new Set())).not.toHaveProperty(relation);
    expect(buildPatientDetailInclude(new Set([first]))).toHaveProperty(relation);
    expect(buildPatientDetailInclude(new Set([second]))).toHaveProperty(relation);
  });

  it.each([
    ["sickLeaves", "sickleave.view"],
    ["officialDocuments", "officialdocs.view"],
  ] as const)("includes %s only with its view permission", (relation, permission) => {
    expect(buildPatientDetailInclude(new Set())).not.toHaveProperty(relation);
    expect(buildPatientDetailInclude(new Set([permission]))).toHaveProperty(relation);
  });

  it("keeps nonrestricted relation shapes", () => {
    const include = buildPatientDetailInclude(new Set());
    expect(include).toHaveProperty("visits", { include: { branch: { select: { name: true } } }, orderBy: { visitDate: "desc" }, take: 5 });
    expect(include).toHaveProperty("referralRequests.take", 100);
    expect(include).not.toHaveProperty("treatmentPlans.include.referralRequest");
    expect(include).toHaveProperty("_count.select.treatmentPlans", true);
  });

  it("resolves permissions before the patient query and uses this include", () => {
    const page = readFileSync("src/app/(app)/patients/[id]/page.tsx", "utf8");
    expect(page.indexOf("await currentPerms()")).toBeLessThan(page.indexOf("prisma.patient.findUnique"));
    expect(page).toContain("include: buildPatientDetailInclude(perms, referralScope?.where)");
    expect(page.indexOf("await referralAccessScope(")).toBeLessThan(page.indexOf("prisma.patient.findUnique"));
  });
});

describe("patientClientPayload", () => {
  const patient = {
    id: "p1", fullName: "مراجع", notes: "ملاحظة", accessToken: "secret-token",
    therapySessions: [{ id: "s" }], treatmentPlans: [{ id: "t", goals: "هدف" }], therapySessionLogs: [{ id: "l", painBefore: 7 }],
    centerPrograms: [{ id: "c" }], referralRequests: [{ id: "r" }], appointments: [{ id: "a" }],
  };

  it.each(["SECRETARY", "RECEPTION", "DATA_ENTRY"] as const)("sends %s no therapy, program, referral data, notes or portal token", (role) => {
    const out = patientClientPayload(patient, roleDefaultSet(role));
    const perms = roleDefaultSet(role);
    expect(out.accessToken).toBeNull();
    expect(JSON.stringify(out)).not.toContain("secret-token");
    if (!perms.has("patients.edit") && !perms.has("clinical.view")) expect(out.notes).toBeNull();
    if (!["therapy.view", "clinical.session", "clinical.plan", "therapy.session.record"].some((key) => perms.has(key))) {
      expect(out.therapySessions).toEqual([]);
      expect(out.treatmentPlans).toEqual([]);
      expect(out.therapySessionLogs).toEqual([]);
    }
    if (!perms.has("centers.view")) expect(out.centerPrograms).toEqual([]);
    if (!perms.has("referrals.view") && !perms.has("referrals.create")) expect(out.referralRequests).toEqual([]);
    expect(out.appointments).toEqual([{ id: "a" }]);
  });

  it("strips SECRETARY completely", () => {
    const out = patientClientPayload(patient, roleDefaultSet("SECRETARY"));
    expect(out).toMatchObject({ accessToken: null, therapySessions: [], treatmentPlans: [], therapySessionLogs: [], centerPrograms: [] });
  });

  it("keeps each relation for the permission that opens its tab, and never the token", () => {
    const out = patientClientPayload(patient, new Set(["therapy.view", "centers.view", "referrals.view", "clinical.view"]));
    expect(out).toMatchObject({ accessToken: null, notes: "ملاحظة", therapySessions: [{ id: "s" }], centerPrograms: [{ id: "c" }], referralRequests: [{ id: "r" }] });
    expect(patient.accessToken).toBe("secret-token");
  });

  it("does not serialize an unscoped referral nested in a treatment plan", () => {
    const out = patientClientPayload({ ...patient, treatmentPlans: [{ id: "t", referralRequest: { clinicalReason: "PRIVATE_REASON" } }] }, new Set(["therapy.view"]));
    expect(JSON.stringify(out)).not.toContain("PRIVATE_REASON");
    expect(out.treatmentPlans).toEqual([{ id: "t" }]);
  });
});

describe("nested referral plan confidentiality", () => {
  const sentinel = "SYNTHETIC_M41R1_RESTRICTED_PLAN";
  const plan = {
    id: "synthetic-plan", goals: sentinel, beforeCondition: sentinel,
    afterCondition: sentinel, notes: sentinel, finalRecommendation: sentinel,
    sessions: [{ notes: sentinel }], futureClinicalRelation: { value: sentinel },
  };
  const referral = {
    id: "synthetic-referral", requestedService: "Synthetic operational routing",
    destinationCenterId: 1, status: "ACCEPTED", treatmentPlan: plan,
  };

  it.each(["SECRETARY", "RECEPTION", "DATA_ENTRY"] as const)("never serializes nested plan fields for %s", (role) => {
    const out = patientClientPayload({ id: "synthetic-patient", referralRequests: [referral] }, roleDefaultSet(role));
    expect(JSON.stringify(out).includes(sentinel)).toBe(false);
    for (const row of out.referralRequests) {
      expect(row).not.toHaveProperty("treatmentPlan");
      expect(row.requestedService).toBe(referral.requestedService);
    }
  });

  it("selects only an existence reference for server-side derivation at the query boundary", () => {
    expect(buildPatientDetailInclude(roleDefaultSet("SECRETARY")).referralRequests.include.treatmentPlan).toEqual({ select: { id: true } });
  });

  it.each(["DOCTOR", "HEAD_THERAPIST"] as const)("preserves authorized top-level treatment data for %s", (role) => {
    const out = patientClientPayload({ treatmentPlans: [plan], referralRequests: [referral] }, roleDefaultSet(role));
    expect(out.treatmentPlans[0].goals).toBe(sentinel);
    expect(out.referralRequests[0].treatmentPlan).toEqual({ id: plan.id });
  });

  it("uses effective permissions rather than a role name or a broad clinical-view flag", () => {
    for (const perms of [new Set(["referrals.view"]), new Set(["referrals.view", "clinical.view"])]) {
      const out = patientClientPayload({ treatmentPlans: [plan], referralRequests: [referral] }, perms);
      expect(JSON.stringify(out).includes(sentinel)).toBe(false);
      expect(out.referralRequests[0]).not.toHaveProperty("treatmentPlan");
    }
    const combined = patientClientPayload({ treatmentPlans: [plan], referralRequests: [referral] }, new Set(["referrals.view", "therapy.view"]));
    expect(combined.treatmentPlans[0].goals).toBe(sentinel);
    expect(combined.referralRequests[0].treatmentPlan).toEqual({ id: plan.id });
  });

  it("preserves absent/null references and does not mutate the ORM input", () => {
    const input: { referralRequests: Array<{ id: string; treatmentPlan?: typeof plan | null }> } = {
      referralRequests: [referral, { id: "unplanned", treatmentPlan: null }, { id: "no-property" }],
    };
    const original = JSON.stringify(input);
    const out = patientClientPayload(input, new Set(["referrals.view"]));
    expect(out.referralRequests[0]).not.toHaveProperty("treatmentPlan");
    expect(out.referralRequests[1]).not.toHaveProperty("treatmentPlan");
    expect(out.referralRequests[2]).not.toHaveProperty("treatmentPlan");
    expect(JSON.stringify(input)).toBe(original);
  });
});
