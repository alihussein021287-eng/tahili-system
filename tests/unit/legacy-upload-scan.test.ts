import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveFile } from "@/lib/storage";

const mocks = vi.hoisted(() => ({ scan: vi.fn(), write: vi.fn(), mkdir: vi.fn() }));
vi.mock("@/lib/collaboration-scan", () => ({ scanBufferWithClamAv: mocks.scan }));
vi.mock("@/lib/admin-config", () => ({ getAdminConfig: async () => ({ fileTypes: ["pdf"], blockedFileTypes: [], maxUploadMb: 2 }) }));
vi.mock("fs", () => ({ existsSync: () => true }));
vi.mock("fs/promises", () => ({ writeFile: mocks.write, mkdir: mocks.mkdir, readFile: vi.fn() }));

const file = (body: string) => new File([body], "safe.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.write.mockResolvedValue(undefined);
});

describe("legacy upload ClamAV boundary", () => {
  it("writes the exact clean bytes only after a SAFE result", async () => {
    mocks.scan.mockResolvedValue({ status: "SAFE", engine: "clamav", detail: "OK" });
    await expect(saveFile(file("%PDF-1.7 clean"))).resolves.toMatchObject({ name: "safe.pdf" });
    expect(mocks.scan).toHaveBeenCalledWith(Buffer.from("%PDF-1.7 clean"));
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][1]).toEqual(Buffer.from("%PDF-1.7 clean"));
    expect(mocks.write.mock.calls[0][2]).toEqual({ flag: "wx" });
  });

  it.each(["REJECTED", "FAILED", "PENDING_SCAN"])("does not publish a %s scan result", async (status) => {
    mocks.scan.mockResolvedValue({ status, engine: "clamav", detail: "test" });
    await expect(saveFile(file("%PDF-1.7 EICAR-STANDARD-ANTIVIRUS-TEST-FILE"))).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("fails closed if the scanner throws", async () => {
    mocks.scan.mockRejectedValue(new Error("scanner outage"));
    await expect(saveFile(file("%PDF-1.7 clean"))).rejects.toThrow("scanner outage");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
