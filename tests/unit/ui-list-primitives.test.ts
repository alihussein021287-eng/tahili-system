import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { DataTable, ResultCount, StatusBadge, TableEmptyRow } from "@/components/Ui";

describe("list presentation primitives", () => {
  it("keeps large tables in a labeled keyboard-scrollable region", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable, {
        label: "قائمة اختبار",
        children: createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement("td", null, "صف")))),
      }),
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="قائمة اختبار"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("data-table-wrap");
  });

  it("renders descriptive empty rows without changing table columns", () => {
    const html = renderToStaticMarkup(
      createElement("table", null, createElement("tbody", null,
        createElement(TableEmptyRow, { colSpan: 7, title: "لا توجد سجلات", description: "غيّر الفلاتر." }))),
    );
    expect(html).toContain('colSpan="7"');
    expect(html).toContain("لا توجد سجلات");
    expect(html).toContain("غيّر الفلاتر.");
  });

  it("announces result counts and keeps status text alongside color", () => {
    const html = renderToStaticMarkup(
      createElement(Fragment, null,
        createElement(ResultCount, { count: 12, label: "حساب" }),
        createElement(StatusBadge, { tone: "success", children: "ناجح" })),
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("12 حساب");
    expect(html).toContain("ناجح");
    expect(html).toContain("badge-success");
  });
});
