/* ================================================================
   ADMIN FEATURES BUNDLE fa56–fa62
   fa56: Auto Match Scheduler (weekly template se matches auto-create)
   fa57: Minimum Slots Alert (match start se pehle low slots notify)
   fa58: Batch Withdrawal Approval (multiple at once with filters)
   fa59: VIP User Auto-Detect (high activity auto-tag)
   fa60: Dormant User List (30-day inactive, re-engagement)
   fa61: Match Profitability Report (profit/loss per match)
   fa62: Peak Time Analyzer (when users are most active)
   ================================================================ */

/* ─────────────────────────────────────────────────────────────
   fa56: AUTO MATCH SCHEDULER
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa56_showScheduler = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    var h =
      '<div style="padding:4px 0">' +
        '<div style="font-size:12px;color:#888;margin-bottom:14px">Weekly template se matches auto-create karo</div>' +
        '<div id="_fa56Form">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
            '<div>' +
              '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Match Name Template</label>' +
              '<input id="_fa56Name" type="text" value="Daily Solo #{{N}}" placeholder="Daily Solo #{{N}}" ' +
                'style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
            '</div>' +
            '<div>' +
              '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Mode</label>' +
              '<select id="_fa56Mode" style="width:100%;padding:10px;border-radius:10px;background:#1a1a28;border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px">' +
                '<option value="solo">Solo</option><option value="duo">Duo</option><option value="squad">Squad</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Entry Fee (₹)</label>' +
              '<input id="_fa56Fee" type="number" value="10" min="0" ' +
                'style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
            '</div>' +
            '<div>' +
              '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Max Players</label>' +
              '<input id="_fa56Max" type="number" value="12" min="2" ' +
                'style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
            '</div>' +
            '<div>' +
              '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Daily Start Time</label>' +
              '<input id="_fa56Time" type="time" value="20:00" ' +
                'style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
            '</div>' +
            '<div>' +
              '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Days to Create</label>' +
              '<input id="_fa56Days" type="number" value="7" min="1" max="30" ' +
                'style="width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px;box-sizing:border-box">' +
            '</div>' +
          '</div>' +
          '<button onclick="window._fa56Create()" ' +
            'style="width:100%;padding:13px;border-radius:12px;background:linear-gradient(135deg,#00ff9c,#00c47a);border:none;color:#000;font-weight:900;font-size:14px;cursor:pointer">' +
            '🗓️ Create Scheduled Matches' +
          '</button>' +
        '</div>' +
        '<div id="_fa56Result" style="margin-top:12px"></div>' +
      '</div>';

    if (window.openAdminModal) window.openAdminModal('🗓️ Auto Match Scheduler', h);
    else if (window.openModal) window.openModal('🗓️ Auto Match Scheduler', h);
  };

  window._fa56Create = function () {
    var db = window.adminDb || window.db;
    var name  = document.getElementById('_fa56Name')  && document.getElementById('_fa56Name').value  || 'Daily Match #{{N}}';
    var mode  = document.getElementById('_fa56Mode')  && document.getElementById('_fa56Mode').value  || 'solo';
    var fee   = parseInt(document.getElementById('_fa56Fee')  && document.getElementById('_fa56Fee').value)  || 10;
    var maxP  = parseInt(document.getElementById('_fa56Max')  && document.getElementById('_fa56Max').value)  || 12;
    var time  = document.getElementById('_fa56Time')  && document.getElementById('_fa56Time').value  || '20:00';
    var days  = parseInt(document.getElementById('_fa56Days') && document.getElementById('_fa56Days').value) || 7;

    var [hh, mm] = time.split(':').map(Number);
    var prizePool = fee * maxP * 0.9; // 10% platform cut
    var created = 0;
    var now = new Date();

    for (var i = 0; i < days; i++) {
      (function (dayOffset) {
        var matchDate = new Date(now);
        matchDate.setDate(matchDate.getDate() + dayOffset + 1);
        matchDate.setHours(hh, mm, 0, 0);

        var matchName = name.replace('{{N}}', dayOffset + 1)
                            .replace('{{DATE}}', matchDate.toLocaleDateString('en-IN'));

        db.ref('matches').push({
          name: matchName,
          mode: mode,
          entryFee: fee,
          maxPlayers: maxP,
          prizePool: Math.round(prizePool),
          startTime: matchDate.getTime(),
          status: 'upcoming',
          createdAt: Date.now(),
          autoScheduled: true,
          joinedCount: 0
        });
        created++;
      })(i);
    }

    var res = document.getElementById('_fa56Result');
    if (res) res.innerHTML = '<div style="background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.2);border-radius:10px;padding:10px;text-align:center;font-size:13px;color:#00ff9c;font-weight:700">✅ ' + created + ' matches scheduled successfully!</div>';
  };

  // Register in admin dashboard
  if (window.adminTools) window.adminTools['fa56'] = { label: 'Auto Scheduler', fn: window.fa56_showScheduler };
  console.log('[fa56] ✅ Auto Match Scheduler loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa57: MINIMUM SLOTS ALERT
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var MIN_SLOTS_PCT  = 0.5; // Alert if < 50% slots filled at start time - 1h
  var CHECK_INTERVAL = 5 * 60 * 1000; // every 5 min

  function checkUpcomingMatches() {
    var db = window.adminDb || window.db;
    if (!db) return;

    var now    = Date.now();
    var soon   = now + 60 * 60 * 1000; // next 1 hour

    db.ref('matches').orderByChild('status').equalTo('upcoming').once('value', function (snap) {
      if (!snap.exists()) return;
      snap.forEach(function (c) {
        var m = c.val();
        if (!m.startTime) return;
        if (m.startTime < now || m.startTime > soon) return;

        var filled = Number(m.joinedCount) || 0;
        var max    = Number(m.maxPlayers)  || 1;
        var pct    = filled / max;

        if (pct < MIN_SLOTS_PCT) {
          var remaining = max - filled;
          var minsLeft  = Math.round((m.startTime - now) / 60000);
          showSlotAlert(m.name || 'Match', remaining, minsLeft, c.key);
        }
      });
    });
  }

  var _alertedMatches = {};
  function showSlotAlert(name, remaining, minsLeft, key) {
    if (_alertedMatches[key]) return;
    _alertedMatches[key] = true;

    var el = document.createElement('div');
    el.style.cssText = [
      'position:fixed;top:70px;right:16px;z-index:99990;',
      'background:#1a1a28;border:1px solid rgba(255,165,0,.4);border-radius:14px;',
      'padding:12px 16px;max-width:280px;',
      'animation:faSlideIn .3s ease;box-shadow:0 4px 20px rgba(0,0,0,.6)'
    ].join('');
    el.innerHTML =
      '<style>@keyframes faSlideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}</style>' +
      '<div style="font-size:12px;font-weight:800;color:#ffa500">⚠️ Low Slots Alert</div>' +
      '<div style="font-size:11px;color:#888;margin-top:4px"><b style="color:#fff">' + name + '</b> starts in ' + minsLeft + ' min</div>' +
      '<div style="font-size:11px;color:#ff6b6b;margin-top:2px">Sirf ' + remaining + ' slots bache hain!</div>' +
      '<button onclick="this.parentNode.remove()" style="margin-top:8px;font-size:11px;color:#555;background:none;border:none;cursor:pointer">Dismiss</button>';

    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) { el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(function(){if(el.parentNode)el.remove();},300); } }, 15000);
  }

  // Start checking
  function startChecker() {
    var db = window.adminDb || window.db;
    if (!db) { setTimeout(startChecker, 1000); return; }
    checkUpcomingMatches();
    setInterval(checkUpcomingMatches, CHECK_INTERVAL);
  }

  var _t = 0;
  var _iv = setInterval(function () {
    _t++;
    if (window.db || window.adminDb) { clearInterval(_iv); setTimeout(startChecker, 3000); }
    if (_t > 30) clearInterval(_iv);
  }, 500);

  console.log('[fa57] ✅ Minimum Slots Alert loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa58: BATCH WITHDRAWAL APPROVAL
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa58_showBatchWithdrawals = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('withdrawalRequests').orderByChild('status').equalTo('pending').once('value', function (snap) {
      var requests = [];
      if (snap.exists()) {
        snap.forEach(function (c) {
          var d = c.val(); d._key = c.key;
          requests.push(d);
        });
      }

      if (!requests.length) {
        if (window.toast) window.toast('Koi pending withdrawal nahi hai', 'ok');
        return;
      }

      // Sort by amount desc
      requests.sort(function (a, b) { return (b.amount || 0) - (a.amount || 0); });

      var rows = requests.map(function (r) {
        return '<tr id="_fa58row_' + r._key + '">' +
          '<td style="padding:8px;text-align:center"><input type="checkbox" class="_fa58cb" data-key="' + r._key + '" style="width:16px;height:16px;cursor:pointer"></td>' +
          '<td style="padding:8px;font-size:12px;color:#fff">' + (r.userName || r.uid || 'User') + '</td>' +
          '<td style="padding:8px;font-size:12px;color:#00ff9c;font-weight:700">₹' + (r.amount || 0) + '</td>' +
          '<td style="padding:8px;font-size:11px;color:#888">' + (r.upiId || '-') + '</td>' +
          '<td style="padding:8px;font-size:10px;color:#555">' + new Date(r.createdAt || 0).toLocaleDateString('en-IN') + '</td>' +
        '</tr>';
      }).join('');

      var total = requests.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);

      var h =
        '<div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
            '<span style="font-size:12px;color:#888">' + requests.length + ' pending · Total: <b style="color:#00ff9c">₹' + total + '</b></span>' +
            '<div style="display:flex;gap:8px">' +
              '<button onclick="document.querySelectorAll(\'._fa58cb\').forEach(function(c){c.checked=true})" style="font-size:11px;color:#00d4ff;background:none;border:none;cursor:pointer">Select All</button>' +
              '<button onclick="document.querySelectorAll(\'._fa58cb\').forEach(function(c){c.checked=false})" style="font-size:11px;color:#888;background:none;border:none;cursor:pointer">Clear</button>' +
            '</div>' +
          '</div>' +
          '<div style="overflow-x:auto;max-height:280px;overflow-y:auto">' +
            '<table style="width:100%;border-collapse:collapse">' +
              '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.1)">' +
                '<th style="padding:6px;width:30px"></th>' +
                '<th style="padding:6px;font-size:11px;color:#888;text-align:left">User</th>' +
                '<th style="padding:6px;font-size:11px;color:#888;text-align:left">Amount</th>' +
                '<th style="padding:6px;font-size:11px;color:#888;text-align:left">UPI</th>' +
                '<th style="padding:6px;font-size:11px;color:#888;text-align:left">Date</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:14px">' +
            '<button onclick="window._fa58ApproveSelected(\'approved\')" ' +
              'style="flex:1;padding:12px;border-radius:12px;background:rgba(0,255,156,.15);border:1px solid rgba(0,255,156,.3);color:#00ff9c;font-weight:800;font-size:13px;cursor:pointer">✅ Approve Selected</button>' +
            '<button onclick="window._fa58ApproveSelected(\'rejected\')" ' +
              'style="flex:1;padding:12px;border-radius:12px;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);color:#ff6b6b;font-weight:800;font-size:13px;cursor:pointer">❌ Reject Selected</button>' +
          '</div>' +
        '</div>';

      if (window.openAdminModal) window.openAdminModal('💸 Batch Withdrawal Approval', h);
      else if (window.openModal) window.openModal('💸 Batch Withdrawal Approval', h);
    });
  };

  window._fa58ApproveSelected = function (status) {
    var db = window.adminDb || window.db;
    if (!db) return;

    var checked = document.querySelectorAll('._fa58cb:checked');
    if (!checked.length) { if (window.toast) window.toast('Koi select nahi kiya', 'err'); return; }

    var count = 0;
    checked.forEach(function (cb) {
      var key = cb.getAttribute('data-key');
      if (!key) return;
      db.ref('withdrawalRequests/' + key).update({ status: status, processedAt: Date.now() });
      var row = document.getElementById('_fa58row_' + key);
      if (row) { row.style.opacity = '.3'; row.style.pointerEvents = 'none'; }
      count++;
    });

    if (window.toast) window.toast((status === 'approved' ? '✅ ' : '❌ ') + count + ' withdrawals ' + status, status === 'approved' ? 'ok' : 'err');
  };

  // Add to admin quick actions
  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.querySelector('.admin-quick-actions,.quick-actions-bar');
    if (bar && !document.getElementById('_fa58Btn')) {
      var btn = document.createElement('button');
      btn.id = '_fa58Btn';
      btn.onclick = window.fa58_showBatchWithdrawals;
      btn.style.cssText = 'padding:8px 14px;border-radius:10px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-weight:700;font-size:12px;cursor:pointer';
      btn.textContent = '💸 Batch Approve';
      bar.appendChild(btn);
    }
  });

  console.log('[fa58] ✅ Batch Withdrawal Approval loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa59: VIP USER AUTO-DETECT
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var VIP_CRITERIA = {
    minDeposit: 500,     // ₹500+ total deposit
    minMatches: 20,      // 20+ matches played
    minReferrals: 5      // 5+ referrals
  };

  window.fa59_detectVIPUsers = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('users').once('value', function (snap) {
      if (!snap.exists()) return;
      var vipFound = 0;

      snap.forEach(function (c) {
        var u = c.val(); var uid = c.key;
        if (u.isVIP) return; // already VIP

        var deposit  = Number(u.realMoney && u.realMoney.deposited) || 0;
        var matches  = Number((u.stats || {}).matches) || 0;
        var referrals = Number(u.referralCount) || 0;

        var isVIP = (deposit >= VIP_CRITERIA.minDeposit) ||
                    (matches >= VIP_CRITERIA.minMatches && deposit >= 200) ||
                    (referrals >= VIP_CRITERIA.minReferrals);

        if (isVIP) {
          db.ref('users/' + uid).update({
            isVIP: true,
            vipGrantedAt: Date.now(),
            vipReason: deposit >= VIP_CRITERIA.minDeposit ? 'high_deposit' :
                       matches >= VIP_CRITERIA.minMatches ? 'active_player' : 'top_referrer'
          });
          // Notify user
          db.ref('users/' + uid + '/notifications').push({
            title: '⭐ VIP Status Granted!',
            message: 'Congratulations! Tumhe VIP player status mila! Special perks enjoy karo.',
            type: 'vip',
            timestamp: Date.now(),
            read: false
          });
          vipFound++;
        }
      });

      if (window.toast) window.toast('⭐ VIP check done: ' + vipFound + ' new VIP users', 'ok');
    });
  };

  // Run daily
  var key = '_fa59_' + new Date().toISOString().slice(0,10);
  var _t = 0;
  var _iv = setInterval(function () {
    _t++;
    if ((window.adminDb || window.db)) {
      clearInterval(_iv);
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        setTimeout(window.fa59_detectVIPUsers, 5000);
      }
    }
    if (_t > 30) clearInterval(_iv);
  }, 500);

  console.log('[fa59] ✅ VIP User Auto-Detect loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa60: DORMANT USER LIST
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa60_showDormantUsers = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    var cutoff = Date.now() - 30 * 86400000; // 30 days ago

    db.ref('users').once('value', function (snap) {
      var dormant = [];
      if (snap.exists()) {
        snap.forEach(function (c) {
          var u = c.val();
          var lastSeen = u.lastSeen || u.lastLogin || u.createdAt || 0;
          if (lastSeen > 0 && lastSeen < cutoff) {
            dormant.push({
              uid: c.key,
              name: u.ign || u.displayName || 'User',
              lastSeen: lastSeen,
              matches: (u.stats && u.stats.matches) || 0,
              coins: u.coins || 0
            });
          }
        });
      }

      dormant.sort(function (a, b) { return a.lastSeen - b.lastSeen; });
      dormant = dormant.slice(0, 20);

      if (!dormant.length) {
        if (window.toast) window.toast('Koi dormant user nahi mila!', 'ok');
        return;
      }

      var rows = dormant.map(function (u) {
        var daysAgo = Math.floor((Date.now() - u.lastSeen) / 86400000);
        return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
          '<div style="flex:1">' +
            '<div style="font-size:12px;font-weight:700;color:#fff">' + u.name + '</div>' +
            '<div style="font-size:10px;color:#888">' + u.matches + ' matches · ' + daysAgo + ' days inactive</div>' +
          '</div>' +
          '<span style="font-size:10px;color:#ff6b6b;font-weight:700">' + daysAgo + 'd ago</span>' +
        '</div>';
      }).join('');

      var h =
        '<div>' +
          '<div style="font-size:12px;color:#888;margin-bottom:12px">' + dormant.length + ' users inactive for 30+ days</div>' +
          '<div style="max-height:300px;overflow-y:auto">' + rows + '</div>' +
          '<button onclick="window._fa60SendReEngagement()" ' +
            'style="width:100%;margin-top:14px;padding:12px;border-radius:12px;background:rgba(255,165,0,.15);border:1px solid rgba(255,165,0,.3);color:#ffa500;font-weight:800;font-size:13px;cursor:pointer">' +
            '📣 Send Re-Engagement Notification' +
          '</button>' +
        '</div>';

      window._fa60DormantUsers = dormant;
      if (window.openAdminModal) window.openAdminModal('😴 Dormant Users', h);
      else if (window.openModal) window.openModal('😴 Dormant Users', h);
    });
  };

  window._fa60SendReEngagement = function () {
    var db = window.adminDb || window.db;
    var users = window._fa60DormantUsers || [];
    if (!db || !users.length) return;

    var count = 0;
    users.slice(0, 10).forEach(function (u) {
      db.ref('users/' + u.uid + '/notifications').push({
        title: '👋 Aapko yaad kiya!',
        message: 'Mini eSports mein naye matches lag gaye hain. Wapas aao aur prizes jeeto! 🏆',
        type: 're_engagement',
        timestamp: Date.now(),
        read: false
      });
      count++;
    });

    if (window.toast) window.toast('📣 ' + count + ' dormant users ko notification bheja', 'ok');
  };

  console.log('[fa60] ✅ Dormant User List loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa61: MATCH PROFITABILITY REPORT
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa61_showProfitReport = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('matches').orderByChild('status').equalTo('completed').limitToLast(30).once('value', function (snap) {
      var matches = [];
      if (snap.exists()) {
        snap.forEach(function (c) {
          var m = c.val();
          var collected = (Number(m.entryFee) || 0) * (Number(m.joinedCount) || 0);
          var paid      = Number(m.prizePool) || 0;
          var profit    = collected - paid;
          matches.push({ name: m.name || 'Match', collected: collected, paid: paid, profit: profit, players: m.joinedCount || 0 });
        });
      }

      matches.sort(function (a, b) { return b.profit - a.profit; });

      var totalCollected = matches.reduce(function (s, m) { return s + m.collected; }, 0);
      var totalPaid      = matches.reduce(function (s, m) { return s + m.paid; }, 0);
      var totalProfit    = totalCollected - totalPaid;

      var rows = matches.slice(0, 15).map(function (m) {
        var color = m.profit >= 0 ? '#00ff9c' : '#ff6b6b';
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
          '<div style="flex:1;font-size:11px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + m.name + '</div>' +
          '<div style="font-size:10px;color:#888;white-space:nowrap">' + m.players + 'p · ₹' + m.collected + '</div>' +
          '<div style="font-size:12px;font-weight:700;color:' + color + ';white-space:nowrap;min-width:50px;text-align:right">' + (m.profit >= 0 ? '+' : '') + '₹' + m.profit + '</div>' +
        '</div>';
      }).join('');

      var h =
        '<div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
            '<div style="background:rgba(0,212,255,.08);border-radius:12px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:#888">Collected</div><div style="font-size:16px;font-weight:900;color:#00d4ff">₹' + totalCollected + '</div>' +
            '</div>' +
            '<div style="background:rgba(255,107,107,.08);border-radius:12px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:#888">Paid Out</div><div style="font-size:16px;font-weight:900;color:#ff6b6b">₹' + totalPaid + '</div>' +
            '</div>' +
            '<div style="background:rgba(0,255,156,.08);border-radius:12px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:#888">Net Profit</div><div style="font-size:16px;font-weight:900;color:' + (totalProfit >= 0 ? '#00ff9c' : '#ff6b6b') + '">₹' + totalProfit + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:12px;color:#888;margin-bottom:8px">Last 30 completed matches:</div>' +
          '<div style="max-height:250px;overflow-y:auto">' + rows + '</div>' +
        '</div>';

      if (window.openAdminModal) window.openAdminModal('📈 Match Profitability Report', h);
      else if (window.openModal) window.openModal('📈 Match Profitability Report', h);
    });
  };

  console.log('[fa61] ✅ Match Profitability Report loaded');
})();


/* ─────────────────────────────────────────────────────────────
   fa62: PEAK TIME ANALYZER
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  window.fa62_showPeakTime = function () {
    var db = window.adminDb || window.db;
    if (!db) return;

    db.ref('joinedMatches').once('value', function (snap) {
      var hourCounts = new Array(24).fill(0);

      if (snap.exists()) {
        snap.forEach(function (uSnap) {
          uSnap.forEach(function (c) {
            var d = c.val();
            if (d.joinedAt) {
              var hour = new Date(d.joinedAt).getHours();
              hourCounts[hour]++;
            }
          });
        });
      }

      var maxVal = Math.max.apply(null, hourCounts) || 1;
      var bars = hourCounts.map(function (count, h) {
        var pct   = Math.round((count / maxVal) * 100);
        var label = h + ':00';
        var isNow = new Date().getHours() === h;
        var color = pct >= 70 ? '#00ff9c' : pct >= 40 ? '#ffd700' : 'rgba(255,255,255,.2)';
        return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:20px">' +
          '<div style="font-size:9px;color:#555">' + count + '</div>' +
          '<div style="width:100%;height:' + Math.max(4, Math.round(pct * 0.8)) + 'px;background:' + color + ';border-radius:3px 3px 0 0;' + (isNow ? 'border:1px solid #fff;' : '') + '"></div>' +
          '<div style="font-size:8px;color:' + (isNow ? '#fff' : '#444') + '">' + h + '</div>' +
        '</div>';
      }).join('');

      // Find peak hours
      var sorted = hourCounts.map(function (c, i) { return { h: i, c: c }; }).sort(function (a, b) { return b.c - a.c; });
      var top3   = sorted.slice(0, 3).map(function (x) { return x.h + ':00 (' + x.c + ' joins)'; }).join(', ');

      var h =
        '<div>' +
          '<div style="font-size:12px;color:#888;margin-bottom:10px">🏆 Peak hours: <b style="color:#ffd700">' + top3 + '</b></div>' +
          '<div style="display:flex;align-items:flex-end;gap:1px;height:80px;padding-bottom:4px;overflow-x:auto">' + bars + '</div>' +
          '<div style="font-size:10px;color:#444;margin-top:8px;text-align:center">Hours 0–23 (IST) · Bar height = relative activity</div>' +
        '</div>';

      if (window.openAdminModal) window.openAdminModal('⏰ Peak Time Analyzer', h);
      else if (window.openModal) window.openModal('⏰ Peak Time Analyzer', h);
    });
  };

  console.log('[fa62] ✅ Peak Time Analyzer loaded');
})();
