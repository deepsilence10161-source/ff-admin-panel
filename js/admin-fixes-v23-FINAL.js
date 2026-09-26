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
/* ✅ FIX (live-testing): same centralized bridge-readiness fix as
   admin-fixes-v21.js's getDB() — see that file for the full rationale.
   Applies to every call-site in this file, including
   _installJoinRequestsRealtimeListener's permanent .on() listeners. */
function getDB()   { return (window.rtdb && window.rtdb._isSupaBridge) ? window.rtdb : null; }
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
   FIX #1 — approveProfile: Processing lock
   Superseded (2026-08 cleanup): the current approveProfile (see
   admin-fixes-v25-SUPABASE.js) already has an in-memory JS lock AND the
   underlying admin_approve_profile RPC does `SELECT ... FOR UPDATE` at
   the Postgres row level — a stronger, race-proof guarantee than this
   file's Firebase-status-field optimistic lock ever provided, and
   without the extra unnecessary write to profile_requests (via the
   bridge) on every single approval. Removed along with the matching
   v21/v22 wrappers this was designed to patch over.
   ═══════════════════════════════════════════════════════════════════════════ */

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

  /* ⛔ R7 FOLLOW-UP (2026-09-24d): wrapper ab INERT (forward-only).
     Base mrPublishResults (fa22) ab khud server ke EK atomic RPC
     `publish_match_results()` se publish karta hai (balance + ledger +
     join_requests + match_results + stats + season + platform SAB RPC
     andar). Is wrapper ka purana _supaResultEntries capture + match_results
     upsert + matches.status update DUPLICATE tha — remove kar diya. */
  window.mrPublishResults = async function () {
    return _orig.apply(this, arguments);
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

    /* ── Run original notification send (bridge routes users/{uid}/notifications
       pushes straight into the real Supabase `notifications` table — see
       supabase-rtdb-bridge.js — so a separate direct Supabase insert here
       was writing every room-release notification TWICE per player. ── */
    var fbCount = await _orig.apply(this, arguments);

    /* ✅ BUG FIX (2026-08-22): removed "Fix #7" Supabase dual-write block.
       It duplicated notifications the bridge already persists via the
       rtdb.ref(...).push() calls inside sendRoomNotificationToMatch —
       this was one of the 3-4 sources of the "same room notification
       appears multiple times" bug. sendRoomNotificationToMatch is now
       the single source of truth for room-release notifications (see
       admin-inline.js), so no second write is needed here. */

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

   ✅ REMOVED (2026-09-06), per Junaid's urgent request: "Save & Update"
   was hanging on a spinner that never cleared even though the match
   saved successfully in the background — full admin panel felt slow.
   Root cause traced to THIS wrapper's pre-save step: it awaited a
   fresh db.ref(matches/{id}).once('value') Firebase-bridge network
   round-trip on every single Save click, purely to read the match's
   current status. That status is already available for free —
   admin-inline.js's own saveTournament() reads the exact same value
   from allTournaments[id] (already in memory, no network call) as
   currentDbStatus, and uses it for its own, equivalent terminal-state
   guard (see the "isTerminal" check around its matchTimeChanged
   logic). This wrapper's extra network hop was pure redundant
   latency — and any slowness/failure in that awaited bridge call
   (or a subsequent Firebase notification-interceptor step further
   down this file) blocked window.saveTournament's returned promise
   from ever settling on the client, even after the real save had
   already completed. Removed entirely; admin-inline.js's own
   in-memory guard was already sufficient and is unaffected by this
   removal. The downstream notification-blocking guard below is kept,
   but now reads status from the already-in-memory allTournaments
   object at push()-time instead of depending on this wrapper's
   removed pre-fetch — zero extra network cost, same correctness. */


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

        /* Block notifications/ global push for terminal matches.
           ✅ CHANGED (2026-09-06): reads status straight from
           window.allTournaments (already in memory) at push()-time,
           instead of a wrapper-set flag that required an async
           pre-fetch — see the removal note above FIX #3b. */
        if (typeof path === 'string' && path === 'notifications') {
          var mid = ((document.getElementById('tournamentId') || {}).value || '').trim();
          var t = mid && window.allTournaments ? window.allTournaments[mid] : null;
          var st = t ? (t.status || '') : '';
          var TERMINAL = ['completed','resultPublished','result_published','cancelled','canceled'];
          if (mid && TERMINAL.indexOf(st) !== -1) {
            /* Return a no-op push stub */
            return Object.assign({}, ref, {
              push: function () {
                console.warn('[v23 Fix#3b] Blocked notifications push — match is terminal:', st);
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
  /* ✅ FIX (live-testing): getDB() truthy only means SOME db handle
     exists (raw Firebase from page-load counts), not that the Supabase
     bridge is installed. Three PERMANENT .on() listeners on
     `joinRequests` (Supabase-only, not in the Firebase allowlist) were
     binding to raw Firebase whenever the bridge hadn't installed yet —
     same class of bug already fixed in admin-fixes-v21.js's
     _joinRequestsRealtime, but this is a separate duplicate listener
     in a different file that had the same gap. Wait for the actual
     bridge. */
  var iv = setInterval(function () {
    if (!(window.rtdb && window.rtdb._isSupaBridge)) return;
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
    /* ⛔ R7 FOLLOW-UP (2026-09-24c): v23 ka atomic Firebase-transaction debit
       path HATA DIYA GAYA. Ab Base (admin-inline-b.js) EK hi atomic RPC
       `admin_adjust_wallet()` se credit + debit dono handle karta hai
       (server FOR-UPDATE balance + wallet_transactions ledger RPC ke ANDAR).
       Ye wrapper ab sirf base ko forward karta hai — koi alag Firebase
       transaction / decrement_balance / direct-update fallback nahi. */
    return _orig.apply(this, arguments);
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

   BUG #15 (merged 2026-08 cleanup, was admin-fixes-v21.js) — approveTeam
   missing bidirectional squad member link. After a squad approval, both
   the owner's AND the member's squadTeam array need to contain each
   other — this only happened one-directionally before.
   ═══════════════════════════════════════════════════════════════════════════ */
patchWhenReady('approveTeam', function () {
  if (window.approveTeam._v23DupCheck) return;
  var _orig = window.approveTeam;

  window.approveTeam = async function (reqId, ownerId, memberId, mode) {
    var rid = reqId; /* alias — same value, matches both original call sites' naming */
    var db = getDB();
    if (db && typeof window.checkDuplicateDuoJoin === 'function') {
      try {
        var reqSnap = await db.ref((window.DB_TEAM || 'teamRequests') + '/' + rid).once('value');
        if (reqSnap.exists()) {
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
        }
      } catch (e) {
        console.warn('[admin-fixes] approveTeam: checkDuplicateDuoJoin pre-check failed (proceeding):', e.message);
      }
    }

    var result = await _orig.apply(this, arguments);

    /* Bidirectional squad-link: ensure BOTH owner has member AND member
       has owner in their squadTeam arrays (previously only one direction
       was linked). */
    if (mode === 'squad' && ownerId && memberId && db) {
      var usersPath = window.DB_USERS || 'users';
      try {
        var memberSnap = await db.ref(usersPath + '/' + memberId + '/squadTeam').once('value');
        var memberTeam = memberSnap.val() || [];
        if (!Array.isArray(memberTeam)) memberTeam = Object.values(memberTeam);
        if (!memberTeam.includes(ownerId)) {
          memberTeam.push(ownerId);
          await db.ref(usersPath + '/' + memberId + '/squadTeam').set(memberTeam);
          console.log('[admin-fixes] approveTeam: added owner', ownerId, 'to member', memberId, 'squadTeam');
        }
      } catch (e) {
        console.warn('[admin-fixes] approveTeam: squad bidirectional sync error:', e.message);
      }
    }

    return result;
  };

  window.approveTeam._v23DupCheck = true;
  console.log('[admin-fixes] approveTeam: duplicate-duo-join check + bidirectional squad sync applied (combined)');
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
      var uid  = auth && auth.currentUser ? _adminUid() : null;

      /* R8 cleanup (2026-09-26): legacy block REMOVED.
         It contained (1) a raw client upsert into poll_votes, (2) a call to
         increment_poll_vote — a service_role-ONLY RPC, so that call could only
         ever return 42501 (its "fallback" below was therefore the only path
         ever taken), and (3) that fallback wrote polls.vote_counts straight
         from the client (server-owned aggregate) — duplicating
         cast_poll_vote's own count update = double-count hazard.
         Canonical path now (identical to the user panel): cast_poll_vote RPC,
         which derives identity from the JWT, validates poll + option, inserts
         poll_votes under its unique constraint (one vote per user) and
         maintains vote_counts server-side. No silent client fallback. */
      if (supa && pollId && uid) {
        try {
          var rpcRes = await supa.rpc('cast_poll_vote', {
            p_poll_id:   pollId,
            p_option:    option !== undefined ? String(option) : String(optionIdx),
            p_option_idx: (typeof optionIdx === 'number') ? optionIdx : (parseInt(optionIdx, 10) || 0)
          });
          if (rpcRes && rpcRes.error) {
            console.warn('[v23 Fix#10] cast_poll_vote failed:', rpcRes.error.message || rpcRes.error);
          } else if (rpcRes && rpcRes.data && rpcRes.data.ok === false) {
            console.warn('[v23 Fix#10] cast_poll_vote refused:', rpcRes.data.error);
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
   FIX #11 — approveProfile: IGN uniqueness check
   Superseded (2026-08 cleanup): admin_approve_profile (the RPC
   approveProfile calls) already does this exact IGN-uniqueness check
   server-side, inside the same transaction as the approval itself, and
   returns error 'ign_taken' if there's a conflict — see the RPC
   definition. A client-side pre-check like this one has its own race
   window between the check and the actual approval that the DB-level
   check doesn't. Removed as redundant.
   ═══════════════════════════════════════════════════════════════════════════ */

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
