import "dotenv/config";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import { clinicalPatient } from "./fixture-factory";
import { credential, pageFor, RUN_ID, screenshot, statePath } from "./helpers";
import { submitServerAction } from "./resilient-action";

test.describe.configure({ mode: "serial", timeout: 180_000 });

async function pharmacyFixtures() {
  const supplier = await prisma.supplier.upsert({
    where: { name: `ACCEPTANCE-20260713 ${RUN_ID} مورد صيدلية` },
    update: {},
    create: { name: `ACCEPTANCE-20260713 ${RUN_ID} مورد صيدلية`, phone: "07800000000", note: "ACCEPTANCE-20260713" },
  });
  const medB = await prisma.medication.create({ data: { name: `ACCEPTANCE-20260713 ${RUN_ID} مستلزم قبول`, quantity: 0, minQuantity: 1, unit: "قطعة" } });
  return { supplier, medB };
}

async function pickCombo(scope: Page | Locator, index: number, text: string) {
  const input = scope.locator('input[role="combobox"]').nth(index);
  await input.click();
  await input.fill("");
  const option = scope.getByRole("button", { name: text }).first();
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

async function createMedicationViaInventory(browser: Browser) {
  const name = `ACCEPTANCE-20260713 ${RUN_ID} دواء FEFO`;
  const actor = await pageFor(browser, "PHARMACIST");
  await actor.page.goto("/inventory", { waitUntil: "domcontentloaded" });
  const form = actor.page.locator('form:has(button:has-text("إضافة للمخزون"))').first();
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="quantity"]').fill("0");
  await form.locator('input[name="minQuantity"]').fill("2");
  await form.locator('input[name="unit"]').fill("حبة");
  await submitServerAction({
    name: "pharmacy-medication-create",
    role: "PHARMACIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "إضافة للمخزون" }),
    dbExpectation: async () => Boolean(await prisma.medication.findUnique({ where: { name } })),
    confirmation: async (page) => (await page.locator("body").innerText()).includes(name),
    recoveryUrl: "/inventory",
    roleState: statePath(credential("PHARMACIST")),
  });
  return prisma.medication.findUniqueOrThrow({ where: { name } });
}

async function createOrder(browser: Browser, supplierId: number) {
  const actor = await pageFor(browser, "PHARMACIST");
  await actor.page.goto("/pharmacy/purchases", { waitUntil: "domcontentloaded" });
  const form = actor.page.locator('form:has(button:has-text("إنشاء المسودة"))');
  await form.locator('select[name="supplierId"]').selectOption(String(supplierId));
  await form.locator('input[name="expectedDeliveryDate"]').fill("2026-07-20");
  await form.locator('textarea[name="notes"]').fill(`ACCEPTANCE-20260713 ${RUN_ID} أمر شراء`);
  await submitServerAction({
    name: "pharmacy-purchase-create",
    role: "PHARMACIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "إنشاء المسودة" }),
    dbExpectation: async () => Boolean(await prisma.purchaseOrder.findFirst({ where: { supplierId, notes: { contains: RUN_ID } } })),
    confirmation: async (page) => (await page.locator("body").innerText()).includes("مسودة"),
    recoveryUrl: "/pharmacy/purchases",
    roleState: statePath(credential("PHARMACIST")),
  });
  return prisma.purchaseOrder.findFirstOrThrow({ where: { supplierId, notes: { contains: RUN_ID } }, orderBy: { createdAt: "desc" } });
}

async function addItem(browser: Browser, orderId: string, medicationId: number, ordered: number, batchNo: string, expiryDate: string) {
  const medication = await prisma.medication.findUniqueOrThrow({ where: { id: medicationId } });
  const actor = await pageFor(browser, "PHARMACIST");
  await actor.page.goto(`/pharmacy/purchases/${orderId}`, { waitUntil: "domcontentloaded" });
  const form = actor.page.locator('form:has(button:has-text("إضافة البند"))');
  await form.locator('select[name="medicationId"]').selectOption(String(medicationId));
  await form.locator('input[name="unit"]').fill("حبة");
  await form.locator('input[name="orderedQuantity"]').fill(String(ordered));
  if (await form.locator('input[name="unitPrice"]').count()) await form.locator('input[name="unitPrice"]').fill("10");
  await form.locator('input[name="batchNo"]').fill(batchNo);
  await form.locator('input[name="expiryDate"]').fill(expiryDate);
  await submitServerAction({
    name: `pharmacy-purchase-item-${batchNo}`,
    role: "PHARMACIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "إضافة البند" }),
    dbExpectation: async () => Boolean(await prisma.purchaseOrderItem.findFirst({ where: { purchaseOrderId: orderId, medicationId, batchNo } })),
    confirmation: async (page) => (await page.locator("body").innerText()).includes(medication.name),
    recoveryUrl: `/pharmacy/purchases/${orderId}`,
    roleState: statePath(credential("PHARMACIST")),
  });
  return prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: orderId, medicationId, batchNo } });
}

async function transitionOrder(browser: Browser, role: "PHARMACIST" | "MANAGER", orderId: string, button: string, expected: string) {
  const actor = await pageFor(browser, role);
  await actor.page.goto(`/pharmacy/purchases/${orderId}`, { waitUntil: "domcontentloaded" });
  await submitServerAction({
    name: `pharmacy-order-${expected}`,
    role,
    browser,
    context: actor.context,
    page: actor.page,
    submit: actor.page.getByRole("button", { name: button }),
    dbExpectation: async () => (await prisma.purchaseOrder.findUnique({ where: { id: orderId } }))?.status === expected,
    confirmation: async (page) => (await page.locator("body").innerText()).includes(expected === "APPROVED" ? "معتمد" : expected === "PENDING_APPROVAL" ? "بانتظار الاعتماد" : "مطلوب من المورد"),
    recoveryUrl: `/pharmacy/purchases/${orderId}`,
    roleState: statePath(credential(role)),
  });
}

async function receiveItem(browser: Browser, orderId: string, itemId: string, accepted: number, batchNo: string, expiryDate: string, expectedStatus: string) {
  const before = await prisma.purchaseReceipt.count({ where: { purchaseOrderId: orderId } });
  const item = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: itemId }, include: { medication: true } });
  const actor = await pageFor(browser, "PHARMACIST");
  await actor.page.goto(`/pharmacy/purchases/${orderId}`, { waitUntil: "domcontentloaded" });
  const article = actor.page.locator(`article:has(form):has-text("${item.medication.name}")`).first();
  const form = article.locator('form:has(button:has-text("تسجيل الاستلام"))');
  await form.locator('input[name="acceptedQuantity"]').fill(String(accepted));
  await form.locator('input[name="rejectedQuantity"]').fill("0");
  await form.locator('input[name="damagedQuantity"]').fill("0");
  await form.locator('input[name="batchNo"]').fill(batchNo);
  await form.locator('input[name="expiryDate"]').fill(expiryDate);
  await submitServerAction({
    name: `pharmacy-receive-${batchNo}-${accepted}`,
    role: "PHARMACIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "تسجيل الاستلام" }),
    dbExpectation: async () => (await prisma.purchaseReceipt.count({ where: { purchaseOrderId: orderId } })) === before + 1,
    confirmation: async (page) => (await page.locator("body").innerText()).includes(expectedStatus === "FULLY_RECEIVED" ? "مستلم بالكامل" : "مستلم جزئياً"),
    recoveryUrl: `/pharmacy/purchases/${orderId}`,
    roleState: statePath(credential("PHARMACIST")),
  });
}

async function createInternalPrescription(browser: Browser, patientId: string, medicationId: number) {
  const actor = await pageFor(browser, "DOCTOR");
  await actor.page.goto(`/patients/${patientId}`, { waitUntil: "domcontentloaded" });
  await actor.page.locator("button").filter({ hasText: "الوصفات والتجهيز" }).last().click();
  const form = actor.page.locator('form:has(input[name="prescriptionType"])');
  await pickCombo(form, 0, "داخلية من صيدلية المجمع");
  const medication = await prisma.medication.findUniqueOrThrow({ where: { id: medicationId } });
  await pickCombo(form, 1, medication.name);
  await form.locator('input[name="usage"]').fill("مرتين يومياً");
  await form.locator('input[name="quantity"]').fill("2");
  await form.locator('input[name="duration"]').fill("يوم واحد");
  await form.locator('input[name="doctor"]').fill("ACCEPTANCE-20260713 DOCTOR");
  await submitServerAction({
    name: "pharmacy-rx-create",
    role: "DOCTOR",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "إضافة" }),
    dbExpectation: async () => Boolean(await prisma.prescription.findFirst({ where: { patientId, medicationId, prescriptionType: "INTERNAL" } })),
    confirmation: async (page) => (await page.locator("body").innerText()).includes(medication.name),
    recoveryUrl: `/patients/${patientId}`,
    roleState: statePath(credential("DOCTOR")),
  });
  return prisma.prescription.findFirstOrThrow({ where: { patientId, medicationId, prescriptionType: "INTERNAL" }, orderBy: { prescribedAt: "desc" } });
}

async function dispense(browser: Browser, patientName: string, prescriptionId: string) {
  const actor = await pageFor(browser, "PHARMACIST");
  await actor.page.goto("/pharmacy", { waitUntil: "domcontentloaded" });
  await actor.page.getByText(patientName).click();
  const form = actor.page.locator('form:has(button:has-text("تجهيز كامل"))').first();
  await submitServerAction({
    name: "pharmacy-rx-dispense",
    role: "PHARMACIST",
    browser,
    context: actor.context,
    page: actor.page,
    submit: form.getByRole("button", { name: "تجهيز كامل" }),
    dbExpectation: async () => (await prisma.prescription.findUnique({ where: { id: prescriptionId } }))?.status === "DISPENSED",
    confirmation: async (page) => !(await page.locator("body").innerText()).includes(patientName),
    recoveryUrl: "/pharmacy",
    roleState: statePath(credential("PHARMACIST")),
  });
}

test("workflow 20: purchase, split receipts, FEFO dispense, shortages and idempotency", async ({ browser }) => {
  const { supplier, medB } = await pharmacyFixtures();
  const medA = await createMedicationViaInventory(browser);
  const order = await createOrder(browser, supplier.id);
  const itemA = await addItem(browser, order.id, medA.id, 8, `${RUN_ID}-FEFO-A`, "2026-08-01");
  const itemB = await addItem(browser, order.id, medB.id, 4, `${RUN_ID}-ITEM-B`, "2027-01-01");
  await transitionOrder(browser, "PHARMACIST", order.id, "إرسال للاعتماد", "PENDING_APPROVAL");
  await transitionOrder(browser, "MANAGER", order.id, "اعتماد الأمر", "APPROVED");

  await receiveItem(browser, order.id, itemA.id, 3, `${RUN_ID}-FEFO-A`, "2026-08-01", "PARTIALLY_RECEIVED");
  let savedA = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: itemA.id } });
  expect(savedA.receivedQuantity).toBe(3);
  expect(savedA.orderedQuantity - savedA.receivedQuantity).toBe(5);
  expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PARTIALLY_RECEIVED");
  expect(await prisma.medicationBatch.count({ where: { purchaseItemId: itemA.id } })).toBe(1);
  expect(await prisma.stockMovement.count({ where: { medicationId: medA.id, type: "IN", purchaseReceiptId: { not: null } } })).toBe(1);

  await receiveItem(browser, order.id, itemB.id, 4, `${RUN_ID}-ITEM-B`, "2027-01-01", "PARTIALLY_RECEIVED");
  await receiveItem(browser, order.id, itemA.id, 5, `${RUN_ID}-FEFO-A2`, "2026-12-01", "FULLY_RECEIVED");
  expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("FULLY_RECEIVED");
  const receiptsAfterFull = await prisma.purchaseReceipt.count({ where: { purchaseOrderId: order.id } });
  const noRepeat = await pageFor(browser, "PHARMACIST");
  await noRepeat.page.goto(`/pharmacy/purchases/${order.id}`, { waitUntil: "domcontentloaded" });
  await expect(noRepeat.page.getByRole("button", { name: "تسجيل الاستلام" })).toHaveCount(0);
  await noRepeat.context.close();
  expect(await prisma.purchaseReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(receiptsAfterFull);

  await prisma.medicationBatch.create({ data: { medicationId: medA.id, supplierId: supplier.id, batchNo: `${RUN_ID}-EXPIRED`, quantity: 5, expiryDate: new Date("2026-01-01") } });
  const patient = await clinicalPatient("صيدلية شراء وصرف", true);
  const rx = await createInternalPrescription(browser, patient.id, medA.id);
  await dispense(browser, patient.fullName, rx.id);
  const dispensed = await prisma.stockMovement.findFirstOrThrow({ where: { prescriptionId: rx.id, type: "DISPENSE" }, orderBy: { createdAt: "asc" } });
  const dispensedBatch = dispensed.batchId ? await prisma.medicationBatch.findUnique({ where: { id: dispensed.batchId } }) : null;
  expect(dispensedBatch?.batchNo).toBe(`${RUN_ID}-FEFO-A`);
  expect(await prisma.stockMovement.count({ where: { prescriptionId: rx.id, type: "DISPENSE" } })).toBe(1);
  expect((await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } })).dispensedQty).toBe(2);

  const queueAfter = await pageFor(browser, "PHARMACIST");
  await queueAfter.page.goto("/pharmacy", { waitUntil: "domcontentloaded" });
  await expect(queueAfter.page.getByText(patient.fullName)).toHaveCount(0);
  await queueAfter.context.close();

  const shortagePatient = await clinicalPatient("صيدلية نقص", true);
  const shortageRx = await prisma.prescription.create({ data: { patientId: shortagePatient.id, medicationId: medA.id, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", eligibilityReason: "ACCEPTANCE-20260713", eligibilityRecordedAt: new Date(), quantity: "999", count: 999, usage: "اختبار نقص", doctor: "ACCEPTANCE-20260713 DOCTOR", createdById: (await prisma.user.findUniqueOrThrow({ where: { username: "acceptance-20260713-doctor" } })).id } });
  const shortage = await pageFor(browser, "PHARMACIST");
  await shortage.page.goto("/pharmacy", { waitUntil: "domcontentloaded" });
  await shortage.page.getByText(shortagePatient.fullName).click();
  const result = await submitServerAction({
    name: "pharmacy-shortage-denied",
    role: "PHARMACIST",
    browser,
    context: shortage.context,
    page: shortage.page,
    submit: shortage.page.locator('form:has(button:has-text("تجهيز كامل"))').first().getByRole("button", { name: "تجهيز كامل" }),
    dbExpectation: async () => (await prisma.prescription.findUnique({ where: { id: shortageRx.id } }))?.status === "DISPENSED",
    confirmation: async () => false,
    recoveryUrl: "/pharmacy",
    roleState: statePath(credential("PHARMACIST")),
  });
  expect(result.status).toBe("FAIL");
  expect(await prisma.stockMovement.count({ where: { prescriptionId: shortageRx.id } })).toBe(0);

  const reports = await pageFor(browser, "PHARMACIST");
  await reports.page.goto("/pharmacy/purchases/reports", { waitUntil: "domcontentloaded" });
  await expect(reports.page.getByText("تقارير الشراء والاستلام والمخزون")).toBeVisible();
  await reports.page.goto("/pharmacy/reports", { waitUntil: "domcontentloaded" });
  await expect(reports.page.getByText(`${RUN_ID}-EXPIRED`)).toBeVisible();
  await screenshot(reports.page, "pharmacy-purchase-dispense");
  await reports.context.close();
});

test.afterAll(async () => prisma.$disconnect());
