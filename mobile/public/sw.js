/* Nickland Edusoft — web app service worker.
 *
 * Scope is deliberately narrow: the app SHELL only. School data is never
 * cached here. A parent who is shown last week's fee balance because a service
 * worker served it from disk is worse off than one who is told they are
 * offline, and a teacher must never mark a register against a stale roster.
 *
 *   /api/*                 → never touched. Straight to the network, always.
 *   /_expo/static/*        → cache first. Filenames carry a content hash, so a
 *                            cached copy can never be the wrong copy.
 *   navigations + the rest → network first, cache as a fallback. This is what
 *                            makes the app open at all on a dropped connection,
 *                            far from rare on Ghanaian mobile data.
 *
 * Registration only succeeds on a secure origin, so this runs for the HTTPS
 * portal and not for the plain-HTTP desktop host on the school Wi-Fi.
 */
const VERSION = 'edusoft-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/app-icon.png', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // Individually, so one 404 in the list cannot fail the whole install.
      .then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    const cache = await caches.open(VERSION);
    cache.put(request, res.clone());
  }
  return res;
}

async function networkFirst(request, fallbackPath) {
  try {
    const res = await fetch(request);
    if (res && res.ok && request.method === 'GET') {
      const cache = await caches.open(VERSION);
      cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await caches.match(request) || (fallbackPath && await caches.match(fallbackPath));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // API on another host, CDNs — leave alone
  if (url.pathname.startsWith('/api/')) return;      // school data is always live

  if (url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Client-side routes (/parent/child/7 and friends) have no file of their
  // own in single-page output — they all resolve to the shell.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  event.respondWith(networkFirst(request));
});
