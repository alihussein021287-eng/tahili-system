import { CenterMembershipRole, CenterMembershipStatus, UserRole } from "@prisma/client";
import { z } from "zod";

export const CENTER_MEMBERSHIP_ROLE_LABELS: Record<CenterMembershipRole, string> = {
  CENTER_MANAGEMENT: "إدارة مركز",
  HEAD_THERAPIST: "رئيس المعالجين",
  THERAPIST: "معالج",
  DEVICE_OPERATOR: "مشغّل جهاز",
  SECRETARY: "سكرتارية",
  RESIDENT: "طبيب مقيم",
  SPECIALIST: "طبيب اختصاص",
};

// المعالج ومشغّل الجهاز قد يعملان في أكثر من مركز. أما بقية الصفات
// فمركز واحد فعّال هو مصدر الحقيقة حتى لا تصلهم التحويلات من موقعين.
export function allowsMultipleActiveCenters(role: CenterMembershipRole) {
  return role === CenterMembershipRole.THERAPIST || role === CenterMembershipRole.DEVICE_OPERATOR;
}

// الدور العام يحدد الصفة داخل المركز؛ لا يتحول موظف الاستقبال أو مدخل
// البيانات إلى طبيب/سكرتارية بمجرد اختيار قيمة من واجهة العضوية.
export function centerRoleForUserRole(role: UserRole): CenterMembershipRole | null {
  switch (role) {
    case UserRole.MANAGER: return CenterMembershipRole.CENTER_MANAGEMENT;
    case UserRole.HEAD_THERAPIST: return CenterMembershipRole.HEAD_THERAPIST;
    case UserRole.THERAPIST: return CenterMembershipRole.THERAPIST;
    case UserRole.SECRETARY: return CenterMembershipRole.SECRETARY;
    case UserRole.RESIDENT: return CenterMembershipRole.RESIDENT;
    case UserRole.DOCTOR: return CenterMembershipRole.SPECIALIST;
    case UserRole.DRESSING: return CenterMembershipRole.DEVICE_OPERATOR;
    case UserRole.PROSTHETICS: return CenterMembershipRole.DEVICE_OPERATOR;
    default: return null;
  }
}

const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional();

const membershipSchema = z.object({
  userId: z.string().min(1),
  role: z.nativeEnum(CenterMembershipRole),
  specialty: z.string().trim().max(200).optional(),
  status: z.nativeEnum(CenterMembershipStatus).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
}).strict();

export function parseCenterMembership(fd: FormData) {
  const result = membershipSchema.safeParse(Object.fromEntries([...fd].filter(([key]) => !key.startsWith("$ACTION_"))));
  if (!result.success) throw new Error("بيانات عضوية المركز غير صالحة");
  const { startDate, endDate, ...fields } = result.data;
  const start = startDate ? new Date(`${startDate}T00:00:00.000Z`) : new Date();
  const end = endDate ? new Date(`${endDate}T23:59:59.999Z`) : null;
  if (Number.isNaN(start.getTime()) || (end && (Number.isNaN(end.getTime()) || end < start))) {
    throw new Error("تواريخ عضوية المركز غير صالحة");
  }
  return { ...fields, specialty: fields.specialty || null, status: fields.status || CenterMembershipStatus.ACTIVE, startDate: start, endDate: end };
}

export function activeMembershipWhere(role?: CenterMembershipRole, now = new Date()) {
  return {
    ...(role ? { role } : {}),
    status: CenterMembershipStatus.ACTIVE,
    startDate: { lte: now },
    OR: [{ endDate: null }, { endDate: { gte: now } }],
    user: { is: { isActive: true } },
  };
}

export function activeSecretaryWhere(now = new Date()) {
  return activeMembershipWhere(CenterMembershipRole.SECRETARY, now);
}

export function countActiveSecretaries(members: Array<{ role: CenterMembershipRole; status: CenterMembershipStatus; startDate: Date; endDate: Date | null; user: { isActive: boolean } }>, now = new Date()) {
  return members.filter((member) => member.role === CenterMembershipRole.SECRETARY && member.status === CenterMembershipStatus.ACTIVE && member.startDate <= now && (!member.endDate || member.endDate >= now) && member.user.isActive).length;
}
