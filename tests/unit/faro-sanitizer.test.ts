import { describe, expect, it } from "vitest";
import { sanitizeFaroEnvelope } from "@/lib/faro";
import { faroEnabled } from "@/lib/faro";

const meta = { sdk: { name: "faro", version: "2.8.2" }, app: { name: "bad", version: "bad", environment: "bad" }, page: { url: "/patients/raw?token=secret#x" }, user: { id: "secret" }, session: { id: "secret" } };
describe("Faro envelope sanitizer", () => {
  it("uses only the server runtime flag", () => {
    expect(faroEnabled({ FARO_ENABLED: "true" })).toBe(true);
    expect(faroEnabled({ FARO_ENABLED: "false" })).toBe(false);
    expect(faroEnabled({})).toBe(false);
  });
  it("keeps official event, log and vital arrays with server metadata", () => {
    const result:any = sanitizeFaroEnvelope({ meta, events:[{name:"stage6b_pipeline_check",domain:"synthetic",attributes:{runId:"safe-run"},timestamp:"TIME"}], logs:[{message:"stage6b_log_check",level:"info",timestamp:"TIME"}], measurements:[{type:"LCP",values:{value:12},timestamp:"TIME"}] }, "server-revision");
    expect(result.meta.app).toEqual({name:"tahili-frontend",version:"server-revision",environment:"development"}); expect(result.meta.page.url).toBe("/patients/:id"); expect(result.events).toHaveLength(1); expect(result.logs).toHaveLength(1); expect(result.measurements).toHaveLength(1); expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("drops unknown, exception and trace signals and returns meta-only when empty", () => {
    const result:any=sanitizeFaroEnvelope({meta,events:[{name:"unknown",attributes:{runId:"safe"}}],exceptions:[{stack:"secret"}],traces:{}},"r"); expect(Object.keys(result)).toEqual(["meta"]);
  });
});
