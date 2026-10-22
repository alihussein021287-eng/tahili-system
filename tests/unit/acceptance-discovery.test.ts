import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = "tests/e2e/acceptance";
const configs = ["playwright.config.ts", "playwright.critical.config.ts"];
// Intentionally nonexistent synthetic target: --list must not execute setup, fixtures or tests.
const id = "123456abcdef";
const password = "a".repeat(48);
const inherited = Object.fromEntries(
  ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE"]
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
);
const safe = {
  ...inherited,
  TAHILI_ENVIRONMENT: "acceptance", TAHILI_DISPOSABLE_TEST_DB: "1", ACCEPTANCE_RUN_ID: id,
  COMPOSE_PROJECT_NAME: `tahili-acceptance-${id}`, ACCEPTANCE_APP_PORT: "48999",
  ACCEPTANCE_DB_PASSWORD: password,
  E2E_BASE_URL: "http://127.0.0.1:48999", NEXTAUTH_URL: "http://127.0.0.1:48999",
  NEXTAUTH_URL_INTERNAL: "http://127.0.0.1:48999",
  DATABASE_URL: `postgresql://acceptance:${password}@127.0.0.1:55432/acceptance_${id}`,
};
function list(config: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "-c", `${directory}/${config}`, "--list", "--reporter=list"], {
    env, encoding: "utf8", timeout: 30_000,
  });
}

describe("acceptance discovery boundaries", () => {
  it("discovers every legacy spec through its original configuration", () => {
    // These suites declare role-specific tests at import time. Supply invented rows only;
    // --list does not authenticate them or create users/database records.
    const temporary = mkdtempSync(join(tmpdir(), "tahili-discovery-"));
    const credentials = join(temporary, "synthetic.tsv");
    const roles = ["ADMIN", "MANAGER", "DATA_ENTRY", "DOCTOR", "DRESSING", "HEAD_THERAPIST", "LAB", "PHARMACIST", "PROSTHETICS", "RADIOLOGY", "RECEPTION", "RESIDENT", "THERAPIST", "VIEWER", "ACCOUNTANT"];
    writeFileSync(credentials, roles.map((role) => `${role}\tdiscovery-${role}\tsynthetic-only\tDiscovery ${role}`).join("\n"), { mode: 0o600 });
    let result: ReturnType<typeof list>;
    try {
      result = list(configs[0], { ...safe, QA_CREDENTIALS_PATH: credentials });
    } finally {
      unlinkSync(credentials);
      rmdirSync(temporary);
    }
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const files = [...new Set([...result.stdout.matchAll(/\s(\S+\.spec\.ts):\d+:\d+ ›/g)].map((match) => match[1]))].sort();
    const expected = readdirSync(directory).filter((file) => /^(acceptance-.*|resilient-probes)\.spec\.ts$/.test(file)).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(files).toEqual(expected);
    expect(result.stdout).not.toContain("critical-registration.spec.ts");
    console.info(result.stdout.trim().split("\n").at(-1));
  }, 40_000);

  it("discovers exactly nine critical cases and keeps the worker explicitly scoped", () => {
    const result = list(configs[1], safe);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Total: 9 tests in 1 file");
    expect((result.stdout.match(/critical-registration\.spec\.ts:\d+:\d+ ›/g) || []).length).toBe(9);
    const worker = readFileSync("scripts/acceptance/inside.cjs", "utf8");
    expect(worker).toContain("'tests/e2e/acceptance/playwright.critical.config.ts', 'critical-registration.spec.ts'");
    expect(readFileSync("scripts/acceptance/run.cjs", "utf8")).toContain("'tests/e2e/acceptance/playwright.critical.config.ts'");
  }, 40_000);

  for (const config of configs) {
    for (const [name, env] of [
      ["missing identity", inherited],
      ["protected QA", { ...safe, E2E_BASE_URL: "http://localhost:3101" }],
      ["production", { ...safe, TAHILI_ENVIRONMENT: "production" }],
    ] as const) {
      it(`${config} rejects ${name} before discovery/setup`, () => {
        const result = list(config, env);
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain("refusing all writes");
      }, 40_000);
    }
  }
});
