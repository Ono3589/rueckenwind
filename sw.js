// Offline-Fähigkeit: App-Hülle aus dem Cache, Wetter & Strava immer frisch aus dem Netz.
const VERSION = 'rueckenwind-v0.7.1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/store.js',
  './js/geo.js',
  './js/weather.js',
  './js/costs.js',
  './js/strava.js',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'tile.openstreetmap.org'];

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Schrift und Kartenkacheln einmal laden und danach aus dem Cache, damit sie auch offline da ist
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
            return res;
          }),
      ),
    );
    return;
  }
  if (url.origin !== location.origin) return;
  // Netzwerk zuerst, damit Updates sofort ankommen; offline aus dem Cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
