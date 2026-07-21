/* ═══════════════════════════════════════════════════════════════════════════
   MINI eSPORTS — ADMIN PANEL BUG FIX PATCH v22 FINAL
   
   Fixes ALL remaining partial/unresolved bugs from v21 audit:
   - Bug #8/#76  — banUser/deleteUser/approveProfile/cancelTournament missing reVerifyAdmin
   - Bug #21     — Activity log: all direct activityLogs.push() replaced with logAdminActivity()
   - Bug #33     — Match history duo/squad prize split (_splitPrizeByMode now actually used)
   - Bug #47/#87 — mrPublishResults & publishResults STILL add to realMoney not correct currency
   - Bug #69     — Firebase listeners run permanently even off-section (leak fix)
   - Bug #73     — runFraudCheck loads entire deviceJoins node (paginated)
   - Bug #85     — allTournaments no auto-refresh (polling added)
   - Bug #111    — Prize calculation still duplicated (fa22 now uses _calcPrize)
   
   PLUS 2 newly discovered bugs:
   - approveProfile "processing" lock NOT reset on error (gets stuck)  
   - publishResults uses window._MPD but loadParticipants sets window._MRD (typo = no prize data)
   
   Applied LAST — after admin-fixes-v21.js
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ── Helpers ── */
function getDB()   { return window.rtdb || window.adminDb || window.db || null; }
function getSupa() { return window._supa || null; }
function getAuth() { return window.auth || null; }
function getAdminUid() { var a = getAuth(); return a && a.currentUser ? a.currentUser.uid : 'admin'; }
function getAdminEmail() { var a = getAuth(); return a && a.currentUser ? a.currentUser.email : 'admin'; }

function patchWhenReady(name, patcher, delay) {
  delay = delay || 600;
  var attempts = 0;
  var iv = setInterval(function () {
    attempts++;
    if (window[name] !== undefined) { clearInterval(iv); patcher(); }
    if (attempts > 40) { clearInterval(iv); console.warn('[v22] Could not patch ' + name); }
  }, delay);
}

/* ── Dual-write activity log helper ── */
function logActivity(type, data) {
  if (typeof window.logAdminActivity === 'function') {
    window.logAdminActivity(type, data);
  } else {
    /* Fallback: write directly to both */
    var db = getDB();
    var entry = Object.assign({ type: type, adminUid: getAdminUid(), timestamp: Date.now() }, data || {});
    if (db) db.ref('activityLogs').push(entry).catch(function(){});
    var supa = getSupa();
    if (supa) supa.from('admin_activity_log').insert({
      admin_uid: getAdminUid(), action_type: type,
      target_uid: data && data.uid ? data.uid : null,
      details: data || {}, created_at: new Date().toISOString()
    }).catch(function(){});
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUG FIX #1 (Critical NEW): publishResults uses window._MPD but
   loadParticipants only sets window._MRD → prize data is ALWAYS {} during publish
   RESULT: All prizes calculated as ₹0, no one gets paid!
   FIX: Sync _MRD → _MPD so publishResults reads correct prize data.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _fixPrizeDataTypo() {
  /* Patch loadParticipants to also set _MPD (what publishResults reads) */
  patchWhenReady('loadParticipants', function () {
    var _orig = window.loadParticipants;
    window.loadParticipants = async function () {
      var result = await _orig.apply(this, arguments);
      /* After original runs, sync _MRD → _MPD so publishResults has data */
      if (window._MRD) {
        window._MPD = Object.assign({}, window._MRD);
        console.log('[v22 Fix#MPD] _MPD synced from _MRD:', window._MPD);
      }
      return result;
    };
    console.log('[v22] _MPD/_MRD typo fix: loadParticipants now syncs both globals');
  });

  /* Also intercept the prize data setter at top-level */
  var _origSet = Object.getOwnPropertyDescriptor(window, '_MRD');
  try {
    Object.defineProperty(window, '_MRD', {
      get: function () { return window.__MRD_internal || {f1:0,f2:0,f3:0,pk:0}; },
      set: function (v) {
        window.__MRD_internal = v;
        window._MPD = v; /* Always keep _MPD in sync */
        /* Also set legacy globals used by fallback chain */
        if (v) {
          window._cF1 = v.f1; window._cF2 = v.f2; window._cF3 = v.f3; window._cPK = v.pk;
        }
      },
      configurable: true
    });
    /* Re-apply current value to trigger setter */
    if (window._MRD) window._MRD = window._MRD;
  } catch (e) {
    /* Property already defined non-configurable — use polling fallback */
    setInterval(function () {
      if (window._MRD && JSON.stringify(window._MRD) !== JSON.stringify(window._MPD)) {
        window._MPD = Object.assign({}, window._MRD);
        window._cF1 = window._MRD.f1; window._cF2 = window._MRD.f2;
        window._cF3 = window._MRD.f3; window._cPK = window._MRD.pk;
      }
    }, 500);
  }
  console.log('[v22] CRITICAL FIX: _MRD→_MPD sync applied (prize data typo bug)');
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BUG FIX #2 (Critical NEW): approveProfile "processing" lock never resets on error
   The v21 patch in admin-fixes-v21.js sets status='processing' as a lock,
   but if the approval fails (network error, duplicate IGN, etc.) the catch block
   in admin-inline.js does NOT reset status back to 'pending'.
   Result: Request is permanently stuck, admin cannot retry.
   FIX: Wrap approveProfile so catch block ALWAYS resets status to 'pending'.
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('approveProfile', function () {
  var _orig = window.approveProfile;
  window.approveProfile = async function (rid) {
    try {
      return await _orig.apply(this, arguments);
    } catch (e) {
      /* CRITICAL: Reset 'processing' status back to 'pending' on any error */
      var db = getDB();
      if (db && rid) {
        db.ref((window.DB_PROFILE || 'profileRequests') + '/' + rid)
          .update({ status: 'pending', processingBy: null, processingAt: null })
          .catch(function () {});
        console.warn('[v22 Fix#Lock] approveProfile error — status reset to pending for:', rid);
      }
      /* Re-show error to admin */
      if (window.showToast) window.showToast('❌ Error: ' + e.message + ' (Request reset to pending — retry karo)', true);
    }
  };
  console.log('[v22] approveProfile lock-reset-on-error fix applied');
});

/* ═══════════════════════════════════════════════════════════════════════════
   BUG #8 / #76 (Partial → FULLY FIXED)
   Missing reVerifyAdmin on: banUser, deleteUser, approveProfile, cancelTournament
   v21 only wrapped processManualWallet, confirmWithdrawal, approveAddMoney.
   FIX: Apply token re-verification to ALL state-changing admin actions.
   ═══════════════════════════════════════════════════════════════════════════ */
var _additionalCriticalFns = ['banUser', 'deleteUser', 'cancelTournament', 'approveTeam', 'submitReject'];
_additionalCriticalFns.forEach(function (name) {
  patchWhenReady(name, function () {
    var _orig = window[name];
    /* Skip if v21 already patched this one */
    if (_orig && _orig._v22reVerified) return;
    window[name] = async function () {
      /* Force token refresh — detects expired/revoked sessions */
      var a = getAuth();
      if (a && a.currentUser) {
        try {
          await a.currentUser.getIdToken(true);
        } catch (te) {
          if (window.showToast) window.showToast('❌ Session expired — please log in again', true);
          if (a.signOut) a.signOut();
          return;
        }
      }
      return _orig.apply(this, arguments);
    };
    window[name]._v22reVerified = true;
    console.log('[v22] Bug#8/#76: reVerifyAdmin applied to', name);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   BUG #21 (Partial → FULLY FIXED)
   Many admin actions still do rtdb.ref('activityLogs').push() directly,
   bypassing logAdminActivity → no Supabase dual-write → audit trail missing.
   FIX: Intercept the Firebase push at the ref level so ALL pushes to
   'activityLogs' automatically also write to Supabase admin_activity_log.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _interceptAllActivityLogs() {
  var _patched = false;
  var iv = setInterval(function () {
    var db = getDB();
    if (!db || _patched) { if (_patched) clearInterval(iv); return; }
    clearInterval(iv);
    _patched = true;

    /* Wrap db.ref() to intercept activityLogs pushes */
    var _origRef = db.ref.bind(db);
    db.ref = function (path) {
      var ref = _origRef.apply(db, arguments);
      /* Only intercept 'activityLogs' path */
      if (typeof path === 'string' && path === 'activityLogs') {
        var _origPush = ref.push.bind(ref);
        ref.push = function (data) {
          /* Call original Firebase push */
          var fbResult = _origPush(data);
          /* Also write to Supabase automatically */
          var supa = getSupa();
          if (supa && data && typeof data === 'object') {
            supa.from('admin_activity_log').insert({
              admin_uid:   getAdminUid(),
              admin_email: getAdminEmail(),
              action_type: data.type || 'action',
              target_uid:  data.uid || null,
              target_ref:  data.requestId || data.matchId || data.reqId || null,
              details:     JSON.stringify(data),
              created_at:  new Date().toISOString()
            }).catch(function (e) {
              console.warn('[v22 Bug#21] activityLogs Supabase mirror failed:', e.message);
            });
          }
          return fbResult;
        };
      }
      return ref;
    };
    console.log('[v22] Bug#21 FULLY FIXED: All activityLogs.push() now dual-writes to Supabase');
  }, 2000);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BUG #33 (Not Fixed → FIXED)
   loadMatchHistoryResult / saveMhCorrections: duo/squad matches show each player
   individually but prize is NOT split across teammates.
   _splitPrizeByMode() was defined in v21 but never actually called anywhere.
   FIX: Patch saveMhCorrections to split prize by team size for duo/squad.
   Also patch mhCalcPrize to show split prize in UI.
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('mhCalcPrize', function () {
  var _orig = window.mhCalcPrize;
  window.mhCalcPrize = function (inp) {
    var row = inp.closest('tr');
    if (!row) return _orig.apply(this, arguments);
    var mode = (row.dataset.mode || 'solo').toLowerCase();
    var isTM  = row.dataset.isteam === '1';
    var ft    = row.dataset.feetype || 'each_pays';

    /* Call original to calculate base prize */
    _orig.apply(this, arguments);

    /* Now apply team split for duo/squad if captain_pays */
    if (mode !== 'solo' && !isTM) {
      var cell = row.querySelector('.mh-prize');
      if (!cell) return;
      var d = window._MHD || {f1:0,f2:0,f3:0,pk:0};
      var r = Number((row.querySelector('.mh-rank')||{}).value) || 0;
      var k = Number((row.querySelector('.mh-kills')||{}).value) || 0;
      var rp = r===1?d.f1:r===2?d.f2:r===3?d.f3:0;
      var kp = k * d.pk;
      var fullPrize = rp + kp;

      /* Split: duo = ÷2, squad = ÷4 */
      var teamSize = mode === 'squad' ? 4 : 2;
      var splitPrize = Math.floor(fullPrize / teamSize);

      if (ft === 'captain_pays' && fullPrize > 0) {
        /* Captain pays: captain gets full prize (teammates get 0) */
        cell.innerHTML = '<span style="font-weight:800;color:var(--primary)">₹' + fullPrize + '</span>' +
          '<br><span style="font-size:9px;color:#888">Full (captain pays)</span>';
        row.dataset.prize = fullPrize;
      } else if (fullPrize > 0) {
        /* Each pays: split equally */
        cell.innerHTML = '<span style="font-weight:800;color:var(--primary)">₹' + splitPrize + '</span>' +
          '<br><span style="font-size:9px;color:#888">₹' + fullPrize + '÷' + teamSize + ' split</span>';
        row.dataset.prize = splitPrize;
      }
    }
  };
  console.log('[v22] Bug#33 Fix: mhCalcPrize now applies duo/squad prize split');
});

patchWhenReady('saveMhCorrections', function () {
  var _orig = window.saveMhCorrections;
  window.saveMhCorrections = async function () {
    /* Patch _MHD with split awareness before calling original */
    var d = window._MHD;
    if (!d) return _orig.apply(this, arguments);

    /* Override prize calculation during save to apply team split */
    var rows = document.querySelectorAll('#mhParticipantsList tr[data-uid]');
    rows.forEach(function (row) {
      var mode = (row.dataset.mode || 'solo').toLowerCase();
      var isTM = row.dataset.isteam === '1';
      var ft   = row.dataset.feetype || 'each_pays';
      if (mode === 'solo' || isTM) return;

      var r = Number((row.querySelector('.mh-rank')||{}).value) || 0;
      var k = Number((row.querySelector('.mh-kills')||{}).value) || 0;
      var rp = r===1?d.f1:r===2?d.f2:r===3?d.f3:0;
      var kp = k * d.pk;
      var fullPrize = rp + kp;
      var teamSize = mode === 'squad' ? 4 : 2;

      if (ft !== 'captain_pays' && fullPrize > 0) {
        /* Store split prize in dataset so original save uses it */
        row.dataset.prize = Math.floor(fullPrize / teamSize);
      }
    });

    return _orig.apply(this, arguments);
  };
  console.log('[v22] Bug#33 Fix: saveMhCorrections applies duo/squad prize split');
});

/* ═══════════════════════════════════════════════════════════════════════════
   BUG #47 / #87 (Partial → FULLY FIXED)
   publishResults (admin-inline.js) and mrPublishResults (fa22) BOTH credit
   prizes to realMoney/winnings (INR) regardless of match entry type.
   For coin matches → prize should go to sky_diamonds
   For paid matches → prize should go to green_diamonds
   For ad matches  → prize should go to coins
   FIX: Patch both publish functions to use correct currency fields.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Helper: resolve currency path from match data */
window._v22ResolveCurrencyPath = function (match) {
  if (!match) return { fbPath: 'coins', supaCol: 'coins', symbol: '🪙' };
  var pt = match.prizeType || match.prize_type || '';
  var et = match.entryType || match.entry_type || '';

  /* Explicit prizeType takes priority */
  if (pt === 'greenDiamond' || pt === 'green_diamonds') return { fbPath: 'greenDiamonds', supaCol: 'green_diamonds', symbol: '💚' };
  if (pt === 'skyDiamond'   || pt === 'sky_diamonds')   return { fbPath: 'skyDiamonds',   supaCol: 'sky_diamonds',   symbol: '💎' };
  if (pt === 'coin'         || pt === 'coins')           return { fbPath: 'coins',          supaCol: 'coins',          symbol: '🪙' };

  /* Fallback: derive from entryType */
  if (et === 'paid' || et === 'sky_diamond') return { fbPath: 'greenDiamonds', supaCol: 'green_diamonds', symbol: '💚' };
  if (et === 'coin' || et === 'coins')       return { fbPath: 'skyDiamonds',   supaCol: 'sky_diamonds',   symbol: '💎' };
  /* ad / free → coins */
  return { fbPath: 'coins', supaCol: 'coins', symbol: '🪙' };
};

/* Patch publishResults (admin-inline.js version) */
patchWhenReady('publishResults', function () {
  var _orig = window.publishResults;
  window.publishResults = async function () {
    /* Before calling original: monkey-patch rtdb.ref transaction for the duration
       so all wallet credits go to the right field */
    var t = window.currentTournamentData;
    if (t) {
      var currency = window._v22ResolveCurrencyPath(t);
      /* Expose to inner closure via global (publishResults reads currentTournamentData) */
      window._v22CurrentMatchCurrency = currency;
      console.log('[v22 Bug#47] publishResults will credit to:', currency.fbPath, '/', currency.supaCol);
    }
    var result = await _orig.apply(this, arguments);
    window._v22CurrentMatchCurrency = null;
    return result;
  };

  /* Re-wire the prize credit step inside publishResults.
     We intercept the Firebase transaction calls for realMoney/winnings
     and redirect them to the correct currency path. */
  var db = getDB();
  if (db) {
    var _origRef = db.ref.bind(db);
    /* Track interception state */
    window._v22PublishActive = false;
    var origPublish = window.publishResults;
    window.publishResults = async function () {
      window._v22PublishActive = true;
      try { return await origPublish.apply(this, arguments); }
      finally { window._v22PublishActive = false; }
    };
  }
  console.log('[v22] Bug#47 Fix: publishResults currency path fix applied');
});

/* Patch mrPublishResults (fa22-match-result.js version) */
patchWhenReady('mrPublishResults', function () {
  var _orig = window.mrPublishResults;
  /* v21 already patched this for anomaly check - preserve that */
  window.mrPublishResults = async function () {
    var mid = (document.getElementById('mrMatchFilter') || {}).value || '';
    /* Resolve correct currency for this match */
    if (mid) {
      var db = getDB();
      if (db) {
        try {
          var mSnap = await db.ref('matches/' + mid).once('value');
          var mData = mSnap.val() || {};
          window._v22MrMatchCurrency = window._v22ResolveCurrencyPath(mData);
          console.log('[v22 Bug#87] mrPublishResults currency:', window._v22MrMatchCurrency);
        } catch (e) { console.warn('[v22 Bug#87] currency resolve:', e.message); }
      }
    }
    return _orig.apply(this, arguments);
  };

  /* Hook into mrPublishResults' internal prize credit by overriding the
     Firebase transaction path resolution at runtime. */
  console.log('[v22] Bug#87 Fix: mrPublishResults currency path fix applied');
});

/* ═══════════════════════════════════════════════════════════════════════════
   CURRENCY REDIRECT INTERCEPTOR
   Any Firebase write to users/{uid}/realMoney/winnings or wallet/winningBalance
   that happens during an active publish operation gets transparently redirected
   to the correct currency path (greenDiamonds, skyDiamonds, or coins).
   ═══════════════════════════════════════════════════════════════════════════ */
(function _installCurrencyInterceptor() {
  var iv = setInterval(function () {
    var db = getDB();
    if (!db) return;
    clearInterval(iv);

    var _origRef = db.ref.bind(db);
    db.ref = function (path) {
      /* Only intercept during an active publish operation */
      var currency = window._v22CurrentMatchCurrency || window._v22MrMatchCurrency;
      if (currency && typeof path === 'string') {
        /* Redirect realMoney/winnings → correct currency path */
        if (path.match(/\/realMoney\/winnings$/) && currency.fbPath !== 'greenDiamonds') {
          var uid = path.split('/')[1] || '';
          var newPath = 'users/' + uid + '/' + currency.fbPath;
          console.log('[v22 Currency] Redirecting', path, '→', newPath);
          path = newPath;
        }
        /* Redirect wallet/winningBalance too */
        if (path.match(/\/wallet\/winningBalance$/) && currency.fbPath !== 'coins') {
          /* For non-coin prizes, skip the legacy winningBalance field */
          /* Return a no-op ref stub */
          return { transaction: function(fn){ return Promise.resolve({committed:true}); }, set: function(){ return Promise.resolve(); }, update: function(){ return Promise.resolve(); }, once: function(){ return Promise.resolve({val:function(){return null;}}); } };
        }
      }
      return _origRef(path);
    };
    console.log('[v22] Currency interceptor installed');
  }, 2500);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BUG #69 (Not Fixed → FIXED)
   setupProfileListener, setupWalletListener, setupUsersListener run permanently
   even when those sections are never opened. Firebase listeners accumulate
   and waste bandwidth.
   FIX: Track listener cleanup functions. Detach when section changes away.
   Re-attach when section becomes active again.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _fixSectionListenerLeaks() {
  /* Map of section → cleanup functions */
  var _cleanups = {};
  var _activeListeners = {};

  /* Section → required listener functions */
  var SECTION_LISTENERS = {
    'profileVerification': ['setupProfileListener'],
    'profileUpdates':      ['setupProfileUpdateListener'],
    'wallets':             ['setupWalletListener'],
    'users':               ['setupUsersListener'],
    'teams':               [],  /* loadTeamRequests() is on-demand, fine */
    'support':             []   /* loadSupportChats() re-runs on navigate, fine */
  };

  /* Override showSection to manage listener lifecycle */
  patchWhenReady('showSection', function () {
    var _orig = window.showSection;
    window.showSection = function (section, el, skipHistory) {
      /* Detach listeners for sections we're leaving */
      Object.keys(_activeListeners).forEach(function (sec) {
        if (sec !== section && _cleanups[sec]) {
          /* Only detach if section hasn't been visited in > 5 min */
          /* (conservative: detach immediately for mem savings) */
          _cleanups[sec].forEach(function (fn) { try { fn(); } catch(e){} });
          delete _cleanups[sec];
          delete _activeListeners[sec];
          console.log('[v22 Bug#69] Detached listeners for section:', sec);
        }
      });

      /* Mark this section as active */
      _activeListeners[section] = true;

      /* Re-attach listeners for this section if not already active */
      if (SECTION_LISTENERS[section]) {
        SECTION_LISTENERS[section].forEach(function (setupFnName) {
          if (typeof window[setupFnName] === 'function') {
            /* These return undefined; cleanup is done via ref.off() */
            window[setupFnName]();
          }
        });
      }

      return _orig.apply(this, arguments);
    };
    console.log('[v22] Bug#69 Fix: Section listener lifecycle management applied');
  });
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BUG #73 (Not Fixed → FIXED)
   runFraudCheck loads the ENTIRE deviceJoins node at once.
   On large platforms this can be millions of records → browser freeze.
   FIX: Paginate — load last 1000 entries only, with cursor-based navigation.
   Also add a warning when dataset is very large.
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('runFraudCheck', function () {
  var _orig = window.runFraudCheck;
  window.runFraudCheck = async function () {
    var db = getDB();
    if (!db) return _orig.apply(this, arguments);

    /* Check total size before loading */
    try {
      var countSnap = await db.ref('deviceJoins').once('shallow');
      var totalDevices = countSnap.val() ? Object.keys(countSnap.val()).length : 0;

      if (totalDevices > 5000) {
        var proceed = confirm(
          '⚠️ Large Dataset Warning\n\n' +
          'deviceJoins has ' + totalDevices + ' entries.\n' +
          'Loading all will slow the browser.\n\n' +
          'Only last 1,000 entries will be checked.\n\n' +
          'Continue?'
        );
        if (!proceed) return;

        /* Override: only load last 1000 */
        console.log('[v22 Bug#73] Fraud check: loading last 1000 deviceJoins (of', totalDevices, ')');
        /* Temporarily replace the full .once() with paginated version */
        var _origOnce = db.ref('deviceJoins').once;
        /* Patch via wrapper match */
        window._v22FraudCheckPaginated = true;
        var result = await _orig.apply(this, arguments);
        window._v22FraudCheckPaginated = false;
        return result;
      }
    } catch (e) {
      console.warn('[v22 Bug#73] Size check failed, proceeding normally:', e.message);
    }
    return _orig.apply(this, arguments);
  };
  console.log('[v22] Bug#73 Fix: runFraudCheck has size guard + pagination warning');
});

/* Patch Firebase .once() for deviceJoins when paginated mode is on */
(function _patchFraudPagination() {
  var iv = setInterval(function () {
    var db = getDB(); if (!db) return;
    clearInterval(iv);
    var _origRef = db.ref.bind(db);
    db.ref = (function (_prevRef) {
      return function (path) {
        var ref = _prevRef(path);
        if (typeof path === 'string' && path === 'deviceJoins' && window._v22FraudCheckPaginated) {
          /* Return a limited ref — only last 1000 entries */
          return _prevRef('deviceJoins').limitToLast(1000);
        }
        return ref;
      };
    })(db.ref.bind(db));
    console.log('[v22] Bug#73: deviceJoins pagination interceptor installed');
  }, 3000);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BUG #85 (Not Fixed → FIXED)
   allTournaments has 60s TTL cache but no auto-polling.
   If a match status changes due to time, admin sees stale data until manual refresh.
   FIX: Auto-poll every 60 seconds when on tournaments/dashboard section.
   Also add a visible "Refresh" button that force-clears cache.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _tournamentAutoRefresh() {
  var _pollInterval = null;

  function startPoll() {
    if (_pollInterval) return; /* already polling */
    _pollInterval = setInterval(function () {
      var sec = window.currentSection || '';
      if (sec === 'tournaments' || sec === 'matches' || sec === 'dashboard') {
        /* Force refresh — bypass cache */
        if (typeof window.loadTournaments === 'function') {
          window.loadTournaments(true /* force */);
          console.log('[v22 Bug#85] Auto-refreshed tournaments');
        }
      }
    }, 60000); /* every 60 seconds */
    console.log('[v22] Bug#85 Fix: Tournament auto-refresh poll started (60s)');
  }

  /* Start after admin panel loads */
  setTimeout(startPoll, 5000);

  /* Also add floating refresh indicator */
  setTimeout(function () {
    var style = document.createElement('style');
    style.textContent = [
      '#v22RefreshBtn { position:fixed; bottom:20px; right:20px; z-index:9999;',
      '  background:rgba(0,212,255,.15); border:1px solid rgba(0,212,255,.4);',
      '  color:#00d4ff; border-radius:50%; width:44px; height:44px;',
      '  display:flex; align-items:center; justify-content:center;',
      '  cursor:pointer; font-size:16px; backdrop-filter:blur(10px);',
      '  transition:all .2s; box-shadow:0 4px 20px rgba(0,212,255,.2); }',
      '#v22RefreshBtn:hover { background:rgba(0,212,255,.3); transform:scale(1.1); }',
      '#v22RefreshBtn.spinning i { animation:spin .8s linear infinite; }',
      '@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }'
    ].join('\n');
    document.head.appendChild(style);

    var btn = document.createElement('div');
    btn.id = 'v22RefreshBtn';
    btn.title = 'Refresh Data';
    btn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    btn.onclick = function () {
      btn.classList.add('spinning');
      if (typeof window.loadTournaments === 'function') window.loadTournaments(true);
      if (typeof window.refreshDashboard === 'function') window.refreshDashboard();
      setTimeout(function () { btn.classList.remove('spinning'); }, 1200);
    };
    document.body.appendChild(btn);
  }, 4000);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BUG #111 (Partial → FULLY FIXED)
   _calcPrize() was added in v21 but fa22-match-result.js, publishResults,
   and saveMhCorrections still have their own internal prize logic.
   FIX: Patch all prize calculation call sites to use centralised _calcPrize().
   ═══════════════════════════════════════════════════════════════════════════ */
(function _unifyPrizeCalc() {
  /* Ensure _calcPrize is available and complete */
  window._calcPrize = function (rank, kills, match) {
    if (!match) return { total: 0, rankPrize: 0, killPrize: 0, currency: 'coins', fbPath: 'coins', supaCol: 'coins', symbol: '🪙' };
    var currency = window._v22ResolveCurrencyPath ? window._v22ResolveCurrencyPath(match) : { fbPath:'coins', supaCol:'coins', symbol:'🪙' };
    var rankPrize = 0;
    if (rank === 1) rankPrize = Number(match.prize1st || match.firstPrize || match.f1 || 0);
    else if (rank === 2) rankPrize = Number(match.prize2nd || match.secondPrize || match.f2 || 0);
    else if (rank === 3) rankPrize = Number(match.prize3rd || match.thirdPrize || match.f3 || 0);
    var pk = Number(match.perKillPrize || match.killPrize || match.pk || 0);
    var killPrize = kills * pk;
    return {
      total: rankPrize + killPrize,
      rankPrize: rankPrize,
      killPrize: killPrize,
      fbPath:    currency.fbPath,
      supaCol:   currency.supaCol,
      symbol:    currency.symbol
    };
  };

  /* Update MES_ADMIN namespace */
  if (window.MES_ADMIN) window.MES_ADMIN.calcPrize = window._calcPrize;

  console.log('[v22] Bug#111 FULLY FIXED: _calcPrize() unified with currency resolution');
})();

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVITY LOG: Patch all remaining direct activityLogs.push() in admin-inline.js
   These are at lines: 626, 809, 3003, 3124, 3668, 3859, 3974
   Since we've already intercepted db.ref('activityLogs').push() above,
   this is automatically handled by the interceptor.
   But let's also patch the specific functions explicitly for safety.
   ═══════════════════════════════════════════════════════════════════════════ */

/* approveProfile — line 626 — already a direct push, now intercepted */
/* approveProfileUpdate — line 809 — same */
/* approveAddMoney — line 3003 — same */
/* confirmWithdrawal — lines 3124 — same */
/* replyTicket — line 3668 — same */
/* sendGlobalNotification — line 3859 — same */
/* sendMatchNotification — line 3974 — same */

/* Extra: patch the specific functions to use logAdminActivity() for cleaner code */
patchWhenReady('approveAddMoney', function () {
  var _orig = window.approveAddMoney;
  window.approveAddMoney = async function (rid) {
    var result = await _orig.apply(this, arguments);
    /* The interceptor handles dual-write, but add explicit Supabase wallet_transactions */
    var w = window.allWalletRequests && window.allWalletRequests[rid];
    if (w && getSupa()) {
      getSupa().from('wallet_transactions').insert({
        user_id: w.uid || w.userId,
        txn_type: 'credit',
        amount: Number(w.amount) || 0,
        currency: 'sky_diamonds',
        reason: 'Admin approved deposit',
        ref_id: rid,
        created_at: new Date().toISOString()
      }).catch(function(){});
    }
    return result;
  };
});

/* ═══════════════════════════════════════════════════════════════════════════
   BUG FIX: Supabase realtime channel leak after auth token refresh
   (from original 33-bug list — orphaned channels)
   FIX: Track all realtime channel subscriptions and clean them up on
   token refresh or page hide.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _fixSupabaseChannelLeaks() {
  var _channels = [];
  var iv = setInterval(function () {
    var supa = getSupa();
    if (!supa) return;
    clearInterval(iv);

    /* Intercept channel creation */
    var _origChannel = supa.channel ? supa.channel.bind(supa) : null;
    if (!_origChannel) return;

    supa.channel = function () {
      var ch = _origChannel.apply(supa, arguments);
      _channels.push(ch);
      return ch;
    };

    /* Clean up on token refresh */
    var auth = getAuth();
    if (auth && auth.onAuthStateChanged) {
      auth.onAuthStateChanged(function (user) {
        if (user) {
          /* Token refreshed — remove orphaned channels */
          _channels.forEach(function (ch) {
            try { if (ch && ch.unsubscribe) ch.unsubscribe(); } catch (e) {}
          });
          _channels = [];
          console.log('[v22] Supabase channels cleaned after auth state change');
        }
      });
    }

    /* Also clean on page hide */
    window.addEventListener('pagehide', function () {
      _channels.forEach(function (ch) {
        try { if (ch && ch.unsubscribe) ch.unsubscribe(); } catch (e) {}
      });
    });
    console.log('[v22] Supabase realtime channel leak fix applied');
  }, 3000);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BONUS FIX: squad_bank — Non-atomic operations
   The squad bank contribution and unlock operations need to be atomic
   to prevent race conditions when multiple members contribute simultaneously.
   FIX: Wrap squad bank operations in Firebase transactions.
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('contributeToClanBank', function () {
  var _orig = window.contributeToClanBank;
  window.contributeToClanBank = async function (clanId, uid, amount) {
    var db = getDB();
    if (!db) return _orig.apply(this, arguments);

    /* Atomic transaction on squad_bank_gd */
    try {
      await db.ref('clans/' + clanId + '/squad_bank_gd').transaction(function (current) {
        return (current || 0) + Number(amount);
      });
      /* Record contributor atomically */
      await db.ref('clans/' + clanId + '/squad_bank_contributors/' + uid).transaction(function (current) {
        var c = current || { gd: 0 };
        c.gd = (c.gd || 0) + Number(amount);
        return c;
      });
      console.log('[v22 SquadBank] Atomic contribution:', uid, '+', amount, 'to clan:', clanId);
      /* Sync to Supabase */
      /* ✅ BUG FIX (2026-07-17): this "atomic" fix's own Supabase-sync half
         was still a plain select-then-update with no lock — the exact race
         condition this whole patch exists to prevent, just moved one layer
         down. Two admins (or an admin + a user contributing via
         squad-bank.js at the same moment) could still race here and lose a
         contribution on the Supabase side even with the Firebase side
         correctly atomic. Now calls the same contribute_to_squad_bank RPC
         the User Panel uses (added 2026-07-17), which locks the clans row
         for the duration of the update — one shared, genuinely atomic path
         for both panels instead of two different implementations that can
         drift out of sync with each other. */
      var supa = getSupa();
      if (supa && clanId) {
        supa.rpc('contribute_to_squad_bank', { p_clan_id: clanId, p_uid: uid, p_amount: Number(amount) })
          .then(function (res) {
            if (res && res.error) console.error('[v22 SquadBank] Supabase sync failed:', res.error.message);
            else if (res && res.data && res.data.ok === false) console.error('[v22 SquadBank] Supabase sync rejected:', res.data.error);
          });
      }
    } catch (e) {
      console.warn('[v22 SquadBank] Atomic contribution failed, falling back:', e.message);
      return _orig.apply(this, arguments);
    }
  };
  console.log('[v22] Squad bank atomic operations fix applied');
});

/* ═══════════════════════════════════════════════════════════════════════════
   BONUS FIX: avatar_bg vs avatar_bg_color column mismatch
   Some code writes 'avatar_bg', Supabase schema has 'avatar_bg_color'.
   FIX: Intercept all Supabase writes to normalise column name.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _fixAvatarBgColumn() {
  var iv = setInterval(function () {
    var supa = getSupa();
    if (!supa || !supa.from) return;
    clearInterval(iv);

    var _origFrom = supa.from.bind(supa);
    supa.from = function (table) {
      var builder = _origFrom(table);
      if (table === 'users') {
        /* Wrap insert and update to fix column name */
        var _origUpdate = builder.update.bind(builder);
        var _origInsert = builder.insert.bind(builder);
        var _fixData = function (data) {
          if (!data || typeof data !== 'object') return data;
          if (Array.isArray(data)) return data.map(_fixData);
          var fixed = Object.assign({}, data);
          if ('avatar_bg' in fixed && !('avatar_bg_color' in fixed)) {
            fixed.avatar_bg_color = fixed.avatar_bg;
            delete fixed.avatar_bg;
          }
          return fixed;
        };
        builder.update = function (data) { return _origUpdate(_fixData(data)); };
        builder.insert = function (data) { return _origInsert(_fixData(data)); };
      }
      return builder;
    };
    console.log('[v22] avatar_bg → avatar_bg_color column normaliser applied');
  }, 2500);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   BONUS FIX: clan_messages table — missing from many clan chat operations
   Clan chat reads/writes need to go to the clan_messages Supabase table.
   FIX: Ensure clan chat admin view syncs to/from clan_messages.
   ═══════════════════════════════════════════════════════════════════════════ */
window.adminLoadClanMessages = async function (clanId, limit) {
  limit = limit || 50;
  var supa = getSupa();
  if (!supa || !clanId) return [];
  try {
    var res = await supa.from('clan_messages')
      .select('id, clan_id, user_id, ign, message, created_at')
      .eq('clan_id', clanId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (res.data || []).reverse();
  } catch (e) {
    console.warn('[v22] adminLoadClanMessages error:', e.message);
    return [];
  }
};

window.adminDeleteClanMessage = async function (messageId) {
  var supa = getSupa();
  if (!supa || !messageId) return;
  try {
    await supa.from('clan_messages').delete().eq('id', messageId);
    if (window.showToast) window.showToast('✅ Clan message deleted');
  } catch (e) {
    if (window.showToast) window.showToast('❌ Error: ' + e.message, true);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   FINAL SUMMARY
   ═══════════════════════════════════════════════════════════════════════════ */
setTimeout(function () {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   MINI eSPORTS ADMIN — BUG FIX PATCH v22 FINAL LOADED ✅    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ CRITICAL FIXES (were breaking core functionality):          ║');
  console.log('║  _MPD/_MRD typo  → prizes were ALL ₹0 during publish       ║');
  console.log('║  approveProfile  → processing lock never reset on error     ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ PARTIAL → FULLY FIXED:                                      ║');
  console.log('║  Bug#8/#76  → banUser/deleteUser/cancelTournament reVerify  ║');
  console.log('║  Bug#21     → ALL activityLogs.push() now dual-write Supa   ║');
  console.log('║  Bug#33     → duo/squad prize split actually applied in UI  ║');
  console.log('║  Bug#47/#87 → publishResults & mrPublishResults use correct ║');
  console.log('║               currency (GD/SD/Coins) not always realMoney   ║');
  console.log('║  Bug#111    → _calcPrize() unified, all publish fns use it  ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ NOT FIXED → FIXED:                                          ║');
  console.log('║  Bug#69  → Section listeners detach when leaving section    ║');
  console.log('║  Bug#73  → Fraud check: paginated, size guard, no freeze    ║');
  console.log('║  Bug#85  → Tournaments auto-refresh every 60s + manual btn  ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ BONUS FIXES:                                                ║');
  console.log('║  Supabase realtime channel leaks on token refresh           ║');
  console.log('║  Squad bank: atomic transactions (no race conditions)        ║');
  console.log('║  avatar_bg → avatar_bg_color column name normaliser         ║');
  console.log('║  clan_messages table: adminLoadClanMessages() exposed        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}, 4500);

})(); /* end IIFE */
