import { test, expect } from "@playwright/test";

// اختبار دخان أساسي: يتأكد إن أهم مسار بالنظام (تسجيل الدخول) يشتغل.
// شغّله بـ: E2E_USERNAME / E2E_PASSWORD لحساب اختبار مخصص، ما تستخدم حساب أدمن حقيقي بالإنتاج.
const USERNAME = process.env.E2E_USERNAME || "admin";
const PASSWORD = process.env.E2E_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD || "";
const ACTIVATION_USER = process.env.ACTIVATION_E2E_USERNAME || "";
const TEMPORARY_PASSWORD = process.env.ACTIVATION_E2E_TEMP_PASSWORD || "";
const NEW_PASSWORD = process.env.ACTIVATION_E2E_NEW_PASSWORD || "";

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.locator("#u").fill(username);
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("#p")).toBeVisible();
  await page.locator("#p").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL((url) => url.pathname !== "/login", { timeout: 10000 });
}

test("تسجيل الدخول ينجح ويوصل للرئيسية", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("#u")).toBeVisible();

  await page.locator("#u").fill(USERNAME);
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("#p")).toBeVisible();
  await page.locator("#p").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();

  // بعد الدخول الصحيح يرجّع لـ "/" — لو ظهرت رسالة خطأ فالاختبار يفشل
  await expect(page.locator("text=اسم المستخدم أو كلمة السر غير صحيحة")).toHaveCount(0, { timeout: 5000 });
  await expect(page).toHaveURL((url) => url.pathname !== "/login", { timeout: 10000 });
});

test("كلمة سر خاطئة ترجع رسالة واضحة ولا تدخل النظام", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#u").fill(USERNAME);
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("#p")).toBeVisible();
  await page.locator("#p").fill("كلمة-سر-غلط");
  await page.getByRole("button", { name: "دخول" }).click();

  await expect(page.locator("text=كلمة السر غير صحيحة")).toBeVisible({ timeout: 5000 });
});

test("المدير ينشئ حساباً مؤقتاً ثم يفعّله المستخدم وتفشل الكلمة المؤقتة", async ({ page, context }) => {
  expect(ACTIVATION_USER, "ACTIVATION_E2E_USERNAME is required for this scenario").not.toBe("");
  expect(TEMPORARY_PASSWORD, "ACTIVATION_E2E_TEMP_PASSWORD is required for this scenario").not.toBe("");
  expect(NEW_PASSWORD, "ACTIVATION_E2E_NEW_PASSWORD is required for this scenario").not.toBe("");

  await login(page, USERNAME, PASSWORD);
  await page.goto("/users");
  await page.locator('input[name="username"]').fill(ACTIVATION_USER);
  await page.locator('input[name="fullName"]').fill(`E2E Activation ${ACTIVATION_USER}`);
  await page.locator('input[name="password"]').fill(TEMPORARY_PASSWORD);
  await page.getByRole("button", { name: "إضافة مستخدم" }).click();
  await expect(page.getByText(ACTIVATION_USER, { exact: true })).toBeVisible();

  await context.clearCookies();
  await page.goto("/login");
  await page.locator("#u").fill(ACTIVATION_USER);
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("#pt")).toBeVisible();
  await page.locator("#pt").fill(TEMPORARY_PASSWORD);
  await page.locator("#p1").fill(NEW_PASSWORD);
  await page.locator("#p2").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "تفعيل وتسجيل الدخول" }).click();
  await expect(page).toHaveURL((url) => url.pathname !== "/login", { timeout: 10000 });

  await context.clearCookies();
  await page.goto("/login");
  await page.locator("#u").fill(ACTIVATION_USER);
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("#p")).toBeVisible();
  await page.locator("#p").fill(TEMPORARY_PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByText("كلمة السر غير صحيحة")).toBeVisible();

  await page.locator("#p").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL((url) => url.pathname !== "/login", { timeout: 10000 });
});
