#!/usr/bin/env node
/**
 * Local, bounded incident diagnostics for the development VM.
 * Deliberately uses Docker inspect plus Docker-bridge HTTP only: no shell,
 * in-container execution, user supplied URLs/queries, or raw telemetry output.
 */
import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

export const EXIT = Object.freeze({ OK: 0, INVALID_INPUT: 2, NOT_FOUND: 3, PARTIAL: 4, UNAVAILABLE: 5 });
export const MAX_LIMIT = 20;
export const MAX_SINCE_SECONDS = 24 * 60 * 60;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RESPONSE_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT = 1_500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICES = Object.freeze({
  app: { container: "tahili_app", job: "blackbox" }, postgres: { container: "tahili_db", job: "postgres" },
  minio: { container: "tahili_storage", job: "blackbox" }, clamav: { container: "tahili_clamav", job: "blackbox-tcp" },
  alloy: { container: "tahili_alloy", job: "alloy" }, tempo: { container: "tahili_tempo", job: "tempo" },
  loki: { container: "tahili_loki", job: "loki" }, prometheus: { container: "tahili_prometheus", job: "prometheus" },
  grafana: { container: "tahili_grafana", job: "grafana" }, alertmanager: { container: "tahili_alertmanager", job: "alertmanager" },
});
const ENDPOINTS = Object.freeze({ prometheus: ["tahili_prometheus", 9090], alertmanager: ["tahili_alertmanager", 9093], tempo: ["tahili_tempo", 3200], loki: ["tahili_loki", 3100] });
const SAFE_FIELDS = new Set(["timestamp", "service", "route", "level", "status", "errorCode", "eventType", "environment", "release", "traceId", "requestId", "errorId", "reportRequestId"]);
const SENSITIVE = /patient|user(name)?|email|phone|ip|user.?agent|cookie|header|authorization|token|secret|password|body|form|stack|sql|query|url/i;

function plain(value) { return JSON.stringify(value); }
function boundedString(value, maximum = 160) { return typeof value === "string" ? value.slice(0, maximum) : undefined; }
function safeRoute(value) {
  if (typeof value !== "string" || value.length > 160 || /[?#]|:\/\//.test(value)) return undefined;
  const normalized = value.replace(/\/[0-9a-f]{8}-[0-9a-f-]{8,}/gi, "/:id").replace(/\/[0-9]{2,}(?=\/|$)/g, "/:id");
  return /^\/[a-z0-9_:/.-]*$/i.test(normalized) ? normalized : undefined;
}
function iso(value) { const date = new Date(String(value)); return Number.isNaN(date.valueOf()) ? undefined : date.toISOString(); }
function parseJson(value) { try { return JSON.parse(value); } catch { return null; } }
function command(command, args, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false }); let out = ""; let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.on("data", (chunk) => { out = `${out}${chunk}`.slice(0, RESPONSE_LIMIT); });
    child.stderr.on("data", (chunk) => { err = `${err}${chunk}`.slice(0, 256); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err }); });
    child.on("error", () => { clearTimeout(timer); resolve({ ok: false, out: "", err: "command unavailable" }); });
  });
}
async function bridgeAddress(container, port, timeout) {
  const result = await command("docker", ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", container], timeout);
  const ip = result.out.trim();
  return result.ok && /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(ip) ? `http://${ip}:${port}` : null;
}
async function inspectService(name, timeout) {
  const config = SERVICES[name]; if (!config) return null;
  const result = await command("docker", ["inspect", "--format", "{{json .State}}|{{.RestartCount}}", config.container], timeout);
  if (!result.ok) return { name, state: "unavailable" };
  const [stateText, restartText] = result.out.trim().split("|"); const state = parseJson(stateText) || {}; const restartCount = Number(restartText);
  return { name, state: state.Status === "running" ? (state.Health?.Status === "unhealthy" ? "attention" : "healthy") : "attention", restartCount: Number.isInteger(restartCount) ? restartCount : undefined };
}
export function parseSince(value) {
  if (typeof value !== "string" || !/^\d+[mh]$/.test(value)) return null;
  const seconds = Number(value.slice(0, -1)) * (value.endsWith("h") ? 3600 : 60);
  return Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_SINCE_SECONDS ? seconds : null;
}
export function parseOptions(argv) {
  const options = { json: false, since: 3600, limit: 10, timeout: DEFAULT_TIMEOUT, apply: false }; const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (["--since", "--limit", "--timeout"].includes(arg)) {
      const value = argv[++index]; if (!value) return { error: "missing option value" };
      if (arg === "--since") { const seconds = parseSince(value); if (!seconds) return { error: "invalid --since (1m..24h)" }; options.since = seconds; }
      if (arg === "--limit") { const count = Number(value); if (!Number.isInteger(count) || count < 1 || count > MAX_LIMIT) return { error: "invalid --limit (1..20)" }; options.limit = count; }
      if (arg === "--timeout") { const ms = Number(value); if (!Number.isInteger(ms) || ms < 250 || ms > 10_000) return { error: "invalid --timeout (250..10000ms)" }; options.timeout = ms; }
    } else if (arg.startsWith("-")) return { error: "unsupported option" };
    else positional.push(arg);
  }
  return { options, positional };
}
export function sanitizeLog(record) {
  const source = record && typeof record === "object" ? record : {}; const safe = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SAFE_FIELDS.has(key) || SENSITIVE.test(key)) continue;
    if (["route"].includes(key)) { const route = safeRoute(value); if (route) safe.route = route; continue; }
    if (["timestamp"].includes(key)) { const timestamp = iso(value); if (timestamp) safe.timestamp = timestamp; continue; }
    if (["level", "service", "status", "errorCode", "eventType", "environment", "release"].includes(key)) { const text = boundedString(value); if (text) safe[key] = text; }
  }
  return safe;
}
function lineRecord(row) { const values = row?.values; return Array.isArray(values) && typeof values[0]?.[1] === "string" ? parseJson(values[0][1]) : null; }
async function jsonFetch(url, timeout) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("monitoring unavailable");
    const length = Number(response.headers.get("content-length") || "0"); if (length > RESPONSE_LIMIT) throw new Error("response too large");
    const body = await response.text(); if (Buffer.byteLength(body) > RESPONSE_LIMIT) throw new Error("response too large");
    return JSON.parse(body);
  } finally { clearTimeout(timer); }
}
async function api(name, pathname, timeout) { const endpoint = ENDPOINTS[name]; const base = await bridgeAddress(endpoint[0], endpoint[1], timeout); return base ? jsonFetch(`${base}${pathname}`, timeout) : Promise.reject(new Error("bridge unavailable")); }
async function prom(query, timeout) { return api("prometheus", `/api/v1/query?query=${encodeURIComponent(query)}`, timeout); }
function value(payload) { const raw = payload?.data?.result?.[0]?.value?.[1]; const number = Number(raw); return Number.isFinite(number) ? number : null; }
async function lokiQuery(query, since, limit, timeout) {
  const end = Date.now() * 1_000_000; const start = end - since * 1_000_000_000;
  return api("loki", `/loki/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&limit=${limit}&direction=BACKWARD`, timeout);
}
async function status(options) {
  const checks = await Promise.allSettled([prom("up", options.timeout), prom("tahili_smoke_success", options.timeout), prom("tahili_smoke_duration_seconds", options.timeout), prom("100 - (avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)", options.timeout), prom("(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100", options.timeout), prom("max(100 * (1 - (node_filesystem_avail_bytes{fstype!~\"tmpfs|overlay\"} / node_filesystem_size_bytes{fstype!~\"tmpfs|overlay\"})))", options.timeout)]);
  const serviceRows = await Promise.all(Object.keys(SERVICES).map((name) => inspectService(name, options.timeout)));
  const targets = checks[0].status === "fulfilled" ? (checks[0].value.data?.result || []).map((sample) => ({ job: boundedString(sample.metric?.job, 32), up: Number(sample.value?.[1]) === 1 })).filter((row) => row.job) : [];
  const partial = checks.some((check) => check.status !== "fulfilled") || serviceRows.some((service) => !service || service.state === "unavailable");
  return { kind: "status", partial, services: serviceRows, targets, smoke: { success: checks[1].status === "fulfilled" ? value(checks[1].value) === 1 : null, durationSeconds: checks[2].status === "fulfilled" ? value(checks[2].value) : null }, resources: { cpuPercent: checks[3].status === "fulfilled" ? value(checks[3].value) : null, memoryPercent: checks[4].status === "fulfilled" ? value(checks[4].value) : null, diskPercent: checks[5].status === "fulfilled" ? value(checks[5].value) : null } };
}
async function alerts(options) {
  const payload = await api("alertmanager", "/api/v2/alerts", options.timeout); const alerts = Array.isArray(payload) ? payload : [];
  return { kind: "alerts", alerts: alerts.slice(0, options.limit).map((row) => ({ alertname: boundedString(row?.labels?.alertname, 80), severity: boundedString(row?.labels?.severity, 20), service: boundedString(row?.labels?.service, 32), state: boundedString(row?.status?.state, 20), startsAt: iso(row?.startsAt), endsAt: iso(row?.endsAt) })).filter((row) => row.alertname) };
}
async function smoke(options) {
  const [success, duration, age, failed] = await Promise.all([prom("tahili_smoke_success", options.timeout), prom("tahili_smoke_duration_seconds", options.timeout), prom("time() - tahili_smoke_last_run_timestamp", options.timeout), prom("tahili_smoke_failed_checks", options.timeout)]);
  return { kind: "smoke", success: value(success) === 1, durationSeconds: value(duration), ageSeconds: value(age), failedChecks: value(failed) };
}
async function lookupRequest(requestId, options) {
  const payload = await lokiQuery(`{service="tahili-app"} | json | requestId="${requestId}"`, options.since, 1, options.timeout); const record = lineRecord(payload?.data?.result?.[0]);
  if (!record) return null;
  const tracePresent = typeof record.traceId === "string" && /^[a-f0-9]{32}$/i.test(record.traceId);
  let tempoFound = false;
  if (tracePresent) { try { await api("tempo", `/api/traces/${record.traceId}`, options.timeout); tempoFound = true; } catch {} }
  return { found: true, log: sanitizeLog(record), trace: tracePresent ? { found: tempoFound } : { found: false } };
}
async function requestCommand(id, options) { if (!UUID.test(id || "")) return { exit: EXIT.INVALID_INPUT, body: { error: "invalid request ID" } }; const row = await lookupRequest(id, options); return row ? { exit: EXIT.OK, body: { kind: "request", ...row } } : { exit: EXIT.NOT_FOUND, body: { kind: "request", found: false } }; }
async function errorCommand(id, options) {
  if (!UUID.test(id || "")) return { exit: EXIT.INVALID_INPUT, body: { error: "invalid error ID" } };
  const payload = await lokiQuery(`{service="tahili-app"} | json | errorId="${id}"`, options.since, 1, options.timeout); const record = lineRecord(payload?.data?.result?.[0]);
  if (!record) return { exit: EXIT.NOT_FOUND, body: { kind: "error", found: false } };
  const reportRequestId = typeof record.reportRequestId === "string" && UUID.test(record.reportRequestId) ? record.reportRequestId : null;
  const linked = reportRequestId ? await lookupRequest(reportRequestId, options) : null;
  return { exit: EXIT.OK, body: { kind: "error", found: true, reportRequestFound: Boolean(linked), traceFound: Boolean(linked?.trace?.found), log: sanitizeLog(record) } };
}
async function recentErrors(options) {
  const payload = await lokiQuery('{service="tahili-app"} | json | level="error"', options.since, options.limit, options.timeout); const rows = payload?.data?.result || []; const grouped = new Map();
  for (const row of rows) { const safe = sanitizeLog(lineRecord(row)); const key = `${safe.service || "unknown"}|${safe.route || "unknown"}|${safe.status || safe.errorCode || "error"}`; grouped.set(key, (grouped.get(key) || 0) + 1); }
  return { kind: "recent-errors", errors: [...grouped.entries()].slice(0, options.limit).map(([key, count]) => { const [service, route, category] = key.split("|"); return { service, route, category, count }; }) };
}
async function serviceCommand(name, options) { if (!Object.hasOwn(SERVICES, name || "")) return { exit: EXIT.INVALID_INPUT, body: { error: "invalid service" } }; return { exit: EXIT.OK, body: { kind: "service", service: await inspectService(name, options.timeout) } }; }
async function bundle(options) {
  if (!options.apply) { const result = await command(path.join(ROOT, "scripts/collect-debug-bundle.sh"), ["--dry-run", "--since", `${Math.max(1, Math.floor(options.since / 60))}m`], options.timeout); return { exit: result.ok ? EXIT.OK : EXIT.UNAVAILABLE, body: { kind: "bundle", mode: "dry-run", available: result.ok } }; }
  const outputDir = "/tmp/tahili-diagnose"; await mkdir(outputDir, { recursive: true, mode: 0o700 }); const target = path.join(outputDir, `bundle-${Date.now()}.tar.gz`);
  const result = await command(path.join(ROOT, "scripts/collect-debug-bundle.sh"), ["--create", "--since", `${Math.max(1, Math.floor(options.since / 60))}m`, "--output", target], 30_000);
  if (!result.ok) return { exit: EXIT.UNAVAILABLE, body: { kind: "bundle", mode: "apply", available: false } };
  const info = await stat(target); const checksum = createHash("sha256").update(await (await import("node:fs/promises")).readFile(target)).digest("hex");
  return { exit: EXIT.OK, body: { kind: "bundle", mode: "apply", path: target, size: info.size, checksum } };
}
export function help() { return "Usage: tahili-diagnose <status|alerts|smoke|request UUID|error UUID|recent-errors|service NAME|bundle> [--json] [--since 1m..24h] [--limit 1..20] [--timeout 250..10000] [--dry-run|--apply]"; }
export async function run(argv) {
  const parsed = parseOptions(argv); if (parsed.error) return { exit: EXIT.INVALID_INPUT, body: { error: parsed.error } };
  const [name, argument, ...extra] = parsed.positional; const options = parsed.options;
  try {
    if (!name || name === "--help" || name === "help") return { exit: EXIT.OK, body: { help: help() } };
    const requiredArgument = new Set(["request", "error", "service"]); if (extra.length || (requiredArgument.has(name) && !argument) || (!requiredArgument.has(name) && argument)) return { exit: EXIT.INVALID_INPUT, body: { error: "invalid command arguments" } };
    if (name === "status") { const body = await status(options); return { exit: body.partial ? EXIT.PARTIAL : EXIT.OK, body }; } if (name === "alerts") return { exit: EXIT.OK, body: await alerts(options) }; if (name === "smoke") return { exit: EXIT.OK, body: await smoke(options) };
    if (name === "request") return await requestCommand(argument, options); if (name === "error") return await errorCommand(argument, options); if (name === "recent-errors") return { exit: EXIT.OK, body: await recentErrors(options) }; if (name === "service") return await serviceCommand(argument, options); if (name === "bundle") return await bundle(options);
    return { exit: EXIT.INVALID_INPUT, body: { error: "unknown command" } };
  } catch { return { exit: EXIT.UNAVAILABLE, body: { error: "monitoring unavailable" } }; }
}
function render(body, json) { if (json) return plain(body); if (body.help) return body.help; if (body.error) return `error=${body.error}`; return plain(body); }
if (process.argv[1] === new URL(import.meta.url).pathname) { const parsed = parseOptions(process.argv.slice(2)); const result = await run(process.argv.slice(2)); process.stdout.write(`${render(result.body, parsed.options?.json)}\n`); process.exitCode = result.exit; }
