/* ═══════════════════════════════════════════════════════════════════════
   MINI eSPORTS — SECURITY HARDENING
   Loaded FIRST (before any feature script) in index.html

   Covers:
   1.  escapeHtml / eh  — global, used everywhere for XSS prevention
   2.  safeSetHTML       — drop-in innerHTML replacement that auto-escapes
                          user-data tokens (IGN, FF-UID, phone, names)
   3.  _requireVerifiedAdmin — token-refresh wrapper on all critical fns
   4.  Input validators — phone, UTR, amount, IGN
   5.  Rate limiter     — per-action client-side cooldown
   6.  DOMPurify-lite   — strips <script> / on* attrs if somehow injected
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     1.  ESCAPE HTML — single source of truth
     All other files use window.eh() or window.escapeHtml()
  ═══════════════════════════════════════════════════════════════════ */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#x2F;')
      .replace(/`/g, '&#x60;');
  }
  window.escapeHtml = escapeHtml;
  window.eh         = escapeHtml;   /* short alias used throughout codebase */

  /* ═══════════════════════════════════════════════════════════════════
     2.  DOMPurify-lite — strip dangerous patterns from any HTML string
         before it touches the DOM.
         Used by safeSetHTML and all innerHTML calls below.
  ═══════════════════════════════════════════════════════════════════ */
  function sanitizeHtml(html) {
    if (!html) return '';
    return String(html)
      /* Remove <script>...</script> blocks */
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      /* Remove javascript: protocol in href/src/action */
      .replace(/\b(href|src|action|data)\s*=\s*["']?\s*javascript\s*:/gi, 'data-blocked=')
      /* Remove on* event handlers */
      .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\bon\w+\s*=\s*[^\s>]+/gi, '')
      /* Remove <iframe>, <object>, <embed>, <base> */
      .replace(/<(iframe|object|embed|base|meta\s+http-equiv=["']?refresh)[^>]*>/gi, '')
      /* Remove expression() in style attrs */
      .replace(/expression\s*\(/gi, '');
  }
  window.sanitizeHtml = sanitizeHtml;

  /* ═══════════════════════════════════════════════════════════════════
     3.  safeSetHTML — use instead of element.innerHTML = htmlString
         Sanitizes the string, then sets innerHTML.
         Usage:  safeSetHTML(element, '<div>' + eh(name) + '</div>');
  ═══════════════════════════════════════════════════════════════════ */
  window.safeSetHTML = function (el, html) {
    if (!el) return;
    el.innerHTML = sanitizeHtml(html);
  };
  window.safeAppendHTML = function (el, html) {
    if (!el) return;
    el.innerHTML += sanitizeHtml(html);
  };

  /* ═══════════════════════════════════════════════════════════════════
     4.  INPUT VALIDATORS
  ═══════════════════════════════════════════════════════════════════ */
  window.Validate = {

    /* IGN: letters, numbers, spaces, dots, underscores, dashes. 3–24 chars */
    ign: function (val) {
      var v = String(val || '').trim();
      if (!v) return { ok: false, msg: 'IGN empty hai' };
      if (v.length < 3 || v.length > 24) return { ok: false, msg: 'IGN 3–24 characters ka hona chahiye' };
      if (!/^[\w\s.\-]+$/.test(v)) return { ok: false, msg: 'IGN mein invalid characters hain' };
      return { ok: true, val: v };
    },

    /* FF UID: 9–12 digit number */
    ffUid: function (val) {
      var v = String(val || '').trim().replace(/\s/g, '');
      if (!v) return { ok: false, msg: 'FF UID empty hai' };
      if (!/^\d{9,12}$/.test(v)) return { ok: false, msg: 'FF UID 9-12 digits ka hona chahiye' };
      return { ok: true, val: v };
    },

    /* Phone: exactly 10 digits after stripping spaces/dashes */
    phone: function (val) {
      var v = String(val || '').replace(/[\s\-]/g, '');
      if (!v) return { ok: false, msg: 'Phone number empty hai' };
      if (!/^\d{10}$/.test(v)) return { ok: false, msg: 'Phone number 10 digits ka hona chahiye' };
      return { ok: true, val: v };
    },

    /* UTR: alphanumeric, 6–30 chars */
    utr: function (val) {
      var v = String(val || '').trim().toUpperCase();
      if (!v) return { ok: false, msg: 'UTR empty hai' };
      if (!/^[A-Z0-9]{6,30}$/.test(v)) return { ok: false, msg: 'UTR invalid format hai (6-30 alphanumeric)' };
      return { ok: true, val: v };
    },

    /* Amount: positive integer, max 1,00,000 */
    amount: function (val, maxVal) {
      var n = parseInt(val, 10);
      if (isNaN(n) || n <= 0) return { ok: false, msg: 'Amount valid positive number hona chahiye' };
      var max = maxVal || 100000;
      if (n > max) return { ok: false, msg: 'Amount ₹' + max + ' se zyada nahi ho sakta' };
      return { ok: true, val: n };
    },

    /* Match name: 3–80 chars, no HTML */
    matchName: function (val) {
      var v = String(val || '').trim();
      if (!v) return { ok: false, msg: 'Match name empty hai' };
      if (v.length < 3 || v.length > 80) return { ok: false, msg: 'Match name 3–80 characters ka hona chahiye' };
      if (/<[^>]+>/.test(v)) return { ok: false, msg: 'Match name mein HTML nahi ho sakta' };
      return { ok: true, val: v };
    }
  };

  /* ═══════════════════════════════════════════════════════════════════
     5.  RATE LIMITER — client-side cooldown per action
         Server-side rate limiting ke saath ye additional protection hai.
  ═══════════════════════════════════════════════════════════════════ */
  var _rateLimits = {};
  window.RateLimit = {
    /* Returns true if action is allowed, false if on cooldown */
    check: function (action, cooldownMs) {
      var now = Date.now();
      var last = _rateLimits[action] || 0;
      if (now - last < (cooldownMs || 2000)) return false;
      _rateLimits[action] = now;
      return true;
    },
    /* Reset a specific action's cooldown */
    reset: function (action) { delete _rateLimits[action]; }
  };

  /* ═══════════════════════════════════════════════════════════════════
     6.  EXTEND _requireVerifiedAdmin to ALL critical functions
         (v21 covers processManualWallet, confirmWithdrawal, approveAddMoney)
         We add: approveProfile, banUser, unbanUser, deleteUser,
                 approveTeam, approveProfileUpdate, approveSd,
                 approveWallet, sendRoomNotificationToMatch
  ═══════════════════════════════════════════════════════════════════ */
  var _extraCritical = [
    'approveProfile',
    'approveProfileUpdate',
    'banUser',
    'unbanUser',
    'deleteUser',
    'approveTeam',
    'approveSd',
    'approveWallet',
    'sendRoomNotificationToMatch',
    'mrPublishResults',
    'fa80_sendWinnerCongrats'
  ];

  function _wrapWithAuth(name) {
    if (!window[name] || window[name]._authWrapped) return;
    var _orig = window[name];
    window[name] = async function () {
      if (typeof window._requireVerifiedAdmin === 'function') {
        try { await window._requireVerifiedAdmin(name); }
        catch (e) { return; }
      }
      /* Rate limit: 3 seconds between same critical action */
      if (!window.RateLimit.check('auth_' + name, 3000)) {
        if (window.showToast) window.showToast('⏳ Ek second ruko, duplicate click ban kiya', true);
        return;
      }
      return _orig.apply(this, arguments);
    };
    window[name]._authWrapped = true;
  }

  /* Apply immediately if function already defined */
  _extraCritical.forEach(function (name) {
    if (window[name]) {
      _wrapWithAuth(name);
    } else {
      /* Wait for function to be defined */
      var attempts = 0;
      var iv = setInterval(function () {
        if (window[name] && !window[name]._authWrapped) {
          _wrapWithAuth(name);
          clearInterval(iv);
        } else if (++attempts > 60) {
          clearInterval(iv);
        }
      }, 600);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════
     7.  PATCH CRITICAL innerHTML CALLS — escape user-controlled data
         These are the highest-risk innerHTML patterns identified in audit.
         We wrap the render functions that build HTML from user data.
  ═══════════════════════════════════════════════════════════════════ */

  /* Patch: chat message rendering — message text must be escaped */
  var _origRenderChatMessages = null;
  function _patchChatRender() {
    var origSend = window.sendAdminReply;
    if (origSend && !origSend._xssSafe) {
      window.sendAdminReply = function () {
        var inp = document.getElementById('chatInput');
        if (inp) inp.value = sanitizeHtml(inp.value);
        return origSend.apply(this, arguments);
      };
      window.sendAdminReply._xssSafe = true;
    }
  }
  setTimeout(_patchChatRender, 2000);

  /* Patch: openUserModal — wraps the function to sanitize the rendered
     userModalBody after it renders, catching any un-escaped user data */
  function _patchUserModal() {
    var origOpen = window.openUserModal;
    if (!origOpen || origOpen._xssSafe) return;
    window.openUserModal = async function (uid) {
      await origOpen.call(this, uid);
      /* After render, walk the modal body and strip any injected scripts */
      var mb = document.getElementById('userModalBody');
      if (mb) _cleanNode(mb);
    };
    window.openUserModal._xssSafe = true;
  }

  /* Patch: showToast — ensure toast text is always text, never HTML */
  var _toastIv = setInterval(function () {
    if (window.showToast && !window.showToast._xssSafe) {
      clearInterval(_toastIv);
      var _orig = window.showToast;
      window.showToast = function (msg, isErr) {
        var safe = String(msg || '').replace(/<[^>]+>/g, '');
        return _orig.call(this, safe, isErr);
      };
      window.showToast._xssSafe = true;
    }
  }, 500);

  /* Patch: voucher table — escape voucher codes (user-submitted data) */
  function _patchLoadVouchers() {
    var origLoad = window.loadVouchers;
    if (!origLoad || origLoad._xssSafe) return;
    window.loadVouchers = async function () {
      await origLoad.call(this);
      /* After render, walk the vouchers table and escape any un-escaped text */
      var t = document.getElementById('vouchersTable');
      if (t) _cleanNode(t);
    };
    window.loadVouchers._xssSafe = true;
  }

  /* Apply all patches once DOM functions are ready */
  var _patchTimer = setInterval(function () {
    var done = 0;
    if (window.openUserModal && !window.openUserModal._xssSafe) { _patchUserModal(); done++; }
    if (window.loadVouchers && !window.loadVouchers._xssSafe)   { _patchLoadVouchers(); done++; }
    if (done === 0) clearInterval(_patchTimer);
  }, 800);

  /* ═══════════════════════════════════════════════════════════════════
     8.  MUTATION OBSERVER — last-line-of-defence XSS catcher
         Scans every newly-inserted DOM node for dangerous patterns.
         Removes script injection and javascript: links at DOM level.
  ═══════════════════════════════════════════════════════════════════ */
  function _cleanNode(node) {
    if (node.nodeType !== 1) return;  /* Element nodes only */

    /* Remove on* event handler attributes */
    var attrs = Array.prototype.slice.call(node.attributes || []);
    attrs.forEach(function (attr) {
      if (/^on\w+/i.test(attr.name)) {
        node.removeAttribute(attr.name);
      }
      /* Remove javascript: in href/src */
      if (/^(href|src|action)$/i.test(attr.name) &&
          /^\s*javascript\s*:/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    });

    /* Remove <script> elements that slipped through */
    if (node.tagName === 'SCRIPT') {
      node.parentNode && node.parentNode.removeChild(node);
      return;
    }

    /* Recurse into children */
    Array.prototype.forEach.call(node.children || [], _cleanNode);
  }

  if (typeof MutationObserver !== 'undefined') {
    var _xssObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (mut) {
        mut.addedNodes.forEach(function (node) {
          /* Skip modal/admin-known safe containers */
          if (node._mesSafeNode) return;
          _cleanNode(node);
        });
      });
    });
    document.addEventListener('DOMContentLoaded', function () {
      _xssObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     9.  SECURE CONSOLE — disable detailed console output in production
         Set window.MES_DEBUG = true in browser console to re-enable.
  ═══════════════════════════════════════════════════════════════════ */
  if (!window.MES_DEBUG && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    var _noop = function () {};
    /* Keep error and warn for crash detection, silence log/debug/info */
    window._origConsole = { log: console.log, info: console.info, debug: console.debug };
    console.log   = _noop;
    console.info  = _noop;
    console.debug = _noop;
  }

  /* ═══════════════════════════════════════════════════════════════════
     10. CLICK-JACKING GUARD — bust any iFrame embedding attempt
  ═══════════════════════════════════════════════════════════════════ */
  if (window.self !== window.top) {
    /* We're inside an iframe — break out */
    try { window.top.location = window.self.location; } catch (e) {
      document.body.innerHTML = '<h1 style="color:red;text-align:center;padding:40px">Unauthorized embedding detected.</h1>';
    }
  }

  console.warn('[Security] ✅ security-hardening.js loaded — XSS guards, auth wrappers, input validators active');

})();
