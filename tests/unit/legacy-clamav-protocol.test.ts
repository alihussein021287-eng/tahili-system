import { describe, expect, it } from "vitest";
import { parseClamAvStreamResponse } from "@/lib/collaboration-scan";

describe("legacy upload scanner protocol", () => {
  it("accepts only a complete clean ClamAV stream response", () => {
    expect(parseClamAvStreamResponse("stream: OK", "FAILED").status).toBe("SAFE");
    expect(parseClamAvStreamResponse("stream: Eicar-Test-Signature FOUND", "FAILED").status).toBe("REJECTED");
    for (const malformed of ["NOT OK", "stream: NOT OK", "stream: OK ERROR", "stream: scan error", "", "stream: OK\nstream: ERROR"]) {
      expect(parseClamAvStreamResponse(malformed, "FAILED").status).toBe("FAILED");
    }
  });
});
