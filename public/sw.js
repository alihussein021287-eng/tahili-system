const CACHE = "tahili-static-v4";
const PRECACHE_URLS = ["/login", "/icon-192.png", "/icon-512.png", "/manifest.json", "/fonts/plex-arabic-400.woff2", "/fonts/plex-arabic-500.woff2", "/fonts/plex-arabic-600.woff2", "/fonts/plex-arabic-700.woff2"];
const PROTECTED_PREFIXES = [
  "/api",
  "/patients",
  "/visits",
  "/appointments",
  "/queue",
  "/tasks",
  "/care-board",
  "/pharmacy",
  "/inventory",
  "/finance",
  "/reports",
  "/backup",
  "/admin",
  "/settings",
  "/users",
  "/roles",
  "/audit",
  "/attendance",
  "/beds",
  "/devices",
  "/account",
  "/analytics",
  "/portal",
];

function isHttpRequest(url) {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isProtectedPath(pathname) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isSafeAsset(pathname) {
  return PRECACHE_URLS.includes(pathname) || pathname.startsWith("/_next/static/") || pathname.startsWith("/fonts/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isHttpRequest(url)) return;
  if (isProtectedPath(url.pathname)) return;
  if (!isSafeAsset(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE).then((cache) => cache.put(request, response.clone())).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);

      return cached || refresh;
    }),
  );
});
