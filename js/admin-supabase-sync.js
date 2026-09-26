/* ================================================================
   ADMIN → SUPABASE SYNC — admin-supabase-sync.js
   MiniESports Admin v2.0 | May 2026

   Admin panel Firebase se Supabase mein sab data sync karta hai.
   Har critical admin action (wallet approve, result publish, ban)
   ke saath Supabase bhi update hota hai.

   window._supa = Supabase client (initialized here)
================================================================ */
(function() {
  'use strict';

  /* ✅ HELPER (2026-08-17): sd_requests can be referenced either by its
     real Supabase UUID (id) or by the legacy Firebase key
     (firebase_req_id) depending on which UI table a click came from.
     Resolve either form to the real UUID once, here, so every
     approve/reject call site doesn't need its own copy of this logic. */
  window._resolveSdRequestId = async function(rawId) {
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(rawId)) return rawId; /* already a real UUID */
    if (!window._supa) return null;
    var lookup = await window._supa.from('sd_requests').select('id').eq('firebase_req_id', rawId).maybeSingle();
    if (lookup.error || !lookup.data) return null;
    return lookup.data.id;
  };

/* ✅ FIX (Audit — major find): Pehle yeh function sirf tab _patchAdminFunctions()
   call karta tha jab YEH FILE khud Supabase client banaye ("if (window._supa) return;").
   Lekin supabase-init-early.js hamesha pehle load hota hai aur window._supa
   pehle se bana chuka hota hai — isliye yeh "return" har baar fire hota tha
   aur _patchAdminFunctions() KABHI call hi nahi hota tha! Matlab wallet
   approve / result publish / ban / Sky Diamond approve — koi bhi action
   Supabase mein sync nahi ho raha tha, sirf Firebase mein jaata tha.
   Ab: duplicate createClient hata diya (ek hi authenticated client istemal
   hoga, jo syncFirebaseToken se banta hai), aur patch sirf "client exist
   karta hai ya nahi" pe depend karta hai — kisne banaya, usse farq nahi. */
  function _initSupa() {
    if (window._supa) { _patchAdminFunctions(); return; }
    setTimeout(_initSupa, 200);
  }

  /* ── PATCH ADMIN FUNCTIONS ── */
  function _patchAdminFunctions() {
    /* Wait for admin functions to be defined */
    var _patchTimer = setInterval(function() {
      /* ✅ FIX (2026-08-19, CRITICAL): this gate used to also require
         window.approveAddMoney to exist — but approveAddMoney() was
         deleted along with the rest of the Wallet Requests tab this
         session. Since this gate condition would then NEVER become
         true, _patchTimer would poll forever (never clear) AND — far
         more seriously — _wrapPublishResults(), _wrapBanUser(),
         _wrapApproveSkyDia(), and _wrapManualCredit() would NEVER run
         either, since they were all gated behind the SAME condition.
         That would have silently broken match-result-publish Supabase
         sync, ban sync, Sky Diamond approval (including this session's
         own order/ID-mismatch fix to it), and manual credit sync —
         four unrelated, actively-needed features — as a side effect of
         removing one unrelated function. Removed approveAddMoney from
         the gate and removed the now-dead _wrapApproveAddMoney() call
         + definition below. */
      if (typeof window.publishResults === 'function' &&
          typeof window.banUser === 'function') {
        clearInterval(_patchTimer);
        _wrapPublishResults();
        _wrapBanUser();
        _wrapApproveSkyDia();
        _wrapManualCredit();
        console.log('[AdminSync] All admin functions patched ✅');
      }
    }, 1000);
  }

  /* ✅ REMOVED (2026-08-19): _wrapApproveAddMoney() deleted — it wrapped
     window.approveAddMoney, which no longer exists (Wallet Requests tab
     removed). Sky Diamond purchase approvals now go entirely through
     approveSkyDiaReq() / _wrapApproveSkyDia() below, which already
     handles both purchase and withdrawal request types correctly. */

  /* ── 2. PUBLISH RESULTS (prize distribution) ── */
  function _wrapPublishResults() {
    var orig = window.publishResults;
    window.publishResults = async function() {
      /* ⛔ R7 FOLLOW-UP (2026-09-24d): publishResults() ab server ke EK atomic
         RPC `publish_match_results()` se chalta hai (wallet credit + ledger +
         join_requests + match_results + stats + season + platform SAB RPC
         andar). Ye wrapper ka purana post-sync (rtdb 'results' node padhkar
         join_requests.update + matches.status) ab zaroori nahi — RPC ne sab
         kar diya. Isliye wrapper ab base ko forward karta hai, koi alag
         Supabase write nahi. (Never re-add a balance credit here.) */
      var _midEl = document.getElementById('resultTournamentSelect');
      window._currentMatchId = _midEl ? _midEl.value : null;
      return orig.apply(this, arguments);
    };
  }

  /* ── 3. BAN USER ── */
  function _wrapBanUser() {
    var orig = window.banUser;
    window.banUser = async function(uid) {
      /* BUG #40 FIX (2026-07-30): this wrapper used to ALSO do its own direct
         .update({is_banned:true}) after calling orig — redundant, since orig (in
         admin-inline.js) already syncs to Supabase itself, and now does so via the
         set_user_ban_status RPC (the raw column UPDATE this wrapper used to do would
         fail outright post-fix, since is_banned's direct-UPDATE grant is revoked —
         admin actions must go through the RPC now). Removed the duplicate. */
      await orig.apply(this, arguments);
    };
  }

  /* ── 4. APPROVE SKY DIAMOND / GREEN DIAMOND WITHDRAWAL REQUEST ── */
  function _wrapApproveSkyDia() {
    var orig = window.approveSkyDiaReq;
    if (!orig) return;
    window.approveSkyDiaReq = async function(reqId, uid, diamonds, isSkyNode) {
      /* ✅ FIX (2026-08-17, CRITICAL): same two bugs as _wrapApproveAddMoney —
         (1) orig.apply() used to run FIRST (Firebase success toast + list
         refresh) before the real Supabase credit, so a failed/mismatched
         credit still looked like it worked and the request vanished from
         the dashboard with no money moved. (2) reqId here is the Firebase
         key (c.key from rtdb.ref('skyDiamondRequests')), but
         resolve_sd_request expects sd_requests.id (a Supabase UUID) — this
         always failed to match, which is the exact "Request already
         resolved" / "Invalid data" error seen in testing. Fixed by
         resolving the UUID via firebase_req_id first, running the RPC
         BEFORE any Firebase/UI update, and only calling orig.apply() after
         Supabase confirms the credit actually happened. */
      try {
        var lookup = await window._resolveSdRequestId(reqId);
        if (!lookup) {
          console.error('[AdminSync] Could not resolve sd_requests id for reqId:', reqId);
          if (window.showToast) showToast('⚠️ Could not find matching Supabase request — paisa credit nahi hua', true);
          return;
        }
        var supaId = lookup;

        var res = await window._supa.rpc('resolve_sd_request', { p_request_id: supaId, p_action: 'approve' });
        if (res.error || (res.data && res.data.ok === false)) {
          console.error('[AdminSync] resolve_sd_request approve failed:', res.error ? res.error.message : res.data.error);
          if (window.showToast) showToast('⚠️ Approval failed: ' + (res.error ? res.error.message : res.data.error), true);
          /* Re-render so a genuinely-failed (not double-clicked) request
             gets its buttons back instead of staying permanently
             disabled from the click-guard above. */
          if (window.loadSkyDiamondReqSection) window.loadSkyDiamondReqSection();
          return; /* Money not credited — do NOT show Firebase-side success */
        }
        console.log('[AdminSync] sd_request approval synced:', uid, res.data.request_type);

        /* ✅ FIX (2026-08-19): pass the real request_type through to the
           base function so its notification/transaction-log wording can
           correctly distinguish a purchase (diamonds credited TO the
           user) from a withdrawal (real money paid OUT via UPI) —
           previously always said "Sky Diamonds Added! Ab paid matches
           join kar sakte ho" even for withdrawal approvals, which is
           backwards/confusing for a user who just cashed out. */
        var origArgs = Array.prototype.slice.call(arguments);
        origArgs.push(res.data.request_type);
        await orig.apply(this, origArgs);
      } catch(e) {
        console.error('[AdminSync] approveSkyDiaReq sync error:', e.message);
        if (window.showToast) showToast('⚠️ Approval error: ' + e.message, true);
      }
    };
  }

  /* ── 5. MANUAL CREDIT (Admin directly credits user) ── */
  function _wrapManualCredit() {
    /* Listen for admin manual credit calls */
    var orig = window.saveManualCredit;
    if (!orig) {
      /* Poll until defined */
      var t = setInterval(function() {
        if (window.saveManualCredit) { clearInterval(t); _wrapManualCredit(); }
      }, 2000);
      return;
    }
    window.saveManualCredit = async function(uid, type, amount, note) {
      /* ✅ Bug 12 Fix: Require admin UID — fail if not authenticated */
      var adminId = _adminUid();
      if (!adminId) {
        if (window.showToast) showToast('❌ Admin authentication required for manual credit', true);
        console.error('[AdminSync] saveManualCredit blocked — no admin UID');
        return;
      }
      await orig.apply(this, arguments);
      try {
        /* ⛔ R7 FOLLOW-UP (2026-09-24c): EK atomic RPC `admin_adjust_wallet`.
           Pehle increment_balance (ledger-less) + alag wallet_transactions
           insert + alag admin_activity_log insert 3 alag mutations the.
           Ab single authoritative ledger mutation; Firebase/UI mirror-only. */
        var col = type === 'sky' ? 'sky_diamonds' : type === 'green' ? 'green_diamonds' : 'coins';
        var amt = Number(amount) || 0;
        if (!uid || !amt) return;
        var wres = await window._supa.rpc('admin_adjust_wallet', {
          p_uid: uid, p_col: col, p_amount: amt,
          p_reason: note || 'Admin manual credit'
        });
        if (!wres || !wres.data || wres.data.success !== true) {
          throw new Error((wres && wres.data && wres.data.error) || 'rejected');
        }
        /* Activity log as NON-authoritative audit mirror (best-effort).
           Correct column names: admin_uid (not admin_id), action_type,
           target_uid / details / created_at. */
        await window._supa.from('admin_activity_log').insert({
          admin_uid: adminId,
          action_type: 'manual_wallet_credit',
          target_uid: uid,
          details: { col: col, amount: amt, note: note, timestamp: Date.now() },
          created_at: new Date().toISOString()
        });
        console.log('[AdminSync] Manual credit synced by', adminId, ':', uid, col, amt);
      } catch(e) { console.error('[AdminSync] saveManualCredit sync error:', e.message); }
    };
  }

  /* ── 6. SYNC MATCH CREATION TO SUPABASE ── */
  /* Watch Firebase matches/ for new matches and sync to Supabase */
  function _watchMatchCreation() {
    /* ⛔ DISABLED (2026-09-14) — ROOT CAUSE of the "entry fee saves as
       25/30 but shows as 0 everywhere" bug, confirmed live via direct
       Supabase queries: every affected match's updated_at was ~300-450ms
       after created_at, i.e. a second write landed almost immediately
       after the real insert and reset entry_fee back to its column
       default (0), while leaving entry_type untouched (also matching
       its own column default 'paid' — pure coincidence that made it
       look "half correct").
       This is the SAME failure class as the earlier is_sponsored bug
       from this same function: 'matches' is fully routed through the
       Supabase bridge now (see TABLE_MAP), so saveTournament()'s own
       rtdb.ref(DB_MATCHES).push() ALREADY performs a correct, complete
       Supabase INSERT via matchToSupa(). This listener's "initial load"
       sweep (child_added fires once for every existing row on every
       page load/reconnect, per supabase-rtdb-bridge.js's .on()
       implementation) and its ongoing realtime subscription both then
       independently re-upsert the SAME row a moment later — a genuine
       second write nobody asked for, racing the first. admin-fixes-v25
       -SUPABASE.js's own comment ("upserts are idempotent so no real
       harm") was the same wrong assumption that let the is_sponsored
       bug ship for weeks; it is not idempotent when the read backing
       the second write can observe a transitional/incomplete row.
       saveTournament()'s direct bridge insert is the single correct
       writer for match creation — this safety-net listener is fully
       redundant per v25's own migration-cleanup notes and is now a
       strict liability, not a backup. Disabled entirely rather than
       patched again field-by-field, since every previous per-field
       patch (matchTime, is_sponsored) here just moved the same class
       of bug to the next field. See disabled body below, kept for
       reference only — never attached. */
    return;
  }
  function _watchMatchCreation_DISABLED_DO_NOT_CALL() {
    var rtdb_ = window.rtdb || window.db;
    if (!rtdb_) { setTimeout(_watchMatchCreation, 2000); return; }
    rtdb_.ref('matches').on('child_added', function(snap) {
      var m = snap.val(); if (!m) return;
      /* 🚨 ROOT CAUSE FOUND (2026-09-13), after an extremely long
         investigation across many sessions into "match saves as
         upcoming with the right time, then immediately flips to
         live" — traced via a screen recording + on-screen diagnostic
         log that PROVED saveTournament() itself always read and
         computed the correct matchTime, all the way through to the
         database write. The corruption was happening HERE, a few
         hundred milliseconds later:
         This listener is a "safety net" that mirrors any newly
         created match into Supabase, meant to catch matches created
         via a path whose own Supabase write might have failed. But
         'matches' is a Supabase-realtime-backed table (see
         TABLE_MAP) — child_added fires from a Postgres realtime
         INSERT event, AFTER saveTournament() has already correctly
         written the row with the right scheduled_at. If m.matchTime
         (converted from that realtime payload) was momentarily falsy
         at the instant this fired — e.g. a partial/optimistic
         payload shape, or any hiccup in the bridge's conversion of
         that specific event — the old code's fallback
         ": new Date().toISOString()" would silently over-write the
         row's ALREADY-CORRECT scheduled_at with "right now", via the
         upsert's onConflict:'id' clause. This is exactly why the bug
         was so hard to pin down: the DB briefly had the right value
         (confirmed live on video), then this listener stomped it a
         moment later — a genuine second write nobody was looking at.
         Fix: if m.matchTime is falsy, DO NOT touch scheduled_at at
         all (omit the key from the upsert payload entirely) rather
         than guessing "now". A falsy matchTime on a real match
         update/insert almost always means "this listener doesn't
         have the full picture yet", not "this match has no time" —
         and even in the genuine edge case of a match somehow created
         with no time at all, leaving the column untouched is safe
         (it stays NULL, which the admin will immediately notice and
         fix), while guessing "now" silently corrupts a correct value
         that may already be sitting in the database. */
      var upsertPayload = {
        id: snap.key,
        title: m.name || m.title || 'Match',
        mode: m.mode || m.gameMode || 'solo',
        map: m.map || 'Bermuda',
        status: m.status || 'upcoming',
        /* ✅ BUG FIX (2026-09-14): this used to write entry_type as
           'coins'/'diamonds' — values that don't exist anywhere else in
           the codebase. Every real writer (admin-inline.js's
           saveTournament, and supabase-rtdb-bridge.js's matchToSupa
           converter, which this same rtdb.ref('matches') call is
           secretly backed by) uses 'paid' / 'coin' / 'ad'. Because this
           listener fires on the SAME realtime INSERT that
           saveTournament() itself just produced (see the block comment
           above), it was racing its own creator and overwriting the
           just-written correct entry_type with a wrong value the rest
           of the app has never recognized — User Panel's and Admin's
           own entry_type==='paid' checks would silently fail against
           'diamonds', showing the match as an unpaid/coin match with
           whatever entry_fee happened to be readable at that instant
           (confirmed live: a match saved as Paid/25 showed as
           Coin/₹0 immediately after, with no further admin action).
           Pass entryType straight through unchanged instead of
           remapping it to values nothing else expects. */
        entry_type: m.entryType || 'paid',
        entry_fee: Number(m.entryFee) || 0,
        prize_pool: Number(m.firstPrize || m.firstPrizeSD || m.firstPrizeGD || 0),
        max_slots: Number(m.maxSlots) || 12,
        room_id: m.roomId || null,
        room_password: m.roomPassword || null,
        is_sponsored: false
      };
      if (m.matchTime) upsertPayload.scheduled_at = new Date(m.matchTime).toISOString();
      /* ✅ Same class of fix as scheduled_at above: if entryType/entryFee
         are momentarily missing from this realtime payload, don't upsert
         a default ('paid'/0) over a value that may already be correct in
         the DB — omit the keys entirely instead. */
      if (m.entryType === undefined) delete upsertPayload.entry_type;
      if (m.entryFee === undefined) delete upsertPayload.entry_fee;
      /* Sync to Supabase matches table */
      window._supa.from('matches').upsert(upsertPayload, { onConflict: 'id' }).then(function(res) {
        if (res && res.error) {
          /* This listener is the safety-net that's supposed to catch
             matches created via any path (Quick Create, Scheduler, etc.)
             and mirror them into Supabase even if the original write's
             own Supabase call failed or was skipped. Silently swallowing
             its own errors meant that when the root cause was the same
             everywhere (users.is_admin not set → matches_admin_write RLS
             denies every admin write), this backup sync failed the exact
             same way as the primary paths, with nothing anywhere
             surfacing it. */
          console.error('[AdminSync] Match auto-sync to Supabase REJECTED for', snap.key, ':', res.error.message);
        }
      });
    });

    /* Watch for match updates (status changes, room ID added) */
    /* ✅ RACE-CONDITION FIX (2026-09-08), per Junaid's request to clean
       up the "overwrite logic" — this listener is registered on
       window.rtdb, which (per TABLE_MAP/FIREBASE_ONLY) routes 'matches'
       through the Supabase bridge, NOT real Firebase RTDB. That means
       this 'child_changed' handler is actually subscribed to Supabase
       Realtime changes on the matches table itself — and its own body
       writes back to that same table via window._supa.from('matches')
       .update(...). Every write this handler makes triggers a Realtime
       change event, which re-fires this exact handler again — a
       standing, self-triggering loop with no guard anywhere in the
       bridge (checked supabase-rtdb-bridge.js's .on() implementation
       directly to confirm — no self-write dedup exists there).
       admin-inline.js's syncTournamentStatuses(), which runs every
       30s and writes status changes through this same rtdb.ref path,
       gives this loop a routine, ordinary trigger — not a rare edge
       case.
       Fix: compare the incoming row's relevant fields against what
       this handler would actually write, and skip the Supabase write
       entirely when nothing has actually changed. A genuine external
       edit still propagates normally on its first pass; the second,
       self-triggered event for the SAME data becomes a no-op and the
       loop stops there instead of continuing forever. */
    var _lastSyncedMatch = {}; // matchId -> last written field-hash, to detect true no-ops
    rtdb_.ref('matches').on('child_changed', function(snap) {
      var m = snap.val(); if (!m) return;
      var upd = { status: m.status || 'upcoming' };
      if (m.roomId) { upd.room_id = m.roomId; upd.room_password = m.roomPassword || null; }
      /* ✅ Bug 31 Fix: Sync ALL relevant match fields to Supabase */
      var fullUpd = Object.assign({}, upd);
      var d = snap.val() || {};
      if (d.matchTime)   fullUpd.scheduled_at = new Date(d.matchTime).toISOString();
      if (d.entryFee !== undefined) fullUpd.entry_fee = Number(d.entryFee) || 0;
      if (d.entryType)   fullUpd.entry_type  = d.entryType;
      if (d.maxSlots || d.totalSlots) fullUpd.max_slots = Number(d.maxSlots || d.totalSlots);
      if (d.mode || d.type) fullUpd.mode = d.mode || d.type;
      if (d.map)         fullUpd.map        = d.map;
      if (d.name)        fullUpd.title      = d.name;
      if (d.roomId)      fullUpd.room_id    = d.roomId;
      if (d.roomPassword)fullUpd.room_password = d.roomPassword;
      if (d.prizePool !== undefined) fullUpd.prize_pool = Number(d.prizePool) || 0;

      var _fingerprint = JSON.stringify(fullUpd);
      if (_lastSyncedMatch[snap.key] === _fingerprint) {
        /* This is the loop's own echo — the data we're about to write
           is byte-for-byte identical to what we last wrote for this
           match. Skip silently; nothing changed, so there's nothing
           to sync, and NOT writing is what breaks the cycle. */
        return;
      }
      _lastSyncedMatch[snap.key] = _fingerprint;

      window._supa.from('matches').update(fullUpd).eq('id', snap.key).then(function(res) {
        if (res && res.error) console.error('[AdminSync] Match update auto-sync REJECTED for', snap.key, ':', res.error.message);
      });
    });
  }

  /* ── 7. SYNC JOIN REQUESTS APPROVALS ── */
  /* When admin approves a join request in Firebase, sync to Supabase */
  function _watchJoinApprovals() {
    var rtdb_ = window.rtdb || window.db;
    if (!rtdb_) { setTimeout(_watchJoinApprovals, 2000); return; }
    /* ✅ RACE-CONDITION FIX (2026-09-08): same self-triggering-loop risk
       and same fingerprint-based fix as _watchMatchCreation's
       child_changed handler above — this listener also both listens
       on and writes back to join_requests via the Supabase bridge. */
    var _lastSyncedJoin = {};
    rtdb_.ref('joinRequests').on('child_changed', function(snap) {
      var j = snap.val(); if (!j) return;
      var status = j.status;
      var supaStatus = status === 'approved' || status === 'joined' || status === 'confirmed' ? 'approved' :
                       status === 'rejected' ? 'rejected' : 'pending';
      var upsertData = {
        id: snap.key,
        match_id: j.tournamentId || j.matchId,
        user_id: j.userId || j.uid,
        status: supaStatus,
        /* ✅ BUG FIX (2026-09-14): same wrong-vocabulary bug as the
           matches sync above — 'diamonds'/'coins' aren't values any
           other reader of join_requests.entry_type expects (see
           listeners.js, admin-fixes-v22/24-FINAL.js — all use
           entryType/entry_type verbatim as 'paid'/'coin'/etc). Pass the
           real value through unchanged. */
        entry_type: j.entryType || 'paid',
        entry_fee_paid: Number(j.entryFee) || 0,
        ign_at_join: j.playerName || j.ign || j.userName || '',
        kills: j.kills || null,
        placement: j.rank || null,
        prize_earned: Number(j.winnings || 0),
        checked_in: j.inRoom || false,
        in_room: j.inRoom || false
      };
      var _fingerprint = JSON.stringify(upsertData);
      if (_lastSyncedJoin[snap.key] === _fingerprint) return; /* our own echo */
      _lastSyncedJoin[snap.key] = _fingerprint;

      window._supa.from('join_requests').upsert(upsertData, { onConflict: 'match_id,user_id' }).then(function(res) {
        if (res && res.error) console.error('[AdminSync] join_requests approval upsert FAILED for', j.userId || j.uid, 'match', j.tournamentId || j.matchId, ':', res.error.message);
      });
    });
  }

  /* ── 8. SYNC USER UPDATES (ban, profile, IGN) ── */
  function _watchUserUpdates() {
    var rtdb_ = window.rtdb || window.db;
    if (!rtdb_) { setTimeout(_watchUserUpdates, 2000); return; }
    /* ✅ RACE-CONDITION FIX (2026-09-08): same self-triggering-loop
       fingerprint guard as the two listeners above — this one also
       both listens on and writes back to the users table via the
       Supabase bridge (admin_sync_user_balance + the plain UPDATE
       further below). */
    var _lastSyncedUser = {};
    rtdb_.ref('users').on('child_changed', function(snap) {
      var u = snap.val(); if (!u) return;
      var uid = snap.key;

      /* ✅ BUG FIX (2026-07-17): coins/sky_diamonds/green_diamonds are no
         longer directly UPDATE-able at all (see COMPLETE_SCHEMA.sql's
         users GRANT block — this was a severe balance-tampering hole).
         Split out into admin_sync_user_balance, a dedicated admin-checked
         RPC for exactly this "mirror Firebase's current value into
         Supabase" legacy-sync use case. */
      /* R8 (2026-09-26c): Firebase→Supabase balance OVERWRITE retired.
         Firebase ab authoritative balance source NAHI hai — Supabase wallet
         economy authoritative hai, isliye ye blind p_coins/p_sky/p_green
         mirror-set (jo Supabase ki sahi balance ko Firebase ki stale value se
         overwrite kar sakta tha) ab disabled hai. Yahan sirf non-financial
         ban/stats/ign/city mirror hota hai. Koi manual reconcile chahiye ho
         to admin_sync_user_balance(p_uid, coins, sky, green, reason) kahin
         se direct karo — wo DELTA + ledger + before/after audit karta hai,
         kabhi blind overwrite nahi. */
      var coinsVal = 0, skyVal = 0, greenVal = 0;

      /* Only sync key fields to avoid excessive writes */
      var upd = {
        is_banned: u.isBanned || u.blocked || false,
        total_matches: Number(u.stats && u.stats.matches || 0),
        total_wins: Number(u.stats && u.stats.wins || 0),
        total_kills: Number(u.stats && u.stats.kills || 0)
      };
      if (u.ign) upd.ign = u.ign;
      if (u.city) upd.city = u.city;

      var _fingerprint = JSON.stringify({ upd: upd });
      if (_lastSyncedUser[uid] === _fingerprint) return; /* our own echo */
      _lastSyncedUser[uid] = _fingerprint;

      /* R8: NO admin_sync_user_balance call here anymore — Supabase balance
         is authoritative and must not be overwritten from Firebase watchers. */
      window._supa.from('users').update(upd).eq('id', uid).then(function(res) {
        /* This is the main bans/stats sync path — a failure here means a
           user's Firebase-side ban status silently never reaches
           Supabase, which is exactly the class of bug this whole audit
           has been chasing. Was previously fully silent; now at least
           logged so a pattern of repeated failures (e.g. from a still-
           incomplete grant list) is visible instead of invisible. */
        if (res && res.error) console.error('[AdminSync] users ban/stats sync FAILED for', uid, ':', res.error.message, upd);
      });
    });
  }

  /* ── HELPER ── */
  function _adminUid() {
    if (window.auth && window.auth.currentUser) return window._adminUid();
    return null;
  }

  /* ── AUTO-INIT ── */
  /* Wait for Supabase SDK and then start all sync listeners */
  function _startAllSync() {
    /* ✅ FIX (BUG L-14): waiting only on window._supa isn't enough — _supa
       is created ANON at page-load by supabase-init-early.js, long before
       Firebase login finishes and syncFirebaseToken() recreates it with
       the admin's Bearer token. If watchers start on the anon client,
       every write (matches upsert, etc.) hits admin-only RLS policies
       (matches_admin_write, and friends) as an unauthenticated request
       and gets rejected — even though users.is_admin is correctly true.
       Wait for window._supaAuthed (set by syncFirebaseToken) instead. */
    if (!window._supa || !window._supaAuthed) { setTimeout(_startAllSync, 500); return; }
    /* ✅ FIX: a blind fixed 4s delay can race with the bridge's own
       install process under slow/loaded conditions — if these watchers
       bind before window.rtdb._isSupaBridge is true, they attach to RAW
       Firebase RTDB instead of the bridge, and immediately hit
       permission_denied on paths (matches, users, ...) that only
       Supabase is allowed to serve. Poll for the bridge explicitly
       instead of guessing a fixed delay. */
    var _waited = 0;
    (function _waitForBridge() {
      if ((window.rtdb && window.rtdb._isSupaBridge) || _waited >= 10000) {
        if (!(window.rtdb && window.rtdb._isSupaBridge)) {
          console.error('[AdminSync] Bridge never installed after 10s — watchers NOT started to avoid binding to raw Firebase.');
          return;
        }
        _watchMatchCreation();
        _watchJoinApprovals();
        _watchUserUpdates();
        console.log('[AdminSync] All sync watchers active ✅ (bridge confirmed ready)');
        return;
      }
      _waited += 200;
      setTimeout(_waitForBridge, 200);
    })();
  }

  _initSupa();
  _startAllSync();

  console.log('[AdminSync] Admin Supabase sync module loaded');

})();

/* ✅ REMOVED (2026-08-19): the entire "SUPABASE SD_REQUESTS → Admin
   Wallet Panel Bridge" IIFE deleted — it existed purely to patch
   window.setupWalletListener (Wallet Requests tab), which no longer
   exists. Without this removal, _patchWalletListener() would have
   polled forever every 1.5s checking `!window.setupWalletListener`
   (always true now, since that function is gone), leaking a timer
   that never does anything — safe, but wasteful and confusing to
   anyone reading the console. Sky Diamond purchase AND withdrawal data
   is now loaded directly by loadSkyDiamondReqSection() in
   admin-inline.js (Supabase sd_requests, both request types) — no
   bridge/patch layer needed for it anymore. */

/* Bug 27 / Bug#118: Sponsored withdrawal functions moved to admin-supabase-sponsored.js */
