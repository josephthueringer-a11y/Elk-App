// Elk Spots offline support.
// - Keeps the app itself on the phone.
// - Keeps every topo, aerial and terrain tile you have viewed or downloaded,
//   so the map and tap reports work with no cell service.
const APP = "elk-spots-v4";
const TILES = "elk-tiles";
const CORE = ["./", "./index.html", "./manifest.json", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith("elk-spots-") && k !== APP).map(k => caches.delete(k))
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
  if (!res || !res.ok) {
    try { res = await timed(fetch(req.url, { mode: "no-cors" }), 8000); } catch (e) { return new Response("", { status: 504 }); }
  }
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(TILES).then(c => c.put(req.url, copy)).catch(() => {});
  }
  return res;
}

async function appFetch(req) {
  const cache = await caches.open(APP);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then(res => {
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { fresh.catch(() => {}); return hit; }
  const res = await fresh;
  if (res) return res;
  if (req.mode === "navigate") return (await cache.match("./index.html")) || new Response("Offline", { status: 503 });
  return new Response("", { status: 504 });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (isTile(u)) { e.respondWith(tileFetch(req)); return; }
  if (u.origin === self.location.origin || isFont(u)) { e.respondWith(appFetch(req)); return; }
  // Live lookups (land owner, burns, logging, sightings) go straight to the network.
});
