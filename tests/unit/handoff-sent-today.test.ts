import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(app)/handoffs/actions", () => ({ cancelHandoffAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { HandoffSentToday, type SentTodayItem } from "@/components/handoffs/HandoffSentToday";

describe("HandoffSentToday", () => {
  it("shows the requested statuses and cancel controls only for SENT", () => {
    const statuses: SentTodayItem["status"][] = ["SENT", "ACCEPTED", "RETURNED", "CANCELLED", "DONE"];
    const items = statuses.map((status, index) => ({ id: String(index), patientName: `مراجع ${index}`, status, acceptorName: "نور الهدى عباس" }));
    const html = renderToStaticMarkup(createElement(HandoffSentToday, { items }));
    for (const label of ["ينتظر", "استُلم عند نور الهدى عباس", "أُرجع", "أُلغي", "انتهى"]) expect(html).toContain(label);
    expect(html.match(/إلغاء التحويلة/g)).toHaveLength(1);
  });
});
