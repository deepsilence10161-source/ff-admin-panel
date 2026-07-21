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
      if (typeof window.approveAddMoney === 'function' &&
          typeof window.publishResults === 'function' &&
          typeof window.banUser === 'function') {
        clearInterval(_patchTimer);
        _wrapApproveAddMoney();
        _wrapPublishResults();
        _wrapBanUser();
        _wrapApproveSkyDia();
        _wrapManualCredit();
        console.log('[AdminSync] All admin functions patched ✅');
      }
    }, 1000);
  }

  /* ── 1. APPROVE ADD MONEY (Sky Diamonds deposit) ── */
  function _wrapApproveAddMoney() {
    var orig = window.approveAddMoney;
    window.approveAddMoney = async function(rid) {
      /* Call original first */
      await orig.apply(this, arguments);
      /* Sync to Supabase */
      try {
        var w = window.allWalletRequests && window.allWalletRequests[rid];
        if (!w) return;
        var uid = w.uid || w.userId;
        var amt = Number(w.amount) || 0;
        if (!uid || !amt) return;
        /* Update Supabase sky_diamonds */
        await window._supa.rpc('increment_balance', { p_uid: uid, p_col: 'sky_diamonds', p_amount: amt });
        /* Log transaction */
        await window._supa.from('wallet_transactions').insert({
          user_id: uid, currency: 'sky_diamonds', txn_type: 'credit',
          amount: amt, reason: 'sd_purchase', note: 'Admin approved deposit'
        });
        /* Update sd_request status */
        await window._supa.from('sd_requests')
          .update({ status: 'approved', reviewed_by: _adminUid() })
          .eq('id', rid);
        /* Notify user via Supabase — BUG #26-followup FIX (2026-07): RPC-backed,
           notifications columns are no longer directly client-INSERT-able */
        await window._supa.rpc('admin_send_notification', {
          p_user_id: uid, p_type: 'wallet_update',
          p_title: '💎 Sky Diamonds Added!',
          p_body: '💎 ' + amt + ' Sky Diamonds wallet mein add ho gaye!'
        });
        console.log('[AdminSync] Wallet approval synced to Supabase:', uid, amt);
      } catch(e) { console.error('[AdminSync] approveAddMoney sync error:', e.message); }
    };
  }

  /* ── 2. PUBLISH RESULTS (prize distribution) ── */
  function _wrapPublishResults() {
    var orig = window.publishResults;
    window.publishResults = async function() {
      /* Call original */
      /* ✅ Fix: set _currentMatchId from the result select BEFORE calling original */
      var _midEl = document.getElementById('resultTournamentSelect');
      window._currentMatchId = _midEl ? _midEl.value : null;
      await orig.apply(this, arguments);
      /* After Firebase updates, sync winning players to Supabase */
      setTimeout(async function() {
        try {
          var mid = window._currentMatchId || window._curMatchId;
          if (!mid) return;
          var rtdb_ = window.rtdb || window.db;
          if (!rtdb_) return;
          /* Get results from Firebase and sync to Supabase */
          var snap = await rtdb_.ref('results').orderByChild('matchId').equalTo(mid).once('value');
          if (!snap.exists()) return;
          snap.forEach(function(c) {
            var r = c.val();
            if (!r || !r.userId) return;
            /* Determine currency */
            var prizeType = r.currency || 'green_diamonds';
            if (prizeType === 'greenDiamond') prizeType = 'green_diamonds';
            else if (prizeType === 'skyDiamond') prizeType = 'sky_diamonds';
            else if (prizeType === 'coin') prizeType = 'coins';
            var prize = Number(r.winnings || r.totalWinning || 0);
            if (prize <= 0) return;
            /* Sync to Supabase */
            window._supa.rpc('increment_balance', {
              p_uid: r.userId, p_col: prizeType, p_amount: prize
            }).catch(function(e) { console.error('Sync error:', e.message); });
            window._supa.from('wallet_transactions').insert({
              user_id: r.userId, currency: prizeType, txn_type: 'credit',
              amount: prize, reason: 'match_win', ref_id: mid,
              note: 'Rank #' + (r.rank||'?') + ', Kills: ' + (r.kills||0)
            }).then(function(res) {
              /* The balance itself is already credited via increment_balance
                 above regardless of this insert — this is the ledger/audit-
                 trail record. A failure here means the money moved but left
                 no transaction-history entry, which matters for dispute
                 resolution and TDS reporting, so it's worth knowing about
                 even though it's not a live-money-loss issue on its own. */
              if (res && res.error) console.error('[AdminSync] wallet_transactions ledger insert FAILED for', r.userId, ':', res.error.message);
            });
            /* Update match stats */
            window._supa.from('join_requests')
              .update({ kills: r.kills||0, placement: r.rank||0, prize_earned: prize })
              .eq('match_id', mid).eq('user_id', r.userId)
              .then(function(res) {
                if (res && res.error) console.error('[AdminSync] join_requests kills/placement update FAILED for', r.userId, 'match', mid, ':', res.error.message);
              });
          });
          /* Mark match as completed in Supabase */
          window._supa.from('matches')
            .update({ status: 'completed' })
            .eq('id', mid)
            .then(function(res) {
              if (res && res.error) console.error('[AdminSync] Marking match completed REJECTED for', mid, ':', res.error.message);
            });
          console.log('[AdminSync] Results synced to Supabase for match:', mid);
        } catch(e) { console.error('[AdminSync] publishResults sync error:', e.message); }
      }, 3000);
    };
  }

  /* ── 3. BAN USER ── */
  function _wrapBanUser() {
    var orig = window.banUser;
    window.banUser = async function(uid) {
      await orig.apply(this, arguments);
      try {
        /* Sync ban to Supabase */
        await window._supa.from('users').update({ is_banned: true }).eq('id', uid);
        console.log('[AdminSync] User ban synced to Supabase:', uid);
      } catch(e) { console.error('[AdminSync] banUser sync error:', e.message); }
    };
  }

  /* ── 4. APPROVE SKY DIAMOND / GREEN DIAMOND WITHDRAWAL REQUEST ── */
  function _wrapApproveSkyDia() {
    var orig = window.approveSkyDiaReq;
    if (!orig) return;
    window.approveSkyDiaReq = async function(reqId, uid, diamonds, isSkyNode) {
      await orig.apply(this, arguments);
      try {
        /* ✅ BUG FIX (2026-07-17, CRITICAL): this previously ALWAYS
           credited sky_diamonds unconditionally, regardless of isSkyNode —
           but this same function/wrapper is also the approve-path for
           green_diamond_withdrawal requests (isSkyNode=false, per
           admin-inline.js's own comment referencing the walletRequests
           node). Approving a WITHDRAWAL should never credit anything (the
           balance was already deducted at submission — approving just
           confirms the UPI payout happened), and if it did credit
           anything by mistake, crediting sky_diamonds for what was a
           green_diamonds request would have been doubly wrong. Now routes
           through resolve_sd_request, which reads request_type from the
           actual sd_requests row and does the correct thing for each type
           — no reliance on isSkyNode's boolean guess about which type this
           is, and no possibility of crediting the wrong currency. */
        var res = await window._supa.rpc('resolve_sd_request', { p_request_id: reqId, p_action: 'approve' });
        if (res.error || (res.data && res.data.ok === false)) {
          console.error('[AdminSync] resolve_sd_request approve failed:', res.error ? res.error.message : res.data.error);
          if (window.showToast) showToast('⚠️ Approval sync failed: ' + (res.error ? res.error.message : res.data.error), true);
          return;
        }
        console.log('[AdminSync] sd_request approval synced:', uid, res.data.request_type);
      } catch(e) { console.error('[AdminSync] approveSkyDiaReq sync error:', e.message); }
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
        var col = type === 'sky' ? 'sky_diamonds' : type === 'green' ? 'green_diamonds' : 'coins';
        var amt = Number(amount) || 0;
        if (!uid || !amt) return;
        await window._supa.rpc('increment_balance', { p_uid: uid, p_col: col, p_amount: amt });
        await window._supa.from('wallet_transactions').insert({
          user_id: uid, currency: col, txn_type: 'credit',
          amount: amt, reason: 'admin_credit', note: note || 'Admin manual credit',
          admin_id: adminId /* ✅ Always log admin UID */
        });
        await window._supa.from('admin_activity_log').insert({
          admin_id: adminId, /* ✅ Required, never null */
          action: 'manual_credit', target_type: 'user', target_id: uid,
          details: { col: col, amount: amt, note: note, timestamp: Date.now() }
        });
        console.log('[AdminSync] Manual credit synced by', adminId, ':', uid, col, amt);
      } catch(e) { console.error('[AdminSync] saveManualCredit sync error:', e.message); }
    };
  }

  /* ── 6. SYNC MATCH CREATION TO SUPABASE ── */
  /* Watch Firebase matches/ for new matches and sync to Supabase */
  function _watchMatchCreation() {
    var rtdb_ = window.rtdb || window.db;
    if (!rtdb_) { setTimeout(_watchMatchCreation, 2000); return; }
    rtdb_.ref('matches').on('child_added', function(snap) {
      var m = snap.val(); if (!m) return;
      /* Sync to Supabase matches table */
      window._supa.from('matches').upsert({
        id: snap.key,
        title: m.name || m.title || 'Match',
        game: 'Free Fire',
        mode: m.mode || m.gameMode || 'solo',
        map: m.map || 'Bermuda',
        status: m.status || 'upcoming',
        entry_type: (m.entryType === 'paid' || m.entryType === 'coin') ? (m.entryType === 'coin' ? 'coins' : 'diamonds') : 'coins',
        entry_fee: Number(m.entryFee) || 0,
        prize_pool: Number(m.firstPrize || m.firstPrizeSD || m.firstPrizeGD || 0),
        max_slots: Number(m.maxSlots) || 12,
        scheduled_at: m.matchTime ? new Date(m.matchTime).toISOString() : new Date().toISOString(),
        room_id: m.roomId || null,
        room_password: m.roomPassword || null,
        is_sponsored: false
      }, { onConflict: 'id' }).then(function(res) {
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
    rtdb_.ref('joinRequests').on('child_changed', function(snap) {
      var j = snap.val(); if (!j) return;
      var status = j.status;
      var supaStatus = status === 'approved' || status === 'joined' || status === 'confirmed' ? 'approved' :
                       status === 'rejected' ? 'rejected' : 'pending';
      window._supa.from('join_requests').upsert({
        id: snap.key,
        match_id: j.tournamentId || j.matchId,
        user_id: j.userId || j.uid,
        status: supaStatus,
        entry_type: j.entryType === 'paid' ? 'diamonds' : 'coins',
        entry_fee_paid: Number(j.entryFee) || 0,
        ign_at_join: j.playerName || j.ign || j.userName || '',
        kills: j.kills || null,
        placement: j.rank || null,
        prize_earned: Number(j.winnings || 0),
        checked_in: j.inRoom || false,
        in_room: j.inRoom || false
      }, { onConflict: 'match_id,user_id' }).then(function(res) {
        if (res && res.error) console.error('[AdminSync] join_requests approval upsert FAILED for', j.userId || j.uid, 'match', j.tournamentId || j.matchId, ':', res.error.message);
      });
    });
  }

  /* ── 8. SYNC USER UPDATES (ban, profile, IGN) ── */
  function _watchUserUpdates() {
    var rtdb_ = window.rtdb || window.db;
    if (!rtdb_) { setTimeout(_watchUserUpdates, 2000); return; }
    rtdb_.ref('users').on('child_changed', function(snap) {
      var u = snap.val(); if (!u) return;
      var uid = snap.key;

      /* ✅ BUG FIX (2026-07-17): coins/sky_diamonds/green_diamonds are no
         longer directly UPDATE-able at all (see COMPLETE_SCHEMA.sql's
         users GRANT block — this was a severe balance-tampering hole).
         Split out into admin_sync_user_balance, a dedicated admin-checked
         RPC for exactly this "mirror Firebase's current value into
         Supabase" legacy-sync use case. */
      var coinsVal = Number(u.coins) || 0;
      var skyVal = Number(u.skyDiamonds || (u.realMoney && u.realMoney.deposited) || 0);
      var greenVal = Number(u.greenDiamonds || (u.realMoney && u.realMoney.winnings) || 0);
      window._supa.rpc('admin_sync_user_balance', {
        p_uid: uid, p_coins: coinsVal, p_sky_diamonds: skyVal, p_green_diamonds: greenVal
      }).then(function(res) {
        if (res && (res.error || (res.data && res.data.success === false))) {
          console.error('[AdminSync] balance sync FAILED for', uid, ':', res.error ? res.error.message : res.data.error);
        }
      });

      /* Only sync key fields to avoid excessive writes */
      var upd = {
        is_banned: u.isBanned || u.blocked || false,
        total_matches: Number(u.stats && u.stats.matches || 0),
        total_wins: Number(u.stats && u.stats.wins || 0),
        total_kills: Number(u.stats && u.stats.kills || 0)
      };
      if (u.ign) upd.ign = u.ign;
      if (u.city) upd.city = u.city;
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
    if (window.auth && window.auth.currentUser) return window.auth.currentUser.uid;
    return null;
  }

  /* ── AUTO-INIT ── */
  /* Wait for Supabase SDK and then start all sync listeners */
  function _startAllSync() {
    if (!window._supa) { setTimeout(_startAllSync, 1000); return; }
    /* Start watchers with delay to let admin panel init first */
    setTimeout(function() {
      _watchMatchCreation();
      _watchJoinApprovals();
      _watchUserUpdates();
      console.log('[AdminSync] All sync watchers active ✅');
    }, 4000);
  }

  _initSupa();
  _startAllSync();

  console.log('[AdminSync] Admin Supabase sync module loaded');

})();

/* ═══════════════════════════════════════════════════════════════════
   SUPABASE SD_REQUESTS → Admin Wallet Panel Bridge
   Users submit deposits to Supabase sd_requests.
   Admin reads from Supabase (not Firebase walletRequests).
═══════════════════════════════════════════════════════════════════ */
(function() {
  function _patchWalletListener() {
    if (!window._supa || !window.setupWalletListener) {
      setTimeout(_patchWalletListener, 1500);
      return;
    }

    /* Override setupWalletListener to load from Supabase */
    window.setupWalletListener = function() {
      _loadSupabaseWallet();
      /* Poll every 30 seconds for new requests */
      setInterval(_loadSupabaseWallet, 30000);
    };

    /* Patch renderWalletRequests to also show Supabase data */
    function _loadSupabaseWallet() {
      if (!window._supa) return;
      window._supa.from('sd_requests')
        .select('*, users(ign, ffUid, email)')
        .order('created_at', { ascending: false })
        .limit(200)
        .then(function(r) {
          if (r.error) { console.error('[WalletSync] Supabase read error:', r.error.message); return; }
          window.allWalletRequests = {};
          (r.data || []).forEach(function(row) {
            window.allWalletRequests[row.id] = {
              uid: row.user_id,
              userId: row.user_id,
              userName: (row.users && row.users.ign) || row.ign || '',
              ffUid: (row.users && row.users.ffUid) || '',
              amount: row.sd_amount || row.amount_inr || 0,
              diamonds: row.sd_amount || 0,
              utrNumber: row.upi_ref || '',
              utr: row.upi_ref || '',
              screenshotUrl: row.payment_proof || '',
              status: row.status || 'pending',
              type: 'add',
              createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
              _supaId: row.id
            };
          });
          /* Also update the badge */
          var pending = Object.values(window.allWalletRequests).filter(function(w) { return w.status === 'pending'; }).length;
          if (window.updateBadge) window.updateBadge('walletBadge', pending);
          if (window.renderWalletRequests) window.renderWalletRequests();
        })
        .catch(function(e) { console.error('[WalletSync] Error:', e.message); });
    }

    console.log('[AdminSync] Wallet listener patched to use Supabase sd_requests ✅');
  }

  setTimeout(_patchWalletListener, 2000);
})();

/* Bug 27 / Bug#118: Sponsored withdrawal functions moved to admin-supabase-sponsored.js */
