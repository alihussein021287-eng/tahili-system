import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const ROOT = "/tahili-system/test-results/acceptance-20260713";
export const STATES = path.join(ROOT, "storage-states");
export const EVIDENCE = path.join(ROOT, "screenshots");
export const RUN_ID = process.env.ACCEPTANCE_RUN_ID || `RUN-${Date.now()}`;

export type Credential = { role: string; username: string; password: string };

export function credentials(): Credential[] {
  return fs.readFileSync(path.join(ROOT, "credentials.txt"), "utf8")
    .split("\n").filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [role, username, password] = line.split("\t");
      return { role, username, password };
    });
}

export function credential(role: string, suffix?: string) {
  const row = credentials().find((item) => item.role === role && (!suffix || item.username.endsWith(suffix)));
  if (!row) throw new Error(`Missing acceptance credential for ${role}${suffix ? `/${suffix}` : ""}`);
  return row;
}

export const statePath = (user: Credential) => path.join(STATES, `${user.username}.json`);

export async function contextFor(browser: Browser, role: string, suffix?: string): Promise<BrowserContext> {
  const user = credential(role, suffix);
  return browser.newContext({ storageState: statePath(user), baseURL: "http://localhost:3000" });
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
  await expect(page.getByText(user.username.includes("manager-2") ? "ACCEPTANCE-20260713 MANAGER LEVEL 2" : `ACCEPTANCE-20260713 ${user.role}`, { exact: false }).first()).toBeVisible();
  return { context, page, user, errors };
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
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `${RUN_ID}-${name}.png`), fullPage: true });
}

export async function closeChecked(context: BrowserContext, errors: string[]) {
  await context.close();
  expect(errors.filter((error) => !error.includes("403")), "unexpected browser/HTTP errors").toEqual([]);
}
