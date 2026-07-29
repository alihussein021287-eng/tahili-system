import type { Prisma } from "@prisma/client";
import {
  canViewPatientTab,
  isKnownPatientTab,
  patientDataAuthorizationTab,
} from "@/lib/patient-tab-policy";

type FindMany<TArgs> = {
  findMany(args: TArgs): Promise<unknown>;
};

/**
 * The loader may access only the delegates required by lazy patient tabs.
 * Keeping this boundary explicit makes the authorization path testable and
 * prevents unrelated Prisma access from being introduced accidentally.
 */
export interface PatientTabRepository {
  attachment: FindMany<Prisma.AttachmentFindManyArgs>;
  progressMetric: FindMany<Prisma.ProgressMetricFindManyArgs>;
  vitalSign: FindMany<Prisma.VitalSignFindManyArgs>;
  residentReview: FindMany<Prisma.ResidentReviewFindManyArgs>;
  referralRequest: FindMany<Prisma.ReferralRequestFindManyArgs>;
  treatmentPlan: FindMany<Prisma.TreatmentPlanFindManyArgs>;
  relative: FindMany<Prisma.RelativeFindManyArgs>;
  auditLog: FindMany<Prisma.AuditLogFindManyArgs>;
  dressingRecord: FindMany<Prisma.DressingRecordFindManyArgs>;
}

export interface TabDeps {
  session: () => Promise<{ user?: { id?: string | null } } | null>;
  patientsView: () => Promise<void>;
  perms: () => Promise<Set<string>>;
  prisma: PatientTabRepository;
  memberships: (id: string) => Promise<number[]>;
}

const idOk = (id: string) => /^[\w-]{8,128}$/.test(id);

export async function loadPatientTabData(
  patientId: string,
  requested: string,
  deps: TabDeps,
) {
  const tab = patientDataAuthorizationTab(requested);
  if (!idOk(patientId) || !isKnownPatientTab(tab)) throw new Error("غير مصرح");

  const session = await deps.session();
  const userId = session?.user?.id;
  if (!userId) throw new Error("غير مصرح");

  await deps.patientsView();
  const permissions = await deps.perms();
  if (!canViewPatientTab(tab, permissions)) throw new Error("غير مصرح");

  const centers = permissions.has("centers.central.view")
    ? null
    : await deps.memberships(userId);
  const scoped = centers ? { OR: [{ centerId: null }, { centerId: { in: centers } }] } : {};

  switch (requested) {
    case "files":
      return deps.prisma.attachment.findMany({ where: { patientId }, orderBy: { uploadedAt: "desc" } });
    case "metrics":
      return deps.prisma.progressMetric.findMany({ where: { patientId }, orderBy: { date: "asc" } });
    case "vitals":
      return deps.prisma.vitalSign.findMany({ where: { patientId }, orderBy: { date: "asc" } });
    case "resident":
      return deps.prisma.residentReview.findMany({ where: { patientId }, orderBy: { date: "desc" } });
    case "referrals":
      return deps.prisma.referralRequest.findMany({
        where: {
          patientId,
          status: "ACCEPTED",
          destinationScope: "INTERNAL_CENTER",
          ...(centers
            ? { OR: [{ destinationCenterId: null }, { destinationCenterId: { in: centers } }] }
            : {}),
        },
        include: {
          destinationCenter: { select: { name: true } },
          assignedReviewer: { select: { fullName: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    case "plan":
      return deps.prisma.treatmentPlan.findMany({ where: { patientId, ...scoped }, orderBy: { createdAt: "desc" } });
    case "rel":
      return deps.prisma.relative.findMany({ where: { patientId } });
    case "activity":
      return deps.prisma.auditLog.findMany({
        where: { tableName: "patients", recordId: patientId },
        select: { id: true, action: true, createdAt: true, user: { select: { fullName: true } } },
        take: 80,
        orderBy: { createdAt: "desc" },
      });
    case "care":
      return deps.prisma.dressingRecord.findMany({ where: { patientId }, orderBy: { date: "desc" } });
    default:
      return [];
  }
}
