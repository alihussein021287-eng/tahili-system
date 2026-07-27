import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/db";
import { closeChecked, pageFor } from "./acceptance/helpers";

async function patientAwaitingResidentReview() {
  return prisma.patient.findFirstOrThrow({
    where: {
      status: "ACTIVE",
      visits: { some: {} },
      residentReviews: { none: {} },
      OR: [
        { notes: { contains: "QA", mode: "insensitive" } },
        { notes: { contains: "ACCEPTANCE", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

test("resident-review next step opens the resident tab without mutating the patient", async ({ browser }) => {
  const patient = await patientAwaitingResidentReview();
  const { context, page, errors } = await pageFor(browser, "ADMIN");

  await page.goto(`/patients/${patient.id}?tab=overview`);
  await expect(page.getByText("توجد زيارة بلا مراجعة مقيم مسجلة.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "الانتقال إلى التبويب" }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}\\?tab=resident$`));
  await expect(page.getByRole("heading", { name: "الطبيب المقيم", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`tab=resident$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`tab=overview$`));
  await closeChecked(context, errors);
});

test("role access keeps the resident action behind clinical.metrics", async ({ browser }) => {
  const patient = await patientAwaitingResidentReview();

  const reception = await pageFor(browser, "RECEPTION");
  await reception.page.goto(`/patients/${patient.id}?tab=overview`);
  await expect(reception.page.getByText("لا يملك حسابك هذا الإجراء", { exact: false })).toBeVisible();
  await expect(reception.page.getByRole("link", { name: "الانتقال إلى التبويب" })).toHaveCount(0);
  await reception.page.goto(`/patients/${patient.id}?tab=resident`);
  await expect(reception.page.getByRole("heading", { name: "الطبيب المقيم", exact: true })).toBeVisible();
  await expect(reception.page.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" })).toHaveCount(0);
  await closeChecked(reception.context, reception.errors);

  const resident = await pageFor(browser, "RESIDENT");
  await resident.page.goto(`/patients/${patient.id}?tab=resident`);
  await expect(resident.page.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" })).toBeVisible();
  await closeChecked(resident.context, resident.errors);

  const viewer = await pageFor(browser, "VIEWER");
  await viewer.page.goto(`/patients/${patient.id}?tab=resident`);
  await expect(viewer.page.getByRole("button", { name: "حفظ تقييم الطبيب المقيم" })).toHaveCount(0);
  await closeChecked(viewer.context, viewer.errors);
});
