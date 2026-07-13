import "dotenv/config";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import {
  acceptedCenterReferral,
  acceptanceUser,
  centerByNamePart,
  clinicalPatient,
  ensureCenterMembership,
} from "./fixture-factory";
import { credential, pageFor, RUN_ID, screenshot, statePath } from "./helpers";
import { submitServerAction } from "./resilient-action";

test.describe.configure({ mode: "serial", timeout: 180_000 });

function todayDateTime(time = "11:20") {
  return `${new Date().toISOString().slice(0, 10)}T${time}`;
}

async function ensureResource(centerId: number, serviceType: "PSYCHOLOGICAL" | "OCCUPATIONAL_MEDICAL" | "OCCUPATIONAL_ART", label: string) {
  return prisma.centerResource.upsert({
    where: { centerId_name: { centerId, name: `ACCEPTANCE-20260713 ${RUN_ID} ${label}` } },
    update: { status: "AVAILABLE", serviceType, capacity: 1 },
    create: { centerId, name: `ACCEPTANCE-20260713 ${RUN_ID} ${label}`, type: "ROOM", serviceType, capacity: 1, status: "AVAILABLE" },
  });
}

async function prepareCenter(part: string, roleSpecialty: string) {
  const center = await centerByNamePart(part);
  const head = await acceptanceUser("acceptance-20260713-head-therapist");
  const therapist = await acceptanceUser("acceptance-20260713-therapist");
  await ensureCenterMembership(center.id, head.id, "HEAD_THERAPIST", roleSpecialty);
  await ensureCenterMembership(center.id, therapist.id, "THERAPIST", roleSpecialty);
  return { center, head, therapist };
}

async function createProgramFromReferral(browser: Browser, slug: "psychological" | "occupational", opts: {
  centerId: number;
  patientId: string;
  patientName: string;
  referralId: string;
  assigneeId: string;
  serviceType: "PSYCHOLOGICAL" | "OCCUPATIONAL_MEDICAL" | "OCCUPATIONAL_ART";
  track: string;
  initial: string;
  capacity: string;
  goals: string;
  protocol: string;
  sensitive?: string;
}) {
  const actor = await pageFor(browser, "HEAD_THERAPIST");
  await actor.page.goto(`/centers/${slug}`, { waitUntil: "domcontentloaded" });
  const form = actor.page.locator('form:has(button:has-text("قبول وإنشاء البرنامج"))').first();
  await form.locator('select[name="referralRequestId"]').selectOption(opts.referralId);
  await form.locator('select[name="serviceType"]').selectOption(opts.serviceType);
  await form.locator('input[name="track"]').fill(opts.track);
  await form.locator('select[name="mode"]').selectOption("INDIVIDUAL");
  await form.locator('select[name="assignedToId"]').selectOption(opts.assigneeId);
  await form.locator('input[name="plannedSessions"]').fill("1");
  await form.locator('input[name="startDate"]').fill(new Date().toISOString().slice(0, 10));
  await form.locator('input[name="expectedEndDate"]').fill(new Date().toISOString().slice(0, 10));
  await form.locator('textarea[name="initialSummary"]').fill(opts.initial);
  await form.locator('textarea[name="functionalCapacity"]').fill(opts.capacity);
  await form.locator('textarea[name="goals"]').fill(opts.goals);
  await form.locator('textarea[name="protocol"]').fill(opts.protocol);
  if (opts.sensitive) await form.locator('textarea[name="sensitiveNotes"]').fill(opts.sensitive);
  await submitServerAction({
    name: `center-program-${opts.serviceType}`,
    role: "HEAD_THERAPIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "قبول وإنشاء البرنامج" }),
    dbExpectation: async () => Boolean(await prisma.centerProgram.findFirst({ where: { referralRequestId: opts.referralId, status: "ACTIVE" } })),
    confirmation: async (page) => (await page.locator("body").innerText()).includes(opts.patientName),
    recoveryUrl: `/centers/${slug}`,
    roleState: statePath(credential("HEAD_THERAPIST")),
  });
  return prisma.centerProgram.findFirstOrThrow({ where: { referralRequestId: opts.referralId } });
}

async function scheduleCenterSession(browser: Browser, slug: "psychological" | "occupational", centerId: number, programId: string, resourceId: string, label: string) {
  const actor = await pageFor(browser, "HEAD_THERAPIST");
  await actor.page.goto(`/centers/${slug}/programs/${programId}`, { waitUntil: "domcontentloaded" });
  const form = actor.page.locator('form:has(button:has-text("حجز الجلسة والموعد"))').first();
  await form.locator('input[name="scheduledAt"]').fill(todayDateTime(label.includes("فن") ? "12:10" : label.includes("طبي") ? "11:50" : "11:20"));
  await form.locator('input[name="durationMinutes"]').fill("45");
  await form.locator('select[name="resourceId"]').selectOption(resourceId);
  await submitServerAction({
    name: `center-session-${label}`,
    role: "HEAD_THERAPIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "حجز الجلسة والموعد" }),
    dbExpectation: async () => Boolean(await prisma.centerSession.findFirst({ where: { programId, resourceId } })),
    confirmation: async (page) => (await page.locator("body").innerText()).includes("SCHEDULED"),
    recoveryUrl: `/centers/${slug}/programs/${programId}`,
    roleState: statePath(credential("HEAD_THERAPIST")),
  });
  return prisma.centerSession.findFirstOrThrow({ where: { programId, resourceId } });
}

async function recordCenterSession(browser: Browser, slug: "psychological" | "occupational", sessionId: string, patientName: string, procedure: string, progress: string, sensitive?: string) {
  const actor = await pageFor(browser, "THERAPIST");
  await actor.page.goto(`/centers/${slug}/today`, { waitUntil: "domcontentloaded" });
  await expect(actor.page.getByText(patientName)).toBeVisible();
  const form = actor.page.locator(`article:has-text("${patientName}") form`).first();
  await form.locator('select[name="attended"]').selectOption("1");
  await form.locator('select[name="status"]').selectOption("COMPLETED");
  await form.locator('textarea[name="procedure"]').fill(procedure);
  await form.locator('textarea[name="result"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} نتيجة مركزية`);
  await form.locator('textarea[name="progress"]').fill(progress);
  await form.locator('textarea[name="notes"]').fill("ملاحظات قبول مركزية");
  if (sensitive) await expect(form.locator('textarea[name="sensitiveNotes"]')).toHaveCount(0);
  await submitServerAction({
    name: `center-session-record-${sessionId}`,
    role: "THERAPIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "حفظ الجلسة" }),
    dbExpectation: async () => (await prisma.centerSession.findUnique({ where: { id: sessionId } }))?.status === "COMPLETED",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("COMPLETED"),
    recoveryUrl: `/centers/${slug}/today`,
    roleState: statePath(credential("THERAPIST")),
  });
}

async function finalizeProgram(browser: Browser, slug: "psychological" | "occupational", centerId: number, programId: string, serviceText: string, sensitive?: string) {
  const actor = await pageFor(browser, "HEAD_THERAPIST");
  await actor.page.goto(`/centers/${slug}/programs/${programId}`, { waitUntil: "domcontentloaded" });
  const form = actor.page.locator('form:has(button:has-text("إغلاق البرنامج وإصدار التقييم"))').first();
  await form.locator('textarea[name="finalSummary"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} تقييم ختامي ${serviceText}`);
  await form.locator('input[name="improvementLevel"]').fill("تحسن مثبت");
  await form.locator('input[name="recommendation"]').fill("إكمال البرنامج والمتابعة عند الحاجة");
  if (sensitive) await form.locator('textarea[name="sensitiveNotes"]').fill(sensitive);
  await form.locator('input[name="returnToConsultancy"]').check();
  await submitServerAction({
    name: `center-final-${serviceText}`,
    role: "HEAD_THERAPIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "إغلاق البرنامج وإصدار التقييم" }),
    dbExpectation: async () => (await prisma.centerProgram.findUnique({ where: { id: programId } }))?.status === "COMPLETED",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("COMPLETED") || (await page.locator("body").innerText()).includes("مكتمل"),
    recoveryUrl: `/centers/${slug}/programs/${programId}`,
    roleState: statePath(credential("HEAD_THERAPIST")),
  });
  expect(await prisma.centerAssessment.count({ where: { programId, kind: "FINAL" } })).toBe(1);
}

async function runCenterCycle(browser: Browser, slug: "psychological" | "occupational", serviceType: "PSYCHOLOGICAL" | "OCCUPATIONAL_MEDICAL" | "OCCUPATIONAL_ART", label: string, sensitive?: string) {
  const centerPart = slug === "psychological" ? "النفسي" : "الوظيفي";
  const { center, therapist } = await prepareCenter(centerPart, label);
  const patient = await clinicalPatient(label, true);
  const referral = await acceptedCenterReferral(patient.id, center.id, label);
  const resource = await ensureResource(center.id, serviceType, `مورد ${label}`);
  const program = await createProgramFromReferral(browser, slug, {
    centerId: center.id,
    patientId: patient.id,
    patientName: patient.fullName,
    referralId: referral.id,
    assigneeId: therapist.id,
    serviceType,
    track: `ACCEPTANCE-20260713 ${RUN_ID} مسار ${label}`,
    initial: `ACCEPTANCE-20260713 ${RUN_ID} تقييم أولي ${label}`,
    capacity: `ACCEPTANCE-20260713 ${RUN_ID} قدرات ${label}`,
    goals: `ACCEPTANCE-20260713 ${RUN_ID} أهداف ${label}`,
    protocol: `ACCEPTANCE-20260713 ${RUN_ID} خطة ${label}`,
    sensitive,
  });
  expect((await prisma.referralRequest.findUniqueOrThrow({ where: { id: referral.id } })).status).toBe("ACCEPTED");
  const session = await scheduleCenterSession(browser, slug, center.id, program.id, resource.id, label);
  await recordCenterSession(browser, slug, session.id, patient.fullName, `ACCEPTANCE-20260713 إجراء ${label}`, `ACCEPTANCE-20260713 تقدم ${label}`, sensitive);
  await finalizeProgram(browser, slug, center.id, program.id, label, sensitive);
  if (sensitive) {
    const authorized = await pageFor(browser, "HEAD_THERAPIST");
    await authorized.page.goto(`/centers/${slug}/programs/${program.id}`, { waitUntil: "domcontentloaded" });
    await expect(authorized.page.getByText(sensitive)).not.toHaveCount(0);
    await authorized.context.close();
    const unauthorized = await pageFor(browser, "THERAPIST");
    await unauthorized.page.goto(`/centers/${slug}/programs/${program.id}`, { waitUntil: "domcontentloaded" });
    await expect(unauthorized.page.getByText(sensitive)).toHaveCount(0);
    await unauthorized.context.close();
  }
  const evidence = await pageFor(browser, "HEAD_THERAPIST");
  await evidence.page.goto(`/centers/${slug}/programs/${program.id}`, { waitUntil: "domcontentloaded" });
  await screenshot(evidence.page, `center-${serviceType}`);
  await evidence.context.close();
  return { patient, program };
}

test("workflow 11: psychological rehabilitation", async ({ browser }) => {
  await runCenterCycle(browser, "psychological", "PSYCHOLOGICAL", "تأهيل نفسي", `ACCEPTANCE-20260713 ${RUN_ID} ملاحظة نفسية حساسة`);
});

test("workflow 12: medical occupational rehabilitation", async ({ browser }) => {
  await runCenterCycle(browser, "occupational", "OCCUPATIONAL_MEDICAL", "تأهيل وظيفي طبي");
});

test("workflow 13: art occupational rehabilitation", async ({ browser }) => {
  const { program } = await runCenterCycle(browser, "occupational", "OCCUPATIONAL_ART", "تأهيل وظيفي بالفن");
  expect((await prisma.centerProgram.findUniqueOrThrow({ where: { id: program.id } })).serviceType).toBe("OCCUPATIONAL_ART");
  expect(await prisma.centerProgram.count({ where: { id: program.id, serviceType: "OCCUPATIONAL_MEDICAL" } })).toBe(0);
});

for (const name of ["workflow 14: ulcer treatment","workflow 15: pain medicine","workflow 16: hyperbaric oxygen","workflow 17: ozone treatment"]) test.skip(name, async()=>{});

test.afterAll(async () => prisma.$disconnect());
