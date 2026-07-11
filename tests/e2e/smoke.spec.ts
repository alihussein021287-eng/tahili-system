import { test, expect } from "@playwright/test";

// اختبار دخان أساسي: يتأكد إن أهم مسار بالنظام (تسجيل الدخول) يشتغل.
// شغّله بـ: E2E_USERNAME / E2E_PASSWORD لحساب اختبار مخصص، ما تستخدم حساب أدمن حقيقي بالإنتاج.
const USERNAME = process.env.E2E_USERNAME || "admin";
const PASSWORD = process.env.E2E_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD || "";

test("تسجيل الدخول ينجح ويوصل للرئيسية", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("#u")).toBeVisible();

  await page.locator("#u").fill(USERNAME);
  await page.locator("#p").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();

  // بعد الدخول الصحيح يرجّع لـ "/" — لو ظهرت رسالة خطأ فالاختبار يفشل
  await expect(page.locator("text=اسم المستخدم أو كلمة السر غير صحيحة")).toHaveCount(0, { timeout: 5000 });
  await expect(page).toHaveURL(/\/$|\/(?!login)/, { timeout: 10000 });
});

test("بيانات خاطئة ترجع رسالة خطأ واضحة ولا تدخل النظام", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#u").fill("لا_يوجد_مستخدم_بهذا_الاسم");
  await page.locator("#p").fill("كلمة-سر-غلط");
  await page.getByRole("button", { name: "دخول" }).click();

  await expect(page.locator("text=اسم المستخدم أو كلمة السر غير صحيحة")).toBeVisible({ timeout: 5000 });
});
