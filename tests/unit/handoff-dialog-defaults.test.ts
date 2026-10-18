import { describe, expect, it } from "vitest";
import { defaultHandoffSelectionMode, handoffEmptyTargetMessage, handoffTargetIsAvailable } from "@/components/handoffs/dialog-defaults";

describe("handoff dialog defaults", () => {
  it.each(["RESIDENT", "SECRETARY", "RECEPTION", "DATA_ENTRY"] as const)("defaults %s to any available", (role) => {
    expect(defaultHandoffSelectionMode(role)).toBe("any");
  });

  it.each(["DOCTOR", "HEAD_THERAPIST", "THERAPIST"] as const)("defaults %s to by name", (role) => {
    expect(defaultHandoffSelectionMode(role)).toBe("byName");
  });

  it("blocks center submission when no matching members exist or the list is loading", () => {
    expect(handoffTargetIsAvailable(false, false, 0)).toBe(false);
    expect(handoffEmptyTargetMessage("DOCTOR", true, false, 0)).toBe("هذا المركز ما بيه طبيب اختصاص");
    expect(handoffTargetIsAvailable(false, true, 1)).toBe(false);
    expect(handoffTargetIsAvailable(false, false, 1)).toBe(true);
    expect(handoffTargetIsAvailable(true, false, 0)).toBe(true);
  });
});
