// Services around the patient: prescriptions and dispensing, external lab and radiology requests,
// admission to a bed, sick leave with approvals, wounded expenses, wound care and devices, plus
// patients who stop at an earlier stage (so every stage has someone waiting in it).
import { expect, test, type Page } from "@playwright/test";
import { DEMO_PATIENTS, CENTER, type DemoPatient } from "../../../scripts/dev-demo/people";
import { act, afterSave, as, combo, cred, done, finding, journey, openAllDetails, rememberPatient, settle, shot } from "./helpers";
import {
  acceptHandoff, addDiagnosis, externalRequest, openTab, referralButton, registerPatient, residentReview, selectByText, sendHandoff,
} from "./flows";

test.describe.configure({ mode: "serial" });

const failedScreen = async (page: Page) => /تعذر إكمال الطلب/.test(await page.locator("body").innerText().catch(() => ""));
async function rejected(page: Page, what: string) {
  if (await failedScreen(page)) throw new Error(`${what} رُفض: ${await page.getByRole("alert").first().innerText().catch(() => "بدون سبب ظاهر")}`);
}

/** Reception → secretary → resident → specialist, the common start of most paths. */
async function toSpecialist(browser: any, patient: DemoPatient, area: string, index: number, opts: { stopAt?: "secretary" | "resident" } = {}) {
  let patientId = "";
  let page = await as(browser, index % 2 ? "reception2" : "reception1", area);
  if (patient.branch !== "فرع بغداد الرئيسي") { await done(page); page = await as(browser, "reception3", area); }
  await act(page, area, "تسجيل المراجع", async () => { patientId = await registerPatient(page, patient); });
  rememberPatient(patient.fullName, { id: patientId, scenario: patient.scenario });
  await act(page, area, "تحويل لسكرتارية المركز", () => sendHandoff(page, patientId, { center: CENTER.physio, role: "SECRETARY" }));
  await done(page);
  if (opts.stopAt === "secretary") return patientId;

  page = await as(browser, "secretary1", area);
  await act(page, area, "السكرتارية تستلم", () => acceptHandoff(page, patientId));
  await act(page, area, "تحويل للمقيم", () => sendHandoff(page, patientId, { center: CENTER.physio, role: "RESIDENT", person: cred("resident1").fullName }));
  await done(page);
  if (opts.stopAt === "resident") return patientId;

  page = await as(browser, "resident1", area);
  await act(page, area, "المقيم يستلم", () => acceptHandoff(page, patientId));
  await act(page, area, "تقييم المقيم", () => residentReview(page, patientId));
  await act(page, area, "تحويل للاختصاص", () => sendHandoff(page, patientId, { center: CENTER.physio, role: "DOCTOR", person: cred("doctor1").fullName }));
  await done(page);
  page = await as(browser, "doctor1", area);
  await act(page, area, "الاختصاص يستلم", () => acceptHandoff(page, patientId));
  await done(page);
  return patientId;
}

async function prescribe(page: Page, patientId: string, medication: string, quantity: string) {
  await openTab(page, patientId, "rx");
  await page.getByText("+ وصفة").first().click();
  const form = page.locator("form").filter({ has: page.locator('input[name="usage"]') }).first();
  await combo(form, "prescriptionType", "داخلية");
  await combo(form, "medicationId", medication);
  await form.locator('input[name="usage"]').fill("حبة مرتين يومياً بعد الأكل");
  await form.locator('input[name="quantity"]').fill(quantity);
  await form.locator('input[name="duration"]').fill("10 أيام");
  await combo(form, "eligibilityDecision", "مؤهل");
  await form.getByRole("button", { name: "إضافة" }).click();
  await settle(page);
  await rejected(page, "الوصفة");
  await afterSave(page, "الوصفات", "إضافة وصفة", (timeout) => expect(page.locator("td", { hasText: medication.split(" ")[0] }).first()).toBeVisible({ timeout }));
}

async function dispense(page: Page, patientName: string, mode: "full" | "partial" | "reject") {
  await page.goto("/pharmacy");
  await settle(page);
  await page.getByRole("button", { name: new RegExp(patientName.split(" ")[0]) }).first().click();
  const panel = page.locator("form").filter({ has: page.getByRole("button", { name: mode === "reject" ? "تأكيد الرفض" : "تجهيز كامل" }) }).first();
  if (mode === "reject") {
    await openAllDetails(page);
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "تأكيد الرفض" }) }).first();
    await form.locator('[name="reason"]').fill("المادة غير مناسبة للحالة — مراجعة الطبيب");
    await form.getByRole("button", { name: "تأكيد الرفض" }).click();
  } else if (mode === "partial") {
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "صرف جزئي" }) }).first();
    await form.locator('[name="qty"]').fill("1");
    await form.getByRole("button", { name: "صرف جزئي" }).click();
  } else {
    await panel.getByRole("button", { name: "تجهيز كامل" }).click();
  }
  await settle(page);
  await rejected(page, "الصرف");
}

for (const [index, patient] of DEMO_PATIENTS.filter((item) => item.scenario === "pharmacy").entries()) {
  test(`الصيدلية: ${patient.fullName}`, async ({ browser }) => {
    const AREA = "الصيدلية";
    await journey(async () => {
      const patientId = await toSpecialist(browser, patient, AREA, index);
      let page = await as(browser, "doctor1", AREA);
      await act(page, AREA, "تشخيص", () => addDiagnosis(page, patientId, "آلام عضلية مزمنة بعد الإصابة"));
      await act(page, AREA, "وصفة داخلية", () => prescribe(page, patientId, index === 1 ? "إيبوبروفين" : "باراسيتامول", index === 1 ? "4" : "2"));
      await done(page);
      page = await as(browser, index === 2 ? "pharmacist2" : "pharmacist1", AREA);
      await act(page, AREA, index === 0 ? "صرف كامل" : index === 1 ? "صرف جزئي" : "رفض الوصفة", () => dispense(page, patient.fullName, index === 0 ? "full" : index === 1 ? "partial" : "reject"));
      await done(page);
    });
  });
}

for (const [index, patient] of DEMO_PATIENTS.filter((item) => item.scenario === "lab" || item.scenario === "radiology").entries()) {
  test(`فحص خارجي: ${patient.fullName}`, async ({ browser }) => {
    const AREA = patient.scenario === "lab" ? "المختبر الخارجي" : "الأشعة الخارجية";
    await journey(async () => {
      const patientId = await toSpecialist(browser, patient, AREA, index);
      let page = await as(browser, "doctor1", AREA);
      let referralId = "";
      await act(page, AREA, "طلب فحص خارجي", async () => {
        referralId = await externalRequest(page, patientId, { type: patient.scenario === "lab" ? "LAB" : "RADIOLOGY", entity: patient.scenario === "lab" ? "مختبر الرافدين الأهلي" : "مركز بغداد للأشعة", service: patient.scenario === "lab" ? "فحص دم شامل CBC وCRP" : "رنين مغناطيسي للعمود الفقري", reviewer: cred("doctor1").fullName });
      });
      rememberPatient(patient.fullName, { referralId });
      await done(page);
      page = await as(browser, "dataentry1", AREA);
      await act(page, AREA, "إنشاء الكتاب الرسمي", () => referralButton(page, referralId, "إنشاء الكتاب وتأكيد الجاهزية", { number: `ك/${100 + index}`, docDate: new Date().toISOString().slice(0, 10), subject: "طلب إجراء فحص للمراجع" }));
      await act(page, AREA, "تأكيد إرسال الطلب", () => referralButton(page, referralId, "تأكيد إرسال الطلب"));
      if (index % 2 === 0) {
        await act(page, AREA, "تسجيل وصول النتيجة", () => referralButton(page, referralId, "تسجيل وصول النتيجة", { resultSummary: "النتيجة ضمن الحدود الطبيعية مع ارتفاع بسيط بالمؤشرات" }));
        await done(page);
        page = await as(browser, "doctor1", AREA);
        await act(page, AREA, "اعتماد مراجعة النتيجة", () => referralButton(page, referralId, "اعتماد مراجعة النتيجة"));
      }
      await done(page);
    });
  });
}

for (const [index, patient] of DEMO_PATIENTS.filter((item) => item.scenario === "admission").entries()) {
  test(`الرقود: ${patient.fullName}`, async ({ browser }) => {
    const AREA = "الرقود";
    await journey(async () => {
      const patientId = await toSpecialist(browser, patient, AREA, index);
      const page = await as(browser, "doctor1", AREA);
      await act(page, AREA, "تسجيل رقود على سرير", async () => {
        await openTab(page, patientId, "adm");
        await page.getByText("+ تسجيل رقود").first().click();
        const form = page.locator("form").filter({ has: page.locator('[name="admissionReason"]') }).first();
        await form.locator('[name="admissionDate"]').fill(new Date().toISOString().slice(0, 10));
        await form.locator('[name="durationDays"]').fill("7");
        for (const name of ["centerId", "roomId", "bedId"]) {
          const field = form.locator(`select[name="${name}"]`);
          if (await field.count()) { await expect(field.locator("option").nth(1)).toBeAttached(); await field.selectOption({ index: 1 + (name === "bedId" ? index : 0) }); }
          else if (await form.locator(`input[type="hidden"][name="${name}"]`).count()) await combo(form, name, name === "roomId" ? "ردهة الرجال" : name === "bedId" ? `سرير ${index + 1}` : "مركز");
        }
        await form.locator('[name="admissionReason"]').fill("متابعة يومية وتأهيل مكثف");
        await form.getByRole("button", { name: "تسجيل رقود" }).click();
        await settle(page);
        await rejected(page, "الرقود");
        await afterSave(page, AREA, "تسجيل رقود", (timeout) => expect(page.getByText("متابعة يومية وتأهيل مكثف").first()).toBeVisible({ timeout }));
      });
      await act(page, AREA, "لوحة الأسرّة تبين السرير مشغول", async () => {
        await page.goto("/beds");
        await settle(page);
        await expect(page.getByText(patient.fullName).filter({ visible: true }).first()).toBeVisible();
      }, "متوسط").catch(() => undefined);
      await done(page);
    });
  });
}

for (const [index, patient] of DEMO_PATIENTS.filter((item) => item.scenario === "sickleave").entries()) {
  test(`الإجازة المرضية: ${patient.fullName}`, async ({ browser }) => {
    const AREA = "الإجازات المرضية";
    await journey(async () => {
      const patientId = await toSpecialist(browser, patient, AREA, index);
      let page = await as(browser, "doctor1", AREA);
      await act(page, AREA, "إصدار إجازة مرضية", async () => {
        await openTab(page, patientId, "sickleave");
        await page.getByText("+ إجازة مرضية").first().click();
        const form = page.locator("form").filter({ has: page.locator('[name="diagnosisText"]') }).first();
        const start = new Date();
        const end = new Date(Date.now() + 14 * 86_400_000);
        await form.locator('[name="startDate"]').fill(start.toISOString().slice(0, 10));
        await form.locator('[name="endDate"]').fill(end.toISOString().slice(0, 10));
        await form.locator('[name="diagnosisText"]').fill("كسر مثبت يحتاج راحة وتأهيل");
        const manager = form.locator('[name="needsManagerApproval"]');
        if (await manager.count()) await manager.check().catch(() => undefined);
        await form.getByRole("button", { name: "إصدار الإجازة" }).click();
        await settle(page);
        await rejected(page, "الإجازة");
        await afterSave(page, AREA, "إصدار إجازة", (timeout) => expect(page.getByText("كسر مثبت يحتاج راحة وتأهيل").first()).toBeVisible({ timeout }));
      });
      await done(page);
      page = await as(browser, "manager1", AREA);
      await act(page, AREA, "اعتماد المدير", async () => {
        await openTab(page, patientId, "sickleave");
        const approve = page.getByRole("button", { name: /اعتماد المدير|مصادقة/ }).first();
        await expect(approve).toBeVisible();
        await approve.click();
        await settle(page);
        await rejected(page, "الاعتماد");
      }, "متوسط").catch(() => undefined);
      await done(page);
    });
  });
}

for (const [index, patient] of DEMO_PATIENTS.filter((item) => item.scenario === "finance").entries()) {
  test(`صرفيات الجرحى: ${patient.fullName}`, async ({ browser }) => {
    const AREA = "صرفيات الجرحى";
    await journey(async () => {
      const patientId = await toSpecialist(browser, patient, AREA, index);
      let page = await as(browser, "accountant1", AREA);
      let expenseUrl = "";
      await act(page, AREA, "مسودة صرفية", async () => {
        await page.goto("/finance/expenses");
        await settle(page);
        await openAllDetails(page);
        const form = page.locator("form").filter({ has: page.getByRole("button", { name: "حفظ المسودة" }) }).first();
        await selectByText(form.locator('select[name="patientId"]'), patient.fullName);
        await form.locator('[name="beneficiary"]').fill(patient.fullName);
        const type = form.locator('[name="expenseType"]');
        if ((await type.evaluate((node) => node.tagName)) === "SELECT") await type.selectOption({ index: 1 }); else await type.fill("أجور نقل للعلاج");
        await form.locator('[name="amount"]').fill(String(150000 + index * 25000));
        await form.locator('[name="reason"]').fill("أجور نقل ومراجعات خلال الشهر");
        await form.getByRole("button", { name: "حفظ المسودة" }).click();
        await page.waitForURL(/\/finance\/expenses\/[^/?]+/, { timeout: 30_000 });
        await settle(page);
        expenseUrl = new URL(page.url()).pathname;
      });
      await act(page, AREA, "تقديم للاعتماد", async () => { await page.getByRole("button", { name: "تقديم للاعتماد" }).click(); await settle(page); await rejected(page, "التقديم"); });
      await done(page);
      for (const approver of ["manager1", "manager2", "manager3"]) {
        page = await as(browser, approver, AREA);
        await page.goto(expenseUrl);
        await settle(page);
        const approve = page.getByRole("button", { name: "اعتماد المستوى" });
        if (await approve.count()) await act(page, AREA, `اعتماد ${approver}`, async () => { await approve.first().click(); await settle(page); await rejected(page, "الاعتماد"); });
        await page.goto(expenseUrl);
        await settle(page);
        if (await page.getByRole("button", { name: "تجهيز للصرف" }).count()) await act(page, AREA, "المدير يجهز للصرف", async () => { await page.getByRole("button", { name: "تجهيز للصرف" }).click(); await settle(page); await rejected(page, "التجهيز"); });
        await done(page);
      }
      page = await as(browser, "accountant1", AREA);
      await page.goto(expenseUrl);
      await settle(page);
      if (await page.getByRole("button", { name: "تجهيز للصرف" }).count()) await act(page, AREA, "تجهيز للصرف", async () => { await page.getByRole("button", { name: "تجهيز للصرف" }).click(); await settle(page); await rejected(page, "التجهيز"); });
      if (index === 0) {
        await act(page, AREA, "تأكيد الصرف", async () => {
          await page.goto(expenseUrl);
          await settle(page);
          const form = page.locator("form").filter({ has: page.getByRole("button", { name: "تأكيد الصرف" }) }).first();
          await expect(form, "زر «تأكيد الصرف» لازم يطلع بعد الاعتماد").toBeVisible();
          const method = form.locator('[name="paymentMethod"]');
          if (await method.count() && (await method.evaluate((node) => node.tagName)) === "SELECT") await method.selectOption({ index: 1 }); else if (await method.count()) await method.fill("نقداً");
          const reference = form.locator('[name="financialReference"]');
          if (await reference.count()) await reference.fill(`س/${Date.now() % 100000}`);
          await form.getByRole("button", { name: "تأكيد الصرف" }).click();
          await settle(page);
          await rejected(page, "الصرف");
        });
      }
      await done(page);
    });
  });
}

// Patients who stop early, so each stage of the path has someone waiting in it.
for (const [index, patient] of DEMO_PATIENTS.filter((item) => ["intake-only", "resident-stop", "specialist-stop", "official", "dressing", "prosthetics"].includes(item.scenario)).entries()) {
  test(`مراحل مختلفة: ${patient.fullName} (${patient.scenario})`, async ({ browser }) => {
    const AREA = "مراحل المسار";
    await journey(async () => {
      if (patient.scenario === "intake-only") { await toSpecialist(browser, patient, AREA, index, { stopAt: "secretary" }); return; }
      if (patient.scenario === "resident-stop") { await toSpecialist(browser, patient, AREA, index, { stopAt: "resident" }); return; }
      const patientId = await toSpecialist(browser, patient, AREA, index);
      if (patient.scenario === "specialist-stop") return;
      const page = await as(browser, "doctor1", AREA);
      if (patient.scenario === "official") {
        await act(page, AREA, "تقرير طبي", async () => {
          await openTab(page, patientId, "diag");
          await page.getByText("+ تقرير طبي").first().click();
          const form = page.locator("form").filter({ has: page.locator('input[type="hidden"][name="reportType"]') }).first();
          const content = form.locator('textarea[name="content"], input[name="content"]').first();
          await content.fill("المراجع يعاني من آثار إصابة ويحتاج تأهيل مستمر لمدة ثلاثة أشهر");
          await form.getByRole("button", { name: "إضافة" }).click();
          await settle(page);
          await rejected(page, "التقرير");
        });
      }
      if (patient.scenario === "dressing" || patient.scenario === "prosthetics") {
        await act(page, AREA, "تقييم جرح", async () => {
          await openTab(page, patientId, "resident");
          await page.getByText("+ تقييم جرح").first().click();
          const form = page.locator("form").filter({ has: page.locator('[name="woundType"]') }).first();
          const type = form.locator('[name="woundType"]');
          if ((await type.evaluate((node) => node.tagName)) === "SELECT") await type.selectOption({ index: 1 }); else if (await form.locator('input[type="hidden"][name="woundType"]').count()) await combo(form, "woundType", "قرحة"); else await type.fill("قرحة سريرية");
          await form.locator('[name="nextPlan"]').fill("تضميد يومي وتقييم بعد أسبوع");
          await form.getByRole("button", { name: "إضافة تقييم" }).click();
          await settle(page);
          await rejected(page, "تقييم الجرح");
        }, "متوسط").catch(() => undefined);
      }
      await done(page);
    });
  });
}
