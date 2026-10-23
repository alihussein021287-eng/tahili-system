"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertPerm, currentPerms, getSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { canAccessPatientRecord } from "@/lib/patient-access";
import { activeMembershipWhere } from "@/lib/center-membership";
import { acceptHandoff, cancelHandoff, finishHandoff, listTargets, redirectHandoff, returnHandoff, sendHandoff } from "@/lib/handoff-service";
import type { RedirectHandoffInput, SendHandoffInput } from "@/lib/handoff-service";
import { BRANCH_LEVEL_ROLES, CENTER_ROLE_FOR_TARGET, HANDOFF_TARGET_LABELS } from "@/lib/handoff-rules";
import type { HandoffTargetRole } from "@/lib/handoff-rules";
import type { UserRole } from "@prisma/client";

const id = z.string().trim().min(1).max(128).regex(/^[\w-]+$/);
const centerId = z.number().int().positive();
const role = z.enum(["SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "RECEPTION", "DATA_ENTRY"]);
const sendInput = z.object({
  patientId: id,
  toCenterId: centerId.nullish(),
  toUserId: id.nullish(),
  toRole: role,
  note: z.string().trim().max(4000).nullish(),
  careStageId: id.nullish(),
}).strict();
const returnInput = z.object({ id, reason: z.string().trim().min(1).max(4000) }).strict();
const redirectInput = z.object({ toUserId: id.nullish(), toRole: role }).strict();

type ActionResult = { ok: true; error?: never } | { ok: false; error: string };
type ListResult<T> = { ok: true; data: T; error?: never } | { ok: false; error: string; data?: never };

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return "البيانات المدخلة غير صالحة";
  if (error instanceof Error && ["غير مصرّح بهذا الإجراء", "غير مصرح", "استلمها شخص آخر", "ملف المراجع غير متاح", "سبب الإرجاع مطلوب", "المراجع بلا فرع؛ حدّد فرعه أولاً قبل التحويل للاستقبال أو إدخال البيانات"].includes(error.message)) return error.message;
  if (error instanceof Error && (error.message.startsWith("هذا المركز ما بيه ") || error.message.startsWith("المريض حالياً عند "))) return error.message;
  return "تعذر إكمال الإجراء، حاول مرة أخرى";
}

async function actor(permission: "handoff.send" | "handoff.receive") {
  const session = await getSession();
  if (!session) throw new Error("غير مصرح");
  await assertPerm(permission);
  const user = session.user as { id: string; role: UserRole };
  return { userId: user.id, role: user.role, permissions: await currentPerms() };
}

/** Finish needs handoff.receive; cancel and redirect need handoff.send. Managers pass without them. */
async function transitionActor(permission: "handoff.send" | "handoff.receive") {
  const session = await getSession();
  if (!session) throw new Error("غير مصرح");
  const user = session.user as { id: string; role: UserRole };
  const permissions = await currentPerms();
  const manager = permissions.has("handoff.manage") || user.role === "MANAGER" || user.role === "ADMIN";
  if (!manager) await assertPerm(permission);
  return { userId: user.id, role: user.role, permissions };
}

function refresh(patientId: string) {
  revalidatePath("/my-work");
  revalidatePath(`/patients/${patientId}`);
}

export async function sendHandoffAction(input: SendHandoffInput): Promise<ActionResult> {
  try {
    const sender = await actor("handoff.send");
    const data = sendInput.parse(input);
    await assertPerm("patients.view");
    const patient = await prisma.patient.findUnique({ where: { id: data.patientId }, select: { id: true, branchId: true } });
    if (!patient) return { ok: false, error: "ملف المراجع غير متاح" };
    const senderRecord = await prisma.user.findUnique({ where: { id: sender.userId }, select: { branchId: true, branch: { select: { isActive: true } } } });
    // A visit recorded today at the sender's own branch (including a verified cross-branch check-in) is a valid basis.
    const todayStart = new Date(new Date().toDateString());
    const visitedHere = senderRecord?.branch?.isActive === true && senderRecord.branchId != null && !!(await prisma.visit.findFirst({
      where: { patientId: patient.id, branchId: senderRecord.branchId, visitDate: { gte: todayStart } }, select: { id: true },
    }));
    if (!senderRecord || (!(await canAccessPatientRecord(prisma, sender, patient.id)) && !visitedHere)) {
      return { ok: false, error: "ملف المراجع غير متاح" };
    }

    const branchRole = (BRANCH_LEVEL_ROLES as readonly string[]).includes(data.toRole);
    if (branchRole && patient.branchId == null) return { ok: false, error: "المراجع بلا فرع؛ حدّد فرعه أولاً قبل التحويل للاستقبال أو إدخال البيانات" };
    if (branchRole ? data.toCenterId != null : data.toCenterId == null) return { ok: false, error: "اختيار المركز غير صالح" };
    if (!branchRole) {
      const center = await prisma.center.findFirst({ where: { id: data.toCenterId!, active: true }, select: { id: true } });
      if (!center) return { ok: false, error: "المركز غير متاح" };
    }
    if (data.toUserId) {
      const eligible = branchRole
        ? await prisma.user.findFirst({ where: { id: data.toUserId, role: data.toRole, branchId: patient.branchId, isActive: true }, select: { id: true } })
        : await prisma.centerMembership.findFirst({ where: {
          ...activeMembershipWhere(CENTER_ROLE_FOR_TARGET[data.toRole as keyof typeof CENTER_ROLE_FOR_TARGET]),
          centerId: data.toCenterId!, userId: data.toUserId,
        }, select: { userId: true } });
      if (!eligible) return { ok: false, error: `هذا المركز ما بيه ${HANDOFF_TARGET_LABELS[data.toRole]}` };
    }
    await sendHandoff(sender, data);
    refresh(data.patientId);
    return { ok: true };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function acceptHandoffAction(handoffId: string): Promise<ActionResult> {
  try {
    const receiver = await actor("handoff.receive");
    const parsedId = id.parse(handoffId);
    const handoff = await acceptHandoff(receiver, parsedId);
    refresh(handoff.patientId);
    return { ok: true };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function returnHandoffAction(handoffId: string, reason: string): Promise<ActionResult> {
  try {
    const sender = await actor("handoff.send");
    if (typeof reason !== "string" || !reason.trim()) return { ok: false, error: "سبب الإرجاع مطلوب" };
    const data = returnInput.parse({ id: handoffId, reason });
    const handoff = await returnHandoff(sender, data.id, data.reason);
    refresh(handoff.patientId);
    return { ok: true };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function finishHandoffAction(handoffId: string): Promise<ActionResult> {
  try {
    const receiver = await transitionActor("handoff.receive");
    const handoff = await finishHandoff(receiver, id.parse(handoffId));
    refresh(handoff.patientId);
    return { ok: true };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function cancelHandoffAction(handoffId: string): Promise<ActionResult> {
  try {
    const caller = await transitionActor("handoff.send");
    const handoff = await cancelHandoff(caller, id.parse(handoffId));
    refresh(handoff.patientId);
    return { ok: true };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function redirectHandoffAction(handoffId: string, input: RedirectHandoffInput): Promise<ActionResult> {
  try {
    const caller = await transitionActor("handoff.send");
    const parsed = redirectInput.parse(input);
    const handoff = await redirectHandoff(caller, id.parse(handoffId), parsed);
    refresh(handoff.patientId);
    return { ok: true };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function listHandoffTargetsAction(targetCenterId: number, toRole: HandoffTargetRole): Promise<ListResult<Awaited<ReturnType<typeof listTargets>>>> {
  try {
    const sender = await actor("handoff.send");
    const parsed = z.object({ centerId, role }).strict().parse({ centerId: targetCenterId, role: toRole });
    if ((BRANCH_LEVEL_ROLES as readonly string[]).includes(parsed.role)) return { ok: true, data: [] };
    const center = await prisma.center.findFirst({ where: { id: parsed.centerId, active: true }, select: { id: true } });
    if (!center) return { ok: false, error: "المركز غير متاح" };
    return { ok: true, data: await listTargets(sender, parsed.centerId, parsed.role) };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function listActiveCentersAction(): Promise<ListResult<{ id: number; name: string }[]>> {
  try {
    await actor("handoff.send");
    return { ok: true, data: await prisma.center.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}
