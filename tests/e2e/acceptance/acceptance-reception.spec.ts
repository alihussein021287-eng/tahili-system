import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db";
import { ensureLegacyAcceptancePatients } from "./fixture-factory";
import { credential, pageFor, screenshot, statePath } from "./helpers";
import { submitServerAction } from "./resilient-action";

test.beforeAll(async () => { await ensureLegacyAcceptancePatients(); });

test("workflow 01: attendance, queue and care-stage deduplication", async ({ browser }) => {
  const { context, page } = await pageFor(browser, "RECEPTION");
  const patient = "ACCEPTANCE-20260713 مراجع 01 الاستقبال والطبيب والاختصاص";
  const patientId = "cmridqumv0019rr01watzuwzr";
  await page.goto(`/visits?q=${encodeURIComponent(patient)}`, { waitUntil: "domcontentloaded" });
  const form = page.locator(`form:has(input[name="patientId"][value="${patientId}"])`);
  await form.locator('input[name="notes"]').fill("ACCEPTANCE-20260713 قبول استقبال");
  await form.locator('select[name="destination"]').selectOption({ label: "طبيب/تشخيص" });
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + 1);
  await submitServerAction({
    name: "reception-visit-create",
    role: "RECEPTION",
    browser,
    context,
    page,
    submit: form.getByRole("button", { name: /تسجيل زيارة/ }),
    dbExpectation: async () => Boolean(await prisma.visit.findFirst({ where: { patientId, visitDate: { gte: start, lt: end } } })),
    confirmation: async (fresh) => (await fresh.locator("body").innerText()).includes(patient),
    recoveryUrl: `/visits?q=${encodeURIComponent(patient)}`,
    roleState: statePath(credential("RECEPTION")),
  });
  expect(await prisma.visit.count({ where: { patientId, visitDate: { gte: start, lt: end } } })).toBe(1);
  expect(await prisma.careStage.count({ where: { patientId, station: { contains: "طبيب" }, createdAt: { gte: start } } })).toBeLessThanOrEqual(1);
  const evidence = await pageFor(browser, "RECEPTION");
  await evidence.page.goto(`/visits?q=${encodeURIComponent(patient)}`, { waitUntil: "domcontentloaded" });
  await screenshot(evidence.page, "workflow-01-reception");
  await evidence.context.close();
});

test.afterAll(async () => prisma.$disconnect());
