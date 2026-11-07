/* ADMIN SW (2026-11-03): owner ke browser me purana cache kabhi nahi tikaga.
   HTML/CSS/JS = NETWORK-FIRST (fresh), images/fonts = cache-first. */
var ASSET_VER = '20261106c';   /* version-sync.mjs --bump keeps in sync with index.html ?v= */
var CACHE_VER = 'me-v35-20261106c';
var VER = CACHE_VER;
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VER; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  var fresh = /\.(html|css|js)(\?|$)/.test(url.pathname) || url.pathname === '/';
  if (fresh) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(function (r) {
          var cp = r.clone();
          caches.open(VER).then(function (c) { c.put(e.request, cp); });
          return r;
        })
        .catch(function () { return caches.match(e.request); })
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(function (m) {
        return m || fetch(e.request).then(function (r) {
          var cp = r.clone();
          caches.open(VER).then(function (c) { c.put(e.request, cp); });
          return r;
        });
      })
    );
  }
});

/* ── FCM background push (D32, 2026-11-05) — admin alerts device tak,
   admin panel band ho tab bhi. Tokens admin uid ke naam register hote
   hain (js/admin-push.js), isliye Hunter7 jaise normal users ko kuch
   nahi milta. ── */
try {
  importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: "AIzaSyA-v9AYigDrg96D_fos0vOW3wU2GY2UYec",
    authDomain: "fft-app-1e283.firebaseapp.com",
    projectId: "fft-app-1e283",
    storageBucket: "fft-app-1e283.firebasestorage.app",
    messagingSenderId: "247829466483",
    appId: "1:247829466483:web:6961488f1d3c4e3fff4906"
  });
  firebase.messaging().onBackgroundMessage(function (payload) {
    var d = (payload && payload.data) || {};
    var n = (payload && payload.notification) || {};
    self.registration.showNotification(d.title || n.title || 'Mini eSports Admin', {
      body: d.body || n.body || '',
      tag: d.type || 'admin-push',
      data: { url: d.url || '' },
      vibrate: [200, 100, 200]
    });
  });
} catch (e) { /* push unavailable; caching intact */ }
