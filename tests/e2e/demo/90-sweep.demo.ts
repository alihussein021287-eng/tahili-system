// Every staff account opens every page its menu shows (and each hub tab), on desktop and on a phone.
// Records: server errors, error screens, browser errors, pages that scroll sideways on a phone,
// and pages outside the role that open instead of sending the user home.
import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { RESULTS, as, credentials, done, errorScreen, finding, settle, shot, step } from "./helpers";

const AREA = "فحص الصفحات";
const ADMIN_ONLY = ["/users", "/permissions", "/settings", "/backup", "/audit", "/login-log", "/observability", "/readiness", "/maintenance"];
const coverage: Record<string, { pages: number; problems: number }> = {};

test.describe.configure({ mode: "serial" });

const people = process.env.DEMO_QUICK ? credentials().filter((user) => user.username.endsWith("1")) : credentials();
for (const user of people) {
  test(`${AREA}: ${user.role} ${user.username}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const page = await as(browser, user.username, AREA);
    const problemsBefore = fs.existsSync(path.join(RESULTS, "findings.jsonl")) ? fs.readFileSync(path.join(RESULTS, "findings.jsonl"), "utf8").split("\n").length : 0;

    // Menu links (sidebar groups are expanded so every entry is collected).
    await page.goto("/");
    await settle(page);
    const hrefs = new Set<string>();
    const collect = async () => {
      for (const href of await page.locator("aside a[href^='/'], nav a[href^='/']").evaluateAll((links) => links.map((link) => link.getAttribute("href") || ""))) {
        if (href && !href.startsWith("/api") && !href.includes("logout")) hrefs.add(href.split("#")[0]);
      }
    };
    await collect();
    for (const toggle of await page.locator("aside button[aria-expanded='false']").all()) await toggle.click().catch(() => undefined);
    await collect();

    const visited = new Set<string>();
    const queue = [...hrefs];
    while (queue.length && visited.size < 45) {
      const href = queue.shift()!;
      if (visited.has(href)) continue;
      visited.add(href);
      const response = await page.goto(href).catch(() => null);
      await settle(page);
      const status = response?.status() ?? 0;
      if (status >= 500) finding({ area: AREA, user: user.username, url: href, severity: "حرج", message: `الصفحة رجعت خطأ خادم ${status}`, screenshot: await shot(page, `${user.username}-${href}`) });
      const broken = await errorScreen(page);
      if (broken) finding({ area: AREA, user: user.username, url: href, severity: "حرج", message: `شاشة خطأ: «${broken}»`, screenshot: await shot(page, `${user.username}-${href}`) });
      // Hub tabs on this page are pages too.
      for (const tab of await page.locator("main a[href*='?tab='], [role='tablist'] a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") || ""))) {
        if (tab.startsWith("/") && !visited.has(tab) && !queue.includes(tab)) queue.push(tab);
      }
    }
    step(AREA, `${user.username}: ${visited.size} صفحة`);

    // Phone width: the main pages must not scroll sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const href of user.username.endsWith("1") ? [...visited].slice(0, 8) : []) {
      await page.goto(href).catch(() => undefined);
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 8) finding({ area: "الموبايل", user: user.username, url: href, severity: "منخفض", message: `الصفحة تنسحب للجانب بالموبايل (${overflow}px)`, screenshot: await shot(page, `mobile-${user.username}-${href}`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Pages outside the role must not open.
    if (user.role !== "ADMIN") {
      for (const href of ADMIN_ONLY) {
        if (visited.has(href)) continue;
        const response = await page.goto(href).catch(() => null);
        await settle(page);
        const landed = new URL(page.url()).pathname;
        const notFound = response?.status() === 404 || /could not be found|404/.test(await page.locator("body").innerText().catch(() => ""));
        if (landed === href && !notFound) finding({ area: "الصلاحيات", user: user.username, url: href, severity: "متوسط", message: `دور ${user.role} يفتح صفحة إدارية (${href}) بالرابط المباشر وهي مو بقائمته`, screenshot: await shot(page, `perm-${user.username}-${href}`) });
      }
    }

    const problemsAfter = fs.existsSync(path.join(RESULTS, "findings.jsonl")) ? fs.readFileSync(path.join(RESULTS, "findings.jsonl"), "utf8").split("\n").length : 0;
    coverage[user.username] = { pages: visited.size, problems: problemsAfter - problemsBefore };
    fs.writeFileSync(path.join(RESULTS, "sweep-coverage.json"), JSON.stringify(coverage, null, 2));
    await done(page);
  });
}
