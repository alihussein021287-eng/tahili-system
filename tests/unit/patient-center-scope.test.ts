import { describe, it, expect } from "vitest";
import { patientCenterScope } from "@/lib/patient-center-scope";

describe("patient center scope parity", () => {
  const rows = [{ centerId: 1 }, { centerId: 2 }, { centerId: null }];
  it("central bypass", () => expect(patientCenterScope(rows, new Set<number>(), true, true)).toEqual(rows));
  it("active member and unassigned plan", () => expect(patientCenterScope(rows, new Set([1]), false, true)).toEqual([rows[0], rows[2]]));
  it("foreign/no membership and program scope", () => expect(patientCenterScope(rows, new Set<number>(), false)).toEqual([]));
});
