// The patient's path through the complex, in the order the work actually happens:
// reception → data entry → centre secretary → resident → specialist → therapy → sessions → follow-up.
// "Where is the patient now" comes from the open handoff when there is one, so the bar and the
// "now with" line can never disagree. Recorded work (reviews, diagnoses, plans) marks earlier
// stages as done; a stage the patient went past without any record is shown as skipped, not as late.

export type PathStageKey = "reception" | "dataEntry" | "secretary" | "resident" | "specialist" | "therapy" | "sessions" | "followup";
export type PathStatus = "complete" | "current" | "pending" | "skipped";

export const PATH_STAGES: readonly { key: PathStageKey; label: string }[] = [
  { key: "reception", label: "الاستقبال" },
  { key: "dataEntry", label: "إدخال البيانات" },
  { key: "secretary", label: "السكرتارية" },
  { key: "resident", label: "الطبيب المقيم" },
  { key: "specialist", label: "الاختصاص" },
  { key: "therapy", label: "العلاج" },
  { key: "sessions", label: "الجلسات والتقييم" },
  { key: "followup", label: "المتابعة" },
];

const STAGE_FOR_ROLE: Record<string, PathStageKey> = {
  RECEPTION: "reception",
  DATA_ENTRY: "dataEntry",
  SECRETARY: "secretary",
  RESIDENT: "resident",
  DOCTOR: "specialist",
  HEAD_THERAPIST: "therapy",
  THERAPIST: "therapy",
};

export type PathHandoff = { toRole: string; status: string; sentAt: Date | string };

export type PathInput = {
  dataEntryBy?: string | null;
  handoffs?: readonly PathHandoff[];
  residentReviews?: readonly unknown[];
  diagnoses?: readonly { type?: string | null }[];
  treatmentPlans?: readonly { status: string }[];
  centerPrograms?: readonly { status: string }[];
  therapySessionLogs?: readonly unknown[];
  appointments?: readonly { status: string; scheduledAt: Date | string }[];
};

export type PathStage = { key: PathStageKey; label: string; status: PathStatus };

export function derivePatientPath(input: PathInput, now: Date = new Date()): { stages: PathStage[]; currentIndex: number; next: PathStage | null } {
  const handoffs = [...(input.handoffs ?? [])].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  const open = handoffs.find((handoff) => handoff.status === "SENT" || handoff.status === "ACCEPTED");
  const plans = input.treatmentPlans ?? [];
  const programs = input.centerPrograms ?? [];
  const activeTreatment = plans.some((plan) => plan.status === "ACTIVE") || programs.some((program) => ["ASSESSMENT", "ACTIVE"].includes(program.status));
  const completedTreatment = plans.some((plan) => plan.status === "COMPLETED") || programs.some((program) => program.status === "COMPLETED");
  const hasTreatment = plans.length > 0 || programs.length > 0;
  const upcoming = (input.appointments ?? []).some((item) => item.status === "SCHEDULED" && new Date(item.scheduledAt) >= now);
  const handedTo = (role: string) => handoffs.some((handoff) => handoff.toRole === role && handoff.status !== "CANCELLED");

  const reached: Record<PathStageKey, boolean> = {
    reception: true,
    dataEntry: Boolean(input.dataEntryBy) || handoffs.some((handoff) => handoff.status !== "CANCELLED" && handoff.toRole !== "DATA_ENTRY") || handedTo("DATA_ENTRY"),
    secretary: handedTo("SECRETARY"),
    resident: (input.residentReviews?.length ?? 0) > 0 || handedTo("RESIDENT"),
    specialist: (input.diagnoses ?? []).some((item) => item.type === "SPECIALIST") || handedTo("DOCTOR"),
    therapy: hasTreatment || handedTo("HEAD_THERAPIST") || handedTo("THERAPIST"),
    sessions: (input.therapySessionLogs?.length ?? 0) > 0 || completedTreatment,
    followup: false,
  };

  const indexOf = (key: PathStageKey) => PATH_STAGES.findIndex((stage) => stage.key === key);
  let currentIndex: number;
  if (open) {
    const stage = STAGE_FOR_ROLE[open.toRole] ?? "reception";
    currentIndex = indexOf(stage === "therapy" && open.toRole === "THERAPIST" && activeTreatment ? "sessions" : stage);
  } else if (activeTreatment) {
    currentIndex = indexOf("sessions");
  } else if (completedTreatment || upcoming && hasTreatment) {
    currentIndex = indexOf("followup");
  } else {
    let furthest = 0;
    PATH_STAGES.forEach((stage, index) => { if (reached[stage.key]) furthest = index; });
    currentIndex = Math.min(furthest + 1, PATH_STAGES.length - 1);
  }

  const stages = PATH_STAGES.map((stage, index): PathStage => ({
    ...stage,
    status: index === currentIndex ? "current" : reached[stage.key] ? "complete" : index < currentIndex ? "skipped" : "pending",
  }));
  return { stages, currentIndex, next: stages[currentIndex + 1] ?? null };
}
