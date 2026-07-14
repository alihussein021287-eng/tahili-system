import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE_HALLS, queueHallNames } from "@/lib/queue";

describe("queue hall options", () => {
  it("keeps the built-in queue halls and removes duplicates", () => {
    const names = queueHallNames([DEFAULT_QUEUE_HALLS[0], "قاعة الهايبر", "قاعة الهايبر"]);
    expect(names).toEqual(expect.arrayContaining([...DEFAULT_QUEUE_HALLS, "قاعة الهايبر"]));
    expect(names.filter((name) => name === "قاعة الهايبر")).toHaveLength(1);
  });
});
