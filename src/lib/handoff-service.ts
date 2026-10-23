import { handoffRecipientScope } from '@/lib/handoff-recipient-scope';
import type { CenterMembershipRole, PatientHandoff, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { baghdadDayRange } from "@/lib/display-utils";
import { BRANCH_LEVEL_ROLES, CENTER_ROLE_FOR_TARGET, HANDOFF_TARGET_LABELS, handoffDelayColor, handoffLimitMinutes, handoffLoad } from "@/lib/handoff-rules";
import { activeMembershipWhere } from "@/lib/center-membership";
import { loadPermissionsFromStore, type PermissionOverride } from "@/lib/permission-store";
import { notifyUserInTransaction, type NotificationClient } from "@/lib/notify";
import { assertStageLinkOnSend, assignStageOnAccept, type StageAssignmentTx } from "@/lib/stage-assignment";

/** Trusted server context: construct from getSession/currentPerms, never request input. */
export type HandoffActor = { userId: string; role: UserRole; permissions: ReadonlySet<string> };
type HandoffUser = { id: string; fullName: string; role: UserRole; branchId: number | null; isActive: boolean };
type Membership = { userId: string; centerId: number; role: CenterMembershipRole; specialty: string | null; user: HandoffUser };

/** Narrow repository boundary; both Prisma and an in-memory test client implement it. */
export interface HandoffTransaction extends NotificationClient {
  /** Present on Prisma transactions; only used when a handoff references a stage. */
  careStage?: StageAssignmentTx["careStage"];
  rolePermission: { findMany(args: Prisma.RolePermissionFindManyArgs): Promise<PermissionOverride[]> };
  userPermission: { findMany(args: Prisma.UserPermissionFindManyArgs): Promise<PermissionOverride[]> };
  auditLog: { create(args: Prisma.AuditLogCreateArgs): Promise<unknown> };
  user: {
    findFirst(args: Prisma.UserFindFirstArgs): Promise<HandoffUser | null>;
    findMany(args: Prisma.UserFindManyArgs): Promise<HandoffUser[]>;
  };
  centerMembership: {
    findMany(args: Omit<Prisma.CenterMembershipFindManyArgs, "include" | "select"> & {
      include: { user: { select: typeof userSelect } };
    }): Promise<Membership[]>;
  };
  patient: { findUnique(args: Prisma.PatientFindUniqueArgs): Promise<{ id: string; fullName: string; branchId: number | null; archivedAt?: Date | null } | null> };
  center: { findUnique(args: Prisma.CenterFindUniqueArgs): Promise<{ id: number; name: string } | null> };
  patientHandoff: {
    findFirst(args: Prisma.PatientHandoffFindFirstArgs): Promise<PatientHandoff | null>;
    findMany(args: Prisma.PatientHandoffFindManyArgs): Promise<PatientHandoff[]>;
    create(args: Prisma.PatientHandoffCreateArgs): Promise<PatientHandoff>;
    updateMany(args: Prisma.PatientHandoffUpdateManyArgs): Promise<{ count: number }>;
    count(args: Prisma.PatientHandoffCountArgs): Promise<number>;
    groupBy(args: { by: ["status", "toUserId", "acceptedById"]; where: Prisma.PatientHandoffWhereInput; _count: { _all: true } }): Promise<Array<{ status: "SENT" | "ACCEPTED"; toUserId: string | null; acceptedById: string | null; _count: { _all: number } }>>;
  };
  queueEntry: {
    findFirst(args: Prisma.QueueEntryFindFirstArgs): Promise<{ id: string } | null>;
    create(args: Prisma.QueueEntryCreateArgs): Promise<{ id: string }>;
  };
}
export interface HandoffRepository extends HandoffTransaction {
  $transaction<T>(work: (tx: HandoffTransaction) => Promise<T>, options?: { isolationLevel: "Serializable" }): Promise<T>;
}

const userSelect = { id: true, fullName: true, role: true, branchId: true, isActive: true } as const;
const idSchema = z.string().trim().min(1).max(128).regex(/^[\w-]+$/);
const centerSchema = z.number().int().positive();
const targetSchema = z.enum(["SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "RECEPTION", "DATA_ENTRY"]);
const recipientsSchema = z.object({
  toUserId: idSchema.nullish(), toCenterId: centerSchema.nullish(),
  toRole: targetSchema.optional(), patientBranchId: centerSchema.nullish(),
  /** The sender's branch; center staff of another branch are not recipients (same rule as listTargets). */
  senderBranchId: z.number().int().positive().nullish(),
  /** Central view (listTargets bypass): all branches' center staff may be addressed. */
  senderCentral: z.boolean().optional(),
}).strict();
export type RecipientInput = z.infer<typeof recipientsSchema>;
const sendSchema = z.object({
  patientId: idSchema,
  // Legacy service callers cannot choose the source; public actions reject this field.
  fromCenterId: z.unknown().optional(),
  toUserId: idSchema.nullish(), toCenterId: centerSchema.nullish(), toRole: targetSchema,
  note: z.string().trim().max(4000).nullish(),
  careStageId: idSchema.nullish(),
}).strict().transform(({ fromCenterId: _ignored, ...data }) => data);
export type SendHandoffInput = z.infer<typeof sendSchema>;
const redirectSchema = z.object({ toUserId: idSchema.nullish(), toRole: targetSchema }).strict();
export type RedirectHandoffInput = z.infer<typeof redirectSchema>;
const denied = () => new Error("غير مصرح");
const conflict = () => new Error("استلمها شخص آخر");

function centerRole(role: UserRole): CenterMembershipRole | undefined {
  return CENTER_ROLE_FOR_TARGET[role as keyof typeof CENTER_ROLE_FOR_TARGET];
}
function isBranchRole(role: UserRole): boolean {
  return (BRANCH_LEVEL_ROLES as readonly string[]).includes(role);
}
async function activeActor(actor: HandoffActor, key: string, db: HandoffTransaction) {
  if (!actor || !idSchema.safeParse(actor.userId).success || !actor.permissions?.has(key)) throw denied();
  const user = await db.user.findFirst({ where: { id: actor.userId, isActive: true }, select: userSelect });
  if (!user) throw denied();
  return user;
}

/** Finish needs handoff.receive; cancel and redirect need handoff.send. Managers pass without them. */
async function activeTransitionActor(actor: HandoffActor, db: HandoffTransaction, key: "handoff.send" | "handoff.receive") {
  if (!actor || !idSchema.safeParse(actor.userId).success || !actor.permissions) throw denied();
  const user = await db.user.findFirst({ where: { id: actor.userId, isActive: true }, select: userSelect });
  if (!user) throw denied();
  if (!actor.permissions.has(key) && !canManage(actor, user)) throw denied();
  return user;
}

function canManage(actor: HandoffActor, user: HandoffUser) {
  return actor.permissions.has("handoff.manage") || user.role === "MANAGER" || user.role === "ADMIN";
}

async function auditTransition(tx: HandoffTransaction, actorId: string, handoffId: string, from: string, to: string, extra?: Record<string, string>) {
  await tx.auditLog.create({ data: {
    userId: actorId, action: "UPDATE", tableName: "patient_handoffs", recordId: handoffId,
    oldValue: { status: from }, newValue: { status: to, ...extra },
  } });
}

/** Close every recipient's notice when its handoff is no longer actionable.
 * The body condition also clears notices created before the handoffId relation existed. */
async function closeHandoffNotifications(tx: HandoffTransaction, handoffIds: string[]) {
  const ids = [...new Set(handoffIds)];
  if (!ids.length || !tx.notification?.updateMany) return;
  await tx.notification.updateMany({
    where: {
      read: false,
      OR: [
        { handoffId: { in: ids } },
        { title: { in: ["تسليم مراجع جديد", "مراجع مُرجَع إليك"] }, body: { in: ids.map((id) => `رقم التسليم: ${id}`) } },
      ],
    },
    data: { read: true },
  });
}

function handoffNotificationBody(patientName: string, handoffId: string, role: UserRole, centerName?: string | null) {
  const destination = HANDOFF_TARGET_LABELS[role as keyof typeof HANDOFF_TARGET_LABELS] ?? role;
  return `المراجع: ${patientName}\nالوجهة: ${destination}${centerName ? ` - ${centerName}` : ""}\nرقم التحويلة: ${handoffId}`;
}

async function destinationCenterName(tx: HandoffTransaction, centerId: number | null | undefined) {
  if (centerId == null || !tx.center?.findUnique) return null;
  return (await tx.center.findUnique({ where: { id: centerId }, select: { id: true, name: true } }))?.name ?? null;
}

async function eligibleUsers(users: HandoffUser[], db: HandoffTransaction) {
  const eligible = await Promise.all(users.map(async (user) => {
    const permissions = await loadPermissionsFromStore(user.id, user.role, {
      findRolePermissions: (role) => db.rolePermission.findMany({ where: { role }, select: { permKey: true, allowed: true } }),
      findUserPermissions: (userId) => db.userPermission.findMany({ where: { userId }, select: { permKey: true, allowed: true } }),
    });
    return permissions.has("handoff.receive") && permissions.has("handoff.send");
  }));
  return users.filter((_, index) => eligible[index]);
}

export async function resolveRecipients(input: RecipientInput, db: HandoffTransaction = prisma): Promise<string[]> {
  const target = recipientsSchema.parse(input);
  if (target.toUserId && !target.toRole) {
    const user = await db.user.findFirst({ where: { id: target.toUserId, isActive: true }, select: userSelect });
    return user ? (await eligibleUsers([user], db)).map((candidate) => candidate.id) : [];
  }
  if (!target.toRole) return [];
  if (isBranchRole(target.toRole)) {
    if (target.patientBranchId == null) return [];
    const users = await db.user.findMany({
      where: { id: target.toUserId ?? undefined, isActive: true, role: target.toRole, branchId: target.patientBranchId }, select: userSelect,
    });
    return (await eligibleUsers(users, db)).map((user) => user.id);
  }
  const role = centerRole(target.toRole);
  if (target.toCenterId == null || !role) return [];
  const members = await db.centerMembership.findMany({
    where: { centerId: target.toCenterId, userId: target.toUserId ?? undefined, ...activeMembershipWhere(role) },
    include: { user: { select: userSelect } },
  });
  // Delivery follows the same branch rule as the recipient selector: staff of the sender's branch or branchless staff.
  const branchScoped = target.senderCentral === true || target.senderBranchId === undefined
    ? members
    : members.filter((member) => member.user.branchId == null || member.user.branchId === target.senderBranchId);
  return [...new Set((await eligibleUsers(branchScoped.map((member) => member.user), db)).map((user) => user.id))];
}

/** Internal read helper; endpoint callers must guard staff-directory access. */
export async function listTargets(actor: HandoffActor, centerId: number, toRole: SendHandoffInput["toRole"], db: HandoffTransaction = prisma) {
  centerSchema.parse(centerId);
  targetSchema.parse(toRole);
  const viewer = await activeActor(actor, "handoff.send", db);
  const role = centerRole(toRole);
  if (!role) return [];
  const members = await db.centerMembership.findMany({
    where: { centerId, ...activeMembershipWhere(role) },
    include: { user: { select: userSelect } }, orderBy: { user: { fullName: "asc" } },
  });
  const visible = members.filter((member) => actor.permissions.has("centers.central.view") || member.user.branchId == null || member.user.branchId === viewer.branchId);
  const eligibleIds = new Set((await eligibleUsers(visible.map((member) => member.user), db)).map((user) => user.id));
  const targets = visible.filter((member) => eligibleIds.has(member.userId));
  const ids = [...new Set(targets.map((member) => member.userId))];
  const grouped = await db.patientHandoff.groupBy({
    by: ["status", "toUserId", "acceptedById"],
    where: { OR: [{ status: "SENT", toUserId: { in: ids } }, { status: "ACCEPTED", acceptedById: { in: ids } }] },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const row of grouped) {
    const userId = row.status === "SENT" ? row.toUserId : row.acceptedById;
    if (userId) counts.set(userId, (counts.get(userId) ?? 0) + row._count._all);
  }
  return targets.map((member) => ({
    userId: member.userId, name: member.user.fullName, specialty: member.specialty,
    load: handoffLoad(counts.get(member.userId) ?? 0),
  }));
}

async function recipientWhere(user: HandoffUser, db: HandoffTransaction): Promise<Prisma.PatientHandoffWhereInput> {
  const membershipRole = centerRole(user.role);
  const members = membershipRole ? await db.centerMembership.findMany({
    where: { userId: user.id, ...activeMembershipWhere(membershipRole), center: { active: true } }, include: { user: { select: userSelect } },
  }) : [];
  const scope = handoffRecipientScope(user, members.map(member => member.centerId));
  // Preserve the existing branch-origin restriction for center pools; names no longer bypass current membership.
  return user.branchId == null || isBranchRole(user.role) ? scope : { AND: [scope, { OR: [
    { toUserId: user.id }, { fromUser: { branchId: null } }, { fromUser: { branchId: user.branchId } }, { fromRole: { in: ["ADMIN", "MANAGER"] } },
  ] }] };
}

// Serializable retries also prevent duplicate queue entries when different handoffs
// for the same patient/center are accepted simultaneously (there is no unique day key).
async function transaction<T>(db: HandoffRepository, work: (tx: HandoffTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: "Serializable" }); }
    catch (error) {
      if (attempt >= 3 || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
    }
  }
}

/** Internal service: the authenticated caller must also authorize input.patientId. */
export async function sendHandoff(actor: HandoffActor, input: SendHandoffInput, db: HandoffRepository = prisma) {
  const data = sendSchema.parse(input);
  return transaction(db, async (tx) => {
    const user = await activeActor(actor, "handoff.send", tx);
    const patient = await tx.patient.findUnique({ where: { id: data.patientId }, select: { id: true, fullName: true, branchId: true, archivedAt: true } });
    if (!patient || patient.archivedAt) throw new Error("ملف المراجع غير متاح");
    const previous = await tx.patientHandoff.findFirst({
      where: { patientId: patient.id, status: "ACCEPTED", acceptedById: user.id }, orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
    });
    const open = await tx.patientHandoff.findMany({
      where: { patientId: patient.id, status: { in: ["SENT", "ACCEPTED"] } }, orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    });
    const others = open.filter((handoff) => handoff.id !== previous?.id);
    if (others.length && !actor.permissions.has("handoff.manage") && user.role !== "MANAGER" && user.role !== "ADMIN") {
      const holder = others[0];
      const center = holder.toCenterId == null ? null : await tx.center.findUnique({ where: { id: holder.toCenterId }, select: { id: true, name: true } });
      const label = HANDOFF_TARGET_LABELS[holder.toRole as keyof typeof HANDOFF_TARGET_LABELS] ?? holder.toRole;
      // Use the role label so patient/employee names never enter error telemetry.
      throw new Error(`المريض حالياً عند ${label} – ${center?.name ?? "بلا مركز"}`);
    }
    if (data.careStageId) {
      if (!tx.careStage) throw denied();
      await assertStageLinkOnSend(tx as unknown as StageAssignmentTx, {
        stageId: data.careStageId, patientId: patient.id, senderId: user.id, senderPermissions: actor.permissions, toUserId: data.toUserId ?? null, toRole: data.toRole, toCenterId: data.toCenterId ?? null, note: data.note,
      });
    }
    if (isBranchRole(data.toRole) && patient.branchId == null) {
      throw new Error("المراجع بلا فرع؛ حدّد فرعه أولاً قبل التحويل للاستقبال أو إدخال البيانات");
    }
    const memberships = previous ? [] : await tx.centerMembership.findMany({
      where: { userId: user.id, ...activeMembershipWhere() }, include: { user: { select: userSelect } },
    });
    const fromCenterId = previous ? previous.toCenterId : memberships.length === 1 ? memberships[0].centerId : null;
    const recipients = await resolveRecipients({
      toUserId: data.toUserId, toCenterId: data.toCenterId, toRole: data.toRole, patientBranchId: patient.branchId,
      senderBranchId: user.branchId ?? null, senderCentral: actor.permissions.has("centers.central.view"),
    }, tx);
    if (!recipients.length) throw new Error(`هذا المركز ما بيه ${HANDOFF_TARGET_LABELS[data.toRole]}`);
    const now = new Date();
    const cancelledHandoffIds = others.map((handoff) => handoff.id);
    if (cancelledHandoffIds.length) {
      const result = await tx.patientHandoff.updateMany({
        where: { id: { in: cancelledHandoffIds }, status: { in: ["SENT", "ACCEPTED"] } }, data: { status: "CANCELLED" },
      });
      if (result.count !== cancelledHandoffIds.length) throw conflict();
    }
    if (previous) {
      const result = await tx.patientHandoff.updateMany({
        where: { id: previous.id, status: "ACCEPTED", acceptedById: user.id }, data: { status: "DONE", doneAt: now },
      });
      if (!result.count) throw conflict();
    }
    await closeHandoffNotifications(tx, [...cancelledHandoffIds, ...(previous ? [previous.id] : [])]);
    const created = await tx.patientHandoff.create({ data: {
      ...data, patientId: patient.id, toRole: data.toRole, fromCenterId,
      fromUserId: user.id, fromRole: user.role, status: "SENT", sentAt: now, previousHandoffId: previous?.id,
    } });
    const centerName = await destinationCenterName(tx, created.toCenterId);
    const notificationBody = handoffNotificationBody(patient.fullName, created.id, created.toRole, centerName);
    await tx.auditLog.create({ data: {
      userId: user.id, action: "CREATE", tableName: "patient_handoffs", recordId: created.id,
      newValue: {
        toUserId: created.toUserId, toRole: created.toRole, toCenterId: created.toCenterId, fromCenterId,
        ...(previous ? { previousHandoffId: previous.id } : {}), cancelledHandoffIds,
      },
    } });
    for (const recipient of recipients) {
      await notifyUserInTransaction(tx, recipient, "تسليم مراجع جديد", { body: notificationBody, link: "/my-work", handoffId: created.id });
    }
    return created;
  });
}

export async function acceptHandoff(actor: HandoffActor, id: string, db: HandoffRepository = prisma) {
  idSchema.parse(id);
  const accepted = await transaction(db, async (tx) => {
    const user = await activeActor(actor, "handoff.receive", tx);
    const eligible = await recipientWhere(user, tx);
    const now = new Date();
    const result = await tx.patientHandoff.updateMany({
      where: { id, status: "SENT", AND: [eligible] },
      data: { status: "ACCEPTED", acceptedAt: now, acceptedById: user.id },
    });
    if (!result.count) throw conflict();
    await closeHandoffNotifications(tx, [id]);
    const handoff = await tx.patientHandoff.findFirst({ where: { id } });
    if (!handoff) throw conflict();
    if (handoff.careStageId) {
      if (!tx.careStage) throw denied();
      const assignment = await assignStageOnAccept(tx as unknown as StageAssignmentTx, { ...handoff, careStageId: handoff.careStageId }, { id: user.id, role: user.role });
      if (assignment.former) {
        await notifyUserInTransaction(tx, assignment.former, "أُعيد إسناد محطتك إلى زميل آخر", { link: `/patients/${handoff.patientId}`, careStageId: handoff.careStageId });
      }
    }
    if (handoff.toCenterId != null && centerRole(handoff.toRole) && handoff.toRole !== "THERAPIST") {
      const { start, end } = baghdadDayRange(now);
      const waiting = await tx.queueEntry.findFirst({ where: {
        patientId: handoff.patientId, centerId: handoff.toCenterId, createdAt: { gte: start, lt: end },
      } });
      if (!waiting) {
        const queuedPatient = await tx.patient.findUnique({ where: { id: handoff.patientId }, select: { id: true, fullName: true, branchId: true } });
        const created = await tx.queueEntry.create({ data: { patientId: handoff.patientId, centerId: handoff.toCenterId, status: "WAITING", branchId: queuedPatient?.branchId ?? user.branchId ?? null } });
        await tx.auditLog.create({ data: { userId: user.id, action: "CREATE", tableName: "queue_entries", recordId: created.id, newValue: { handoffId: id } } });
      }
    }
    return handoff;
  });
  await logAudit({ userId: actor.userId, action: "UPDATE", tableName: "patient_handoffs", recordId: id });
  return accepted;
}

export async function returnHandoff(actor: HandoffActor, id: string, reason: string, db: HandoffRepository = prisma) {
  idSchema.parse(id);
  const parsed = z.string().trim().min(1).max(4000).safeParse(reason);
  if (!parsed.success) throw new Error("سبب الإرجاع مطلوب");
  const returned = await transaction(db, async (tx) => {
    const user = await activeActor(actor, "handoff.send", tx);
    const eligible = await recipientWhere(user, tx);
    const result = await tx.patientHandoff.updateMany({
      where: { id, OR: [
        { status: "SENT", AND: [eligible] },
        { status: "ACCEPTED", acceptedById: user.id, AND: [eligible] },
      ] }, data: { status: "RETURNED", returnReason: parsed.data },
    });
    if (!result.count) throw conflict();
    const original = await tx.patientHandoff.findFirst({ where: { id } });
    if (!original) throw conflict();
    const back = await tx.patientHandoff.create({ data: {
      patientId: original.patientId, fromUserId: user.id, fromRole: user.role, fromCenterId: original.toCenterId,
      toUserId: original.fromUserId, toRole: original.fromRole, toCenterId: original.fromCenterId,
      previousHandoffId: original.id, status: "SENT", sentAt: new Date(), note: parsed.data,
    } });
    // The sender learns at once that the patient came back (the reason is on the card, not in the notification).
    await closeHandoffNotifications(tx, [id]);
    const patient = await tx.patient.findUnique({ where: { id: original.patientId }, select: { id: true, fullName: true, branchId: true, archivedAt: true } });
    const centerName = await destinationCenterName(tx, back.toCenterId);
    await notifyUserInTransaction(tx, original.fromUserId, "مراجع مُرجَع إليك", { body: handoffNotificationBody(patient?.fullName ?? "مراجع", back.id, back.toRole, centerName), link: "/my-work", handoffId: back.id });
    return back;
  });
  await logAudit({ userId: actor.userId, action: "UPDATE", tableName: "patient_handoffs", recordId: id, newValue: { nextHandoffId: returned.id } });
  return returned;
}

export async function finishHandoff(actor: HandoffActor, id: string, db: HandoffRepository = prisma) {
  idSchema.parse(id);
  return transaction(db, async (tx) => {
    const user = await activeTransitionActor(actor, tx, "handoff.receive");
    const now = new Date();
    const result = await tx.patientHandoff.updateMany({
      where: { id, status: "ACCEPTED", acceptedById: user.id, AND: [await recipientWhere(user, tx)] }, data: { status: "DONE", doneAt: now },
    });
    if (!result.count) throw conflict();
    const handoff = await tx.patientHandoff.findFirst({ where: { id } });
    if (!handoff) throw conflict();
    await closeHandoffNotifications(tx, [id]);
    await auditTransition(tx, user.id, id, "ACCEPTED", "DONE");
    return handoff;
  });
}

export async function cancelHandoff(actor: HandoffActor, id: string, db: HandoffRepository = prisma) {
  idSchema.parse(id);
  return transaction(db, async (tx) => {
    const user = await activeTransitionActor(actor, tx, "handoff.send");
    const manager = canManage(actor, user);
    const result = await tx.patientHandoff.updateMany({
      where: { id, status: "SENT", ...(manager ? {} : { fromUserId: user.id }) }, data: { status: "CANCELLED" },
    });
    if (!result.count) throw conflict();
    const handoff = await tx.patientHandoff.findFirst({ where: { id } });
    if (!handoff) throw conflict();
    await closeHandoffNotifications(tx, [id]);
    await auditTransition(tx, user.id, id, "SENT", "CANCELLED");
    return handoff;
  });
}

export async function redirectHandoff(actor: HandoffActor, id: string, input: RedirectHandoffInput, db: HandoffRepository = prisma) {
  idSchema.parse(id);
  const data = redirectSchema.parse(input);
  return transaction(db, async (tx) => {
    const user = await activeTransitionActor(actor, tx, "handoff.send");
    const manager = canManage(actor, user);
    if (!manager && user.role !== "SECRETARY") throw denied();
    const original = await tx.patientHandoff.findFirst({ where: { id, status: "SENT" } });
    if (!original) throw conflict();
    if (original.toCenterId == null) throw denied();
    if (!centerRole(data.toRole)) throw denied();
    if (!manager) {
      const members = await tx.centerMembership.findMany({
        where: { centerId: original.toCenterId, userId: user.id, ...activeMembershipWhere("SECRETARY") },
        include: { user: { select: userSelect } },
      });
      if (!members.length) throw denied();
    }
    const patient = await tx.patient.findUnique({ where: { id: original.patientId }, select: { id: true, fullName: true, branchId: true, archivedAt: true } });
    if (!patient) throw conflict();
    if (patient.archivedAt) throw new Error("ملف المراجع غير متاح");
    const recipients = await resolveRecipients({
      toUserId: data.toUserId, toRole: data.toRole, toCenterId: original.toCenterId, patientBranchId: patient.branchId,
      senderBranchId: user.branchId ?? null, senderCentral: manager || actor.permissions.has("centers.central.view"),
    }, tx);
    if (!recipients.length) throw new Error(`هذا المركز ما بيه ${HANDOFF_TARGET_LABELS[data.toRole]}`);
    const changed = await tx.patientHandoff.updateMany({ where: { id, status: "SENT" }, data: { status: "CANCELLED" } });
    if (!changed.count) throw conflict();
    await closeHandoffNotifications(tx, [id]);
    await auditTransition(tx, user.id, id, "SENT", "CANCELLED");
    const created = await tx.patientHandoff.create({ data: {
      patientId: original.patientId, fromUserId: user.id, fromRole: user.role, fromCenterId: original.toCenterId,
      toCenterId: original.toCenterId, toUserId: data.toUserId ?? null, toRole: data.toRole,
      note: original.note, previousHandoffId: original.id, status: "SENT", sentAt: new Date(),
    } });
    const centerName = await destinationCenterName(tx, created.toCenterId);
    const notificationBody = handoffNotificationBody(patient.fullName, created.id, created.toRole, centerName);
    await tx.auditLog.create({ data: {
      userId: user.id, action: "CREATE", tableName: "patient_handoffs", recordId: created.id,
      newValue: { status: "SENT", previousHandoffId: id, toCenterId: original.toCenterId, toRole: data.toRole, toUserId: data.toUserId ?? null },
    } });
    for (const recipient of recipients) {
      await notifyUserInTransaction(tx, recipient, "تسليم مراجع جديد", { body: notificationBody, link: "/my-work", handoffId: created.id });
    }
    return created;
  });
}

/** Call inside the caller's transaction so the patient transition and its audit are atomic. */
export async function closeOpenHandoffsForPatient(tx: HandoffTransaction, patientId: string, actorId: string, reason: string) {
  idSchema.parse(patientId);
  idSchema.parse(actorId);
  const parsedReason = z.string().trim().min(1).max(128).parse(reason);
  const open = await tx.patientHandoff.findMany({ where: { patientId, status: { in: ["SENT", "ACCEPTED"] } } });
  const now = new Date();
  for (const handoff of open) {
    const previousStatus = handoff.status;
    const result = await tx.patientHandoff.updateMany({
      where: { id: handoff.id, patientId, status: previousStatus }, data: { status: "DONE", doneAt: now },
    });
    if (!result.count) throw conflict();
    await closeHandoffNotifications(tx, [handoff.id]);
    await tx.auditLog.create({ data: {
      userId: actorId, action: "UPDATE", tableName: "patient_handoffs", recordId: handoff.id,
      oldValue: { status: previousStatus }, newValue: { status: "DONE", reason: parsedReason },
    } });
  }
  return open.length;
}

/**
 * A workflow step that moves the patient to a named person (a new therapy programme to its
 * therapist, a finished programme back to the specialist). It closes whatever handoff is open and
 * opens one to that person, inside the caller's transaction, so "now with" follows the work.
 */
export async function handOverInTransaction(tx: HandoffTransaction, input: {
  patientId: string; actorId: string; actorRole: UserRole; toRole: UserRole; toUserId: string; toCenterId?: number | null; note: string;
}) {
  await closeOpenHandoffsForPatient(tx, input.patientId, input.actorId, input.note.slice(0, 128));
  const created = await tx.patientHandoff.create({ data: {
    patientId: input.patientId, fromUserId: input.actorId, fromRole: input.actorRole, toRole: input.toRole,
    toUserId: input.toUserId, toCenterId: input.toCenterId ?? null, status: "SENT", sentAt: new Date(), note: input.note,
  } });
  const centerName = await destinationCenterName(tx, created.toCenterId);
  await tx.auditLog.create({ data: {
    userId: input.actorId, action: "CREATE", tableName: "patient_handoffs", recordId: created.id,
    newValue: { toUserId: created.toUserId, toRole: created.toRole, toCenterId: created.toCenterId, automatic: true },
  } });
  const patient = tx.patient?.findUnique
    ? await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true, fullName: true, branchId: true, archivedAt: true } })
    : null;
  await notifyUserInTransaction(tx, input.toUserId, "تسليم مراجع جديد", { body: handoffNotificationBody(patient?.fullName ?? "مراجع", created.id, created.toRole, centerName), link: "/my-work", handoffId: created.id });
  return created;
}

const inboxOptionsSchema = z.object({
  centerId: centerSchema.optional(), page: z.number().int().min(1).max(10000), pageSize: z.number().int().min(1).max(20),
}).strict();

export function sortInboxHandoffs<T extends Pick<PatientHandoff, "id" | "status" | "sentAt" | "toRole" | "fromCenterId" | "toCenterId">>(items: readonly T[], now: Date): T[] {
  const colorRank = { red: 0, yellow: 1, green: 2 };
  return [...items].sort((a, b) => {
    const statusRank = (item: T) => item.status === "SENT" ? 0 : item.status === "ACCEPTED" ? 1 : 2;
    const rank = statusRank(a) - statusRank(b);
    if (rank) return rank;
    if (a.status === "SENT") {
      const aColor = handoffDelayColor(a.sentAt, now, handoffLimitMinutes(a));
      const bColor = handoffDelayColor(b.sentAt, now, handoffLimitMinutes(b));
      const color = colorRank[aColor] - colorRank[bColor];
      if (color) return color;
    }
    return a.sentAt.getTime() - b.sentAt.getTime() || a.id.localeCompare(b.id);
  });
}

export async function listInbox(actor: HandoffActor, options: { centerId?: number; page: number; pageSize: number }, db: HandoffTransaction = prisma) {
  const parsed = inboxOptionsSchema.parse(options);
  const user = await activeActor(actor, "handoff.receive", db);
  const eligible = await recipientWhere(user, db);
  const items = await db.patientHandoff.findMany({ where: { toCenterId: parsed.centerId, OR: [
    { status: "SENT", AND: [eligible] }, { status: "ACCEPTED", acceptedById: user.id, AND: [eligible] },
  ] } });
  const sorted = sortInboxHandoffs(items, new Date());
  const start = (parsed.page - 1) * parsed.pageSize;
  return { items: sorted.slice(start, start + parsed.pageSize), total: sorted.length, page: parsed.page, pageSize: parsed.pageSize };
}

export async function listSentToday(actor: HandoffActor, db: HandoffTransaction = prisma) {
  const user = await activeActor(actor, "handoff.send", db);
  const { start, end } = baghdadDayRange();
  const items = await db.patientHandoff.findMany({
    where: { fromUserId: user.id, sentAt: { gte: start, lt: end } }, orderBy: [{ sentAt: "desc" }, { id: "desc" }],
  });
  const acceptorIds = [...new Set(items.map((item) => item.acceptedById).filter((id): id is string => id != null))];
  const acceptors = acceptorIds.length ? await db.user.findMany({ where: { id: { in: acceptorIds } }, select: userSelect }) : [];
  const names = new Map(acceptors.map((acceptor) => [acceptor.id, acceptor.fullName]));
  return items.map((item) => ({ ...item, acceptorName: item.acceptedById ? names.get(item.acceptedById) ?? null : null }));
}

/** Internal patient reads: callers must authorize patient access before calling. */
export async function currentHolder(patientId: string, db: HandoffTransaction = prisma) {
  idSchema.parse(patientId);
  const handoff = await db.patientHandoff.findFirst({
    where: { patientId, status: { in: ["SENT", "ACCEPTED"] } }, orderBy: [{ sentAt: "desc" }, { id: "desc" }],
  });
  if (!handoff) return null;
  const userId = handoff.status === "ACCEPTED" ? handoff.acceptedById : handoff.toUserId;
  const person = userId ? await db.user.findFirst({ where: { id: userId }, select: userSelect }) : null;
  const center = handoff.toCenterId == null ? null : await db.center.findUnique({ where: { id: handoff.toCenterId }, select: { id: true, name: true } });
  return { handoffId: handoff.id, person: person ? { id: person.id, name: person.fullName } : null, role: handoff.toRole, center, since: handoff.status === "ACCEPTED" ? handoff.acceptedAt : handoff.sentAt };
}

/** Same patient-access precondition as currentHolder. */
export async function history(patientId: string, db: HandoffTransaction = prisma) {
  idSchema.parse(patientId);
  return db.patientHandoff.findMany({ where: { patientId }, orderBy: [{ sentAt: "desc" }, { id: "desc" }] });
}
