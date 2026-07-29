import http from "node:http";
import { open } from "node:fs/promises";
import { MAX_BODY_BYTES, MAX_REQUESTS_PER_MINUTE, ROUTES, SMOKE_SUMMARY_PATH, isAllowedRequest, normalizeAddress } from "./gateway-policy.mjs";
import { parseSmokeSummary } from "./smoke-summary.mjs";

const hits = new Map();
const SMOKE_METRICS_FILE = "/run/tahili-smoke/tahili_smoke.prom";
const SMOKE_FILE_LIMIT_BYTES = 16 * 1024;

async function readSmokeSummary() {
  const file = await open(SMOKE_METRICS_FILE, "r");
  try {
    const buffer = Buffer.alloc(SMOKE_FILE_LIMIT_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > SMOKE_FILE_LIMIT_BYTES) return null;
    return parseSmokeSummary(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await file.close();
  }
}

function rateAllowed(source) {
  const now = Date.now();
  const current = hits.get(source);
  if (!current || now - current.startedAt >= 60_000) {
    hits.set(source, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_REQUESTS_PER_MINUTE;
}

function safeHeaders(request, hostname, port, contentLength, upstreamHost) {
  const headers = { accept: request.headers.accept ?? "application/json", host: upstreamHost ?? `${hostname}:${port}` };
  if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
  if (contentLength > 0) headers["content-length"] = String(contentLength);
  return headers;
}

for (const [listenPort, route] of ROUTES) {
  http.createServer({ maxHeaderSize: 8 * 1024 }, (request, response) => {
    const source = normalizeAddress(request.socket.remoteAddress);
    const contentLength = Number(request.headers["content-length"] ?? "0");
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES) {
      response.writeHead(413).end();
      return;
    }
    if (!rateAllowed(`${source}:${listenPort}`)) {
      response.writeHead(429).end();
      return;
    }
    if (!request.method || !isAllowedRequest({ source, port: listenPort, method: request.method, rawUrl: request.url ?? "/" })) {
      response.writeHead(403).end();
      return;
    }
    if (listenPort === 9090 && new URL(request.url ?? "/", "http://gateway").pathname === SMOKE_SUMMARY_PATH) {
      readSmokeSummary().then((summary) => {
        if (!summary) {
          response.writeHead(503, { "cache-control": "no-store" }).end();
          return;
        }
        response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(summary));
      }).catch(() => response.writeHead(503, { "cache-control": "no-store" }).end());
      return;
    }
    const [hostname, port] = route.target;
    const upstream = http.request({
      hostname,
      port,
      method: request.method,
      path: request.url,
      headers: safeHeaders(request, hostname, port, contentLength, route.upstreamHost),
      timeout: 1500,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => response.writeHead(502).end());
    let seen = 0;
    request.on("data", (chunk) => {
      seen += chunk.length;
      if (seen > MAX_BODY_BYTES) {
        request.unpipe(upstream);
        upstream.destroy();
        if (!response.headersSent) response.writeHead(413).end();
        request.destroy();
      }
    });
    request.pipe(upstream);
  }).listen(listenPort, "0.0.0.0");
}
