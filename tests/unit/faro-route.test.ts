import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ access: vi.fn(() => ({ origin: "http://192.168.17.20:3000" })), enabled: vi.fn(() => true), sanitize: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/environment-access", () => ({ resolveEnvironmentAccess: mocks.access }));
vi.mock("@/lib/faro", () => ({ faroEnabled: mocks.enabled, sanitizeFaroEnvelope: mocks.sanitize }));
const valid = { meta: {}, events: [{ name: "stage6b_pipeline_check" }] };
function request(body: unknown = valid, headers: Record<string,string> = {}) { return new NextRequest("http://192.168.17.20:3000/api/observability/faro", { method:"POST", headers:{"content-type":"application/json",origin:"http://192.168.17.20:3000",...headers}, body: typeof body === "string" ? body : JSON.stringify(body) }); }
describe.sequential("Faro adapter", () => {
  beforeEach(async()=>{vi.resetModules(); mocks.access.mockReset(); mocks.enabled.mockReset(); mocks.sanitize.mockReset(); mocks.fetch.mockReset(); mocks.access.mockReturnValue({origin:"http://192.168.17.20:3000"});mocks.enabled.mockReturnValue(true);mocks.sanitize.mockReturnValue(valid);mocks.fetch.mockResolvedValue({ok:true});vi.stubGlobal("fetch",mocks.fetch);});
  it("accepts sanitized post and never logs its body", async()=>{const {POST}=await import("@/app/api/observability/faro/route");expect((await POST(request())).status).toBe(202);expect(mocks.fetch).toHaveBeenCalled();});
  it("returns 204 without forwarding an empty envelope",async()=>{mocks.sanitize.mockReturnValue({meta:{}});const {POST}=await import("@/app/api/observability/faro/route");expect((await POST(request())).status).toBe(204);expect(mocks.fetch).not.toHaveBeenCalled();});
  it("rejects disabled, invalid origin, type, json and size",async()=>{const {POST}=await import("@/app/api/observability/faro/route");mocks.enabled.mockReturnValue(false);expect((await POST(request())).status).toBe(404);mocks.enabled.mockReturnValue(true);expect((await POST(request(valid,{origin:"http://bad.invalid"}))).status).toBe(403);expect((await POST(request(valid,{ "content-type":"text/plain" }))).status).toBe(404);mocks.sanitize.mockReturnValue(null);expect((await POST(request("{"))).status).toBe(400);expect((await POST(request("x".repeat(2049)))).status).toBe(413);});
  it("fails open when Alloy is unavailable",async()=>{mocks.fetch.mockRejectedValue(new Error("offline"));const {POST}=await import("@/app/api/observability/faro/route");expect((await POST(request())).status).toBe(202);});
  it("rejects non-POST methods without forwarding",async()=>{const {GET}=await import("@/app/api/observability/faro/route");expect((await GET()).status).toBe(405);expect(mocks.fetch).not.toHaveBeenCalled();});
});
