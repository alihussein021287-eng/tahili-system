// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { PatientHandoffJourney } from "@/components/handoffs/PatientHandoffJourney";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/handoffs/HandoffDialog", () => ({ HandoffDialog: () => createElement("button", { type: "button" }, "حوّل إلى") }));
vi.mock("@/app/(app)/handoffs/actions", () => ({ acceptHandoffAction: vi.fn(), cancelHandoffAction: vi.fn(), finishHandoffAction: vi.fn() }));
let container: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(overrides: Partial<ComponentProps<typeof PatientHandoffJourney>> = {}) {
  await act(async () => root.render(createElement(PatientHandoffJourney, { step: null, handoffId: null, patientId: "synthetic", patientName: "Synthetic", fileNumber: "1", autoOpen: false, canSend: true, canAccept: false, canFinish: false, canCancel: false, path: [], next: null, historyAvailable: false, ...overrides })));
}
describe("reception: unavailable history is not an absent handoff", () => {
  it("does not claim no open handoff when journey data is not authorized", async () => { await render(); expect(container.textContent).not.toContain("لا توجد تحويلة مفتوحة"); expect(container.textContent).toContain("حالة التسليم غير معروضة هنا"); expect(container.querySelector('a[href="/my-work"]')).toBeTruthy(); });
  it("does not infer a completed clinical path from withheld history", async () => { await render(); expect(container.textContent).not.toContain("اكتمل المسار"); expect(container.querySelector('ol[aria-label="مراحل مسار المراجع"]')).toBeNull(); });
  it("keeps the send action without exposing hidden history or enabling transitions", async () => { await render(); expect(container.textContent).toContain("حوّل إلى"); expect(container.textContent).not.toContain("استلمت"); expect(container.textContent).not.toContain("إنهاء"); });
  it("preserves the empty state when history was actually loaded", async () => { await render({ historyAvailable: true }); expect(container.textContent).toContain("لا توجد تحويلة مفتوحة"); expect(container.textContent).not.toContain("حالة التسليم غير معروضة هنا"); });
  it("preserves an authorized accepted holder", async () => { await render({ historyAvailable: true, step: { holderText: "Synthetic secretary", centerName: "Synthetic center", sinceText: "مستلم منذ دقيقة", status: "ACCEPTED" } }); expect(container.textContent).toContain("Synthetic secretary"); expect(container.textContent).not.toContain("لا توجد تحويلة مفتوحة"); });
  it("binds visibility to existing page permissions without widening them", () => { const page = readFileSync("src/app/(app)/patients/[id]/page.tsx", "utf8"); expect(page).toContain('historyAvailable={isSecretary || perms.has("journey.view")}'); expect(page).toContain('!isSecretary && perms.has("journey.view") ? prisma.patientHandoff.findMany'); });
});
