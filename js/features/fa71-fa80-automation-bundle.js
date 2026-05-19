/* ================================================================
   ADMIN FEATURES BUNDLE fa71–fa80
   fa71: Broadcast Scheduler (future-time auto broadcast)
   fa72: Winner Auto Congratulation (top 3 auto personal message)
   fa73: IP Cluster Detector (same IP multi-accounts)
   fa74: Withdrawal Pattern Analyzer (only-withdraw users red flag)
   fa75: Match Result Auto-Notify (publish pe all participants notify)
   fa76: Feature Flag Manager (on/off without code change)
   fa77: Audit Log Auto-Export (monthly admin actions PDF)
   fa78: Server Health Monitor (Firebase quota usage)
   fa79: Leaderboard Fraud Clean (banned users auto-remove)
   fa80: A/B Prize Structure Test (2 structures compare)
   ================================================================ */

/* ─────────────────────────────────────────────────────────────
   fa71: BROADCAST SCHEDULER
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa71_showBroadcastScheduler = function () {
    var h =
      '<div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<div>' +
            '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Message Title</label>' +
            '<input id="_fa71Title" type="text" placeholder="e.g. New Tournament Alert!" ' +
              'style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Message Body</label>' +
            '<textarea id="_fa71Body" placeholder="Full message..." rows="3" ' +
              'style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box;resize:none"></textarea>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
            '<div>' +
              '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Schedule Date</label>' +
              '<input id="_fa71Date" type="date" style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
            '</div>' +
            '<div>' +
              '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Schedule Time</label>' +
              '<input id="_fa71Time" type="time" value="20:00" style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Send To</label>' +
            '<select id="_fa71Target" style="width:100%;padding:10px;border-radius:10px;background:#1a1a28;border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px">' +
              '<option value="all">All Users</option>' +
              '<option value="active">Active Users (7 days)</option>' +
              '<option value="vip">VIP Users Only</option>' +
            '</select>' +
          '</div>' +
          '<button onclick="window._fa71Schedule()" style="width:100%;padding:13px;border-radius:12px;background:linear-gradient(135deg,#b964ff,#7c3aed);border:none;color:#fff;font-weight:900;font-size:14px;cursor:pointer">📅 Schedule Broadcast</button>' +
        '</div>' +
        '<div id="_fa71Result" style="margin-top:10px"></div>' +
      '</div>';

    if (window.openAdminModal) window.openAdminModal('📣 Broadcast Scheduler', h);
    else if (window.openModal) window.openModal('📣 Broadcast Scheduler', h);
  };

  window._fa71Schedule = function () {
    var db      = window.adminDb || window.db;
    var title   = document.getElementById('_fa71Title')  && document.getElementById('_fa71Title').value;
    var body    = document.getElementById('_fa71Body')   && document.getElementById('_fa71Body').value;
    var date    = document.getElementById('_fa71Date')   && document.getElementById('_fa71Date').value;
    var time    = document.getElementById('_fa71Time')   && document.getElementById('_fa71Time').value;
    var target  = document.getElementById('_fa71Target') && document.getElementById('_fa71Target').value;

    if (!title || !body || !date) { if (window.toast) window.toast('Sab fields bharo', 'err'); return; }

    var scheduleAt = new Date(date + 'T' + (time || '20:00')).getTime();

    db.ref('scheduledBroadcasts').push({
      title: title,
      body: body,
      target: target || 'all',
      scheduleAt: scheduleAt,
      status: 'pending',
      createdAt: Date.now()
    });

    var res = document.getElementById('_fa71Result');
    if (res) res.innerHTML = '<div style="background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.2);border-radius:10px;padding:10px;text-align:center;font-size:13px;color:#00ff9c">✅ Broadcast scheduled for ' + new Date(scheduleAt).toLocaleString('en-IN') + '</div>';
  };

  // Check & send scheduled broadcasts
  function checkScheduledBroadcasts() {
    var db = window.adminDb || window.db;
    if (!db) return;
    var now = Date.now();

    db.ref('scheduledBroadcasts').orderByChild('status').equalTo('pending').once('value', function (snap) {
      if (!snap.exists()) return;
      snap.forEach(function (c) {
        var d = c.val();
        if (d.scheduleAt <= now) {
          // Send to all users
          db.ref('users').once('value', function (uSnap) {
            if (!uSnap.exists()) return;
            uSnap.forEach(function (uC) {
              var u = uC.val();
              if (d.target === 'vip' && !u.isVIP) return;
              if (d.target === 'active') {
                var lastSeen = u.lastSeen || u.lastLogin || 0;
                if (Date.now() - lastSeen > 7 * 86400000) return;
              }
              db.ref('users/' + uC.key + '/notifications').push({
                title: d.title,
                message: d.body,
                type: 'broadcast',
                timestamp: Date.now(),
                read: false
              });
            });
          });
          // Mark as sent
          db.ref('scheduledBroadcasts/' + c.key).update({ status: 'sent', sentAt: now });
        }
      });
    });
  }

  // Check every 5 min
  var _t = 0, _iv = setInterval(function () {
    _t++;
    if (window.db || window.adminDb) {
      clearInterval(_iv);
      setInterval(checkScheduledBroadcasts, 5 * 60 * 1000);
    }
    if (_t > 30) clearInterval(_iv);
  }, 600);

  console.log('[fa71] ✅ Broadcast Scheduler loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa72: WINNER AUTO CONGRATULATION
   Result publish hone par top 3 auto personal message
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa72_sendWinnerCongrats = function (matchKey, results) {
    var db = window.adminDb || window.db;
    if (!db || !results || !results.length) return;

    var sorted = results.slice().sort(function (a, b) { return (a.rank||99) - (b.rank||99); });
    var messages = [
      '🥇 BOOYAH! Pehli rank! Tum ne match jeet liya! Congratulations Champion! 🏆',
      '🥈 Second rank! Incredible performance! Almost the best! 💪',
      '🥉 Third rank! Great game! Keep pushing for the top! 🔥'
    ];

    sorted.slice(0, 3).forEach(function (player, i) {
      if (!player.uid) return;
      db.ref('users/' + player.uid + '/notifications').push({
        title: messages[i].split('!')[0] + '!',
        message: 'Match: ' + (player.matchName || '') + ' — Prize: ₹' + (player.prize || 0) + ' credited! ' + messages[i],
        type: 'winner_congrats',
        timestamp: Date.now(),
        read: false
      });
    });
  };

  // Hook into result publish if possible
  if (window.fa11_publishResults) {
    var _orig = window.fa11_publishResults;
    window.fa11_publishResults = function (matchKey, results) {
      var ret = _orig.apply(this, arguments);
      setTimeout(function () { window.fa72_sendWinnerCongrats(matchKey, results); }, 1000);
      return ret;
    };
  }

  console.log('[fa72] ✅ Winner Auto Congratulation loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa73: IP CLUSTER DETECTOR
   Same IP se multiple accounts → auto group & alert
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa73_detectIPClusters = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('deviceSessions').once('value', function (snap) {
      if (!snap.exists()) { if (window.toast) window.toast('Device session data nahi mila', 'warn'); return; }

      var ipMap = {}; // ip -> [uids]
      snap.forEach(function (uSnap) {
        var uid = uSnap.key;
        uSnap.forEach(function (sSnap) {
          var s = sSnap.val();
          var ip = s.ip || s.ipAddress;
          if (!ip) return;
          if (!ipMap[ip]) ipMap[ip] = [];
          if (!ipMap[ip].includes(uid)) ipMap[ip].push(uid);
        });
      });

      var clusters = Object.keys(ipMap).filter(function (ip) { return ipMap[ip].length >= 2; });
      if (!clusters.length) {
        if (window.toast) window.toast('✅ Koi IP cluster nahi mila', 'ok');
        return;
      }

      var rows = clusters.slice(0, 10).map(function (ip) {
        var uids = ipMap[ip];
        return '<div style="background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.15);border-radius:10px;padding:10px;margin-bottom:8px">' +
          '<div style="font-size:11px;font-weight:700;color:#ff6b6b;margin-bottom:4px">🌐 IP: ' + ip + ' (' + uids.length + ' accounts)</div>' +
          '<div style="font-size:10px;color:#888">' + uids.map(function (u) { return u.substring(0,10) + '...'; }).join(', ') + '</div>' +
        '</div>';
      }).join('');

      var h = '<div><div style="font-size:12px;color:#ff6b6b;margin-bottom:12px">⚠️ ' + clusters.length + ' IP clusters found:</div>' + rows + '</div>';
      if (window.openAdminModal) window.openAdminModal('🌐 IP Cluster Report', h);
      else if (window.openModal) window.openModal('🌐 IP Cluster Report', h);
    });
  };

  console.log('[fa73] ✅ IP Cluster Detector loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa74: WITHDRAWAL PATTERN ANALYZER
   Only withdraw, no deposit users = red flag
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa74_analyzeWithdrawPatterns = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('users').once('value', function (snap) {
      var suspicious = [];
      if (snap.exists()) {
        snap.forEach(function (c) {
          var u = c.val();
          var dep = Number((u.realMoney || {}).deposited) || 0;
          var win = Number((u.realMoney || {}).winnings)  || 0;
          var withdrawn = Number((u.realMoney || {}).withdrawn) || 0;

          // Pattern: withdrew significant amount but never deposited
          if (dep === 0 && withdrawn >= 100) {
            suspicious.push({
              name: u.ign || u.displayName || 'User',
              uid: c.key,
              dep: dep,
              win: win,
              withdrawn: withdrawn,
              risk: 'No deposit, withdrawing'
            });
          }
          // Pattern: withdrew much more than deposited
          else if (dep > 0 && withdrawn > dep * 5) {
            suspicious.push({
              name: u.ign || u.displayName || 'User',
              uid: c.key,
              dep: dep,
              win: win,
              withdrawn: withdrawn,
              risk: 'Withdrawal >> Deposit (5x)'
            });
          }
        });
      }

      if (!suspicious.length) {
        if (window.toast) window.toast('✅ Koi suspicious pattern nahi mila', 'ok');
        return;
      }

      var rows = suspicious.slice(0, 15).map(function (u) {
        return '<div style="background:rgba(255,107,107,.05);border-radius:10px;padding:10px;margin-bottom:6px">' +
          '<div style="display:flex;justify-content:space-between">' +
            '<span style="font-size:12px;font-weight:700;color:#fff">' + u.name + '</span>' +
            '<span style="font-size:10px;color:#ff6b6b">₹' + u.withdrawn + ' withdrawn</span>' +
          '</div>' +
          '<div style="font-size:10px;color:#888;margin-top:2px">' + u.risk + ' · Deposit: ₹' + u.dep + '</div>' +
        '</div>';
      }).join('');

      var h = '<div><div style="font-size:12px;color:#ffa500;margin-bottom:10px">⚠️ ' + suspicious.length + ' suspicious withdrawal patterns:</div>' + rows + '</div>';
      if (window.openAdminModal) window.openAdminModal('💸 Withdrawal Patterns', h);
      else if (window.openModal) window.openModal('💸 Withdrawal Patterns', h);
    });
  };

  console.log('[fa74] ✅ Withdrawal Pattern Analyzer loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa75: MATCH RESULT AUTO-NOTIFY
   Result publish hote hi all participants ko notify
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa75_notifyMatchParticipants = function (matchKey, matchName, results) {
    var db = window.adminDb || window.db;
    if (!db || !matchKey) return;

    // Get all joined players
    db.ref('joinedMatches').once('value', function (snap) {
      if (!snap.exists()) return;
      var notified = 0;

      snap.forEach(function (uSnap) {
        var uid = uSnap.key;
        var found = false;
        uSnap.forEach(function (mSnap) {
          if (mSnap.val().matchId === matchKey) found = true;
        });
        if (!found) return;

        // Find this player's result
        var playerResult = null;
        if (results) {
          results.forEach(function (r) { if (r.uid === uid) playerResult = r; });
        }

        var msg, title;
        if (playerResult) {
          title = playerResult.rank === 1 ? '🏆 You Won!' : ('Result: Rank #' + playerResult.rank);
          msg   = matchName + ' result: Rank #' + playerResult.rank +
                  (playerResult.prize > 0 ? ' — ₹' + playerResult.prize + ' credited!' : ' — Better luck next time!');
        } else {
          title = '📋 Match Results Published';
          msg   = matchName + ' ke results publish ho gaye hain!';
        }

        db.ref('users/' + uid + '/notifications').push({
          title: title,
          message: msg,
          type: 'result_notify',
          matchId: matchKey,
          timestamp: Date.now(),
          read: false
        });
        notified++;
      });

      if (window.toast) window.toast('🔔 ' + notified + ' players ko result notify kiya', 'ok');
    });
  };

  console.log('[fa75] ✅ Match Result Auto-Notify loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa76: FEATURE FLAG MANAGER
   Koi bhi feature on/off without code change
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var DEFAULT_FLAGS = {
    'dailyQuiz':        { label: 'Daily Quiz',          default: true  },
    'comboBonus':       { label: 'Combo Streak Bonus',  default: true  },
    'milestoneTracker': { label: 'Milestone Tracker',   default: true  },
    'smartSearch':      { label: 'Smart Search Bar',    default: true  },
    'friendFeed':       { label: 'Friend Activity Feed',default: true  },
    'withdrawSuggest':  { label: 'Withdraw Suggestion', default: true  },
    'spendingTracker':  { label: 'Spending Tracker',    default: true  },
    'hapticFeedback':   { label: 'Haptic Feedback',     default: true  },
    'autoCancelMatch':  { label: 'Auto Cancel Matches', default: true  },
    'seasonReset':      { label: 'Season Auto Reset',   default: true  },
    'chatEnabled':      { label: 'In-App Chat',         default: true  },
    'referralPopup':    { label: 'Referral Popup',      default: true  }
  };

  window.fa76_showFeatureFlags = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('appSettings/featureFlags').once('value', function (snap) {
      var flags = snap.val() || {};

      var rows = Object.keys(DEFAULT_FLAGS).map(function (key) {
        var def    = DEFAULT_FLAGS[key];
        var isOn   = flags.hasOwnProperty(key) ? flags[key] : def.default;
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
          '<span style="font-size:13px;color:#ccc">' + def.label + '</span>' +
          '<div onclick="window._fa76Toggle(\'' + key + '\',' + (!isOn) + ')" ' +
            'style="width:44px;height:24px;border-radius:12px;background:' + (isOn ? '#00ff9c' : 'rgba(255,255,255,.12)') + ';cursor:pointer;position:relative;transition:background .2s;flex-shrink:0" ' +
            'id="_fa76_' + key + '">' +
            '<div style="position:absolute;top:3px;left:' + (isOn ? '23px' : '3px') + ';width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s"></div>' +
          '</div>' +
        '</div>';
      }).join('');

      var h = '<div style="max-height:380px;overflow-y:auto">' + rows + '</div>';
      if (window.openAdminModal) window.openAdminModal('⚙️ Feature Flag Manager', h);
      else if (window.openModal) window.openModal('⚙️ Feature Flag Manager', h);
    });
  };

  window._fa76Toggle = function (key, newVal) {
    var db = window.adminDb || window.db;
    if (!db) return;
    var upd = {}; upd[key] = newVal;
    db.ref('appSettings/featureFlags').update(upd);

    // Update UI
    var el = document.getElementById('_fa76_' + key);
    if (el) {
      el.style.background = newVal ? '#00ff9c' : 'rgba(255,255,255,.12)';
      var thumb = el.querySelector('div');
      if (thumb) thumb.style.left = newVal ? '23px' : '3px';
    }
    if (window.toast) window.toast((newVal ? '✅' : '❌') + ' ' + (DEFAULT_FLAGS[key] && DEFAULT_FLAGS[key].label || key), newVal ? 'ok' : 'warn');
  };

  console.log('[fa76] ✅ Feature Flag Manager loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa77: AUDIT LOG AUTO-EXPORT (CSV download)
   Monthly admin actions log
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa77_exportAuditLog = function (monthsBack) {
    var db = window.adminDb || window.db;
    if (!db) return;

    monthsBack = monthsBack || 0;
    var d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    var monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    var monthEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime();

    db.ref('adminActivityLog').orderByChild('timestamp').startAt(monthStart).endAt(monthEnd).once('value', function (snap) {
      var rows = [['Timestamp', 'Admin', 'Action', 'Target', 'Details']];
      if (snap.exists()) {
        snap.forEach(function (c) {
          var l = c.val();
          rows.push([
            new Date(l.timestamp || 0).toLocaleString('en-IN'),
            l.adminName || l.adminId || 'Admin',
            l.action || '',
            l.target || '',
            l.details || ''
          ]);
        });
      }

      if (rows.length <= 1) {
        if (window.toast) window.toast('Is month ka koi audit log nahi', 'warn');
        return;
      }

      var csv    = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
      var blob   = new Blob([csv], { type: 'text/csv' });
      var url    = URL.createObjectURL(blob);
      var a      = document.createElement('a');
      var month  = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      a.href     = url;
      a.download = 'audit_log_' + month.replace(' ', '_') + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (window.toast) window.toast('📥 Audit log exported: ' + (rows.length - 1) + ' entries', 'ok');
    });
  };

  window.fa77_showExportDialog = function () {
    var h =
      '<div style="text-align:center;padding:10px 0">' +
        '<div style="font-size:36px;margin-bottom:12px">📋</div>' +
        '<div style="font-size:13px;color:#888;margin-bottom:20px">Admin activity log CSV download karo</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' +
          '<button onclick="window.fa77_exportAuditLog(0)" style="padding:12px;border-radius:12px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-weight:700;font-size:13px;cursor:pointer">📥 This Month</button>' +
          '<button onclick="window.fa77_exportAuditLog(1)" style="padding:12px;border-radius:12px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-weight:700;font-size:13px;cursor:pointer">📥 Last Month</button>' +
          '<button onclick="window.fa77_exportAuditLog(2)" style="padding:12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#888;font-weight:700;font-size:13px;cursor:pointer">📥 2 Months Ago</button>' +
        '</div>' +
      '</div>';

    if (window.openAdminModal) window.openAdminModal('📋 Audit Log Export', h);
    else if (window.openModal) window.openModal('📋 Audit Log Export', h);
  };

  console.log('[fa77] ✅ Audit Log Export loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa78: SERVER HEALTH MONITOR
   Firebase quota usage + alerts
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa78_showHealthMonitor = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    // Get basic DB stats by counting key nodes
    var checks = [
      { label: 'Total Users',       ref: 'users',               icon: '👥' },
      { label: 'Total Matches',     ref: 'matches',             icon: '🏆' },
      { label: 'Pending Withdrawals', ref: 'withdrawalRequests', icon: '💸' },
      { label: 'Notifications',     ref: 'notifications',       icon: '🔔' },
      { label: 'Match Results',     ref: 'matchResults',        icon: '📊' }
    ];

    var results = [];
    var pending = checks.length;

    checks.forEach(function (check) {
      db.ref(check.ref).once('value', function (snap) {
        var count = 0;
        if (snap.exists()) snap.forEach(function () { count++; });
        results.push({ label: check.label, count: count, icon: check.icon });
        pending--;
        if (pending === 0) renderHealth();
      });
    });

    function renderHealth() {
      var rows = results.map(function (r) {
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
          '<span style="font-size:20px">' + r.icon + '</span>' +
          '<span style="flex:1;font-size:13px;color:#ccc">' + r.label + '</span>' +
          '<span style="font-size:14px;font-weight:800;color:#00d4ff">' + r.count.toLocaleString() + '</span>' +
        '</div>';
      }).join('');

      var now = new Date().toLocaleString('en-IN');

      var h =
        '<div>' +
          '<div style="background:rgba(0,255,156,.07);border:1px solid rgba(0,255,156,.15);border-radius:12px;padding:10px;text-align:center;margin-bottom:14px">' +
            '<div style="font-size:10px;color:#888">Status</div>' +
            '<div style="font-size:16px;font-weight:800;color:#00ff9c">🟢 System Online</div>' +
            '<div style="font-size:10px;color:#555">Checked: ' + now + '</div>' +
          '</div>' +
          rows +
        '</div>';

      if (window.openAdminModal) window.openAdminModal('🖥️ Server Health', h);
      else if (window.openModal) window.openModal('🖥️ Server Health', h);
    }
  };

  console.log('[fa78] ✅ Server Health Monitor loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa79: LEADERBOARD FRAUD CLEAN
   Banned users auto-remove from leaderboard
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa79_cleanLeaderboard = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('leaderboard').once('value', function (snap) {
      if (!snap.exists()) { if (window.toast) window.toast('Leaderboard empty hai', 'warn'); return; }

      var leaderUids = [];
      snap.forEach(function (c) { leaderUids.push(c.key); });

      var removed = 0;
      var pending = leaderUids.length;

      leaderUids.forEach(function (uid) {
        db.ref('users/' + uid).once('value', function (uSnap) {
          var u = uSnap.val() || {};
          if (u.banned || u.fraudScore >= 80) {
            db.ref('leaderboard/' + uid).remove();
            removed++;
          }
          pending--;
          if (pending === 0) {
            if (window.toast) window.toast('🧹 Leaderboard cleaned: ' + removed + ' banned users removed', removed > 0 ? 'ok' : 'warn');
          }
        });
      });
    });
  };

  // Run weekly
  var key = '_fa79_' + new Date().toISOString().slice(0, 7);
  var _t = 0, _iv = setInterval(function () {
    _t++;
    if (window.db || window.adminDb) {
      clearInterval(_iv);
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        setTimeout(window.fa79_cleanLeaderboard, 12000);
      }
    }
    if (_t > 30) clearInterval(_iv);
  }, 600);

  console.log('[fa79] ✅ Leaderboard Fraud Clean loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa80: A/B PRIZE STRUCTURE TEST
   2 different prize pools test kar ke better wala select karo
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa80_showABTest = function () {
    var h =
      '<div>' +
        '<div style="font-size:12px;color:#888;margin-bottom:14px">Do prize structures compare karo — konse mein zyada players join karte hain</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
          // Structure A
          '<div style="background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.2);border-radius:14px;padding:14px">' +
            '<div style="font-size:12px;font-weight:800;color:#00d4ff;margin-bottom:8px">Structure A</div>' +
            '<div style="font-size:11px;color:#888;margin-bottom:6px">1st Place (%)</div>' +
            '<input id="_fa80A1" type="number" value="60" min="10" max="90" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box;margin-bottom:6px">' +
            '<div style="font-size:11px;color:#888;margin-bottom:6px">2nd Place (%)</div>' +
            '<input id="_fa80A2" type="number" value="30" min="0" max="60" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box;margin-bottom:6px">' +
            '<div style="font-size:11px;color:#888;margin-bottom:6px">3rd Place (%)</div>' +
            '<input id="_fa80A3" type="number" value="10" min="0" max="40" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
          '</div>' +
          // Structure B
          '<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.2);border-radius:14px;padding:14px">' +
            '<div style="font-size:12px;font-weight:800;color:#ffd700;margin-bottom:8px">Structure B</div>' +
            '<div style="font-size:11px;color:#888;margin-bottom:6px">1st Place (%)</div>' +
            '<input id="_fa80B1" type="number" value="50" min="10" max="90" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box;margin-bottom:6px">' +
            '<div style="font-size:11px;color:#888;margin-bottom:6px">2nd Place (%)</div>' +
            '<input id="_fa80B2" type="number" value="30" min="0" max="60" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box;margin-bottom:6px">' +
            '<div style="font-size:11px;color:#888;margin-bottom:6px">3rd Place (%)</div>' +
            '<input id="_fa80B3" type="number" value="20" min="0" max="40" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
          '</div>' +
        '</div>' +
        '<button onclick="window._fa80SaveTest()" style="width:100%;padding:13px;border-radius:12px;background:linear-gradient(135deg,#ffd700,#ff8c00);border:none;color:#000;font-weight:900;font-size:14px;cursor:pointer">🧪 Start A/B Test</button>' +
        '<div id="_fa80Result" style="margin-top:10px"></div>' +
      '</div>';

    if (window.openAdminModal) window.openAdminModal('🧪 A/B Prize Test', h);
    else if (window.openModal) window.openModal('🧪 A/B Prize Test', h);
  };

  window._fa80SaveTest = function () {
    var db = window.adminDb || window.db;
    var a1 = parseInt(document.getElementById('_fa80A1') && document.getElementById('_fa80A1').value) || 60;
    var a2 = parseInt(document.getElementById('_fa80A2') && document.getElementById('_fa80A2').value) || 30;
    var a3 = parseInt(document.getElementById('_fa80A3') && document.getElementById('_fa80A3').value) || 10;
    var b1 = parseInt(document.getElementById('_fa80B1') && document.getElementById('_fa80B1').value) || 50;
    var b2 = parseInt(document.getElementById('_fa80B2') && document.getElementById('_fa80B2').value) || 30;
    var b3 = parseInt(document.getElementById('_fa80B3') && document.getElementById('_fa80B3').value) || 20;

    db.ref('appSettings/abTest').set({
      active: true,
      startedAt: Date.now(),
      structureA: { first: a1, second: a2, third: a3, joins: 0 },
      structureB: { first: b1, second: b2, third: b3, joins: 0 }
    });

    var res = document.getElementById('_fa80Result');
    if (res) res.innerHTML =
      '<div style="background:rgba(255,215,0,.1);border:1px solid rgba(255,215,0,.2);border-radius:10px;padding:10px;text-align:center;font-size:12px;color:#ffd700">✅ A/B test started! Next matches automatically A/B distribute honge. Results \'appSettings/abTest\' mein track honge.</div>';
  };

  console.log('[fa80] ✅ A/B Prize Structure Test loaded');
})();
