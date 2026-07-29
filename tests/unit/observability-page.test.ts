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

  it("labels security isolation, waiting samples, zeros, and actual outages distinctly", () => {
    expect(source).toContain("غير مراقب أمنياً");
    expect(source).toContain("بانتظار بيانات كافية");
    expect(source).toContain("غير متاح فعلياً");
    expect(source).toContain("لا توجد إخفاقات");
    expect(source).toContain("لا توجد أخطاء");
    expect(source).toContain("Faro forwarding");
    expect(source).toContain("غير مفعلة حالياً — N/A مقصود");
    expect(source).toContain("زر التحديث لا يبدأ الفحص");
    expect(client).not.toMatch(/smoke|fetch\(|POST|server action/i);
  });
});
