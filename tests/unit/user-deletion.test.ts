import { describe, expect, it, vi } from "vitest";
import { userDeletionBlockers } from "@/lib/user-deletion";

describe("safe user deletion relation inventory", () => {
  it("returns every non-empty referencing table with its count", async () => {
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([
        { table_name: "audit_logs", column_name: "userId" },
        { table_name: "appointments", column_name: "assignedToId" },
      ]),
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([{ count: 3n }])
        .mockResolvedValueOnce([{ count: 0n }]),
    };
    await expect(userDeletionBlockers(db as any, "user-1")).resolves.toEqual([{ table: "audit_logs", count: 3 }]);
  });

  it("rejects unsafe database identifiers", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ table_name: "users;drop", column_name: "id" }]), $queryRawUnsafe: vi.fn() };
    await expect(userDeletionBlockers(db as any, "user-1")).rejects.toThrow("مرجع قاعدة بيانات غير صالح");
  });
});
