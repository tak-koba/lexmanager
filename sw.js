// LexManager 4 - service worker (iPhone/GitHub Pages local mode only)
// app.js decides whether to register this. Never intercepts /api/ requests.
//
// 方針: オンライン時は常に最新のファイルを取りに行き（ネット優先）、オフライン・低速時だけ保存済みを使う。
// 保存済み優先にすると、更新直後に新旧のファイルが混ざって画面の読み込みに失敗するため（2026-10 iPhoneで発生）。
// APP_SHELL には web/ の全ファイルを載せる（オフラインでも全画面を開けるように）。漏れは tests/test_sw_shell.py で検出する。

// 名前に版番号を入れる（lexmanager/version.py の APP_VERSION と一致させる。tests/test_sw_shell.py で確認）
const CACHE_NAME = 'lexmanager-shell-2026.10.27.1';
const NETWORK_TIMEOUT_MS = 4000;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/autosync.js',
  './js/lock.js',
  './js/util/conflict.js',
  './js/model.js',
  './js/store-server.js',
  './js/store-local.js',
  './js/ui/dates.js',
  './js/ui/dialog.js',
  './js/ui/dom.js',
  './js/ui/forms.js',
  './js/ui/toast.js',
  './js/util/calc.js',
  './js/util/calendar.js',
  './js/util/gengo.js',
  './js/util/kana.js',
  './js/util/onedrive.js',
  './js/util/slots.js',
  './js/util/suggest.js',
  './js/util/zip.js',
  './js/views/_shared.js',
  './js/views/case-detail.js',
  './js/views/cases.js',
  './js/views/client-detail.js',
  './js/views/clients.js',
  './js/views/home.js',
  './js/views/search.js',
  './js/views/settings.js',
  './js/views/todos.js',
  './js/views/tools.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 同じ版の一式をそろえて保存する（HTTPキャッシュの古いファイルを混ぜない）
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Never intercept API calls - always go to network.
  if (url.pathname.includes('/api/')) {
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), NETWORK_TIMEOUT_MS);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
