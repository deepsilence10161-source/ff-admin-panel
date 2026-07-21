/* ================================================================
   ADMIN FEATURES BUNDLE fa63–fa70
   fa63: Real-time Revenue Dashboard (hourly/daily live graph)
   fa64: Auto Fraud Score (0-100 risk per user, auto-assign)
   fa65: User Funnel Analytics (Registration→Match→Deposit)
   fa66: Auto-Cancel Empty Matches + Refund
   fa67: Daily Payout Report (auto-generate summary)
   fa68: Season Auto-Reset (month end rankings archive+reset)
   fa69: Referral Chain Visualizer (tree view)
   fa70: Cohort Retention Analysis (Week 1/2/4 retention)
   ================================================================ */

/* ─────────────────────────────────────────────────────────────
   fa63: REAL-TIME REVENUE DASHBOARD
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa63_showRevenueDashboard = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    var now   = Date.now();
    var day   = now - 24 * 3600000;
    var week  = now - 7  * 86400000;
    var month = now - 30 * 86400000;

    db.ref('matches').orderByChild('status').equalTo('completed').once('value', function (snap) {
      var hourly = new Array(24).fill(0);
      var dailyR = 0, weeklyR = 0, monthlyR = 0;
      var matchCount = 0;

      if (snap.exists()) {
        snap.forEach(function (c) {
          var m = c.val();
          var ts = m.completedAt || m.startTime || 0;
          var rev = (Number(m.entryFee) || 0) * (Number(m.joinedCount) || 0) - (Number(m.prizePool) || 0);
          if (rev < 0) rev = 0;

          if (ts >= day)   { dailyR  += rev; var h = new Date(ts).getHours(); hourly[h] += rev; }
          if (ts >= week)  { weeklyR  += rev; }
          if (ts >= month) { monthlyR += rev; matchCount++; }
        });
      }

      var maxH = Math.max.apply(null, hourly) || 1;
      var bars = hourly.map(function (v, h) {
        var pct = Math.round((v / maxH) * 100);
        var isNow = new Date().getHours() === h;
        return '<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:18px">' +
          '<div style="font-size:8px;color:#555;margin-bottom:2px">' + (v > 0 ? '₹'+v : '') + '</div>' +
          '<div style="width:100%;height:' + Math.max(3, Math.round(pct * 0.6)) + 'px;background:' +
            (isNow ? '#ffd700' : 'rgba(0,255,156,.5)') +
            ';border-radius:2px 2px 0 0"></div>' +
          '<div style="font-size:8px;color:' + (isNow ? '#ffd700' : '#444') + '">' + h + '</div>' +
        '</div>';
      }).join('');

      var h =
        '<div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">' +
            '<div style="background:rgba(0,255,156,.07);border:1px solid rgba(0,255,156,.15);border-radius:14px;padding:14px;text-align:center">' +
              '<div style="font-size:10px;color:#888;margin-bottom:4px">Today</div>' +
              '<div style="font-size:20px;font-weight:900;color:#00ff9c">₹' + dailyR + '</div>' +
            '</div>' +
            '<div style="background:rgba(0,212,255,.07);border:1px solid rgba(0,212,255,.15);border-radius:14px;padding:14px;text-align:center">' +
              '<div style="font-size:10px;color:#888;margin-bottom:4px">This Week</div>' +
              '<div style="font-size:20px;font-weight:900;color:#00d4ff">₹' + weeklyR + '</div>' +
            '</div>' +
            '<div style="background:rgba(255,215,0,.07);border:1px solid rgba(255,215,0,.15);border-radius:14px;padding:14px;text-align:center">' +
              '<div style="font-size:10px;color:#888;margin-bottom:4px">This Month</div>' +
              '<div style="font-size:20px;font-weight:900;color:#ffd700">₹' + monthlyR + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:11px;color:#888;margin-bottom:8px">Today\'s revenue by hour:</div>' +
          '<div style="display:flex;align-items:flex-end;gap:1px;height:70px;margin-bottom:8px">' + bars + '</div>' +
          '<div style="font-size:10px;color:#444;text-align:center">Based on ' + matchCount + ' completed matches</div>' +
        '</div>';

      if (window.openAdminModal) window.openAdminModal('📊 Revenue Dashboard', h);
      else if (window.openModal) window.openModal('📊 Revenue Dashboard', h);
    });
  };

  console.log('[fa63] ✅ Revenue Dashboard loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa64: AUTO FRAUD SCORE (0-100 risk per user)
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa64_calcFraudScore = function (userData) {
    if (!userData) return 0;
    var score = 0;
    var u = userData;

    // No profile approved
    if (u.profileStatus !== 'approved') score += 15;

    // Only withdrawals, no deposits
    var dep = Number((u.realMoney || {}).deposited) || 0;
    var win = Number((u.realMoney || {}).winnings)  || 0;
    if (dep === 0 && win > 100) score += 20;

    // Very new account with large activity
    var ageHours = u.createdAt ? (Date.now() - u.createdAt) / 3600000 : 999;
    if (ageHours < 24 && (Number((u.stats || {}).matches) || 0) > 5) score += 20;

    // Banned before
    if (u.banned || u.previousBan) score += 25;

    // No IGN set
    if (!u.ign || u.ign.length < 2) score += 10;

    // Flagged by anticheat
    if (u.anticheatFlags && u.anticheatFlags.length > 0) score += 20;

    // Multiple flag sources
    if (u.fraudFlags && Object.keys(u.fraudFlags).length > 2) score += 15;

    return Math.min(100, score);
  };

  window.fa64_showFraudScores = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('users').once('value', function (snap) {
      var highRisk = [];
      if (snap.exists()) {
        snap.forEach(function (c) {
          var u = c.val();
          var score = window.fa64_calcFraudScore(u);
          if (score >= 40) {
            highRisk.push({ uid: c.key, name: u.ign || u.displayName || 'User', score: score });
            /* ✅ Bug 19 Fix: Sync fraud score to BOTH Firebase AND Supabase
               Admin dashboard reads Firebase fraudScore — so both must be updated */
            db.ref('users/' + c.key + '/fraudScore').set(score);
            if (window._supa) {
              window._supa.from('users')
                .update({ fraud_score: score, fraud_checked_at: new Date().toISOString() })
                .eq('id', c.key)
                .catch(function(e){ console.warn('[fa64] Supabase fraud score sync failed:', e.message); });
            }
          }
        });
      }

      highRisk.sort(function (a, b) { return b.score - a.score; });

      var rows = highRisk.slice(0, 20).map(function (u) {
        var color = u.score >= 70 ? '#ff4444' : u.score >= 50 ? '#ffa500' : '#ffd700';
        var label = u.score >= 70 ? 'HIGH RISK' : u.score >= 50 ? 'MEDIUM' : 'LOW';
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
          '<div style="flex:1">' +
            '<div style="font-size:12px;font-weight:700;color:#fff">' + u.name + '</div>' +
            '<div style="font-size:10px;color:#555">' + u.uid.substring(0,10) + '...</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.06);border-radius:8px;height:6px;width:80px;overflow:hidden">' +
            '<div style="height:100%;width:' + u.score + '%;background:' + color + ';border-radius:8px"></div>' +
          '</div>' +
          '<span style="font-size:11px;font-weight:800;color:' + color + ';min-width:70px;text-align:right">' + u.score + ' · ' + label + '</span>' +
        '</div>';
      }).join('');

      var h =
        '<div>' +
          '<div style="font-size:12px;color:#888;margin-bottom:12px">' + highRisk.length + ' users with risk score ≥ 40:</div>' +
          '<div style="max-height:320px;overflow-y:auto">' + (rows || '<div style="text-align:center;color:#555;padding:20px">Koi high-risk user nahi mila ✅</div>') + '</div>' +
        '</div>';

      if (window.openAdminModal) window.openAdminModal('🛡️ Fraud Score Report', h);
      else if (window.openModal) window.openModal('🛡️ Fraud Score Report', h);
    });
  };

  // Auto-run daily
  var key = '_fa64_' + new Date().toISOString().slice(0,10);
  var _t = 0, _iv = setInterval(function () {
    _t++;
    if (window.db || window.adminDb) {
      clearInterval(_iv);
      if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); setTimeout(function () {
        (window.adminDb || window.db).ref('users').once('value', function (snap) {
          if (!snap.exists()) return;
          snap.forEach(function (c) {
            var score = window.fa64_calcFraudScore(c.val());
            if (score > 0) {
              (window.adminDb || window.db).ref('users/' + c.key + '/fraudScore').set(score);
              /* FIX Bug#11: Also persist fraud score to Supabase — user-panel reads from Supabase */
              if (window._supa) {
                window._supa.from('users')
                  .update({ fraud_score: score, fraud_checked_at: new Date().toISOString() })
                  .eq('id', c.key)
                  .catch(function(e){ console.warn('[Bug#11 Fix] Fraud score Supabase sync:', e.message); });
              }
            }
          });
        });
      }, 8000); }
    }
    if (_t > 30) clearInterval(_iv);
  }, 600);

  console.log('[fa64] ✅ Auto Fraud Score loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa65: USER FUNNEL ANALYTICS
   Registration → Profile → First Match → Deposit
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa65_showFunnel = function () {
    /* Bug New-15 Fix: Use Supabase users (source of truth).
       u.realMoney.deposited was Firebase-only and always stale.
       Now reads sky_diamonds (paid match currency) to measure "made a deposit". */
    if (!window._supa) {
      if (window.openAdminModal) window.openAdminModal('🔻 User Funnel Analytics', '<div style="padding:20px;text-align:center;color:#888">Supabase not ready</div>');
      return;
    }

    window._supa.from('users')
      .select('id,ign,total_matches,sky_diamonds,rank_points')
      .then(function (r) {
        var allUsers = r.data || [];
        var total = allUsers.length;
        var hasProfile = 0, hasMatch = 0, hasDeposit = 0;

        allUsers.forEach(function (u) {
          if (u.ign) hasProfile++;
          if (Number(u.total_matches) > 0) hasMatch++;
          if (Number(u.sky_diamonds) > 0) hasDeposit++;
        });

      /* ✅ Bug 29 Fix: 1 decimal place precision (important for small user bases) */
      function pct(n) { return total > 0 ? parseFloat(((n / total) * 100).toFixed(1)) : 0; }

      var steps = [
        { label: 'Registered Users',  count: total,      color: '#00d4ff' },
        { label: 'Profile Setup',     count: hasProfile, color: '#00ff9c' },
        { label: 'Played 1st Match',  count: hasMatch,   color: '#ffd700' },
        { label: 'Bought Sky Diamonds', count: hasDeposit, color: '#b964ff' }
      ];

      var bars = steps.map(function (s, i) {
        var p = pct(s.count);
        var dropPct = i > 0 ? pct(steps[i-1].count - s.count) : 0;
        return '<div style="margin-bottom:14px">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
            '<span style="font-size:12px;color:#ccc">' + (i+1) + '. ' + s.label + '</span>' +
            '<span style="font-size:12px;font-weight:800;color:' + s.color + '">' + s.count + ' (' + p.toFixed(1) + '%)</span>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.06);border-radius:6px;height:10px;overflow:hidden">' +
            '<div style="height:100%;width:' + p + '%;background:' + s.color + ';border-radius:6px;transition:width .6s ease"></div>' +
          '</div>' +
          (i > 0 && dropPct > 0 ? '<div style="font-size:10px;color:#ff6b6b;margin-top:3px">↓ ' + dropPct.toFixed(1) + '% dropped here</div>' : '') +
        '</div>';
      }).join('');

      var h = '<div>' + bars + '</div>';
      if (window.openAdminModal) window.openAdminModal('🔻 User Funnel Analytics', h);
      else if (window.openModal) window.openModal('🔻 User Funnel Analytics', h);
    }).catch(function (e) {
      console.error('[fa65] Supabase error:', e.message);
      if (window.toast) window.toast('Funnel data load failed', 'err');
    });
  };

  console.log('[fa65] ✅ User Funnel Analytics loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa66: AUTO-CANCEL EMPTY MATCHES + REFUND
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var MIN_PLAYERS_PCT = 0.3; // Default: cancel if < 30% filled at start time

  /* Bug#49 Fix: Read threshold from Firebase adminConfig/autoBan instead of hardcoded value */
  (function _loadAutoBanConfig() {
    var db = window.adminDb || window.db;
    if (!db) return;
    db.ref('adminConfig/autoBan').once('value', function(snap) {
      var cfg = snap.val() || {};
      if (cfg.minPlayersPct !== undefined) MIN_PLAYERS_PCT = Number(cfg.minPlayersPct) || 0.3;
      console.log('[Bug#49 Fix] fa66 MIN_PLAYERS_PCT loaded from adminConfig:', MIN_PLAYERS_PCT);
    });
    /* Re-read config every hour in case admin changes it */
    setInterval(function() {
      db.ref('adminConfig/autoBan').once('value', function(snap) {
        var cfg = snap.val() || {};
        if (cfg.minPlayersPct !== undefined) MIN_PLAYERS_PCT = Number(cfg.minPlayersPct) || 0.3;
      });
    }, 60 * 60 * 1000);
  })();

  window.fa66_checkAndCancelEmpty = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    var now = Date.now();

    db.ref('matches').orderByChild('status').equalTo('upcoming').once('value', function (snap) {
      if (!snap.exists()) return;
      snap.forEach(function (c) {
        var m = c.val(); var key = c.key;
        /* FIX Bug#109: Skip matches already cancelled or finished by admin */
        if (m.status === 'cancelled' || m.status === 'resultPublished' || m.status === 'completed') return;
        if (!m.startTime || m.startTime > now) return; // not started yet (future)
        if (m.startTime + 15 * 60000 < now) return; // more than 15 min past start, skip

        var filled = Number(m.joinedCount) || 0;
        var max    = Number(m.maxPlayers)  || 1;

        if (filled < 2 || (filled / max) < MIN_PLAYERS_PCT) {
          // Auto-cancel
          db.ref('matches/' + key).update({ status: 'cancelled', cancelledAt: Date.now(), cancelReason: 'auto_low_players' });

          // Bug New-5 Fix: Refund via Supabase RPC (authoritative balance) instead
          // of Firebase transaction so both databases stay in sync
          if (filled > 0 && m.entryFee > 0) {
            var supa = window._supa;
            if (supa) {
              // Fetch joined players from Supabase join_requests
              supa.from('join_requests')
                .select('user_id,entry_fee,entry_type')
                .eq('match_id', key)
                .not('status', 'in', '("cancelled","refunded")')
                .then(function (jr) {
                  var rows = jr.data || [];
                  rows.forEach(function (r) {
                    var currency = r.entry_type === 'sky' ? 'sky_diamonds' : 'coins';
                    var refundAmt = Number(r.entry_fee) || Number(m.entryFee) || 0;
                    if (!refundAmt) return;
                    // Supabase balance refund
                    supa.rpc('increment_balance', { p_uid: r.user_id, p_col: currency, p_amount: refundAmt })
                      .catch(function (e) { console.error('[fa66] refund error', r.user_id, e.message); });
                    // Mark join_request as refunded
                    supa.from('join_requests').update({ status: 'refunded' })
                      .eq('user_id', r.user_id).eq('match_id', key).catch(function(){});
                    // Notify user via Firebase
                    db.ref('users/' + r.user_id + '/notifications').push({
                      title: '🔄 Match Cancelled — Refund!',
                      message: (m.name || 'Match') + ' cancel ho gaya (players kam the). ' + refundAmt + ' ' + currency + ' refund ho gaya.',
                      type: 'refund',
                      timestamp: Date.now(),
                      read: false
                    });
                  });
                }).catch(function (e) { console.error('[fa66] join_requests fetch error:', e.message); });
            } else {
              // Supabase unavailable — Firebase fallback only
              db.ref('joinedMatches').once('value', function (jSnap) {
                if (!jSnap.exists()) return;
                jSnap.forEach(function (uSnap) {
                  uSnap.forEach(function (mSnap) {
                    if (mSnap.val().matchId === key) {
                      var uid = uSnap.key;
                      db.ref('users/' + uid + '/coins').transaction(function (coins) { return (coins || 0) + (Number(m.entryFee) || 0); });
                    }
                  });
                });
              });
            }
          }

          if (window.toast) window.toast('⚠️ Match cancelled: ' + (m.name || key) + ' (' + filled + ' players)', 'warn');
        }
      });
    });
  };

  // Run every 10 minutes
  var _t = 0, _iv = setInterval(function () {
    _t++;
    if (window.db || window.adminDb) {
      clearInterval(_iv);
      setInterval(window.fa66_checkAndCancelEmpty, 10 * 60 * 1000);
      setTimeout(window.fa66_checkAndCancelEmpty, 5000);
    }
    if (_t > 30) clearInterval(_iv);
  }, 600);

  console.log('[fa66] ✅ Auto-Cancel Empty Matches loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa67: DAILY PAYOUT REPORT
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa67_generateDailyReport = function () {
    /* Bug New-7 Fix: Read from Supabase wallet_transactions (source of truth).
       Firebase withdrawalRequests can be stale or partial after Supabase migration. */
    if (!window._supa) {
      if (window.toast) window.toast('Supabase not ready', 'err');
      return;
    }

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var todayISO = today.toISOString();

    window._supa.from('wallet_transactions')
      .select('txn_type,amount,currency,created_at')
      .gte('created_at', todayISO)
      .then(function (txRes) {
        var approved = 0, rejected = 0, totalPaid = 0, pending = 0;
        var db = window.adminDb || window.db;

        (txRes.data || []).forEach(function (t) {
          if (t.txn_type === 'withdrawal_approved') { approved++; totalPaid += Number(t.amount) || 0; }
          else if (t.txn_type === 'withdrawal_rejected') rejected++;
          else if (t.txn_type === 'withdrawal_pending') pending++;
        });

        // Also get pending from Supabase sd_requests for today
        window._supa.from('sd_requests')
          .select('status,amount_inr')
          .gte('created_at', todayISO)
          .eq('status', 'pending')
          .then(function (sdRes) {
            pending += (sdRes.data || []).length;

        // Match stats still from Firebase (matches are Firebase-primary)
        if (!db) return renderReport(approved, rejected, totalPaid, pending, 0, 0);
        db.ref('matches').orderByChild('completedAt').startAt(today.getTime()).once('value', function (mSnap) {
          var matchesCompleted = 0, revenueToday = 0;
          if (mSnap.exists()) {
            mSnap.forEach(function (c) {
              var m = c.val();
              matchesCompleted++;
              revenueToday += Math.max(0, (Number(m.entryFee)||0) * (Number(m.joinedCount)||0) - (Number(m.prizePool)||0));
            });
          }
          renderReport(approved, rejected, totalPaid, pending, matchesCompleted, revenueToday);
        });

        }).catch(function () { renderReport(approved, rejected, totalPaid, pending, 0, 0); });
      }).catch(function (e) {
        console.error('[fa67] Supabase error:', e.message);
        if (window.toast) window.toast('Report load failed: ' + e.message, 'err');
      });

    function renderReport(approved, rejected, totalPaid, pending, matchesCompleted, revenueToday) {
      var dateStr = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'short', year:'numeric' });

      var h =
        '<div>' +
          '<div style="font-size:12px;color:#888;margin-bottom:14px">📅 ' + dateStr + '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">' +
            '<div style="background:rgba(0,255,156,.07);border-radius:12px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:#888">Approved Payouts</div>' +
              '<div style="font-size:22px;font-weight:900;color:#00ff9c">' + approved + '</div>' +
            '</div>' +
            '<div style="background:rgba(0,212,255,.07);border-radius:12px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:#888">Total Paid</div>' +
              '<div style="font-size:22px;font-weight:900;color:#00d4ff">₹' + totalPaid + '</div>' +
            '</div>' +
            '<div style="background:rgba(255,215,0,.07);border-radius:12px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:#888">Matches Done</div>' +
              '<div style="font-size:22px;font-weight:900;color:#ffd700">' + matchesCompleted + '</div>' +
            '</div>' +
            '<div style="background:rgba(0,255,156,.07);border-radius:12px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:#888">Revenue</div>' +
              '<div style="font-size:22px;font-weight:900;color:#00ff9c">₹' + Math.round(revenueToday) + '</div>' +
            '</div>' +
          '</div>' +
          (rejected > 0 ? '<div style="background:rgba(255,107,107,.08);border-radius:10px;padding:10px;font-size:12px;color:#ff6b6b">❌ ' + rejected + ' withdrawals rejected aaj</div>' : '') +
          (pending > 0  ? '<div style="background:rgba(255,165,0,.08);border-radius:10px;padding:10px;font-size:12px;color:#ffa500;margin-top:6px">⏳ ' + pending + ' requests abhi bhi pending</div>' : '') +
        '</div>';

      if (window.openAdminModal) window.openAdminModal('📋 Daily Payout Report', h);
      else if (window.openModal) window.openModal('📋 Daily Payout Report', h);
    }
  };

  // Auto show once per day on admin load
  var key = '_fa67_' + new Date().toISOString().slice(0, 10);
  var _t = 0, _iv = setInterval(function () {
    _t++;
    if (window.db || window.adminDb) {
      clearInterval(_iv);
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        setTimeout(function () {
          var hour = new Date().getHours();
          if (hour >= 9) window.fa67_generateDailyReport(); // Show from 9am onwards
        }, 6000);
      }
    }
    if (_t > 30) clearInterval(_iv);
  }, 600);

  console.log('[fa67] ✅ Daily Payout Report loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa68: SEASON AUTO-RESET
   Month end pe rankings archive + reset
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa68_checkSeasonReset = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    var now   = new Date();
    var month = now.getFullYear() + '_' + String(now.getMonth() + 1).padStart(2, '0');
    var key   = '_fa68_reset_' + month;

    if (localStorage.getItem(key)) return;

    // Only run on last day of month after 10pm
    var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getDate() !== lastDay || now.getHours() < 22) return;

    localStorage.setItem(key, '1');

    // Archive current leaderboard
    db.ref('leaderboard').once('value', function (snap) {
      if (snap.exists()) {
        var archive = {};
        snap.forEach(function (c) { archive[c.key] = c.val(); });
        db.ref('leaderboardArchive/' + month).set(archive);
      }

      /* ✅ FIX (Audit follow-up — season-history shape mismatch, confirmed
         against UserPanel-v32-fixed.zip): pehle yahan {name, stats, coins,
         seasonRank} save hota tha — woh seasonal_league_history table ke
         real columns (season_name, season_num, final_tier, points, badge,
         reward, emoji) se bilkul match nahi karta. UserPanel ka
         features/seasonal-league.js jo Supabase se yeh history padhta hai,
         use yeh data isi wajah se kabhi nahi milta tha.
         Ab calcRk() (rank.js wale EXACT formula, shared helper se) se
         tier/points nikaalte hain, aur calcSeasonReward() se position-based
         badge/reward (seasonal-league.js ki "Season End Rewards" list se
         consistent). */
      db.ref('appSettings/currentSeason').once('value', function (sSnap) {
        var seasonCfg  = sSnap.val() || {};
        var seasonName = seasonCfg.name || ('Season ' + month);
        var seasonNum  = seasonCfg.seasonNum || seasonCfg.season_num || 1;

        function archiveUser(uid, u) {
          var rk = window.calcRk ? window.calcRk(u.stats || {}) : { badge: 'Bronze', emoji: '🏅', pts: 0 };
          var rewardInfo = window.calcSeasonReward ? window.calcSeasonReward(u.seasonRank) : null;
          db.ref('seasonHistory/' + month + '/' + uid).set({
            userId:     uid,
            seasonName: seasonName,
            seasonNum:  seasonNum,
            finalTier:  rk.badge,
            points:     rk.pts,
            badge:      rewardInfo ? rewardInfo.badge : rk.badge,
            reward:     rewardInfo ? rewardInfo.reward : null,
            emoji:      rewardInfo ? rewardInfo.emoji : rk.emoji
          });
        }

        db.ref('users').once('value', function (uSnap) {
          if (!uSnap.exists()) return;
          var _notifyPromises = [];
          uSnap.forEach(function (c) {
            var u = c.val();
            // Archive stats for active players
            if (u.stats && u.stats.matches > 0) {
              archiveUser(c.key, u);
            }
            // Notify top 10 players
            var rank = u.seasonRank;
            if (rank && rank <= 10) {
              db.ref('users/' + c.key + '/notifications').push({
                title: '🏆 Season Ended!',
                message: 'Is season mein aap #' + rank + ' pe rahe! Naya season shuru ho gaya.',
                type: 'season_end', timestamp: Date.now(), read: false
              });
              // Also notify via Supabase
              if (window._supa) {
                _notifyPromises.push(
                  window._supa.from('notifications').insert({
                    user_id: c.key, type: 'season_end', title: '🏆 Season Ended!',
                    body: 'Aap #' + rank + ' pe rahe is season mein! Naya season shuru.',
                    is_read: false
                  }).catch(function(){})
                );
              }
            }
          });

          /* ✅ FIX (Audit follow-up): season_rank/season_coins_earned/
             season_kills/season_wins/season_matches — yeh columns
             'users' table mein EXIST NAHI KARTE (schema verify kiya) —
             yeh UPDATE hamesha Postgres error deta tha aur silently
             Firebase-only partial-reset fallback pe gir jaata tha.
             Real columns: rank_tier, rank_points, total_kills,
             total_wins, total_matches, win_streak. */
          if (window._supa) {
            window._supa.from('users')
              .update({
                rank_tier:    'Bronze',
                rank_points:  0,
                total_kills:  0,
                total_wins:   0,
                total_matches: 0,
                win_streak:   0
              })
              .neq('id', '00000000-0000-0000-0000-000000000000') // match all
              .then(function() {
                console.log('[fa68] ✅ Supabase bulk season reset done for all users');
              })
              .catch(function(e) {
                console.error('[fa68] Supabase bulk reset failed:', e.message);
                // Firebase fallback for active players only
                uSnap.forEach(function (c) {
                  db.ref('users/' + c.key).update({ seasonRank: null, seasonCoinsEarned: 0 });
                });
              });
          } else {
            // No Supabase — Firebase loop fallback
            uSnap.forEach(function (c) {
              db.ref('users/' + c.key).update({ seasonRank: null, seasonCoinsEarned: 0 });
            });
          }

          // Reset Firebase leaderboard
          db.ref('leaderboard').remove();
          if (window.toast) window.toast('🏆 Season reset complete! ' + month + ' archived. All ' + uSnap.numChildren() + ' players reset.', 'ok');
        });
      });
    });
  };

  // Check on load
  var _t = 0, _iv = setInterval(function () {
    _t++;
    if (window.db || window.adminDb) { clearInterval(_iv); setTimeout(window.fa68_checkSeasonReset, 10000); }
    if (_t > 30) clearInterval(_iv);
  }, 600);

  console.log('[fa68] ✅ Season Auto-Reset loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa69: REFERRAL CHAIN VISUALIZER
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa69_showReferralChain = function () {
    /* Bug New-14 Fix: Read from Supabase referrals table (source of truth).
       Firebase 'referrals' path is stale since referral writes now go to Supabase. */
    if (!window._supa) {
      if (window.toast) window.toast('Supabase not ready', 'err');
      return;
    }

    window._supa.from('referrals')
      .select('referrer_id,referred_name,referrer_ign,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(function (r) {
        var rows = r.data || [];
        if (!rows.length) {
          if (window.toast) window.toast('Koi referral data nahi', 'err');
          return;
        }

        // Build chain map: referrerId -> { name, refs[] }
        var chains = {};
        rows.forEach(function (d) {
          if (!d.referrer_id) return;
          if (!chains[d.referrer_id]) {
            chains[d.referrer_id] = { name: d.referrer_ign || d.referrer_id.substring(0, 8), refs: [] };
          }
          chains[d.referrer_id].refs.push(d.referred_name || 'Player');
        });

        var nodes = Object.keys(chains).map(function (uid) {
          var chain = chains[uid];
          var refCount = chain.refs.length;
          var color = refCount >= 10 ? '#ffd700' : refCount >= 5 ? '#b964ff' : '#00ff9c';
          return '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px;margin-bottom:8px">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
              '<div style="width:36px;height:36px;border-radius:50%;background:' + color + '33;border:2px solid ' + color + ';display:flex;align-items:center;justify-content:center;font-size:16px">👤</div>' +
              '<div>' +
                '<div style="font-size:13px;font-weight:800;color:#fff">' + chain.name + '</div>' +
                '<div style="font-size:10px;color:#888">' + refCount + ' direct referrals</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px;padding-left:44px">' +
              chain.refs.slice(0, 8).map(function (rName) {
                return '<span style="font-size:10px;color:#888;background:rgba(255,255,255,.05);border-radius:6px;padding:3px 8px">' + rName + '</span>';
              }).join('') +
              (chain.refs.length > 8 ? '<span style="font-size:10px;color:#555">+' + (chain.refs.length-8) + ' more</span>' : '') +
            '</div>' +
          '</div>';
        }).join('');

        var h = '<div style="max-height:360px;overflow-y:auto">' + nodes + '</div>';
        if (window.openAdminModal) window.openAdminModal('🌳 Referral Chain', h);
        else if (window.openModal) window.openModal('🌳 Referral Chain', h);
      }).catch(function (e) {
        console.error('[fa69] Supabase error:', e.message);
        if (window.toast) window.toast('Referral data load failed', 'err');
      });
  };

  console.log('[fa69] ✅ Referral Chain Visualizer loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa70: COHORT RETENTION ANALYSIS
   Week 1 / Week 2 / Week 4 retention
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa70_showCohortAnalysis = function () {
    /* Bug New-13 Fix: Read from Supabase users (source of truth).
       Firebase users snapshot is incomplete after Supabase migration. */
    if (!window._supa) {
      if (window.toast) window.toast('Supabase not ready', 'err');
      return;
    }

    window._supa.from('users')
      .select('id,created_at,last_seen')
      .then(function (r) {
        var allUsers = r.data || [];
        if (!allUsers.length) {
          if (window.toast) window.toast('Data nahi mila', 'err');
          return;
        }

        var now     = Date.now();
        var cohorts = {}; // YYYY-MM -> { total, w1, w2, w4 }

        allUsers.forEach(function (u) {
          if (!u.created_at) return;
          var joinedAt  = new Date(u.created_at).getTime();
          var lastSeen  = u.last_seen ? new Date(u.last_seen).getTime() : joinedAt;
          var weekKey   = new Date(joinedAt).toISOString().slice(0, 7); // YYYY-MM

          if (!cohorts[weekKey]) cohorts[weekKey] = { total: 0, w1: 0, w2: 0, w4: 0 };
          cohorts[weekKey].total++;

          var gap = lastSeen - joinedAt;
          if (gap >= 7  * 86400000) cohorts[weekKey].w1++;
          if (gap >= 14 * 86400000) cohorts[weekKey].w2++;
          if (gap >= 28 * 86400000) cohorts[weekKey].w4++;
        });

        var months = Object.keys(cohorts).sort().reverse().slice(0, 6);

        var rows = months.map(function (month) {
          var co = cohorts[month];
          function pct(n) { return co.total > 0 ? Math.round((n / co.total) * 100) : 0; }
          return '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">' +
            '<td style="padding:8px;font-size:12px;color:#ccc">' + month + '</td>' +
            '<td style="padding:8px;font-size:12px;color:#888;text-align:center">' + co.total + '</td>' +
            '<td style="padding:8px;text-align:center"><span style="font-size:11px;font-weight:700;color:#00d4ff">' + pct(co.w1) + '%</span></td>' +
            '<td style="padding:8px;text-align:center"><span style="font-size:11px;font-weight:700;color:#00ff9c">' + pct(co.w2) + '%</span></td>' +
            '<td style="padding:8px;text-align:center"><span style="font-size:11px;font-weight:700;color:#ffd700">' + pct(co.w4) + '%</span></td>' +
          '</tr>';
        }).join('');

        var h =
          '<div style="overflow-x:auto">' +
            '<table style="width:100%;border-collapse:collapse">' +
              '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.1)">' +
                '<th style="padding:8px;font-size:11px;color:#888;text-align:left">Cohort</th>' +
                '<th style="padding:8px;font-size:11px;color:#888">Users</th>' +
                '<th style="padding:8px;font-size:11px;color:#00d4ff">Week 1</th>' +
                '<th style="padding:8px;font-size:11px;color:#00ff9c">Week 2</th>' +
                '<th style="padding:8px;font-size:11px;color:#ffd700">Week 4</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
            '<div style="font-size:10px;color:#444;margin-top:8px">% users who came back after joining</div>' +
          '</div>';

        if (window.openAdminModal) window.openAdminModal('📊 Cohort Retention', h);
        else if (window.openModal) window.openModal('📊 Cohort Retention', h);
      }).catch(function (e) {
        console.error('[fa70] Supabase error:', e.message);
        if (window.toast) window.toast('Cohort data load failed', 'err');
      });
  };

  console.log('[fa70] ✅ Cohort Retention Analysis loaded');
})();

/* ───────────────────────────────────────────────────────────
   fa71: RELEASE ELIGIBLE CREATOR COMMISSIONS
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ✅ ADDED (2026-07-19, CRITICAL): release_eligible_commissions() has
     existed in the schema since creator_matches/creator_commissions were
     first designed, with a comment saying "Run via Supabase pg_cron or
     admin panel scheduler daily" — but no pg_cron job and no admin-panel
     trigger of any kind was ever actually wired up. This means every
     creator match-hosting commission has been permanently stuck at
     status='hold' since the day it was created — the time-based
     hold→eligible transition this function performs has never once
     executed, so claim_match_commission_payout (added this same session)
     would always find zero eligible rows even once IT is correctly
     callable, because nothing upstream ever marked anything eligible in
     the first place. Wired up both a manual admin button AND an
     auto-run-once-daily trigger (same pattern as fa59/fa68 above) so this
     doesn't depend on an admin remembering to click it.*/
  window.fa71_releaseEligibleCommissions = function () {
    if (!window._supa) { if (window.toast) window.toast('Supabase not ready', 'err'); return; }
    window._supa.rpc('release_eligible_commissions').then(function (res) {
      if (res.error) {
        console.error('[fa71] release_eligible_commissions failed:', res.error.message);
        if (window.toast) window.toast('❌ Commission release failed: ' + res.error.message, 'err');
        return;
      }
      if (window.toast) window.toast('✅ Eligible commissions released (hold → eligible)', 'ok');
    });
  };

  // Run once per day automatically, same pattern as fa59/fa68
  var _fa71Key = '_fa71_' + new Date().toISOString().slice(0, 10);
  var _fa71Tries = 0;
  var _fa71Iv = setInterval(function () {
    _fa71Tries++;
    if (window._supa) {
      clearInterval(_fa71Iv);
      if (!localStorage.getItem(_fa71Key)) {
        localStorage.setItem(_fa71Key, '1');
        window._supa.rpc('release_eligible_commissions').then(function (res) {
          if (res.error) console.error('[fa71] auto-run failed:', res.error.message);
          else console.log('[fa71] ✅ Daily commission-release auto-run complete');
        });
      }
    }
    if (_fa71Tries > 40) clearInterval(_fa71Iv);
  }, 500);

  console.log('[fa71] ✅ Creator commission auto-release loaded');
})();
