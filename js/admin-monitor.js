/* ═══════════════════════════════════════════════════════════════
   ADMIN MONITOR — P2 REFACTOR (non-invasive error/rejection layer)
   ═══════════════════════════════════════════════════════════════
   Admin panel mein pehle koi global error handler NAHI tha — JS errors
   sirf console mein silently gir jaate the (debugging mushkil, users ko
   koi clue nahi). Ye layer ADDITIONAL observation hai:
     • 'error' + 'unhandledrejection' listeners — kuch bhi preventDefault
       NAHI karta (existing behavior par koi asar nahi)
     • window.__monLog = ring buffer (max 50 entries, console se dekh sakte)
     • 30s par impossible-to-lose snapshot localStorage mein (last 20)
   Koi backend/DB call nahi — isliye koi naya bug/schema risk nahi.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__adminMonitorInstalled) return;
  window.__adminMonitorInstalled = true;

  var MAX = 50;
  var ring = [];
  try { window.__monLog = ring; } catch (e) {}

  function push(kind, msg, src) {
    ring.push({ kind: kind, msg: msg, src: src, ts: Date.now() });
    if (ring.length > MAX) ring.shift();
    try { window.__monLog = ring.slice(); } catch (e) {}
  }

  window.addEventListener('error', function (e) {
    var msg = (e && typeof e.message === 'string' && e.message) ? e.message : null;
    var src = (e && e.filename) ? String(e.filename).split('/').pop() : 'unknown';
    if (!msg) {
      /* Cross-origin 'Script error' — resource blocked/CORS; मैसेज नहीं मिलता */
      push('error', 'Script error (cross-origin/blocked script)', src);
      return;
    }
    push('error', msg, src);
    console.warn('[AdminMonitor] error |', src, '|', msg);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e && e.reason;
    var msg = (reason && reason.message) || String(reason) || 'Promise rejected';
    push('rejection', msg, 'unhandledrejection');
    console.warn('[AdminMonitor] unhandledrejection |', msg);
  });

  try {
    setInterval(function () {
      localStorage.setItem('_adminMonRing', JSON.stringify(ring.slice(-20)));
    }, 30000);
  } catch (e) {}

  console.log('[AdminMonitor] active — window.__monLog (ring) + localStorage _adminMonRing');
})();
