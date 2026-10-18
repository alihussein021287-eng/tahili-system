import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { activeSecretaryWhere } from "@/lib/center-membership";
import type { HandoffActor } from "@/lib/handoff-service";

const patientIdSchema = z.string().trim().min(1).max(128).regex(/^[\w-]+$/);

// Operational routing only. Handoff notes and return reasons may contain clinical details.
export const secretaryHandoffSelect = {
  id: true, sentAt: true, acceptedAt: true, status: true,
  fromUserId: true, toUserId: true, acceptedById: true, toCenterId: true,
  fromRole: true, toRole: true,
  fromUser: { select: { fullName: true } },
  toUser: { select: { fullName: true } },
  acceptedBy: { select: { fullName: true } },
  fromCenter: { select: { name: true } },
  toCenter: { select: { name: true } },
} as const satisfies Prisma.PatientHandoffSelect;

export type SecretaryHandoffRow = Prisma.PatientHandoffGetPayload<{ select: typeof secretaryHandoffSelect }>;

type HistoryDb = {
  user: { findFirst(args: Prisma.UserFindFirstArgs): Promise<{ id: string; role: string } | null> };
  centerMembership: { findMany(args: Prisma.CenterMembershipFindManyArgs): Promise<{ centerId: number }[]> };
  patientHandoff: { findMany(args: {
    where: Prisma.PatientHandoffWhereInput;
    select: typeof secretaryHandoffSelect;
    orderBy: Prisma.PatientHandoffOrderByWithRelationInput[];
  }): Promise<SecretaryHandoffRow[]> };
};

/** The caller supplies permissions loaded from the effective permission store, never request input. */
export async function loadSecretaryHandoffHistory(
  actor: HandoffActor,
  patientId: string,
  db: HistoryDb = prisma,
): Promise<SecretaryHandoffRow[]> {
  const id = patientIdSchema.parse(patientId);
  if (!actor?.userId || actor.role !== "SECRETARY" || !actor.permissions?.has("patients.view") ||
      (!actor.permissions?.has("handoff.send") && !actor.permissions?.has("handoff.receive"))) {
    throw new Error("غير مصرح");
  }
  const user = await db.user.findFirst({
    where: { id: actor.userId, role: "SECRETARY", isActive: true },
    select: { id: true, role: true },
  });
  if (!user) throw new Error("غير مصرح");

  const memberships = await db.centerMembership.findMany({
    where: { userId: user.id, ...activeSecretaryWhere() },
    select: { centerId: true },
  });
  const centers = [...new Set(memberships.map((membership) => membership.centerId))];
  if (!centers.length) return [];

  const scope: Prisma.PatientHandoffWhereInput[] = [];
  if (actor.permissions.has("handoff.send")) {
    // A new handoff may have no source center; its authorized destination still bounds it.
    scope.push({ fromUserId: user.id, OR: [
      { fromCenterId: { in: centers } },
      { fromCenterId: null, toCenterId: { in: centers } },
    ] });
  }
  if (actor.permissions.has("handoff.receive")) {
    scope.push({ toUserId: user.id, toCenterId: { in: centers } });
    scope.push({ acceptedById: user.id, toCenterId: { in: centers } });
    scope.push({ toUserId: null, toRole: "SECRETARY", toCenterId: { in: centers } });
  }

  return db.patientHandoff.findMany({
    where: { patientId: id, OR: scope },
    select: secretaryHandoffSelect,
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
  });
}
