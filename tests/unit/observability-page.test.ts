import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(app)/observability/page.tsx", "utf8");
const client = readFileSync("src/components/ObservabilityRefresh.tsx", "utf8");

describe("observability page boundary", () => {
  it("keeps an explicit server-side ADMIN guard and a read-only refresh action", () => {
    expect(source).toContain('user.role !== "ADMIN"');
    expect(source).toContain("prisma.user.findUnique");
    expect(source).toContain('redirect("/")');
    expect(source).not.toMatch(/<iframe|restart|delete|acknowledge|cleanup/i);
    expect(client).toContain("router.refresh()");
  });

  it("does not pass monitoring endpoints, identifiers, or raw telemetry to a client component", () => {
    expect(source).not.toMatch(/http:\/\/|https:\/\/|requestId|traceId|raw log|raw span/i);
    expect(client).not.toMatch(/http:\/\/|https:\/\/|trace|request/i);
  });
});
