import { describe, expect, it } from "vitest";
import { APPROVED_REFERENCE_DATA, approvedReferenceCounts, assertApprovedReferenceData, isQaReferenceName } from "../../scripts/reference-data";

describe("approved reference data", () => {
  it("contains the reviewed baseline without QA names", () => {
    expect(() => assertApprovedReferenceData()).not.toThrow();
    expect(approvedReferenceCounts()).toMatchObject({ governorates: 19, districts: 208, centerHalls: 12, medications: 40, batches: 0, stockQuantity: 0 });
  });

  it("contains catalog metadata but no stock facts", () => {
    for (const medication of APPROVED_REFERENCE_DATA.medications) {
      expect(medication).toEqual(expect.objectContaining({ name: expect.any(String), unit: expect.any(String), minQuantity: expect.any(Number) }));
      expect(medication).not.toHaveProperty("quantity");
      expect(medication).not.toHaveProperty("batchNo");
    }
  });

  it("recognizes excluded QA markers", () => {
    expect(isQaReferenceName("ACCEPTANCE-20260713 دواء")).toBe(true);
    expect(isQaReferenceName("e2e-center")).toBe(true);
    expect(isQaReferenceName("مركز العلاج الطبيعي")).toBe(false);
  });
});
