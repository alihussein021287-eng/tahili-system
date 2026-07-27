import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(app)/settings/page.tsx", "utf8");

describe("settings tab accessibility contract", () => {
  it("keeps the eight tab hrefs and exposes only the active desktop tab", () => {
    const keys = ["identity", "operations", "therapy", "security", "notifications", "files", "backup", "lookups"];
    expect((source.match(/key: "/g) ?? []).length).toBeGreaterThanOrEqual(8);
    for (const key of keys) expect(source).toContain(`key: "${key}"`);
    expect(source).toContain('href={tab.href}');
    expect(source).toContain('aria-current={activeTab === tab.key ? "page" : undefined}');
  });
});
