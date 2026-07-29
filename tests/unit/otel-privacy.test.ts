import { describe, expect, it } from "vitest";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SamplingDecision, type ReadableSpan, type Sampler, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { excludeOtelRoute, normalizeOtelRoute, otelEnabled, otelForceSample, sanitizeOtelSpan } from "@/lib/otel/privacy";
import { createServerTracingConfig, PrivacyExporter, startServerTracing } from "@/lib/otel/server";

describe("server trace privacy", () => {
  it("defaults to disabled and only force-samples an explicitly enabled test runtime", () => {
    expect(otelEnabled({})).toBe(false);
    expect(otelEnabled({ OTEL_ENABLED: "false" })).toBe(false);
    expect(otelForceSample({ OTEL_ENABLED: "true", OTEL_TEST_FORCE_SAMPLE: "true" })).toBe(true);
  });

  it("registers the official Next tracing configuration once with no instrumentations", () => {
    const config = createServerTracingConfig({ OTEL_ENABLED: "true", GIT_REVISION: "revision" });
    expect(config.instrumentations).toEqual([]);
    expect(config.attributes).toMatchObject({ "service.version": "revision", "deployment.environment.name": "development" });
    const calls: unknown[] = [];
    const env = { OTEL_ENABLED: "true", GIT_REVISION: "revision" };
    expect(startServerTracing(env, (value) => calls.push(value))).toBe(true);
    expect(startServerTracing(env, (value) => calls.push(value))).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("uses only the closed server runtime environment for trace resources", () => {
    expect(createServerTracingConfig({ TAHILI_ENVIRONMENT: "production" }).attributes)
      .toMatchObject({ "deployment.environment.name": "production" });
    expect(createServerTracingConfig({ TAHILI_ENVIRONMENT: "invalid" }).attributes)
      .toMatchObject({ "deployment.environment.name": "development" });
  });

  it("does not let a remote sampled parent bypass the five-percent sampler", () => {
    const sampler = createServerTracingConfig({ OTEL_ENABLED: "true", GIT_REVISION: "revision" }).traceSampler as Sampler;
    const remoteParent = trace.wrapSpanContext({ traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef", traceFlags: 1, isRemote: true });
    const decisions = Array.from({ length: 100 }, (_, index) => sampler.shouldSample(
      trace.setSpan(context.active(), remoteParent),
      index.toString(16).padStart(32, "0"),
      "GET /probe",
      0,
      {},
      [],
    ).decision);
    expect(decisions).toContain(SamplingDecision.NOT_RECORD);
  });

  it("keeps locally sampled parent spans sampled", () => {
    const sampler = createServerTracingConfig({ OTEL_ENABLED: "true", GIT_REVISION: "revision" }).traceSampler as Sampler;
    const localParent = trace.wrapSpanContext({ traceId: "abcdefabcdefabcdefabcdefabcdefab", spanId: "abcdefabcdefabcd", traceFlags: 1, isRemote: false });
    expect(sampler.shouldSample(trace.setSpan(context.active(), localParent), "fedcfedcfedcfedcfedcfedcfedcfedc", "GET /probe", 0, {}, []).decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
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
    expect(span).toEqual({ name: "HTTP GET /patients/:id", attributes: { "http.request.method": "GET", "http.route": "/patients/:id", "tahili.route_template": "/patients/:id", "http.response.status_code": 500, "tahili.status_class": "5xx", "error.type": "server_error" } });
    expect(JSON.stringify(span)).not.toContain("private");
    expect(JSON.stringify(span)).not.toContain("db.statement");
  });

  it("uses a Next server span template only when no route attribute is available", () => {
    expect(sanitizeOtelSpan({ name: "GET /patients/[id]", attributes: { "http.method": "GET" } })).toEqual({ name: "HTTP GET /patients/:id", attributes: { "http.request.method": "GET", "http.route": "/patients/:id", "tahili.route_template": "/patients/:id" } });
  });

  it("sanitizes HTTP instrumentation semantic attributes without exporting the raw target", () => {
    expect(sanitizeOtelSpan({
      name: "GET",
      attributes: { "http.request.method": "get", "http.target": "/patients/synthetic-id?private=value", "http.response.status_code": 200 },
    })).toEqual({ name: "HTTP GET /patients/:id", attributes: { "http.request.method": "GET", "http.route": "/patients/:id", "tahili.route_template": "/patients/:id", "http.response.status_code": 200, "tahili.status_class": "2xx" } });
  });

  it("keeps a generated request ID but rejects all other correlation attributes", () => {
    expect(sanitizeOtelSpan({
      name: "GET /patients/[id]",
      attributes: {
        "http.method": "GET",
        "tahili.request_id": "123e4567-e89b-12d3-a456-426614174000",
        traceparent: "forbidden",
        cookie: "forbidden",
      },
    })?.attributes).toEqual({
      "http.request.method": "GET",
      "http.route": "/patients/:id",
      "tahili.route_template": "/patients/:id",
      "tahili.request_id": "123e4567-e89b-12d3-a456-426614174000",
    });
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
    expect(safe.attributes).toEqual({ "http.request.method": "GET", "http.route": "/patients/:id", "tahili.route_template": "/patients/:id", "error.type": "server_error" });
    expect(safe.events).toEqual([]);
    expect(safe.links).toEqual([]);
    expect(JSON.stringify(safe)).not.toContain("private");
    expect(original.name).toContain("private-id");
    expect(original.attributes["db.statement"]).toBe("SELECT private");
    expect(original.events).toHaveLength(1);
    expect(original.links).toHaveLength(1);
  });
});
