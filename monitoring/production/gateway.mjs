import http from "node:http";
import { MAX_BODY_BYTES, MAX_REQUESTS_PER_MINUTE, ROUTES, isAllowedRequest, normalizeAddress } from "./gateway-policy.mjs";

const hits = new Map();

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

function safeHeaders(request, hostname, port, contentLength) {
  const headers = { accept: request.headers.accept ?? "application/json", host: `${hostname}:${port}` };
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
    const [hostname, port] = route.target;
    const upstream = http.request({
      hostname,
      port,
      method: request.method,
      path: request.url,
      headers: safeHeaders(request, hostname, port, contentLength),
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
