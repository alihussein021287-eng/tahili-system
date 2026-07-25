import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const baseURL = "http://192.168.17.20:3000";
const credentialPath = process.env.QA_CREDENTIALS_PATH || "/root/tahili-role-acceptance-credentials.tsv";
const roles = [
  "ADMIN",
  "MANAGER",
  "RECEPTION",
  "RESIDENT",
  "DOCTOR",
  "HEAD_THERAPIST",
  "THERAPIST",
  "PHARMACIST",
  "ACCOUNTANT",
  "LAB",
  "RADIOLOGY",
  "VIEWER",
] as const;
const routes = [
  "/",
  "/workspaces",
  "/my-work?type=all&priority=all",
  "/patients-care?tab=overview",
  "/therapy-centers?tab=overview",
  "/pharmacy-inventory?tab=overview",
  "/reports-finance?tab=overview",
  "/staff?tab=overview",
] as const;

type Credential = { role: string; username: string; password: string };
type RouteSnapshot = {
  path: string;
  finalPath: string;
  headings: string[];
  links: string[];
  fields: string[];
  tableHeaders: string[][];
  tableRows: number[];
  workActionLinks: string[];
};

function credentials() {
  return fs.readFileSync(credentialPath, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line): Credential => {
      const [role, username, password] = line.split("\t");
      return { role, username, password };
    });
}

async function login(page: Page, user: Credential) {
  await page.goto(`${baseURL}/login`);
  await page.locator("#u").fill(user.username);
  await page.getByRole("button", { name: "متابعة" }).click();
  await page.locator("#p").fill(user.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function snapshot(page: Page, path: string): Promise<RouteSnapshot> {
  await page.goto(`${baseURL}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(100);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const finalUrl = new URL(page.url());
  const metadata = await page.locator("main").evaluate((main) => {
    const unique = (values: string[]) => [...new Set(values)];
    const links = [...main.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .map((link) => new URL(link.href).pathname + new URL(link.href).search);
    return {
      headings: [...main.querySelectorAll("h1,h2")].map((node) => node.textContent?.trim() || ""),
      links: unique(links).sort(),
      fields: unique([...main.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name],select[name],textarea[name]")]
        .map((field) => field.name)
        .filter((name) => name && !name.startsWith("$ACTION_"))).sort(),
      tableHeaders: [...main.querySelectorAll("table")].map((table) =>
        [...table.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim() || "")),
      tableRows: [...main.querySelectorAll("table")].map((table) => table.querySelectorAll("tbody tr").length),
      workActionLinks: [...main.querySelectorAll<HTMLAnchorElement>('a[href]')]
        .filter((link) => link.getClientRects().length > 0 && link.closest("tr,article") && /فتح|متابعة|تسجيل|تجهيز|مراجعة|تنفيذ|إكمال/.test(link.textContent || ""))
        .map((link) => new URL(link.href).pathname + new URL(link.href).search),
    };
  });
  return { path, finalPath: `${finalUrl.pathname}${finalUrl.search}`, ...metadata };
}

test("role hubs preserve behavior and remain responsive", async ({ browser }) => {
  test.setTimeout(300_000);
  const rows = credentials();
  const result: Record<string, RouteSnapshot[]> = {};

  for (const role of roles) {
    const user = rows.find((candidate) => candidate.role === role);
    expect(user, `missing QA credential for ${role}`).toBeTruthy();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()}`); });
    await login(page, user!);

    result[role] = [];
    for (const path of routes) {
      const routeSnapshot = await snapshot(page, path);
      result[role].push(routeSnapshot);

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
    expect(errors, `${role} browser errors`).toEqual([]);
    await context.close();
  }

  const output = process.env.UI_HUB_SNAPSHOT_OUT;
  if (output) fs.writeFileSync(output, JSON.stringify(result), { mode: 0o600 });

  const baselinePath = process.env.UI_HUB_BASELINE;
  if (baselinePath) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const behavior = (input: Record<string, RouteSnapshot[]>) => Object.fromEntries(Object.entries(input).map(([role, snapshots]) => [
      role,
      snapshots.map(({ headings: _headings, tableHeaders, tableRows, ...route }) => ({
        ...route,
        tableHeaders: [...new Set(tableHeaders.map((headers) => JSON.stringify(headers)))].sort(),
        tableRowCount: tableRows.reduce((sum, count) => sum + count, 0),
      })),
    ]));
    expect(behavior(result)).toEqual(behavior(baseline));
  }
});
