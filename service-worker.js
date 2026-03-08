// ============================================================
// HMFC Bible App — Service Worker v2
// Harvester Mission Fellowship Inc.
// ============================================================

const CACHE_NAME     = "hmfc-bible-v1";
const DATA_CACHE     = "hmfc-data-v1";
const IMAGE_CACHE    = "hmfc-images-v1";
const OFFLINE_PAGE   = "index.html";

// Core app shell — always cached on install
const APP_SHELL = [
  "./index.html",
  "./icon.png",
  "./manifest.json"
];

// Data files — cached separately so they can be refreshed
const DATA_FILES = [
  "./all-bible-versions.json",
  "./churches.json",
  "./schools.json",
  "./galleries.json",
  "./events.json"
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener("install", event => {
  console.log("[SW] Installing HMFC Service Worker v2…");
  event.waitUntil(
    Promise.all([
      // Cache app shell
      caches.open(CACHE_NAME).then(cache => {
        console.log("[SW] Caching app shell");
        return cache.addAll(APP_SHELL);
      }),
      // Cache data files (best-effort — don't fail install if missing)
      caches.open(DATA_CACHE).then(cache => {
        return Promise.allSettled(
          DATA_FILES.map(url =>
            cache.add(url).catch(err =>
              console.warn("[SW] Could not pre-cache:", url, err)
            )
          )
        );
      })
    ]).then(() => {
      console.log("[SW] Install complete ✓");
      self.skipWaiting(); // Activate immediately
    }).catch(err => {
      console.error("[SW] Install failed:", err);
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener("activate", event => {
  console.log("[SW] Activating…");
  event.waitUntil(
    caches.keys().then(cacheNames => {
      const validCaches = [CACHE_NAME, DATA_CACHE, IMAGE_CACHE];
      return Promise.all(
        cacheNames
          .filter(name => !validCaches.includes(name))
          .map(name => {
            console.log("[SW] Deleting old cache:", name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log("[SW] Activation complete ✓");
      return self.clients.claim();
    }).catch(err => {
      console.error("[SW] Activation error:", err);
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== "GET") return;

  // Skip chrome extensions and other non-http(s) protocols
  if (!url.protocol.startsWith("http")) return;

  // ── Data / JSON files: Network-first, fallback to cache ──
  if (
    url.pathname.endsWith(".json") &&
    DATA_FILES.some(f => url.pathname.endsWith(f.replace("./", "")))
  ) {
    event.respondWith(networkFirstData(event.request));
    return;
  }

  // ── External images: Cache-first with size limit ──
  if (url.origin !== location.origin && event.request.destination === "image") {
    event.respondWith(cacheFirstImage(event.request));
    return;
  }

  // ── External resources (fonts, CDN): Cache-first ──
  if (url.origin !== location.origin) {
    event.respondWith(cacheFirstExternal(event.request));
    return;
  }

  // ── App shell: Cache-first, fallback to network ──
  event.respondWith(cacheFirstShell(event.request));
});

// ── STRATEGY: Network-first for JSON data ────────────────────
async function networkFirstData(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, networkResponse.clone());
      console.log("[SW] ✓ Updated data cache:", request.url);
    }
    return networkResponse;
  } catch (error) {
    console.log("[SW] ⚠ Offline — serving data from cache:", request.url);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    // Return empty array for missing data
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
      status: 200
    });
  }
}

// ── STRATEGY: Cache-first for app shell ──────────────────────
async function cacheFirstShell(request) {
  try {
    const cached = await caches.match(request);
    if (cached) {
      console.log("[SW] ✓ Cache hit:", request.url);
      return cached;
    }

    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
        console.log("[SW] ✓ Cached from network:", request.url);
      }
      return networkResponse;
    } catch (networkError) {
      console.log("[SW] ⚠ Network failed:", request.url);
      // Fallback to index.html for navigation requests
      if (request.mode === "navigate") {
        const fallback = await caches.match(OFFLINE_PAGE);
        if (fallback) {
          console.log("[SW] ✓ Serving offline page fallback");
          return fallback;
        }
      }
      return new Response("Offline — content not available", { 
        status: 503,
        headers: { "Content-Type": "text/plain" }
      });
    }
  } catch (err) {
    console.error("[SW] Shell caching error:", err);
    return new Response("Service Worker Error", { status: 500 });
  }
}

// ── STRATEGY: Cache-first for external images ────────────────
async function cacheFirstImage(request) {
  try {
    const cached = await caches.match(request);
    if (cached) {
      console.log("[SW] ✓ Image cache hit:", request.url);
      return cached;
    }

    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.ok) {
        // Only cache images under 5MB
        const contentLength = networkResponse.headers.get("content-length");
        if (!contentLength || parseInt(contentLength) < 5 * 1024 * 1024) {
          const cache = await caches.open(IMAGE_CACHE);
          cache.put(request, networkResponse.clone());
          console.log("[SW] ✓ Cached image:", request.url);
        }
      }
      return networkResponse;
    } catch (networkError) {
      console.log("[SW] ⚠ Image network failed:", request.url);
      // Return transparent 1x1 GIF placeholder
      return new Response(
        atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
        { 
          headers: { "Content-Type": "image/gif" },
          status: 200
        }
      );
    }
  } catch (err) {
    console.error("[SW] Image caching error:", err);
    // Return placeholder GIF
    return new Response(
      atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
      { headers: { "Content-Type": "image/gif" } }
    );
  }
}

// ── STRATEGY: Cache-first for external resources ─────────────
async function cacheFirstExternal(request) {
  try {
    const cached = await caches.match(request);
    if (cached) {
      console.log("[SW] ✓ External cache hit:", request.url);
      return cached;
    }

    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
        console.log("[SW] ✓ Cached external resource:", request.url);
      }
      return networkResponse;
    } catch (networkError) {
      console.log("[SW] ⚠ External resource offline:", request.url);
      return new Response("Resource unavailable", { status: 503 });
    }
  } catch (err) {
    console.error("[SW] External caching error:", err);
    return new Response("Service Worker Error", { status: 500 });
  }
}

// ── MESSAGE HANDLER: Client communication ────────────────────
self.addEventListener("message", event => {
  if (!event.data) return;

  const { type } = event.data;

  if (type === "SKIP_WAITING") {
    console.log("[SW] Skipping waiting, installing update");
    self.skipWaiting();
  }

  if (type === "GET_VERSION") {
    console.log("[SW] Version requested");
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ 
        version: CACHE_NAME,
        timestamp: new Date().toISOString()
      });
    }
  }

  if (type === "CLEAR_CACHE") {
    console.log("[SW] Clearing caches...");
    caches.keys().then(names => {
      Promise.all(names.map(name => caches.delete(name)));
    }).then(() => {
      console.log("[SW] ✓ All caches cleared");
    });
  }
});

// ── PERIODIC BACKGROUND SYNC (optional future feature) ───────
// Uncomment when ready to implement periodic data updates
// self.addEventListener("periodicsync", event => {
//   if (event.tag === "update-data") {
//     console.log("[SW] Periodic sync: updating data");
//     event.waitUntil(updateDataCache());
//   }
// });

console.log("[SW] Service Worker loaded and ready");
