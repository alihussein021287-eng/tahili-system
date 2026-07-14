import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE_HALLS, queueHallNames } from "@/lib/queue";

describe("queue hall options", () => {
  it("keeps the built-in queue halls and removes duplicates", () => {
    const names = queueHallNames([DEFAULT_QUEUE_HALLS[0], "قاعة الهايبر", "قاعة الهايبر"]);
    expect(names).toEqual(expect.arrayContaining([...DEFAULT_QUEUE_HALLS, "قاعة الهايبر"]));
    expect(names.filter((name) => name === "قاعة الهايبر")).toHaveLength(1);
  });

  it("hides acceptance-test hall names from the user interface", () => {
    const names = queueHallNames(["ACCEPTANCE-20260713 قاعة علاج", "قاعة علاج طبيعي"]);
    expect(names).not.toContain("ACCEPTANCE-20260713 قاعة علاج");
    expect(names).toContain("قاعة علاج طبيعي");
  });
});
