import { expect, test } from "@playwright/test";
import { closeChecked, credentials, pageFor } from "./helpers";

const actualUsers = credentials().filter((item) => !item.username.endsWith("manager-2"));

const expectedWorkspace: Record<string, RegExp> = {
  ADMIN: /مساحة الإدارة/,
  MANAGER: /مساحة الإدارة/,
  DATA_ENTRY: /مساحة الاستقبال/,
  DOCTOR: /مساحة طبيب الاختصاص/,
  DRESSING: /مساحة تضميد\/جروح/,
  HEAD_THERAPIST: /مساحة رئيس المعالجين/,
  LAB: /مساحة المختبر/,
  PHARMACIST: /مساحة الصيدلي/,
  PROSTHETICS: /مساحة أجهزة\/أطراف/,
  RADIOLOGY: /مساحة الأشعة/,
  RECEPTION: /مساحة الاستقبال/,
  RESIDENT: /مساحة الطبيب المقيم/,
  THERAPIST: /مساحة المعالج/,
  VIEWER: /لوحة المتابعة/,
  ACCOUNTANT: /مساحة المالية/,
};

for (const user of actualUsers) {
  test(`${user.role}: daily workspace, my work, sidebar and URL filters`, async ({ browser }) => {
    const { context, page, errors } = await pageFor(browser, user.role);
    await expect(page.getByText(expectedWorkspace[user.role]).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "قائمة عملي" }).first()).toBeVisible();

    await page.goto("/my-work?type=task&priority=urgent&date=week");
    await expect(page.getByRole("heading", { name: "قائمة عملي" })).toBeVisible();
    await expect(page.locator('select[name="type"]')).toHaveValue("task");
    await expect(page.locator('select[name="priority"]')).toHaveValue("urgent");
    await expect(page.locator('select[name="date"]')).toHaveValue("week");
    await page.reload();
    await expect(page).toHaveURL(/type=task.*priority=urgent.*date=week/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await closeChecked(context, errors);
  });
}

test("mobile my-work uses cards without horizontal overflow and keeps filters", async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, "RECEPTION");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-work");
  await expect(page.getByRole("heading", { name: "قائمة عملي" })).toBeVisible();
  await expect(page.locator("main table")).toBeHidden();
  const cards = page.locator("main article");
  if (await cards.count()) await expect(cards.first()).toBeVisible();
  else await expect(page.getByText("لا توجد حالات تنتظر دورك", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  await closeChecked(context, errors);
});

test("patient profile exposes only the derived journey and transition links", async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, "DOCTOR");
  await page.goto("/patients-care?tab=patients");
  const patientLink = page.locator('main table a[href^="/patients/"]').first();
  test.skip(await patientLink.count() === 0, "No QA patient is available for the derived journey check");
  await patientLink.click();
  await expect(page.getByText("رحلة المراجع", { exact: true })).toBeVisible();
  await expect(page.getByText("الخطوة التالية", { exact: true })).toBeVisible();
  await expect(page.locator('a[href*="/patients/"], a[href*="patients-care"], a[href*="therapy-centers"]').filter({ hasText: /انتقال|فتح الرحلة/ }).first()).toBeVisible();
  await closeChecked(context, errors);
});
