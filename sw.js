self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method === "GET"
    && request.mode === "navigate"
    && url.origin === self.location.origin
    && !url.pathname.startsWith("/admin")
  ) {
    event.respondWith(fetch(request));
  }
});
