// MontageAI Service Worker
// Strategy:
//   /vendor/* → cache-first (immutable assets like ffmpeg.wasm — 32MB)
//   HTML/JS/CSS → network-first with cache fallback (for offline use)
//   Cross-origin (APIs) → never intercepted (passthrough)

const VERSION = "v1";
const CACHE_STATIC = `montage-static-${VERSION}`;
const CACHE_VENDOR = `montage-vendor-${VERSION}`;

const CORE_ASSETS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/js/api.js",
  "/js/composer.js",
  "/js/templates.js",
  "/js/storage.js",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((c) => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![CACHE_STATIC, CACHE_VENDOR].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;            // never touch APIs
  if (event.request.method !== "GET") return;

  // Vendor (ffmpeg.wasm) → cache-first, immutable
  if (url.pathname.startsWith("/vendor/")) {
    event.respondWith(
      caches.open(CACHE_VENDOR).then(async (c) => {
        const hit = await c.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) c.put(event.request, res.clone());
        return res;
      })
    );
    return;
  }

  // Core HTML/JS/CSS → network-first, fallback to cache
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_STATIC).then((c) => c.put(event.request, clone));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "PURGE_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
