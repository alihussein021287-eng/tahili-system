import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient, type UserRole } from "@prisma/client";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

test.skip(!username || !password, "E2E_USERNAME and E2E_PASSWORD are required for the local handoff flow");

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.locator("#u").fill(user);
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("#p")).toBeVisible();
  await page.locator("#p").fill(password!);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL((url) => url.pathname !== "/login");
}

async function rolePage(browser: Browser, user: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, user);
  return { context, page };
}

function assertLocalFixtureDatabase(baseURL: string | undefined) {
  const appUrl = new URL(baseURL!);
  const databaseUrl = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
  expect(["localhost", "127.0.0.1"]).toContain(appUrl.hostname);
  expect(databaseUrl, "Set DATABASE_URL to the local test database for fixture creation").toBeTruthy();
  if (appUrl.port === "3101") {
    expect(databaseUrl!.hostname).toBe("127.0.0.1");
    expect(databaseUrl!.port).toBe("55432");
    const inspect = (name: string) => JSON.parse(execFileSync("docker", ["inspect", name], { encoding: "utf8" }))[0];
    const app = inspect("tahili-clean-rehearsal-app-1");
    const postgres = inspect("tahili-clean-rehearsal-postgres-1");
    expect(app.Config.Labels["com.docker.compose.project"]).toBe("tahili-clean-rehearsal");
    expect(postgres.Config.Labels["com.docker.compose.project"]).toBe("tahili-clean-rehearsal");
    expect(postgres.Mounts.some((mount: { Name: string }) => mount.Name === "tahili-clean-rehearsal_pgdata")).toBe(true);
    const dbName = postgres.Config.Env.find((entry: string) => entry.startsWith("POSTGRES_DB="))?.slice("POSTGRES_DB=".length);
    expect(databaseUrl!.pathname).toBe(`/${dbName}`);
    return;
  }
  expect(["db", "localhost", "127.0.0.1"]).toContain(databaseUrl!.hostname);
  expect(databaseUrl!.pathname, "The handoff fixture must use a test database").toMatch(/test/i);
}

test("secretary accepts and forwards a fake patient, therapist returns it, then finishes the next handoff", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  assertLocalFixtureDatabase(baseURL);

  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const patientName = `علي حسين اختبار ${suffix}`;
  const secretaryName = `زينب كاظم اختبار ${suffix}`;
  const therapistName = `مصطفى جاسم اختبار ${suffix}`;
  const returnReason = "إعادة للتنسيق مع السكرتارية";
  const users = {
    reception: `e2e-reception-${suffix}`,
    secretary: `e2e-secretary-${suffix}`,
    therapist: `e2e-therapist-${suffix}`,
  };
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];

  try {
    // The bootstrap login follows smoke.spec.ts and verifies the supplied local credentials.
    const bootstrap = await rolePage(browser, username!);
    contexts.push(bootstrap.context);

    const passwordHash = await bcrypt.hash(password!, 10);
    const branch = await prisma.branch.create({ data: { name: `فرع اختبار ${suffix}` } });
    const center = await prisma.center.create({ data: { name: `مركز اختبار ${suffix}`, active: true } });
    async function createUser(name: string, fullName: string, role: UserRole) {
      return prisma.user.create({ data: { username: name, fullName, role, branchId: branch.id, passwordHash } });
    }
    const reception = await createUser(users.reception, `نور الهدى عباس اختبار ${suffix}`, "RECEPTION");
    const secretary = await createUser(users.secretary, secretaryName, "SECRETARY");
    const therapist = await createUser(users.therapist, therapistName, "THERAPIST");
    await prisma.centerMembership.createMany({ data: [
      { centerId: center.id, userId: secretary.id, role: "SECRETARY", status: "ACTIVE" },
      { centerId: center.id, userId: therapist.id, role: "THERAPIST", status: "ACTIVE" },
    ] });
    const patient = await prisma.patient.create({ data: {
      fullName: patientName, branchId: branch.id, phone: "07701234567",
      caseType: "WOUNDED", inMobilization: true, createdById: reception.id,
      dataEntryBy: reception.fullName, notes: "بيانات اختبار التحويلة",
    } });

    const receptionSession = await rolePage(browser, users.reception);
    contexts.push(receptionSession.context);
    const receptionPage = receptionSession.page;
    await receptionPage.goto(`/patients/${patient.id}`);
    await expect(receptionPage.getByRole("heading", { name: "رحلة المراجع" })).toBeVisible();
    await expect(receptionPage.getByRole("status").filter({ hasText: "لا توجد تحويلة مفتوحة" })).toBeVisible();
    await receptionPage.getByRole("button", { name: "حوّل إلى" }).click();
    const firstDialog = receptionPage.getByRole("dialog", { name: "تحويل المراجع" });
    await firstDialog.getByRole("combobox", { name: /^المركز/ }).selectOption({ label: center.name });
    await firstDialog.getByRole("button", { name: "إرسال التحويل" }).click();
    await expect(firstDialog).toBeHidden();
    await expect(prisma.patientHandoff.count({ where: { patientId: patient.id, status: "SENT", toRole: "SECRETARY" } })).resolves.toBe(1);
    await receptionPage.goto(`/patients/${patient.id}?tab=journey`);
    await expect(receptionPage.getByRole("list", { name: "تسلسل التحويلات" })).toHaveCount(0);

    const secretarySession = await rolePage(browser, users.secretary);
    contexts.push(secretarySession.context);
    const secretaryPage = secretarySession.page;
    await secretaryPage.goto(`/patients/${patient.id}`);
    await expect(secretaryPage.getByText("تفاصيل المسار السريري")).toHaveCount(0);
    await expect(secretaryPage.getByRole("button", { name: "استلمت" })).toBeVisible();
    await expect(secretaryPage.getByRole("button", { name: "الاستشارية الطبية" })).toHaveCount(0);
    await expect(secretaryPage.getByRole("link", { name: "الاستشارية الطبية" })).toHaveCount(0);
    await secretaryPage.goto("/my-work");
    const secretaryCard = secretaryPage.locator("section[aria-labelledby=\"handoff-inbox-title\"] article").filter({ hasText: patientName }).first();
    await expect(secretaryCard).toContainText("ينتظر");
    const staleSecretarySession = await rolePage(browser, users.secretary);
    contexts.push(staleSecretarySession.context);
    await staleSecretarySession.page.goto("/my-work");
    const staleCard = staleSecretarySession.page.locator("section[aria-labelledby=\"handoff-inbox-title\"] article").filter({ hasText: patientName }).first();
    await expect(staleCard.getByRole("button", { name: "استلمت" })).toBeVisible();
    await secretaryCard.getByRole("button", { name: "استلمت" }).click();
    await expect(secretaryCard).toContainText("مستلم");
    await expect(secretaryCard.getByRole("button", { name: "استلمت" })).toHaveCount(0);
    await expect(secretaryCard.getByRole("button", { name: "إنهاء" })).toBeVisible();
    await staleCard.getByRole("button", { name: "استلمت" }).click();
    await expect(staleCard.getByRole("alert")).toContainText("استلمها شخص آخر");
    await expect(prisma.patientHandoff.count({ where: { patientId: patient.id, status: "ACCEPTED" } })).resolves.toBe(1);

    await secretaryCard.getByRole("button", { name: "حوّل إلى" }).click();
    const forwardDialog = secretaryPage.getByRole("dialog", { name: "تحويل المراجع" });
    await forwardDialog.getByLabel("الجهة المستلمة").selectOption("THERAPIST");
    await forwardDialog.getByLabel("بالاسم").check();
    const namedTherapist = forwardDialog.getByLabel("الشخص").locator(`option[value="${therapist.id}"]`);
    await expect(namedTherapist).toContainText(therapistName);
    await forwardDialog.getByLabel("الشخص").selectOption(therapist.id);
    await forwardDialog.getByRole("button", { name: "إرسال التحويل" }).click();
    await expect(forwardDialog).toBeHidden();
    await secretaryPage.reload();
    await expect(secretaryPage.locator("section[aria-labelledby=\"handoff-inbox-title\"] article").filter({ hasText: patientName })).toHaveCount(0);

    const therapistSession = await rolePage(browser, users.therapist);
    contexts.push(therapistSession.context);
    const therapistPage = therapistSession.page;
    await therapistPage.goto("/my-work");
    const therapistCard = therapistPage.locator("section[aria-labelledby=\"handoff-inbox-title\"] article").filter({ hasText: patientName }).first();
    await expect(therapistCard).toContainText("ينتظر");
    await therapistCard.getByRole("button", { name: "استلمت" }).click();
    await expect(therapistCard).toContainText("مستلم");
    await therapistPage.goto(`/patients/${patient.id}`);
    await expect(therapistPage.getByRole("status").filter({ hasText: "هسه عند:" })).toContainText(therapistName);

    await therapistPage.goto("/my-work");
    const acceptedCard = therapistPage.locator("section[aria-labelledby=\"handoff-inbox-title\"] article").filter({ hasText: patientName }).first();
    await acceptedCard.getByRole("button", { name: "إرجاع", exact: true }).click();
    const reason = acceptedCard.getByLabel("سبب الإرجاع");
    await reason.fill("   ");
    await acceptedCard.getByRole("button", { name: "تأكيد الإرجاع" }).click();
    await expect(acceptedCard).toContainText("مستلم");
    await expect(acceptedCard.getByRole("alert")).toContainText("سبب الإرجاع مطلوب");
    await reason.fill(returnReason);
    await acceptedCard.getByRole("button", { name: "تأكيد الإرجاع" }).click();
    await expect(acceptedCard).toHaveCount(0);

    await secretaryPage.reload();
    const returnedCard = secretaryPage.locator("section[aria-labelledby=\"handoff-inbox-title\"] article").filter({ hasText: patientName }).first();
    await expect(returnedCard).toContainText("ينتظر");
    await expect(returnedCard).toContainText(therapistName);
    await secretaryPage.goto(`/patients/${patient.id}#operational-handoffs`);
    await expect(secretaryPage.getByText(`سبب الإرجاع: ${returnReason}`)).toHaveCount(0);
    await expect(secretaryPage.getByRole("heading", { name: "رحلة المراجع" })).toHaveCount(0);
    const timeline = secretaryPage.getByRole("list", { name: "تسلسل التحويلات" });
    await expect(timeline.getByRole("listitem")).toHaveCount(3);
    await expect(timeline).toContainText(therapistName);
    await expect(secretaryPage.getByRole("status").filter({ hasText: "هسه عند:" })).toContainText(secretaryName);

    await secretaryPage.goto("/my-work");
    await returnedCard.getByRole("button", { name: "استلمت" }).click();
    await expect(returnedCard).toContainText("مستلم");
    await returnedCard.getByRole("button", { name: "حوّل إلى" }).click();
    const secondForwardDialog = secretaryPage.getByRole("dialog", { name: "تحويل المراجع" });
    await secondForwardDialog.getByLabel("الجهة المستلمة").selectOption("THERAPIST");
    await secondForwardDialog.getByLabel("بالاسم").check();
    await secondForwardDialog.getByLabel("الشخص").selectOption(therapist.id);
    await secondForwardDialog.getByRole("button", { name: "إرسال التحويل" }).click();
    await expect(secondForwardDialog).toBeHidden();

    await therapistPage.goto("/my-work");
    const finalCard = therapistPage.locator("section[aria-labelledby=\"handoff-inbox-title\"] article").filter({ hasText: patientName }).first();
    await expect(finalCard).toContainText("ينتظر");
    await finalCard.getByRole("button", { name: "استلمت" }).click();
    await expect(finalCard).toContainText("مستلم");
    await finalCard.getByRole("button", { name: "إنهاء" }).click();
    await expect(finalCard).toHaveCount(0);
    await expect(prisma.patientHandoff.count({ where: { patientId: patient.id, status: "DONE" } })).resolves.toBe(3);
    await therapistPage.goto(`/patients/${patient.id}?tab=journey`);
    await expect(therapistPage.getByRole("list", { name: "تسلسل التحويلات" })).toHaveCount(0);
    await secretaryPage.goto(`/patients/${patient.id}#operational-handoffs`);
    const finishedTimeline = secretaryPage.getByRole("list", { name: "تسلسل التحويلات" });
    await expect(finishedTimeline.getByRole("listitem")).toHaveCount(4);
    await expect(finishedTimeline.getByRole("listitem").first()).toContainText("مكتمل");
  } finally {
    await Promise.allSettled(contexts.map((context) => Promise.race([
      context.close(), new Promise((resolve) => setTimeout(resolve, 1000)),
    ])));
    await prisma.$disconnect();
  }
});

test("secretary scoped history hides clinical fields and unrelated centers", async ({ browser, baseURL }) => {
  assertLocalFixtureDatabase(baseURL);
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const privateNote = `PRIVATE_NOTE_${suffix}`;
  const privateReason = `PRIVATE_REASON_${suffix}`;
  const outsiderNote = `OUTSIDER_HANDOFF_NOTE_${suffix}`;
  const outsiderName = `Outsider_${suffix}`;
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  try {
    const bootstrap = await rolePage(browser, username!);
    contexts.push(bootstrap.context);
    const passwordHash = await bcrypt.hash(password!, 10);
    const branch = await prisma.branch.create({ data: { name: `QA branch ${suffix}` } });
    const ownCenter = await prisma.center.create({ data: { name: `QA own center ${suffix}`, active: true } });
    const otherCenter = await prisma.center.create({ data: { name: `QA other center ${suffix}`, active: true } });
    async function createUser(label: string, role: UserRole) {
      return prisma.user.create({ data: {
        username: `qa-${label}-${suffix}`, fullName: `${label} ${suffix}`, role,
        branchId: branch.id, passwordHash,
      } });
    }
    const secretary = await createUser("secretary", "SECRETARY");
    const reception = await createUser("reception", "RECEPTION");
    const therapist = await createUser("therapist", "THERAPIST");
    const outsider = await prisma.user.create({ data: {
      username: `qa-outsider-${suffix}`, fullName: outsiderName, role: "SECRETARY",
      branchId: branch.id, passwordHash,
    } });
    const membership = await prisma.centerMembership.create({ data: {
      centerId: ownCenter.id, userId: secretary.id, role: "SECRETARY", status: "ACTIVE",
    } });
    await prisma.centerMembership.create({ data: {
      centerId: otherCenter.id, userId: outsider.id, role: "SECRETARY", status: "ACTIVE",
    } });
    const patient = await prisma.patient.create({ data: {
      fullName: `QA patient ${suffix}`, branchId: branch.id, phone: "07701234567",
      caseType: "WOUNDED", inMobilization: true, createdById: reception.id,
      dataEntryBy: reception.fullName,
    } });
    await prisma.patientHandoff.createMany({ data: [
      { patientId: patient.id, fromUserId: secretary.id, fromRole: "SECRETARY", fromCenterId: ownCenter.id,
        toRole: "THERAPIST", toCenterId: ownCenter.id, toUserId: therapist.id, status: "DONE", note: privateNote, returnReason: privateReason },
      { patientId: patient.id, fromUserId: reception.id, fromRole: "RECEPTION",
        toRole: "SECRETARY", toCenterId: ownCenter.id, status: "DONE", note: privateNote },
      { patientId: patient.id, fromUserId: reception.id, fromRole: "RECEPTION",
        toRole: "SECRETARY", toCenterId: ownCenter.id, toUserId: secretary.id, status: "DONE", note: privateNote },
      { patientId: patient.id, fromUserId: outsider.id, fromRole: "SECRETARY", fromCenterId: otherCenter.id,
        toRole: "SECRETARY", toCenterId: otherCenter.id, status: "DONE", note: outsiderNote },
    ] });

    const session = await rolePage(browser, secretary.username);
    contexts.push(session.context);
    const page = session.page;
    const response = await page.goto(`/patients/${patient.id}#operational-handoffs`);
    const payload = await response!.text();
    const timeline = page.getByRole("list", { name: "تسلسل التحويلات" });
    await expect(timeline.getByRole("listitem")).toHaveCount(3);
    await expect(timeline).not.toContainText(outsiderName);
    await expect(page.getByText("تفاصيل المسار السريري")).toHaveCount(0);
    for (const secret of [privateNote, privateReason, outsiderNote]) {
      expect(payload).not.toContain(secret);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(timeline).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    await prisma.centerMembership.update({ where: { id: membership.id }, data: { status: "INACTIVE" } });
    const inactiveResponse = await page.reload();
    await expect(page.getByRole("list", { name: "تسلسل التحويلات" })).toHaveCount(0);
    expect(await inactiveResponse!.text()).not.toContain(outsiderNote);
    await page.goto(`/patients/${patient.id}?tab=journey`);
    await expect(page.getByText("تفاصيل المسار السريري")).toHaveCount(0);
  } finally {
    await Promise.allSettled(contexts.map((context) => Promise.race([
      context.close(), new Promise((resolve) => setTimeout(resolve, 1000)),
    ])));
    await prisma.$disconnect();
  }
});

test("reception cancels a fresh handoff from أرسلتها اليوم", async ({ browser, baseURL }) => {
  assertLocalFixtureDatabase(baseURL);
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const patientName = `زينب كاظم اختبار ${suffix}`;
  const receptionUsername = `e2e-cancel-reception-${suffix}`;
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];

  try {
    const bootstrap = await rolePage(browser, username!);
    contexts.push(bootstrap.context);

    const passwordHash = await bcrypt.hash(password!, 10);
    const branch = await prisma.branch.create({ data: { name: `فرع اختبار ${suffix}` } });
    const center = await prisma.center.create({ data: { name: `مركز اختبار ${suffix}`, active: true } });
    const reception = await prisma.user.create({ data: {
      username: receptionUsername, fullName: `علي حسين اختبار ${suffix}`, role: "RECEPTION",
      branchId: branch.id, passwordHash,
    } });
    const secretary = await prisma.user.create({ data: {
      username: `e2e-cancel-secretary-${suffix}`, fullName: `نور الهدى عباس اختبار ${suffix}`,
      role: "SECRETARY", branchId: branch.id, passwordHash,
    } });
    await prisma.centerMembership.create({ data: {
      centerId: center.id, userId: secretary.id, role: "SECRETARY", status: "ACTIVE",
    } });
    const patient = await prisma.patient.create({ data: {
      fullName: patientName, branchId: branch.id, phone: "07701234567",
      caseType: "WOUNDED", inMobilization: true, createdById: reception.id,
      dataEntryBy: reception.fullName, notes: "بيانات اختبار التحويلة",
    } });

    const receptionSession = await rolePage(browser, receptionUsername);
    contexts.push(receptionSession.context);
    const page = receptionSession.page;
    await page.goto(`/patients/${patient.id}`);
    await page.getByRole("button", { name: "حوّل إلى" }).click();
    const dialog = page.getByRole("dialog", { name: "تحويل المراجع" });
    await dialog.getByRole("combobox", { name: /^المركز/ }).selectOption({ label: center.name });
    await dialog.getByRole("button", { name: "إرسال التحويل" }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/my-work");
    const sentToday = page.getByRole("region", { name: "أرسلتها اليوم" });
    const sentCard = sentToday.locator("article").filter({ hasText: patientName }).first();
    await expect(sentCard).toContainText("ينتظر");
    await sentCard.getByRole("button", { name: "إلغاء التحويلة" }).click();
    await expect(sentCard).toHaveCount(0);
    await expect(prisma.patientHandoff.count({ where: { patientId: patient.id, status: "CANCELLED" } })).resolves.toBe(1);
    await expect(sentCard.getByRole("button", { name: "إلغاء التحويلة" })).toHaveCount(0);

    await page.goto(`/patients/${patient.id}?tab=journey`);
    await expect(page.getByRole("list", { name: "تسلسل التحويلات" })).toHaveCount(0);
  } finally {
    await Promise.allSettled(contexts.map((context) => Promise.race([
      context.close(), new Promise((resolve) => setTimeout(resolve, 1000)),
    ])));
    await prisma.$disconnect();
  }
});
