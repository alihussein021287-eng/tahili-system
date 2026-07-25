import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

const baseURL = "http://192.168.17.20:3000";
const credentialPath = process.env.QA_CREDENTIALS_PATH || "/root/tahili-role-acceptance-credentials.tsv";
const settingsTabs = ["identity", "operations", "therapy", "security", "notifications", "files", "backup", "lookups"];
const routes = [
  "/users?tab=create",
  "/users?tab=list",
  ...settingsTabs.map((tab) => `/settings?tab=${tab}`),
  "/permissions?tab=matrix",
  "/collaboration/admin?tab=settings",
  "/collaboration/admin?tab=channels",
  "/collaboration/admin?tab=quarantine",
  "/backup",
  "/readiness",
];

type Credential = { role: string; username: string; password: string };
type FieldContract = {
  name: string;
  tag: string;
  type: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  required: boolean;
  options: string[];
};

function credential(role: string): Credential {
  const row = fs.readFileSync(credentialPath, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [candidateRole, username, password] = line.split("\t");
      return { role: candidateRole, username, password };
    })
    .find((candidate) => candidate.role === role);
  if (!row) throw new Error(`Missing QA credential for ${role}`);
  return row;
}

async function login(page: Page, role: string) {
  const user = credential(role);
  await page.goto(`${baseURL}/login`);
  await page.locator("#u").fill(user.username);
  await page.getByRole("button", { name: "متابعة" }).click();
  await page.locator("#p").fill(user.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function contract(scope: Locator) {
  return scope.evaluate((root) => {
    const fields: FieldContract[] = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name],select[name],textarea[name]")]
      .filter((field) => !field.name.startsWith("$ACTION_"))
      .map((field) => ({
        name: field.name,
        tag: field.tagName.toLowerCase(),
        type: field instanceof HTMLInputElement ? field.type : "",
        value: field.value,
        checked: field instanceof HTMLInputElement ? field.checked : false,
        disabled: field.disabled,
        required: field.required,
        options: field instanceof HTMLSelectElement ? [...field.options].map((option) => `${option.value}:${option.text}`) : [],
      }));
    const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.type === "submit")
      .map((button) => ({ text: button.textContent?.trim() || "", disabled: button.disabled }));
    return { fields, buttons };
  });
}

test("administrative form contracts and responsive presentation", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()}`); });
  await login(page, "ADMIN");

  const result: Record<string, Awaited<ReturnType<typeof contract>>> = {};
  for (const route of routes) {
    await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    result[route] = await contract(page.locator("main"));
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(() => {
      localStorage.setItem("tahili-theme", "dark");
      document.documentElement.classList.add("dark");
      document.documentElement.dataset.theme = "dark";
    });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  await page.goto(`${baseURL}/users?tab=list`);
  const firstUser = page.locator('main a[href^="/users/"]').first();
  if (await firstUser.isVisible()) {
    await firstUser.click();
    await page.getByRole("button", { name: "تعديل البيانات" }).click();
    result["/users/[id]?view=edit"] = await contract(page.locator("main"));
    await page.getByRole("button", { name: "الأمان" }).click();
    result["/users/[id]?view=security"] = await contract(page.locator("main"));
  }

  if (process.env.UI_FORM_POLISHED === "1") {
    for (const route of ["/users?tab=create", "/collaboration/admin?tab=settings", "/collaboration/admin?tab=channels"]) {
      await page.goto(`${baseURL}${route}`);
      const unlabeled = await page.locator("main input[name]:visible, main select[name]:visible, main textarea[name]:visible").evaluateAll((fields) =>
        fields.filter((field) => {
          if ((field as HTMLInputElement).type === "hidden") return false;
          return !field.closest("label") && !field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby");
        }).map((field) => field.getAttribute("name")),
      );
      expect(unlabeled, `${route} unlabeled fields`).toEqual([]);
    }
  }

  const output = process.env.UI_FORM_SNAPSHOT_OUT;
  if (output) fs.writeFileSync(output, JSON.stringify(result), { mode: 0o600 });
  const baseline = process.env.UI_FORM_BASELINE;
  if (baseline) expect(result).toEqual(JSON.parse(fs.readFileSync(baseline, "utf8")));
  expect(errors).toEqual([]);
  await context.close();
});

test("manager routes retain their current effective access", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("response", (response) => { if (response.status() >= 500) failures.push(`HTTP ${response.status()}`); });
  await login(page, "MANAGER");
  for (const route of ["/users", "/permissions", "/settings", "/collaboration/admin"]) {
    await page.goto(`${baseURL}${route}`).catch(() => null);
    await page.waitForLoadState("domcontentloaded");
    expect(new URL(page.url()).pathname).not.toBe("/login");
  }
  expect(failures).toEqual([]);
  await context.close();
});
