import { expect, test } from "@playwright/test";
import { closeChecked, pageFor } from "./acceptance/helpers";

function patientAwaitingResidentReviewId() {
  const id = process.env.QA_RESIDENT_TAB_PATIENT_ID;
  if (!id) throw new Error("QA_RESIDENT_TAB_PATIENT_ID is required; provide a read-only QA patient with a visit and no resident review");
  return id;
}

test("resident-review next step opens the resident tab without mutating the patient", async ({ browser }) => {
  const patientId = patientAwaitingResidentReviewId();
  const { context, page, errors } = await pageFor(browser, "ADMIN");

  await page.goto(`/patients/${patientId}?tab=overview`);
  await expect(page.getByText("توجد زيارة بلا مراجعة مقيم مسجلة.", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "الانتقال إلى التبويب" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}\\?tab=resident$`));
  await expect(page.getByRole("heading", { name: "الطبيب المقيم", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`tab=resident$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`tab=overview$`));
  await closeChecked(context, errors);
});

test("role access keeps the resident action behind clinical.metrics", async ({ browser }) => {
  const patientId = patientAwaitingResidentReviewId();

  const reception = await pageFor(browser, "RECEPTION");
  await reception.page.goto(`/patients/${patientId}?tab=overview`);
  await expect(reception.page.getByText("لا يملك حسابك هذا الإجراء", { exact: false }).first()).toBeVisible();
  await expect(reception.page.getByRole("link", { name: "الانتقال إلى التبويب" })).toHaveCount(0);
  await reception.page.goto(`/patients/${patientId}?tab=resident`);
  await expect(reception.page.getByRole("heading", { name: "الطبيب المقيم", exact: true })).toBeVisible();
  await expect(reception.page.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" })).toHaveCount(0);
  await reception.page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => reception.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await closeChecked(reception.context, reception.errors);

  const resident = await pageFor(browser, "RESIDENT");
  await resident.page.goto(`/patients/${patientId}?tab=resident`);
  await expect(resident.page.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" })).toBeVisible();
  await closeChecked(resident.context, resident.errors);

  const viewer = await pageFor(browser, "VIEWER");
  await viewer.page.goto(`/patients/${patientId}?tab=resident`);
  await expect(viewer.page.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" })).toHaveCount(0);
  await closeChecked(viewer.context, viewer.errors);
});
