import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { closeChecked, pageFor, screenshot } from "./helpers";

// Synthetic personnel only (QA database). Idempotent: rows are keyed by sourceKey.
const prisma = new PrismaClient();
test.beforeAll(async () => {
  const branchId = Number(process.env.ACCEPTANCE_BRANCH_ID || 0) || undefined;
  for (let i = 1; i <= 6; i++) {
    const sourceKey = `qastaff1:r${i}`;
    await prisma.employee.upsert({ where: { sourceKey }, update: { department: null, phone: null, notes: null, branchId: null }, create: { name: `طبيب مقيم اختباري ${i}`, category: "RESIDENT", job: i === 1 ? "طبيب مقيم اقدم" : "طبيب تدرج", sourceKey, branchId } });
  }
});
test.afterAll(async () => { await prisma.$disconnect(); });

test("Staff records: list, counts, filters, profile edit, mapping review, mobile RTL", async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, "ADMIN");
  await page.goto("/staff?tab=overview");
  await expect(page.locator("#main-content").getByRole("link", { name: "سجلات الموظفين", exact: true }).first()).toBeVisible();
  await expect(page.locator("#main-content").getByText("حسابات المستخدمين")).toBeVisible();
  await page.goto("/staff/employees?category=RESIDENT&q=اختباري");
  await expect(page.getByRole("heading", { name: "سجلات الموظفين" })).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(6);
  await expect(page.locator("#main-content").getByText("بلا حساب").first()).toBeVisible();
  await page.locator("#main-content").getByRole("link", { name: "طبيب مقيم اختباري 3" }).click();
  await expect(page.locator("#main-content").getByTestId("missing-info")).toContainText("الهاتف");
  await page.locator("#main-content #e-dep").fill("الباطنية");
  await page.locator("#main-content #e-ph").fill("07700000555");
  await page.locator("#main-content").getByRole("button", { name: "حفظ" }).click();
  await expect(page.locator("#main-content dd", { hasText: "07700000555" })).toBeVisible();
  await expect(page.locator("#main-content").getByText("لا يوجد حساب مرتبط")).toBeVisible();
  // link evidence with an unknown username is rejected with visible reasons and no confirm button
  await page.locator("#main-content #l-u").fill("no.such.user");
  await page.locator("#main-content").getByRole("button", { name: "مراجعة الأدلة" }).click();
  await expect(page.locator("#main-content").getByTestId("link-evidence")).toContainText("لا يوجد حساب");
  await expect(page.locator("#main-content").getByRole("button", { name: "تأكيد الربط" })).toHaveCount(0);
  await screenshot(page, "staff-employee-profile");
  await page.goto("/staff/employees?view=mapping");
  await expect(page.locator("#main-content").getByText("مراجعة تعيين الأدوار").first()).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of ["/staff/employees", "/staff/employees?view=mapping"]) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), url).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe("rtl");
  }
  await closeChecked(context, errors);
});

test("Staff records: roles without the permission are redirected and cannot replay actions", async ({ browser }) => {
  for (const role of ["RECEPTION", "PHARMACIST", "ACCOUNTANT"]) {
    const { context, page, errors } = await pageFor(browser, role);
    await page.goto("/staff/employees");
    await expect(page).not.toHaveURL(/\/staff\/employees/);
    await page.goto("/staff/employees/1");
    expect(page.url()).not.toMatch(/\/staff\/employees\/1$/);
    await closeChecked(context, errors);
  }
});

test("Staff administration: unified tabs, counts, accounts page and all five user subpages stay reachable", async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, "ADMIN");
  const main = page.locator("#main-content");
  await page.goto("/staff?tab=overview");
  const expected = ["نظرة عامة", "سجلات الموظفين", "الحسابات والأدوار", "الحضور", "الدوام والشفتات", "الإجازات", "المهام", "تقارير مختصرة"];
  for (const label of expected) await expect(main.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
  for (const tab of ["attendance", "shifts", "leaves", "tasks", "reports"]) {
    await page.goto(`/staff?tab=${tab}`);
    await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
    await expect(main.getByRole("link", { name: "سجلات الموظفين", exact: true }).first()).toBeVisible();
  }
  // personnel dashboard keeps Employee counts and User counts apart
  await page.goto("/staff/employees");
  for (const label of ["سجلات الموظفين", "أطباء مقيمون", "أطباء اختصاص", "سجلات بلا حساب", "الحسابات", "حسابات فعالة", "حسابات معطلة", "مرتبطة بحساب", "تحتاج استكمال بيانات", "تحتاج حساباً معتمداً", "حسابات بلا عضوية مركز"]) {
    await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // accounts and roles: the unified tab opens the existing administration page; its tab bar leads back
  await main.getByRole("link", { name: "الحسابات والأدوار", exact: true }).first().click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(main.getByRole("link", { name: "سجلات الموظفين", exact: true }).first()).toBeVisible();
  const user = await prisma.user.findFirstOrThrow({ where: { username: { startsWith: "acceptance" } }, select: { id: true } });
  const subpages: [string, string][] = [["profile", "معلومات الشخص"], ["membership", "مراكز العمل"], ["perms", "الصلاحيات"], ["security", "الأمان"], ["activity", "النشاط"]];
  for (const [tab, label] of subpages) {
    await page.goto(`/users/${user.id}?tab=${tab}`);
    await expect(page).toHaveURL(new RegExp(`/users/${user.id}`));
    await expect(main.getByRole("button", { name: label }).first()).toBeVisible();
  }
  await closeChecked(context, errors);
});
