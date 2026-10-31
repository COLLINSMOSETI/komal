'use strict';
const CACHE = 'komal-v1';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.json', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network-first for the app shell (always fresh, works offline). Private media/API are never cached here.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (/^\/(api|ws|media|avatar)/.test(u.pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch {}
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
      if (cl.some((c) => c.visibilityState === 'visible')) return; // user is looking at the app
      return self.registration.showNotification(d.title || 'Komal', {
        body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
        tag: 'c' + d.conv, renotify: true, vibrate: [120, 60, 120], data: { conv: d.conv },
      });
    })
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const conv = e.notification.data && e.notification.data.conv;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
      if (cl.length) { cl[0].focus(); cl[0].postMessage({ t: 'open', conv }); return; }
      return self.clients.openWindow('/?c=' + conv);
    })
  );
});
