import { SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { registerOTel, type Configuration } from "@vercel/otel";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { otelEnabled, otelForceSample, sanitizeOtelSpan } from "@/lib/otel/privacy";

const OTLP_ENDPOINT = "http://alloy:4318/v1/traces";
const SAMPLE_RATIO = 0.05;
let tracingStarted = false;

export class PrivacyExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter, private readonly resource: ReturnType<typeof resourceFromAttributes>) {}

  export(spans: ReadableSpan[], callback: Parameters<SpanExporter["export"]>[1]) {
    const safeSpans = spans.flatMap((span) => {
      const safe = sanitizeOtelSpan({ name: span.name, attributes: span.attributes, statusCode: span.status.code });
      if (!safe) return [];
      const safeSpan = Object.create(span);
      Object.defineProperties(safeSpan, {
        name: { value: safe.name },
        attributes: { value: safe.attributes },
        events: { value: [] },
        links: { value: [] },
        resource: { value: this.resource },
        status: { value: { code: span.status.code === SpanStatusCode.ERROR ? SpanStatusCode.ERROR : SpanStatusCode.UNSET } },
      });
      return [safeSpan];
    });
    if (!safeSpans.length) return callback({ code: 0 });
    this.delegate.export(safeSpans, callback);
  }

  shutdown() { return this.delegate.shutdown(); }
  forceFlush() { return this.delegate.forceFlush?.() ?? Promise.resolve(); }
}

export function createServerTracingConfig(env: Record<string, string | undefined> = process.env): Configuration {
  const resource = resourceFromAttributes({
    "service.name": "tahili-app",
    "deployment.environment.name": "development",
    "service.version": env.GIT_REVISION || "unknown",
  });
  const exporter = new PrivacyExporter(new OTLPTraceExporter({ url: OTLP_ENDPOINT, timeoutMillis: 250 }), resource);
  const sampler = otelForceSample(env)
    ? new AlwaysOnSampler()
    : new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(SAMPLE_RATIO) });
  return {
    serviceName: "tahili-app",
    attributes: {
      "deployment.environment.name": "development",
      "service.version": env.GIT_REVISION || "unknown",
    },
    autoDetectResources: false,
    instrumentations: [],
    propagators: ["tracecontext"],
    traceSampler: sampler,
    spanProcessors: [new BatchSpanProcessor(exporter, { maxQueueSize: 256, maxExportBatchSize: 32, scheduledDelayMillis: 1000, exportTimeoutMillis: 500 })],
  };
}

export function startServerTracing(
  env: Record<string, string | undefined> = process.env,
  register: (config: Configuration) => void = registerOTel,
) {
  if (tracingStarted || !otelEnabled(env)) return false;
  try {
    register(createServerTracingConfig(env));
    tracingStarted = true;
    if (otelForceSample(env)) {
      const span = trace.getTracer("tahili.otel.test").startSpan("GET /__otel-test", {
        attributes: { "next.route": "/__otel-test", "http.method": "GET" },
      });
      span.end();
    }
    return true;
  } catch {
    return false;
  }
}
