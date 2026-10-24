import { prisma } from "@/lib/db";
import { patientScopeWhere } from "@/lib/patient-access";
import { loadPermissionsFromStore } from "@/lib/permission-store";

type SessionActor = { id?: string; role?: string; authVersion?: number };

/** Internal device transition; the Server Action supplies its validated session, never form actor data. */
export async function replaceDeviceInScope(actor: SessionActor, deviceId: string) {
  if (!actor?.id || !Number.isInteger(actor.authVersion)) throw new Error("غير مصرح");
  await prisma.$transaction(async (tx) => {
    // READ COMMITTED reads current state AFTER lock waits, rather than retaining a pre-wait snapshot.
    // All replacements use this order: actor -> permission stores -> memberships -> centers -> device -> patient -> branches.
    // FOR UPDATE also blocks new membership FK inserts; existing memberships need their own FOR SHARE locks.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: {
      id: true, role: true, isActive: true, needsActivation: true, authVersion: true,
      branchId: true, username: true, fullName: true,
    } });
    if (!user?.isActive || user.needsActivation || user.role !== actor.role || user.authVersion !== actor.authVersion) {
      throw new Error("غير مصرح");
    }
    // A deny override can be INSERTED, so locking existing override rows alone is insufficient.
    // These shared metadata-table locks allow concurrent readers but order permission writes after this transition.
    await tx.$executeRaw`LOCK TABLE "RolePermission", "UserPermission" IN SHARE MODE`;
    await tx.$queryRaw`SELECT id FROM center_memberships WHERE "userId" = ${user.id} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT c.id FROM centers c JOIN center_memberships m ON m."centerId" = c.id
      WHERE m."userId" = ${user.id} ORDER BY c.id FOR SHARE OF c`;
    const devices = await tx.$queryRaw<Array<{ id: string; patientId: string }>>`
      SELECT id, "patientId" FROM "Device" WHERE id = ${deviceId} FOR UPDATE`;
    const device = devices[0];
    if (!device) throw new Error("الجهاز غير موجود");
    const patients = await tx.$queryRaw<Array<{ id: string; branchId: number | null }>>`
      SELECT id, "branchId" FROM patients WHERE id = ${device.patientId} FOR SHARE`;
    const patient = patients[0];
    if (!patient) throw new Error("غير مصرح");
    await tx.$queryRaw`SELECT id FROM branches WHERE id = ${user.branchId} OR id = ${patient.branchId} ORDER BY id FOR SHARE`;

    // No request-cached session/permissions or earlier successful guard is authority for this write.
    const permissions = await loadPermissionsFromStore(user.id, user.role, {
      findRolePermissions: role => tx.rolePermission.findMany({ where: { role } }),
      findUserPermissions: userId => tx.userPermission.findMany({ where: { userId } }),
    });
    if (!permissions.has("devices.maintain")) throw new Error("غير مصرح");
    const scope = await patientScopeWhere(tx, { userId: user.id, role: user.role, permissions });
    // Keep the shared relationship rules. Evaluate relational scope in the UPDATE statement itself:
    // a committed removal of an appointment/handoff/referral before this statement cannot use an earlier boolean check.
    const updated = await tx.device.updateMany({
      where: { id: device.id, patientId: device.patientId, patient: { is: scope } },
      data: { status: "REPLACED", nextMaintenanceAt: null },
    });
    if (updated.count !== 1) throw new Error("غير مصرح");
    // Unlike best-effort logAudit, failure here MUST roll the device transition back.
    await tx.auditLog.create({ data: {
      userId: user.id, actorUsername: user.username, actorName: user.fullName,
      action: "UPDATE", tableName: "devices", recordId: device.id,
    } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 10000 });
  // Serialization/deadlock/timeout and authorization errors propagate. The whole transaction rolls back;
  // there are no external side effects or unsafe automatic retries of an earlier authorization decision.
}
