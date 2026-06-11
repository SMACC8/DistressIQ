// Service worker · cache dell'app-shell per uso offline sul campo.
// Incrementa CACHE quando cambi i file dello shell.
const CACHE = "distressiq-v40";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./db.js",
  "./storage.js",
  "./rilievo.js",
  "./storico.js",
  "./statistiche.js",
  "./iq.js",
  "./gruppi.js",
  "./training.js",
  "./calibrazione.js",
  "./vendor/supabase.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Solo GET; NETWORK-FIRST: online prende sempre i file aggiornati (niente mix di
// versioni durante gli aggiornamenti), offline ricade sulla cache. Le chiamate a
// Supabase/Edge (POST, altri host) passano direttamente in rete e non vengono cacheate.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
