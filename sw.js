// Elk Spots offline support.
// - Keeps the app itself on the phone.
// - Keeps every topo, aerial and terrain tile you have viewed or downloaded,
//   so the map and tap reports work with no cell service.
const APP = "elk-spots-v9";
const TILES = "elk-tiles-2";
const CORE = ["./", "./index.html", "./manifest.json", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => (k.startsWith("elk-spots-") && k !== APP) || k === "elk-tiles").map(k => caches.delete(k))
  )));
  self.clients.claim();
});

const isTile = u =>
  (u.hostname === "basemap.nationalmap.gov" && u.pathname.includes("/tile/")) ||
  (u.hostname === "server.arcgisonline.com" && u.pathname.includes("/tile/")) ||
  u.hostname.endsWith("tile.opentopomap.org") ||
  (u.hostname === "elevation-tiles-prod.s3.amazonaws.com") ||
  (u.hostname === "s3.amazonaws.com" && u.pathname.startsWith("/elevation-tiles-prod/"));
const isFont = u => u.hostname.endsWith("googleapis.com") || u.hostname.endsWith("gstatic.com");

const timed = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
async function tileFetch(req) {
  const hit = await caches.match(req.url);
  if (hit) return hit;
  let res = null;
  try { res = await timed(fetch(req.url, { mode: "cors" }), 8000); } catch (e) { res = null; }
  if (res && !res.ok) return res; // e.g. 404 "no detail here": pass it on, never save it
  if (!res) {
    // Server didn't allow a readable request; fetch it for display only.
    try { res = await timed(fetch(req.url, { mode: "no-cors" }), 8000); } catch (e) { return new Response("", { status: 504 }); }
  }
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(TILES).then(c => c.put(req.url, copy)).catch(() => {});
  }
  return res;
}

// The app page itself: try the network first (so updates show up right away),
// fall back to the saved copy after 3 seconds or with no signal.
async function pageFetch(req) {
  const cache = await caches.open(APP);
  try {
    const res = await timed(fetch(req, { cache: "no-store" }), 3000);
    if (res && res.ok) { cache.put("./index.html", res.clone()); return res; }
  } catch (e) {}
  return (await cache.match("./index.html")) || (await cache.match("./")) || new Response("Offline", { status: 503 });
}

// Icons, manifest and fonts: saved copy first, refreshed in the background.
async function appFetch(req) {
  const cache = await caches.open(APP);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then(res => {
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { fresh.catch(() => {}); return hit; }
  const res = await fresh;
  return res || new Response("", { status: 504 });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (isTile(u)) { e.respondWith(tileFetch(req)); return; }
  if (u.origin === self.location.origin && (req.mode === "navigate" || u.pathname.endsWith("/") || u.pathname.endsWith("/index.html"))) { e.respondWith(pageFetch(req)); return; }
  if (u.origin === self.location.origin || isFont(u)) { e.respondWith(appFetch(req)); return; }
  // Live lookups (land owner, burns, logging, sightings) go straight to the network.
});
