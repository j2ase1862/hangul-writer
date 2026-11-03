// 몽글몽글 따라 쓰기 — offline support (service worker).
//
// After the first visit everything the app needs is kept on the device, so it opens and talks
// without internet:
//   APP   index.html, manifest, icons          → network first (updates arrive when online)
//   LIBS  React, Tailwind, icons lib, font…    → cache first (their URLs carry a version)
//   VOICE audio/*.mp3 (AI voice files)         → cache first; flushed when audio/manifest.json
//                                                 says the voice files were regenerated
// Bump VERSION when this file's logic changes.
const VERSION = 'v2';
const APP = 'monggeul-app-' + VERSION;
const LIBS = 'monggeul-libs-v1';
const VOICE = 'monggeul-voice-v1';
const META = 'monggeul-meta-v1'; // remembers which voice-file generation is cached

const CORE = [
  './', './index.html', './manifest.webmanifest', './audio/manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];
const LIB_URLS = [
  'https://cdn.tailwindcss.com/3.4.16',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/htm@3.1.1/dist/htm.umd.js',
  'https://unpkg.com/lucide-react@0.460.0/dist/umd/lucide-react.min.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js',
];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Jua&display=swap';
const LIB_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(APP);
    await app.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })));
    // Libraries + font: best effort (a hiccup here must not block install)
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_URLS.map((u) => cacheIfMissing(libs, u, 'no-cors')));
    await cacheFont(libs).catch(() => {});
    await cacheVoices().catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [APP, LIBS, VOICE, META];
    for (const k of await caches.keys()) if (k.startsWith('monggeul-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function cacheIfMissing(cache, url, mode) {
  if (await cache.match(url)) return;
  try {
    const r = await fetch(url, { mode });
    if (r.ok || r.type === 'opaque') await cache.put(url, r);
  } catch (e) { /* offline during install: try again next time */ }
}

// The Korean font is split into many small files (one per range of characters); keep them all.
async function cacheFont(libs) {
  const r = await fetch(FONT_CSS, { mode: 'cors' });
  if (!r.ok) return;
  const css = await r.clone().text();
  await libs.put(FONT_CSS, r);
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(urls.slice(i, i + 8).map((u) => cacheIfMissing(libs, u, 'cors')));
  }
}

// Download every AI voice file listed in audio/manifest.json (≈3 MB).
async function cacheVoices(manifestResponse) {
  const res = manifestResponse || (await fetch('./audio/manifest.json', { cache: 'no-cache' }));
  if (!res.ok) return;
  const m = await res.json();
  const meta = await caches.open(META);
  const had = await meta.match('voice-generation');
  const gen = String(m.generated || '');
  if (had && (await had.text()) !== gen) await caches.delete(VOICE); // voices were regenerated
  const voice = await caches.open(VOICE);
  const ids = Object.keys(m.clips || {});
  for (let i = 0; i < ids.length; i += 12) {
    await Promise.all(ids.slice(i, i + 12).map((id) => cacheIfMissing(voice, new URL('./audio/' + id + '.mp3', self.registration.scope).href, 'same-origin')));
  }
  await meta.put('voice-generation', new Response(gen));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
      event.respondWith(networkFirst(req, APP, './index.html'));
    } else if (url.pathname.endsWith('/audio/manifest.json')) {
      event.respondWith(voiceManifest(event));
    } else if (/\/audio\/[0-9a-f]{8}\.mp3$/.test(url.pathname)) {
      event.respondWith(cacheFirst(req, VOICE));
    } else {
      event.respondWith(networkFirst(req, APP)); // manifest, icons: pick up renames/new icons when online
    }
    return;
  }
  if (LIB_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(req, LIBS));
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, name, fallbackUrl) {
  const cache = await caches.open(name);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res.ok) cache.put(fallbackUrl || req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req, { ignoreSearch: true })) || (fallbackUrl && (await cache.match(fallbackUrl))) || Response.error();
  }
}

// Fresh manifest when online (and refresh the voice cache if the files changed); cached one offline.
async function voiceManifest(event) {
  const req = event.request;
  const cache = await caches.open(APP);
  try {
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), 4000);
    if (res.ok) {
      cache.put('./audio/manifest.json', res.clone());
      event.waitUntil(cacheVoices(res.clone()).catch(() => {}));
    }
    return res;
  } catch (e) {
    return (await cache.match('./audio/manifest.json')) || Response.error();
  }
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
