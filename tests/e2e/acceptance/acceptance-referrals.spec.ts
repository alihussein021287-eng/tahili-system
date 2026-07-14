import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import { acceptanceDoctor, referralPatient } from "./fixture-factory";
import { credential, pageFor, ROOT, RUN_ID, screenshot, statePath } from "./helpers";
import { submitServerAction } from "./resilient-action";

test.describe.configure({ mode: "serial", timeout: 180_000 });

async function activateTab(page: Page, name: string) {
  await page.getByRole("button", { name }).evaluate((button: HTMLElement) => button.click());
}

async function checkIn(browser: Browser, patient: { id: string; fullName: string }, destination = "طبيب/تشخيص") {
  const actor = await pageFor(browser, "RECEPTION");
  await actor.page.goto(`/visits?q=${encodeURIComponent(patient.fullName)}`, { waitUntil: "domcontentloaded" });
  const form = actor.page.locator(`form:has(input[name="patientId"][value="${patient.id}"])`);
  await form.locator('select[name="destination"]').selectOption({ label: destination });
  await submitServerAction({ name: `attendance-${patient.id}`, role: "RECEPTION", browser, context: actor.context, page: actor.page, submit: form.getByRole("button", { name: /تسجيل زيارة/ }), dbExpectation: async () => Boolean(await prisma.visit.findFirst({ where: { patientId: patient.id } })), confirmation: async (page) => (await page.locator("body").innerText()).includes("حاضر"), recoveryUrl: `/visits?q=${encodeURIComponent(patient.fullName)}`, roleState: statePath(credential("RECEPTION")) });
}

async function residentReview(browser: Browser, patient: { id: string }) {
  const actor = await pageFor(browser, "RESIDENT");
  await actor.page.goto(`/patients/${patient.id}`, { waitUntil: "domcontentloaded" });
  await activateTab(actor.page, "الطبيب المقيم");
  const form = actor.page.locator('form:has(button:has-text("حفظ تقييم الطبيب المقيم"))');
  await form.locator('input[name="pulse"]').fill("78");
  await form.locator('input[name="spo2"]').fill("98");
  await form.locator('input[name="generalNotes"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} تقييم مقيم`);
  await submitServerAction({ name: `resident-${patient.id}`, role: "RESIDENT", browser, context: actor.context, page: actor.page, submit: form.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" }), dbExpectation: async () => Boolean(await prisma.residentReview.findFirst({ where: { patientId: patient.id } })), confirmation: async (page) => (await page.locator("body").innerText()).includes("78"), recoveryUrl: `/patients/${patient.id}`, roleState: statePath(credential("RESIDENT")) });
}

async function createReferral(browser: Browser, patient: { id: string }, type: "RADIOLOGY"|"HOSPITAL"|"SPECIALIST"|"LAB", scope: "EXTERNAL"|"INTERNAL_SPECIALIST", label: string) {
  const doctor = await acceptanceDoctor();
  const service = `ACCEPTANCE-20260713 ${RUN_ID} ${label}`;
  const actor = await pageFor(browser, "DOCTOR");
  await actor.page.goto(`/patients/${patient.id}`, { waitUntil: "domcontentloaded" });
  await activateTab(actor.page, "الفحوص والإحالات");
  await actor.page.getByText("إنشاء طلب جديد", { exact: true }).evaluate((summary) => { const details=summary.closest("details") as HTMLDetailsElement|null;if(details)details.open=true; });
  const form = actor.page.locator('form:has(button:has-text("حفظ الطلب كمسودة"))');
  await form.locator('select[name="destinationScope"]').selectOption(scope);
  await form.locator('select[name="type"]').selectOption(type);
  if (scope === "EXTERNAL") await form.locator('input[name="externalEntity"]').fill(`ACCEPTANCE-20260713 ${label}`);
  await form.locator('select[name="assignedReviewerId"]').selectOption(doctor.id);
  await form.locator('input[name="requestedService"]').fill(service);
  await form.locator('textarea[name="clinicalReason"]').fill("ACCEPTANCE-20260713 سبب سريري تجريبي");
  await submitServerAction({ name: `create-${label}`, role: "DOCTOR", browser, context: actor.context, page: actor.page, submit: form.getByRole("button", { name: "حفظ الطلب كمسودة" }), dbExpectation: async () => Boolean(await prisma.referralRequest.findFirst({ where: { requestedService: service } })), confirmation: async (page) => (await page.locator("body").innerText()).includes(service), recoveryUrl: "/referrals", roleState: statePath(credential("DOCTOR")) });
  return prisma.referralRequest.findFirstOrThrow({ where: { requestedService: service } });
}

async function action(browser: Browser, role: string, referralId: string, button: string, expected: string, fill?: (page: Page)=>Promise<void>) {
  const actor = await pageFor(browser, role);
  await actor.page.goto(`/referrals/${referralId}`, { waitUntil: "domcontentloaded" });
  if (fill) await fill(actor.page);
  await submitServerAction({ name: `${referralId}-${expected}`, role, browser, context: actor.context, page: actor.page, submit: actor.page.getByRole("button", { name: button }).last(), dbExpectation: async () => (await prisma.referralRequest.findUnique({ where: { id: referralId }, select: { status: true } }))?.status === expected, confirmation: async (page) => (await page.locator("body").innerText()).includes(expected === "REVIEWED" ? "تمت المراجعة" : expected === "SENT" ? "مُرسل" : expected === "READY" ? "جاهز" : expected === "ACCEPTED" ? "مقبولة داخلياً" : expected === "CANCELLED" ? "ملغاة" : "بانتظار كتاب الإرسال"), recoveryUrl: `/referrals/${referralId}`, roleState: statePath(credential(role)) });
}

async function externalCycle(browser: Browser, type: "RADIOLOGY"|"HOSPITAL", label: string) {
  const patient = await referralPatient(label);
  await checkIn(browser, patient);
  await residentReview(browser, patient);
  const row = await createReferral(browser, patient, type, "EXTERNAL", label);
  await action(browser,"DOCTOR",row.id,"إرسال إلى قائمة الطباعة","PENDING_PRINT");
  await action(browser,"DATA_ENTRY",row.id,"إنشاء الكتاب وتأكيد الجاهزية","READY",async(page)=>{const form=page.locator('form:has(button:has-text("إنشاء الكتاب"))').last();await form.locator('input[name="number"]').fill(`ACCEPTANCE-20260713-${RUN_ID}`);await form.locator('input[name="docDate"]').fill("2026-07-13");});
  await action(browser,"DATA_ENTRY",row.id,"تأكيد إرسال الطلب","SENT");
  const file=path.join(ROOT,`${RUN_ID}-${label}.pdf`);fs.writeFileSync(file,"%PDF-1.4\n% ACCEPTANCE SAFE RESULT\n");
  await action(browser,"DATA_ENTRY",row.id,"تسجيل وصول النتيجة","RESULT_RECEIVED",async(page)=>{const form=page.locator('form:has(button:has-text("تسجيل وصول النتيجة"))').last();await form.locator('textarea[name="resultSummary"]').fill("ACCEPTANCE-20260713 نتيجة تجريبية");await form.locator('input[type="file"]').setInputFiles(file);});
  await action(browser,"DOCTOR",row.id,"اعتماد مراجعة النتيجة","REVIEWED");
  await screenshot((await pageFor(browser,"DOCTOR")).page,`${label}-reviewed`);
}

test("الأشعة: الدورة الخارجية حتى REVIEWED", async({browser})=>{await externalCycle(browser,"RADIOLOGY","أشعة");});
test("المستشفى: الدورة الخارجية حتى REVIEWED", async({browser})=>{await externalCycle(browser,"HOSPITAL","مستشفى");});
test("الاختصاص الداخلي: READY ثم ACCEPTED وCareStage واحدة",async({browser})=>{const p=await referralPatient("اختصاص");const r=await createReferral(browser,p,"SPECIALIST","INTERNAL_SPECIALIST","اختصاص");await action(browser,"DOCTOR",r.id,"تجهيز الإحالة الداخلية","READY");await action(browser,"DOCTOR",r.id,"قبول الإحالة الداخلية","ACCEPTED");expect(await prisma.careStage.count({where:{patientId:p.id}})).toBe(1);const verify=await pageFor(browser,"DOCTOR");await verify.page.goto(`/referrals/${r.id}`);await expect(verify.page.getByRole("button",{name:"قبول الإحالة الداخلية"})).toHaveCount(0);await verify.context.close();expect(await prisma.careStage.count({where:{patientId:p.id}})).toBe(1);});
test("الإلغاء: CANCELLED نهائية مع السبب والمنفذ",async({browser})=>{const p=await referralPatient("إلغاء");const r=await createReferral(browser,p,"LAB","EXTERNAL","إلغاء");await action(browser,"DOCTOR",r.id,"إلغاء الطلب","CANCELLED",async(page)=>page.locator('input[name="cancellationReason"]').fill("ACCEPTANCE-20260713 سبب إلغاء"));const saved=await prisma.referralRequest.findUniqueOrThrow({where:{id:r.id}});expect(saved.cancelledById).toBeTruthy();expect(saved.cancellationReason).toContain("ACCEPTANCE");const verify=await pageFor(browser,"DOCTOR");await verify.page.goto(`/referrals/${r.id}`);await expect(verify.page.getByRole("button",{name:/إرسال|تجهيز|قبول|حذف/})).toHaveCount(0);await verify.context.close();});

test.afterAll(async()=>prisma.$disconnect());
