// Cornerstone School app service worker: offline app shell + push notifications.
const CACHE = 'ccs-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/logo-horizontal.webp', '/icons/badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/dismissal') || url.pathname.startsWith('/kiosk')) return;
  // Network first so updates show right away; cache is the offline fallback.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

// ---- Push notifications ----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Cornerstone', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Cornerstone Christian School';
  e.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: d.tag || undefined,
      data: { url: d.url || '/' },
    });
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(w => w.postMessage({ type: 'push' }));
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = new URL(target).origin === self.location.origin;
    for (const w of wins) {
      if (sameOrigin && 'focus' in w) { await w.focus(); if ('navigate' in w && w.url !== target) w.navigate(target); return; }
    }
    return self.clients.openWindow(target);
  })());
});
