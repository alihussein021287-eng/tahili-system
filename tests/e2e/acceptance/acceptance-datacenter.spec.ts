import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";
import path from "node:path";
import { closeChecked, pageFor, screenshot } from "./helpers";

// Synthetic fictional rows only, built from the DOWNLOADED official template. APPLY must stay locked on the QA runtime.
const lib = createRequire(path.join(process.cwd(), "package.json"))("./scripts/import-preflight/lib.cjs");
const prisma = new PrismaClient();
test.afterAll(async () => { await prisma.$disconnect(); });

async function syntheticFromTemplate(page: Page) {
  const gov = (await prisma.governorate.findFirstOrThrow({ orderBy: { id: "asc" } })).name;
  const inj = (await prisma.injuryType.findFirstOrThrow({ orderBy: { id: "asc" } })).name;
  const text = (await (await page.request.get("/api/data-center/templates/patients?format=csv")).text()).replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",");
  const row = (v: Record<string, string>) => header.map((h) => v[h] ?? "").join(",");
  const base = { gender: "ذكر", birthYear: "1980", governorate: gov, injuryType: inj, caseType: "جريح" };
  const rows = [
    row({ ...base, fullName: "مراجع اختباري أول ثاني ثالث", phone: "07700000011" }),
    row({ ...base, fullName: "مراجع اختباري رابع خامس سادس", phone: "07700000012", gender: "أنثى", caseType: "مريض" }),
    row({ ...base, fullName: "مراجع بلا سنة", phone: "07700000013", birthYear: "" }),
    row({ ...base, fullName: "مراجع هاتف خاطئ", phone: "123" }),
    row({ ...base, fullName: "مراجع محافظة خاطئة", phone: "07700000014", governorate: "محافظة غير موجودة" }),
  ];
  return "﻿" + [lines[0], ...rows].join("\n");
}

test("Data Center: official template round trip, preview, APPLY locked, scoped export, mobile RTL", async ({ browser }) => {
  const { context, page, errors } = await pageFor(browser, "ADMIN");
  await page.goto("/data-center");
  await expect(page.getByRole("heading", { name: "استيراد وتصدير البيانات" })).toBeVisible();
  await expect(page.getByTestId("apply-lock-banner").first()).toBeVisible();
  // approved tab order
  const tabLabels = await page.locator("main").getByRole("link", { name: /^(الاستيراد|التصدير|القوالب الرسمية|السجل والإيصالات|القواعد والمساعدة)$/ }).allInnerTexts();
  expect(tabLabels.slice(0, 5)).toEqual(["الاستيراد", "التصدير", "القوالب الرسمية", "السجل والإيصالات", "القواعد والمساعدة"]);

  const tpl = await page.request.get("/api/data-center/templates/patients?format=csv");
  expect(tpl.status()).toBe(200);
  expect(tpl.headers()["cache-control"]).toContain("no-store");
  expect(await tpl.text()).toContain("fullName");
  const xl = await page.request.get("/api/data-center/templates/patients?format=xlsx");
  expect(xl.status()).toBe(200);
  expect((await xl.body()).toString("latin1")).toContain("dataValidation"); // controlled Excel choices
  expect((await page.request.get("/api/data-center/templates/unknown")).status()).toBe(403);

  // import tab: two primary categories, only the selected type's requirements, advanced importers tucked away
  await expect(page.getByTestId("type-patients")).toBeVisible();
  await expect(page.getByTestId("type-staff")).toBeVisible();
  await expect(page.getByTestId("selected-requirements").first()).toContainText("نوع الحالة");
  await expect(page.getByTestId("contract-patients")).toHaveCount(0); // detailed rules are not duplicated on the import form
  await expect(page.getByTestId("advanced-import")).toBeVisible();
  await expect(page.getByTestId("template-xlsx")).toBeVisible();
  // the full contract (mandatory vs optional, allowed values) is in the Templates section
  await page.goto("/data-center?tab=templates");
  const card = page.getByTestId("contract-patients");
  await card.locator("summary").click();
  await expect(card.getByText("مطلوب").first()).toBeVisible();
  await expect(card).toContainText("نوع الحالة");
  await expect(card).toContainText("اختياري");
  await page.goto("/data-center?tab=import");

  const branch = page.locator("#dc-branch");
  if (await branch.count()) await branch.selectOption({ index: 0 });
  await page.locator("#dc-file").setInputFiles({ name: "synthetic-patients.csv", mimeType: "text/csv", buffer: Buffer.from(await syntheticFromTemplate(page), "utf8") });
  await page.getByRole("button", { name: "معاينة وتحقق" }).click();
  await expect(page).toHaveURL(/\/data-center\/import\/[^/?]+$/);
  await expect(page.getByTestId("op-status").first()).toContainText("معاينة");
  await expect(page.getByTestId("apply-lock-banner").first()).toBeVisible();
  await expect(page.getByTestId("destination").first()).toContainText("الوجهة");
  await expect(page.getByText("غير صالح").first()).toBeVisible();
  const confirm = page.getByRole("button", { name: /تأكيد التنفيذ/ });
  await expect(confirm).toBeDisabled();
  const errReport = await page.request.get(page.url().replace("/data-center/import/", "/api/data-center/operations/") + "/errors?format=csv");
  expect(errReport.status()).toBe(200);
  expect(await errReport.text()).toContain("REQUIRED");
  // Forced submission is refused server-side (button disabled only in the UI).
  await confirm.evaluate((el) => (el as HTMLButtonElement).form!.requestSubmit());
  await expect(page.locator("div.card-danger[role=alert]")).toContainText("مقفل");
  await expect(page.getByTestId("op-status").first()).toContainText("معاينة");
  await screenshot(page, "datacenter-preview-locked");

  // Cancel the pending preview (clears private bytes).
  await page.getByRole("button", { name: "إلغاء المعاينة" }).click();
  await expect(page).toHaveURL(/tab=history/);

  // An old-style file missing required columns is refused with an actionable message, not silently imported.
  await page.goto("/data-center?tab=import");
  if (await branch.count()) await branch.selectOption({ index: 0 });
  await page.locator("#dc-file").setInputFiles({ name: "old.csv", mimeType: "text/csv", buffer: Buffer.from("fullName,phone\nمراجع ناقص,07700000099\n", "utf8") });
  await page.getByRole("button", { name: "معاينة وتحقق" }).click();
  await expect(page.locator("div.card-danger[role=alert]")).toContainText("أعمدة مطلوبة");

  // Unified staff file: official XLSX template -> filled with synthetic people -> ONE coordinated preview, apply locked
  await page.goto("/data-center?tab=import&type=staff");
  await expect(page.getByTestId("selected-requirements").first()).toContainText("الأشخاص");
  const staffTpl = await page.request.get("/api/data-center/templates/staff?format=xlsx");
  expect(staffTpl.status()).toBe(200);
  expect((await page.request.get("/api/data-center/templates/staff?format=csv")).status()).toBe(400);
  const tplWb = lib.readWorkbookBuffer(await staffTpl.body(), {});
  expect(tplWb.sheets.map((x: { name: string }) => x.name)).toEqual(["الأشخاص", "الحسابات", "العضويات", "تعليمات", "القوائم"]);
  const centerName = (await prisma.center.findFirstOrThrow({ where: { active: true }, orderBy: { id: "asc" } })).name;
  const fill = (name: string, rows: string[][]) => ({ name, rows: [...tplWb.sheets.find((x: { name: string }) => x.name === name).rows, ...rows] });
  const stamp = String(Date.now()).slice(-6);
  const staffBytes = lib.writeXlsx([
    fill("الأشخاص", [[`S${stamp}1`, "طبيب مقيم اختباري موحد", "طبيب مقيم (تدرج)", "طبيب تدرج", "", "", "", ""], [`S${stamp}2`, "طبيب اختصاص اختباري موحد", "طبيب اختصاص", "", "جراحة عظام", "", "", ""], [`S${stamp}3`, "موظف بلا دور موثق", "موظف", "إداري", "", "", "", ""]]),
    fill("الحسابات", [[`S${stamp}1`, `uni.res.${stamp}`, "", "", ""], [`S${stamp}3`, `uni.emp.${stamp}`, "", "", ""], ["NOPE", "uni.ghost", "", "", ""]]),
    fill("العضويات", [[`S${stamp}1`, centerName, "", ""]]),
    { name: "تعليمات", rows: tplWb.sheets.find((x: { name: string }) => x.name === "تعليمات").rows },
  ]) as Buffer;
  expect(JSON.stringify(tplWb.sheets.find((x: { name: string }) => x.name === "تعليمات").rows)).toContain("بصمة البيئة");
  const catList = tplWb.sheets.find((x: { name: string }) => x.name === "القوائم").rows;
  const catCol = catList[0].indexOf("الأشخاص — الفئة");
  expect(catList.slice(1).map((r: string[]) => r[catCol]).filter(Boolean)).toEqual(["طبيب مقيم (تدرج)", "طبيب اختصاص", "موظف"]);
  const activeCenters = await prisma.center.count({ where: { active: true } });
  const centerCol = catList[0].indexOf("العضويات — اسم المركز");
  expect(catList.slice(1).map((r: string[]) => r[centerCol]).filter(Boolean)).toHaveLength(activeCenters); // only this environment's active centers
  if (await branch.count()) await branch.selectOption({ index: 0 });
  await page.locator("#dc-file").setInputFiles({ name: "unified-staff.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: staffBytes });
  await page.getByRole("button", { name: "معاينة وتحقق" }).click();
  await expect(page).toHaveURL(/\/data-center\/import\/[^/?]+$/);
  await expect(page.getByTestId("staff-ready-breakdown").first()).toContainText("حساب غير مفعّل");
  await expect(page.getByTestId("destination").first()).toContainText("الوجهة");
  await expect(page.getByText("الأشخاص").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /تأكيد التنفيذ/ })).toBeDisabled();
  const staffErr = await page.request.get(page.url().replace("/data-center/import/", "/api/data-center/operations/") + "/errors?format=csv");
  expect(staffErr.status()).toBe(200);
  const errText = await staffErr.text();
  expect(errText).toContain("الحسابات"); expect(errText).toContain("PERSON_KEY_NOT_FOUND"); expect(errText).not.toContain("uni.ghost");
  await screenshot(page, "datacenter-staff-preview");
  await page.getByRole("button", { name: "إلغاء المعاينة" }).click();
  await expect(page).toHaveURL(/tab=history/);

  // Export: scoped, no-store, CSV with formula-safe cells.
  const exp = await page.request.get("/api/data-center/export?domain=patients&format=csv");
  expect(exp.status()).toBe(200);
  expect(exp.headers()["cache-control"]).toContain("no-store");
  expect((await page.request.get("/api/data-center/export?domain=appointments&format=csv")).status()).toBe(403); // range required
  expect((await page.request.get("/api/data-center/export?domain=audit&format=csv")).status()).toBe(403);

  // Mobile RTL: no horizontal overflow.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const tab of ["import", "import&type=staff", "export", "templates", "history", "rules"]) {
    await page.goto(`/data-center?tab=${tab}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, tab).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe("rtl");
  }
  await screenshot(page, "datacenter-mobile");
  await closeChecked(context, errors);
});

test("Data Center: non-delegated roles are denied pages and APIs", async ({ browser }) => {
  for (const role of ["RECEPTION", "ACCOUNTANT", "PHARMACIST"]) {
    const { context, page, errors } = await pageFor(browser, role);
    await page.goto("/data-center");
    await expect(page).not.toHaveURL(/\/data-center/);
    for (const url of ["/api/data-center/export?domain=patients&format=csv", "/api/data-center/export?domain=finance_invoices&format=csv&from=2026-01-01&to=2026-02-01", "/api/data-center/templates/patients"]) {
      expect((await page.request.get(url)).status(), `${role} ${url}`).toBe(403);
    }
    await closeChecked(context, errors);
  }
});
