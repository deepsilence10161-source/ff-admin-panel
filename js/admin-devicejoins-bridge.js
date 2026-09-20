/* ================================================================
   admin-devicejoins-bridge.js — ROUND-9 (2026-09-20m)
   ----------------------------------------------------------------
   deviceJoins ka ROOT read Firebase rules me DENIED hai (Round-2
   privacy-hardening: koi bhi logged-in user poora device-fingerprint
   node na padh sake — sirf per-device reads allowed).

   Fraud tools (runFraudCheck / fa73_detectIPClusters / feature-4) ab
   is bridge se data lete hain:
     1. Supabase users.device_fp list (admin Supabase-side read)
     2. har device_fp ka PER-DEVICE RTDB read (rules-allowed)
     3. dono milakar ek plain data-object: {deviceId: {key: val}}
   ================================================================ */
(function () {
  'use strict';

  window.fa_readDeviceJoins = function (cb) {
    if (!window._supa) { cb(null, 'Supabase not ready'); return; }
    var db = window.getDB ? window.getDB() : window.db;
    if (!db) { cb(null, 'DB not ready'); return; }
    window._supa.from('users').select('id, device_fp').not('device_fp', 'is', null).limit(5000)
      .then(function (r) {
        var seen = {}, fps = [];
        (r.data || []).forEach(function (u) {
          if (u.device_fp && !seen[u.device_fp]) { seen[u.device_fp] = 1; fps.push(u.device_fp); }
        });
        var data = {}, pending = fps.length;
        if (!pending) { cb(data, null); return; }
        fps.forEach(function (fp) {
          db.ref('deviceJoins/' + fp).once('value').then(function (s) {
            if (s.exists()) data[fp] = s.val();
            if (--pending === 0) cb(data, null);
          }).catch(function () {
            if (--pending === 0) cb(data, null);
          });
        });
      })
      .catch(function (e) { cb(null, (e && e.message) || 'Supabase read failed'); });
  };

  /* walkers — snap.forEach() ki jagah plain-object iteration */
  window.fa_eachDevice = function (data, fn) {
    Object.keys(data || {}).forEach(function (deviceId) { fn(deviceId, data[deviceId]); });
  };
  window.fa_eachChild = function (node, fn) {
    if (node && typeof node === 'object') Object.keys(node).forEach(function (k) { fn(k, node[k]); });
  };
})();

/* ── Round-12: shared HTML-escape for admin renders ── */
window.admEsc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};
