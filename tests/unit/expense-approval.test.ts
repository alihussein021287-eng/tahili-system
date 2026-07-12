import { describe, expect, it } from "vitest";
import { assertDistinctExpenseApprover } from "@/lib/expense-approval";

describe("wounded expense multi-level approval separation", () => {
  it("allows a user who has not approved this expense", () => {
    expect(() => assertDistinctExpenseApprover([{ userId: "manager-1" }], "manager-2"))
      .not.toThrow();
  });

  it("prevents the same user from approving a second level", () => {
    expect(() => assertDistinctExpenseApprover([{ userId: "manager-1" }], "manager-1"))
      .toThrow("لا يجوز للمستخدم اعتماد أكثر من مستوى للصرفية نفسها");
  });
});
