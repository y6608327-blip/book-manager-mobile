/**
 * Service Worker: アプリシェル(HTML/CSS/JS)をキャッシュし、
 * 電波の弱い場所でも照合モードの画面自体は開けるようにする。
 *
 * 注意: ISBNデータそのもののキャッシュは localStorage 側(app.js の
 * syncIsbnCache)で管理している。ここでは「画面が開けること」を保証する。
 */
const CACHE_NAME = "bookmgr-mobile-v1";
const APP_SHELL = [
  "/mobile/",
  "/mobile/index.html",
  "/mobile/style.css",
  "/mobile/matching.js",
  "/mobile/app.js",
  "/mobile/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // /api/ へのリクエストはservice workerを介さず常にネットワークへ
  // (照合はオンラインの最新データを優先し、オフライン時はapp.js側でlocalStorageにフォールバックする)
  if (url.pathname.startsWith("/api/")) return;

  // アプリシェルはキャッシュ優先、無ければネットワーク
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
