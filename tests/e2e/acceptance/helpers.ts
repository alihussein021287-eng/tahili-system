import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const ROOT = "/tahili-system/test-results/role-workflow-acceptance";
export const STATES = path.join(ROOT, "storage-states");
export const EVIDENCE = path.join(ROOT, "screenshots");
export const RUN_ID = process.env.ACCEPTANCE_RUN_ID || `RUN-${Date.now()}`;
export const BASE_URL = process.env.E2E_BASE_URL || "http://192.168.17.20:3000";
export const CREDENTIALS_PATH = process.env.QA_CREDENTIALS_PATH || "/root/tahili-role-acceptance-credentials.tsv";

export const BATCH_TAG = process.env.ACCEPTANCE_BATCH || "QA-ROLE-20260724";
export type Credential = { role: string; username: string; password: string; fullName: string };

function assertDevelopmentTarget() {
  const url = new URL(BASE_URL);
  if (url.origin !== "http://192.168.17.20:3000" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Acceptance tests may run only against the approved development LAN URL");
  }
}

assertDevelopmentTarget();

export function credentials(): Credential[] {
  if (!path.isAbsolute(CREDENTIALS_PATH)) throw new Error("QA_CREDENTIALS_PATH must be absolute");
  const metadata = fs.statSync(CREDENTIALS_PATH);
  if ((metadata.mode & 0o077) !== 0) throw new Error("QA credentials must not be accessible by group or others");
  return fs.readFileSync(CREDENTIALS_PATH, "utf8")
    .split("\n").filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [role, username, password, fullName] = line.split("\t");
      if (!role || !username || !password || !fullName) throw new Error("Malformed QA credential row");
      return { role, username, password, fullName };
    });
}

export function credential(role: string, suffix?: string) {
  const row = credentials().find((item) => item.role === role && (!suffix || item.username.endsWith(suffix)));
  if (!row) throw new Error(`Missing acceptance credential for ${role}${suffix ? `/${suffix}` : ""}`);
  return row;
}

export const statePath = (user: Credential) => path.join(STATES, `${user.username}.json`);

export function expectedIdentityText(user: Credential) {
  if (user.role === "ADMIN") return null;
  return user.fullName;
}

export async function contextFor(browser: Browser, role: string, suffix?: string): Promise<BrowserContext> {
  const user = credential(role, suffix);
  return browser.newContext({ storageState: statePath(user), baseURL: BASE_URL });
}

export async function pageFor(browser: Browser, role: string, suffix?: string) {
  const user = credential(role, suffix);
  const context = await contextFor(browser, role, suffix);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.goto("/");
  if (page.url().endsWith("/login")) throw new Error(`Expired storageState for ${user.username}`);
  const expected = expectedIdentityText(user);
  if (expected) await expect(page.getByText(expected, { exact: false }).first()).toBeVisible();
  else await expect(page.locator("body")).not.toContainText("اسم المستخدم");
  return { context, page, user, errors };
}

export async function activatePatientTab(page: Page, name: string) {
  const target = page.getByRole("button", { name, exact: true }).last();
  if (!await target.isVisible().catch(() => false)) {
    for (const group of ["المتابعة", "الملف الطبي", "المسار العلاجي", "الملف الإداري", "سجل الملف"]) {
      const toggle = page.getByRole("button", { name: group, exact: true });
      if (!await toggle.isVisible().catch(() => false)) continue;
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      if (await target.isVisible().catch(() => false)) break;
    }
  }
  await expect(target).toBeVisible({ timeout: 10_000 });
  await target.click();
  await expect(page).toHaveURL(/(?:\?|&)tab=/);
}

export async function pickCombobox(scope: Page | Locator, name: string, label: string) {
  const input = scope.locator(`input[name="${name}"] + div input[role="combobox"]:visible`).first();
  const root = input.locator("../..");
  await input.click();
  await input.fill(label);
  const option = root.getByRole("button", { name: label, exact: true });
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

export async function pickComboboxContaining(scope: Page | Locator, name: string, text: string) {
  const input = scope.locator(`input[name="${name}"] + div input[role="combobox"]:visible`).first();
  const root = input.locator("../..");
  await input.click();
  await input.fill(text);
  const option = root.getByRole("button").filter({ hasText: text }).first();
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

export async function submitAndVerify(
  page: Page,
  button: Locator,
  verify: () => Promise<boolean>,
) {
  await expect(button).toBeEnabled();
  const actionPath = new URL(page.url()).pathname;
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === "POST" && new URL(candidate.url()).pathname === actionPath),
    button.click(),
  ]);
  await response.finished();
  expect(response.status(), `Server Action ${response.url()}`).toBeLessThan(500);
  await expect.poll(async () => {
    if (await verify()) return true;
    await page.reload({ waitUntil: "domcontentloaded" });
    return verify();
  }, { timeout: 20_000, intervals: [200, 400, 800, 1_500] }).toBe(true);
}

export async function screenshot(page: Page, name: string) {
  if (process.env.ACCEPTANCE_CAPTURE_IMAGES !== "1") return;
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `${RUN_ID}-${name}.png`), fullPage: true });
}

export async function closeChecked(context: BrowserContext, errors: string[]) {
  await context.close();
  expect(errors.filter((error) => !error.includes("403")), "unexpected browser/HTTP errors").toEqual([]);
}
