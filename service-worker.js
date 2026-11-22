/* service-worker.js — يجعل التطبيق يعمل بلا إنترنت */
var VERSION = 'rahma-v4';
var CORE = ['./', 'index.html', 'style.css', 'responsive.css', 'dark.css', 'config.js', 'database.js', 'sync.js', 'orders.js', 'tasks.js', 'pdf.js', 'app.js', 'manifest.json'];
var OPTIONAL = ['assets/images/logo.png', 'assets/images/hero-banner.png', 'assets/images/login-background.png', 'assets/images/app-icon-192.png', 'assets/images/app-icon-512.png', 'assets/images/app-icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(CORE).then(function () {
      return Promise.all(OPTIONAL.map(function (u) { return c.add(u).catch(function () { /* الصورة غير موجودة بعد */ }); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // لا نعترض طلبات Apps Script أبداً
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  var isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !isFont) return;

  if (isFont) {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (r) { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }

  // الشبكة أولاً (لتصل التحديثات) مع الرجوع للنسخة المحفوظة إن تأخرت أو انقطع الاتصال
  e.respondWith(caches.open(VERSION).then(function (c) {
    var network = fetch(req).then(function (r) {
      if (r && r.ok) c.put(req, r.clone());
      return r;
    });
    var cached = c.match(req, { ignoreSearch: true }).then(function (m) {
      return m || (req.mode === 'navigate' ? c.match('index.html') : undefined);
    });
    var timeout = new Promise(function (res) { setTimeout(function () { res(null); }, 3500); });
    return Promise.race([network, timeout]).then(function (r) {
      if (r) return r;
      return cached.then(function (m) { return m || network; });
    }).catch(function () {
      return cached.then(function (m) { return m || new Response('', { status: 504 }); });
    });
  }));
});
