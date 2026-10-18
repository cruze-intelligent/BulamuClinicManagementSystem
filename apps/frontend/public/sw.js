// Bulamu's offline app shell. Pages are cached so the app opens without
// internet; records themselves live in IndexedDB (lib/local-first.ts).
//
// The site is a static export with trailing slashes: /dashboard redirects to
// /dashboard/. Browsers refuse a cached *redirect* when opening a page, so the
// shell lists the real (slashed) addresses and nothing redirected is stored.
const CACHE_NAME = "bulamu-shell-v4";
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
  "/invoices/",
  "/finances/",
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
// How long a page may take from the network before the saved copy is shown.
const SLOW_NETWORK_MS = 3000;

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

// The scripts and styles a page loads - and the fonts its stylesheets load -
// so a page never opened before still works offline and nothing is downloaded
// twice. Best effort: a miss here only means that page needs one online visit first.
const ASSET_PATTERN = /\/_next\/static\/[^"'\s)\\]+/g;
async function cachePageAssets(cache, html) {
  const assets = new Set(html.match(ASSET_PATTERN) || []);
  await Promise.all(
    [...assets].map(async (asset) => {
      if (await cache.match(asset)) return;
      try {
        const response = await fetch(asset);
        if (asset.endsWith(".css") && response.ok) {
          const css = await response.clone().text();
          await cachePageAssets(cache, (css.match(ASSET_PATTERN) || []).join(" "));
        }
        await put(cache, asset, response);
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
async function savedPage(url) {
  const path = url.pathname;
  const candidates = [url.href, path, path.endsWith("/") ? path : `${path}/`];
  for (const candidate of candidates) {
    const hit = await caches.match(candidate, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
}

async function cachedPage(url) {
  return (await savedPage(url)) || caches.match(OFFLINE_PAGE);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // The API is another origin and is never cached here.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network first, so staff get the latest version when online - but on a slow
    // connection a page this device already has opens from it after a short
    // wait instead of leaving the screen blank; the fresh copy is still saved
    // for next time.
    event.respondWith(
      (async () => {
        const network = fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => put(cache, url.pathname, copy)).catch(() => {});
          return response;
        });
        const slow = new Promise((resolve) => setTimeout(resolve, SLOW_NETWORK_MS, null));
        const first = await Promise.race([network.catch(() => null), slow]);
        if (first) return first;
        const saved = await savedPage(url);
        if (saved) return saved;
        return network.catch(() => cachedPage(url));
      })()
    );
    return;
  }

  // Built files carry a fingerprint in their name and never change: once saved,
  // they are used as they are - no download again, which saves mobile data.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => put(cache, request, copy)).catch(() => {});
        return response;
      }))
    );
    return;
  }

  // Everything else (icons, page data): from the cache at once, refreshed in the background.
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
