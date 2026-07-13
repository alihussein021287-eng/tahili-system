import "dotenv/config";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import { clinicalPatient, stockedMedication } from "./fixture-factory";
import { credential, pageFor, RUN_ID, screenshot, statePath } from "./helpers";
import { submitServerAction } from "./resilient-action";

test.describe.configure({ mode: "serial", timeout: 180_000 });

async function tab(page: Page, name: string) {
  const button = page.locator("button").filter({ hasText: name }).last();
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
}

async function bodyIncludesOnTab(page: Page, tabName: string, text: string) {
  let body = await page.locator("body").innerText();
  if (!body.includes(text)) {
    await page.locator("button").filter({ hasText: tabName }).last().click({ timeout: 3_000 }).catch(() => undefined);
    body = await page.locator("body").innerText();
  }
  return body.includes(text);
}

async function pickCombo(scope: Page | Locator, index: number, text: string) {
  const input = scope.locator('input[role="combobox"]').nth(index);
  await input.click();
  await input.fill("");
  const option = scope.getByRole("button", { name: text }).first();
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

async function diagnosis(browser: Browser, patientId: string, label: string) {
  const actor = await pageFor(browser, "DOCTOR");
  await actor.page.goto(`/patients/${patientId}`);
  await tab(actor.page, "التشخيصات");
  const form = actor.page.locator('form:has(input[name="type"]):has(input[name="text"])');
  await pickCombo(form, 0, "اختصاص");
  await form.locator('input[name="text"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} تشخيص ${label}`);
  await form.locator('input[name="doctor"]').fill("ACCEPTANCE-20260713 DOCTOR");
  await submitServerAction({ name: `diagnosis-${label}`, role: "DOCTOR", browser, context: actor.context, page: actor.page, submit: form.getByRole("button", { name: "إضافة" }), dbExpectation: async () => Boolean(await prisma.diagnosis.findFirst({ where: { patientId, text: { contains: label } } })), confirmation: async p => (await p.locator("body").innerText()).includes(`تشخيص ${label}`), recoveryUrl: `/patients/${patientId}?tab=diag`, roleState: statePath(credential("DOCTOR")) });
}

async function createRx(browser: Browser, patientId: string, medicationId: number, type: "INTERNAL" | "EXTERNAL", label: string) {
  const actor = await pageFor(browser, "DOCTOR");
  await actor.page.goto(`/patients/${patientId}`);
  await tab(actor.page, "الوصفات والتجهيز");
  const form = actor.page.locator('form:has(input[name="prescriptionType"])');
  await pickCombo(form, 0, type === "INTERNAL" ? "داخلية من صيدلية المجمع" : "خارجية للطباعة");
  const medication = await prisma.medication.findUniqueOrThrow({ where: { id: medicationId } });
  await pickCombo(form, 1, medication.name);
  await form.locator('input[name="usage"]').fill("مرة يومياً");
  await form.locator('input[name="quantity"]').fill("4");
  await form.locator('input[name="duration"]').fill("4 أيام");
  await form.locator('input[name="doctor"]').fill("ACCEPTANCE-20260713 DOCTOR");
  await submitServerAction({ name: `rx-${label}`, role: "DOCTOR", browser, context: actor.context, page: actor.page, submit: form.getByRole("button", { name: "إضافة" }), dbExpectation: async () => Boolean(await prisma.prescription.findFirst({ where: { patientId, medicationId, prescriptionType: type } })), confirmation: async p => bodyIncludesOnTab(p, "الوصفات والتجهيز", medication.name), recoveryUrl: `/patients/${patientId}?tab=rx`, roleState: statePath(credential("DOCTOR")) });
  return prisma.prescription.findFirstOrThrow({ where: { patientId, medicationId, prescriptionType: type } });
}

test("الوصفة الداخلية: الأهلية والطابور والصرف الذري والقفل", async ({ browser }) => {
  const patient = await clinicalPatient("وصفة داخلية", true);
  const { medication } = await stockedMedication("دواء داخلي");
  await diagnosis(browser, patient.id, "وصفة داخلية");
  const rx = await createRx(browser, patient.id, medication.id, "INTERNAL", "internal");
  expect(rx.eligibilityDecision).toBe("ELIGIBLE"); expect(rx.eligibilityReason).toBeTruthy(); expect(rx.eligibilityRecordedAt).toBeTruthy();
  const pharmacist = await pageFor(browser, "PHARMACIST");
  await pharmacist.page.goto("/pharmacy");
  await expect(pharmacist.page.getByText(patient.fullName)).toBeVisible();
  await pharmacist.page.getByText(patient.fullName).click();
  const dispense = pharmacist.page.locator(`form:has(button:has-text("تجهيز كامل"))`).filter({ has: pharmacist.page.locator('input[name="qty"]') }).last();
  await submitServerAction({ name: "dispense-internal", role: "PHARMACIST", browser, context: pharmacist.context, page: pharmacist.page, submit: dispense.getByRole("button", { name: "تجهيز كامل" }), dbExpectation: async () => (await prisma.prescription.findUnique({ where: { id: rx.id } }))?.status === "DISPENSED", confirmation: async p => !(await p.locator("body").innerText()).includes(patient.fullName), recoveryUrl: "/pharmacy", roleState: statePath(credential("PHARMACIST")) });
  const saved = await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } });
  expect(saved.isDispensed).toBe(true); expect(saved.dispensedQty).toBe(4); expect(await prisma.stockMovement.count({ where: { prescriptionId: rx.id, type: "DISPENSE" } })).toBe(1);
  const locked = await pageFor(browser, "DOCTOR"); await locked.page.goto(`/patients/${patient.id}`); await tab(locked.page, "الوصفات والتجهيز");
  await expect(locked.page.getByText(/ج.*ه.*زت/)).toBeVisible(); await expect(locked.page.locator(`tr:has-text("${medication.name}") input[name="prescriptionType"]`)).toHaveCount(0); await locked.context.close();
  expect(await prisma.stockMovement.aggregate({ where: { prescriptionId: rx.id }, _sum: { quantity: true } })).toMatchObject({ _sum: { quantity: 4 } });
  const evidence = await pageFor(browser, "PHARMACIST"); await evidence.page.goto("/pharmacy"); await screenshot(evidence.page, "clinical-internal-rx"); await evidence.context.close();
});

test("الوصفة الخارجية: مسار الطباعة منفصل وRTL", async ({ browser }) => {
  const patient = await clinicalPatient("وصفة خارجية", false); const { medication } = await stockedMedication("دواء خارجي");
  await diagnosis(browser, patient.id, "وصفة خارجية"); const rx = await createRx(browser, patient.id, medication.id, "EXTERNAL", "external");
  const pharmacist = await pageFor(browser, "PHARMACIST"); await pharmacist.page.goto("/pharmacy"); await expect(pharmacist.page.getByText(patient.fullName)).toHaveCount(0); await pharmacist.context.close();
  const manager = await pageFor(browser, "MANAGER"); await manager.page.goto(`/pharmacy/rx/${rx.id}`);
  await expect(manager.page.getByText(patient.fullName)).toBeVisible(); await expect(manager.page.getByText(medication.name)).toBeVisible(); await expect(manager.page.getByText("ACCEPTANCE-20260713 DOCTOR")).toBeVisible();
  expect(await manager.page.locator("html").getAttribute("dir")).toBe("rtl"); await screenshot(manager.page, "clinical-external-rx-print"); await manager.context.close();
  const pharmacyView = await pageFor(browser, "PHARMACIST"); await pharmacyView.page.goto(`/patients/${patient.id}`); await expect(pharmacyView.page.locator('select[name="prescriptionType"]')).toHaveCount(0); await pharmacyView.context.close();
  expect((await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } })).prescriptionType).toBe("EXTERNAL");
});

async function createReport(browser: Browser, patientId: string, type: "PRELIMINARY" | "FINAL", label: string) {
  const content = `ACCEPTANCE-20260713 ${RUN_ID} تقرير ${label}`; const actor = await pageFor(browser, "DOCTOR"); await actor.page.goto(`/patients/${patientId}`); await tab(actor.page, "التقارير الطبية");
  const form = actor.page.locator('form:has(input[name="reportType"])'); await pickCombo(form, 0, type === "PRELIMINARY" ? "أولي" : "نهائي"); await pickCombo(form, 1, "مسودة"); await form.locator('input[name="content"]').fill(content); await form.locator('input[name="doctor"]').fill("ACCEPTANCE-20260713 DOCTOR");
  await submitServerAction({ name: `report-${label}`, role: "DOCTOR", browser, context: actor.context, page: actor.page, submit: form.getByRole("button", { name: "إضافة" }), dbExpectation: async () => Boolean(await prisma.medicalReport.findFirst({ where: { patientId, content } })), confirmation: async p => bodyIncludesOnTab(p, "التقارير الطبية", content), recoveryUrl: `/patients/${patientId}?tab=reports`, roleState: statePath(credential("DOCTOR")) });
  return prisma.medicalReport.findFirstOrThrow({ where: { patientId, content } });
}

test("التقارير الطبية: أولي ونهائي والجاهزية والطباعة والاعتماد", async ({ browser }) => {
  const patient = await clinicalPatient("تقارير طبية", true); const preliminary = await createReport(browser, patient.id, "PRELIMINARY", "أولي");
  const doctor = await pageFor(browser, "DOCTOR"); await doctor.page.goto(`/patients/${patient.id}`); await tab(doctor.page, "التقارير الطبية");
  const row = doctor.page.locator(`tr:has-text("${preliminary.content}")`); await submitServerAction({ name: "report-ready", role: "DOCTOR", browser, context: doctor.context, page: doctor.page, submit: row.getByRole("button", { name: "تجهيز للطباعة" }), dbExpectation: async () => (await prisma.medicalReport.findUnique({ where: { id: preliminary.id } }))?.status === "READY_TO_PRINT", confirmation: async p => bodyIncludesOnTab(p, "التقارير الطبية", "جاهز للطباعة"), recoveryUrl: `/patients/${patient.id}?tab=reports`, roleState: statePath(credential("DOCTOR")) });
  const manager = await pageFor(browser, "MANAGER"); await manager.page.goto(`/patients/${patient.id}/medical-report/${preliminary.id}`); await expect(manager.page.getByText(preliminary.content)).toBeVisible(); expect(await manager.page.locator("html").getAttribute("dir")).toBe("rtl"); await screenshot(manager.page, "clinical-report-print"); await manager.context.close();
  const approve = await pageFor(browser, "MANAGER"); await approve.page.goto(`/patients/${patient.id}`); await tab(approve.page, "التقارير الطبية"); await submitServerAction({ name: "report-approved", role: "MANAGER", browser, context: approve.context, page: approve.page, submit: approve.page.locator(`tr:has-text("${preliminary.content}")`).getByRole("button", { name: "تأشير مطبوع/معتمد" }), dbExpectation: async () => (await prisma.medicalReport.findUnique({ where: { id: preliminary.id } }))?.status === "PRINTED_APPROVED", confirmation: async p => bodyIncludesOnTab(p, "التقارير الطبية", "مطبوع/معتمد"), recoveryUrl: `/patients/${patient.id}?tab=reports`, roleState: statePath(credential("MANAGER")) });
  const final = await createReport(browser, patient.id, "FINAL", "نهائي"); expect(final.status).toBe("DRAFT"); expect(final.reportType).toBe("FINAL");
  expect(await prisma.notification.count({ where: { targetRole: "MANAGER", title: "تقرير طبي جاهز للطباعة", link: { contains: patient.id } } })).toBeGreaterThan(0); expect(await prisma.auditLog.count({ where: { tableName: "medical_reports", recordId: preliminary.id } })).toBeGreaterThanOrEqual(3);
  const locked = await pageFor(browser, "MANAGER"); await locked.page.goto(`/patients/${patient.id}`); await expect(locked.page.locator(`tr:has-text("${preliminary.content}") input[name="content"]`)).toHaveCount(0); await locked.context.close();
});

async function visibleAdmissionResource(browser: Browser, label: string) {
  const center = await prisma.center.findFirst({ where: { name: "الاستشاريات الطبية" } }) ?? await prisma.center.findFirstOrThrow();
  const roomName = `ACCEPTANCE-20260713 ${RUN_ID} غرفة ${label}`;
  const bedLabel = `سرير ${RUN_ID} ${label}`;
  const roomActor = await pageFor(browser, "ADMIN");
  await roomActor.page.goto("/beds");
  const roomForm = roomActor.page.locator('form:has(button:has-text("إضافة غرفة"))').first();
  await roomForm.locator('input[name="name"]').fill(roomName);
  await roomForm.locator('input[name="capacity"]').fill("1");
  await roomForm.locator('input[name="notes"]').fill(`ACCEPTANCE-20260713 ${RUN_ID}`);
  await submitServerAction({ name: `admission-room-${label}`, role: "ADMIN", browser, context: roomActor.context, page: roomActor.page, submit: roomForm.getByRole("button", { name: "إضافة غرفة" }), dbExpectation: async () => Boolean(await prisma.room.findFirst({ where: { name: roomName } })), confirmation: async p => (await p.locator("body").innerText()).includes(roomName), recoveryUrl: "/beds", roleState: statePath(credential("ADMIN")) });
  const room = await prisma.room.findFirstOrThrow({ where: { name: roomName } });
  const bedActor = await pageFor(browser, "ADMIN");
  await bedActor.page.goto("/beds");
  const roomCard = bedActor.page.locator(".rounded-xl").filter({ hasText: roomName }).filter({ has: bedActor.page.getByRole("button", { name: "إضافة سرير" }) }).first();
  await expect(roomCard).toBeVisible();
  const bedForm = roomCard.locator('form:has(button:has-text("إضافة سرير"))');
  await bedForm.locator('input[name="label"]').fill(bedLabel);
  await submitServerAction({ name: `admission-bed-${label}`, role: "ADMIN", browser, context: bedActor.context, page: bedActor.page, submit: bedForm.getByRole("button", { name: "إضافة سرير" }), dbExpectation: async () => Boolean(await prisma.bed.findFirst({ where: { roomId: room.id, label: bedLabel } })), confirmation: async p => (await p.locator("body").innerText()).includes(roomName), recoveryUrl: "/beds", roleState: statePath(credential("ADMIN")) });
  const bed = await prisma.bed.findFirstOrThrow({ where: { roomId: room.id, label: bedLabel } });
  return { center, room, bed };
}

async function admit(browser: Browser, patientId: string, resource: Awaited<ReturnType<typeof visibleAdmissionResource>>, label: string, admissionDate = "2026-07-13") {
  const actor = await pageFor(browser, "DOCTOR"); await actor.page.goto(`/patients/${patientId}`); await tab(actor.page, "الرقود"); const form = actor.page.locator('form:has(button:has-text("تسجيل رقود"))');
  await form.locator('input[name="admissionDate"]').fill(admissionDate); await form.locator('input[name="durationDays"]').fill("3"); await pickCombo(form, 0, resource.center.name); await pickCombo(form, 1, resource.room.name); await pickCombo(form, 2, `${resource.room.name} / ${resource.bed.label}`); await form.locator('input[name="recommendingDoctor"]').fill("ACCEPTANCE-20260713 DOCTOR"); await form.locator('input[name="admissionReason"]').fill(`ACCEPTANCE-20260713 ${label}`);
  await submitServerAction({ name: `admit-${label}`, role: "DOCTOR", browser, context: actor.context, page: actor.page, submit: form.getByRole("button", { name: "تسجيل رقود" }), dbExpectation: async () => Boolean(await prisma.admission.findFirst({ where: { patientId, bedId: resource.bed.id, status: "ADMITTED" } })), confirmation: async p => bodyIncludesOnTab(p, "الرقود", label), recoveryUrl: `/patients/${patientId}?tab=adm`, roleState: statePath(credential("DOCTOR")) }); return prisma.admission.findFirstOrThrow({ where: { patientId, bedId: resource.bed.id } });
}

test("الرقود والأسرّة: التعارض والطباعة والخروج وإعادة التخصيص", async ({ browser }) => {
  const resource = await visibleAdmissionResource(browser, "رقود"); const first = await clinicalPatient("راقد أول", true); const second = await clinicalPatient("راقد ثان", true); const admission = await admit(browser, first.id, resource, "رقود أول");
  expect((await prisma.bed.findUniqueOrThrow({ where: { id: resource.bed.id } })).occupied).toBe(true); expect(await prisma.notification.count({ where: { title: "تسجيل رقود جديد", link: "/beds" } })).toBeGreaterThan(0);
  const print = await pageFor(browser, "DOCTOR"); await print.page.goto(`/patients/${first.id}/admission/${admission.id}`); await expect(print.page.getByText(first.fullName)).toBeVisible(); await expect(print.page.getByText(resource.bed.label)).toBeVisible(); expect(await print.page.locator("html").getAttribute("dir")).toBe("rtl"); await screenshot(print.page, "clinical-admission-print"); await print.context.close();
  const conflict = await pageFor(browser, "DOCTOR"); await conflict.page.goto(`/patients/${second.id}`); await tab(conflict.page, "الرقود"); const form = conflict.page.locator('form:has(button:has-text("تسجيل رقود"))'); await form.locator('input[name="admissionDate"]').fill("2026-07-14"); await form.locator('input[name="durationDays"]').fill("2"); await pickCombo(form, 0, resource.center.name); await pickCombo(form, 1, resource.room.name);
  await form.locator('input[role="combobox"]').nth(2).click(); await expect(form.getByRole("button", { name: `${resource.room.name} / ${resource.bed.label}` })).toHaveCount(0); expect(await prisma.admission.count({ where: { patientId: second.id } })).toBe(0); await conflict.context.close();
  const discharge = await pageFor(browser, "DOCTOR"); await discharge.page.goto(`/patients/${first.id}`); await tab(discharge.page, "الرقود"); await submitServerAction({ name: "admission-discharge", role: "DOCTOR", browser, context: discharge.context, page: discharge.page, submit: discharge.page.getByRole("button", { name: "تسجيل خروج" }), dbExpectation: async () => (await prisma.admission.findUnique({ where: { id: admission.id } }))?.status === "DISCHARGED", confirmation: async p => bodyIncludesOnTab(p, "الرقود", "خرج"), recoveryUrl: `/patients/${first.id}?tab=adm`, roleState: statePath(credential("DOCTOR")) });
  expect((await prisma.bed.findUniqueOrThrow({ where: { id: resource.bed.id } })).occupied).toBe(false); const secondAdmission = await admit(browser, second.id, resource, "رقود ثان", "2026-07-14"); expect(secondAdmission.status).toBe("ADMITTED");
  const evidence = await pageFor(browser, "DOCTOR"); await evidence.page.goto(`/patients/${second.id}?tab=adm`); await screenshot(evidence.page, "clinical-admission-reassigned"); await evidence.context.close();
});

test.afterAll(async () => prisma.$disconnect());
