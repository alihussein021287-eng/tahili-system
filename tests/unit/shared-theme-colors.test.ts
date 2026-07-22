import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared theme surfaces", () => {
  it("keeps shared TSX components free of hardcoded hex colors", () => {
    for (const file of ["src/components/AppShell.tsx", "src/components/Ui.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});
