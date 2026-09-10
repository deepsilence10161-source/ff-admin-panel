/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  supabase-compat-patch.js                                        ║
 * ║  MUST load immediately after the supabase-js UMD bundle and      ║
 * ║  BEFORE any other panel script.                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * 🐞 ROOT-CAUSE FIX (live testing 2026-08-20)
 * ------------------------------------------------------------------
 * supabase-js v2's query builder (`PostgrestBuilder`) is a *thenable*,
 * NOT a real Promise. It implements ONLY `.then()`. It has no
 * `.catch()` and no `.finally()`.
 *
 * This codebase calls `.catch()` directly on a builder in ~40 places,
 * e.g.:
 *
 *     window._supa.from('users').update(u).eq('id', uid)
 *        .catch(function(e){ ... });          // ← TypeError!
 *
 * Every one of those lines throws
 *     TypeError: ....catch is not a function
 * at the moment it executes. Because most of them sit inside an
 * `async function` wrapped in try/catch, the thrown TypeError is
 * swallowed by the catch block and surfaces to the admin as a generic
 * red toast — while everything AFTER that line (button re-enable,
 * refresh, success toast) never runs. That is exactly the reported
 * "Approve dabaya → error aaya aur button me chakri ghumti rahi" bug
 * on Profile Updates, and the same class of failure on several other
 * approve buttons.
 *
 * Rather than hand-editing 40 call sites (and hoping no new one is
 * ever added), we teach the builder prototype the two missing Promise
 * methods. Behaviour is then identical to a real Promise.
 *
 * Also patches the realtime/rpc builders, which share the same base.
 */
(function () {
  'use strict';

  var TAG = '[SupaCompat]';

  function addPromiseMethods(proto, label) {
    if (!proto || proto.__mesCompatPatched) return false;
    if (typeof proto.then !== 'function') return false;

    if (typeof proto.catch !== 'function') {
      Object.defineProperty(proto, 'catch', {
        value: function (onrejected) { return this.then(undefined, onrejected); },
        writable: true, configurable: true, enumerable: false
      });
    }
    if (typeof proto.finally !== 'function') {
      Object.defineProperty(proto, 'finally', {
        value: function (onfinally) {
          var run = typeof onfinally === 'function' ? onfinally : function () {};
          return this.then(
            function (v) { run(); return v; },
            function (e) { run(); throw e; }
          );
        },
        writable: true, configurable: true, enumerable: false
      });
    }
    proto.__mesCompatPatched = true;
    console.log('%c' + TAG + ' ✅ .catch()/.finally() added to ' + label,
      'color:#00ff9c;font-weight:700');
    return true;
  }

  /* Walk up a builder instance's prototype chain and patch the first
     prototype that owns `then` (that is PostgrestBuilder.prototype). */
  function patchFromInstance(instance, label) {
    var p = instance;
    var guard = 0;
    while (p && guard++ < 12) {
      p = Object.getPrototypeOf(p);
      if (!p || p === Object.prototype) break;
      if (Object.prototype.hasOwnProperty.call(p, 'then')) {
        return addPromiseMethods(p, label);
      }
    }
    return false;
  }

  var done = false;
  function tryPatch() {
    if (done) return true;
    if (!window.supabase || !window.supabase.createClient) return false;
    try {
      /* Throwaway client — never used for requests, only to reach the
         builder prototypes. No network call is made by building a query. */
      var probe = window.supabase.createClient(
        'https://probe.invalid',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.probe.probe'
      );
      var okSelect = patchFromInstance(probe.from('_probe').select('id'), 'PostgrestBuilder');
      /* rpc() returns a PostgrestFilterBuilder too — same chain, but
         patch defensively in case a future version splits them. */
      patchFromInstance(probe.rpc('_probe'), 'PostgrestRpcBuilder');
      done = okSelect;
      return done;
    } catch (e) {
      console.warn(TAG + ' probe failed:', e && e.message);
      return false;
    }
  }

  if (!tryPatch()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (tryPatch() || ++tries > 120) clearInterval(iv);
    }, 100);
  }

  /* ------------------------------------------------------------------
     Shared button-busy helper used by every admin approve/reject
     handler. Guarantees the spinner is ALWAYS restored — even when the
     handler throws, returns early, or the network hangs up.
     Usage:
        var done = window._btnBusy(evt);   // or _btnBusy(buttonEl)
        try { ... } finally { done(); }
  ------------------------------------------------------------------ */
  window._btnBusy = function (evtOrEl, busyHtml) {
    var btn = null;
    try {
      if (!evtOrEl) btn = null;
      else if (evtOrEl.nodeType === 1) btn = evtOrEl.closest ? (evtOrEl.closest('.btn') || evtOrEl) : evtOrEl;
      else if (evtOrEl.target && evtOrEl.target.closest) btn = evtOrEl.target.closest('.btn') || evtOrEl.target;
      else if (evtOrEl.currentTarget) btn = evtOrEl.currentTarget;
    } catch (e) { btn = null; }

    if (!btn || typeof btn.innerHTML !== 'string') return function () {};

    var prevHtml     = btn.innerHTML;
    var prevDisabled = btn.disabled;
    var prevOpacity  = btn.style.opacity;
    var prevCursor   = btn.style.cursor;
    var restored     = false;

    btn.disabled = true;
    btn.style.opacity = '0.55';
    btn.style.cursor = 'wait';
    btn.innerHTML = busyHtml || '<i class="fas fa-spinner fa-spin"></i>';

    /* Hard safety net: even if a caller forgets to call done(), never
       leave a permanently spinning button on screen. */
    var failsafe = setTimeout(function () { restore(); }, 30000);

    function restore() {
      if (restored) return;
      restored = true;
      clearTimeout(failsafe);
      try {
        btn.disabled = prevDisabled;
        btn.style.opacity = prevOpacity;
        btn.style.cursor = prevCursor;
        btn.innerHTML = prevHtml;
      } catch (e) {}
    }
    return restore;
  };
})();
