import { describe, expect, it } from "vitest";
import { normalizeArabicName, verifyDocumentDetails } from "@/lib/identity-verification";

const stored = { birthDate: new Date("1985-03-15T00:00:00.000Z"), motherName: "فاطمة عبد الله" };

describe("physical document attestation matching", () => {
  it("accepts the registered birth date and mother's name, ignoring spacing and letter variants", () => {
    expect(verifyDocumentDetails(stored, { birthDate: "1985-03-15", motherName: "  فاطمه   عبد الله " })).toBe("OK");
    expect(verifyDocumentDetails({ ...stored, motherName: "أمينة محمد" }, { birthDate: "1985-03-15", motherName: "امينه محمد" })).toBe("OK");
  });
  it("refuses a wrong date or a wrong name", () => {
    expect(verifyDocumentDetails(stored, { birthDate: "1985-03-16", motherName: "فاطمة عبد الله" })).toBe("MISMATCH");
    expect(verifyDocumentDetails(stored, { birthDate: "1985-03-15", motherName: "زينب عبد الله" })).toBe("MISMATCH");
  });
  it("fails safely when the stored record cannot support a comparison", () => {
    expect(verifyDocumentDetails({ birthDate: null, motherName: "فاطمة عبد الله" }, { birthDate: "1985-03-15", motherName: "فاطمة عبد الله" })).toBe("INSUFFICIENT_RECORD");
    expect(verifyDocumentDetails({ birthDate: stored.birthDate, motherName: null }, { birthDate: "1985-03-15", motherName: "x" })).toBe("INSUFFICIENT_RECORD");
    expect(verifyDocumentDetails({ birthDate: stored.birthDate, motherName: "  " }, { birthDate: "1985-03-15", motherName: "فاطمة" })).toBe("INSUFFICIENT_RECORD");
  });
  it("refuses missing or malformed entered details", () => {
    expect(verifyDocumentDetails(stored, { birthDate: "", motherName: "فاطمة عبد الله" })).toBe("MISSING_INPUT");
    expect(verifyDocumentDetails(stored, { birthDate: "15/03/1985", motherName: "فاطمة عبد الله" })).toBe("MISSING_INPUT");
    expect(verifyDocumentDetails(stored, { birthDate: "1985-03-15", motherName: "" })).toBe("MISSING_INPUT");
  });
  it("normalizes Arabic names consistently", () => {
    expect(normalizeArabicName("إِبراهيم")).toBe(normalizeArabicName("ابراهيم"));
    expect(normalizeArabicName("مُحمّد")).toBe(normalizeArabicName("محمد"));
  });
});
