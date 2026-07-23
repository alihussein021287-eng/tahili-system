export type DerivedJourneyStatus = "complete" | "current" | "upcoming" | "blocked" | "not_required";

export type DerivedJourneyStage = {
  key: string;
  label: string;
  status: DerivedJourneyStatus;
  lastActionAt: Date | null;
  responsibleRoles: string[];
  reason: string | null;
  href: string;
  requiredPermissions: string[];
};

type JourneyInput = {
  id: string;
  registrationDate: Date;
  careStages?: { station: string; status: string; responsibleRole?: string | null; confirmedAt?: Date | null; createdAt: Date; updatedAt: Date }[];
  visits?: { visitDate: Date }[];
  residentReviews?: { date: Date; referralNeeded?: boolean | null }[];
  diagnoses?: { date: Date; type?: string | null }[];
  referralRequests?: { status: string; createdAt: Date; updatedAt: Date; acceptedAt?: Date | null; reviewedAt?: Date | null }[];
  treatmentPlans?: { status: string; createdAt: Date; evaluatedAt?: Date | null; closedAt?: Date | null; periodicEvaluations?: { evaluatedAt: Date }[] }[];
  centerPrograms?: { status: string; createdAt: Date; completedAt?: Date | null }[];
  therapySessionLogs?: { status?: string | null; performedAt: Date; completedAt?: Date | null }[];
  appointments?: { status: string; scheduledAt: Date }[];
};

function newest(dates: (Date | null | undefined)[]) {
  return dates.filter((date): date is Date => date instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

function stage(input: Omit<DerivedJourneyStage, "href"> & { tab: string }, patientId: string): DerivedJourneyStage {
  const { tab, ...rest } = input;
  return { ...rest, href: `/patients/${patientId}?tab=${tab}` };
}

export function derivePatientJourney(patient: JourneyInput, now = new Date()): DerivedJourneyStage[] {
  const visits = patient.visits ?? [];
  const reviews = patient.residentReviews ?? [];
  const diagnoses = patient.diagnoses ?? [];
  const referrals = patient.referralRequests ?? [];
  const plans = patient.treatmentPlans ?? [];
  const programs = patient.centerPrograms ?? [];
  const logs = patient.therapySessionLogs ?? [];
  const appointments = patient.appointments ?? [];
  const careStages = patient.careStages ?? [];
  const currentCareStage = careStages.find((item) => ["WAITING", "IN_PROGRESS"].includes(item.status));
  const latestCareStage = newest(careStages.map((item) => item.confirmedAt ?? item.updatedAt ?? item.createdAt));
  const careIsFor = (roles: string[]) => Boolean(currentCareStage?.responsibleRole && roles.includes(currentCareStage.responsibleRole));

  const latestVisit = newest(visits.map((item) => item.visitDate));
  const latestReview = newest(reviews.map((item) => item.date));
  const specialistDiagnoses = diagnoses.filter((item) => item.type === "SPECIALIST");
  const latestDiagnosis = newest(specialistDiagnoses.map((item) => item.date));
  const latestReferral = newest(referrals.map((item) => item.updatedAt ?? item.createdAt));
  const latestPlan = newest(plans.map((item) => item.createdAt));
  const latestProgram = newest(programs.map((item) => item.createdAt));
  const latestSession = newest(logs.map((item) => item.completedAt ?? item.performedAt));
  const latestEvaluation = newest(plans.flatMap((item) => [item.evaluatedAt, ...(item.periodicEvaluations ?? []).map((evaluation) => evaluation.evaluatedAt)]));
  const upcomingAppointment = appointments
    .filter((item) => item.status === "SCHEDULED" && item.scheduledAt >= now)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];

  const hasClinical = reviews.length > 0 || diagnoses.length > 0 || referrals.length > 0;
  const referralOpen = referrals.find((item) => !["REVIEWED", "ACCEPTED", "CANCELLED"].includes(item.status));
  const referralAccepted = referrals.some((item) => item.status === "ACCEPTED");
  const needsReferral = reviews.some((item) => item.referralNeeded) || referrals.length > 0;
  const activeTreatment = plans.some((item) => item.status === "ACTIVE") || programs.some((item) => ["ASSESSMENT", "ACTIVE"].includes(item.status));
  const completedTreatment = plans.some((item) => item.status === "COMPLETED") || programs.some((item) => item.status === "COMPLETED");
  const hasTreatment = plans.length > 0 || programs.length > 0 || logs.length > 0;
  const hasEvaluation = Boolean(latestEvaluation);

  return [
    stage({
      key: "registration", label: "التسجيل", status: "complete", lastActionAt: patient.registrationDate,
      responsibleRoles: ["RECEPTION", "DATA_ENTRY"], reason: null, tab: "overview", requiredPermissions: ["patients.view"],
    }, patient.id),
    stage({
      key: "intake", label: "الاستقبال / المقيم",
      status: latestReview ? "complete" : latestVisit || careIsFor(["RECEPTION", "RESIDENT"]) ? "current" : "upcoming",
      lastActionAt: latestReview ?? (careIsFor(["RECEPTION", "RESIDENT"]) ? latestCareStage : latestVisit),
      responsibleRoles: ["RECEPTION", "RESIDENT"],
      reason: careIsFor(["RECEPTION", "RESIDENT"]) ? `محطة ${currentCareStage?.station} تنتظر ${currentCareStage?.responsibleRole}.` : latestVisit && !latestReview ? "توجد زيارة بلا مراجعة مقيم مسجلة." : !latestVisit ? "بانتظار زيارة أو حضور فعلي." : null,
      tab: latestReview ? "resident" : "overview",
      requiredPermissions: latestReview ? ["clinical.view", "clinical.wound", "clinical.metrics"] : ["visits.view", "patients.view"],
    }, patient.id),
    stage({
      key: "specialist", label: "الاختصاص",
      status: latestDiagnosis || referrals.some((item) => ["REVIEWED", "ACCEPTED"].includes(item.status)) ? "complete" : hasClinical || careIsFor(["DOCTOR"]) ? "current" : "not_required",
      lastActionAt: newest([latestDiagnosis, latestReferral, careIsFor(["DOCTOR"]) ? latestCareStage : null]),
      responsibleRoles: ["DOCTOR"],
      reason: careIsFor(["DOCTOR"]) ? `محطة ${currentCareStage?.station} تنتظر طبيب الاختصاص.` : hasClinical && !latestDiagnosis ? "الحالة السريرية أو الإحالة موجودة بلا قرار اختصاص مكتمل." : !hasClinical ? "لا توجد بيانات تشير إلى حاجة حالية للاختصاص." : null,
      tab: "diag", requiredPermissions: ["clinical.view", "clinical.diagnosis", "clinical.report"],
    }, patient.id),
    stage({
      key: "referral", label: "الإحالة / العلاج",
      status: referralAccepted || hasTreatment ? "complete" : referralOpen || careIsFor(["HEAD_THERAPIST", "THERAPIST"]) ? "current" : needsReferral ? "blocked" : "not_required",
      lastActionAt: newest([latestReferral, latestPlan, latestProgram, careIsFor(["HEAD_THERAPIST", "THERAPIST"]) ? latestCareStage : null]),
      responsibleRoles: ["RESIDENT", "DOCTOR", "HEAD_THERAPIST"],
      reason: careIsFor(["HEAD_THERAPIST", "THERAPIST"]) ? `محطة ${currentCareStage?.station} تنتظر دور العلاج.` : referralOpen ? "الإحالة لم تصل بعد إلى قرارها التالي." : needsReferral && !referralAccepted && !hasTreatment ? "توجد حاجة إحالة بلا قبول أو خطة مرتبطة." : !needsReferral && !hasTreatment ? "لا توجد إحالة أو خطة علاج مطلوبة حالياً." : null,
      tab: referrals.length ? "referrals" : "therapyProgram",
      requiredPermissions: referrals.length ? ["referrals.view"] : ["therapy.view", "centers.view"],
    }, patient.id),
    stage({
      key: "sessions", label: "الجلسات",
      status: completedTreatment ? "complete" : activeTreatment ? "current" : hasTreatment ? "blocked" : "not_required",
      lastActionAt: latestSession ?? latestPlan ?? latestProgram,
      responsibleRoles: ["HEAD_THERAPIST", "THERAPIST"],
      reason: hasTreatment && !activeTreatment && !completedTreatment ? "البرنامج موجود لكنه غير نشط أو لا يملك جلسة حالية." : !hasTreatment ? "لا توجد خطة أو برنامج يتطلب جلسات." : null,
      tab: "sessions", requiredPermissions: ["therapy.view", "therapy.session.record", "centers.sessions.record"],
    }, patient.id),
    stage({
      key: "evaluation", label: "التقييم",
      status: hasEvaluation || completedTreatment ? "complete" : activeTreatment && logs.length > 0 ? "current" : hasTreatment ? "upcoming" : "not_required",
      lastActionAt: latestEvaluation ?? latestSession,
      responsibleRoles: ["HEAD_THERAPIST", "THERAPIST", "DOCTOR"],
      reason: activeTreatment && logs.length > 0 && !hasEvaluation ? "بدأ تنفيذ الجلسات ولم يسجل تقييم دوري أو نهائي بعد." : !hasTreatment ? "لا يوجد برنامج يحتاج تقييماً." : null,
      tab: "therapyProgram", requiredPermissions: ["therapy.view", "therapy.evaluation.periodic", "therapy.plan.finalize"],
    }, patient.id),
    stage({
      key: "followup", label: "المتابعة / الإغلاق",
      status: upcomingAppointment ? "current" : completedTreatment || hasEvaluation ? "upcoming" : "not_required",
      lastActionAt: upcomingAppointment?.scheduledAt ?? newest(plans.map((item) => item.closedAt)),
      responsibleRoles: ["RECEPTION", "DOCTOR", "HEAD_THERAPIST"],
      reason: (completedTreatment || hasEvaluation) && !upcomingAppointment ? "اكتمل تقييم أو برنامج بلا موعد متابعة قادم." : !completedTreatment && !hasEvaluation ? "لا توجد مرحلة مكتملة تستدعي متابعة أو إغلاقاً حالياً." : null,
      tab: "overview", requiredPermissions: ["appointments.view", "patients.view"],
    }, patient.id),
  ];
}

export function nextPatientStep(stages: DerivedJourneyStage[], permissions: Set<string>) {
  return stages.find((item) =>
    ["current", "blocked", "upcoming"].includes(item.status)
    && item.requiredPermissions.some((permission) => permissions.has(permission)),
  ) ?? null;
}
