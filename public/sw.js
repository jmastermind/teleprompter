/* Minimalni service worker — mreža prvo, predmemorija kao rezerva (offline rad). */
const CACHE = 'tp-v2';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.json',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Tuđi tekst s Pastebina ne spremamo u predmemoriju.
  if (new URL(e.request.url).pathname.startsWith('/pastebin/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => {
        if (r) return r;
        // Samo otvaranje stranice smije pasti natrag na index.html. Za sve
        // ostalo mora se vidjeti da je zahtjev pao, inače kod dobije HTML
        // aplikacije umjesto podataka koje je tražio.
        if (e.request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      }))
  );
});
