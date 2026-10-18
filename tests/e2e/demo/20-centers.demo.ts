// Psychological and occupational rehabilitation centres: referral → head therapist accepts and creates
// the centre programme → session booked and recorded → programme closed back to the specialist.
import { expect, test, type Page } from "@playwright/test";
import { DEMO_PATIENTS, CENTER } from "../../../scripts/dev-demo/people";
import { act, afterSave, as, cred, done, journey, rememberPatient, settle } from "./helpers";
import {
  acceptHandoff, addDiagnosis, expectHolder, finishHandoff, internalReferral, registerPatient, residentReview, selectByText, sendHandoff,
} from "./flows";

const SPACES = {
  psych: { slug: "psychological", center: CENTER.psych, secretary: "secretary2", resident: "resident2", doctor: "doctor2", head: "headtherapist2", service: "التأهيل النفسي", area: "مركز التأهيل النفسي" },
  occupational: { slug: "occupational", center: CENTER.occupational, secretary: "secretary3", resident: "resident3", doctor: "doctor3", head: "headtherapist3", service: "التأهيل الطبي الوظيفي", area: "مركز العلاج الوظيفي" },
} as const;

async function createCenterProgram(page: Page, slug: string, patientName: string, service: string, therapist: string) {
  await page.goto(`/centers/${slug}`);
  await settle(page);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "قبول وإنشاء البرنامج" }) }).first();
  await selectByText(form.locator('select[name="referralRequestId"]'), patientName);
  await selectByText(form.locator('select[name="serviceType"]'), service);
  await selectByText(form.locator('select[name="assignedToId"]'), therapist);
  await form.locator('input[name="plannedSessions"]').fill("6");
  await form.locator('input[name="startDate"]').fill(new Date().toISOString().slice(0, 10));
  await form.locator('textarea[name="initialSummary"]').fill("تقييم أولي: يحتاج دعم وتأهيل تدريجي حسب الخطة");
  await form.locator('textarea[name="goals"]').fill("تحسين الاستقلالية والمشاركة اليومية");
  await form.getByRole("button", { name: "قبول وإنشاء البرنامج" }).click();
  await afterSave(page, "المراكز", "إنشاء برنامج مركز", (timeout) => expect(page.locator("tr").filter({ hasText: patientName }).first()).toBeVisible({ timeout }));
}

async function openProgram(page: Page, slug: string, patientName: string) {
  await page.goto(`/centers/${slug}`);
  await settle(page);
  const row = page.locator("tr").filter({ hasText: patientName }).first();
  await row.locator(`a[href*="/centers/${slug}/programs/"]`).first().click();
  await page.waitForURL(new RegExp(`/centers/${slug}/programs/`));
  await settle(page);
}

async function bookSession(page: Page, minutesFromNow: number) {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "حجز الجلسة والموعد" }) }).first();
  const when = new Date(Date.now() + minutesFromNow * 60_000);
  const local = new Date(when.getTime() + 3 * 3_600_000).toISOString().slice(0, 16); // Baghdad local time
  await form.locator('input[name="scheduledAt"]').fill(local);
  await form.locator('input[name="durationMinutes"], select[name="durationMinutes"]').first().fill("45").catch(async () => form.locator('select[name="durationMinutes"]').selectOption("45"));
  const resource = form.locator('select[name="resourceId"]');
  if (await resource.locator("option").count() > 1) await resource.selectOption({ index: 1 });
  await form.getByRole("button", { name: "حجز الجلسة والموعد" }).click();
  await settle(page);
  if (/تعذر إكمال الطلب/.test(await page.locator("body").innerText())) throw new Error(`الحجز رُفض: ${await page.getByRole("alert").first().innerText().catch(() => "بدون سبب")}`);
}

async function recordCenterSession(page: Page, slug: string, patientName: string) {
  await page.goto(`/centers/${slug}/today`);
  await settle(page);
  const form = page.locator("form").filter({ hasText: patientName }).filter({ has: page.locator('select[name="status"]') }).first();
  const anyForm = (await form.count()) ? form : page.locator("form").filter({ has: page.locator('select[name="status"]') }).first();
  await expect(anyForm, "جلسة المركز لازم تطلع بجلسات اليوم").toBeVisible();
  await anyForm.locator('select[name="status"]').selectOption("COMPLETED");
  const attended = anyForm.locator('[name="attended"]');
  if (await attended.count()) { const tag = await attended.first().evaluate((node) => node.tagName); if (tag === "SELECT") await attended.first().selectOption({ index: 0 }); else await attended.first().check().catch(() => undefined); }
  await anyForm.locator('[name="procedure"]').fill("جلسة تأهيل فردية — تمارين ومهارات");
  await anyForm.locator('[name="result"]').fill("استجابة جيدة");
  await anyForm.locator('[name="progress"]').fill("تحسن تدريجي");
  await anyForm.locator("button").last().click();
  await settle(page);
  if (/تعذر إكمال الطلب/.test(await page.locator("body").innerText())) throw new Error(`تسجيل الجلسة رُفض: ${await page.getByRole("alert").first().innerText().catch(() => "بدون سبب")}`);
}

async function closeProgram(page: Page) {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "إغلاق البرنامج وإصدار التقييم" }) }).first();
  await form.locator('[name="finalSummary"]').fill("أنهى البرنامج بتحسن واضح بالمهارات اليومية");
  await form.locator('[name="improvementLevel"]').fill("جيد");
  await form.locator('[name="recommendation"]').fill("مراجعة الاستشارية بعد شهر");
  await form.locator('[name="returnToConsultancy"]').check();
  await form.getByRole("button", { name: "إغلاق البرنامج وإصدار التقييم" }).click();
  await settle(page);
  if (/تعذر إكمال الطلب/.test(await page.locator("body").innerText())) throw new Error(`إغلاق البرنامج رُفض: ${await page.getByRole("alert").first().innerText().catch(() => "بدون سبب")}`);
}

test.describe.configure({ mode: "serial" });

for (const [kind, space] of Object.entries(SPACES)) {
  const patients = DEMO_PATIENTS.filter((patient) => patient.scenario === kind);
  for (const [index, patient] of patients.entries()) {
    test(`${space.area}: ${patient.fullName}`, async ({ browser }) => {
      const AREA = space.area;
      let patientId = "";
      await journey(async () => {
        let page = await as(browser, index % 2 ? "reception2" : "reception1", AREA);
        await act(page, AREA, "تسجيل المراجع", async () => { patientId = await registerPatient(page, patient); });
        rememberPatient(patient.fullName, { id: patientId, scenario: kind });
        await act(page, AREA, "تحويل لسكرتارية المركز", () => sendHandoff(page, patientId, { center: space.center, role: "SECRETARY" }));
        await done(page);

        page = await as(browser, space.secretary, AREA);
        await act(page, AREA, "السكرتارية تستلم", () => acceptHandoff(page, patientId));
        await act(page, AREA, "تحويل للمقيم", () => sendHandoff(page, patientId, { center: space.center, role: "RESIDENT", person: cred(space.resident).fullName }));
        await done(page);

        page = await as(browser, space.resident, AREA);
        await act(page, AREA, "المقيم يستلم", () => acceptHandoff(page, patientId));
        await act(page, AREA, "تقييم المقيم", () => residentReview(page, patientId, kind === "psych" ? "باطنية" : "عظام"));
        await act(page, AREA, "تحويل للاختصاص", () => sendHandoff(page, patientId, { center: space.center, role: "DOCTOR", person: cred(space.doctor).fullName }));
        await done(page);

        page = await as(browser, space.doctor, AREA);
        await act(page, AREA, "الاختصاص يستلم", () => acceptHandoff(page, patientId));
        await act(page, AREA, "تشخيص", () => addDiagnosis(page, patientId, kind === "psych" ? "اضطراب ما بعد الصدمة بدرجة متوسطة" : "ضعف المهارات الدقيقة لليد بعد الإصابة"));
        await act(page, AREA, "إحالة للمركز", () => internalReferral(page, patientId, { center: space.center, service: space.service }));
        await act(page, AREA, "تحويل لرئيس المعالجين", () => sendHandoff(page, patientId, { center: space.center, role: "HEAD_THERAPIST" }));
        await done(page);

        page = await as(browser, space.head, AREA);
        await act(page, AREA, "رئيس المعالجين يستلم", () => acceptHandoff(page, patientId));
        await act(page, AREA, "قبول الإحالة وإنشاء برنامج المركز", () => createCenterProgram(page, space.slug, patient.fullName, space.service, cred("therapist3").fullName));
        await expectHolder(page, patientId, cred("therapist3").fullName, AREA);
        if (index === 0) await act(page, AREA, "حجز جلسة اليوم", async () => { await openProgram(page, space.slug, patient.fullName); await bookSession(page, 90 + (kind === "psych" ? 0 : 60)); });
        await done(page);

        if (index === 0) {
          page = await as(browser, "therapist3", AREA);
          await act(page, AREA, "المعالج يسجل جلسة المركز", () => recordCenterSession(page, space.slug, patient.fullName));
          await done(page);
        }
        if (index > 1) return;

        page = await as(browser, space.head, AREA);
        await act(page, AREA, "إغلاق البرنامج والرجوع للاستشارية", async () => { await openProgram(page, space.slug, patient.fullName); await closeProgram(page); });
        await expectHolder(page, patientId, cred(space.doctor).fullName, AREA);
        await done(page);

        page = await as(browser, space.doctor, AREA);
        await act(page, AREA, "الاختصاص يستلم بعد المركز", () => acceptHandoff(page, patientId));
        await act(page, AREA, "الاختصاص ينهي", () => finishHandoff(page, patientId));
        await done(page);
      });
    });
  }
}
