import type { ReferralRequestStatus } from "@prisma/client";

export const REFERRAL_STATUS_LABELS: Record<ReferralRequestStatus, string> = {
  DRAFT: "مسودة",
  PENDING_PRINT: "بانتظار كتاب الإرسال",
  READY: "جاهز",
  SENT: "مُرسل",
  RESULT_RECEIVED: "وصلت النتيجة",
  REVIEWED: "تمت المراجعة",
  ACCEPTED: "مقبولة داخلياً",
  CANCELLED: "ملغاة",
};

const tones: Record<ReferralRequestStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_PRINT: "bg-amber-100 text-amber-800",
  READY: "bg-sky-100 text-sky-800",
  SENT: "bg-indigo-100 text-indigo-800",
  RESULT_RECEIVED: "bg-emerald-100 text-emerald-800",
  REVIEWED: "bg-teal-100 text-teal-800",
  ACCEPTED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
};

export function ReferralStatus({ status }: { status: ReferralRequestStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tones[status]}`}>{REFERRAL_STATUS_LABELS[status]}</span>;
}
