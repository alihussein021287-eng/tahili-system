import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const baseURL = "http://192.168.17.20:3000";
const credentialPath = process.env.QA_CREDENTIALS_PATH || "/root/tahili-role-acceptance-credentials.tsv";
const roles = [
  "ADMIN",
  "RECEPTION",
  "RESIDENT",
  "DOCTOR",
  "HEAD_THERAPIST",
  "THERAPIST",
  "PHARMACIST",
  "ACCOUNTANT",
  "LAB",
  "RADIOLOGY",
  "DRESSING",
  "PROSTHETICS",
  "VIEWER",
] as const;
const viewports = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;

type Credential = { role: string; username: string; password: string };
type PatientContract = {
  tabs: string[];
  fields: string[];
  actions: string[];
  links: string[];
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

async function firstPatientRoute(page: Page) {
  await page.goto(`${baseURL}/patients-care?tab=patients`, { waitUntil: "domcontentloaded" });
  const link = page.locator('main a[href^="/patients/"]').filter({ hasNot: page.locator('[href*="/new"]') }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) throw new Error("No visible QA patient route");
  return new URL(href, baseURL).pathname;
}

async function patientContract(page: Page): Promise<PatientContract> {
  return page.locator("main").evaluate((main) => {
    const unique = (values: string[]) => [...new Set(values)].sort();
    const tabSelect = main.querySelector<HTMLSelectElement>("#patient-tab-select");
    return {
      tabs: tabSelect ? [...tabSelect.options].map((option) => option.value) : [],
      fields: unique([...main.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name],select[name],textarea[name]")]
        .map((field) => field.name)
        .filter((name) => name && !name.startsWith("$ACTION_"))),
      actions: unique([...main.querySelectorAll<HTMLButtonElement>('button[type="submit"]')]
        .map((button) => button.textContent?.trim() || "")),
      links: unique([...main.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((link) => `${new URL(link.href).pathname}${new URL(link.href).search}`)),
    };
  });
}

test("patient file keeps its role contract across responsive layouts and themes", async ({ browser }) => {
  test.setTimeout(360_000);
  const result: Record<string, PatientContract> = {};

  for (const role of roles) {
    const context = await browser.newContext({ viewport: viewports[0] });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
    });
    await login(page, role);
    const patientRoute = await firstPatientRoute(page);
    await page.goto(`${baseURL}${patientRoute}?tab=overview`, { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    result[role] = await patientContract(page);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark", "system"]) {
        await page.evaluate((value) => {
          localStorage.setItem("tahili-theme", value);
          document.documentElement.classList.toggle("dark", value === "dark");
          document.documentElement.dataset.theme = value;
        }, theme);
        await expect.poll(() => page.evaluate(() =>
          document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        )).toBe(true);
      }
    }

    const availableTab = result[role].tabs.at(-1);
    if (availableTab) {
      await page.goto(`${baseURL}${patientRoute}?tab=${availableTab}`, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(new RegExp(`[?&]tab=${availableTab}(?:&|$)`));
      await page.reload({ waitUntil: "networkidle" });
      await expect(page).toHaveURL(new RegExp(`[?&]tab=${availableTab}(?:&|$)`));
    }
    expect(errors, `${role} browser errors`).toEqual([]);
    await context.close();
  }

  const output = process.env.UI_RESPONSIVE_SNAPSHOT_OUT;
  if (output) fs.writeFileSync(output, JSON.stringify(result), { mode: 0o600 });
  const baseline = process.env.UI_RESPONSIVE_BASELINE;
  if (baseline) expect(result).toEqual(JSON.parse(fs.readFileSync(baseline, "utf8")));
});
