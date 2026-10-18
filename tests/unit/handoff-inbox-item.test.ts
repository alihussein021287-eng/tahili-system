// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HandoffInboxItem, type HandoffInboxItemData } from "@/components/handoffs/HandoffInboxItem";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), accept: vi.fn(), returned: vi.fn(), finish: vi.fn(), cancel: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: any) => createElement("a", { href, ...props }, children) }));
vi.mock("@/components/handoffs/HandoffDialog", () => ({ HandoffDialog: () => createElement("button", { type: "button" }, "حوّل إلى") }));
vi.mock("@/components/handoffs/HandoffRedirectForm", () => ({ HandoffRedirectForm: () => createElement("form", { "data-testid": "redirect-form" }, "إعادة توجيه داخل نفس المركز") }));
vi.mock("@/app/(app)/handoffs/actions", () => ({
  acceptHandoffAction: mocks.accept, returnHandoffAction: mocks.returned,
  finishHandoffAction: mocks.finish, cancelHandoffAction: mocks.cancel,
}));

const item: HandoffInboxItemData = {
  id: "handoff-1", patientId: "patient-1", patientName: "علي حسين", fileNumber: 123,
  senderName: "زينب كاظم", fromRole: "RECEPTION", toRole: "DOCTOR",
  fromCenterId: null, toCenterId: 2, toCenterName: "مركز بغداد", status: "SENT",
  sentAt: "2026-10-09T09:00:00.000Z", note: "متابعة الحالة",
};
let container: HTMLDivElement;
let root: Root;

async function render(overrides: Partial<HandoffInboxItemData> = {}, canSend = true, canCancel = false, canRedirect = false) {
  await act(async () => {
    root.render(createElement(HandoffInboxItem, {
      item: { ...item, ...overrides }, canSend, canCancel, canRedirect, now: "2026-10-09T10:00:00.000Z",
    }));
  });
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((element) => element.textContent === label);
  expect(found, `button ${label}`).toBeTruthy();
  return found!;
}

async function typeReason(value: string) {
  const field = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(label: string) {
  await act(async () => { button(label).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accept.mockResolvedValue({ ok: true });
  mocks.returned.mockResolvedValue({ ok: true });
  mocks.finish.mockResolvedValue({ ok: true });
  mocks.cancel.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("handoff inbox item", () => {
  it("links the patient and shows the target center, note and delay", async () => {
    await render();
    expect(container.querySelector('a[href="/patients/patient-1"]')?.textContent).toBe("علي حسين");
    expect(container.textContent).toContain("مركز بغداد");
    expect(container.textContent).toContain("متابعة الحالة");
    expect(container.textContent).toContain("ينتظر منذ 1 ساعة");
    button("استلمت");
  });

  it("reveals the labeled reason field only after return and can cancel without losing typed text", async () => {
    await render({ status: "ACCEPTED", acceptedAt: "2026-10-09T09:30:00.000Z" });
    expect(container.querySelector("textarea")).toBeNull();
    button("إنهاء");
    await click("إرجاع");
    const field = container.querySelector("textarea")!;
    expect(field.labels?.[0]?.textContent).toBe("سبب الإرجاع");
    expect(field.required).toBe(true);
    await typeReason("بيانات ناقصة");
    button("تأكيد الإرجاع");
    await click("إلغاء");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("marks a returned handoff and shows its prior reason", async () => {
    await render({ isReturn: true, previousReturnReason: "بيانات ناقصة" });
    expect(container.textContent).toContain("مُرجَع");
    expect(container.textContent).toContain("سبب الإرجاع: بيانات ناقصة");
  });

  it("refreshes after acceptance and shows finish controls immediately", async () => {
    await render();
    await click("استلمت");
    expect(mocks.accept).toHaveBeenCalledWith("handoff-1");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    button("إنهاء");
    expect(container.textContent).not.toContain("جارٍ الاستلام");
  });

  it("removes a finished handoff immediately instead of leaving a stale success card", async () => {
    await render({ status: "ACCEPTED" });
    await click("إنهاء");
    expect(mocks.finish).toHaveBeenCalledWith("handoff-1");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("");
  });

  it("shows action errors and re-enables controls", async () => {
    mocks.accept.mockResolvedValue({ ok: false, error: "استلمها شخص آخر" });
    await render();
    await click("استلمت");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("استلمها شخص آخر");
    expect(button("استلمت").disabled).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps the entered return reason on an action error and clears it after success", async () => {
    mocks.returned.mockResolvedValueOnce({ ok: false, error: "تعذر إكمال الإجراء" }).mockResolvedValueOnce({ ok: true });
    await render({ status: "ACCEPTED" });
    await click("إرجاع");
    await typeReason("بيانات ناقصة");
    await click("تأكيد الإرجاع");
    expect(mocks.returned).toHaveBeenCalledWith("handoff-1", "بيانات ناقصة");
    expect(container.querySelector("textarea")?.value).toBe("بيانات ناقصة");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("تعذر إكمال الإجراء");
    expect(button("تأكيد الإرجاع").disabled).toBe(false);
    await click("تأكيد الإرجاع");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain("تم إرجاع التحويلة");
  });

  it("offers cancellation only to an eligible viewer and refreshes after it", async () => {
    await render({}, true, false);
    expect(container.textContent).not.toContain("إلغاء التحويلة");
    await render({}, true, true);
    await click("إلغاء التحويلة");
    expect(mocks.cancel).toHaveBeenCalledWith("handoff-1");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("تم إلغاء التحويلة");
  });

  it("offers redirect of a waiting handoff only to an eligible viewer, inline", async () => {
    await render({}, true, false, false);
    expect([...container.querySelectorAll("button")].some((element) => element.textContent === "إعادة توجيه")).toBe(false);
    await render({}, true, false, true);
    expect(container.querySelector('[data-testid="redirect-form"]')).toBeNull();
    await act(async () => { button("إعادة توجيه").click(); });
    expect(container.querySelector('[data-testid="redirect-form"]')).not.toBeNull();
    await render({ status: "ACCEPTED", acceptedAt: "2026-10-09T09:30:00.000Z" }, true, false, true);
    expect([...container.querySelectorAll("button")].some((element) => element.textContent === "إعادة توجيه")).toBe(false);
  });
});
