import { test, expect } from "@playwright/test";
import { closeChecked, pageFor, RUN_ID, screenshot, submitAndVerify } from "./helpers";

test("workflow 18: two distinct approvals, payment and voucher", async ({ browser }) => {
  const accountant = await pageFor(browser, "ACCOUNTANT");
  await accountant.page.goto("/finance/expenses");
  const form = accountant.page.locator('form:has-text("إنشاء مسودة صرفية")');
  await form.locator('select[name="patientId"]').selectOption({ label: "ACCEPTANCE-20260713 مراجع 18 صرفية جريح، ملف #30" });
  await form.locator('input[name="beneficiary"]').fill(`ACCEPTANCE-20260713 ${RUN_ID}`);
  await form.locator('input[name="expenseType"]').fill("دعم قبول");
  await form.locator('input[name="amount"]').fill("125000");
  await form.locator('input[name="paymentMethod"]').fill("حوالة اختبار");
  await form.locator('textarea[name="reason"]').fill(`ACCEPTANCE-20260713 ${RUN_ID}`);
  await form.getByRole("button", { name: "حفظ المسودة" }).click();
  await expect(accountant.page).toHaveURL(/\/finance\/expenses\/[^/]+$/);
  const url = accountant.page.url();
  await submitAndVerify(accountant.page, accountant.page.getByRole("button", { name: "تقديم للاعتماد" }), async () => {
    await accountant.page.reload();
    return accountant.page.getByText("مقدمة للاعتماد", { exact: true }).isVisible().catch(() => false);
  });
  await closeChecked(accountant.context, accountant.errors);

  const manager1 = await pageFor(browser, "MANAGER");
  await manager1.page.goto(url);
  await submitAndVerify(manager1.page, manager1.page.getByRole("button", { name: "اعتماد المستوى" }), async () => {
    await manager1.page.reload();
    return manager1.page.getByText(/سُجل اعتمادك لهذه الصرفية/).isVisible().catch(() => false);
  });
  await expect(manager1.page.getByRole("button", { name: "اعتماد المستوى" })).toHaveCount(0);
  await closeChecked(manager1.context, manager1.errors);

  const manager2 = await pageFor(browser, "MANAGER", "manager-2");
  await manager2.page.goto(url);
  await submitAndVerify(manager2.page, manager2.page.getByRole("button", { name: "اعتماد المستوى" }), async () => {
    await manager2.page.reload();
    return manager2.page.getByText("معتمدة", { exact: true }).isVisible().catch(() => false);
  });
  await submitAndVerify(manager2.page, manager2.page.getByRole("button", { name: "تجهيز للصرف" }), async () => {
    await manager2.page.reload();
    return manager2.page.getByText("جاهزة للصرف", { exact: true }).isVisible().catch(() => false);
  });
  await closeChecked(manager2.context, manager2.errors);

  const payer = await pageFor(browser, "ACCOUNTANT");
  await payer.page.goto(url);
  await submitAndVerify(payer.page, payer.page.getByRole("button", { name: "تأكيد الصرف" }), async () => {
    await payer.page.reload();
    return payer.page.getByText("مصروفة", { exact: true }).isVisible().catch(() => false);
  });
  await payer.page.getByRole("link", { name: "سند الصرف" }).click();
  await expect(payer.page.getByText("سند صرف رسمي", { exact: true })).toBeVisible();
  await screenshot(payer.page, "workflow-18-voucher");
  await closeChecked(payer.context, payer.errors);
});
