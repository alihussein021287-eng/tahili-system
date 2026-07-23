import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

function findFiles(root: string, name: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return findFiles(path, name);
    return entry.name === name ? [path] : [];
  });
}

function pageRoute(file: string) {
  const route = relative("src/app", file)
    .split(sep)
    .slice(0, -1)
    .filter((part) => part !== "(app)")
    .join("/");
  return `/${route}`.replace(/\/$/, "") || "/";
}

function apiRoute(file: string) {
  const route = relative("src/app", file).split(sep).slice(0, -1).join("/");
  return `/${route}`;
}

function documentedRoutes(section: string) {
  return [...section.matchAll(/^\| `([^`]+)` \| `(?:VISUAL|UNCHANGED|PRINT|LEGACY|API)` \|/gm)]
    .map((match) => match[1])
    .sort();
}

describe("UX route inventory", () => {
  const doc = readFileSync("docs/UX_ROUTE_INVENTORY.md", "utf8");
  const [pagesSection, apiSection = ""] = doc.split("## Route Handlers");

  it("lists every page.tsx exactly once", () => {
    const actual = findFiles("src/app", "page.tsx").map(pageRoute).sort();
    const documented = documentedRoutes(pagesSection);
    expect(actual).toHaveLength(93);
    expect(documented).toEqual(actual);
  });

  it("lists every route.ts exactly once", () => {
    const actual = findFiles("src/app", "route.ts").map(apiRoute).sort();
    const documented = documentedRoutes(apiSection);
    expect(actual).toHaveLength(18);
    expect(documented).toEqual(actual);
  });

  it("keeps the reviewed category totals explicit", () => {
    expect(doc).toContain("| `VISUAL` | 73 |");
    expect(doc).toContain("| `UNCHANGED` | 4 |");
    expect(doc).toContain("| `PRINT` | 13 |");
    expect(doc).toContain("| `LEGACY` | 3 |");
    expect(doc).toContain("| `API` | 18 |");
    expect(doc).toContain("| غير مفحوص | 0 |");
  });
});
