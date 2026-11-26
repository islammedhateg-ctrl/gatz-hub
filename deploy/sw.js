/* Gatz. Hub Service Worker — HTML: network-first on every reload, cache only as offline fallback */

const STATIC_CACHE = 'gatz-hub-static-v21';
const RUNTIME_CACHE = 'gatz-hub-runtime-v21';
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
  // الـ canonical أولاً — أي مفتاح قديم بـ ?fresh ما يخفيش النسخة الأحدث
  let r = await rt.match(canonical) || await rt.match(key);
  if (r) return r;
  const st = await caches.open(STATIC_CACHE);
  return st.match(canonical) || st.match(key) || st.match('./restaurant-booking-v2.html');
}

function storeHtml(res, target) {
  if (!res || !res.ok) return Promise.resolve();
  // مفتاح واحد بس بدون query — عشان مفاتيح ?fresh ما تتراكمش وتضخّم الكاش
  return caches.open(RUNTIME_CACHE).then(c => c.put(canonicalHtmlKey(target), res.clone()));
}

// تثبيت: كل ملف لوحده — فشل واحد ما يمسحش باقي الكاش
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(STATIC_CACHE);
    const results = await Promise.allSettled(PRECACHE.map(u => c.add(u)));
    precacheOk = results.every((r, i) => CRITICAL.includes(PRECACHE[i]) ? r.status === 'fulfilled' : true);
    if (precacheOk) {
      // نسخة الـ SW الجديد تظهر فوراً حتى لو كان في runtime نسخة أقدم
      try {
        const appUrl = new URL('./restaurant-booking-v2', self.registration.scope).href;
        const freshHtml = await c.match(appUrl) || await c.match(appUrl + '.html');
        if (freshHtml) {
          const rt = await caches.open(RUNTIME_CACHE);
          await rt.put(appUrl, freshHtml.clone());
        }
      } catch (err) {}
      self.skipWaiting();
    }
  })());
});

// تفعيل: ما نمسح الكاشات القديمة إلا لما الجديد يبقى جاهز
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (!precacheOk) return;
    const keep = [STATIC_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('gatz-hub-') && !keep.includes(k)).map(k => caches.delete(k)));
    // تنظيف مفاتيح HTML القديمة اللي كانت بتتكتب بـ ?fresh=1&v=...
    const appCanonical = canonicalHtmlKey(new URL('./restaurant-booking-v2', self.registration.scope));
    await Promise.all(keep.map(async (name) => {
      const c = await caches.open(name);
      const reqs = await c.keys();
      const stale = reqs.filter(r => {
        try { const u = new URL(r.url); return !!u.search && canonicalHtmlKey(u) === appCanonical; }
        catch (err) { return false; }
      });
      await Promise.all(stale.map(r => c.delete(r)));
    }));
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

  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html') || url.pathname.endsWith('.html') || target.pathname.endsWith('.html') || target.pathname.endsWith('/restaurant-booking-v2');
  if (isHtml) {
    const cc = req.headers.get('cache-control') || '';
    const pragma = req.headers.get('pragma') || '';
    const hardReload = req.cache === 'reload' || /no-cache|no-store|max-age=0/.test(cc) || /no-cache/.test(pragma);
    const mustBeFresh = target.pathname.endsWith('force-update.html') || target.searchParams.has('fresh') || hardReload;
    const fallback = () => htmlFromCache(targetKey);
    const getFresh = (init) => fetch(new Request(targetKey, init || {}))
      .then(async res => {
        if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
        await storeHtml(res, target);
        return res;
      });

    // كل ريلود/ريفرش يجيب أحدث HTML من الشبكة — الكاش للطوارئ لما النت يفشل بس
    const fresh = getFresh(hardReload ? { cache: 'reload' } : {}).catch(() => null);
    if (mustBeFresh) {
      e.respondWith(fresh.then(res => res || fallback()));
      return;
    }
    // مهلة قصيرة: لو الشبكة بطيئة نعرض الكاش فوراً، والجديدة تتحفظ في الخلفية للمرة الجاية
    const quickNet = new Promise(resolve => setTimeout(() => resolve(null), 1800));
    e.respondWith(Promise.race([fresh, quickNet]).then(res => res || fallback()));
    e.waitUntil(fresh);
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
