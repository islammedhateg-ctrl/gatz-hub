/* Gatz. Hub Service Worker — HTML: network-first for fresh/hard reload, cache-first otherwise */

const STATIC_CACHE = 'gatz-hub-static-v19';
const RUNTIME_CACHE = 'gatz-hub-runtime-v19';
const PRECACHE = ['./restaurant-booking-v2', './restaurant-booking-v2.html', './html5-qrcode.min.js', './gatz-word.png', './gatz-word-text.png', './gatz-brand-icon.png', './gatz-badge.png', './manifest.json', './force-update.html'];
const CRITICAL = ['./restaurant-booking-v2', './restaurant-booking-v2.html', './html5-qrcode.min.js', './manifest.json'];
let precacheOk = false;

function canonicalHtmlKey(u) {
  const x = new URL(u.href);
  x.pathname = x.pathname.replace(/\.html$/, '');
  x.search = '';
  x.hash = '';
  return x.href;
}
function canonicalFromKey(key) {
  try { return canonicalHtmlKey(new URL(key, self.location.origin)); } catch (e) { return key; }
}

// النسخة الأحدث دايماً في runtime — الـ precache القديم ما يخفيهاش
async function htmlFromCache(key) {
  const canonical = canonicalFromKey(key);
  const rt = await caches.open(RUNTIME_CACHE);
  let r = await rt.match(key) || await rt.match(canonical);
  if (r) return r;
  const st = await caches.open(STATIC_CACHE);
  return st.match(key) || st.match(canonical) || st.match('./restaurant-booking-v2.html');
}

function storeHtml(res, target, targetKey) {
  if (!res || !res.ok) return Promise.resolve();
  const a = res.clone();
  const b = res.clone();
  return caches.open(RUNTIME_CACHE).then(c => Promise.all([
    c.put(targetKey, a),
    c.put(canonicalHtmlKey(target), b)
  ]));
}

// تثبيت: كل ملف لوحده — فشل واحد ما يمسحش باقي الكاش
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(STATIC_CACHE);
    const results = await Promise.allSettled(PRECACHE.map(u => c.add(u)));
    precacheOk = results.every((r, i) => CRITICAL.includes(PRECACHE[i]) ? r.status === 'fulfilled' : true);
    if (precacheOk) self.skipWaiting();
  })());
});

// تفعيل: ما نمسح الكاشات القديمة إلا لما الجديد يبقى جاهز
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (!precacheOk) return;
    const keep = [STATIC_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('gatz-hub-') && !keep.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING' && precacheOk) self.skipWaiting();
});

function safePushUrl(raw) {
  const s = String(raw || '');
  if (/^#[A-Za-z0-9_-]+$/.test(s)) return s;
  try {
    const u = new URL(s, self.registration.scope);
    if (u.origin !== self.location.origin) return '#bookings';
    return u.pathname + u.search + u.hash;
  } catch (e) { return '#bookings'; }
}

// Web Push: نص + badge فقط — لا icon ولا image
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = {}; }
  const title = data.title || 'Gatz. Hub';
  const options = {
    body: data.body || '',
    badge: data.badge || './gatz-badge.png',
    tag: data.tag || 'gatz-hub',
    renotify: true,
    data: { url: safePushUrl(data.url) },
    vibrate: [120, 60, 120]
  };
  e.waitUntil(self.registration.showNotification(title, options).catch(() => {}));
});

// فتح التطبيق عند الضغط على الإشعار — نفس العمود فقط
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = safePushUrl(e.notification.data && e.notification.data.url);
  const appUrl = new URL('./restaurant-booking-v2.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = list.find(c => c.url.indexOf('restaurant-booking-v2') !== -1) || list[0];
    if (app) {
      try { await app.focus(); } catch (err) {}
      try { await app.navigate(appUrl + target); } catch (err) {}
      return;
    }
    await self.clients.openWindow(appUrl + target);
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // الأيقونة المثبّتة القديمة بتبعت .html — نحوّلها جوّه الـ SW من غير redirect
  let target = url;
  let targetKey = req.url;
  if (url.pathname.endsWith('/restaurant-booking-v2.html')) {
    target = new URL(url.href);
    target.pathname = target.pathname.replace(/\.html$/, '');
    target.hash = '';
    targetKey = target.href;
  }

  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html') || url.pathname.endsWith('.html') || target.pathname.endsWith('.html');
  if (isHtml) {
    const cc = req.headers.get('cache-control') || '';
    const pragma = req.headers.get('pragma') || '';
    const hardReload = req.cache === 'reload' || /no-cache|no-store|max-age=0/.test(cc) || /no-cache/.test(pragma);
    const mustBeFresh = target.pathname.endsWith('force-update.html') || target.searchParams.has('fresh') || hardReload;
    const fallback = () => htmlFromCache(targetKey);
    const freshInit = hardReload ? { cache: 'reload' } : {};
    const freshFetch = fetch(new Request(targetKey, freshInit))
      .then(async res => {
        if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
        await storeHtml(res, target, targetKey);
        return res;
      })
      .catch(fallback);

    if (mustBeFresh) {
      e.respondWith(freshFetch);
      return;
    }
    const background = fetch(targetKey)
      .then(async res => {
        if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
        await storeHtml(res, target, targetKey);
        return res;
      })
      .catch(() => {});
    e.waitUntil(background);
    e.respondWith(htmlFromCache(targetKey).then(cached => cached || background.then(() => htmlFromCache(targetKey))));
    return;
  }

  // باقي الملفات → cache-first داخل الكاشات بتاعتنا فقط
  const p = (async () => {
    const st = await caches.open(STATIC_CACHE);
    let cached = await st.match(req);
    if (!cached) {
      const rt = await caches.open(RUNTIME_CACHE);
      cached = await rt.match(req);
    }
    if (cached) return { res: cached, write: Promise.resolve() };
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      return { res, write: caches.open(STATIC_CACHE).then(c => c.put(req, copy)) };
    }
    return { res, write: Promise.resolve() };
  })();
  e.respondWith(p.then(x => x.res));
  e.waitUntil(p.then(x => x.write));
});
