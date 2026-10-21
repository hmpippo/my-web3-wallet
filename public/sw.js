/*
 * My Wallet service worker.
 *
 * Only public app-shell resources are cached. API responses, RPC calls, wallet
 * secrets, and NFT metadata never enter Cache Storage. Navigation is
 * network-first so a deployed update is picked up as soon as the user is
 * online; cached HTML is only an offline fallback.
 */

const CACHE_VERSION = "v1";
const PRECACHE = `my-wallet-precache-${CACHE_VERSION}`;
const RUNTIME = `my-wallet-runtime-${CACHE_VERSION}`;
const PAGES = `my-wallet-pages-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const MAX_NAVIGATION_ENTRIES = 20;
const MAX_RUNTIME_ENTRIES = 120;

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/apple-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch {
            // A single missing optional asset must not block activation.
          }
        }),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith("my-wallet-") &&
              key !== PRECACHE &&
              key !== RUNTIME &&
              key !== PAGES,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

/**
 * Handles the boot assets of the page that registered the worker. The first
 * navigation happens before the worker controls the page, so without this the
 * initial HTML and chunks would not be cached until the second visit.
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "CACHE_URLS" || !Array.isArray(data.urls)) return;

  const urls = data.urls
    .filter((url) => typeof url === "string")
    .map((url) => new URL(url, self.location.origin))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => url.href);

  event.waitUntil(cacheUrls(urls));
});

async function cacheUrls(urls) {
  if (urls.length === 0) return;
  const runtimeCache = await caches.open(RUNTIME);
  const pageCache = await caches.open(PAGES);

  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          cache: "reload",
          credentials: "same-origin",
        });
        if (!response.ok || response.type !== "basic") return;

        // HTML belongs with navigations; scripts and styles belong with the
        // static runtime cache so each can be trimmed independently.
        const isHtml = (response.headers.get("content-type") || "").includes(
          "text/html",
        );
        await (isHtml ? pageCache : runtimeCache).put(url, response);
      } catch {
        // Offline or a transient failure: keep whatever is already cached.
      }
    }),
  );

  await Promise.all([
    trimCache(runtimeCache, MAX_RUNTIME_ENTRIES),
    trimCache(pageCache, MAX_NAVIGATION_ENTRIES),
  ]);
}

async function networkFirstNavigation(request) {
  // Pages live in their own cache so navigation trims cannot evict the static
  // chunks a cached page needs to boot offline.
  const cache = await caches.open(PAGES);

  try {
    const response = await fetch(request);
    if (isCacheablePage(response)) {
      await cache.put(request, response.clone());
      await trimCache(cache, MAX_NAVIGATION_ENTRIES);
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(RUNTIME);
      await cache.put(request, response.clone());
      await trimCache(cache, MAX_RUNTIME_ENTRIES);
    }
    return response;
  } catch {
    return new Response("", {
      status: 504,
      statusText: "Offline",
    });
  }
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/offline.html" ||
    pathname === "/apple-icon.png" ||
    pathname === "/favicon.ico"
  );
}

function isCacheablePage(response) {
  return (
    response.ok &&
    response.type === "basic" &&
    (response.headers.get("content-type") || "").includes("text/html")
  );
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(
    keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)),
  );
}
