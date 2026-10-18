import { describe, expect, it } from "vitest";
import { withSerializableRetry } from "@/lib/serializable-retry";

const conflict = () => Object.assign(new Error("write conflict"), { code: "P2034" });

describe("withSerializableRetry", () => {
  it("retries a serialization conflict and returns the later result", async () => {
    let calls = 0;
    const result = await withSerializableRetry(async () => { calls += 1; if (calls < 3) throw conflict(); return "ok"; });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the bounded number of retries", async () => {
    let calls = 0;
    await expect(withSerializableRetry(async () => { calls += 1; throw conflict(); }, 2)).rejects.toMatchObject({ code: "P2034" });
    expect(calls).toBe(3);
  });

  it("never retries an authorization or domain error", async () => {
    let calls = 0;
    await expect(withSerializableRetry(async () => { calls += 1; throw new Error("غير مصرح"); })).rejects.toThrow("غير مصرح");
    expect(calls).toBe(1);
  });
});
