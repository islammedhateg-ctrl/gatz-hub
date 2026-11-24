/* Gatz. Hub Service Worker — Network-first for HTML, Cache-first for assets */

const STATIC_CACHE = 'gatz-hub-static-v12';
const RUNTIME_CACHE = 'gatz-hub-runtime-v12';
const PRECACHE = ['./restaurant-booking-v2.html', './gatz-word.png', './gatz-brand-icon.png', './gatz-badge.png', './manifest.json'];

// تثبيت: تحميل الملفات الأساسية مسبقاً
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// تفعيل: تنظيف الكاشات القديمة
self.addEventListener('activate', (e) => {
  const keep = [STATIC_CACHE, RUNTIME_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// تحديث تلقائي عند طلب SKIP_WAITING من الصفحة
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Web Push: عرض الإشعار حتى لو التطبيق مقفول
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = {}; }
  const title = data.title || 'Gatz. Hub';
  const options = {
    body: data.body || '',
    badge: data.badge || './gatz-badge.png',
    tag: data.tag || 'gatz-hub',
    data: { url: data.url || '#dashboard' },
    vibrate: [120, 60, 120]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// فتح التطبيق عند الضغط على الإشعار
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '#dashboard';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.focus) {
          client.focus();
          if (client.navigate) client.navigate(target);
          return;
        }
      }
      return self.clients.openWindow('./restaurant-booking-v2.html' + target);
    })
  );
});

// Fetch strategy
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // تجاهل الطلبات غير GET والموارد الخارجية (CDN: fonts, fontawesome, qrcode...)
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // ملفات HTML → Network-first (دائماً الأحدث، والكاش احتياطي عند انقطاع الإنترنت)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html') || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./restaurant-booking-v2.html')))
    );
    return;
  }

  // باقي الملفات (logo, manifest...) → Cache-first
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
