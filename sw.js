// The Dugout 2026 — Service Worker
// Offline-first: caches the shell + queues writes when offline

const CACHE_NAME = 'dugout26-v3';
const OFFLINE_CACHE = 'dugout26-offline-v3';

// Files to cache for offline shell
const SHELL_FILES = [
  '/',
  '/index.html',
  'assets/event-logo.png',
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

// ── INSTALL ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can, skip failures
      return Promise.allSettled(SHELL_FILES.map(url => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== OFFLINE_CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase API calls — network first, fall through if offline
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Everything else — cache first
  e.respondWith(cacheFirst(e.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return offline page if we have it
    return caches.match('/') || new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── BACKGROUND SYNC ──
// When connectivity returns, replay queued offline writes
self.addEventListener('sync', e => {
  if (e.tag === 'dugout26-sync') {
    e.waitUntil(replayQueue());
  }
});

async function replayQueue() {
  // Signal all clients to flush their offline queue
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_NOW' }));
}
