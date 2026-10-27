import { PatientConsents } from "@/components/patients/PatientConsents";
import { ServiceAssignmentControls } from "@/components/patients/ServiceAssignmentControls";
import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { notFound } from "next/navigation";
import Link from "next/link";
import { currentPerms, getSession, requirePerm } from "@/lib/access";
import { Zoom } from "@/components/Zoom";
import { PatientTabs } from "@/components/PatientTabs";
import { eligiblePrescriptionVisitIds } from "@/lib/pharmacy-scope";
import { getCenters, getMedicationsList, getRooms } from "@/lib/lookups";
import { withViewerQuantities } from "@/lib/pharmacy-stock";
import { generatePortalToken, revokePortalToken, archivePatient, restorePatient } from "../actions";
import { createTask } from "../../tasks/actions";
import { GENDER, MARITAL, PATIENT_STATUS, CASE_TYPE, fmtDate } from "@/lib/labels";
import { ROLE_LABELS } from "@/lib/permissions";
import { getAdminConfig } from "@/lib/admin-config";
import { activeCenterHallOptions } from "@/lib/center-halls";
import { patientCenterScope } from "@/lib/patient-center-scope";
import { derivePatientPath } from "@/lib/patient-path";
import { currentHandoffStep } from "@/lib/handoff-timeline";
import { ToolsMenu } from "@/components/hub/ToolsMenu";
import { PatientHandoffJourney } from "@/components/handoffs/PatientHandoffJourney";
import { SecretaryHandoffHistory } from "@/components/handoffs/SecretaryHandoffHistory";
import { loadSecretaryHandoffHistory } from "@/lib/secretary-handoff-history";
import { activeMembershipWhere } from "@/lib/center-membership";
import { BRANCH_LEVEL_ROLES, CENTER_ROLE_FOR_TARGET } from "@/lib/handoff-rules";
import { buildPatientDetailInclude, patientClientPayload } from "@/lib/patient-detail-include";
import { referralAccessScope } from "@/lib/referral-access";
import { canAccessPatientRecord } from "@/lib/patient-access";
import { ConfirmActionForm } from "@/components/patients/ConfirmActionForm";
import { CareStageConfirmations } from "@/components/patients/CareStageConfirmations";

export const dynamic = "force-dynamic";

export default async function PatientDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ handoff?: string }> }) {
  const { id } = await params;
  await requirePerm("patients.view");
  const perms = await currentPerms();
  const _sess = await getSession();
  if (!(await canAccessPatientRecord(prisma, { userId: (_sess?.user as any)?.id ?? "", role: (_sess?.user as any)?.role, permissions: perms }, id))) notFound();
  const referralScope = perms.has("referrals.view")
    ? await referralAccessScope(prisma, { userId: (_sess!.user as any).id, role: (_sess!.user as any).role, permissions: perms })
    : null;
  const myRole = (_sess?.user as any)?.role ?? "";
  const myUserId = (_sess?.user as any)?.id as string | undefined;
  const isSecretary = myRole === "SECRETARY";
  const [patientResult, centers, medicationsCatalog, rooms, halls, centerHalls, adminConfig] = await Promise.all([
    prisma.patient.findUnique({
      where: { id },
      include: buildPatientDetailInclude(perms, referralScope?.where),
    }),
    getCenters(),
    getMedicationsList(),
    getRooms(),
    prisma.therapyHall.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    activeCenterHallOptions(prisma),
    getAdminConfig(),
  ]);
  const medications = await withViewerQuantities(medicationsCatalog);
  const taskUsers = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, role: true }, orderBy: { fullName: "asc" } });
  const therapyStaff = await prisma.user.findMany({ where: { isActive: true, role: "THERAPIST" }, include: { centerMemberships: { where: { role: "THERAPIST", status: "ACTIVE" }, select: { centerId: true } }, _count: { select: { therapyPlansAssigned: { where: { status: "ACTIVE" } }, therapyAppointmentsAssigned: { where: { status: "SCHEDULED", scheduledAt: { gte: new Date(new Date().setHours(0,0,0,0)), lt: new Date(new Date().setHours(24,0,0,0)) } } } } } }, orderBy: { fullName: "asc" } });
  if (!patientResult) notFound();
  const patient = {
    ...patientResult,
    diagnoses: patientResult.diagnoses ?? [],
    medicalReports: patientResult.medicalReports ?? [],
    residentReviews: patientResult.residentReviews ?? [],
    correspondence: patientResult.correspondence ?? [],
    woundAssessments: patientResult.woundAssessments ?? [],
    prescriptions: patientResult.prescriptions ?? [],
    admissions: patientResult.admissions ?? [],
    sickLeaves: patientResult.sickLeaves ?? [],
    officialDocuments: patientResult.officialDocuments ?? [],
  };
  const [handoffHistory, secretaryHistory, query] = await Promise.all([
    !isSecretary && perms.has("journey.view") ? prisma.patientHandoff.findMany({
      where: { patientId: id },
      select: {
        id: true, sentAt: true, acceptedAt: true, acceptedById: true, fromUserId: true, toUserId: true,
        fromRole: true, toRole: true, status: true, note: true, returnReason: true,
        fromUser: { select: { fullName: true } }, toUser: { select: { fullName: true } },
        acceptedBy: { select: { fullName: true } },
        fromCenter: { select: { name: true } }, toCenter: { select: { name: true } },
        toCenterId: true,
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    }) : Promise.resolve([]),
    isSecretary && myUserId
      ? loadSecretaryHandoffHistory({ userId: myUserId, role: "SECRETARY", permissions: perms }, id)
      : Promise.resolve([]),
    searchParams,
  ]);
  let visibleCenters = centers;
  let visibleCenterHalls = centerHalls;
  let visibleTherapyStaff = therapyStaff;
  if (!perms.has("centers.central.view")) {
    const accessSession = await getSession();
    const memberships = await prisma.centerMembership.findMany({ where: { userId: (accessSession?.user as any)?.id, status: "ACTIVE" }, select: { centerId: true } });
    const allowed = new Set(memberships.map((membership) => membership.centerId));
    (patient as any).centerPrograms = patientCenterScope((patient.centerPrograms || []), allowed, false);
    (patient as any).treatmentPlans = patientCenterScope((patient.treatmentPlans || []), allowed, false, true);
    visibleCenters = centers.filter((center: any) => allowed.has(center.id));
    visibleCenterHalls = centerHalls.filter((hall) => allowed.has(hall.centerId));
    visibleTherapyStaff = therapyStaff.filter((user) => user.centerMemberships.some((membership) => allowed.has(membership.centerId)));
  }
  const slApprovals = patient?.sickLeaves?.length
    ? await prisma.reportApproval.findMany({ where: { kind: "sick-leave", refKey: { in: patient.sickLeaves.map((l: any) => l.id) } } })
    : [];
  const visibleHandoffs = isSecretary ? secretaryHistory : handoffHistory;
  const openHandoff = visibleHandoffs.find((handoff) => handoff.status === "SENT" || handoff.status === "ACCEPTED");
  const viewerBranchId = openHandoff?.status === "SENT" && myUserId && (BRANCH_LEVEL_ROLES as readonly string[]).includes(myRole)
    ? (await prisma.user.findUnique({ where: { id: myUserId }, select: { branchId: true } }))?.branchId
    : null;
  const memberships = openHandoff?.status === "SENT" && perms.has("handoff.receive") && myUserId
    ? await prisma.centerMembership.findMany({ where: { userId: myUserId, ...activeMembershipWhere() }, select: { centerId: true, role: true } })
    : [];
  const recipientRole = openHandoff ? CENTER_ROLE_FOR_TARGET[openHandoff.toRole as keyof typeof CENTER_ROLE_FOR_TARGET] : undefined;
  const canAcceptHandoff = !!openHandoff && openHandoff.status === "SENT" && perms.has("handoff.receive") && !!myUserId && (
    openHandoff.toUserId === myUserId || (openHandoff.toUserId == null && (
      (recipientRole && memberships.some((membership) => membership.role === recipientRole && membership.centerId === openHandoff.toCenterId)) ||
      ((BRANCH_LEVEL_ROLES as readonly string[]).includes(myRole) && myRole === openHandoff.toRole && viewerBranchId != null && patient.branchId === viewerBranchId)
    ))
  );
  const canFinishHandoff = !!openHandoff && openHandoff.status === "ACCEPTED" && openHandoff.acceptedById === myUserId;
  const canCancelHandoff = !!openHandoff && openHandoff.status === "SENT" && !!myUserId && (
    openHandoff.fromUserId === myUserId || perms.has("handoff.manage") || myRole === "MANAGER" || myRole === "ADMIN"
  );
  const expenseRows = perms.has("expenses.view") ? await prisma.woundedExpense.findMany({ where: { patientId: id }, select: { id: true, voucherNo: true, expenseType: true, status: true, requestDate: true, ...(perms.has("expenses.amounts") ? { amount: true, currency: true } : {}) }, orderBy: { requestDate: "desc" } }) : [];
  const cEdit = perms.has("patients.edit");
  const cArchive = perms.has("patients.archive");
  const cPrint = perms.has("patients.print");
  const cDevices = perms.has("devices.view");
  const cFinance = perms.has("finance.view");
  const cPortal = perms.has("patients.portal");
  const cTask = perms.has("tasks.create");
  const cClinical = perms.has("clinical.view");
  // One path, one source: the open handoff says where the patient is; recorded work marks what's done.
  const path = derivePatientPath({ ...patient, handoffs: handoffHistory });

  const info = [
    ["اسم الأم", patient.motherName], ["الجنس", GENDER[patient.gender as keyof typeof GENDER]],
    ["التولد", patient.birthYear], ["الهاتف", patient.phone],
    ["المحافظة", patient.governorate?.name], ["المنطقة", patient.district?.name],
    ["الفرع", patient.branch?.name],
    ["الحالة الزوجية", MARITAL[patient.maritalStatus as keyof typeof MARITAL]],
    ["عدد الأطفال", patient.childrenCount], ["عدد الزوجات", patient.wivesCount],
    ["درجة القرابة", patient.kinshipDegree],
    ["نوع الحالة", CASE_TYPE[patient.caseType as keyof typeof CASE_TYPE]],
    ["يستلم راتب", patient.receivesSalary === true ? "نعم" : patient.receivesSalary === false ? "لا" : null],
    ["التحصيل", patient.education], ["الصفة", patient.rank],
    ["نسبة العجز", patient.disabilityPct ? `${patient.disabilityPct}%` : null],
    ["نوع الإصابة", patient.injuryType?.name], ["التشكيل", patient.formation?.name], ["سبب الإصابة", patient.injuryCause],
    ["موقف الدائرة", patient.militaryStatus],
    ["ضمن الحشد", patient.inMobilization === true ? "نعم" : patient.inMobilization === false ? "لا" : null],
    ["تاريخ الإصابة", patient.injuryDate ? fmtDate(patient.injuryDate) : null],
    ["الحركة", patient.mobility], ["مساعد الحركة", patient.mobilityAid], ["طرف صناعي", patient.prosthetic],
    ["السكن", patient.housing], ["رقم الكتاب", patient.referralBookNo],
    ["تاريخ الكتاب", patient.referralBookDate ? fmtDate(patient.referralBookDate) : null],
    ["المركز المُحال له", patient.referredToCenter],
    ["مدخل البيانات", patient.dataEntryBy],
  ];
  const filledInfo = info.filter(([, value]) => value !== null && value !== undefined && value !== "");
  const emptyInfo = info.filter(([, value]) => value === null || value === undefined || value === "");

  return (
    <div className="space-y-5">
      <section className="card overflow-visible p-4 sm:p-5" aria-labelledby="patient-name">
        <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
          <Link href="/patients" className="text-sm text-gray-500 hover:underline">→ قائمة المراجعين</Link>
          {patient.archivedAt && <span className="badge bg-amber-50 text-amber-700">مؤرشف — {fmtDate(patient.archivedAt)}</span>}
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {patient.photoUrl
              ? <Zoom src={patient.photoUrl} className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover" />
              : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-2xl font-bold text-brand-700">{patient.fullName?.[0] ?? "؟"}</div>}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 id="patient-name" className="text-2xl font-bold text-gray-900">{patient.fullName}</h1>
                <span className="badge-brand">ملف #{patient.fileNumber}</span>
                <span className="badge-neutral">{PATIENT_STATUS[patient.status as keyof typeof PATIENT_STATUS]}</span>
                {patient.archivedAt && <span className="rounded-full bg-amber-300 px-2.5 py-0.5 text-xs font-medium text-amber-950">مؤرشف</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {patient.phone && <span>{patient.phone}</span>}
                {patient.governorate?.name && <span>{patient.governorate.name}{patient.district?.name ? ` - ${patient.district.name}` : ""}</span>}
                <span>الفرع: {patient.branch?.name || "بدون فرع"}</span>
                <span>سُجّل {fmtDate(patient.registrationDate)}</span>
              </div>
            </div>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            {cEdit && <Link href={`/patients/${id}/edit`} className="btn-primary">تعديل البيانات</Link>}
            {cTask && (
              <details className="relative">
                <summary className="btn-ghost cursor-pointer list-none">📌 مهمة سريعة</summary>
                <div className="fixed inset-x-3 top-24 z-40 rounded-xl border border-gray-200 bg-white p-3 shadow-lg sm:absolute sm:left-0 sm:right-auto sm:top-auto sm:mt-1 sm:w-72">
                  <form action={createTask} className="space-y-2">
                    <input type="hidden" name="patientId" value={id} />
                    <input name="title" className="input" placeholder="عنوان المهمة / التحويل" required />
                    <textarea name="description" className="input" rows={2} placeholder="تفاصيل مختصرة" />
                    <div className="grid grid-cols-2 gap-2">
                      <Combobox name="priority" allowFree={false} defaultValue="NORMAL" options={[{value:"URGENT",label:"عاجلة"},{value:"HIGH",label:"مهمة"},{value:"NORMAL",label:"عادية"},{value:"LOW",label:"منخفضة"}]} />
                      <Combobox name="assignedToId" allowFree={false} placeholder="بلا إسناد" options={taskUsers.map((u:any)=>({value:String(u.id),label:u.fullName}))} />
                    </div>
                    <Combobox name="assignedRole" allowFree={false} placeholder="أو إسناد لدور" options={Object.entries(ROLE_LABELS).map(([value,label]:any)=>({value,label}))} />
                    <div>
                      <label className="label">موعد الاستحقاق</label>
                      <input name="dueDate" type="date" className="input" />
                    </div>
                    <button className="btn-primary w-full" type="submit">إضافة المهمة</button>
                  </form>
                </div>
              </details>
            )}
            {cPrint || cDevices || cFinance || cArchive ? (
              <ToolsMenu>
                {cPrint && <Link href={`/patients/${id}/report`}>تقرير قابل للطباعة</Link>}
                {cDevices && <Link href={`/devices?patientId=${id}`}>الأجهزة والصيانة</Link>}
                {cFinance && <Link href={`/finance?patientId=${id}`}>السجل المالي (الفواتير)</Link>}
                {cArchive && (patient.archivedAt
                  ? <ConfirmActionForm action={restorePatient.bind(null, id)} message="استرجاع هذا المراجع إلى القوائم النشطة؟"><button className="w-full rounded-lg px-3 py-2 text-right text-sm text-emerald-700 hover:bg-gray-50">↩ استرجاع من الأرشيف</button></ConfirmActionForm>
                  : <ConfirmActionForm action={archivePatient.bind(null, id)} message="أرشفة هذا المراجع؟ سيختفي من قوائم العمل اليومية ويمكن استرجاعه لاحقًا."><button className="w-full rounded-lg px-3 py-2 text-right text-sm text-amber-700 hover:bg-gray-50">🗄 أرشفة الملف</button></ConfirmActionForm>)}
              </ToolsMenu>
            ) : null}
          </div>
        </div>
      </section>

      <PatientHandoffJourney
        step={currentHandoffStep(visibleHandoffs)} handoffId={openHandoff?.id ?? null}
        historyAvailable={isSecretary || perms.has("journey.view")}
        patientId={id} patientName={patient.fullName} fileNumber={String(patient.fileNumber)} autoOpen={query.handoff === "1"}
        canSend={perms.has("handoff.send")} canAccept={canAcceptHandoff} canFinish={canFinishHandoff} canCancel={canCancelHandoff}
        path={isSecretary ? [] : path.stages} next={isSecretary ? null : path.next} showPath={!isSecretary}
      />

      {!isSecretary && perms.has("journey.view") ? (
        <CareStageConfirmations
          patientId={id}
          patientName={patient.fullName}
          fileNumber={String(patient.fileNumber)}
          stages={await (async () => {
            const openStages = await prisma.careStage.findMany({
            where: { patientId: id, status: { in: ["WAITING", "IN_PROGRESS"] } },
            orderBy: { sequence: "asc" },
            select: {
              serviceAssignmentId: true, id: true, station: true, responsibleRole: true, status: true, responsibilityScope: true, assignedUserId: true, responsibleCenterId: true,
              clinicalAssignments: { where: { revokedAt: null }, select: { id: true, reviewerId: true, acceptedById: true, acceptedAt: true } },
              requiresPhysicianConfirmation: true, operationalCompletedAt: true, operationalCompletionId: true, updatedAt: true,
              assignedUser: { select: { fullName: true } },
              referralRequest: { select: { destinationScope: true, assignedReviewerId: true, acceptedById: true, status: true, destinationCenterId: true } },
            },
            });
            const managedCenters = myRole === "MANAGER" && myUserId && perms.has("journey.manage")
              ? (await prisma.centerMembership.findMany({ where: { userId: myUserId, ...activeMembershipWhere("CENTER_MANAGEMENT"), center: { active: true } }, select: { centerId: true } })).map((m) => m.centerId)
              : [];
            const eligibleCenters = myUserId && CENTER_ROLE_FOR_TARGET[myRole as keyof typeof CENTER_ROLE_FOR_TARGET]
              ? (await prisma.centerMembership.findMany({ where: { userId: myUserId, ...activeMembershipWhere(CENTER_ROLE_FOR_TARGET[myRole as keyof typeof CENTER_ROLE_FOR_TARGET]), center: { active: true } }, select: { centerId: true } })).map(m => m.centerId) : [];
            return Promise.all(openStages.map(async (stage) => {
              let reassignCandidates: { id: string; name: string }[] | null = null;
              if (stage.responsibilityScope === "CENTER" && stage.responsibleCenterId != null && stage.responsibleRole
                && managedCenters.includes(stage.responsibleCenterId)) {
                const memberRole = CENTER_ROLE_FOR_TARGET[stage.responsibleRole as keyof typeof CENTER_ROLE_FOR_TARGET];
                reassignCandidates = memberRole ? (await prisma.centerMembership.findMany({
                  where: { centerId: stage.responsibleCenterId, ...activeMembershipWhere(memberRole), user: { isActive: true, role: stage.responsibleRole } },
                  select: { user: { select: { id: true, fullName: true } } },
                })).map((m) => ({ id: m.user.id, name: m.user.fullName })) : [];
              }
              return {
                serviceAssignmentId: stage.serviceAssignmentId, id: stage.id, station: stage.station, responsibleRole: stage.responsibleRole, status: stage.status,
                responsibilityScope: stage.responsibilityScope, assignedUserId: stage.assignedUserId,
                requiresPhysicianConfirmation: stage.requiresPhysicianConfirmation, operationalCompletionId: stage.operationalCompletionId,
                operationalCompletedAt: stage.operationalCompletedAt?.toISOString() ?? null, updatedAt: stage.updatedAt.toISOString(),
                canCompleteWork: perms.has("journey.confirm") && stage.responsibleRole === myRole && eligibleCenters.includes(stage.responsibleCenterId!) && (!stage.assignedUserId || stage.assignedUserId === myUserId),
                clinicalAssignmentId: stage.clinicalAssignments.find(a => a.reviewerId === myUserId && a.acceptedById === myUserId && a.acceptedAt)?.id,
                canPhysicianConfirm: perms.has("journey.confirm") && myRole === "DOCTOR" && eligibleCenters.includes(stage.responsibleCenterId!)
                  && stage.clinicalAssignments.some(a => a.reviewerId === myUserId && a.acceptedById === myUserId && !!a.acceptedAt),
                assignedName: stage.assignedUser?.fullName ?? null,
                specialistBound: stage.responsibilityScope === "SPECIALIST_REVIEW" && !!stage.assignedUserId
                  && stage.referralRequest?.destinationScope === "INTERNAL_SPECIALIST"
                  && stage.referralRequest.assignedReviewerId === stage.assignedUserId
                  && stage.referralRequest.acceptedById === stage.assignedUserId,
                reassignCandidates,
              };
            }));
          })()}
          userRole={myRole}
          userId={myUserId ?? ""}
          canConfirm={perms.has("journey.confirm")}
          canSend={perms.has("handoff.send")}
          canAssign={perms.has("journey.manage")}
        />
      ) : null}

      {isSecretary ? <SecretaryHandoffHistory rows={secretaryHistory} /> : null}

      <ServiceAssignmentControls patientId={id} />
      <PatientConsents patientId={id} />
      <PatientTabs rxVisitIds={perms.has("clinical.prescription") ? await eligiblePrescriptionVisitIds(prisma, id, (_sess?.user as any)?.id) : []} currentUserName={(_sess?.user as any)?.name ?? ""} currentUserId={(_sess?.user as any)?.id ?? ""} infoPanel={<div className="space-y-5">
      {(cEdit || cClinical) && <section className="space-y-3">
        <h3 className="font-semibold text-gray-800">البيانات الشخصية</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
          {filledInfo.map(([k, v]) => (
            <div key={k as string} className="border-r-2 border-gray-100 pr-3">
              <div className="text-xs text-gray-400">{k}</div>
              <div className="text-sm font-medium text-gray-800">{v}</div>
            </div>
          ))}
        </div>
        {emptyInfo.length ? <details className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-amber-800">حقول ناقصة ({emptyInfo.length})</summary>
          <p className="mt-2 text-amber-900">{emptyInfo.map(([k]) => k).join("، ")}</p>
          {cEdit ? <Link href={`/patients/${id}/edit`} className="btn-ghost mt-2 inline-flex">إكمال البيانات</Link> : null}
        </details> : null}
        {patient.notes && <p className="rounded-xl border-r-4 border-amber-300 bg-amber-50 p-3 text-sm text-gray-700">📝 {patient.notes}</p>}
      </section>}
      {cPortal && (() => {
        const base = process.env.NEXTAUTH_URL || "";
        const url = patient.accessToken ? `${base}/portal/${patient.accessToken}` : "";
        const wa = patient.phone ? `https://wa.me/${String(patient.phone).replace(/\D/g, "").replace(/^0/, "964")}?text=${encodeURIComponent("مرحباً " + patient.fullName + "، رابط بوابتك في المجمع التأهيلي: " + url)}` : "";
        return (
          <details className="no-print rounded-lg border border-gray-200 p-4">
            <summary className="cursor-pointer list-none font-semibold text-gray-700">بوابة المراجع والمشاركة</summary>
            <div className="mt-4">
            {patient.accessToken ? (
              <div className="space-y-3 text-sm">
                <div className="break-all rounded-lg bg-gray-50 p-2 text-gray-600">{url}</div>
                <div className="flex flex-wrap gap-2">
                  <a href={url} target="_blank" className="btn-ghost">فتح البوابة</a>
                  <Link href={`/patients/${id}/card`} className="btn-ghost">بطاقة + QR للطباعة</Link>
                  {wa && <a href={wa} target="_blank" className="btn-ghost text-emerald-700">مشاركة عبر واتساب</a>}
                  <form action={revokePortalToken.bind(null, id)}><button className="btn-ghost text-red-600">إلغاء الرابط</button></form>
                </div>
              </div>
            ) : (
              <form action={generatePortalToken.bind(null, id)}>
                <p className="mb-2 text-sm text-gray-500">أنشئ رابطاً خاصاً يدخل بيه المريض ويشوف مواعيده وجلساته.</p>
                <button className="btn-primary" type="submit">إنشاء رابط البوابة</button>
              </form>
            )}
            </div>
          </details>
        );
      })()}
      </div>} missingInfo={emptyInfo.length} patient={patientClientPayload(patient, perms)} editable={cEdit} perms={Array.from(perms)} role={myRole} handoffHistory={handoffHistory} slApprovals={JSON.parse(JSON.stringify(slApprovals))}
        centers={visibleCenters} medications={medications} rooms={rooms} halls={JSON.parse(JSON.stringify(halls))} centerHalls={JSON.parse(JSON.stringify(visibleCenterHalls))} therapyDefaults={{
          defaultSessions: adminConfig.defaultSessions,
          defaultPlanDays: adminConfig.defaultPlanDays,
          evaluationEvery: adminConfig.evaluationEvery,
          workDays: adminConfig.workDays,
          workStart: adminConfig.workStart,
        }} therapyStaff={visibleTherapyStaff.map((u:any)=>({id:u.id,fullName:u.fullName,centerIds:u.centerMemberships.map((membership: any) => membership.centerId),activePlans:u._count.therapyPlansAssigned,todaySessions:u._count.therapyAppointmentsAssigned}))} expenseRows={JSON.parse(JSON.stringify(expenseRows))} staffNames={taskUsers.map((u:any)=>u.fullName)} staffUsers={JSON.parse(JSON.stringify(taskUsers))} />
    </div>
  );
}
