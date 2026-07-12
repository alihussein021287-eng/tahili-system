import { test, expect } from "@playwright/test";
import { closeChecked, pageFor, screenshot, submitAndVerify } from "./helpers";

test("workflow 01: attendance, queue and care-stage deduplication", async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, "RECEPTION");
  const patient = "ACCEPTANCE-20260713 مراجع 01 الاستقبال والطبيب والاختصاص";
  const patientId = "cmridqumv0019rr01watzuwzr";
  await page.goto(`/visits?q=${encodeURIComponent(patient)}`, { waitUntil: "domcontentloaded" });
  const form = page.locator(`form:has(input[name="patientId"][value="${patientId}"])`);
  await form.locator('input[name="notes"]').fill("ACCEPTANCE-20260713 قبول استقبال");
  await form.locator('select[name="destination"]').selectOption({ label: "طبيب/تشخيص" });
  await submitAndVerify(page, form.getByRole("button", { name: /تسجيل زيارة/ }), async () =>
    page.getByRole("main").getByText(/زيارة اليوم مسجلة مسبقاً|تم تسجيل زيارة اليوم/).isVisible().catch(() => false));
  await screenshot(page, "workflow-01-reception");
  await closeChecked(context, errors);
});
