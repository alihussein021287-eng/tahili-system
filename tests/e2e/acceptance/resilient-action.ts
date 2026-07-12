import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { ROOT } from "./helpers";

export type ActionResult = {
  name: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  role: string;
  startedAt: string;
  finishedAt: string;
  usedDbRecovery: boolean;
  recoveryUrl: string;
  detail?: string;
};

type Input = {
  name: string;
  role: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  submit: Locator;
  dbExpectation: () => Promise<boolean>;
  confirmation: (page: Page) => Promise<boolean>;
  recoveryUrl: string;
  roleState: string;
};

const resultsFile = path.join(ROOT, "resilient-results.json");

function persist(result: ActionResult) {
  const rows: ActionResult[] = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : [];
  rows.push(result);
  fs.writeFileSync(resultsFile, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
}

async function poll(check: () => Promise<boolean>, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export async function submitServerAction(input: Input) {
  const startedAt = new Date().toISOString();
  let quickConfirmed = false;
  let submitError: unknown;
  try {
    await input.submit.click({ noWaitAfter: true, timeout: 3_000 });
  } catch (error) {
    submitError = error;
    try {
      await input.submit.evaluate((button: HTMLElement) => {
        const form = button.closest("form") as HTMLFormElement | null;
        if (!form) throw new Error("submit control has no form");
        form.requestSubmit(button as HTMLButtonElement);
      });
    } catch (fallbackError) {
      submitError = fallbackError;
    }
  }

  try {
    quickConfirmed = await Promise.race([
      input.confirmation(input.page),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
  } catch { /* DB recovery below */ }

  const dbConfirmed = await poll(input.dbExpectation);
  await input.context.close().catch(() => undefined);
  if (!dbConfirmed) {
    const result: ActionResult = { name: input.name, role: input.role, status: "FAIL", startedAt, finishedAt: new Date().toISOString(), usedDbRecovery: !quickConfirmed, recoveryUrl: input.recoveryUrl, detail: submitError instanceof Error ? submitError.message : "DB expectation not reached" };
    persist(result);
    return result;
  }

  const recoveryContext = await input.browser.newContext({ storageState: input.roleState, baseURL: "http://localhost:3000" });
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.goto(input.recoveryUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
  const uiConfirmed = await poll(() => input.confirmation(recoveryPage).catch(() => false), 5_000);
  await recoveryContext.close();
  const result: ActionResult = { name: input.name, role: input.role, status: uiConfirmed ? "PASS" : "BLOCKED", startedAt, finishedAt: new Date().toISOString(), usedDbRecovery: !quickConfirmed, recoveryUrl: input.recoveryUrl, detail: uiConfirmed ? undefined : "DB persisted but fresh UI confirmation was not visible" };
  persist(result);
  expect(result.status, result.detail).toBe("PASS");
  return result;
}
