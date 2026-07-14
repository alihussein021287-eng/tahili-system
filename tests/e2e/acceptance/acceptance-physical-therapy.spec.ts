import "dotenv/config";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import { acceptanceDoctor, acceptedCenterReferral, acceptanceUser, activeTherapyHall, centerByNamePart, clinicalPatient } from "./fixture-factory";
import { credential, pageFor, RUN_ID, screenshot, statePath } from "./helpers";
import { submitServerAction } from "./resilient-action";

test.describe.configure({ mode: "serial", timeout: 180_000 });

function today() {
  const date = new Date();
  return {
    iso: date.toISOString().slice(0, 10),
    weekday: String(date.getDay()),
  };
}

async function freeTherapyTime(therapistId: string, hallId: number) {
  const { iso } = today();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  const booked = await prisma.appointment.findMany({
    where: {
      scheduledAt: { gte: start, lt: end },
      status: "SCHEDULED",
      OR: [{ assignedToId: therapistId }, { session: { is: { hallId } } }],
    },
    select: { scheduledAt: true },
  });
  const used = new Set(booked.map((row) => row.scheduledAt.toISOString().slice(11, 16)));
  for (let hour = 9; hour <= 16; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      if (!used.has(value)) return { iso, time: value };
    }
  }
  throw new Error("No free therapy slot for acceptance test");
}

async function tab(page: Page, name: string) {
  await page.locator("button").filter({ hasText: name }).last().click();
}

async function bodyOnTab(page: Page, tabName: string, text: string) {
  let body = await page.locator("body").innerText();
  if (!body.includes(text)) {
    await page.locator("button").filter({ hasText: tabName }).last().click().catch(() => undefined);
    body = await page.locator("body").innerText();
  }
  return body.includes(text);
}

async function createPhysicalPlan(browser: Browser, patientId: string, referralId: string, therapistId: string, hallId: number, title: string) {
  const { iso, weekday } = today();
  const slot = await freeTherapyTime(therapistId, hallId);
  const specialist = await acceptanceDoctor();
  const actor = await pageFor(browser, "HEAD_THERAPIST");
  await actor.page.goto(`/patients/${patientId}`, { waitUntil: "domcontentloaded" });
  await tab(actor.page, "برنامج العلاج الطبيعي");
  const form = actor.page.locator('form:has(button:has-text("إنشاء الخطة وجدولة الجلسات"))');
  await form.locator('select[name="referralRequestId"]').selectOption(referralId);
  await form.locator('input[name="title"]').fill(title);
  await form.locator('select[name="therapyType"]').selectOption("PHYSICAL");
  await form.locator('select[name="therapistId"]').selectOption(therapistId);
  await expect(form.locator('select[name="therapistId"]')).toContainText("جلسات اليوم");
  await form.locator('select[name="specialistDoctorId"]').selectOption(specialist.id);
  await form.locator('select[name="hallId"]').selectOption(String(hallId));
  await form.locator('input[name="plannedSessions"]').fill("1");
  await form.locator('input[name="startDate"]').fill(iso);
  await form.locator('input[name="sessionTime"]').fill(slot.time);
  await form.locator(`input[name="weekdays"][value="${weekday}"]`).check();
  await form.locator('textarea[name="goals"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} أهداف علاج طبيعي`);
  await submitServerAction({
    name: "physical-plan-create",
    role: "HEAD_THERAPIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "إنشاء الخطة وجدولة الجلسات" }),
    dbExpectation: async () => Boolean(await prisma.treatmentPlan.findFirst({ where: { referralRequestId: referralId } })),
    confirmation: async (page) => bodyOnTab(page, "برنامج العلاج الطبيعي", title),
    recoveryUrl: `/patients/${patientId}`,
    roleState: statePath(credential("HEAD_THERAPIST")),
  });
  return prisma.treatmentPlan.findFirstOrThrow({ where: { referralRequestId: referralId }, include: { sessions: true } });
}

async function acceptReferral(browser: Browser, referralId: string) {
  const actor = await pageFor(browser, "HEAD_THERAPIST");
  await actor.page.goto(`/referrals/${referralId}`, { waitUntil: "domcontentloaded" });
  await submitServerAction({
    name: "physical-referral-accept",
    role: "HEAD_THERAPIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: actor.page.getByRole("button", { name: "قبول الإحالة الداخلية" }),
    dbExpectation: async () => (await prisma.referralRequest.findUnique({ where: { id: referralId } }))?.status === "ACCEPTED",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("مقبولة داخلياً"),
    recoveryUrl: `/referrals/${referralId}`,
    roleState: statePath(credential("HEAD_THERAPIST")),
  });
}

async function completeTherapyAppointment(browser: Browser, appointmentId: string, patientName: string) {
  const actor = await pageFor(browser, "THERAPIST");
  await actor.page.goto("/therapy/today", { waitUntil: "domcontentloaded" });
  await expect(actor.page.getByText(patientName)).toBeVisible();
  const form = actor.page.locator(`article:has-text("${patientName}") form`).first();
  await form.locator('select[name="attended"]').selectOption("1");
  await form.locator('select[name="status"]').selectOption("COMPLETED");
  await form.locator('textarea[name="exercises"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} إجراءات علاج طبيعي`);
  await form.locator('textarea[name="response"]').fill("استجابة جيدة");
  await form.locator('textarea[name="progress"]').fill("تقدم مستقر");
  await form.locator('textarea[name="notes"]').fill("ملاحظات قبول تجريبية");
  await submitServerAction({
    name: "physical-session-complete",
    role: "THERAPIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "حفظ نتيجة الجلسة" }),
    dbExpectation: async () => (await prisma.appointment.findUnique({ where: { id: appointmentId } }))?.status === "COMPLETED",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("مكتملة"),
    recoveryUrl: "/therapy/today",
    roleState: statePath(credential("THERAPIST")),
  });
}

test("workflow 10: physical therapy referral through final consultancy follow-up", async ({ browser }) => {
  const patient = await clinicalPatient("علاج طبيعي", true);
  const center = await centerByNamePart("العلاج الطبيعي");
  const therapist = await acceptanceUser("acceptance-20260713-therapist");
  const hall = await activeTherapyHall("قاعة علاج طبيعي");
  const referral = await acceptedCenterReferral(patient.id, center.id, "إحالة علاج طبيعي");
  await acceptReferral(browser, referral.id);

  const plan = await createPhysicalPlan(browser, patient.id, referral.id, therapist.id, hall.id, `ACCEPTANCE-20260713 ${RUN_ID} خطة علاج طبيعي`);
  const session = await prisma.therapySession.findFirstOrThrow({ where: { treatmentPlanId: plan.id } });
  const appointment = await prisma.appointment.findFirstOrThrow({ where: { sessionId: session.id } });
  expect(await prisma.appointment.count({ where: { scheduledAt: appointment.scheduledAt, assignedToId: therapist.id, status: "SCHEDULED" } })).toBe(1);
  expect(await prisma.appointment.count({ where: { scheduledAt: appointment.scheduledAt, patientId: patient.id, status: "SCHEDULED" } })).toBe(1);
  expect(await prisma.appointment.count({ where: { scheduledAt: appointment.scheduledAt, session: { is: { hallId: hall.id } }, status: "SCHEDULED" } })).toBe(1);

  await completeTherapyAppointment(browser, appointment.id, patient.fullName);
  const completedSession = await prisma.therapySession.findUniqueOrThrow({ where: { id: session.id } });
  expect(completedSession.actualSessions).toBe(1);
  expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("COMPLETED");
  expect(await prisma.therapySessionLog.count({ where: { appointmentId: appointment.id } })).toBe(1);

  const afterDuplicateAttempt = await pageFor(browser, "THERAPIST");
  await afterDuplicateAttempt.page.goto("/therapy/today", { waitUntil: "domcontentloaded" });
  await expect(afterDuplicateAttempt.page.locator(`article:has-text("${patient.fullName}") button:has-text("حفظ نتيجة الجلسة")`)).toHaveCount(0);
  await afterDuplicateAttempt.context.close();
  expect((await prisma.therapySession.findUniqueOrThrow({ where: { id: session.id } })).actualSessions).toBe(1);

  const final = await pageFor(browser, "HEAD_THERAPIST");
  await final.page.goto(`/therapy/plans/${plan.id}/final`, { waitUntil: "domcontentloaded" });
  const finalForm = final.page.locator('form:has(button:has-text("حفظ التقييم النهائي"))').first();
  await finalForm.locator('textarea[name="beforeCondition"]').fill("قبل البرنامج حالة تجريبية");
  await finalForm.locator('textarea[name="afterCondition"]').fill("بعد البرنامج تحسن تجريبي");
  await finalForm.locator('input[name="improvementLevel"]').fill("تحسن جيد");
  await finalForm.locator('input[name="finalRecoveryPercent"]').fill("85");
  await finalForm.locator('textarea[name="achievedGoals"]').fill("تحققت أهداف قبول العلاج الطبيعي");
  await finalForm.locator('textarea[name="finalRecommendation"]').fill("إنهاء وتحويل للاستشارية");
  await finalForm.locator('select[name="finalDecision"]').selectOption("END");
  await submitServerAction({
    name: "physical-finalize",
    role: "HEAD_THERAPIST",
    browser,
    context: final.context,
    page: final.page,
    submit: finalForm.getByRole("button", { name: "حفظ التقييم النهائي" }),
    dbExpectation: async () => Boolean(await prisma.treatmentPlan.findFirst({ where: { id: plan.id, evaluatedAt: { not: null }, finalDecision: "END" } })),
    confirmation: async (page) => bodyOnTab(page, "برنامج العلاج الطبيعي", "مغلقة"),
    recoveryUrl: `/patients/${patient.id}`,
    roleState: statePath(credential("HEAD_THERAPIST")),
  });
  expect(await prisma.careStage.count({ where: { patientId: patient.id, station: "الاستشارية" } })).toBeGreaterThan(0);
  expect(await prisma.notification.count({ where: { targetRole: "DOCTOR", title: "تقييم علاج طبيعي نهائي", link: { contains: patient.id } } })).toBeGreaterThan(0);
  const evidence = await pageFor(browser, "HEAD_THERAPIST");
  await evidence.page.goto(`/patients/${patient.id}`, { waitUntil: "domcontentloaded" });
  await screenshot(evidence.page, "physical-therapy-complete");
  await evidence.context.close();
});

test.afterAll(async () => prisma.$disconnect());
