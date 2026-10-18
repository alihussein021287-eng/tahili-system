// Shared helpers for the full demo check on the LOCAL working copy (localhost:3001 only).
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Locator, type Page } from "@playwright/test";

export const BASE_URL = process.env.DEMO_BASE_URL || "http://localhost:3001";
if (new URL(BASE_URL).origin !== "http://localhost:3001") throw new Error("الفحص الشامل يعمل فقط على نسخة التجربة http://localhost:3001");

export const RESULTS = path.resolve(process.env.DEMO_RESULTS || "test-results/demo");
export const CREDENTIALS = path.resolve(process.env.DEMO_CREDENTIALS || ".ai/cache/demo/credentials.tsv");
const STATES = path.join(RESULTS, "states");
const SHOTS = path.join(RESULTS, "screenshots");
const FINDINGS = path.join(RESULTS, "findings.jsonl");
const STEPS = path.join(RESULTS, "steps.jsonl");
const ensureDirs = () => { for (const dir of [RESULTS, STATES, SHOTS]) fs.mkdirSync(dir, { recursive: true }); };
ensureDirs();

export type Credential = { role: string; username: string; password: string; fullName: string; branch: string; centers: string };

let cache: Credential[] | null = null;
export function credentials(): Credential[] {
  if (cache) return cache;
  if (!fs.existsSync(CREDENTIALS)) throw new Error(`ملف الحسابات التجريبية غير موجود: ${CREDENTIALS} — شغّل ai-mission recipe demo-reset أولاً`);
  cache = fs.readFileSync(CREDENTIALS, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const [role, username, password, fullName, branch = "", centers = ""] = line.split("\t");
    return { role, username, password, fullName, branch, centers };
  });
  return cache;
}
export const cred = (username: string) => {
  const row = credentials().find((item) => item.username === username);
  if (!row) throw new Error(`حساب غير موجود بملف التجربة: ${username}`);
  return row;
};

// ---------------------------------------------------------------- findings
export type Severity = "حرج" | "عالي" | "متوسط" | "منخفض";
export type Finding = { area: string; user?: string; url?: string; severity: Severity; message: string; screenshot?: string; at: string };

export function finding(item: Omit<Finding, "at">) {
  ensureDirs();
  fs.appendFileSync(FINDINGS, `${JSON.stringify({ ...item, at: new Date().toISOString() })}\n`);
}
export function step(area: string, message: string, ok = true) {
  ensureDirs();
  fs.appendFileSync(STEPS, `${JSON.stringify({ area, message, ok, at: new Date().toISOString() })}\n`);
}
export async function shot(page: Page, name: string) {
  ensureDirs();
  const file = path.join(SHOTS, `${Date.now()}-${name.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80)}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  return path.relative(RESULTS, file);
}

/** Watches a page for server errors, browser errors and error screens, and records each as a finding. */
const inflight = new WeakMap<Page, Map<object, string>>();
const dbg = new Map<object, any>();
/** Debug: writes the still-open requests with their headers so they can be replayed with curl. */
export async function dumpOpen(page: Page, file: string) {
  const open = inflight.get(page);
  const rows: any[] = [];
  for (const key of open?.keys() ?? []) { const request = dbg.get(key); if (request) rows.push({ url: request.url(), method: request.method(), headers: request.headers() }); }
  fs.writeFileSync(file, JSON.stringify({ cookies: await page.context().cookies(), rows }, null, 2));
}
/** Requests still open on the page (used to explain a stuck screen). */
export function openRequests(page: Page) {
  return [...(inflight.get(page)?.values() ?? [])].filter((item) => !/presence/.test(item)).slice(0, 8).join(" | ");
}

export function watch(page: Page, area: string, user: string) {
  const open = new Map<object, string>();
  inflight.set(page, open);
  page.on("request", (request) => { if (process.env.DEMO_DEBUG) dbg.set(request, request); const url = new URL(request.url()); open.set(request, `${request.method()} ${url.pathname}${url.searchParams.has("_rsc") ? "(rsc)" : ""}@${new Date().toISOString().slice(14, 19)}`); });
  page.on("response", (response) => { const item = open.get(response.request()); if (item) open.set(response.request(), `${item}+hdr${response.status()}`); });
  page.on("requestfinished", (request) => open.delete(request));
  page.on("requestfailed", (request) => open.delete(request));
  const seen = new Set<string>();
  const note = (severity: Severity, message: string) => {
    const key = `${severity}|${message.slice(0, 200)}`;
    if (seen.has(key)) return;
    seen.add(key);
    finding({ area, user, url: page.url(), severity, message });
  };
  page.on("pageerror", (error) => note("عالي", `خطأ جافاسكربت: ${error.message.slice(0, 300)}`));
  page.on("console", (message) => {
    if (message.text().startsWith("[demo-debug]")) { step("debug", `${user} ${new Date().toISOString().slice(14, 23)} ${message.text()}`); return; }
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon|Download the React DevTools|net::ERR_ABORTED|Failed to load resource: the server responded with a status of 4\d\d|CLIENT_FETCH_ERROR/.test(text)) return;
    note("متوسط", `خطأ بالمتصفح: ${text.slice(0, 300)}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) note("حرج", `خطأ خادم ${response.status()} على ${new URL(response.url()).pathname}`);
  });
}

export async function errorScreen(page: Page): Promise<string | null> {
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  const match = body.match(/حدث خطأ غير متوقع|Application error|Internal Server Error|This page could not be found|Unhandled Runtime Error|حدث خطأ/);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------- sessions
export async function login(page: Page, username: string) {
  const user = cred(username);
  await page.goto("/login");
  await page.locator("#u").fill(user.username);
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("#p")).toBeVisible();
  await page.locator("#p").fill(user.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** A logged-in page for one demo user; the session is kept on disk for the rest of the run. */
export async function as(browser: Browser, username: string, area = "عام"): Promise<Page> {
  ensureDirs();
  const state = path.join(STATES, `${username}.json`);
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: fs.existsSync(state) ? state : undefined, locale: "ar-IQ", timezoneId: "Asia/Baghdad", viewport: { width: 1440, height: 900 }, serviceWorkers: process.env.DEMO_NO_SW ? "block" : "allow" });
  const page = await context.newPage();
  watch(page, area, username);
  if (process.env.DEMO_CDP) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    const log = (kind: string, e: any) => fs.appendFileSync(path.join(RESULTS, "cdp.log"), `${new Date().toISOString().slice(14, 23)} ${username} ${kind} ${e.requestId} ${e.request ? `${e.request.method} ${e.request.url.slice(21, 80)}` : ""}${e.response ? ` ${e.response.status} conn=${e.response.connectionId} reused=${e.response.connectionReused}` : ""}${e.errorText ? ` ERR ${e.errorText}` : ""}\n`);
    for (const kind of ["requestWillBeSent", "requestWillBeSentExtraInfo", "responseReceived", "loadingFinished", "loadingFailed"]) cdp.on(`Network.${kind}` as any, (e: any) => log(kind, e));
  }
  await page.goto("/");
  if (new URL(page.url()).pathname.startsWith("/login")) {
    await login(page, username);
    await context.storageState({ path: state });
  }
  return page;
}

export async function done(page: Page) {
  await page.context().close().catch(() => undefined);
}

// ---------------------------------------------------------------- form helpers
/** Picks an option in the shared Combobox (hidden input `name`, visible "اكتب أو اختر" box). */
export async function combo(scope: Page | Locator, name: string, text: string) {
  const box = scope.locator(`div.relative:has(> input[type="hidden"][name="${name}"])`).first();
  const input = box.locator('input[role="combobox"]').first();
  await input.click();
  await input.fill(text);
  const option = box.locator("div.absolute button", { hasText: text }).first();
  if (await option.count()) await option.click();
  else await input.press("Enter");
  await expect(box.locator(`input[type="hidden"][name="${name}"]`)).not.toHaveValue("");
}

export async function openAllDetails(page: Page) {
  await page.evaluate(() => document.querySelectorAll("details").forEach((item) => { (item as HTMLDetailsElement).open = true; }));
}

/** Waits for a server action round-trip to settle after a submit. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
}

export function patientIdFromUrl(page: Page): string {
  const match = new URL(page.url()).pathname.match(/\/patients\/([^/?#]+)/);
  if (!match || match[1] === "new") throw new Error(`لم يُفتح ملف المراجع: ${page.url()}`);
  return match[1];
}

// ---------------------------------------------------------------- journeys
const PATIENTS = path.join(RESULTS, "patients.json");
export function rememberPatient(name: string, data: Record<string, unknown>) {
  const all = fs.existsSync(PATIENTS) ? JSON.parse(fs.readFileSync(PATIENTS, "utf8")) : {};
  all[name] = { ...(all[name] || {}), ...data };
  fs.writeFileSync(PATIENTS, JSON.stringify(all, null, 2));
}
export function knownPatient(name: string): Record<string, any> | undefined {
  return fs.existsSync(PATIENTS) ? JSON.parse(fs.readFileSync(PATIENTS, "utf8"))[name] : undefined;
}

export class JourneyStop extends Error {}

/**
 * Runs one step of a patient's journey. A failure is recorded with a screenshot and stops only this
 * patient's journey (JourneyStop), so the rest of the check keeps going.
 */
export async function act(page: Page, area: string, label: string, work: () => Promise<unknown>, severity: Severity = "عالي") {
  try {
    await work();
    step(area, label, true);
  } catch (error) {
    if (error instanceof JourneyStop) throw error;
    const message = (error instanceof Error ? error.message.split("\n")[0] : String(error)).replace(/\u001b\[[0-9;]*m/g, "");
    const pendingRequests = openRequests(page);
    if (process.env.DEMO_DEBUG && pendingRequests) await dumpOpen(page, "/var/tmp/stuck.json");
    finding({ area, url: page.url(), severity, message: `${label}: ${message.slice(0, 400)}${pendingRequests ? ` — طلبات معلقة: ${pendingRequests}` : ""}`, screenshot: await shot(page, `${area}-${label}`) });
    step(area, label, false);
    throw new JourneyStop(label);
  }
}

/** Runs a whole journey; returns false (after recording) when a step stopped it. */
export async function journey(work: () => Promise<void>) {
  try { await work(); return true; } catch (error) { if (error instanceof JourneyStop) return false; throw error; }
}

/**
 * After a save, waits for the screen to show the result. If it does not update by itself, that is
 * recorded (the screen should refresh on its own) and the page is reloaded to check the save itself.
 */
export async function afterSave(page: Page, area: string, label: string, ready: (timeout: number) => Promise<unknown>) {
  try {
    await ready(8_000);
  } catch {
    fs.appendFileSync(path.join(RESULTS, "stale-refresh.jsonl"), `${JSON.stringify({ area, label, url: page.url(), at: new Date().toISOString() })}\n`);
    await page.reload();
    await settle(page);
    await ready(15_000);
  }
}
