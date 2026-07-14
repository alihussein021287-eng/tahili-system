import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db";
import { ensureLegacyAcceptancePatients } from "./fixture-factory";
import { credential, pageFor, RUN_ID, screenshot, statePath } from "./helpers";
import { submitServerAction } from "./resilient-action";

test.beforeAll(async () => { await ensureLegacyAcceptancePatients(); });

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
  await submitServerAction({
    name: "finance-expense-create",
    role: "ACCOUNTANT",
    browser,
    context: accountant.context,
    page: accountant.page,
    submit: form.getByRole("button", { name: "حفظ المسودة" }),
    dbExpectation: async () => Boolean(await prisma.woundedExpense.findFirst({ where: { beneficiary: { contains: RUN_ID }, status: "DRAFT" } })),
    confirmation: async (page) => (await page.locator("body").innerText()).includes(RUN_ID),
    recoveryUrl: "/finance/expenses",
    roleState: statePath(credential("ACCOUNTANT")),
  });
  const expense = await prisma.woundedExpense.findFirstOrThrow({ where: { beneficiary: { contains: RUN_ID } }, orderBy: { createdAt: "desc" } });
  const url = `/finance/expenses/${expense.id}`;

  const submitter = await pageFor(browser, "ACCOUNTANT");
  await submitter.page.goto(url);
  await submitServerAction({
    name: "finance-expense-submit",
    role: "ACCOUNTANT",
    browser,
    context: submitter.context,
    page: submitter.page,
    submit: submitter.page.getByRole("button", { name: "تقديم للاعتماد" }),
    dbExpectation: async () => (await prisma.woundedExpense.findUnique({ where: { id: expense.id } }))?.status === "SUBMITTED",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("مقدمة للاعتماد"),
    recoveryUrl: url,
    roleState: statePath(credential("ACCOUNTANT")),
  });

  const manager1 = await pageFor(browser, "MANAGER");
  await manager1.page.goto(url);
  await submitServerAction({
    name: "finance-expense-approve-level-1",
    role: "MANAGER",
    browser,
    context: manager1.context,
    page: manager1.page,
    submit: manager1.page.getByRole("button", { name: "اعتماد المستوى" }),
    dbExpectation: async () => (await prisma.woundedExpenseApproval.count({ where: { expenseId: expense.id } })) >= 1,
    confirmation: async (page) => (await page.locator("body").innerText()).includes("سُجل اعتمادك"),
    recoveryUrl: url,
    roleState: statePath(credential("MANAGER")),
  });

  const manager2 = await pageFor(browser, "MANAGER", "manager-2");
  await manager2.page.goto(url);
  await submitServerAction({
    name: "finance-expense-approve-level-2",
    role: "MANAGER",
    browser,
    context: manager2.context,
    page: manager2.page,
    submit: manager2.page.getByRole("button", { name: "اعتماد المستوى" }),
    dbExpectation: async () => (await prisma.woundedExpense.findUnique({ where: { id: expense.id } }))?.status === "APPROVED",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("معتمدة"),
    recoveryUrl: url,
    roleState: statePath(credential("MANAGER", "manager-2")),
  });
  const ready = await pageFor(browser, "MANAGER", "manager-2");
  await ready.page.goto(url);
  await submitServerAction({
    name: "finance-expense-ready",
    role: "MANAGER",
    browser,
    context: ready.context,
    page: ready.page,
    submit: ready.page.getByRole("button", { name: "تجهيز للصرف" }),
    dbExpectation: async () => (await prisma.woundedExpense.findUnique({ where: { id: expense.id } }))?.status === "READY_FOR_PAYMENT",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("جاهزة للصرف"),
    recoveryUrl: url,
    roleState: statePath(credential("MANAGER", "manager-2")),
  });

  const payer = await pageFor(browser, "ACCOUNTANT");
  await payer.page.goto(url);
  await submitServerAction({
    name: "finance-expense-pay",
    role: "ACCOUNTANT",
    browser,
    context: payer.context,
    page: payer.page,
    submit: payer.page.getByRole("button", { name: "تأكيد الصرف" }),
    dbExpectation: async () => (await prisma.woundedExpense.findUnique({ where: { id: expense.id } }))?.status === "PAID",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("مصروفة"),
    recoveryUrl: url,
    roleState: statePath(credential("ACCOUNTANT")),
  });
  const voucher = await pageFor(browser, "ACCOUNTANT");
  await voucher.page.goto(`${url}/voucher`);
  await expect(voucher.page.getByText("سند صرف رسمي", { exact: true })).toBeVisible();
  await screenshot(voucher.page, "workflow-18-voucher");
  await voucher.context.close();
});

test("workflow 19: expense rejection locks payment path", async ({ browser }) => {
  const accountant = await pageFor(browser, "ACCOUNTANT");
  await accountant.page.goto("/finance/expenses");
  const form = accountant.page.locator('form:has-text("إنشاء مسودة صرفية")');
  await form.locator('select[name="patientId"]').selectOption({ label: "ACCEPTANCE-20260713 مراجع 18 صرفية جريح، ملف #30" });
  await form.locator('input[name="beneficiary"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} رفض`);
  await form.locator('input[name="expenseType"]').fill("رفض قبول");
  await form.locator('input[name="amount"]').fill("75000");
  await form.locator('textarea[name="reason"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} سيناريو رفض`);
  await submitServerAction({
    name: "finance-expense-reject-create",
    role: "ACCOUNTANT",
    browser,
    context: accountant.context,
    page: accountant.page,
    submit: form.getByRole("button", { name: "حفظ المسودة" }),
    dbExpectation: async () => Boolean(await prisma.woundedExpense.findFirst({ where: { beneficiary: { contains: `${RUN_ID} رفض` }, status: "DRAFT" } })),
    confirmation: async (page) => (await page.locator("body").innerText()).includes(`${RUN_ID} رفض`),
    recoveryUrl: "/finance/expenses",
    roleState: statePath(credential("ACCOUNTANT")),
  });
  const expense = await prisma.woundedExpense.findFirstOrThrow({ where: { beneficiary: { contains: `${RUN_ID} رفض` } }, orderBy: { createdAt: "desc" } });
  const url = `/finance/expenses/${expense.id}`;

  const submitter = await pageFor(browser, "ACCOUNTANT");
  await submitter.page.goto(url);
  await submitServerAction({
    name: "finance-expense-reject-submit",
    role: "ACCOUNTANT",
    browser,
    context: submitter.context,
    page: submitter.page,
    submit: submitter.page.getByRole("button", { name: "تقديم للاعتماد" }),
    dbExpectation: async () => (await prisma.woundedExpense.findUnique({ where: { id: expense.id } }))?.status === "SUBMITTED",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("مقدمة للاعتماد"),
    recoveryUrl: url,
    roleState: statePath(credential("ACCOUNTANT")),
  });

  const manager = await pageFor(browser, "MANAGER");
  await manager.page.goto(url);
  const rejectForm = manager.page.locator('form:has(button:has-text("رفض"))');
  await rejectForm.locator('input[name="reason"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} رفض مسبب`);
  await submitServerAction({
    name: "finance-expense-reject-decision",
    role: "MANAGER",
    browser,
    context: manager.context,
    page: manager.page,
    submit: rejectForm.getByRole("button", { name: "رفض" }),
    dbExpectation: async () => (await prisma.woundedExpense.findUnique({ where: { id: expense.id } }))?.status === "REJECTED",
    confirmation: async (page) => (await page.locator("body").innerText()).includes("مرفوضة"),
    recoveryUrl: url,
    roleState: statePath(credential("MANAGER")),
  });
  expect(await prisma.woundedExpenseApproval.count({ where: { expenseId: expense.id, decision: "REJECTED" } })).toBe(1);
  const rejected = await pageFor(browser, "ACCOUNTANT");
  await rejected.page.goto(url);
  await expect(rejected.page.getByRole("button", { name: "تأكيد الصرف" })).toHaveCount(0);
  await screenshot(rejected.page, "workflow-19-expense-rejected");
  await rejected.context.close();
});

test.afterAll(async () => prisma.$disconnect());
