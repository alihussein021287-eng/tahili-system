import { describe, expect, it } from "vitest";
import { checkApiPermission } from "@/lib/api-permissions";
import { PermissionStoreUnavailableError } from "@/lib/permission-store";

describe("API permission decisions", () => {
  it("returns 403 only after a successful check without the permission", async () => {
    const result = await checkApiPermission("user-1", "VIEWER", "patients.export", async () => new Set());
    expect(result).toMatchObject({ allowed: false, status: 403 });
  });

  it("returns 503 when the permission store is unavailable", async () => {
    const result = await checkApiPermission("user-1", "VIEWER", "patients.export", async () => {
      throw new PermissionStoreUnavailableError();
    });
    expect(result).toMatchObject({ allowed: false, status: 503 });
  });

  it("allows only when the requested permission is present", async () => {
    const result = await checkApiPermission("user-1", "VIEWER", "patients.export", async () => new Set(["patients.export"]));
    expect(result.allowed).toBe(true);
  });

  it("allows when any one of the requested permissions is present", async () => {
    const result = await checkApiPermission(
      "user-1",
      "VIEWER",
      ["patients.view", "officialdocs.view"],
      async () => new Set(["officialdocs.view"]),
    );
    expect(result.allowed).toBe(true);
  });
});
