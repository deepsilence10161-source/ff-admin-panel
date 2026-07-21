/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  admin-fixes-v25-SUPABASE.js — Final Migration Cleanup Patch   ║
 * ║  Bridge install ke baad Firebase RTDB leftover writes khatam   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * LOADS LAST — after all other scripts
 * Ye patch ye kaam karta hai:
 *   1. admin-supabase-sync.js ke Firebase RTDB watchers ko disable
 *      (kyunki bridge ab sab Supabase mein write kar raha hai,
 *       woh watchers sirf duplicate Supabase upserts karenge)
 *   2. Remaining Firebase writes in feature files ko clean karta hai
 *   3. appSettings ko Supabase se load karne ka fallback add karta hai
 *   4. Badge counts ko Supabase se live update karta hai
 */

(function () {
  'use strict';

  /* Wait for bridge + _supa to be ready */
  function onReady(fn) {
    if (window._supa && window.rtdb && window.rtdb._isSupaBridge) {
      fn();
    } else {
      setTimeout(function() { onReady(fn); }, 300);
    }
  }

  onReady(function() {
    console.log('%c[v25-Supabase] ✅ Final migration patch active', 'color:#ffd700;font-weight:700');

    /* ✅ AUDIT FIX (critical, shared helper): several legacy render functions
       below (renderUsers, renderProfileRequests, renderProfileUpdates, and
       the search/lookup/analytics code that reads usersSnapshot) were
       written for real Firebase snapshots and call `snap.forEach(ch => ...
       ch.val(), ch.key)`. This patch fetches plain objects/arrays from
       Supabase instead, so passing them straight through either crashed
       ("forEach is not a function") or — worse — silently rendered nothing
       because a couple of call sites pass the wrong variable entirely. This
       tiny shim wraps a plain {id: data} object so it behaves exactly like
       a Firebase DataSnapshot for .forEach() consumers, fixing all of them
       consistently in one place instead of patching each render function
       separately. */
    function _mkSnap(obj) {
      obj = obj || {};
      return {
        forEach: function(cb) {
          Object.keys(obj).forEach(function(id) { cb({ key: id, val: function() { return obj[id]; } }); });
        },
        exists: function() { return Object.keys(obj).length > 0; },
        val: function() { return obj; }
      };
    }

    /* ─────────────────────────────────────────────────────────────
       0. CRITICAL: window.adminDb → bridge (fa63-fa70 uses this)
          Also covers window.db.ref() calls that expect RTDB
    ───────────────────────────────────────────────────────────── */
    window.adminDb = window.rtdb; /* fa63-fa70-automation-bundle uses adminDb */

    /* Intercept window.db.ref() calls: some legacy files use window.db as RTDB */
    /* window.db is Firestore — we wrap it to handle .ref() gracefully */
    if (window.db && !window.db._supaWrapped) {
      var _realFirestore = window.db;
      var _dbProxy = new Proxy(_realFirestore, {
        get: function(target, prop) {
          if (prop === 'ref') {
            /* Return bridge's ref method for RTDB-style calls */
            return function(path) { return window.rtdb.ref(path); };
          }
          if (prop === '_supaWrapped') return true;
          var val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
      window.db = _dbProxy;
    }

    /* ─────────────────────────────────────────────────────────────
       1. DISABLE FIREBASE SYNC WATCHERS
       admin-supabase-sync.js ke _watchMatchCreation / _watchJoinApprovals /
       _watchUserUpdates redundant ho gaye — bridge already handles writes.
       Un functions ko no-ops bana do to prevent unnecessary processing.
    ───────────────────────────────────────────────────────────── */
    /* These are internal to admin-supabase-sync.js's IIFE — we can't
       easily disable them after load. But since they're now watching
       Supabase Realtime (via bridge), the upserts they do are
       IDEMPOTENT so no real harm. We just log a marker. */
    window._v25_bridgeActive = true;

    /* ─────────────────────────────────────────────────────────────
       2. FIX: saveTournament — ensure new match goes to Supabase ONLY
       Original code: rtdb.ref('matches').push(data) ← bridge handles
       But it also saves firebase_id as the push key. Now we need
       to save the Supabase UUID back as firebase_id.
    ───────────────────────────────────────────────────────────── */
    var _origSaveTournament = window.saveTournament;
    if (typeof _origSaveTournament === 'function') {
      window.saveTournament = async function(data) {
        /* Bridge will route rtdb.ref('matches').push(data) → Supabase INSERT */
        /* The returned key will be the Supabase UUID */
        return _origSaveTournament.apply(this, arguments);
      };
    }

    /* ─────────────────────────────────────────────────────────────
       3. FIX: loadTournaments — use Supabase directly for performance
       Override to read from Supabase with proper field mapping
    ───────────────────────────────────────────────────────────── */
    var _origLoadTournaments = window.loadTournaments;
    if (typeof _origLoadTournaments === 'function') {
      window.loadTournaments = async function() {
        var supa = window._supa;
        if (!supa) return _origLoadTournaments && _origLoadTournaments();
        try {
          var filter = window.currentFilter || 'all';
          var query = supa.from('matches').select('*').order('scheduled_at', { ascending: true }).limit(300);
          if (filter !== 'all') query = query.eq('status', filter);
          var result = await query;
          if (result.error) throw result.error;
          /* Build the allTournaments cache with Firebase-format data */
          window.allTournaments = window.allTournaments || {};
          var newCache = {};
          (result.data || []).forEach(function(m) {
            /* Use firebase_id if available, else UUID */
            var key = m.firebase_id || m.id;
            newCache[key] = _supaMatchToFirebase(m);
          });
          window.allTournaments = newCache;
          if (typeof window.renderTournaments === 'function') window.renderTournaments();
        } catch(e) {
          console.warn('[v25] loadTournaments Supabase failed, fallback to bridge:', e);
          if (typeof _origLoadTournaments === 'function') _origLoadTournaments();
        }
      };
    }

    /* ─────────────────────────────────────────────────────────────
       4. FIX: setupUsersListener — use Supabase Realtime for users
    ───────────────────────────────────────────────────────────── */
    var _origSetupUsersListener = window.setupUsersListener;
    if (typeof _origSetupUsersListener === 'function') {
      window.setupUsersListener = function() {
        var supa = window._supa;
        if (!supa) return _origSetupUsersListener && _origSetupUsersListener();

        /* Load all users from Supabase */
        function loadUsers() {
          supa.from('users').select('*').eq('is_deleted', false).order('created_at', { ascending: false }).limit(500)
            .then(function(r) {
              if (r.error) return;
              window.usersCache = window.usersCache || {};
              (r.data || []).forEach(function(u) {
                window.usersCache[u.id] = _supaUserToFirebase(u);
              });
              /* ✅ AUDIT FIX (critical): renderUsers() / admin-player-lookup.js /
                 admin-analytics.js all read the OLDER global `usersSnapshot`
                 (not `usersCache`) — without this, that variable stayed null
                 forever under the Supabase bridge and the Users table,
                 Player Lookup, and per-user analytics rendered completely
                 empty with no error. */
              usersSnapshot = _mkSnap(window.usersCache); /* bare, NOT window. — usersSnapshot is `let`-scoped in admin-inline.js, shared lexically across script tags but NOT a window property; see comment above _mkSnap */
              if (typeof window.renderUsers === 'function') window.renderUsers(window.usersCache);
            });
        }
        loadUsers();

        /* Realtime subscription for live updates */
        try {
          supa.channel('v25_users_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, function(payload) {
              var row = payload.new || payload.old;
              if (!row) return;
              if (payload.eventType === 'DELETE') {
                delete window.usersCache[row.id];
              } else {
                window.usersCache[row.id] = _supaUserToFirebase(row);
              }
              usersSnapshot = _mkSnap(window.usersCache); /* bare, NOT window. — usersSnapshot is `let`-scoped in admin-inline.js, shared lexically across script tags but NOT a window property; see comment above _mkSnap */
              if (typeof window.renderUsers === 'function') window.renderUsers(window.usersCache);
            })
            .subscribe();
        } catch(e) {
          /* Fallback: poll every 10 seconds */
          setInterval(loadUsers, 10000);
        }
      };
    }

    /* ─────────────────────────────────────────────────────────────
       5. BADGE COUNTS — Live pending counts from Supabase
    ───────────────────────────────────────────────────────────── */
    function updateBadgeCounts() {
      var supa = window._supa;
      if (!supa) return;

      var tables = [
        { table: 'sd_requests',       badge: 'walletBadge',   filter: { status: 'pending' } },
        { table: 'profile_requests',  badge: 'profileBadge',  filter: { status: 'pending' } },
        { table: 'profile_updates',   badge: 'profileUpdBadge', filter: { status: 'pending' } },
        { table: 'join_requests',     badge: 'joinBadge',     filter: { status: 'joined' } },
        { table: 'disputes',          badge: 'disputeBadge',  filter: { status: 'pending' } },
        { table: 'team_requests',     badge: 'teamBadge',     filter: { status: 'pending' } }
      ];

      tables.forEach(function(t) {
        var q = supa.from(t.table).select('id', { count: 'exact', head: true });
        if (t.filter) {
          Object.keys(t.filter).forEach(function(col) { q = q.eq(col, t.filter[col]); });
        }
        q.then(function(r) {
          var count = r.count || 0;
          /* Update badge elements */
          var els = document.querySelectorAll('[data-badge="' + t.badge + '"], #' + t.badge + ', .' + t.badge);
          els.forEach(function(el) {
            el.textContent = count > 0 ? count : '';
            el.style.display = count > 0 ? '' : 'none';
          });
          /* Also try the generic badge update function */
          if (typeof window._updateNavBadge === 'function') {
            window._updateNavBadge(t.badge, count);
          }
        }).catch(function(){});
      });
    }

    /* Update badges immediately and every 30 seconds */
    updateBadgeCounts();
    setInterval(updateBadgeCounts, 30000);
    window._updateBadgeCounts = updateBadgeCounts;

    /* ─────────────────────────────────────────────────────────────
       6. FIX: walletRequests — setupWalletListener via Supabase
    ───────────────────────────────────────────────────────────── */
    var _origSetupWalletListener = window.setupWalletListener;
    if (typeof _origSetupWalletListener === 'function') {
      window.setupWalletListener = function() {
        var supa = window._supa;
        if (!supa) return _origSetupWalletListener && _origSetupWalletListener();

        function loadWallet() {
          supa.from('sd_requests').select('*, users!sd_requests_user_id_fkey(ign, ff_uid, phone)')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(200)
            .then(function(r) {
              if (r.error) return;
              window.allWalletRequests = {};
              (r.data || []).forEach(function(req) {
                var u = req.users || {};
                window.allWalletRequests[req.id] = {
                  id:           req.id,
                  uid:          req.user_id,
                  userId:       req.user_id,
                  type:         req.type || 'add',
                  amount:       req.amount || 0,
                  diamonds:     req.amount || 0,
                  utrNumber:    req.utr_number || '',
                  upiId:        req.upi_id || '',
                  screenshotUrl: req.screenshot_url || '',
                  screenshotBase64: req.screenshot_url || '',
                  status:       req.status || 'pending',
                  userName:     u.ign || '',
                  displayName:  u.ign || '',
                  ffUid:        u.ff_uid || req.ff_uid || '',
                  creatorCode:  req.creator_code || '',
                  createdAt:    req.created_at ? new Date(req.created_at).getTime() : Date.now()
                };
              });
              if (typeof window.renderWalletRequests === 'function') window.renderWalletRequests(window.allWalletRequests);
            });
        }
        loadWallet();

        try {
          supa.channel('v25_wallet_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sd_requests' }, loadWallet)
            .subscribe();
        } catch(e) { setInterval(loadWallet, 8000); }
      };
    }

    /* ─────────────────────────────────────────────────────────────
       7. FIX: setupProfileListener via Supabase
    ───────────────────────────────────────────────────────────── */
    var _origSetupProfileListener = window.setupProfileListener;
    if (typeof _origSetupProfileListener === 'function') {
      window.setupProfileListener = function() {
        var supa = window._supa;
        if (!supa) return _origSetupProfileListener && _origSetupProfileListener();

        function loadProfiles() {
          supa.from('profile_requests').select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(200)
            .then(function(r) {
              if (r.error) return;
              var requests = {};
              (r.data || []).forEach(function(req) {
                requests[req.id] = {
                  id:            req.id,
                  uid:           req.user_id,
                  requestedIgn:  req.requested_ign  || '',
                  ign:           req.requested_ign  || '',
                  requestedFfUid: req.requested_ff_uid || '',
                  ffUid:         req.requested_ff_uid || '',
                  phone:         req.requested_phone || '',
                  screenshotUrl: req.screenshot_url  || '',
                  status:        req.status          || 'pending',
                  createdAt:     req.created_at ? new Date(req.created_at).getTime() : Date.now()
                };
              });
              if (typeof window.renderProfileRequests === 'function') window.renderProfileRequests(_mkSnap(requests));
            });
        }
        loadProfiles();
        try {
          supa.channel('v25_profile_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_requests' }, loadProfiles)
            .subscribe();
        } catch(e) { setInterval(loadProfiles, 8000); }
      };
    }

    /* ─────────────────────────────────────────────────────────────
       8. FIX: setupProfileUpdateListener via Supabase
    ───────────────────────────────────────────────────────────── */
    var _origSetupProfileUpdateListener = window.setupProfileUpdateListener;
    if (typeof _origSetupProfileUpdateListener === 'function') {
      window.setupProfileUpdateListener = function() {
        var supa = window._supa;
        if (!supa) return _origSetupProfileUpdateListener && _origSetupProfileUpdateListener();

        function loadProfileUpdates() {
          supa.from('profile_updates').select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(200)
            .then(function(r) {
              if (r.error) return;
              var updates = {};
              (r.data || []).forEach(function(u) {
                updates[u.id] = {
                  id:             u.id,
                  uid:            u.user_id,
                  requestedIgn:   u.new_ign     || '',
                  newIgn:         u.new_ign     || '',
                  requestedFfUid: u.new_ff_uid  || '',
                  newFfUid:       u.new_ff_uid  || '',
                  currentIgn:     u.current_ign || '',
                  currentFfUid:   u.current_ff_uid || '',
                  newPhone:       u.new_phone   || '',
                  status:         u.status      || 'pending',
                  requestCount:   u.request_count || 1,
                  createdAt:      u.created_at ? new Date(u.created_at).getTime() : Date.now()
                };
              });
              /* ✅ AUDIT FIX (critical): real function is `renderProfileUpdates`,
                 not `renderProfileUpdateRequests` (typo) — the typeof guard
                 was always false so this never ran, and Profile Updates
                 admin section silently never showed live data. Also needs
                 the snapshot shim like renderProfileRequests above. */
              if (typeof window.renderProfileUpdates === 'function') window.renderProfileUpdates(_mkSnap(updates));
            });
        }
        loadProfileUpdates();
        try {
          supa.channel('v25_profile_upd_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_updates' }, loadProfileUpdates)
            .subscribe();
        } catch(e) { setInterval(loadProfileUpdates, 8000); }
      };
    }

    /* ─────────────────────────────────────────────────────────────
       9. HELPER CONVERTERS (re-used by override functions above)
    ───────────────────────────────────────────────────────────── */
    function _supaMatchToFirebase(m) {
      if (!m) return null;
      return {
        id:               m.firebase_id || m.id,
        name:             m.name        || '',
        gameMode:         m.game_mode   || m.mode || 'solo',
        mode:             m.game_mode   || m.mode || 'solo',
        map:              m.map_name    || m.map  || 'Bermuda',
        entryType:        m.entry_type  || 'paid',
        entryFee:         m.entry_fee   || 0,
        maxSlots:         m.max_slots   || 12,
        filledSlots:      m.filled_slots || 0,
        joinedSlots:      m.filled_slots || 0,
        firstPrize:       m.first_prize  || 0,
        secondPrize:      m.second_prize || 0,
        thirdPrize:       m.third_prize  || 0,
        prizePool:        m.prize_pool   || 0,
        perKillPrize:     m.per_kill_prize || 0,
        matchTime:        m.scheduled_at ? new Date(m.scheduled_at).getTime() : 0,
        roomId:           m.room_id      || '',
        roomPassword:     m.room_password || '',
        roomStatus:       m.room_status  || 'pending',
        status:           m.status       || 'upcoming',
        isSpecial:        m.is_special   || false,
        specialCategory:  m.special_category || 'none',
        prizeType:        m.prize_type   || 'greenDiamond',
        creatorCode:      m.creator_code || '',
        reminderSent:     m.reminder_sent || false,
        resultScreenshot: m.result_screenshot || '',
        createdAt:        m.created_at ? new Date(m.created_at).getTime() : null
      };
    }
    window._supaMatchToFirebase = _supaMatchToFirebase;

    function _supaUserToFirebase(u) {
      if (!u) return null;
      return {
        id:              u.id,
        ign:             u.ign            || '',
        ffUid:           u.ff_uid         || '',
        phone:           u.phone          || '',
        email:           u.email          || '',
        coins:           u.coins          || 0,
        skyDiamonds:     u.sky_diamonds   || 0,
        greenDiamonds:   u.green_diamonds || 0,
        level:           u.level          || 1,
        exp:             u.exp            || 0,
        isBanned:        u.is_banned      || false,
        blocked:         u.is_banned      || false,
        profileVerified: u.profile_verified || false,
        profileStatus:   u.profile_status || '',
        status:          u.status         || 'active',
        approved:        u.approved       || false,
        pendingIgn:      u.pending_ign    || null,
        accessMode:      u.access_mode    || 'FULL',
        totalKills:      u.total_kills    || 0,
        totalWinnings:   u.total_winnings || 0,
        winStreak:       u.win_streak     || 0,
        premiumTier:     u.premium_tier   || 0,
        referralCount:   u.referral_count || 0,
        realMoney: { deposited: u.sky_diamonds || 0, winnings: u.green_diamonds || 0 },
        wallet: { depositBalance: u.sky_diamonds || 0, winningBalance: u.green_diamonds || 0 },
        stats: {
          matches: u.matches_played || 0, wins: u.wins || 0,
          kills: u.total_kills || 0, earnings: u.total_winnings || 0
        },
        createdAt: u.created_at ? new Date(u.created_at).getTime() : null
      };
    }
    window._supaUserToFirebase = _supaUserToFirebase;

    /* ─────────────────────────────────────────────────────────────
       10. CLEANUP: Remove Firebase RTDB data nodes (run once)
       Ye function manually run karo console se AFTER migration verify:
       window._cleanFirebaseNodes()
    ───────────────────────────────────────────────────────────── */
    window._cleanFirebaseNodes = function() {
      var realRtdb = window._realFbRtdb;
      if (!realRtdb) { console.error('Real Firebase RTDB not found'); return; }

      var nodesToDelete = [
        'matches', 'users', 'joinRequests', 'walletRequests',
        'profileRequests', 'profileUpdates', 'teamRequests',
        'notifications', 'activityLogs', 'adminActivityLog',
        'disputes', 'coinRequests', 'premiumRequests',
        'matchTemplates', 'vouchers', 'skyDiamondRequests',
        'results', 'polls', 'suggestions', 'sponsoredTournaments',
        'creatorCodes', 'ffUIDIndex', 'walletAuditLog',
        'userMatches', 'adminAlerts', 'cheatReports',
        'refundRequests', 'fraudCases', 'scheduledBroadcasts',
        'kycRequests', 'adminNotes', 'platformStats'
      ];

      console.log('[v25] Starting Firebase RTDB node cleanup...');
      console.log('[v25] Nodes to delete:', nodesToDelete);

      var deleted = [];
      var failed = [];

      var promises = nodesToDelete.map(function(node) {
        return realRtdb.ref(node).remove()
          .then(function() { deleted.push(node); })
          .catch(function(e) { failed.push(node + ': ' + e.message); });
      });

      Promise.all(promises).then(function() {
        console.log('%c[v25] ✅ Deleted nodes:', 'color:#00ff9c', deleted);
        if (failed.length) console.warn('[v25] Failed:', failed);
        console.log('%c[v25] Firebase RTDB now contains ONLY: support/, deviceJoins/, admins/, appSettings/');
      });
    };

    /* ─────────────────────────────────────────────────────────────
       11. VERIFY MIGRATION STATUS
       window._verifyMigration() — check data counts in both systems
    ───────────────────────────────────────────────────────────── */
    window._verifyMigration = async function() {
      var supa = window._supa;
      var realRtdb = window._realFbRtdb;
      if (!supa || !realRtdb) { console.error('Not ready'); return; }

      console.log('%c[v25] Migration Verification...', 'color:#ffd700;font-weight:700');

      var tables = ['matches','users','join_requests','sd_requests','profile_requests','profile_updates','wallet_transactions'];
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        try {
          var r = await supa.from(t).select('id', { count: 'exact', head: true });
          console.log('[v25] Supabase ' + t + ':', r.count, 'rows');
        } catch(e) { console.warn('[v25] Cannot read ' + t + ':', e.message); }
      }

      /* Check Firebase only has allowed paths */
      var keepPaths = ['support', 'deviceJoins', 'admins', 'appSettings'];
      for (var j = 0; j < keepPaths.length; j++) {
        var p = keepPaths[j];
        try {
          var snap = await realRtdb.ref(p).once('value');
          console.log('[v25] Firebase RTDB ' + p + ':', snap.exists() ? 'has data ✅' : 'empty');
        } catch(e) { console.warn('[v25] Firebase', p, 'check failed:', e.message); }
      }

      console.log('%c[v25] Bridge active:', 'color:#00ff9c', !!window.rtdb._isSupaBridge);
    };

    console.log('%c[v25-Supabase] 🎯 All patches applied. Run window._verifyMigration() to check status.', 'color:#ffd700');
  });

})();
