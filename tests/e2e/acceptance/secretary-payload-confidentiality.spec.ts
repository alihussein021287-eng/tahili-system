import { createRequire } from "node:module";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient, type UserRole } from "@prisma/client";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { expectPatientPageDenialStatus, verifyPatientDenial } from "./patient-denial-evidence";

// These fixtures and accounts exist only in an identified, fresh disposable PostgreSQL.
createRequire(join(process.cwd(), "package.json"))("./scripts/acceptance/guard.cjs").assertIsolatedTarget();
const fixture = JSON.parse(readFileSync(process.env.PAYLOAD_FIXTURE_FILE!, "utf8")) as {
  patientId: string; foreignPatientId: string; referralId: string;
  restrictedPlanIds?: string[];
  patientName: string; sentinel: string;
  accounts: Record<string, { username: string; id: string; role: UserRole }>;
  runtimeImage?: string; runtimeDbId?: string; runtimeDbName?: string;
};

async function authenticated(browser: Browser, key: string) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== process.env.E2E_BASE_URL) return route.abort();
    if (process.env.PAYLOAD_DENIAL_ONLY === "1" && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      const manifest = JSON.parse(readFileSync(join(process.cwd(), ".next/server/server-reference-manifest.json"), "utf8"));
      const usernameAction = Object.entries(manifest.node as Record<string, { exportedName?: string }>)
        .some(([id, action]) => action.exportedName === "checkUsername" && request.headers()["next-action"] === id);
      const allowed = request.method() === "POST" && ((url.pathname === "/login" && usernameAction) || url.pathname === "/api/auth/callback/credentials");
      if (!allowed) return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  try {
    await page.goto(`${process.env.E2E_BASE_URL}/login`);
    await page.locator("#u").fill(fixture.accounts[key].username);
    await page.getByRole("button", { name: "متابعة", exact: true }).click();
    await page.locator("#p").waitFor({ state: "visible" });
    await page.locator("#p").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
    const who = await page.evaluate(async () => {
      const session = await (await fetch("/api/auth/session")).json();
      return { id: session?.user?.id, role: session?.user?.role };
    });
    expect(who).toEqual({ id: fixture.accounts[key].id, role: fixture.accounts[key].role });
    return { context, page };
  } catch {
    await context.close();
    throw new Error("Synthetic normal login/identity validation failed; credential details suppressed");
  }
}

async function responseBody(page: Page, route: string, rsc = false) {
  const result = await page.evaluate(async ({ route, rsc }) => {
    // Next validates the RSC cache-busting signature and redirects to its canonical
    // query. Follow that normal protocol, but never accept a different route.
    const response = await fetch(route, { headers: rsc ? { RSC: "1" } : {}, redirect: rsc ? "follow" : "manual" });
    return { status: response.status, body: await response.text(), pathname: new URL(response.url).pathname,
      contentType: response.headers.get("content-type") };
  }, { route, rsc });
  if (rsc) {
    expect(result.pathname).toBe(new URL(route, process.env.E2E_BASE_URL).pathname);
    expect(result.contentType).toContain("text/x-component");
  }
  return result;
}

async function tabAction(page: Page, patientId: string, tab: string) {
  const files = process.env.NODE_ENV === "production"
    ? [".next/server/server-reference-manifest.json"]
    : [".next/dev/server/server-reference-manifest.json", ".next/server/server-reference-manifest.json"];
  const file = files.map((name) => join(process.cwd(), name)).find(existsSync);
  if (!file) throw new Error("Local compiled action manifest unavailable");
  const entries = Object.entries(JSON.parse(readFileSync(file, "utf8")).node) as Array<[string, { exportedName?: string }]>;
  const id = entries.find(([, value]) => value.exportedName === "getPatientTabData")?.[0];
  if (!id) throw new Error("Known read-only action unavailable");
  return page.evaluate(async ({ patientId, tab, id }) => {
    const response = await fetch(`/patients/${patientId}`, { method: "POST", redirect: "manual",
      headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify([patientId, tab]) });
    return { status: response.status, body: await response.text() };
  }, { patientId, tab, id });
}

function saveControlEvidence(controls: Record<string, unknown>) {
  const file = process.env.PAYLOAD_CONTROL_EVIDENCE_FILE || join(dirname(process.env.PAYLOAD_FIXTURE_FILE!), "AUTHENTICATED_CONTROLS.json");
  writeFileSync(file, JSON.stringify(controls, null, 2));
}

function expectNoRestrictedPlan(body: string) {
  expect(body.includes(fixture.sentinel)).toBe(false);
  for (const id of fixture.restrictedPlanIds || []) expect(body.includes(id)).toBe(false);
  for (const key of ["treatmentPlan", "goals", "beforeCondition", "afterCondition", "finalRecommendation"]) {
    expect(body.includes(`"${key}":`) || body.includes(`\\"${key}\\":`)).toBe(false);
  }
}

test.describe("isolated secretary clinical payload boundary", () => {
  test.setTimeout(120_000);
  let localApp: ChildProcess | undefined;
  let appContainer: string | undefined;
  let network: string | undefined;
  const docker = (args: string[], env = process.env) => execFileSync("docker", args, {
    encoding: "utf8", windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  test.beforeAll(async ({ browser }) => {
    const db = new PrismaClient();
    try {
      if (!(await db.orgSetting.findUnique({ where: { id: 1 } }))) {
        await db.orgSetting.create({ data: { id: 1, autoBackup: false } });
      }
      fixture.restrictedPlanIds = (await db.treatmentPlan.findMany({
        where: { patientId: { in: [fixture.patientId, fixture.foreignPatientId] } }, select: { id: true },
      })).map(plan => plan.id);
      expect(fixture.restrictedPlanIds.length).toBe(2);
    } finally { await db.$disconnect(); }
    if (process.env.PAYLOAD_EXTERNAL_RUNTIME === "1") {
      // The isolated runner owns the process and records its logs. Keep one exact
      // origin throughout login, CSRF, callbacks and business requests.
      expect((await fetch(`${process.env.E2E_BASE_URL}/api/auth/providers`)).status).toBe(200);
      if (process.env.PAYLOAD_DENIAL_ONLY === "1") return;
      const controls: Record<string, unknown> = {};
      for (const key of ["doctor", "secretary"]) {
        const { context, page } = await authenticated(browser, key);
        try {
          const response = await responseBody(page, `/patients/${fixture.patientId}`, true);
          const clinicalPresent = response.body.includes(fixture.sentinel);
          controls[key] = { authenticatedIdentityVerified: true, role: fixture.accounts[key].role,
            realRsc: true, status: response.status, clinicalPresent,
            operationalPatientPresent: response.body.includes(fixture.patientName) };
          saveControlEvidence(controls);
          expect(response.status).toBe(200);
          expect(clinicalPresent).toBe(key === "doctor");
          expect(response.body.includes(fixture.patientName)).toBe(true);
        } finally { await context.close(); }
      }
      return;
    }
    // Own a fresh request-runtime process; do not share a developer's Next.js server.
    const port = Number(process.env.ACCEPTANCE_APP_PORT) + 1;
    const origin = `http://127.0.0.1:${port}`;
    Object.assign(process.env, { ACCEPTANCE_APP_PORT: String(port), E2E_BASE_URL: origin,
      NEXTAUTH_URL: origin, NEXTAUTH_URL_INTERNAL: origin, TAHILI_LOCAL_PORT: String(port) });
    createRequire(join(process.cwd(), "package.json"))("./scripts/acceptance/guard.cjs").assertIsolatedTarget();
    if (fixture.runtimeImage) {
      // Optional Linux dependency runtime; execute this worktree's readonly build, not the image's old application.
      expect(fixture.runtimeDbId).toMatch(/^[a-f0-9]{64}$/);
      const labels = JSON.parse(docker(["inspect", "--format", "{{json .Config.Labels}}", fixture.runtimeDbId!]));
      expect(labels["com.docker.compose.project"]).toBe(process.env.COMPOSE_PROJECT_NAME);
      expect(labels["tahili.mission"]).toBe("41-r1");
      network = `${process.env.COMPOSE_PROJECT_NAME}-payload-runtime`;
      docker(["network", "create", "--internal", "--label", `com.docker.compose.project=${process.env.COMPOSE_PROJECT_NAME}`, network]);
      docker(["network", "connect", "--alias", "payload-db", network, fixture.runtimeDbId!]);
      const url = new URL(process.env.DATABASE_URL!); url.hostname = "payload-db"; url.port = "5432";
      const runtimeEnv = { ...process.env, DATABASE_URL: url.toString(), PORT: "3000", HOSTNAME: "0.0.0.0" };
      appContainer = docker(["run", "-d", "--rm", "--pull=never", "--name", `${process.env.COMPOSE_PROJECT_NAME}-payload-app`,
        "--label", `com.docker.compose.project=${process.env.COMPOSE_PROJECT_NAME}`, "--label", "tahili.mission=41-r1-http",
        "--network", network, "-p", `127.0.0.1:${port}:3000`, "--mount", `type=bind,source=${join(process.cwd(), ".next")},target=/app/.next,readonly`,
        ...["DATABASE_URL", "NEXTAUTH_URL", "NEXTAUTH_URL_INTERNAL", "NEXTAUTH_SECRET", "TAHILI_LOCAL_ACCESS", "TAHILI_LOCAL_PORT", "NEXTAUTH_ALLOW_HTTP_LOGIN", "AUTH_TRUST_HOST", "PORT", "HOSTNAME"].flatMap((key) => ["-e", key]),
        fixture.runtimeImage], runtimeEnv);
    } else {
      localApp = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: process.cwd(), env: process.env, windowsHide: true, stdio: "ignore",
      });
    }
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try { if ((await fetch(`${origin}/api/auth/providers`)).status === 200) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(ready, "Owned isolated authentication runtime must be healthy").toBe(true);
  });
  test.afterAll(() => {
    localApp?.kill();
    if (appContainer) {
      const labels = JSON.parse(docker(["inspect", "--format", "{{json .Config.Labels}}", appContainer]));
      expect(labels["tahili.mission"]).toBe("41-r1-http");
      docker(["stop", appContainer]);
    }
    if (network) {
      docker(["network", "disconnect", network, fixture.runtimeDbId!]);
      docker(["network", "rm", network]);
    }
  });
  test("SECRETARY HTML excludes nested clinical sentinel and preserves operational handoff", async ({ browser }) => {
    const { context, page } = await authenticated(browser, "secretary");
    try {
      const response = await page.goto(`${process.env.E2E_BASE_URL}/patients/${fixture.patientId}`);
      expect(response?.status()).toBe(200);
      expectNoRestrictedPlan(await response!.text());
      await expect(page.getByText(fixture.patientName, { exact: false }).first()).toBeVisible();
      await page.goto(`${process.env.E2E_BASE_URL}/my-work`);
      expect((await page.locator("body").innerText()).includes(fixture.patientName)).toBe(true);
    } finally { await context.close(); }
  });

  test("SECRETARY direct RSC/tab variants never carry restricted nested data", async ({ browser }) => {
    const { context, page } = await authenticated(browser, "secretary");
    try {
      for (const tab of ["overview", "therapyProgram", "referrals"]) {
        const response = await responseBody(page, `/patients/${fixture.patientId}?tab=${tab}`, true);
        expect(response.status).toBe(200);
        expectNoRestrictedPlan(response.body);
      }
    } finally { await context.close(); }
  });

  test("unrelated SECRETARY cannot retrieve patient or clinical responses", async ({ browser }) => {
    const { context, page } = await authenticated(browser, "outsider");
    const db = new PrismaClient();
    try {
      const evidence = await verifyPatientDenial(page, db, { caseId: "03", actorId: fixture.accounts.outsider.id,
        role: fixture.accounts.outsider.role, patientId: fixture.patientId });
      expectPatientPageDenialStatus(evidence);
    } finally { await db.$disconnect(); await context.close(); }
  });

  test("RECEPTION limited visibility and My Work remain intact", async ({ browser }) => {
    const { context, page } = await authenticated(browser, "reception");
    try {
      const response = await page.goto(`${process.env.E2E_BASE_URL}/patients/${fixture.patientId}`);
      expect(response?.status()).toBe(200);
      expectNoRestrictedPlan(await response!.text());
      await expect(page.getByText("حالة التسليم غير معروضة هنا", { exact: false })).toBeVisible();
      await page.goto(`${process.env.E2E_BASE_URL}/my-work`);
      expect((await page.locator("body").innerText()).includes(fixture.patientName)).toBe(true);
    } finally { await context.close(); }
  });

  test("authorized DOCTOR retains clinical fields in HTML and direct action", async ({ browser }) => {
    const { context, page } = await authenticated(browser, "doctor");
    try {
      const response = await responseBody(page, `/patients/${fixture.patientId}`);
      expect(response.status).toBe(200);
      expect(response.body.includes(fixture.sentinel)).toBe(true);
      const action = await tabAction(page, fixture.patientId, "plan");
      expect(action.status).toBe(200);
      expect(action.body.includes(fixture.sentinel)).toBe(true);
    } finally { await context.close(); }
  });

  test("direct action cannot bypass therapy or patient-scope guards", async ({ browser }) => {
    const { context, page } = await authenticated(browser, "secretary");
    try {
      for (const [patientId, tab] of [[fixture.patientId, "plan"], [fixture.foreignPatientId, "referrals"]]) {
        const response = await tabAction(page, patientId, tab);
        expect(response.status).toBe(500);
        expectNoRestrictedPlan(response.body);
        expect(response.body).toMatch(/\d+:E\{/);
      }
    } finally { await context.close(); }
  });

  test("authorized referral alternate paths do not include treatment details", async ({ browser }) => {
    const { context, page } = await authenticated(browser, "secretary");
    try {
      for (const response of [await tabAction(page, fixture.patientId, "referrals"), await responseBody(page, `/referrals/${fixture.referralId}`)]) {
        expect(response.status).toBe(200);
        expectNoRestrictedPlan(response.body);
      }
    } finally { await context.close(); }
  });

  test("multiple organizational roles never replace actual effective patient scope", async ({ browser }) => {
    const { context, page } = await authenticated(browser, "combined");
    const db = new PrismaClient();
    try {
      if (process.env.PAYLOAD_DENIAL_ONLY !== "1") {
        const own = await responseBody(page, `/patients/${fixture.patientId}`);
        expect(own.status).toBe(200);
        expect(own.body.includes(fixture.sentinel)).toBe(true);
      }
      const evidence = await verifyPatientDenial(page, db, { caseId: "08", actorId: fixture.accounts.combined.id,
        role: fixture.accounts.combined.role, patientId: fixture.foreignPatientId });
      expectPatientPageDenialStatus(evidence);
    } finally { await db.$disconnect(); await context.close(); }
  });
});
