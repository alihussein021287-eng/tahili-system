import "dotenv/config";
import { test } from "@playwright/test";
import { prisma } from "@/lib/db";
import { credential, pageFor, RUN_ID, statePath } from "./helpers";
import { submitServerAction } from "./resilient-action";

test("probe 1: reception submit, DB persistence, fresh UI", async ({ browser }) => {
  const patientId = "cmridquqw0029rr01epzlh9yc";
  const patient = "ACCEPTANCE-20260713 مراجع 19 رفض وإلغاء";
  const started = new Date();
  const actor = await pageFor(browser, "RECEPTION");
  await actor.page.goto(`/visits?q=${encodeURIComponent(patient)}`, { waitUntil: "domcontentloaded" });
  const form = actor.page.locator(`form:has(input[name="patientId"][value="${patientId}"])`);
  await form.locator('input[name="notes"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} reception probe`);
  await form.locator('select[name="destination"]').selectOption({ label: "الأشعة" });
  await submitServerAction({
    name: "probe-reception", role: "RECEPTION", browser, context: actor.context, page: actor.page,
    submit: form.getByRole("button", { name: /تسجيل زيارة/ }),
    dbExpectation: async () => Boolean(await prisma.careStage.findFirst({ where: { patientId, station: "الأشعة", createdAt: { gte: started } } })),
    confirmation: async (page) => page.getByText("حاضر", { exact: true }).isVisible().catch(() => false),
    recoveryUrl: `/visits?q=${encodeURIComponent(patient)}`,
    roleState: statePath(credential("RECEPTION")),
  });
});

test("probe 2: referral transition, DB persistence, fresh UI", async ({ browser }) => {
  const patientId = "cmridqunt001brr01xx57t1xa";
  const service = `ACCEPTANCE-20260713 ${RUN_ID} مختبر`;
  const creator = await pageFor(browser, "DOCTOR");
  await creator.page.goto(`/patients/${patientId}?tab=referrals`, { waitUntil: "domcontentloaded" });
  await creator.page.getByRole("button", { name: "الفحوص والإحالات" }).evaluate((button: HTMLElement) => button.click());
  await creator.page.getByText("إنشاء طلب جديد", { exact: true }).evaluate((summary) => {
    const details = summary.closest("details") as HTMLDetailsElement | null;
    if (details) details.open = true;
  });
  const form = creator.page.locator('form:has(button:has-text("حفظ الطلب كمسودة"))');
  await form.locator('select[name="destinationScope"]').selectOption("EXTERNAL");
  await form.locator('select[name="type"]').selectOption("LAB");
  await form.locator('input[name="externalEntity"]').fill("ACCEPTANCE-20260713 مختبر خارجي");
  await form.locator('select[name="assignedReviewerId"]').selectOption({ label: "ACCEPTANCE-20260713 DOCTOR" });
  await form.locator('input[name="requestedService"]').fill(service);
  await form.locator('textarea[name="clinicalReason"]').fill("ACCEPTANCE-20260713 بيانات طبية تجريبية");
  await submitServerAction({
    name: "probe-referral-create", role: "DOCTOR", browser, context: creator.context, page: creator.page,
    submit: form.getByRole("button", { name: "حفظ الطلب كمسودة" }),
    dbExpectation: async () => Boolean(await prisma.referralRequest.findFirst({ where: { requestedService: service, status: "DRAFT" } })),
    confirmation: async (page) => page.getByText(service, { exact: true }).isVisible().catch(() => false),
    recoveryUrl: "/referrals",
    roleState: statePath(credential("DOCTOR")),
  });
  const referral = await prisma.referralRequest.findFirstOrThrow({ where: { requestedService: service } });
  const doctor = await pageFor(browser, "DOCTOR");
  await doctor.page.goto(`/referrals/${referral.id}`, { waitUntil: "domcontentloaded" });
  await submitServerAction({
    name: "probe-referral-transition", role: "DOCTOR", browser, context: doctor.context, page: doctor.page,
    submit: doctor.page.getByRole("button", { name: "إرسال إلى قائمة الطباعة" }),
    dbExpectation: async () => (await prisma.referralRequest.findUnique({ where: { id: referral.id }, select: { status: true } }))?.status === "PENDING_PRINT",
    confirmation: async (page) => (await page.locator("body").innerText().catch(() => "")).includes("بانتظار كتاب الإرسال"),
    recoveryUrl: `/referrals/${referral.id}`,
    roleState: statePath(credential("DOCTOR")),
  });
});

test("probe 3: expense approval, DB persistence, fresh UI", async ({ browser }) => {
  const expense = await prisma.woundedExpense.findFirstOrThrow({
    where: { status: "SUBMITTED", approvals: { some: {} }, reason: { contains: "ACCEPTANCE-20260713" } },
    orderBy: { createdAt: "desc" }, include: { approvals: true },
  });
  const used = new Set(expense.approvals.map((row) => row.userId));
  const manager1 = await prisma.user.findUniqueOrThrow({ where: { username: credential("MANAGER").username } });
  const actorCredential = used.has(manager1.id) ? credential("MANAGER", "manager-2") : credential("MANAGER");
  const actor = await pageFor(browser, "MANAGER", actorCredential.username.endsWith("manager-2") ? "manager-2" : undefined);
  await actor.page.goto(`/finance/expenses/${expense.id}`, { waitUntil: "domcontentloaded" });
  await submitServerAction({
    name: "probe-expense-approval", role: actorCredential.username, browser, context: actor.context, page: actor.page,
    submit: actor.page.getByRole("button", { name: "اعتماد المستوى" }),
    dbExpectation: async () => (await prisma.woundedExpense.findUnique({ where: { id: expense.id }, select: { status: true } }))?.status === "APPROVED",
    confirmation: async (page) => page.getByText("معتمدة", { exact: true }).isVisible().catch(() => false),
    recoveryUrl: `/finance/expenses/${expense.id}`,
    roleState: statePath(actorCredential),
  });
});

test.afterAll(async () => { await prisma.$disconnect(); });
