const CACHE_NAME = "masano-admin-v3";
const OFFLINE_URL = "/admin-offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/admin-180.png",
  "/icons/admin-192.png",
  "/icons/admin-512.png",
  "/icons/admin-maskable-512.png",
  "/icons/admin-monochrome-512.png"
];
const CACHED_ASSETS = new Set([
  "/manifest.webmanifest",
  "/icons/admin-180.png",
  "/icons/admin-192.png",
  "/icons/admin-512.png",
  "/icons/admin-maskable-512.png",
  "/icons/admin-monochrome-512.png"
]);
const ADMIN_PATHS = new Set(["/admin", "/admin/"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("masano-admin-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && ADMIN_PATHS.has(url.pathname)) {
    event.respondWith(
      fetch(request)
        .catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
    );
    return;
  }

  if (CACHED_ASSETS.has(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
