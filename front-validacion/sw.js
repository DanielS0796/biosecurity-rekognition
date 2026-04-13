const CACHE = "biosecurity-v2";
const CACHE_URLS = ["/", "/index.html", "/manifest.json", "/logo.png", "/Logocomp.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // Nunca cachear llamadas a AWS
  if (e.request.url.includes("amazonaws.com") ||
      e.request.url.includes("execute-api") ||
      e.request.url.includes("cognito-idp")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Para el resto usar cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).catch(() => {
        // Si no hay internet y no está cacheado
        if (e.request.destination === "document") {
          return caches.match("/index.html");
        }
      });
    })
  );
});
