// Wersję poniżej ustawia automatycznie skrypt build.ps1 (skrót zawartości plików apki).
// Gdy cokolwiek w apce się zmieni, zmienia się wersja, a telefony pobierają nowe pliki RAZ, w tle.
const CACHE = "rozpierdol-0fd6cfa86f";
// Zdjęcia ćwiczeń (folder img/) mają osobny schowek, który przetrwa aktualizacje apki —
// każde zdjęcie telefon pobiera tylko raz, przy pierwszym obejrzeniu (wszystkie razem to ok. 37 MB, więc nie hurtem).
const IMG_CACHE = "rozpierdol-img";
const FILES = [
  "./",
  "index.html",
  "style.css",
  "extras.js",
  "app.js",
  "config.js",
  "sync.js",
  "lock.js",
  "manifest.webmanifest",
  "data/exercises.json",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/body-m.png",
  "icons/body-f.png"
];

// Instalacja nowej wersji: pobierz wszystkie pliki jednorazowo (z pominięciem pamięci przeglądarki)
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return; // Firebase itd. idzie prosto do Google

  // Zdjęcia ćwiczeń: z pamięci telefonu, a przy pierwszym obejrzeniu z serwera (i zapamiętaj na stałe)
  if (url.pathname.includes("/img/")) {
    e.respondWith(
      caches.open(IMG_CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  // Pliki apki: zawsze z pamięci telefonu — zero ruchu na Netlify przy zwykłym otwieraniu apki.
  // Do sieci tylko wtedy, gdy czegoś w pamięci nie ma (np. obraz startowy iOS).
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === "navigate" ? "index.html" : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && req.mode !== "navigate") cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match("index.html")) || Response.error();
    }
  })());
});
