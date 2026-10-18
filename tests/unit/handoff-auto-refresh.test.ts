// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { AutoRefresh } from "@/components/handoffs/AutoRefresh";

describe("AutoRefresh", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(async () => {
    vi.useFakeTimers();
    refresh.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { root.render(createElement(AutoRefresh)); });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.useRealTimers();
  });
  it("refreshes each minute only while visible", async () => {
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
