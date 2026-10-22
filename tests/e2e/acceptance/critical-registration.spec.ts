import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/db";
import { credentials, BASE_URL, pickCombobox, statePath } from "./helpers";

// Real login + Server Action + PostgreSQL. Form tampering deliberately tests the server boundary.
for (const scenario of ["own-default", "cross-branch", "unassigned", "admin-missing", "admin-explicit", "inactive-branch"] as const) {
  test(`m097 registration: ${scenario}`, async ({ browser }) => {
    const username = scenario.startsWith("admin") ? "acc-admin" : scenario === "unassigned" ? "acc-unassigned" : "acc-entry";
    const user = credentials().find(row => row.username === username)!;
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: statePath(user) });
    const page = await context.newPage();
    try {
      await page.goto("/patients/new");
      // React streaming may temporarily retain a hidden copy of the form.
      await expect(page.locator('input[name="fullName"]')).toHaveCount(1);
      const name = `Synthetic acceptance ${scenario}`;
      await page.locator('input[name="fullName"]').fill(name);
      await page.locator('input[name="phone"]').fill("07700000001");
      await page.locator('input[name="birthDate"]').fill("1990-01-01");
      await pickCombobox(page, "gender", "ذكر");
      await pickCombobox(page, "caseType", "مريض");
      await pickCombobox(page, "governorateId", "Acceptance governorate");
      await pickCombobox(page, "injuryTypeId", "Acceptance injury");
      const a = await prisma.branch.findFirstOrThrow({ where: { name: "Acceptance registration A" } });
      const b = await prisma.branch.findFirstOrThrow({ where: { name: "Acceptance registration B" } });
      let requested = scenario === "cross-branch" || scenario === "admin-explicit" ? String(b.id) : "";
      if (scenario === "inactive-branch") {
        const dead = await prisma.branch.create({ data: { name: "Acceptance inactive", isActive: false } });
        requested = String(dead.id);
      }
      await page.locator('input[name="branchId"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, requested);
      await page.getByRole("button", { name: "حفظ", exact: true }).click();
      if (scenario === "own-default" || scenario === "admin-explicit") {
        await expect(page).toHaveURL(/\/patients\/[^/?]+\?/);
        const patient = await prisma.patient.findFirstOrThrow({ where: { fullName: name } });
        expect(patient.branchId).toBe(scenario === "own-default" ? a.id : b.id);
        expect(patient.createdById).toBe((await prisma.user.findUniqueOrThrow({ where: { username } })).id);
      } else {
        await expect(page.getByRole("alert")).toBeVisible();
        expect(await prisma.patient.count({ where: { fullName: name } })).toBe(0);
      }
    } finally { await context.close(); }
  });
}

for (const username of ["acc-admin-branch", "acc-admin", "acc-admin-inactive"]) {
  test(`m097 legacy CSV import: ${username}`, async ({ browser }) => {
    const user = credentials().find(row => row.username === username)!;
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: statePath(user) });
    const page = await context.newPage();
    try {
      await page.goto("/patients/import");
      await expect(page).toHaveURL(/\/patients\/import$/);
      const name = `Synthetic CSV ${username}`;
      await page.locator("textarea").fill(`fullName,phone,motherName,birthYear,housing,notes\n${name},07700000002,Synthetic mother,1990,Synthetic home,acceptance only`);
      const other = await prisma.branch.findFirstOrThrow({ where: { name: "Acceptance registration B" } });
      // A forged branch field must never move a legacy CSV import to another branch.
      await page.locator('form:has(input[name="data"])').evaluate((form, branchId) => {
        const input = document.createElement("input"); input.type = "hidden"; input.name = "branchId"; input.value = String(branchId); form.appendChild(input);
      }, other.id);
      await page.locator('form:has(input[name="data"]) button[type="submit"]').click();
      await expect(page).toHaveURL(username === "acc-admin-branch" ? /\/patients\/import\?result=/ : /\/patients\/import\?err=/);
      if (username === "acc-admin-branch") {
        const own = await prisma.user.findUniqueOrThrow({ where: { username } });
        const patient = await prisma.patient.findFirstOrThrow({ where: { fullName: name } });
        expect(patient.branchId).toBe(own.branchId);
        expect(patient.branchId).not.toBe(other.id);
        expect(patient.createdById).toBe(own.id);
      } else expect(await prisma.patient.count({ where: { fullName: name } })).toBe(0);
    } finally { await context.close(); }
  });
}

test.afterAll(async () => prisma.$disconnect());
