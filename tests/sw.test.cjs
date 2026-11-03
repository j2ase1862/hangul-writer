// 오프라인(서비스 워커) 시험 — runs the real sw.js with a simulated network + cache storage.
//   node tests/sw.test.cjs
// Guards the bug where, offline, the app opened an OLD version (without 영어): the "/" copy saved at
// install time was never refreshed while updates were saved only as "/index.html".
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SCOPE = 'https://example.test/hangul-writer/';
const CORE_FILES = ['index.html', 'manifest.webmanifest', 'audio/manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

function makeWorld() {
  const server = new Map(); // full URL (no query) → body
  let online = true;
  const keyOf = (k, ignoreSearch) => {
    const u = new URL(typeof k === 'string' ? k : k.url, SCOPE);
    if (ignoreSearch) u.search = '';
    return u.href;
  };
  async function net(r) {
    if (!online) throw new TypeError('Failed to fetch (offline)');
    const body = server.get(keyOf(r, true));
    return body == null ? new Response('not found', { status: 404 }) : new Response(body, { status: 200 });
  }
  class Cache {
    constructor() { this.m = new Map(); }
    async put(k, res) { this.m.set(keyOf(k), res.clone()); }
    async match(k, o = {}) {
      const want = keyOf(k, o.ignoreSearch);
      for (const [kk, v] of this.m) if ((o.ignoreSearch ? keyOf(kk, true) : kk) === want) return v.clone();
      return undefined;
    }
    async keys() { return [...this.m.keys()].map((url) => ({ url })); }
    async addAll(reqs) { for (const r of reqs) { const res = await net(r); if (!res.ok) throw new Error('addAll: ' + r.url); await this.put(r, res); } }
    async delete(k) { return this.m.delete(keyOf(k)); }
  }
  const stores = new Map();
  const caches = {
    open: async (n) => { if (!stores.has(n)) stores.set(n, new Cache()); return stores.get(n); },
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
  };
  const listeners = {};
  const self = {
    registration: { scope: SCOPE },
    location: { origin: new URL(SCOPE).origin, href: SCOPE + 'sw.js' },
    addEventListener: (t, f) => { listeners[t] = f; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  class Request { constructor(u, o = {}) { Object.assign(this, o); this.url = new URL(u, SCOPE).href; this.method = 'GET'; } }
  const ctx = vm.createContext({ self, caches, fetch: net, Response, URL, Request, console, setTimeout, clearTimeout, Promise });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx);

  const run = async (type, extra = {}) => { let p; listeners[type]({ waitUntil: (x) => { p = x; }, ...extra }); await p; };
  return {
    server, stores, caches,
    setOnline: (v) => { online = v; },
    publish(title) { // the site now serves this version at "/" and "/index.html"
      const html = `<html><head><title>${title}</title></head></html>`;
      server.set(SCOPE, html);
      server.set(SCOPE + 'index.html', html);
    },
    install: () => run('install'),
    activate: () => run('activate'),
    async open(pathname, mode = 'navigate') { // what the browser gets for this page
      let p;
      const request = { url: new URL(pathname, SCOPE).href, method: 'GET', mode };
      listeners.fetch({ request, respondWith: (x) => { p = x; }, waitUntil() {} });
      if (!p) return null; // not handled by the service worker
      const res = await p;
      return res && res.ok !== false ? (await res.text()).match(/<title>([^<]*)<\/title>/)?.[1] ?? (await res.clone().text()) : 'ERROR';
    },
  };
}

let checks = 0;
const failures = [];
const expect = (name, ok, detail = '') => { checks++; if (!ok) failures.push(`${name}${detail !== '' ? '  → ' + detail : ''}`); };

(async () => {
  const w = makeWorld();
  for (const f of CORE_FILES.slice(1)) w.server.set(SCOPE + f, f.endsWith('.json') ? '{"clips":{}}' : 'x');
  w.publish('v1 (영어 없음)');
  // an old storage from the previous service-worker version must be cleaned up
  (await w.caches.open('monggeul-app-v2')).put(SCOPE, new Response('<title>stale v2 copy</title>'));

  await w.install();
  await w.activate();
  expect('old app storage (v2) is removed on update', !(await w.caches.keys()).includes('monggeul-app-v2'), (await w.caches.keys()).join(','));
  expect('first visit (online) shows v1', (await w.open('./')) === 'v1 (영어 없음)');

  // a new version is published; the child opens the app once while online
  w.publish('v2 (영어 있음)');
  expect('online: opening "/" shows the new version', (await w.open('./')) === 'v2 (영어 있음)');

  // airplane mode
  w.setOnline(false);
  expect('offline: "/" opens the NEWEST version (the bug: it opened v1)', (await w.open('./')) === 'v2 (영어 있음)', await w.open('./'));
  expect('offline: "/index.html" opens the newest version', (await w.open('./index.html')) === 'v2 (영어 있음)');
  expect('offline: "/?v=2" opens the newest version', (await w.open('./?v=2')) === 'v2 (영어 있음)', await w.open('./?v=2'));

  // another page on the site (e.g. the test page) must never replace the stored app
  w.setOnline(true);
  w.server.set(SCOPE + 'tests/browser-checks.html', '<title>검사 페이지</title>');
  await w.open('./tests/browser-checks.html');
  w.setOnline(false);
  expect('offline after visiting another page: app is still the app', (await w.open('./')) === 'v2 (영어 있음)', await w.open('./'));

  // an update fetched via "/index.html" is also what "/" shows offline
  w.setOnline(true);
  w.publish('v3');
  await w.open('./index.html');
  w.setOnline(false);
  expect('offline: an update saved via "/index.html" also shows at "/"', (await w.open('./')) === 'v3', await w.open('./'));

  console.log(`오프라인 시험: ${checks}건 중 ${checks - failures.length}건 통과`);
  if (failures.length) { console.log('\n❌ 실패:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('✅ 오프라인 시험 모두 통과');
})().catch((e) => { console.log('❌ 시험 중단:', e && e.stack ? e.stack : e); process.exit(1); });
