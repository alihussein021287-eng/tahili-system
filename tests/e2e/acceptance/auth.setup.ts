import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
import { credentials, expectedIdentityText, statePath, STATES } from "./helpers";

export default async function globalSetup() {
  fs.mkdirSync(STATES, { recursive: true, mode: 0o700 });
  if (credentials().every((user) => fs.existsSync(statePath(user)))) return;
  const browser = await chromium.launch({ headless: true });
  for (const user of credentials()) {
    const context = await browser.newContext({ baseURL: "http://localhost:3000" });
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator("#u").fill(user.username);
    await page.getByRole("button", { name: "متابعة" }).click();
    await expect(page.locator("#p")).toBeVisible();
    await page.locator("#p").fill(user.password);
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    const expected = expectedIdentityText(user);
    if (expected) await expect(page.getByText(expected, { exact: false }).first()).toBeVisible();
    else await expect(page.locator("body")).not.toContainText("اسم المستخدم");
    await context.storageState({ path: statePath(user) });
    fs.chmodSync(statePath(user), 0o600);
    await context.close();
  }
  await browser.close();
}
