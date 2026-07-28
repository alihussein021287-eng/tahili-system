import { describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { excludeOtelRoute, normalizeOtelRoute, otelEnabled, otelForceSample, sanitizeOtelSpan } from "@/lib/otel/privacy";
import { PrivacyExporter } from "@/lib/otel/server";

describe("server trace privacy", () => {
  it("defaults to disabled and only force-samples an explicitly enabled test runtime", () => {
    expect(otelEnabled({})).toBe(false);
    expect(otelEnabled({ OTEL_ENABLED: "false" })).toBe(false);
    expect(otelForceSample({ OTEL_ENABLED: "true", OTEL_TEST_FORCE_SAMPLE: "true" })).toBe(true);
  });

  it("normalizes dynamic routes and removes query/hash values", () => {
    expect(normalizeOtelRoute("/patients/synthetic-id?token=no#fragment")).toBe("/patients/:id");
    expect(normalizeOtelRoute("/files/opaque-id")).toBe("/files/:id");
    expect(normalizeOtelRoute("/patients/[id]")).toBe("/patients/:id");
  });

  it("excludes operational and telemetry routes", () => {
    expect(excludeOtelRoute("/_next/static/chunk.js")).toBe(true);
    expect(excludeOtelRoute("/api/observability/faro")).toBe(true);
    expect(excludeOtelRoute("/presence/ping")).toBe(true);
  });

  it("exports only the bounded attribute allowlist", () => {
    const span = sanitizeOtelSpan({
      name: "GET /patients/synthetic-id?phone=private",
      attributes: { "next.route": "/patients/synthetic-id?phone=private", "http.method": "get", "http.status_code": 500, "http.target": "/patients/synthetic-id?phone=private", "db.statement": "SELECT private" },
      statusCode: 2,
    });
    expect(span).toEqual({ name: "HTTP GET /patients/:id", attributes: { "http.request.method": "GET", "http.route": "/patients/:id", "http.response.status_code": 500, "error.type": "server_error" } });
    expect(JSON.stringify(span)).not.toContain("private");
    expect(JSON.stringify(span)).not.toContain("db.statement");
  });

  it("uses a Next server span template only when no route attribute is available", () => {
    expect(sanitizeOtelSpan({ name: "GET /patients/[id]", attributes: { "http.method": "GET" } })).toEqual({ name: "HTTP GET /patients/:id", attributes: { "http.request.method": "GET", "http.route": "/patients/:id" } });
  });

  it("sanitizes HTTP instrumentation semantic attributes without exporting the raw target", () => {
    expect(sanitizeOtelSpan({
      name: "GET",
      attributes: { "http.request.method": "get", "http.target": "/patients/synthetic-id?private=value", "http.response.status_code": 200 },
    })).toEqual({ name: "HTTP GET /patients/:id", attributes: { "http.request.method": "GET", "http.route": "/patients/:id", "http.response.status_code": 200 } });
  });

  it("does not treat a non-route span name as a request trace", () => {
    expect(sanitizeOtelSpan({ name: "Prisma query", attributes: {} })).toBeNull();
  });

  it("preserves the ReadableSpan prototype while exporting only the safe projection", () => {
    let exported: ReadableSpan[] = [];
    const delegate: SpanExporter = {
      export(spans, callback) { exported = spans; callback({ code: 0 }); },
      shutdown: () => Promise.resolve(),
    };
    const original = Object.assign(Object.create({ spanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }) }), {
      name: "GET /patients/private-id?token=private",
      attributes: { "next.route": "/patients/private-id?token=private", "http.method": "GET", "db.statement": "SELECT private", "exception.stacktrace": "private" },
      events: [{ name: "exception", attributes: { "exception.stacktrace": "private" } }],
      links: [{ attributes: { "user.id": "private" } }],
      resource: resourceFromAttributes({ "service.name": "unsafe" }),
      status: { code: SpanStatusCode.ERROR, message: "private" },
    }) as ReadableSpan;
    const exporter = new PrivacyExporter(delegate, resourceFromAttributes({ "service.name": "tahili-app", "deployment.environment.name": "development", "service.version": "revision" }));

    exporter.export([original], () => undefined);

    expect(exported).toHaveLength(1);
    const safe = exported[0];
    expect(Object.getPrototypeOf(safe)).toBe(original);
    expect(safe.spanContext()).toEqual(original.spanContext());
    expect(safe).not.toBe(original);
    expect(safe.name).toBe("HTTP GET /patients/:id");
    expect(safe.attributes).toEqual({ "http.request.method": "GET", "http.route": "/patients/:id", "error.type": "server_error" });
    expect(safe.events).toEqual([]);
    expect(safe.links).toEqual([]);
    expect(JSON.stringify(safe)).not.toContain("private");
    expect(original.name).toContain("private-id");
    expect(original.attributes["db.statement"]).toBe("SELECT private");
    expect(original.events).toHaveLength(1);
    expect(original.links).toHaveLength(1);
  });
});
