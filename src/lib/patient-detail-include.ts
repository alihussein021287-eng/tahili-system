import type { Prisma } from "@prisma/client";

export function buildPatientDetailInclude(perms: ReadonlySet<string>, referralWhere: Prisma.ReferralRequestWhereInput = { id: "__not_authorized__" }) {
  return {
    governorate: true, district: true, injuryType: true, formation: true, branch: true,
    ...(perms.has("clinical.diagnosis") ? { diagnoses: { orderBy: { date: "desc" as const } } } : {}),
    ...(perms.has("officialdocs.view") ? { officialDocuments: { orderBy: { docDate: "desc" as const } } } : {}),
    ...(perms.has("sickleave.view") ? { sickLeaves: { orderBy: { startDate: "desc" as const } } } : {}),
    ...(perms.has("clinical.report") ? { medicalReports: { orderBy: { date: "desc" as const } } } : {}),
    visits: { include: { branch: { select: { name: true } } }, orderBy: { visitDate: "desc" as const }, take: 5 },
    therapySessions: { include: { center: true }, orderBy: { createdAt: "desc" as const } },
    treatmentPlans: { include: { therapist: true, specialistDoctor: true, createdBy: true, center: true, hall: true, sessions: { include: { appointments: { orderBy: { scheduledAt: "asc" as const }, include: { therapySessionLogs: { orderBy: { createdAt: "desc" as const }, take: 1, select: { status: true, attended: true, response: true, progress: true } } } } } }, periodicEvaluations: { include: { evaluatedBy: true }, orderBy: { evaluatedAt: "asc" as const } } }, orderBy: { createdAt: "desc" as const } },
    centerPrograms: { include: { center: true, assignedTo: true }, orderBy: { createdAt: "desc" as const } },
    referralRequests: { where: { status: "ACCEPTED" as const, destinationScope: "INTERNAL_CENTER" as const, AND: [referralWhere] }, include: { treatmentPlan: { select: { id: true } }, destinationCenter: true }, orderBy: { acceptedAt: "desc" as const }, take: 100 },
    therapySessionLogs: { include: { session: true, appointment: true }, orderBy: { performedAt: "desc" as const }, take: 25 },
    ...(perms.has("clinical.prescription") || perms.has("pharmacy.view") ? { prescriptions: { include: { medication: true }, orderBy: { prescribedAt: "desc" as const } } } : {}),
    ...(perms.has("clinical.admission") || perms.has("beds.view") ? { admissions: { include: { center: true, room: true, bed: true }, orderBy: { admissionDate: "desc" as const } } } : {}),
    ...(perms.has("clinical.wound") ? { woundAssessments: { include: { photos: true }, orderBy: { assessmentDate: "desc" as const } } } : {}),
    ...(perms.has("clinical.metrics") ? { residentReviews: { orderBy: { date: "desc" as const }, take: 25 } } : {}),
    ...(perms.has("clinical.report") ? { correspondence: { orderBy: { bookDate: "desc" as const } } } : {}),
    appointments: { orderBy: { scheduledAt: "desc" as const } },
    _count: { select: { treatmentPlans: true } },
  } satisfies Prisma.PatientInclude;
}

const hasAny = (perms: ReadonlySet<string>, keys: readonly string[]) => keys.some((key) => perms.has(key));

/** Permissions that open the therapy, center-program and referral tabs (see patient-tab-policy.ts). */
export const THERAPY_DATA_PERMISSIONS = ["therapy.view", "clinical.session", "clinical.plan", "therapy.session.record"] as const;
export const CENTER_PROGRAM_PERMISSIONS = ["centers.view"] as const;
export const REFERRAL_DATA_PERMISSIONS = ["referrals.view", "referrals.create"] as const;

/**
 * What the patient page may send to the browser. The server still loads these relations (the
 * derived journey needs them), but a role whose tabs hide them must not receive them in the page
 * payload either: no therapy plans, session logs, center programs or referrals without their
 * permissions, never the portal token (the server-rendered portal box has it), and the free-text
 * notes only for editors and clinicians.
 */
export function patientClientPayload<T extends Record<string, any>>(patient: T, perms: ReadonlySet<string>): T {
  const out: Record<string, any> = JSON.parse(JSON.stringify(patient));
  out.accessToken = null;
  if (!hasAny(perms, ["patients.edit", "clinical.view"])) out.notes = null;
  if (!hasAny(perms, THERAPY_DATA_PERMISSIONS)) {
    out.therapySessions = [];
    out.treatmentPlans = [];
    out.therapySessionLogs = [];
  }
  // A treatment plan never carries its linked referral's clinical reason in the client payload.
  if (Array.isArray(out.treatmentPlans)) {
    out.treatmentPlans = out.treatmentPlans.map((plan: Record<string, unknown>) => {
      const { referralRequest: _referralRequest, ...safePlan } = plan;
      return safePlan;
    });
  }
  if (!hasAny(perms, CENTER_PROGRAM_PERMISSIONS)) out.centerPrograms = [];
  if (!hasAny(perms, REFERRAL_DATA_PERMISSIONS)) out.referralRequests = [];
  // Referral visibility is not therapy authorization, including the nested plan's
  // identity/relationship. Only therapy-authorized clients need the picker reference.
  // Explicitly project it here too, so a richer ORM include cannot reopen the leak.
  if (Array.isArray(out.referralRequests)) {
    for (const referral of out.referralRequests) {
      if (referral && typeof referral === "object" && "treatmentPlan" in referral) {
        if (!hasAny(perms, THERAPY_DATA_PERMISSIONS)) {
          delete referral.treatmentPlan;
          continue;
        }
        const id = referral.treatmentPlan?.id;
        referral.treatmentPlan = typeof id === "string" ? { id } : null;
      }
    }
  }
  return out as T;
}
