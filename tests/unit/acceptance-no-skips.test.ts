import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("acceptance suite completeness guard", () => {
  it("contains no skip, fixme, or blocked-only declarations", () => {
    const root = "tests/e2e/acceptance";
    const offenders = readdirSync(root)
      .filter((name) => name.endsWith(".ts"))
      .flatMap((name) => {
        const source = readFileSync(join(root, name), "utf8");
        return [
          ...source.matchAll(/\b(?:test|describe)\.(?:skip|fixme)\b/g),
          ...source.matchAll(/\b(?:test|describe)\s*\.\s*(?:skip|fixme)\s*\(/g),
        ].map((match) => `${name}:${source.slice(0, match.index).split("\n").length}`);
      });
    expect(offenders).toEqual([]);
  });

  it("keeps the harness development-only and excludes credentials and artifacts", () => {
    const helpers = readFileSync("tests/e2e/acceptance/helpers.ts", "utf8");
    const gitignore = readFileSync(".gitignore", "utf8");
    const dockerignore = readFileSync(".dockerignore", "utf8");

    // Rehearsal-only: a single allowed origin, an isolated database guard, no default credential file, output outside test-results.
    expect(helpers).toContain('REHEARSAL_ORIGIN = "http://localhost:3101"');
    expect(helpers).toContain("url.origin !== REHEARSAL_ORIGIN");
    expect(helpers).toContain("@127.0.0.1:55432/");
    expect(helpers).toContain('QA_CREDENTIALS_PATH || ""');
    expect(helpers).toContain("(metadata.mode & 0o077) !== 0");
    expect(helpers).not.toContain("192.168.17.20");
    expect(helpers).not.toContain("/tahili-system/");
    expect(dockerignore).toContain("release-evidence/acceptance-run");
    expect(gitignore).toContain("release-evidence/acceptance-run");
    expect(gitignore).toContain("test-results/");
    expect(gitignore).toContain("/tests/**/credentials.*");
    expect(dockerignore).toContain("test-results");
    expect(dockerignore).toContain("**/credentials.*");
  });
});
