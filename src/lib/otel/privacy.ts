const EXCLUDED_ROUTE_PREFIXES = [
  "/_next",
  "/api/observability",
  "/api/health",
  "/api/metrics",
  "/health",
  "/metrics",
  "/presence",
];

const ROUTE_SEGMENTS = ["patients", "files", "users", "referrals", "appointments", "therapy", "visits"];

export function otelEnabled(env: Record<string, string | undefined> = process.env) {
  return env.OTEL_ENABLED === "true";
}

export function otelForceSample(env: Record<string, string | undefined> = process.env) {
  return otelEnabled(env) && env.OTEL_TEST_FORCE_SAMPLE === "true";
}

export function normalizeOtelRoute(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  const pathname = value.split(/[?#]/, 1)[0].replace(/\/\[\[?\.\.\.[^/\]]+\]?\]|\/\[[^/\]]+\]/g, "/:id");
  return ROUTE_SEGMENTS.reduce(
    (route, segment) => route.replace(new RegExp(`/${segment}/[^/?#]+`, "g"), `/${segment}/:id`),
    pathname,
  );
}

export function excludeOtelRoute(route: string | null) {
  return !route || EXCLUDED_ROUTE_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

export function sanitizeOtelSpan(input: { name: string; attributes: Record<string, unknown>; statusCode?: number }) {
  const nameRoute = /^[A-Z]{2,10} (\/[^\s]*)/.exec(input.name)?.[1];
  const route = normalizeOtelRoute(input.attributes["next.route"] ?? input.attributes["http.route"] ?? input.attributes["http.target"] ?? input.attributes["url.path"] ?? nameRoute);
  if (excludeOtelRoute(route)) return null;
  const rawMethod = input.attributes["http.request.method"] ?? input.attributes["http.method"];
  const method = typeof rawMethod === "string"
    ? rawMethod.toUpperCase().slice(0, 10)
    : "GET";
  const rawStatus = input.attributes["http.response.status_code"] ?? input.attributes["http.status_code"];
  const status = typeof rawStatus === "number"
    ? Math.max(100, Math.min(599, Math.trunc(rawStatus)))
    : undefined;
  const attributes: Record<string, string | number> = { "http.request.method": method, "http.route": route, "tahili.route_template": route };
  if (status) attributes["http.response.status_code"] = status;
  if (status) attributes["tahili.status_class"] = `${Math.floor(status / 100)}xx`;
  const trustedRequestId = input.attributes["tahili.request_id"];
  if (typeof trustedRequestId === "string" && /^[a-f0-9-]{36}$/i.test(trustedRequestId)) {
    attributes["tahili.request_id"] = trustedRequestId;
  }
  if (status && status >= 500) attributes["error.type"] = "server_error";
  else if (input.statusCode === 2) attributes["error.type"] = "server_error";
  return { name: `HTTP ${method} ${route}`, attributes };
}
