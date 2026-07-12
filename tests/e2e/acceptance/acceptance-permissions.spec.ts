import { test, expect } from "@playwright/test";
import { closeChecked, credentials, pageFor, screenshot } from "./helpers";

const allowed: Record<string, string> = {
  ADMIN: "/users", MANAGER: "/centers", DATA_ENTRY: "/referrals", DOCTOR: "/referrals",
  DRESSING: "/queue", HEAD_THERAPIST: "/therapy", LAB: "/queue", PHARMACIST: "/pharmacy",
  PROSTHETICS: "/devices", RADIOLOGY: "/queue", RECEPTION: "/visits", RESIDENT: "/referrals",
  THERAPIST: "/therapy/today", VIEWER: "/patients", ACCOUNTANT: "/finance/expenses",
};

for (const user of credentials().filter((item) => !item.username.endsWith("manager-2"))) {
  test(`${user.role}: isolated storageState, allowed route, and negative direct URL`, async ({ browser }) => {
    const { context, page, errors } = await pageFor(browser, user.role);
    await page.goto(allowed[user.role]);
    await expect(page).toHaveURL(new RegExp(`${allowed[user.role].replaceAll("/", "\\/")}(?:$|\\?)`));
    if (user.role !== "ADMIN") {
      const forbidden = ["ACCOUNTANT", "MANAGER", "DOCTOR"].includes(user.role) ? "/users" : "/finance/expenses";
      await page.goto(forbidden);
      await expect(page).not.toHaveURL(new RegExp(`${forbidden.replaceAll("/", "\\/")}(?:$|\\?)`));
    }
    await screenshot(page, `permission-${user.role}`);
    await closeChecked(context, errors);
  });
}

test("MANAGER LEVEL 2 has an independent authenticated state", async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, "MANAGER", "manager-2");
  await page.goto("/finance/expenses");
  await expect(page).toHaveURL(/\/finance\/expenses$/);
  await closeChecked(context, errors);
});
