import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { incrementAuthVersionIf } from "@/lib/auth-version";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function exportedFunction(path: string, name: string) {
  const source = read(path);
  const start = source.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("authVersion security mutation coverage", () => {
  it.each([
    ["disabling a user", "src/app/(app)/users/actions.ts", "toggleUser", "incrementAuthVersionIf("],
    ["changing a role", "src/app/(app)/users/actions.ts", "updateUser", "incrementAuthVersionIf("],
    ["applying a role template that changes role", "src/app/(app)/users/actions.ts", "applyRoleTemplate", "incrementAuthVersionIf("],
    ["admin password reset", "src/app/(app)/users/actions.ts", "resetPassword", "incrementAuthVersion("],
    ["self password change", "src/app/(app)/account/actions.ts", "changeOwnPassword", "incrementAuthVersion("],
    ["first password activation", "src/app/login/actions.ts", "activateAccount", "incrementAuthVersion("],
    ["initial setup update", "src/app/setup/actions.ts", "completeSetup", "incrementAuthVersion("],
  ])("uses an atomic authVersion increment for %s", (_label, path, name, marker) => {
    expect(exportedFunction(path, name)).toContain(marker);
  });

  it("does not increment authVersion for ordinary login metadata updates", () => {
    const source = read("src/lib/auth.ts");
    expect(source).not.toContain("incrementAuthVersion(");
  });

  it("does not increment for a name-only edit", () => {
    expect(incrementAuthVersionIf(false)).toEqual({});
    expect(incrementAuthVersionIf(true)).toEqual({ authVersion: { increment: 1 } });
  });

  it("has no direct getServerSession call outside the central access helper", () => {
    const directCallFiles = sourceFiles("src").filter((path) => /getServerSession\s*\(/.test(read(path)));
    expect(directCallFiles).toEqual(["src/lib/access.ts"]);
  });
});
