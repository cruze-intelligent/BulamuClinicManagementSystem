// Bulamu's offline app shell. Pages are cached so the app opens without
// internet; records themselves live in IndexedDB (lib/local-first.ts).
//
// The site is a static export with trailing slashes: /dashboard redirects to
// /dashboard/. Browsers refuse a cached *redirect* when opening a page, so the
// shell lists the real (slashed) addresses and nothing redirected is stored.
const CACHE_NAME = "bulamu-shell-v3";
const APP_SHELL = [
  "/",
  "/auth/login/",
  "/dashboard/",
  "/patients/",
  "/patients/register/",
  "/patients/view/",
  "/appointments/",
  "/appointments/book/",
  "/consultations/",
  "/consultations/record/",
  "/lab/",
  "/wards/",
  "/wards/admission/",
  "/referrals/",
  "/chw-visit/",
  "/inventory/",
  "/dispensing/",
  "/notifications/",
  "/sync-activity/",
  "/reports/",
  "/billing/",
  "/super-admin/",
  "/help/",
  "/install/",
  "/offline/",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const OFFLINE_PAGE = "/offline/";

// A redirected response can't be used to open a page - store a clean copy.
async function storable(response) {
  if (!response || !response.ok) return null;
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function put(cache, key, response) {
  const clean = await storable(response);
  if (clean) await cache.put(key, clean);
}

// The scripts and styles a page loads, so a page never opened before still
// works offline. Best effort: a miss here only means that page needs one
// online visit first.
async function cachePageAssets(cache, html) {
  const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
  await Promise.all(
    [...assets].map(async (asset) => {
      if (await cache.match(asset)) return;
      try {
        await put(cache, asset, await fetch(asset));
      } catch {
        // Skipped - fetched and cached on first online use instead.
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        APP_SHELL.map(async (path) => {
          try {
            const response = await fetch(path, { cache: "reload" });
            const clean = await storable(response);
            if (!clean) return;
            if ((clean.headers.get("content-type") || "").includes("text/html")) {
              await cachePageAssets(cache, await clean.clone().text());
            }
            await cache.put(path, clean);
          } catch {
            // One unreachable page must not stop the app installing.
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// /patients/view/?id=... is the same page as /patients/view/ - look the page
// up without its query, and with or without the trailing slash.
async function cachedPage(url) {
  const path = url.pathname;
  const candidates = [url.href, path, path.endsWith("/") ? path : `${path}/`];
  for (const candidate of candidates) {
    const hit = await caches.match(candidate, { ignoreSearch: true });
    if (hit) return hit;
  }
  return caches.match(OFFLINE_PAGE);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // The API is another origin and is never cached here.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network first, so staff always get the latest version when online.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => put(cache, url.pathname, copy)).catch(() => {});
          return response;
        })
        .catch(() => cachedPage(url))
    );
    return;
  }

  // Scripts, styles and icons: from the cache at once, refreshed in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => put(cache, request, copy)).catch(() => {});
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
