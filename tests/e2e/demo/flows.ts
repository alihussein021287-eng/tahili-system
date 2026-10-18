// Reusable workflow steps, each done through the real screens as the named user.
import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { RESULTS, afterSave, combo, settle, patientIdFromUrl, step, finding, shot } from "./helpers";
import type { DemoPatient } from "../../../scripts/dev-demo/people";

/** Reception registers a new patient through /patients/new and lands on the new file. */
export async function registerPatient(page: Page, patient: DemoPatient): Promise<string> {
  await page.goto("/patients/new");
  await settle(page);
  const form = page.locator("form").filter({ has: page.locator('input[name="fullName"]') }).first();
  await form.locator('input[name="fullName"]').fill(patient.fullName);
  await combo(form, "gender", patient.gender === "MALE" ? "ذكر" : "أنثى");
  await form.locator('input[name="birthDate"]').fill(`${patient.birthYear}-03-15`);
  await form.locator('input[name="phone"]').fill(patient.phone);
  await combo(form, "governorateId", patient.governorate);
  if (await form.locator('input[type="hidden"][name="branchId"]').count()) await combo(form, "branchId", patient.branch);
  await combo(form, "rank", patient.rank);
  await combo(form, "formationText", patient.formation);
  await combo(form, "caseType", patient.formation === "مدني" ? "مريض" : "جريح");
  await combo(form, "injuryTypeId", patient.injury);
  await form.getByRole("button", { name: "حفظ" }).click();
  const left = page.waitForURL((url) => !/\/patients\/new$/.test(url.pathname) || url.searchParams.has("saved"), { timeout: 30_000 }).then(() => "left");
  const banner = page.locator("[role=status]").filter({ hasText: patient.fullName }).getByRole("link", { name: "فتح ملفه" });
  const back = banner.waitFor({ timeout: 30_000 }).then(() => "banner");
  if ((await Promise.race([left, back])) === "banner") {
    // The page came back to the empty form after the save: it names the patient just registered.
    fs.appendFileSync(path.join(RESULTS, "stale-refresh.jsonl"), `${JSON.stringify({ area: "الاستقبال", label: "تسجيل مراجع", url: page.url(), at: new Date().toISOString() })}\n`);
    await banner.click();
    await page.waitForURL(/\/patients\/(?!new)[^/?]+/, { timeout: 30_000 });
  }
  await settle(page);
  const saved = new URL(page.url()).searchParams.get("saved");
  if (saved && saved !== "1") throw new Error(`تسجيل المراجع رجع رسالة: ${saved}`);
  step("الاستقبال", `تسجيل ${patient.fullName}`);
  return patientIdFromUrl(page);
}

export type HandoffTarget = { center?: string; role: "SECRETARY" | "RESIDENT" | "DOCTOR" | "HEAD_THERAPIST" | "THERAPIST" | "RECEPTION" | "DATA_ENTRY"; person?: string; note?: string };
const ROLE_LABEL: Record<HandoffTarget["role"], string> = {
  SECRETARY: "سكرتارية المركز", RESIDENT: "طبيب مقيم", DOCTOR: "طبيب اختصاص", HEAD_THERAPIST: "رئيس المعالجين", THERAPIST: "معالج", RECEPTION: "الاستقبال", DATA_ENTRY: "إدخال البيانات",
};

/** Sends the patient on from the patient file ("حوّل إلى"). */
export async function sendHandoff(page: Page, patientId: string, target: HandoffTarget) {
  if (!new URL(page.url()).pathname.endsWith(`/patients/${patientId}`)) await page.goto(`/patients/${patientId}`);
  const dialog = page.getByRole("dialog", { name: "تحويل المراجع" });
  if (!(await dialog.isVisible().catch(() => false))) await page.getByRole("button", { name: "حوّل إلى" }).first().click();
  await expect(dialog).toBeVisible();
  await dialog.locator("select").nth(1).selectOption({ label: ROLE_LABEL[target.role] });
  if (target.center) {
    const centerSelect = dialog.locator("select").first();
    await expect(centerSelect.locator("option", { hasText: target.center })).toHaveCount(1);
    await centerSelect.selectOption({ label: target.center });
  }
  if (!target.person && await dialog.getByLabel("أي شخص متاح").count()) await dialog.getByLabel("أي شخص متاح").check();
  if (target.person) {
    await dialog.getByLabel("بالاسم").check();
    const people = dialog.locator("select").nth(2);
    await expect(people.locator("option", { hasText: target.person })).toHaveCount(1, { timeout: 15_000 });
    const value = await people.locator("option", { hasText: target.person }).getAttribute("value");
    await people.selectOption(value!);
  }
  if (target.note) await dialog.locator("textarea").fill(target.note);
  await dialog.getByRole("button", { name: "إرسال التحويل" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await settle(page);
  step("التسليم", `تحويل إلى ${ROLE_LABEL[target.role]}${target.person ? ` (${target.person})` : ""}${target.center ? ` — ${target.center}` : ""}`);
}

/** The receiver opens the file and presses «استلمت». */
export async function acceptHandoff(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}`);
  await settle(page);
  const button = page.getByRole("button", { name: "استلمت" }).first();
  await expect(button, "زر «استلمت» لازم يطلع للمستلم").toBeVisible();
  await button.click();
  await afterSave(page, "التسليم", "استلمت", (timeout) => expect(page.getByRole("button", { name: "استلمت" })).toHaveCount(0, { timeout }));
  step("التسليم", "استلام المراجع");
}

/** Reads the «حالياً عند» line of the patient file. */
export async function holderText(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}`);
  await settle(page);
  const section = page.locator('section[aria-labelledby="handoff-journey-title"]').first();
  return (await section.innerText().catch(() => "")).replace(/\s+/g, " ").match(/(?:هسه|حالياً) عند:?.{0,80}/)?.[0] ?? "";
}

export async function expectHolder(page: Page, patientId: string, expected: string, area: string) {
  let text = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    text = await holderText(page, patientId);
    if (text.includes(expected)) return;
    await page.waitForTimeout(2_000);
  }
  finding({ area, url: page.url(), severity: "عالي", message: `«حالياً عند» يقول «${text || "فارغ"}» والمفروض «${expected}»`, screenshot: await shot(page, `holder-${area}`) });
}

/** Opens one entry of the patient file menu (the tab key from PATIENT_NAV). */
export async function openTab(page: Page, patientId: string, tab: string) {
  await page.goto(`/patients/${patientId}?tab=${tab}`);
  await settle(page);
}

/** Reception records today's visit from /visits. */
export async function checkIn(page: Page, patientName: string) {
  await page.goto("/visits");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "✔ تسجيل حضور" }) }).first();
  await combo(form, "patientId", patientName);
  await form.getByRole("button", { name: "✔ تسجيل حضور" }).click();
  await settle(page);
  const saved = new URL(page.url()).searchParams.get("saved") || "";
  if (/خطأ|تعذر|لا يمكن/.test(saved)) throw new Error(saved);
}

/** Data entry completes the missing personal data from the edit page. */
export async function completeData(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}/edit`);
  await settle(page);
  const form = page.locator("form").filter({ has: page.locator('input[name="fullName"]') }).first();
  await form.locator('input[name="motherName"]').fill("فاطمة حسن علي");
  await combo(form, "maritalStatus", "متزوج");
  await form.locator('input[name="childrenCount"]').fill("2");
  await form.locator('input[name="education"]').fill("إعدادية");
  await form.locator('input[name="injuryCause"]').fill("إصابة أثناء الواجب");
  await form.locator('input[name="injuryDate"]').fill("2024-05-20");
  await form.locator('input[name="disabilityPct"]').fill("35");
  await form.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/edit") || url.searchParams.has("saved"), { timeout: 30_000 });
  await settle(page);
  const saved = new URL(page.url()).searchParams.get("saved");
  if (saved && saved !== "1") throw new Error(`حفظ البيانات رجع رسالة: ${saved}`);
}

/** The resident's review with vitals and a referral to a specialist. */
export async function residentReview(page: Page, patientId: string, specialty = "عظام") {
  await openTab(page, patientId, "resident");
  await page.getByText("+ تقييم جديد").first().click();
  const form = page.locator("form").filter({ has: page.locator('input[name="systolic"]') }).first();
  await form.locator('input[name="systolic"]').fill("125");
  await form.locator('input[name="diastolic"]').fill("80");
  await form.locator('input[name="pulse"]').fill("78");
  await form.locator('input[name="temp"]').fill("36.9");
  await form.locator('input[name="spo2"]').fill("98");
  await form.locator('input[name="weight"]').fill("74");
  await form.locator('input[name="referralNeeded"]').check();
  await combo(form, "specialtyType", specialty);
  await form.locator('input[name="referralReason"]').fill("يحتاج تقييم اختصاص قبل برنامج التأهيل");
  await form.locator('button[type="submit"], button:not([type])').last().click();
  await afterSave(page, "الطبيب المقيم", "تقييم المقيم", (timeout) => expect(page.getByText("إحالة إلى اختصاص:").first()).toBeVisible({ timeout }));
}

/** The specialist records a diagnosis. */
export async function addDiagnosis(page: Page, patientId: string, text: string) {
  await openTab(page, patientId, "diag");
  await page.getByText("+ تشخيص").first().click();
  const form = page.locator("form").filter({ has: page.locator('input[name="text"]') }).first();
  await combo(form, "type", "اختصاص");
  await form.locator('input[name="text"]').fill(text);
  await form.getByRole("button", { name: "إضافة" }).click();
  await afterSave(page, "الاستشارية", "إضافة تشخيص", (timeout) => expect(page.getByText(text).first()).toBeVisible({ timeout }));
}

/** The doctor writes an internal-centre referral and makes it ready; returns the referral id. */
export async function internalReferral(page: Page, patientId: string, opts: { center: string; service: string; therapist?: string; reviewer?: string }) {
  await openTab(page, patientId, "referrals");
  await page.getByText("إنشاء طلب جديد").first().click();
  const form = page.locator("form").filter({ has: page.locator('select[name="destinationScope"]') }).first();
  await form.locator('select[name="destinationScope"]').selectOption("INTERNAL_CENTER");
  await form.locator('select[name="type"]').selectOption("TREATMENT_CENTER");
  await form.locator('select[name="destinationCenterId"]').selectOption({ label: opts.center });
  if (opts.therapist) await form.locator('select[name="suggestedTherapistId"]').selectOption({ label: opts.therapist });
  if (opts.reviewer) await form.locator('select[name="assignedReviewerId"]').selectOption({ label: opts.reviewer });
  const review = form.locator('select[name="residentReviewId"] option').nth(1);
  if (await review.count()) await form.locator('select[name="residentReviewId"]').selectOption({ index: 1 });
  await form.locator('input[name="requestedService"]').fill(opts.service);
  await form.locator('textarea[name="clinicalReason"]').fill("حالة مستقرة تحتاج برنامج تأهيلي حسب تقييم الاختصاص");
  await form.getByRole("button", { name: "حفظ الطلب كمسودة" }).click();
  await page.waitForURL(/\/referrals\/[^/?]+/, { timeout: 30_000 });
  await settle(page);
  const referralId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("button", { name: "تجهيز الإحالة الداخلية" }).click();
  await afterSave(page, "الإحالات", "تجهيز الإحالة", (timeout) => expect(page.getByRole("button", { name: "تجهيز الإحالة الداخلية" })).toHaveCount(0, { timeout }));
  return referralId;
}

/** An external lab/radiology request: draft → print list. */
export async function externalRequest(page: Page, patientId: string, opts: { type: "LAB" | "RADIOLOGY" | "IMAGING"; entity: string; service: string; reviewer: string }) {
  await openTab(page, patientId, "referrals");
  await page.getByText("إنشاء طلب جديد").first().click();
  const form = page.locator("form").filter({ has: page.locator('select[name="destinationScope"]') }).first();
  await form.locator('select[name="destinationScope"]').selectOption("EXTERNAL");
  await form.locator('select[name="type"]').selectOption(opts.type);
  await form.locator('input[name="externalEntity"]').fill(opts.entity);
  await form.locator('select[name="assignedReviewerId"]').selectOption({ label: opts.reviewer });
  await form.locator('input[name="requestedService"]').fill(opts.service);
  await form.locator('textarea[name="clinicalReason"]').fill("متابعة الحالة وتقييم الاستجابة للعلاج");
  await form.getByRole("button", { name: "حفظ الطلب كمسودة" }).click();
  await page.waitForURL(/\/referrals\/[^/?]+/, { timeout: 30_000 });
  await settle(page);
  const referralId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("button", { name: "إرسال إلى قائمة الطباعة" }).click();
  await settle(page);
  return referralId;
}

export async function referralButton(page: Page, referralId: string, button: string, fill?: Record<string, string>) {
  await page.goto(`/referrals/${referralId}`);
  await settle(page);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: button }) }).first();
  await expect(form, `زر «${button}» لازم يطلع`).toBeVisible();
  for (const [name, value] of Object.entries(fill ?? {})) await form.locator(`[name="${name}"]`).fill(value);
  await form.getByRole("button", { name: button }).click();
  await afterSave(page, "الإحالات", button, (timeout) => expect(page.getByRole("button", { name: button })).toHaveCount(0, { timeout }));
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Selects the option whose text contains `text` (labels often carry extra details). */
export async function selectByText(select: import("@playwright/test").Locator, text: string) {
  const option = select.locator("option", { hasText: text }).first();
  await expect(option, `الخيار «${text}» لازم يكون موجود`).toHaveCount(1);
  await select.selectOption((await option.getAttribute("value"))!);
}

/** The head therapist creates the programme from the accepted referral. */
export async function createProgram(page: Page, patientId: string, opts: { center: string; therapist?: string; expectSuggested?: string; doctor: string; hall: string; sessions: number; time: string }) {
  await openTab(page, patientId, "therapyProgram");
  const summary = page.getByText("+ برنامج جديد").first();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "إنشاء الخطة وجدولة الجلسات" }) }).first();
  if (!(await form.isVisible())) await summary.click();
  await expect(form).toBeVisible();
  if (!(await form.locator('select[name="centerId"]').inputValue())) {
    finding({ area: "العلاج الطبيعي", url: page.url(), severity: "منخفض", message: "مركز البرنامج ما انختار تلقائياً رغم وجود إحالة واحدة" });
    await selectByText(form.locator('select[name="centerId"]'), opts.center);
  }
  if (!(await form.locator('select[name="referralRequestId"]').inputValue())) await form.locator('select[name="referralRequestId"]').selectOption({ index: 1 });
  if (opts.expectSuggested) {
    const chosen = await form.locator('select[name="therapistId"] option:checked').innerText();
    if (!chosen.includes(opts.expectSuggested)) finding({ area: "العلاج الطبيعي", url: page.url(), severity: "متوسط", message: `المعالج المقترح من الطبيب (${opts.expectSuggested}) ما انختار تلقائياً — المختار: ${chosen}` });
  }
  if (opts.therapist) await selectByText(form.locator('select[name="therapistId"]'), opts.therapist);
  const doctorChosen = await form.locator('select[name="specialistDoctorId"] option:checked').innerText();
  if (!doctorChosen.includes(opts.doctor)) await selectByText(form.locator('select[name="specialistDoctorId"]'), opts.doctor);
  await selectByText(form.locator('select[name="hallId"]'), opts.hall);
  await form.locator('input[name="plannedSessions"]').fill(String(opts.sessions));
  const days = form.locator('input[name="treatmentDays"]');
  if (await days.count()) await days.fill("30");
  await form.locator('input[name="startDate"]').fill(iso(new Date()));
  await form.locator('input[name="sessionTime"]').fill(opts.time);
  const weekdays = form.locator('input[name="weekdays"]');
  for (let index = 0; index < await weekdays.count(); index++) await weekdays.nth(index).check();
  await form.locator('textarea[name="goals"], input[name="goals"]').first().fill("تحسين المدى الحركي والقوة العضلية والمشي المستقل");
  await form.getByRole("button", { name: "إنشاء الخطة وجدولة الجلسات" }).click();
  await afterSave(page, "العلاج الطبيعي", "إنشاء البرنامج", (timeout) => expect(page.getByText(/جلسة علاج طبيعي 1 من/).first()).toBeVisible({ timeout }));
}

/** The therapist records today's session from «جلساتي اليوم». */
export async function recordTodaySession(page: Page, patientName: string) {
  await page.goto("/therapy/today");
  await settle(page);
  const card = page.locator("article").filter({ hasText: patientName }).first();
  await expect(card, "جلسة اليوم لازم تطلع للمعالج").toBeVisible();
  await expect(card.getByText(/جلسة علاج طبيعي \d+ من \d+/)).toBeVisible();
  await card.locator('textarea[name="exercises"]').fill("تمارين تقوية للطرف السفلي ومشي بين المتوازيين 15 دقيقة");
  await card.locator('textarea[name="response"]').fill("تحمل جيد بدون ألم شديد");
  await card.locator('textarea[name="progress"]').fill("تحسن بسيط بالمدى الحركي");
  await card.getByRole("button", { name: "حفظ نتيجة الجلسة" }).click();
  await afterSave(page, "جلساتي اليوم", "حفظ نتيجة الجلسة", (timeout) => expect(page.locator("article").filter({ hasText: patientName }).first().getByText("مكتملة").first()).toBeVisible({ timeout }));
}

/** Someone moves a programme session from the patient file table («نقل»). */
export async function rescheduleFromFile(page: Page, patientId: string, sessionNumber: number, daysLater: number, time = "11:30") {
  await openTab(page, patientId, "therapyProgram");
  const row = page.locator("tr").filter({ hasText: new RegExp(`جلسة علاج طبيعي ${sessionNumber} من`) }).first();
  await expect(row).toBeVisible();
  await row.getByText("نقل").first().click();
  const when = new Date(Date.now() + daysLater * 86_400_000);
  const local = `${iso(when)}T${time}`;
  await row.locator('input[name="scheduledAt"]').fill(local);
  await row.locator('input[name="reason"]').fill("طلب المراجع يوم ثاني");
  await row.getByRole("button", { name: "حفظ" }).click();
  await settle(page);
  if (/تعذر إكمال الطلب/.test(await page.locator("body").innerText())) throw new Error(`نقل الموعد رُفض: ${await page.getByRole("alert").first().innerText().catch(() => "بدون سبب ظاهر")}`);
}

/** The head therapist closes the programme from the final evaluation page. */
export async function finalizeProgram(page: Page, patientId: string) {
  await openTab(page, patientId, "therapyProgram");
  await page.getByRole("link", { name: /(كتابة|فتح) التقييم النهائي/ }).first().click();
  await page.waitForURL(/\/therapy\/plans\/[^/]+\/final/);
  const form = page.locator("form").filter({ has: page.locator('[name="finalDecision"]') }).first();
  await form.locator('[name="beforeCondition"]').fill("ضعف بالطرف السفلي ومشي بمساعدة عكاز");
  await form.locator('[name="afterCondition"]').fill("مشي مستقل لمسافات قصيرة");
  await form.locator('[name="improvementLevel"]').fill("جيد");
  await form.locator('[name="finalRecoveryPercent"]').fill("70");
  await form.locator('[name="finalDecision"]').selectOption("END");
  await form.locator('[name="achievedGoals"]').fill("تحسن المدى الحركي والقوة");
  await form.locator('[name="finalRecommendation"]').fill("متابعة منزلية وتمارين يومية");
  await form.locator("button").last().click();
  await settle(page);
}

/** The holder presses «إنهاء» on his accepted handoff. */
export async function finishHandoff(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}`);
  const finish = page.getByRole("button", { name: "إنهاء" }).first();
  await expect(finish).toBeVisible();
  await finish.click();
  await afterSave(page, "التسليم", "إنهاء", (timeout) => expect(page.getByRole("button", { name: "إنهاء" })).toHaveCount(0, { timeout }));
}
