import { createHash, randomUUID } from "crypto";
import { tahiliRuntimeEnvironment } from "@/lib/runtime-environment";

const SENSITIVE_KEY = /password|cookie|authorization|token|secret|phone|patient|medical|note|body|formdata|sql|query/i;

export function normalizeRoute(pathname: string) {
  return pathname.split(/[?#]/, 1)[0]
    .replace(/\/patients\/[^/?#]+/g, "/patients/:id")
    .replace(/\/(?:files|users|referrals|appointments|therapy)\/[^/?#]+/g, (value) => `${value.slice(0, value.lastIndexOf("/"))}/:id`);
}

export function requestId(value?: string | null) {
  return value && /^[a-f0-9-]{36}$/i.test(value) ? value : randomUUID();
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item)]));
}

export function errorId(error: unknown) {
  return createHash("sha256").update(String(error instanceof Error ? error.message : error)).digest("hex").slice(0, 12);
}

export function logEvent(
  event: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
) {
  console.log(JSON.stringify(redact({ ...event, timestamp: new Date().toISOString(), environment: tahiliRuntimeEnvironment(env), service: "tahili-app" })));
}

export const CLIENT_ERROR_CODES = ["CLIENT_RENDER_ERROR", "CLIENT_EVENT_ERROR", "CLIENT_NAVIGATION_ERROR"] as const;
