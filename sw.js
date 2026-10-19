'use strict';

// Offline support for the GitHub Pages build. Lives at the site root so it also
// covers the root redirect page, and is registered from webmidi/app.js.
//
// Network first: online visitors always get the latest push, and every
// successful response refreshes the cache. Offline, the cached copy is served.
// Google Fonts (guide pages only) are cache first - they never change.
const CACHE = 'me5-editor';
const PRECACHE = [
  './',
  'index.html',
  'webmidi/',
  'webmidi/index.html',
  'webmidi/app.js',
  'webmidi/ask.js',
  'webmidi/factory.js',
  'webmidi/me5.js',
  'webmidi/midi.js',
  'webmidi/style.css',
  'webmidi/pages.css',
  'webmidi/guide.html',
  'webmidi/utmutato.html',
  'webmidi/me5.svg',
  'webmidi/me5.ico',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  // cache: 'reload' skips the HTTP cache, so a new install never stores stale files.
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Stylesheet links without crossorigin come back opaque (status 0) - still usable.
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
