import { normalizeRoute } from "@/lib/observability";

const eventNames = new Set(["stage6b_pipeline_check"]);
const vitalNames = new Set(["LCP", "CLS", "INP", "FCP", "TTFB"]);
const levels = new Set(["debug", "info", "warn", "error"]);
const safeText = (value: unknown, max = 80) => typeof value === "string" && value.length <= max && !/(password|token|cookie|authorization|patient|fileNumber|phone|email|medical|query|stack|form)/i.test(value) ? value : null;
const timestamp = (value: unknown) => typeof value === "string" && value.length <= 40 ? value : new Date().toISOString();

export function sanitizeFaroEnvelope(input: unknown, revision: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>; const meta = body.meta as Record<string, unknown> | undefined;
  const page = meta?.page as Record<string, unknown> | undefined; const route = typeof page?.url === "string" ? normalizeRoute(page.url) : "/";
  const output: Record<string, unknown> = { meta: { sdk: { name: "faro", version: safeText((meta?.sdk as Record<string, unknown> | undefined)?.version) || "2.8.2" }, app: { name: "tahili-frontend", version: revision, environment: "development" }, page: { url: route } } };
  const events = Array.isArray(body.events) ? body.events.slice(0, 10).flatMap((item) => { const x=item as Record<string,unknown>; const name=safeText(x.name); const attrs=x.attributes as Record<string,unknown>|undefined; const runId=safeText(attrs?.runId,64); return name&&eventNames.has(name)&&runId ? [{ name, domain: safeText(x.domain)||"synthetic", attributes:{runId}, timestamp:timestamp(x.timestamp) }] : []; }) : [];
  const logs = Array.isArray(body.logs) ? body.logs.slice(0, 10).flatMap((item) => { const x=item as Record<string,unknown>; const message=safeText(x.message,120); return message&&levels.has(String(x.level)) ? [{ message, level:x.level, timestamp:timestamp(x.timestamp) }] : []; }) : [];
  const measurements = Array.isArray(body.measurements) ? body.measurements.slice(0, 10).flatMap((item) => { const x=item as Record<string,unknown>; const type=safeText(x.type); const values=x.values as Record<string,unknown>|undefined; const value=values?.value; return type&&vitalNames.has(type)&&typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=60000 ? [{ type, values:{value}, timestamp:timestamp(x.timestamp) }] : []; }) : [];
  if(events.length) output.events=events; if(logs.length) output.logs=logs; if(measurements.length) output.measurements=measurements;
  return events.length||logs.length||measurements.length ? output : { meta: output.meta };
}
export function faroEnabled(env: Record<string,string|undefined>=process.env){ return env.FARO_ENABLED==="true"; }
