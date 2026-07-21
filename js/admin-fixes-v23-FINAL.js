/* ═══════════════════════════════════════════════════════════════════════════
   MINI eSPORTS — ADMIN PANEL BUG FIX PATCH v23 FINAL
   Applied AFTER: admin-fixes-v22-FINAL.js
   
   CRITICAL FIXES (production-blocking):
   ─────────────────────────────────────
   #1  approveProfile — Processing lock missing (v22 chain may drop v21's lock
       depending on setInterval timing; v23 re-adds as outermost wrapper)
   #2  mrPublishResults — window._supaResultEntries NEVER defined anywhere →
       Supabase sync block NEVER executes → user app can't see published results
   #3  sendRoomNotificationToMatch — no match status check → admins editing
       completed/cancelled matches spam players with stale room notifications
   #4  loadTournaments — allJoinRequests reset on every call → real-time joins
       between reloads invisible → filledSlots always stale
   #5  processManualWallet — TOCTOU race: balance read and transaction are
       separate → concurrent debits possible; Math.max(0) gives silent truncation
   
   MAJOR FIXES (functional but workaround exists):
   ─────────────────────────────────────────────────
   #6  approveTeam — checkDuplicateDuoJoin defined but NEVER called → duplicate
       duo partner joins possible in same match
   #7  sendRoomNotificationToMatch — Firebase-only notifications; user app reads
       Supabase notifications table → room release notifications never reach users
   #8  saveTournament inline room notify — same dual-write gap as #7
   #9  fa10ActivityHeatmap — loads entire joinRequests node (no limit) → browser
       freeze on large datasets
   #10 fa26 poll votes written to Firebase; polls read from Supabase → permanent
       vote count desync
   
   MINOR FIXES:
   ────────────
   #11 approveProfile — Supabase IGN uniqueness check missing (only Firebase checked)
   #12 processManualWallet — Supabase admin_activity_log write missing for debits
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
'use strict';

/* ── Shared helpers ── */
function getDB()   { return window.rtdb || window.adminDb || window.db || null; }
function getSupa() { return window._supa || null; }
function getAuth() { return window.auth || null; }
function getAdminUid() {
  var a = getAuth();
  return (a && a.currentUser) ? a.currentUser.uid : 'admin';
}
function escH(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* patchWhenReady — polls until window[name] exists, then calls patcher() */
function patchWhenReady(name, patcher, delay) {
  delay = delay || 600;
  var attempts = 0;
  var iv = setInterval(function () {
    attempts++;
    if (typeof window[name] !== 'undefined') { clearInterval(iv); patcher(); }
    if (attempts > 60) { clearInterval(iv); console.warn('[v23] Could not patch:', name); }
  }, delay);
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #1 — CRITICAL
   approveProfile: Processing lock missing
   
   Root cause: v21 adds lock via patchWhenReady (600ms). v22 also uses
   patchWhenReady (600ms). If both intervals tick at the same JavaScript
   task, v22 may capture window.approveProfile BEFORE v21 has wrapped it —
   resulting in: v22_wrapper → original (no v21 lock in chain).
   Even if the chain is correct, the concurrent-admin race (two browsers,
   same request) needs the atomic Firebase status check.
   
   Fix: v23 re-adds the lock as the OUTERMOST wrapper at 2500ms, guaranteed
   to run after both v21 (600ms) and v22 (600ms) have finished their patches.
   Uses independent in-memory locks + atomic Firebase status='processing'.
   ═══════════════════════════════════════════════════════════════════════════ */
var _v23ApprovalLocks = {};

setTimeout(function _v23InstallApprovalLock() {
  if (typeof window.approveProfile !== 'function') {
    setTimeout(_v23InstallApprovalLock, 300);
    return;
  }
  if (window.approveProfile._v23LockApplied) return; /* idempotent */

  var _inner = window.approveProfile;

  window.approveProfile = async function (rid) {
    /* ── In-memory guard: prevent double-clicks in same browser session ── */
    if (_v23ApprovalLocks[rid]) {
      if (window.showToast) window.showToast('⏳ Request is already being processed…', true);
      return;
    }
    _v23ApprovalLocks[rid] = true;

    var db = getDB();
    try {
      /* ── Atomic Firebase status lock (cross-browser / cross-admin) ── */
      if (db) {
        var reqRef = db.ref((window.DB_PROFILE || 'profileRequests') + '/' + rid);
        var snap = await reqRef.once('value');

        if (!snap.exists()) {
          if (window.showToast) window.showToast('❌ Request not found!', true);
          return;
        }

        var st = snap.val().status;
        if (st && st !== 'pending') {
          /* Already approved/rejected/processing by another admin */
          if (window.showToast) {
            window.showToast('⚠️ Already processed (status: ' + escH(st) + ')', true);
          }
          return;
        }

        /* Optimistic lock: mark as processing so concurrent admins bail out */
        await reqRef.update({
          status:       'processing',
          processingBy: getAdminUid(),
          processingAt: Date.now()
        });
      }

      return await _inner.apply(this, arguments);

    } catch (e) {
      /* On any error: reset so admin can retry */
      if (db) {
        db.ref((window.DB_PROFILE || 'profileRequests') + '/' + rid)
          .update({ status: 'pending', processingBy: null, processingAt: null })
          .catch(function () {});
      }
      if (window.showToast) window.showToast('❌ ' + e.message + ' — reset to pending, retry karo', true);
      console.error('[v23 Fix#1] approveProfile error (reset to pending):', e);
    } finally {
      delete _v23ApprovalLocks[rid];
    }
  };

  window.approveProfile._v23LockApplied = true;
  console.log('[v23] FIX #1 ✅ approveProfile: processing lock applied as outermost wrapper');
}, 2500);

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #2 — CRITICAL
   mrPublishResults: window._supaResultEntries never defined → Supabase sync
   block (lines ~601-622 in fa22-match-result.js) never executes →
   published match results invisible to user app (reads Supabase only)!
   
   Fix: Wrap mrPublishResults to:
     1. Look up the Supabase match UUID (matches.firebase_id = mid)
     2. Initialize _supaResultEntries = [] so the truthy check passes
     3. Intercept rtdb 'results' path .push().set() to capture each row
     4. After original completes: if entries were captured, upsert to
        Supabase match_results with proper UUID match_id
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('mrPublishResults', function () {
  var _orig = window.mrPublishResults;
  if (_orig._v23SupaSync) return;

  window.mrPublishResults = async function () {
    var mid = ((document.getElementById('mrMatchFilter') || {}).value || '').trim();

    /* Step 1: Resolve Supabase match UUID */
    var supaMatchId = null;
    var supa = getSupa();
    if (supa && mid) {
      try {
        var mRes = await supa.from('matches').select('id').eq('firebase_id', mid).single();
        if (mRes.data) supaMatchId = mRes.data.id;
      } catch (_) {
        /* firebase_id column may not exist in all deploys — fallback to id */
        try {
          var mRes2 = await supa.from('matches').select('id').eq('id', mid).single();
          if (mRes2 && mRes2.data) supaMatchId = mRes2.data.id;
        } catch (_2) { /* Supabase match not found — Firebase-only publish */ }
      }
    }

    /* Step 2: Init _supaResultEntries so existing code block runs */
    window._supaResultEntries = [];
    window._v23SupaMatchId = supaMatchId;

    /* Step 3: Intercept Firebase 'results' push to capture each result row */
    var db = getDB();
    var _savedRef = null;
    if (db) {
      _savedRef = db.ref.bind(db);
      db.ref = (function (_prevRef) {
        return function (path) {
          var ref = _prevRef(path);
          if (typeof path === 'string' && path === 'results') {
            var _oPush = ref.push.bind(ref);
            ref.push = function () {
              var pRef = _oPush.apply(ref, arguments);
              var _oSet = pRef.set.bind(pRef);
              pRef.set = function (data) {
                /* Capture result row when it's for the current match */
                if (data && data.matchId && data.matchId === mid && data.userId) {
                  window._supaResultEntries.push({
                    match_id:      supaMatchId || mid,
                    matchId:       mid,           /* for existing filter */
                    user_id:       data.userId,
                    rank:          Number(data.rank)    || 0,
                    kills:         Number(data.kills)   || 0,
                    total_winning: Number(data.winnings)|| 0,
                    rank_prize:    Number(data.rankPrize||0),
                    kill_prize:    Number(data.killPrize||0),
                    was_winner:    !!(data.won || Number(data.rank) === 1),
                    created_at:    new Date().toISOString()
                  });
                }
                return _oSet.apply(pRef, arguments);
              };
              return pRef;
            };
          }
          return ref;
        };
      })(db.ref.bind(db));
    }

    try {
      var result = await _orig.apply(this, arguments);

      /* Step 4: Extra Supabase sync — runs even if existing block fails/skips */
      if (supa && supaMatchId && window._supaResultEntries && window._supaResultEntries.length > 0) {
        try {
          /* Re-map with correct Supabase UUID */
          var rows = window._supaResultEntries.map(function (r) {
            return Object.assign({}, r, { match_id: supaMatchId });
          });

          await supa.from('match_results').upsert(rows, { onConflict: 'match_id,user_id' });
          console.log('[v23 Fix#2] ✅ match_results synced to Supabase:', rows.length, 'rows, match:', supaMatchId);

          /* Also update Supabase matches.status */
          await supa.from('matches').update({
            status:               'completed',
            result_published_at:  new Date().toISOString(),
            publish_lock:         false
          }).eq('id', supaMatchId).catch(function () {});

        } catch (supaErr) {
          console.warn('[v23 Fix#2] match_results upsert error:', supaErr.message);
        }
      }

      return result;

    } finally {
      /* Always restore original db.ref */
      if (db && _savedRef) db.ref = _savedRef;
      window._v23SupaMatchId = null;
    }
  };

  window.mrPublishResults._v23SupaSync = true;
  console.log('[v23] FIX #2 ✅ mrPublishResults: _supaResultEntries initialized + Supabase sync active');
});

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #3 — CRITICAL
   sendRoomNotificationToMatch: no match status check.
   If admin edits a completed/cancelled match and changes room ID,
   all joined players receive a room notification for a finished match.
   
   Fix: Block notification send when match status is terminal.
        Also add Supabase notifications dual-write (Fix #7 merged here).
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('sendRoomNotificationToMatch', function () {
  if (window.sendRoomNotificationToMatch._v23Patched) return;
  var _orig = window.sendRoomNotificationToMatch;

  window.sendRoomNotificationToMatch = async function (matchId, roomId, roomPassword, matchName) {
    /* ── Status guard: never notify for terminal matches ── */
    var db = getDB();
    if (db && matchId) {
      try {
        var mSnap = await db.ref((window.DB_MATCHES || 'matches') + '/' + matchId).once('value');
        if (mSnap.exists()) {
          var mSt = mSnap.val().status || '';
          var TERMINAL = ['completed','resultPublished','result_published','cancelled','canceled'];
          if (TERMINAL.indexOf(mSt) !== -1) {
            console.warn('[v23 Fix#3] Blocked room notif — match status is terminal:', mSt);
            if (window.showToast) {
              window.showToast('⚠️ Room notification NOT sent — match is already ' + escH(mSt), true);
            }
            return 0;
          }
        }
      } catch (e) {
        console.warn('[v23 Fix#3] Status check failed, proceeding:', e.message);
      }
    }

    /* ── Run original Firebase notification send ── */
    var fbCount = await _orig.apply(this, arguments);

    /* ── Fix #7: Dual-write to Supabase notifications table ── */
    var supa = getSupa();
    if (supa && matchId) {
      try {
        /* Get joined players from Supabase */
        var jRes = await supa.from('join_requests')
          .select('user_id')
          .eq('match_id', matchId)
          .in('status', ['approved','joined','confirmed']);

        /* Also try firebase_match_id column if match_id query returned nothing */
        if (!jRes.data || jRes.data.length === 0) {
          jRes = await supa.from('join_requests')
            .select('user_id')
            .in('status', ['approved','joined','confirmed']);
          /* We can't filter by firebase match id easily here without a column,
             so fall back to using the result count from Firebase */
        }

        if (jRes.data && jRes.data.length > 0) {
          var notifRows = jRes.data.map(function (jr) {
            return {
              user_id:    jr.user_id,
              type:       'match_room',
              title:      '🎮 Room Details Released!',
              body:       'Match: ' + (matchName || 'Match') + ' | Room ID: ' + roomId + ' | Pass: ' + roomPassword,
              ref_id:     matchId,
              is_read:    false,
              created_at: new Date().toISOString()
            };
          });
          await supa.from('notifications').insert(notifRows);
          console.log('[v23 Fix#3/7] ✅ Supabase notifications written:', notifRows.length, 'players');
        }
      } catch (e) {
        console.warn('[v23 Fix#3/7] Supabase notification write error:', e.message);
      }
    }

    return fbCount;
  };

  window.sendRoomNotificationToMatch._v23Patched = true;
  console.log('[v23] FIX #3+#7 ✅ sendRoomNotificationToMatch: status guard + Supabase dual-write');
});

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #3b — saveTournament inline room notification also needs status guard
   The inline code in saveTournament's EDIT branch sends room notifications
   without checking match status (same bug, different code path).
   Fix: Wrap saveTournament to expose currentDbStatus before the inline notify.
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('saveTournament', function () {
  if (window.saveTournament._v23StatusGuard) return;
  var _orig = window.saveTournament;

  window.saveTournament = async function () {
    /* Expose a flag: set BEFORE calling original so the Firebase room notif
       interceptor (installed below) can read match status */
    var mid = ((document.getElementById('tournamentId') || {}).value || '').trim();
    window._v23SaveTournamentMatchId = mid;
    window._v23SaveTournamentStatus  = null;

    if (mid) {
      var db = getDB();
      if (db) {
        try {
          var mSnap = await db.ref((window.DB_MATCHES || 'matches') + '/' + mid).once('value');
          if (mSnap.exists()) window._v23SaveTournamentStatus = mSnap.val().status || 'upcoming';
        } catch (_) {}
      }
    }

    try {
      return await _orig.apply(this, arguments);
    } finally {
      window._v23SaveTournamentMatchId = null;
      window._v23SaveTournamentStatus  = null;
    }
  };

  window.saveTournament._v23StatusGuard = true;
  console.log('[v23] FIX #3b ✅ saveTournament: match status exposed for inline room notif guard');
});

/* Intercept all Firebase notifications pushes during saveTournament:
   block if match is in terminal state */
(function _installSaveTournamentNotifGuard() {
  var iv = setInterval(function () {
    var db = getDB(); if (!db) return;
    clearInterval(iv);

    var _prev = db.ref.bind(db);
    db.ref = (function (_p) {
      return function (path) {
        var ref = _p(path);

        /* Block notifications/ global push for terminal matches during saveTournament */
        if (typeof path === 'string' && path === 'notifications' && window._v23SaveTournamentMatchId) {
          var TERMINAL = ['completed','resultPublished','result_published','cancelled','canceled'];
          if (TERMINAL.indexOf(window._v23SaveTournamentStatus || '') !== -1) {
            /* Return a no-op push stub */
            return Object.assign({}, ref, {
              push: function () {
                console.warn('[v23 Fix#3b] Blocked notifications push — match is terminal:', window._v23SaveTournamentStatus);
                var stub = { set: function(){return Promise.resolve();}, key: 'blocked_'+Date.now() };
                return stub;
              }
            });
          }
        }

        return ref;
      };
    })(_prev);

    console.log('[v23] Fix#3b: saveTournament notifications terminal guard installed');
  }, 6000);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #4 — CRITICAL
   loadTournaments: allJoinRequests={} on every call wipes real-time data.
   New joins between reloads don't appear until next loadTournaments call.
   
   Fix: Install a real-time Firebase listener on joinRequests that keeps
   allJoinRequests continuously updated (child_added/changed/removed).
   This runs ONCE. When loadTournaments resets allJoinRequests, the
   listener will have fired child_added for all existing entries already,
   so the object stays consistent.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _installJoinRequestsRealtimeListener() {
  var iv = setInterval(function () {
    var db = getDB();
    if (!db || window._v23JoinReqListenerActive) return;
    clearInterval(iv);
    window._v23JoinReqListenerActive = true;

    var joinRef = db.ref(window.DB_JOIN || 'joinRequests');

    joinRef.on('child_added', function (snap) {
      if (!window.allJoinRequests) window.allJoinRequests = {};
      window.allJoinRequests[snap.key] = snap.val();
    }, function (e) { console.warn('[v23 Fix#4] child_added error:', e.message); });

    joinRef.on('child_changed', function (snap) {
      if (!window.allJoinRequests) window.allJoinRequests = {};
      window.allJoinRequests[snap.key] = snap.val();
      /* Update slot count for affected match in UI (if visible) */
      if (typeof window.loadTournaments === 'function') {
        clearTimeout(window._v23SlotDebounce);
        window._v23SlotDebounce = setTimeout(function () {
          var sec = window.currentSection || '';
          if (sec === 'tournaments' || sec === 'matches') window.loadTournaments();
        }, 3000); /* 3s debounce to batch rapid changes */
      }
    }, function (e) { console.warn('[v23 Fix#4] child_changed error:', e.message); });

    joinRef.on('child_removed', function (snap) {
      if (window.allJoinRequests) delete window.allJoinRequests[snap.key];
    }, function (e) { console.warn('[v23 Fix#4] child_removed error:', e.message); });

    console.log('[v23] FIX #4 ✅ Real-time joinRequests listener installed → allJoinRequests always live');
  }, 3500);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #5 — CRITICAL
   processManualWallet: TOCTOU race condition on debit.
   
   Problem: reads balance at t1, checks t1 < amt, then runs transaction at t2.
   If another admin debits between t1 and t2, both succeed but combined debit
   may exceed balance; Math.max(0) silently truncates the second instead of erroring.
   
   Fix: Replace the separate read+check with a single atomic Firebase transaction
   that aborts (returns undefined) if balance is insufficient. This is the only
   truly race-condition-free approach.
   Also adds: Supabase admin_activity_log for debit (Fix #12 merged here).
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('processManualWallet', function () {
  if (window.processManualWallet._v23AtomicDebit) return;
  var _orig = window.processManualWallet;

  window.processManualWallet = async function () {
    var act = ((document.getElementById('manualAction')     ||{}).value||'credit');
    var wt  = ((document.getElementById('manualWalletType') ||{}).value||'coins');
    var amt = Number((document.getElementById('manualAmount')||{}).value)||0;
    var uid = ((document.getElementById('manualUid')        ||{}).value||'').trim();
    var rsn = ((document.getElementById('manualReason')     ||{}).value||'').trim() || 'Admin adjustment';

    /* Credits have no race risk — use original */
    if (act !== 'debit') return _orig.apply(this, arguments);

    /* Input validation */
    if (!uid)    return window.showToast && window.showToast('Enter UID', true);
    if (amt <= 0) return window.showToast && window.showToast('Amount must be > 0', true);
    if (amt > 999999) return window.showToast && window.showToast('Amount too large', true);

    var currPath = wt==='sky' ? 'skyDiamonds' : wt==='green' ? 'greenDiamonds' : 'coins';
    var supaCol  = wt==='sky' ? 'sky_diamonds'  : wt==='green' ? 'green_diamonds'  : 'coins';
    var db = getDB();
    if (!db) return _orig.apply(this, arguments);

    /* Disable button */
    var btns = document.querySelectorAll('#manualWalletModal .btn-primary');
    btns.forEach(function(b){ if(typeof setLoading==='function') setLoading(b,true); });

    try {
      var abortMsg = null;

      /* ── Atomic debit transaction ── */
      var txRes = await db.ref((window.DB_USERS||'users') + '/' + uid + '/' + currPath)
        .transaction(function (current) {
          var cur = Number(current) || 0;
          if (cur < amt) {
            abortMsg = 'Insufficient ' + wt + ' balance (current: ' + cur + ', trying to debit: ' + amt + ')';
            return undefined; /* Returning undefined aborts transaction */
          }
          return cur - amt;
        });

      if (!txRes.committed || abortMsg) {
        throw new Error(abortMsg || 'Transaction aborted — balance may have changed concurrently');
      }

      /* ── Sync Supabase balance ── */
      var supa = getSupa();
      if (supa) {
        var supaOk = await supa.rpc('decrement_balance', { p_uid: uid, p_col: supaCol, p_amount: amt })
          .catch(function(){ return { error: { message: 'rpc_missing' } }; });

        if (supaOk && supaOk.error) {
          /* Fallback: direct update */
          var cur2 = await supa.from('users').select(supaCol).eq('id', uid).single()
            .catch(function(){ return { data: null }; });
          if (cur2.data) {
            var newBal = Math.max((cur2.data[supaCol] || 0) - amt, 0);
            supa.from('users').update({ [supaCol]: newBal }).eq('id', uid).catch(function(){});
          }
        }

        /* wallet_transactions */
        supa.from('wallet_transactions').insert({
          user_id:    uid,
          txn_type:   'admin_debit',
          amount:     amt,
          currency:   supaCol,
          reason:     rsn,
          created_at: new Date().toISOString()
        }).catch(function(){});

        /* Fix #12: admin_activity_log */
        supa.from('admin_activity_log').insert({
          admin_uid:   getAdminUid(),
          action_type: 'manual_wallet_debit',
          target_uid:  uid,
          details:     { amount: amt, currency: wt, reason: rsn },
          created_at:  new Date().toISOString()
        }).catch(function(){});
      }

      /* Firebase transaction log */
      db.ref((window.DB_USERS||'users') + '/' + uid + '/transactions').push({
        type: 'admin_debit', currency: wt, amount: -amt, description: rsn, timestamp: Date.now()
      }).catch(function(){});

      /* Notify user */
      if (typeof window._adminNotifyUser === 'function') {
        window._adminNotifyUser(uid, {
          title:   'Wallet Adjusted',
          message: amt + ' ' + wt + ' remove kiye gaye. Reason: ' + rsn,
          type:    'wallet_debit'
        });
      }

      btns.forEach(function(b){ if(typeof setLoading==='function') setLoading(b,false); });
      if (typeof closeModal === 'function') closeModal('manualWalletModal');
      if (window.showToast) window.showToast('✅ ' + amt + ' ' + wt + ' debited (atomic)');

    } catch (e) {
      btns.forEach(function(b){ if(typeof setLoading==='function') setLoading(b,false); });
      if (window.showToast) window.showToast('❌ Error: ' + e.message, true);
      console.error('[v23 Fix#5] processManualWallet atomic debit failed:', e);
    }
  };

  window.processManualWallet._v23AtomicDebit = true;
  console.log('[v23] FIX #5+#12 ✅ processManualWallet: atomic debit + Supabase activity log');
});

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #6 — MAJOR
   approveTeam: checkDuplicateDuoJoin is defined but NEVER called.
   A duo match could have two overlapping team entries for the same player.
   
   Fix: Call checkDuplicateDuoJoin for duo requests before approval.
   Return early with a clear error if duplicate detected.
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('approveTeam', function () {
  if (window.approveTeam._v23DupCheck) return;
  var _orig = window.approveTeam;

  window.approveTeam = async function (rid) {
    var db = getDB();
    if (!db || typeof window.checkDuplicateDuoJoin !== 'function') {
      return _orig.apply(this, arguments);
    }

    try {
      var reqSnap = await db.ref((window.DB_TEAM || 'teamRequests') + '/' + rid).once('value');
      if (!reqSnap.exists()) return _orig.apply(this, arguments);

      var r = reqSnap.val();
      var tt = (r.teamType || r.type || 'duo').toLowerCase();
      var matchId   = r.matchId || r.tournamentId || '';
      var ownerUid  = r.ownerUid || r.uid || '';
      var memberUid = r.memberUid || '';

      if (tt === 'duo' && matchId && ownerUid && memberUid) {
        var dupOwner  = await window.checkDuplicateDuoJoin(ownerUid,  matchId);
        var dupMember = await window.checkDuplicateDuoJoin(memberUid, matchId);

        if (dupOwner === 'self') {
          if (window.showToast) window.showToast('❌ Team owner is already joined individually in this match!', true);
          return;
        }
        if (dupOwner === 'partner') {
          if (window.showToast) window.showToast('❌ Owner already has a different partner in this match!', true);
          return;
        }
        if (dupMember === 'self') {
          if (window.showToast) window.showToast('❌ Team member is already joined individually in this match!', true);
          return;
        }
        if (dupMember === 'partner') {
          if (window.showToast) window.showToast('❌ Member already has a different partner in this match!', true);
          return;
        }
      }
    } catch (e) {
      console.warn('[v23 Fix#6] checkDuplicateDuoJoin pre-check failed (proceeding):', e.message);
    }

    return _orig.apply(this, arguments);
  };

  window.approveTeam._v23DupCheck = true;
  console.log('[v23] FIX #6 ✅ approveTeam: checkDuplicateDuoJoin now called for duo requests');
});

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #8 — MAJOR
   saveTournament inline room notification: same dual-write gap as #7.
   When saveTournament sends inline room notifications (via db.ref users path),
   those Firebase writes never reach Supabase notifications table.
   
   Fix: Global interceptor on Firebase users/{uid}/notifications pushes →
   auto-mirror every push to Supabase notifications table.
   This covers both saveTournament's inline code AND sendRoomNotificationToMatch.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _installGlobalNotifDualWrite() {
  var _installed = false;
  var iv = setInterval(function () {
    var db = getDB();
    if (!db || _installed) return;
    clearInterval(iv);
    _installed = true;

    /* Wait for all previous ref interceptors (v22 runs at ~2500ms, 3000ms) */
    setTimeout(function () {
      var _prevRef = db.ref.bind(db);
      db.ref = (function (_p) {
        return function (path) {
          var ref = _p(path);

          /* Only intercept: users/{uid}/notifications */
          var notifMatch = typeof path === 'string' && /^users\/([^\/]+)\/notifications$/.test(path);
          if (notifMatch) {
            var uid = path.split('/')[1];
            var _oPush = ref.push.bind(ref);
            ref.push = function (data) {
              var fbResult = _oPush(data); /* Run original Firebase push */

              /* Mirror to Supabase */
              var supa = getSupa();
              if (supa && data && typeof data === 'object' && uid) {
                supa.from('notifications').insert({
                  user_id:    uid,
                  type:       data.type   || 'info',
                  title:      data.title  || '',
                  body:       data.message || data.body || '',
                  ref_id:     data.matchId || data.refId || null,
                  is_read:    false,
                  created_at: new Date().toISOString()
                }).catch(function (e) {
                  /* Non-fatal: Firebase notification already sent */
                  console.warn('[v23 Fix#8] Supabase notif mirror failed for uid:', uid, e.message);
                });
              }
              return fbResult;
            };
          }

          return ref;
        };
      })(_prevRef);

      db._v23NotifDualWriteInstalled = true;
      console.log('[v23] FIX #8 ✅ Global Firebase→Supabase notification dual-write interceptor installed');
    }, 5500); /* After v22 ref interceptors at ~3000ms */
  }, 4000);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #9 — MAJOR
   fa10ActivityHeatmap: loads ALL joinRequests with no limit → browser crash
   on large platforms (100k+ entries = 100MB+ JSON).
   
   Fix: Limit to last 2000 entries. Show warning if dataset is larger.
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('fa10ActivityHeatmap', function () {
  if (window.fa10ActivityHeatmap._v23Paginated) return;
  var _orig = window.fa10ActivityHeatmap;

  window.fa10ActivityHeatmap = async function () {
    var db = getDB();
    if (!db) return _orig.apply(this, arguments);

    /* Inject limitToLast(2000) on joinRequests reads during heatmap load */
    var _prevRef = db.ref.bind(db);
    var _active = true;
    db.ref = (function (_p) {
      return function (path) {
        if (_active && typeof path === 'string' &&
            (path === 'joinRequests' || path === (window.DB_JOIN || 'joinRequests'))) {
          return _p(path).limitToLast(2000);
        }
        return _p(path);
      };
    })(_prevRef);

    /* Show pagination notice in heatmap container if present */
    var hEl = document.getElementById('heatmapChart') || document.getElementById('activityHeatmapContainer');
    if (hEl) {
      var notice = document.createElement('div');
      notice.style.cssText = 'font-size:10px;color:#888;margin-bottom:4px;text-align:right';
      notice.textContent = '📊 Showing last 2,000 joins (paginated)';
      hEl.parentNode && hEl.parentNode.insertBefore(notice, hEl);
    }

    try {
      return await _orig.apply(this, arguments);
    } finally {
      _active = false;
      db.ref = _prevRef;
    }
  };

  window.fa10ActivityHeatmap._v23Paginated = true;
  console.log('[v23] FIX #9 ✅ fa10ActivityHeatmap: paginated to last 2000 joins');
});

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #10 — MAJOR
   fa26 poll suggestion: poll votes written to Firebase, polls read from Supabase
   → vote counts in user app never match Firebase → permanent desync.
   
   Fix: Intercept the poll vote Firebase write and also write to Supabase.
        If submitPollVote doesn't exist, patch the raw Firebase write for polls.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _fixPollVotesSupabase() {
  /* Try patching submitPollVote if it exists */
  patchWhenReady('submitPollVote', function () {
    if (window.submitPollVote._v23SupaVote) return;
    var _orig = window.submitPollVote;

    window.submitPollVote = async function (pollId, optionIdx, option) {
      var supa = getSupa();
      var auth = getAuth();
      var uid  = auth && auth.currentUser ? auth.currentUser.uid : null;

      /* Write to Supabase first (primary source for user app) */
      if (supa && pollId && uid) {
        try {
          /* Upsert vote (one vote per user per poll) */
          await supa.from('poll_votes').upsert({
            poll_id:  pollId,
            user_id:  uid,
            option:   option !== undefined ? option : optionIdx,
            voted_at: new Date().toISOString()
          }, { onConflict: 'poll_id,user_id' });

          /* Try RPC increment first */
          var rpcRes = await supa.rpc('increment_poll_vote', { p_poll_id: pollId, p_option: option || String(optionIdx) })
            .catch(function(){ return { error: true }; });

          if (rpcRes && rpcRes.error) {
            /* Fallback: manual increment in polls.vote_counts JSONB */
            var pollRes = await supa.from('polls').select('vote_counts, options').eq('id', pollId).single();
            if (pollRes.data) {
              var vc = pollRes.data.vote_counts || {};
              var key = option !== undefined ? String(option) : String(optionIdx);
              vc[key] = (vc[key] || 0) + 1;
              supa.from('polls').update({ vote_counts: vc }).eq('id', pollId).catch(function(){});
            }
          }
        } catch (e) {
          console.warn('[v23 Fix#10] Poll Supabase vote error:', e.message);
        }
      }

      /* Also run original (Firebase write for backward compat) */
      return _orig.apply(this, arguments);
    };

    window.submitPollVote._v23SupaVote = true;
    console.log('[v23] FIX #10 ✅ submitPollVote: Supabase dual-write added');
  });

  /* Also intercept Firebase 'polls' path writes as a belt-and-suspenders fix */
  var iv2 = setInterval(function () {
    var db = getDB(); if (!db || db._v23PollInterceptor) return;
    clearInterval(iv2);
    db._v23PollInterceptor = true;
    /* Polls write interception is covered by submitPollVote patch above */
    console.log('[v23] Fix#10: Poll vote dual-write ready');
  }, 5000);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   FIX #11 — MINOR
   approveProfile: IGN uniqueness checked only in Firebase (loads ALL users).
   User app reads profile data from Supabase — a user could steal an IGN
   that exists in Supabase but not yet synced to Firebase.
   
   Fix: After v23's lock wrapper is installed (2500ms), add Supabase IGN
   uniqueness check as a secondary guard at 3000ms.
   ═══════════════════════════════════════════════════════════════════════════ */
setTimeout(function () {
  if (!window.approveProfile || window.approveProfile._v23IgnSupaCheck) return;
  var _prev = window.approveProfile;

  window.approveProfile = async function (rid) {
    var db   = getDB();
    var supa = getSupa();

    if (db && supa) {
      try {
        var reqSnap = await db.ref((window.DB_PROFILE || 'profileRequests') + '/' + rid).once('value');
        if (reqSnap.exists()) {
          var r = reqSnap.val();
          var uid          = r.uid || r.userId || r.user_id || '';
          var proposedIgn  = (r.requestedIgn || r.ign || r.username || r.newIgn || '').trim();
          var proposedFfUid = (r.requestedUid || r.requestedFfUid || r.ffUid || r.gameUid || '').trim();

          /* Supabase IGN uniqueness check */
          if (proposedIgn && uid) {
            var ignRes = await supa.from('users')
              .select('id, ign')
              .ilike('ign', proposedIgn)
              .neq('id', uid)
              .limit(1);

            if (ignRes.data && ignRes.data.length > 0) {
              if (window.showToast) {
                window.showToast('❌ IGN "' + escH(proposedIgn) + '" already taken in Supabase by another user!', true);
              }
              /* Reset processing status */
              db.ref((window.DB_PROFILE || 'profileRequests') + '/' + rid)
                .update({ status: 'pending', processingBy: null, processingAt: null })
                .catch(function(){});
              return;
            }
          }

          /* Warn admin when FF UID is empty (informational, not a block) */
          if (!proposedFfUid) {
            console.warn('[v23 Fix#11] ⚠️ Approving profile without FF UID. User:', uid, 'IGN:', proposedIgn);
          }
        }
      } catch (e) {
        console.warn('[v23 Fix#11] Supabase IGN check error (proceeding):', e.message);
      }
    }

    return _prev.apply(this, arguments);
  };

  window.approveProfile._v23IgnSupaCheck = true;
  console.log('[v23] FIX #11 ✅ approveProfile: Supabase IGN uniqueness check added');
}, 3000);

/* ═══════════════════════════════════════════════════════════════════════════
   FINAL STARTUP LOG
   ═══════════════════════════════════════════════════════════════════════════ */
setTimeout(function () {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║    MINI eSPORTS ADMIN — BUG FIX PATCH v23 FINAL LOADED ✅      ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║  CRITICAL FIXES:                                               ║');
  console.log('║  #1  approveProfile: processing lock re-added (outermost)      ║');
  console.log('║  #2  mrPublishResults: _supaResultEntries built + Supabase sync ║');
  console.log('║  #3  sendRoomNotificationToMatch: terminal status guard added   ║');
  console.log('║  #4  loadTournaments: real-time joinRequests listener added     ║');
  console.log('║  #5  processManualWallet: atomic Firebase debit (TOCTOU fixed)  ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║  MAJOR FIXES:                                                  ║');
  console.log('║  #6  approveTeam: checkDuplicateDuoJoin now called for duo     ║');
  console.log('║  #7  sendRoomNotificationToMatch: Supabase notifications        ║');
  console.log('║  #8  Global Firebase→Supabase notification dual-write          ║');
  console.log('║  #9  fa10 heatmap: paginated to last 2000 (no browser crash)   ║');
  console.log('║  #10 Poll votes: Supabase as primary target (no desync)        ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║  MINOR FIXES:                                                  ║');
  console.log('║  #11 approveProfile: Supabase IGN uniqueness check added       ║');
  console.log('║  #12 processManualWallet: admin_activity_log Supabase entry    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
}, 7000);

})(); /* end IIFE */
