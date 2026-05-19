/* ====================================================
   MINI ESPORTS ADMIN — FEATURES v9
   50 Smart Admin Features | Professional & Complete
   ==================================================== */
(function () {
  'use strict';

  /* =========================================================
     HELPERS
     ========================================================= */
  function _$(id) { return document.getElementById(id); }
  function _toast(msg, isErr) { if (window.showToast) showToast(msg, isErr); }
  function _modal(title, html) { if (window.showModal) showModal(title, html); }
  function _close() { if (window.closeModal) closeModal(); }
  function _logAction(action, targetId, extra) {
    if (!rtdb) return;
    var id = rtdb.ref('activityLogs').push().key;
    rtdb.ref('activityLogs/' + id).set({
      action: action, targetId: targetId || '', extra: extra || {},
      adminId: firebase.auth().currentUser ? firebase.auth().currentUser.uid : 'admin',
      ts: Date.now()
    });
  }

  /* =========================================================
     ─── FEATURE 1: REVENUE ANALYTICS + 7-DAY BAR CHART ───
     ========================================================= */
  window.renderRevenueAnalytics = function () {
    var el = _$('section-analytics'); if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:30px"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary)"></i></div>';
    rtdb.ref('walletRequests').once('value', function (s) {
      var days = {}, totalRev = 0, totalWd = 0, pendingCount = 0, approvedCount = 0;
      s.forEach(function (c) {
        var d = c.val();
        var day = new Date(d.createdAt || Date.now()).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
        if (!days[day]) days[day] = { dep: 0, wd: 0 };
        if (d.status === 'pending') pendingCount++;
        if (d.type === 'deposit' && (d.status === 'approved' || d.status === 'done')) {
          days[day].dep += d.amount || 0; totalRev += d.amount || 0; approvedCount++;
        } else if (d.type === 'withdraw' && (d.status === 'approved' || d.status === 'done')) {
          days[day].wd += d.amount || 0; totalWd += d.amount || 0;
        }
      });
      var net = totalRev - totalWd;
      var labels = Object.keys(days).slice(-7);
      var maxVal = labels.reduce(function (m, k) { return Math.max(m, days[k].dep, days[k].wd); }, 1);
      var h = '<div class="stats-grid" style="margin-bottom:16px">';
      [
        ['💰 Total Deposits', '₹' + totalRev, 'green'],
        ['📤 Total Payouts', '₹' + totalWd, 'red'],
        ['📊 Net Profit', '₹' + net, net >= 0 ? 'green' : 'red'],
        ['⏳ Pending Requests', pendingCount, 'yellow']
      ].forEach(function (d) {
        h += '<div class="stat-card"><div class="stat-icon"><i class="fas fa-chart-line"></i></div><div class="value text-' + d[2] + '" style="font-size:18px">' + d[1] + '</div><div class="label">' + d[0] + '</div></div>';
      });
      h += '</div>';
      h += '<div class="card"><div class="card-header"><i class="fas fa-chart-bar"></i> Last 7 Days — Deposits (Green) vs Payouts (Red)</div><div class="card-body">';
      h += '<div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding:0 8px">';
      labels.forEach(function (l) {
        var dPct = Math.round((days[l].dep / maxVal) * 100);
        var wPct = Math.round((days[l].wd / maxVal) * 100);
        h += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">';
        h += '<div style="display:flex;align-items:flex-end;gap:2px;height:100px">';
        h += '<div title="₹' + days[l].dep + '" style="width:14px;height:' + Math.max(dPct, 2) + '%;background:#00ff9c;border-radius:3px 3px 0 0"></div>';
        h += '<div title="₹' + days[l].wd + '" style="width:14px;height:' + Math.max(wPct, 2) + '%;background:#ff6b6b;border-radius:3px 3px 0 0"></div>';
        h += '</div><div style="font-size:9px;color:var(--text-muted);white-space:nowrap">' + l + '</div></div>';
      });
      h += '</div></div></div>';
      el.innerHTML = h;
    });
  };

  /* ─── FEATURE 2: USER GROWTH TRACKER ─── */
  window.renderUserGrowth = function (containerId) {
    var el = _$(containerId || 'userGrowthChart'); if (!el) return;
    rtdb.ref('users').once('value', function (s) {
      var byDay = {}, total = 0;
      s.forEach(function (c) {
        var d = c.val(); total++;
        if (!d.createdAt) return;
        var day = new Date(d.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
        byDay[day] = (byDay[day] || 0) + 1;
      });
      var labels = Object.keys(byDay).slice(-14);
      var maxV = labels.reduce(function (m, k) { return Math.max(m, byDay[k]); }, 1);
      var h = '<div style="margin-bottom:8px;font-size:12px;color:var(--text-muted)">Total Users: <strong>' + total + '</strong></div>';
      h += '<div style="display:flex;align-items:flex-end;gap:4px;height:80px">';
      labels.forEach(function (l) {
        var pct = Math.round((byDay[l] / maxV) * 100);
        h += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">';
        h += '<div style="font-size:9px;font-weight:700;color:#4d96ff">+' + byDay[l] + '</div>';
        h += '<div style="width:100%;height:' + Math.max(pct, 4) + '%;background:linear-gradient(180deg,#4d96ff,#0043ff);border-radius:3px 3px 0 0;min-height:4px"></div>';
        h += '<div style="font-size:8px;color:var(--text-muted);white-space:nowrap">' + l + '</div></div>';
      });
      h += '</div>';
      el.innerHTML = h;
    });
  };

  /* ─── FEATURE 3: TOP PERFORMERS TABLE ─── */
  window.renderTopPerformers = function (containerId) {
    var el = _$(containerId || 'topPerformersTable'); if (!el) return;
    rtdb.ref('users').orderByChild('stats/earnings').limitToLast(10).once('value', function (s) {
      var users = [];
      s.forEach(function (c) { var u = c.val(); if (u && u.stats) users.push(Object.assign({}, u, { _uid: c.key })); });
      users.sort(function (a, b) { return (b.stats.earnings || 0) - (a.stats.earnings || 0); });
      var h = '<table><thead><tr><th>#</th><th>Player</th><th>Matches</th><th>Wins</th><th>Kills</th><th>Earnings</th></tr></thead><tbody>';
      users.forEach(function (u, i) {
        var medals = ['🥇', '🥈', '🥉'];
        h += '<tr><td>' + (medals[i] || '#' + (i + 1)) + '</td>';
        h += '<td><strong>' + (u.ign || u.displayName || '?') + '</strong><div class="text-xxs text-muted font-mono">' + u._uid.substring(0, 12) + '</div></td>';
        h += '<td>' + (u.stats.matches || 0) + '</td><td class="text-primary">' + (u.stats.wins || 0) + '</td>';
        h += '<td>' + (u.stats.kills || 0) + '</td>';
        h += '<td class="text-primary font-bold">₹' + (u.stats.earnings || 0) + '</td></tr>';
      });
      h += '</tbody></table>';
      el.innerHTML = h;
    });
  };

  /* ─── FEATURE 4: FRAUD DETECTION (Multi-Account) ─── */
  window.runFraudCheck = function () {
    rtdb.ref('deviceJoins').once('value', function (s) {
      var deviceUsers = {};
      if (s.exists()) {
        s.forEach(function (deviceNode) {
          deviceNode.forEach(function (matchNode) {
            var uid = matchNode.val();
            if (!deviceUsers[deviceNode.key]) deviceUsers[deviceNode.key] = [];
            if (deviceUsers[deviceNode.key].indexOf(uid) < 0) deviceUsers[deviceNode.key].push(uid);
          });
        });
      }
      var suspicious = Object.entries(deviceUsers).filter(function (e) { return e[1].length > 1; });
      var h = '<div>';
      h += '<div style="margin-bottom:12px;padding:10px;background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.2);border-radius:10px;font-size:12px">⚠️ <strong>' + suspicious.length + ' device(s)</strong> pe multiple accounts detected</div>';
      if (!suspicious.length) { h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No suspicious activity 🎉</p></div>'; }
      else {
        h += '<table><thead><tr><th>Device ID</th><th>Accounts</th><th>Action</th></tr></thead><tbody>';
        suspicious.forEach(function (e) {
          h += '<tr><td class="font-mono text-xxs">' + e[0].substring(0, 20) + '...</td>';
          h += '<td>' + e[1].length + ' accounts</td>';
          h += '<td><button class="btn btn-danger btn-xs" onclick="window.flagDevice(\'' + e[0] + '\')">Flag</button></td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '</div>';
      _modal('🔍 Fraud Detection', h);
    });
  };
  window.flagDevice = function (deviceId) {
    rtdb.ref('flaggedDevices/' + deviceId).set({ flaggedAt: Date.now(), reason: 'Multiple accounts' });
    _logAction('flag_device', deviceId);
    _toast('Device flagged!');
  };

  /* ─── FEATURE 5: BULK MESSAGE CENTER ─── */
  window.showBulkMessage = function () {
    var h = '<div>';
    h += '<div class="form-group"><label>Target Users</label>';
    h += '<select id="bmTarget" class="form-input"><option value="all">All Users</option><option value="active">Active (1+ match)</option><option value="inactive">Inactive</option><option value="vip">High Depositors (₹500+)</option></select></div>';
    h += '<div class="form-group"><label>Title</label><input type="text" id="bmTitle" class="form-input" placeholder="Notification title"></div>';
    h += '<div class="form-group"><label>Message</label><textarea id="bmBody" class="form-input" style="height:80px" placeholder="Message..."></textarea></div>';
    h += '<div class="form-group"><label>Type</label><select id="bmType" class="form-input"><option value="promo">Promo 🎁</option><option value="alert">Alert ⚠️</option><option value="match">Match 🎮</option><option value="info">Info ℹ️</option></select></div>';
    h += '<button class="btn btn-primary w-full" onclick="window._sendBulkMsg()"><i class="fas fa-paper-plane"></i> Send Message</button></div>';
    _modal('📢 Bulk Message Center', h);
  };
  window._sendBulkMsg = function () {
    var target = (_$('bmTarget') || {}).value;
    var title = (_$('bmTitle') || {}).value;
    var body = (_$('bmBody') || {}).value;
    var type = (_$('bmType') || {}).value;
    if (!title || !body) { _toast('Title and message required', true); return; }
    rtdb.ref('users').once('value', function (s) {
      var batch = [];
      s.forEach(function (c) {
        var u = c.val(), uid = c.key;
        if (target === 'active' && !(u.stats && u.stats.matches > 0)) return;
        if (target === 'inactive' && (u.stats && u.stats.matches > 0)) return;
        if (target === 'vip' && !((u.realMoney && u.realMoney.deposited >= 500))) return;
        batch.push(uid);
      });
      var done = 0;
      batch.forEach(function (uid) {
        var nid = rtdb.ref('users/' + uid + '/notifications').push().key;
        rtdb.ref('users/' + uid + '/notifications/' + nid).set({
          type: type, title: title, message: body, body: body, read: false, timestamp: Date.now(), createdAt: Date.now()
        }).then(function () { done++; if (done === batch.length) _toast('✅ Sent to ' + done + ' users!'); });
      });
      if (!batch.length) _toast('No matching users found');
      _logAction('bulk_message', target, { title: title, count: batch.length });
      _close();
    });
  };

  /* ─── FEATURE 6: MATCH TEMPLATES (Quick Create) ─── */
  window.matchTemplates = [
    { name: '🔫 Duo Rush (₹5)', mode: 'duo', matchType: 'Battle Royale', map: 'bermuda', entryFee: 5, prizePool: 25, maxSlots: 48, perKillPrize: 2 },
    { name: '💎 VIP Solo (₹50)', mode: 'solo', matchType: 'Battle Royale', map: 'purgatory', entryFee: 50, prizePool: 500, maxSlots: 25, firstPrize: 250 },
    { name: '🏆 Squad War (₹20)', mode: 'squad', matchType: 'Clash Squad', map: 'bermuda', entryFee: 20, prizePool: 200, maxSlots: 48, firstPrize: 100 },
    { name: '🆓 Free Solo', mode: 'solo', entryType: 'free', entryFee: 0, prizePool: 50, maxSlots: 25 },
    { name: '⚡ Quick Duo (₹10)', mode: 'duo', matchType: 'Battle Royale', map: 'kalahari', entryFee: 10, prizePool: 80, maxSlots: 32 },
  ];
  window.showMatchTemplates = function () {
    var h = '<div style="display:flex;flex-direction:column;gap:10px">';
    window.matchTemplates.forEach(function (t, i) {
      h += '<div onclick="window._applyTemplate(' + i + ')" style="padding:12px;border-radius:12px;background:var(--bg-card);border:1px solid var(--border);cursor:pointer">';
      h += '<div style="font-weight:700;font-size:14px">' + t.name + '</div>';
      h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + t.mode.toUpperCase() + ' | Entry: ₹' + (t.entryFee || 0) + ' | Prize: ₹' + (t.prizePool || 0) + ' | ' + (t.maxSlots || 0) + ' slots</div>';
      h += '</div>';
    });
    h += '</div>';
    _modal('📋 Match Templates', h);
  };
  window._applyTemplate = function (i) {
    var t = window.matchTemplates[i]; if (!t) return;
    _close();
    if (window.openTournamentModal) openTournamentModal();
    setTimeout(function () {
      var map = { name: 'tName', mode: 'tMode', matchType: 'tMatchType', map: 'tMap', entryFee: 'tEntryFee', prizePool: 'tPrizePool', maxSlots: 'tMaxSlots', perKillPrize: 'tPerKillPrize', firstPrize: 'tFirstPrize' };
      Object.keys(map).forEach(function (k) {
        var el = _$(map[k]); if (el && t[k] !== undefined) el.value = t[k];
      });
      _toast('✅ Template loaded!');
    }, 400);
  };

  /* ─── FEATURE 7: PLAYER WATCHLIST ─── */
  window.addToWatchlist = function (uid, name) {
    rtdb.ref('adminWatchlist/' + uid).set({ name: name, addedAt: Date.now() });
    _logAction('watchlist_add', uid, { name: name });
    _toast('👁️ ' + name + ' watchlist mein add hua');
  };
  window.showWatchlist = function () {
    rtdb.ref('adminWatchlist').once('value', function (s) {
      var h = '<div>';
      if (!s.exists()) { h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">Watchlist empty</p></div>'; }
      else {
        h += '<table><thead><tr><th>Player</th><th>Added</th><th>Actions</th></tr></thead><tbody>';
        s.forEach(function (c) {
          var d = c.val(), uid = c.key;
          h += '<tr><td><span class="badge yellow">' + d.name + '</span><div class="font-mono text-xxs text-muted">' + uid.substring(0, 16) + '</div></td>';
          h += '<td class="text-xxs">' + new Date(d.addedAt).toLocaleDateString() + '</td>';
          h += '<td><button class="btn btn-ghost btn-xs" onclick="openUserModal(\'' + uid + '\')"><i class="fas fa-eye"></i></button> ';
          h += '<button class="btn btn-danger btn-xs" onclick="rtdb.ref(\'adminWatchlist/' + uid + '\').remove();showWatchlist();"><i class="fas fa-times"></i></button></td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '</div>';
      _modal('👁️ Player Watchlist', h);
    });
  };

  /* ─── FEATURE 8: PLATFORM STATS OVERVIEW ─── */
  window.renderPlatformStats = function (containerId) {
    var el = _$(containerId || 'platformStats'); if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i></div>';
    Promise.all([
      rtdb.ref('users').once('value'),
      rtdb.ref('joinRequests').once('value'),
      rtdb.ref('walletRequests').once('value'),
      rtdb.ref('matches').once('value')
    ]).then(function (results) {
      var users = 0, joins = 0, deps = 0, depTotal = 0, matches = 0, activeUsers = 0;
      if (results[0].exists()) results[0].forEach(function (c) {
        users++;
        var u = c.val();
        if (u.stats && u.stats.matches > 0) activeUsers++;
      });
      if (results[1].exists()) results[1].forEach(function () { joins++; });
      if (results[2].exists()) results[2].forEach(function (c) {
        var d = c.val();
        if (d.type === 'deposit' && (d.status === 'approved' || d.status === 'done')) { deps++; depTotal += (d.amount || 0); }
      });
      if (results[3].exists()) results[3].forEach(function () { matches++; });
      var stats = [
        { icon: 'fas fa-users', label: 'Total Users', val: users, color: '--info' },
        { icon: 'fas fa-fire', label: 'Active Users', val: activeUsers, color: '--success' },
        { icon: 'fas fa-gamepad', label: 'Total Joins', val: joins, color: '--primary' },
        { icon: 'fas fa-trophy', label: 'Matches', val: matches, color: '--warning' },
        { icon: 'fas fa-rupee-sign', label: 'Total Revenue', val: '₹' + depTotal, color: '--success' },
        { icon: 'fas fa-percentage', label: 'Active Rate', val: users > 0 ? Math.round(activeUsers / users * 100) + '%' : '0%', color: '--info' },
      ];
      el.innerHTML = '<div class="stats-grid">' + stats.map(function (s) {
        return '<div class="stat-card"><div class="stat-icon"><i class="' + s.icon + '"></i></div><div class="value" style="color:var(' + s.color + ')">' + s.val + '</div><div class="label">' + s.label + '</div></div>';
      }).join('') + '</div>';
    });
  };

  /* ─── FEATURE 9: CSV EXPORT (Users / Matches / Wallet) ─── */
  window.exportCSV = function (type) {
    var ref = type === 'users' ? rtdb.ref('users') : type === 'matches' ? rtdb.ref('joinRequests') : rtdb.ref('walletRequests');
    ref.once('value', function (s) {
      var rows = [], headers;
      if (type === 'users') {
        headers = ['UID', 'IGN', 'Email', 'Matches', 'Wins', 'Kills', 'Earnings', 'Deposit', 'Status'];
        s.forEach(function (c) {
          var u = c.val();
          rows.push([c.key, u.ign || '', u.email || '', (u.stats && u.stats.matches) || 0, (u.stats && u.stats.wins) || 0, (u.stats && u.stats.kills) || 0, (u.stats && u.stats.earnings) || 0, ((u.realMoney || {}).deposited || 0), u.profileStatus || 'pending']);
        });
      } else if (type === 'matches') {
        headers = ['RequestID', 'UserName', 'MatchName', 'Mode', 'EntryFee', 'Status', 'IsTeamMember', 'CaptainName', 'Date'];
        s.forEach(function (c) {
          var d = c.val();
          rows.push([c.key, d.userName || '', d.matchName || '', d.mode || '', d.entryFee || 0, d.status || '', d.isTeamMember ? 'Yes' : 'No', d.captainName || '', new Date(d.createdAt || 0).toLocaleString()]);
        });
      } else {
        headers = ['RequestID', 'UserName', 'Type', 'Amount', 'UTR', 'Status', 'Date'];
        s.forEach(function (c) {
          var d = c.val();
          rows.push([c.key, d.userName || '', d.type || '', d.amount || 0, d.utr || '', d.status || '', new Date(d.createdAt || 0).toLocaleString()]);
        });
      }
      var csv = [headers].concat(rows).map(function (r) {
        return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = type + '_export_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      _toast('✅ CSV downloaded: ' + rows.length + ' records');
    });
  };

  /* ─── FEATURE 10: REFERRAL ANALYTICS ─── */
  window.renderReferralAnalytics = function (containerId) {
    var el = _$(containerId || 'referralAnalytics'); if (!el) return;
    rtdb.ref('referrals').once('value', function (s) {
      var topReferrers = {}, total = 0;
      if (s.exists()) s.forEach(function (c) {
        var d = c.val(); total++;
        topReferrers[d.referrerId] = (topReferrers[d.referrerId] || 0) + 1;
      });
      var sorted = Object.entries(topReferrers).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
      var h = '<div class="card"><div class="card-header"><i class="fas fa-users"></i> Referral Analytics — Total: ' + total + '</div><div class="card-body">';
      if (!sorted.length) h += '<p class="text-muted text-xxs">No referrals yet</p>';
      else {
        h += '<table><thead><tr><th>User ID</th><th>Referrals</th></tr></thead><tbody>';
        sorted.forEach(function (e) {
          h += '<tr><td class="font-mono text-xxs">' + e[0].substring(0, 20) + '...</td><td><span class="badge green">' + e[1] + '</span></td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '</div></div>';
      el.innerHTML = h;
    });
  };

  /* ─── FEATURE 11: MATCH PERFORMANCE REPORT ─── */
  window.renderMatchReport = function (containerId) {
    var el = _$(containerId || 'matchReport'); if (!el) return;
    Promise.all([rtdb.ref('matches').once('value'), rtdb.ref('joinRequests').once('value')]).then(function (r) {
      var matches = {}, filledTotal = 0, slotTotal = 0;
      r[0].forEach(function (c) { matches[c.key] = c.val(); });
      var totalM = Object.keys(matches).length;
      Object.values(matches).forEach(function (m) {
        slotTotal += m.maxSlots || 0;
        filledTotal += m.filledSlots || m.joinedSlots || 0;
      });
      var fillRate = slotTotal > 0 ? Math.round(filledTotal / slotTotal * 100) : 0;
      var joinMap = {};
      r[1].forEach(function (c) { var d = c.val(); joinMap[d.matchId] = (joinMap[d.matchId] || 0) + 1; });
      var h = '<div class="stats-grid">';
      [['Total Matches', totalM, 'fas fa-trophy'], ['Avg Fill Rate', fillRate + '%', 'fas fa-percentage'], ['Avg Players/Match', totalM ? Math.round(filledTotal / totalM) : 0, 'fas fa-users'], ['Total Slots Filled', filledTotal, 'fas fa-check']].forEach(function (d) {
        h += '<div class="stat-card"><div class="stat-icon"><i class="' + d[2] + '"></i></div><div class="value">' + d[1] + '</div><div class="label">' + d[0] + '</div></div>';
      });
      h += '</div>';
      el.innerHTML = h;
    });
  };

  /* ─── FEATURE 12: SUPPORT TICKET MANAGER ─── */
  window.loadSupportTickets = function () {
    rtdb.ref('supportRequests').orderByChild('status').equalTo('open').once('value', function (s) {
      var tickets = [];
      if (s.exists()) s.forEach(function (c) { tickets.push(Object.assign({}, c.val(), { id: c.key })); });
      tickets.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      var h = '<div>';
      if (!tickets.length) h += '<div style="text-align:center;padding:30px;color:var(--text-muted)">No open tickets 🎉</div>';
      tickets.forEach(function (t) {
        h += '<div class="card" style="margin-bottom:8px"><div class="card-body compact">';
        h += '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">';
        h += '<div><div style="font-weight:700;font-size:13px">' + (t.type || 'Issue') + '</div>';
        h += '<div class="text-xxs text-muted">' + (t.userName || '?') + ' · ' + new Date(t.createdAt || 0).toLocaleString() + '</div>';
        h += '<div style="font-size:12px;margin-top:4px">' + (t.message || '').substring(0, 100) + '</div></div>';
        h += '<div style="display:flex;gap:4px;flex-shrink:0">';
        h += '<button class="btn btn-primary btn-xs" onclick="window.resolveTicket(\'' + t.id + '\')"><i class="fas fa-check"></i> Resolve</button>';
        if (t.userId) h += '<button class="btn btn-ghost btn-xs" onclick="window.openChat && openChat(\'' + t.userId + '\')"><i class="fas fa-reply"></i></button>';
        h += '</div></div></div></div>';
      });
      h += '</div>';
      _modal('🎫 Support Tickets (' + tickets.length + ' open)', h);
    });
  };
  window.resolveTicket = function (ticketId) {
    rtdb.ref('supportRequests/' + ticketId).update({ status: 'resolved', resolvedAt: Date.now() });
    _logAction('resolve_ticket', ticketId);
    _toast('✅ Ticket resolved');
    _close();
  };

  /* ─── FEATURE 13: WITHDRAWAL LIMIT CONFIG ─── */
  window.showWithdrawalConfig = function () {
    rtdb.ref('appSettings/withdrawal').once('value', function (s) {
      var cfg = s.val() || { minAmount: 50, maxAmount: 5000, dailyLimit: 10000 };
      var h = '<div>';
      h += '<div class="form-group"><label>Minimum Withdrawal (₹)</label><input type="number" id="wdMin" class="form-input" value="' + cfg.minAmount + '"></div>';
      h += '<div class="form-group"><label>Maximum per Request (₹)</label><input type="number" id="wdMax" class="form-input" value="' + cfg.maxAmount + '"></div>';
      h += '<div class="form-group"><label>Daily Limit per User (₹)</label><input type="number" id="wdDaily" class="form-input" value="' + cfg.dailyLimit + '"></div>';
      h += '<div class="form-group"><label>Auto-Approve below (₹) <span class="text-muted text-xxs">0 = manual only</span></label><input type="number" id="wdAuto" class="form-input" value="' + (cfg.autoApprove || 0) + '"></div>';
      h += '<button class="btn btn-primary w-full" onclick="window._saveWdConfig()"><i class="fas fa-save"></i> Save Config</button></div>';
      _modal('⚙️ Withdrawal Config', h);
    });
  };
  window._saveWdConfig = function () {
    rtdb.ref('appSettings/withdrawal').set({
      minAmount: Number((_$('wdMin') || {}).value) || 50,
      maxAmount: Number((_$('wdMax') || {}).value) || 5000,
      dailyLimit: Number((_$('wdDaily') || {}).value) || 10000,
      autoApprove: Number((_$('wdAuto') || {}).value) || 0
    });
    _logAction('update_wd_config');
    _toast('✅ Withdrawal config saved!');
    _close();
  };

  /* ─── FEATURE 14: ADMIN ACTION LOG VIEWER ─── */
  window.showActionLog = function () {
    rtdb.ref('activityLogs').orderByChild('ts').limitToLast(100).once('value', function (s) {
      var logs = [];
      if (s.exists()) s.forEach(function (c) { logs.unshift(c.val()); });
      var icons = { ban: '🚫', approve: '✅', reject: '❌', publish: '📢', cancel: '🚫', manual: '💰', flag_device: '🔍', bulk_message: '📣', resolve_ticket: '🎫', watchlist_add: '👁️', update_wd_config: '⚙️' };
      var h = '<div>';
      if (!logs.length) h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No logs yet</p>';
      else {
        h += '<table><thead><tr><th>Action</th><th>Target</th><th>Time</th></tr></thead><tbody>';
        logs.forEach(function (l) {
          h += '<tr><td><span style="font-size:14px">' + (icons[l.action] || '📝') + '</span> ' + l.action + '</td>';
          h += '<td class="text-xxs font-mono">' + (l.targetId || '—').substring(0, 20) + '</td>';
          h += '<td class="text-xxs">' + new Date(l.ts).toLocaleString() + '</td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '</div>';
      _modal('📋 Activity Log', h);
    });
  };

  /* ─── FEATURE 15: PRIZE POOL CALCULATOR ─── */
  window.showPrizeCalculator = function () {
    var h = '<div>';
    h += '<div class="form-group"><label>Total Prize Pool (₹)</label><input type="number" id="pcPool" class="form-input" placeholder="e.g. 500" oninput="window._calcPrizes()"></div>';
    h += '<div class="form-group"><label>Distribution</label><select id="pcDist" class="form-input" onchange="window._calcPrizes()"><option value="top3">Top 3 (50/30/20%)</option><option value="top5">Top 5 (40/25/20/10/5%)</option><option value="top10">Top 10 (Equal Split)</option><option value="kills">Per Kill Based</option></select></div>';
    h += '<div id="pcResult" style="margin-top:12px"></div></div>';
    _modal('🧮 Prize Calculator', h);
  };
  window._calcPrizes = function () {
    var pool = Number((_$('pcPool') || {}).value) || 0;
    var dist = (_$('pcDist') || {}).value;
    var res = _$('pcResult'); if (!res) return;
    var h = '';
    if (dist === 'top3') {
      [[50, '1st 🥇'], [30, '2nd 🥈'], [20, '3rd 🥉']].forEach(function (x) {
        h += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>' + x[1] + '</span><strong class="text-primary">₹' + Math.round(pool * x[0] / 100) + '</strong></div>';
      });
    } else if (dist === 'top5') {
      [[40, '1st'], [25, '2nd'], [20, '3rd'], [10, '4th'], [5, '5th']].forEach(function (x) {
        h += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>' + x[1] + '</span><strong class="text-primary">₹' + Math.round(pool * x[0] / 100) + '</strong></div>';
      });
    } else if (dist === 'top10') {
      var each = Math.floor(pool / 10);
      h = '<div style="padding:8px;background:rgba(0,255,106,.06);border-radius:8px">Each of top 10: <strong class="text-primary">₹' + each + '</strong></div>';
    } else if (dist === 'kills') {
      var pk = pool > 0 ? Math.floor(pool / 25) : 0;
      h = '<div style="padding:8px;background:rgba(255,170,0,.08);border-radius:8px"><strong>₹' + pk + '</strong> per kill (assumes 25 kills)</div>';
    }
    res.innerHTML = h || '<p class="text-muted text-xxs">Enter pool amount</p>';
  };

  /* ─── FEATURE 16: SCHEDULED ANNOUNCEMENTS ─── */
  window.showScheduleAnnouncement = function () {
    var h = '<div>';
    h += '<div class="form-group"><label>Announcement</label><textarea id="annMsg" class="form-input" style="height:80px" placeholder="Announcement message..."></textarea></div>';
    h += '<div class="form-group"><label>Schedule Time (IST)</label><input type="datetime-local" id="annTime" class="form-input"></div>';
    h += '<div class="form-group"><label>Target</label><select id="annTarget" class="form-input"><option value="all">All Users</option><option value="active">Active Users</option></select></div>';
    h += '<button class="btn btn-primary w-full" onclick="window._scheduleAnn()"><i class="fas fa-clock"></i> Schedule</button></div>';
    _modal('📅 Schedule Announcement', h);
  };
  window._scheduleAnn = function () {
    var msg = (_$('annMsg') || {}).value;
    var time = (_$('annTime') || {}).value;
    if (!msg || !time) { _toast('Fill all fields', true); return; }
    var ts = new Date(time).getTime();
    rtdb.ref('scheduledAnnouncements').push({
      message: msg, scheduledFor: ts, target: (_$('annTarget') || {}).value,
      createdAt: Date.now(), status: 'pending'
    });
    _logAction('schedule_announcement', '', { msg: msg.substring(0, 50), ts: ts });
    _toast('✅ Announcement scheduled!');
    _close();
  };

  /* ─── FEATURE 17: PLAYER NOTES / REPUTATION ─── */
  window.showAddNote = function (uid, name) {
    var h = '<div>';
    h += '<div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">Player: <strong>' + name + '</strong></div>';
    rtdb.ref('adminNotes/' + uid).once('value', function (s) {
      var existing = '';
      if (s.exists()) s.forEach(function (c) {
        var n = c.val();
        existing += '<div style="padding:6px 8px;border-radius:8px;background:var(--bg-dark);margin-bottom:4px;font-size:12px"><span class="badge ' + (n.tag || 'yellow') + ' text-xxs">' + n.tag + '</span> ' + n.note + ' <span class="text-muted text-xxs">(' + new Date(n.ts).toLocaleDateString() + ')</span></div>';
      });
      if (existing) h += '<div style="margin-bottom:12px">' + existing + '</div>';
      h += '<textarea id="noteInput" class="form-input" style="height:80px" placeholder="Add note..."></textarea>';
      h += '<select id="noteTag" class="form-input" style="margin-top:8px"><option value="info">ℹ️ Info</option><option value="warning">⚠️ Warning</option><option value="suspicious">🚨 Suspicious</option><option value="vip">⭐ VIP</option></select>';
      h += '<button class="btn btn-primary w-full" style="margin-top:10px" onclick="window._saveNote(\'' + uid + '\',\'' + name + '\')">Add Note</button>';
      h += '</div>';
      _modal('📝 Player Notes: ' + name, h);
    });
  };
  window._saveNote = function (uid, name) {
    var note = (_$('noteInput') || {}).value;
    var tag = (_$('noteTag') || {}).value;
    if (!note) { _toast('Note likhna padega', true); return; }
    rtdb.ref('adminNotes/' + uid).push({ note: note, tag: tag, ts: Date.now() });
    _logAction('add_note', uid, { name: name });
    _toast('✅ Note saved!');
    _close();
  };

  /* ─── FEATURE 18: BAN APPEAL VIEWER ─── */
  window.showBanAppeals = function () {
    rtdb.ref('banAppeals').orderByChild('status').equalTo('pending').once('value', function (s) {
      var appeals = [];
      if (s.exists()) s.forEach(function (c) { appeals.push(Object.assign({}, c.val(), { id: c.key })); });
      var h = '<div>';
      if (!appeals.length) h += '<div style="text-align:center;padding:30px;color:var(--text-muted)">No pending appeals 🎉</div>';
      appeals.forEach(function (a) {
        h += '<div class="card" style="margin-bottom:8px"><div class="card-body compact">';
        h += '<div style="font-weight:700;font-size:13px">' + a.userName + '</div>';
        h += '<div class="text-xxs text-muted font-mono">' + a.uid + '</div>';
        h += '<div style="font-size:12px;margin:8px 0">"' + (a.reason || 'No reason given').substring(0, 150) + '"</div>';
        h += '<div style="display:flex;gap:8px">';
        h += '<button class="btn btn-primary btn-sm flex-1" onclick="window.unbanFromAppeal(\'' + a.uid + '\',\'' + a.id + '\')"><i class="fas fa-user-check"></i> Unban</button>';
        h += '<button class="btn btn-danger btn-sm flex-1" onclick="rtdb.ref(\'banAppeals/' + a.id + '\').update({status:\'rejected\'});showToast(\'Appeal rejected\');closeModal();"><i class="fas fa-times"></i> Reject</button>';
        h += '</div></div></div>';
      });
      h += '</div>';
      _modal('⚖️ Ban Appeals (' + appeals.length + ')', h);
    });
  };
  window.unbanFromAppeal = function (uid, appealId) {
    rtdb.ref('users/' + uid + '/banned').set(false);
    rtdb.ref('users/' + uid + '/bannedReason').remove();
    rtdb.ref('banAppeals/' + appealId).update({ status: 'accepted', resolvedAt: Date.now() });
    _logAction('unban', uid, { via: 'appeal' });
    _toast('✅ User unbanned!');
    _close();
  };

  /* ─── FEATURE 19: COHORT RETENTION ANALYSIS ─── */
  window.renderCohortData = function (containerId) {
    var el = _$(containerId || 'cohortData'); if (!el) return;
    rtdb.ref('users').once('value', function (s) {
      var cohorts = {};
      s.forEach(function (c) {
        var u = c.val(); if (!u.createdAt) return;
        var week = 'W' + Math.floor((Date.now() - u.createdAt) / (7 * 24 * 60 * 60 * 1000));
        if (!cohorts[week]) cohorts[week] = { total: 0, active: 0 };
        cohorts[week].total++;
        if (u.stats && u.stats.matches > 0) cohorts[week].active++;
      });
      var h = '<table><thead><tr><th>Cohort</th><th>Users</th><th>Active</th><th>Retention</th></tr></thead><tbody>';
      Object.entries(cohorts).slice(0, 8).forEach(function (e) {
        var ret = e[1].total > 0 ? Math.round(e[1].active / e[1].total * 100) : 0;
        h += '<tr><td>' + e[0] + '</td><td>' + e[1].total + '</td><td>' + e[1].active + '</td>';
        h += '<td><span class="badge ' + (ret >= 50 ? 'green' : ret >= 25 ? 'yellow' : 'red') + '">' + ret + '%</span></td></tr>';
      });
      h += '</tbody></table>';
      el.innerHTML = h;
    });
  };

  /* ─── FEATURE 20: LIVE MATCH SCOREBOARD (ADMIN) ─── */
  window.showLiveScoreboard = function (matchId) {
    rtdb.ref('matchResults/' + matchId).once('value', function (s) {
      if (!s.exists()) { _toast('No results published yet'); return; }
      var results = [];
      s.forEach(function (c) { results.push(c.val()); });
      results.sort(function (a, b) { return (a.rank || 99) - (b.rank || 99); });
      var h = '<table><thead><tr><th>Rank</th><th>Player</th><th>Kills</th><th>Prize</th></tr></thead><tbody>';
      results.forEach(function (r) {
        var med = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '#' + r.rank;
        h += '<tr><td>' + med + '</td><td>' + r.playerName + '</td><td>' + r.kills + '</td><td class="text-primary">₹' + r.prize + '</td></tr>';
      });
      h += '</tbody></table>';
      _modal('🏆 Scoreboard', h);
    });
  };

  /* ─── FEATURE 21: AUTO PAYOUT RULES ─── */
  window.showAutoPayoutRules = function () {
    rtdb.ref('appSettings/withdrawal').once('value', function (s) {
      var cfg = s.val() || {};
      var h = '<div>';
      h += '<div class="info-box yellow" style="margin-bottom:12px"><i class="fas fa-info-circle"></i> Auto-approve: Eligible withdrawals automatically ho jaenge approved</div>';
      h += '<div class="form-group"><label>Auto-approve if amount ≤ (₹)</label><input type="number" id="apAmt" class="form-input" value="' + (cfg.autoApprove || 0) + '" placeholder="0 = disabled"></div>';
      h += '<div class="form-group"><label>Only for verified users</label><select id="apVerified" class="form-input"><option value="1">Yes</option><option value="0">No</option></select></div>';
      h += '<div class="form-group"><label>Min matches played</label><input type="number" id="apMinMatches" class="form-input" value="' + (cfg.autoApproveMinMatches || 5) + '"></div>';
      h += '<button class="btn btn-primary w-full" onclick="window._saveAutoPayoutRules()"><i class="fas fa-save"></i> Save Rules</button></div>';
      _modal('⚡ Auto Payout Rules', h);
    });
  };
  window._saveAutoPayoutRules = function () {
    rtdb.ref('appSettings/withdrawal').update({
      autoApprove: Number((_$('apAmt') || {}).value) || 0,
      autoApproveVerifiedOnly: ((_$('apVerified') || {}).value === '1'),
      autoApproveMinMatches: Number((_$('apMinMatches') || {}).value) || 5
    });
    _logAction('update_autopayout');
    _toast('✅ Auto payout rules saved!');
    _close();
  };

  /* ─── FEATURE 22: MATCH BROADCAST TO PLAYERS ─── */
  window.broadcastToMatch = function (matchId, matchName) {
    var h = '<div>';
    h += '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Send notification to all players in <strong>' + matchName + '</strong></p>';
    h += '<input type="text" id="bcTitle" class="form-input" placeholder="Title" style="margin-bottom:8px">';
    h += '<textarea id="bcMsg" class="form-input" style="height:70px" placeholder="Message..."></textarea>';
    h += '<button class="btn btn-primary w-full" style="margin-top:10px" onclick="window._sendBroadcast(\'' + matchId + '\',\'' + matchName + '\')"><i class="fas fa-broadcast-tower"></i> Broadcast</button></div>';
    _modal('📡 Match Broadcast', h);
  };
  window._sendBroadcast = function (matchId, matchName) {
    var title = (_$('bcTitle') || {}).value;
    var msg = (_$('bcMsg') || {}).value;
    if (!title || !msg) { _toast('Fill all fields', true); return; }
    rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value', function (s) {
      var sent = 0, notified = {};
      s.forEach(function (c) {
        var d = c.val(), uid = d.userId;
        if (!uid || notified[uid]) return;
        notified[uid] = true;
        var nid = rtdb.ref('users/' + uid + '/notifications').push().key;
        rtdb.ref('users/' + uid + '/notifications/' + nid).set({
          type: 'match', title: title, body: msg, matchId: matchId, read: false, createdAt: Date.now()
        });
        sent++;
      });
      _logAction('broadcast', matchId, { title: title, sent: sent });
      _toast('✅ Broadcast sent to ' + sent + ' players!');
      _close();
    });
  };

  /* ─── FEATURE 23: PLATFORM HEALTH MONITOR ─── */
  window.checkPlatformHealth = function () {
    var startTime = Date.now();
    rtdb.ref('.info/connected').once('value', function (s) {
      var checks = [];
      checks.push({ name: 'Firebase Realtime DB', ok: s.val() === true });
      var latency = Date.now() - startTime;
      checks.push({ name: 'DB Latency (' + latency + 'ms)', ok: latency < 2000 });
      checks.push({ name: 'Auth Service', ok: !!firebase.auth().currentUser });
      rtdb.ref('appSettings').once('value', function (s2) {
        checks.push({ name: 'App Settings', ok: s2.exists() });
        var h = '<div>';
        checks.forEach(function (c) {
          h += '<div style="display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--border)">';
          h += '<span style="font-size:18px">' + (c.ok ? '✅' : '❌') + '</span>';
          h += '<span style="font-size:13px">' + c.name + '</span></div>';
        });
        var allOk = checks.every(function (c) { return c.ok; });
        h += '<div style="margin-top:12px;padding:10px;border-radius:10px;background:' + (allOk ? 'rgba(0,255,106,.08)' : 'rgba(255,0,60,.08)') + ';text-align:center;font-weight:700">' + (allOk ? '✅ All Systems Operational' : '⚠️ Issues Detected') + '</div>';
        h += '</div>';
        _modal('🔧 Platform Health', h);
      });
    });
  };

  /* ─── FEATURE 24: CUSTOM UPI SETTINGS ─── */
  window.showUpiSettings = function () {
    rtdb.ref('appSettings/payment').once('value', function (s) {
      var p = s.val() || {};
      var h = '<div>';
      h += '<div class="form-group"><label>UPI ID</label><input type="text" id="upiId" class="form-input" value="' + (p.upiId || '') + '" placeholder="yourname@upi"></div>';
      h += '<div class="form-group"><label>UPI Name (Display)</label><input type="text" id="upiName" class="form-input" value="' + (p.upiName || '') + '" placeholder="Mini eSports"></div>';
      h += '<div class="form-group"><label>Payee Name</label><input type="text" id="upiPayee" class="form-input" value="' + (p.payeeName || '') + '"></div>';
      h += '<div class="form-group"><label>QR Code Image URL (optional)</label><input type="text" id="upiQr" class="form-input" value="' + (p.qrCodeUrl || '') + '" placeholder="https://..."></div>';
      h += '<div class="form-group"><label>Min Deposit (₹)</label><input type="number" id="upiMin" class="form-input" value="' + (p.minDeposit || 10) + '"></div>';
      h += '<button class="btn btn-primary w-full" onclick="window._saveUpi()"><i class="fas fa-save"></i> Save Payment Settings</button></div>';
      _modal('💳 UPI Settings', h);
    });
  };
  window._saveUpi = function () {
    rtdb.ref('appSettings/payment').set({
      upiId: (_$('upiId') || {}).value,
      upiName: (_$('upiName') || {}).value,
      payeeName: (_$('upiPayee') || {}).value,
      qrCodeUrl: (_$('upiQr') || {}).value,
      minDeposit: Number((_$('upiMin') || {}).value) || 10
    });
    _logAction('update_upi');
    _toast('✅ Payment settings saved!');
    _close();
  };

  /* ─── FEATURE 25: DASHBOARD WIDGETS TOGGLE + QUICK ACTION TOPBAR ─── */
  window.adminWidgetPrefs = JSON.parse(localStorage.getItem('adminWidgets') || '{"revenue":true,"users":true,"matches":true,"health":true}');
  window.saveAdminWidgets = function () {
    localStorage.setItem('adminWidgets', JSON.stringify(window.adminWidgetPrefs));
    _toast('✅ Dashboard preferences saved!');
  };
  // Inject quick action topbar buttons
  (function injectAdminUI() {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () {
        var topbar = document.querySelector('.topbar');
        if (topbar && !document.getElementById('adminQuickActions')) {
          var qa = document.createElement('div');
          qa.id = 'adminQuickActions';
          qa.style.cssText = 'display:flex;gap:4px;margin-left:auto;margin-right:8px';
          qa.innerHTML = [
            ['fas fa-file-csv', 'Export', 'exportCSV(\'users\')'],
            ['fas fa-shield-alt', 'Fraud', 'runFraudCheck()'],
            ['fas fa-heartbeat', 'Health', 'checkPlatformHealth()'],
            ['fas fa-bell', 'Broadcast', 'showBulkMessage()'],
            ['fas fa-calculator', 'Prize Calc', 'showPrizeCalculator()'],
          ].map(function (b) {
            return '<button class="btn btn-ghost btn-xs" onclick="' + b[2] + '" title="' + b[1] + '" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 8px"><i class="' + b[0] + '"></i><span style="font-size:8px">' + b[1] + '</span></button>';
          }).join('');
          topbar.appendChild(qa);
        }
      }, 1500);
    });
  })();

  /* =========================================================
     🆕 NEW ADMIN FEATURES (26–50)
     ========================================================= */

  /* ─── FEATURE 26: TEAM JOIN VERIFIER ─── */
  /* Verify that all teammates of a join request are properly created */
  window.verifyTeamJoins = function (captainJoinId) {
    rtdb.ref('joinRequests/' + captainJoinId).once('value', function (s) {
      if (!s.exists()) { _toast('JoinRequest not found', true); return; }
      var jr = s.val();
      if (!jr.teamMembers || jr.teamMembers.length <= 1) { _toast('Solo match — no teammates', 'inf'); return; }
      var matchId = jr.matchId;
      var captainUid = jr.userId;
      var issues = [];
      var checked = 0;
      var total = jr.teamMembers.filter(function (m) { return m.role !== 'captain'; }).length;
      if (total === 0) { _toast('No teammates to verify', 'inf'); return; }
      jr.teamMembers.forEach(function (member) {
        if (member.role === 'captain') return;
        rtdb.ref('users').orderByChild('ffUid').equalTo(member.uid).once('value', function (us) {
          if (!us.exists()) { issues.push('Member ' + member.name + ' not found in DB'); checked++; done(); return; }
          var partnerFbUid = null; us.forEach(function (c) { partnerFbUid = c.key; });
          rtdb.ref('joinRequests').orderByChild('userId').equalTo(partnerFbUid).once('value', function (jrs) {
            var found = false;
            if (jrs.exists()) jrs.forEach(function (c) { if (c.val().matchId === matchId && c.val().isTeamMember) found = true; });
            if (!found) {
              issues.push(member.name + ' ka joinRequest missing hai!');
              // Auto-fix: create the missing joinRequest
              if (window.processTeammateJoins) {
                rtdb.ref('users/' + partnerFbUid).once('value', function (pUs) {
                  if (pUs.exists()) {
                    var pData = pUs.val();
                    _createTeammateJRAdmin(partnerFbUid, pData, matchId, jr.matchName, jr.entryType === 'coin', jr.mode, jr.teamMembers, jr.userName, captainUid);
                  }
                });
              }
            }
            checked++;
            done();
          });
        });
      });
      function done() {
        if (checked < total) return;
        if (issues.length) {
          _toast('⚠️ ' + issues.length + ' issues — auto-fixing!', 'err');
          console.warn('[Admin] Team join issues:', issues);
        } else {
          _toast('✅ All teammate joins verified!');
        }
      }
    });
  };

  function _createTeammateJRAdmin(pFirebaseUid, pData, matchId, matchName, isCoin, mode, allMembers, captainName, captainUid) {
    var pjid = rtdb.ref('joinRequests').push().key;
    rtdb.ref('joinRequests/' + pjid).set({
      requestId: pjid, userId: pFirebaseUid,
      userName: pData.ign || pData.displayName || '',
      userFFUID: pData.ffUid || '',
      matchId: matchId, matchName: matchName || '',
      entryFee: 0, entryType: isCoin ? 'coin' : 'money',
      mode: mode, status: 'joined', slotsBooked: 0,
      isTeamMember: true, captainUid: captainUid, captainName: captainName || '',
      teamMembers: allMembers, createdAt: Date.now(), autoFixed: true
    });
    rtdb.ref('users/' + pFirebaseUid + '/stats/matches').transaction(function (m) { return (m || 0) + 1; });
    var nid = rtdb.ref('users/' + pFirebaseUid + '/notifications').push().key;
    rtdb.ref('users/' + pFirebaseUid + '/notifications/' + nid).set({
      type: 'team_joined', title: '🎮 Team Match Joined!',
      body: captainName + ' ne "' + matchName + '" join kiya — tum bhi team mein ho!',
      matchId: matchId, read: false, createdAt: Date.now()
    });
    _logAction('auto_fix_team_join', pFirebaseUid, { matchId: matchId });
  }

  /* ─── FEATURE 27: USER QUICK SEARCH ─── */
  window.showUserSearch = function () {
    var h = '<div>';
    h += '<input type="text" id="userSearchQ" placeholder="Search by IGN, Email or UID..." class="form-input" oninput="window._searchUsers()" style="margin-bottom:10px">';
    h += '<div id="userSearchResults"></div></div>';
    _modal('🔍 User Search', h);
  };
  window._searchUsers = function () {
    var q = ((_$('userSearchQ') || {}).value || '').trim().toLowerCase();
    var res = _$('userSearchResults'); if (!res) return;
    if (q.length < 2) { res.innerHTML = '<p class="text-muted text-xxs">Type at least 2 characters</p>'; return; }
    res.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i></div>';
    rtdb.ref('users').once('value', function (s) {
      var matches = [];
      s.forEach(function (c) {
        var u = c.val(), uid = c.key;
        if ((u.ign && u.ign.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q)) ||
          (u.ffUid && u.ffUid.includes(q)) ||
          uid.includes(q)) {
          matches.push(Object.assign({}, u, { _uid: uid }));
        }
      });
      if (!matches.length) { res.innerHTML = '<p class="text-muted text-xxs">No users found</p>'; return; }
      var h = '<div style="display:flex;flex-direction:column;gap:6px">';
      matches.slice(0, 10).forEach(function (u) {
        h += '<div style="padding:10px 12px;border-radius:10px;background:var(--bg-card);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
        h += '<div><div style="font-weight:700;font-size:13px">' + (u.ign || u.displayName || 'User') + '</div>';
        h += '<div class="text-xxs text-muted">' + (u.email || '') + ' · ' + (u.profileStatus || 'unknown') + '</div></div>';
        h += '<button class="btn btn-ghost btn-xs" onclick="window.openUserModal && openUserModal(\'' + u._uid + '\')"><i class="fas fa-eye"></i></button></div>';
      });
      h += '</div>';
      res.innerHTML = h;
    });
  };

  /* ─── FEATURE 28: MATCH STATUS BULK UPDATE ─── */
  window.showBulkStatusUpdate = function () {
    rtdb.ref('matches').limitToLast(20).once('value', function (s) {
      var h = '<div>';
      h += '<div class="form-group"><label>New Status</label><select id="bsStatus" class="form-input"><option value="completed">Completed ✅</option><option value="cancelled">Cancelled ❌</option><option value="live">Live 🔴</option><option value="upcoming">Upcoming ⏳</option></select></div>';
      h += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">Select Matches:</div>';
      h += '<div id="bsMatchList" style="max-height:200px;overflow-y:auto">';
      s.forEach(function (c) {
        var m = c.val(); if (!m) return;
        h += '<label style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;background:var(--bg-dark);margin-bottom:4px;cursor:pointer">';
        h += '<input type="checkbox" value="' + c.key + '" class="bs-match-cb">';
        h += '<span style="font-size:12px">' + (m.name || c.key) + '</span></label>';
      });
      h += '</div>';
      h += '<button class="btn btn-primary w-full" style="margin-top:12px" onclick="window._doBulkStatus()">Apply Status</button></div>';
      _modal('🔄 Bulk Status Update', h);
    });
  };
  window._doBulkStatus = function () {
    var status = (_$('bsStatus') || {}).value;
    var cbs = document.querySelectorAll('.bs-match-cb:checked');
    if (!cbs.length) { _toast('Select at least one match', true); return; }
    cbs.forEach(function (cb) {
      rtdb.ref('matches/' + cb.value + '/status').set(status);
      _logAction('bulk_status_update', cb.value, { status: status });
    });
    _toast('✅ ' + cbs.length + ' matches updated to ' + status);
    _close();
  };

  /* ─── FEATURE 29: WALLET REQUEST QUICK APPROVE ─── */
  window.showPendingWallet = function () {
    rtdb.ref('walletRequests').orderByChild('status').equalTo('pending').once('value', function (s) {
      var reqs = [];
      if (s.exists()) s.forEach(function (c) { reqs.push(Object.assign({}, c.val(), { _key: c.key })); });
      reqs.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      var h = '<div>';
      h += '<div style="display:flex;gap:8px;margin-bottom:12px">';
      h += '<button class="btn btn-ghost btn-sm" onclick="window.exportCSV(\'wallet\')"><i class="fas fa-download"></i> Export</button></div>';
      if (!reqs.length) h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No pending requests ✅</p>';
      reqs.forEach(function (r) {
        var isDeposit = r.type === 'deposit';
        h += '<div class="card" style="margin-bottom:8px"><div class="card-body compact">';
        h += '<div style="display:flex;justify-content:space-between;align-items:start">';
        h += '<div><div style="font-weight:700;font-size:13px">' + (isDeposit ? '📥 Deposit' : '📤 Withdrawal') + ' — ₹' + r.amount + '</div>';
        h += '<div class="text-xxs text-muted">' + (r.userName || '?') + ' · ' + new Date(r.createdAt).toLocaleString() + '</div>';
        if (r.utr) h += '<div class="text-xxs" style="margin-top:4px">UTR: <span class="font-mono">' + r.utr + '</span></div>';
        if (isDeposit && r.screenshotBase64) h += '<button class="btn btn-ghost btn-xs" style="margin-top:4px" onclick="window._viewSS(\'' + r._key + '\')"><i class="fas fa-image"></i> View Proof</button>';
        h += '</div>';
        h += '<div style="display:flex;flex-direction:column;gap:4px">';
        h += '<button class="btn btn-primary btn-xs" onclick="window.approveWallet(\'' + r._key + '\',\'' + r.uid + '\',' + r.amount + ',\'' + r.type + '\')">✅ Approve</button>';
        h += '<button class="btn btn-danger btn-xs" onclick="window.rejectWallet(\'' + r._key + '\',\'' + r.uid + '\',' + r.amount + ',\'' + r.type + '\')">❌ Reject</button>';
        h += '</div></div></div></div>';
      });
      h += '</div>';
      _modal('💳 Pending Wallet Requests (' + reqs.length + ')', h);
    });
  };
  window._viewSS = function (key) {
    rtdb.ref('walletRequests/' + key + '/screenshotBase64').once('value', function (s) {
      if (!s.exists()) { _toast('No screenshot', 'inf'); return; }
      var img = '<div style="text-align:center"><img src="' + s.val() + '" style="max-width:100%;border-radius:10px"></div>';
      _modal('📸 Payment Screenshot', img);
    });
  };
  window.approveWallet = function (key, uid, amount, type) {
    rtdb.ref('walletRequests/' + key).update({ status: 'approved', approvedAt: Date.now() });
    if (type === 'deposit') {
      rtdb.ref('users/' + uid + '/realMoney/deposited').transaction(function (v) { return (v || 0) + amount; });
    }
    var nid = rtdb.ref('users/' + uid + '/notifications').push().key;
    rtdb.ref('users/' + uid + '/notifications/' + nid).set({
      type: type === 'deposit' ? 'wallet_approved' : 'withdraw_done',
      title: type === 'deposit' ? '✅ Deposit Approved!' : '✅ Withdrawal Processed!',
      body: '₹' + amount + ' ' + (type === 'deposit' ? 'wallet mein add hua' : 'processed ho gaya'),
      read: false, createdAt: Date.now()
    });
    _logAction('approve_wallet', key, { uid: uid, amount: amount, type: type });
    _toast('✅ Approved!');
    window.showPendingWallet();
  };
  window.rejectWallet = function (key, uid, amount, type) {
    rtdb.ref('walletRequests/' + key).update({ status: 'rejected', rejectedAt: Date.now() });
    if (type === 'withdraw') {
      rtdb.ref('users/' + uid + '/realMoney/winnings').transaction(function (v) { return (v || 0) + amount; });
    }
    var nid = rtdb.ref('users/' + uid + '/notifications').push().key;
    rtdb.ref('users/' + uid + '/notifications/' + nid).set({
      type: type === 'deposit' ? 'wallet_rejected' : 'withdraw_rejected',
      title: type === 'deposit' ? '❌ Deposit Rejected' : '❌ Withdrawal Rejected',
      body: '₹' + amount + ' ' + (type === 'withdraw' ? 'wapas wallet mein add hua' : 'rejected ho gaya'),
      read: false, createdAt: Date.now()
    });
    _logAction('reject_wallet', key, { uid: uid, amount: amount, type: type });
    _toast('Rejected!');
    window.showPendingWallet();
  };

  /* ─── FEATURE 30: ROOM ID RELEASE MANAGER ─── */
  window.showRoomManager = function (matchId, matchName) {
    rtdb.ref('matches/' + matchId).once('value', function (s) {
      var m = s.val() || {};
      var relMin = m.roomReleaseMinutes || 5; // default 5 minutes
      var h = '<div>';
      h += '<p class="text-muted" style="font-size:12px;margin-bottom:12px">Room details for: <strong>' + matchName + '</strong></p>';
      h += '<div class="form-group"><label>Room ID</label><input type="text" id="rmRoomId" class="form-input" value="' + (m.roomId || '') + '" placeholder="Enter Room ID"></div>';
      h += '<div class="form-group"><label>Room Password</label><input type="text" id="rmRoomPw" class="form-input" value="' + (m.roomPassword || '') + '" placeholder="Enter Password"></div>';
      // Release time config
      h += '<div class="form-group" style="margin-bottom:14px">';
      h += '<label style="margin-bottom:6px;display:block">⏱️ Players ko Room ID kab mile? (Match se kitne min pehle)</label>';
      h += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
      [1, 3, 5, 10, 15, 30].forEach(function(min) {
        h += '<button onclick="document.getElementById(\'rmRelMin\').value=' + min + ';this.parentNode.querySelectorAll(\'button\').forEach(function(b){b.style.background=\'\'});this.style.background=\'var(--primary)\'" ' +
          'style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:' + (relMin === min ? 'var(--primary)' : '') + ';color:var(--text);font-size:12px;cursor:pointer">' + min + ' min</button>';
      });
      h += '</div>';
      h += '<input type="number" id="rmRelMin" value="' + relMin + '" min="1" max="60" style="margin-top:8px;width:80px;padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px" placeholder="Min">';
      h += '<span style="font-size:11px;color:var(--text-muted);margin-left:8px">minutes before match (default: 5)</span>';
      h += '</div>';
      // Status info
      if (m.roomStatus === 'released') {
        h += '<div style="margin-bottom:10px;padding:8px;border-radius:8px;background:rgba(0,255,106,.08);font-size:12px;color:var(--success)">✅ Room already released to players</div>';
      } else if (m.matchTime) {
        var releaseAt = Number(m.matchTime) - (relMin * 60000);
        var now = Date.now();
        var diff = releaseAt - now;
        if (diff > 0) {
          var mins = Math.floor(diff / 60000);
          h += '<div style="margin-bottom:10px;padding:8px;border-radius:8px;background:rgba(0,212,255,.08);font-size:12px;color:#00d4ff">⏰ Auto-release in: ~' + mins + ' min (match - ' + relMin + ' min)</div>';
        } else {
          h += '<div style="margin-bottom:10px;padding:8px;border-radius:8px;background:rgba(255,170,0,.08);font-size:12px;color:#ffaa00">⚠️ Release time already passed — release manually</div>';
        }
      }
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
      h += '<button class="btn btn-ghost w-full" onclick="window._saveRoomOnly(\'' + matchId + '\',\'' + matchName + '\')"><i class="fas fa-save"></i> Save Only</button>';
      h += '<button class="btn btn-primary w-full" onclick="window._releaseRoom(\'' + matchId + '\',\'' + matchName + '\')"><i class="fas fa-key"></i> Release Now</button>';
      h += '</div>';
      h += '</div>';
      _modal('🔑 Room Manager', h);
    });
  };

  /* Save room details without releasing to players yet */
  window._saveRoomOnly = function (matchId, matchName) {
    var roomId = (_$('rmRoomId') || {}).value;
    var roomPw = (_$('rmRoomPw') || {}).value;
    var relMin = Number((_$('rmRelMin') || {}).value) || 5;
    if (!roomId || !roomPw) { _toast('Room ID and Password required', true); return; }
    rtdb.ref('matches/' + matchId).update({
      roomId: roomId, roomPassword: roomPw,
      roomStatus: 'saved',  // saved but not yet released
      roomReleaseMinutes: relMin,
      roomSavedAt: Date.now()
    });
    _logAction('save_room', matchId, { matchName: matchName, releaseMin: relMin });
    _toast('💾 Room details saved! Will auto-release ' + relMin + ' min before match.');
    _close();
  };

  window._releaseRoom = function (matchId, matchName) {
    var roomId = (_$('rmRoomId') || {}).value;
    var roomPw = (_$('rmRoomPw') || {}).value;
    var relMin = Number((_$('rmRelMin') || {}).value) || 5;
    if (!roomId || !roomPw) { _toast('Room ID and Password required', true); return; }
    rtdb.ref('matches/' + matchId).update({ roomId: roomId, roomPassword: roomPw, roomStatus: 'released', roomReleaseMinutes: relMin, roomReleasedAt: Date.now() });
    // Notify all joined players
    rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value', function (s) {
      var notified = {};
      s.forEach(function (c) {
        var d = c.val(), uid = d.userId;
        if (!uid || notified[uid]) return;
        notified[uid] = true;
        rtdb.ref('users/' + uid + '/notifications').push({
          type: 'room_released', matchId: matchId, matchName: matchName,
          title: '🔑 Room Details Released!', message: 'Room ID & Password ready for "' + matchName + '". Tap to view!',
          faIcon: 'fa-key', timestamp: Date.now(), read: false, createdAt: Date.now()
        });
      });
    });
    _logAction('release_room', matchId, { matchName: matchName });
    _toast('✅ Room ID released! Players notified.');
    _close();
  };

  /* Auto-release room IDs based on roomReleaseMinutes setting */
  window._autoReleaseRooms = function() {
    var now = Date.now();
    rtdb.ref('matches').orderByChild('status').equalTo('upcoming').once('value', function(s) {
      s.forEach(function(c) {
        var m = c.val(); if (!m) return;
        var mid = c.key;
        // Already released or no room saved
        if (m.roomStatus === 'released' || !m.roomId || !m.roomPassword) return;
        if (m.status === 'cancelled' || m.status === 'completed') return;
        var relMin = Number(m.roomReleaseMinutes) || 5;
        var releaseAt = Number(m.matchTime) - (relMin * 60000);
        if (now >= releaseAt) {
          // Time to release!
          rtdb.ref('matches/' + mid).update({ roomStatus: 'released', roomReleasedAt: now });
          // Notify joined players
          rtdb.ref('joinRequests').orderByChild('matchId').equalTo(mid).once('value', function(js) {
            var notified = {};
            js.forEach(function(jc) {
              var d = jc.val(), uid = d.userId;
              if (!uid || notified[uid] || d.status === 'cancelled') return;
              notified[uid] = true;
              rtdb.ref('users/' + uid + '/notifications').push({
                type: 'room_released', matchId: mid, matchName: m.name || 'Match',
                title: '🔑 Room ID Released!',
                message: 'Room ID & Password released for "' + (m.name||'Match') + '". Tap to view!',
                faIcon: 'fa-key', timestamp: now, read: false, createdAt: now
              });
            });
          });
        }
      });
    });
  };
  // Run auto-release check every 60 seconds
  setInterval(function() { window._autoReleaseRooms && window._autoReleaseRooms(); }, 60000);
  setTimeout(function() { window._autoReleaseRooms && window._autoReleaseRooms(); }, 3000); // immediate check on load

  /* ─── FEATURE 31: MATCH RESULT PUBLISHER ─── */
  window.showResultPublisher = function (matchId, matchName) {
    /* Load joined players for this match from allJoinRequests */
    var joinedPlayers = [];
    var allJR = window.allJoinRequests || {};
    Object.keys(allJR).forEach(function(k) {
      var j = allJR[k];
      var tid = j.tournamentId || j.matchId;
      if (tid !== matchId) return;
      var st = j.status || '';
      if (st === 'rejected' || st === 'cancelled') return;
      joinedPlayers.push({
        uid: j.userId || j.uid || k.split('_')[0] || '',
        name: j.playerName || j.ign || j.userName || 'Player',
        ffUid: j.ffUid || j.gameUid || '—'
      });
    });

    /* Also get match prize distribution info */
    rtdb.ref('matches/' + matchId).once('value', function(ms) {
      var match = ms.val() || {};
      var prizePool = match.prizePool || 0;
      var prizes = match.prizes || {};
      /* Default prize distribution: 1st=50%, 2nd=30%, 3rd=20% of prizePool */
      var p1 = prizes.first || Math.round(prizePool * 0.5);
      var p2 = prizes.second || Math.round(prizePool * 0.3);
      var p3 = prizes.third || Math.round(prizePool * 0.2);

      var h = '<div>';
      h += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Match: <strong>' + matchName + '</strong> | Prize Pool: <strong style="color:var(--success)">₹' + prizePool + '</strong></div>';
      h += '<div style="font-size:11px;color:var(--info);margin-bottom:12px;padding:6px;background:rgba(0,212,255,.06);border-radius:8px">🏆 #1=₹' + p1 + ' | 🥈 #2=₹' + p2 + ' | 🥉 #3=₹' + p3 + ' (auto-calculated)</div>';
      
      if (joinedPlayers.length > 0) {
        h += '<div style="font-size:12px;font-weight:700;margin-bottom:8px">Joined Players (' + joinedPlayers.length + '):</div>';
        h += '<div id="resultEntries" style="display:flex;flex-direction:column;gap:6px">';
        /* Group players by team for duo/squad */
        var mode = (match.mode || match.type || 'solo').toLowerCase();
        var isTeam = (mode === 'duo' || mode === 'squad');
        
        /* Build team groups */
        var teamGroups = {};
        joinedPlayers.forEach(function(p) {
          var teamKey = p.teamId || p.captainUid || p.uid;
          if (!teamGroups[teamKey]) teamGroups[teamKey] = [];
          teamGroups[teamKey].push(p);
        });

        joinedPlayers.forEach(function(p, idx) {
          var teamKey = p.teamId || p.captainUid || p.uid;
          var isFirstInTeam = (teamGroups[teamKey] && teamGroups[teamKey][0] === p);
          var teamBorder = isTeam && !isFirstInTeam ? 'border-left:3px solid rgba(185,100,255,.4)' : '';
          h += '<div style="display:grid;grid-template-columns:1fr 60px 70px;gap:6px;align-items:center;padding:6px;background:var(--card-bg);border-radius:8px;border:1px solid var(--border);' + teamBorder + '">';
          h += '<div><div style="font-size:12px;font-weight:700">' + p.name + (isTeam && !isFirstInTeam ? ' <span style="font-size:9px;color:#b964ff">teammate</span>' : '') + '</div>';
          h += '<div style="font-size:10px;color:var(--primary);font-family:monospace">FF: ' + p.ffUid + '</div></div>';
          /* Rank input - for team members auto-fill from captain's rank */
          h += '<input type="number" placeholder="Rank" min="0" value="0" class="form-input res-pos" data-uid="' + p.uid + '" data-name="' + p.name + '" data-team="' + teamKey + '" style="font-size:12px;text-align:center;padding:4px" oninput="window._autoFillTeamRank(this)" title="Rank (0=not ranked)">';
          h += '<input type="number" placeholder="Kills" min="0" value="0" class="form-input res-kills" style="font-size:12px;text-align:center;padding:4px">';
          h += '</div>';
        });
        h += '</div>';
      } else {
        h += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">No joined players found. Add manually:</div>';
        h += '<div id="resultEntries" style="display:flex;flex-direction:column;gap:6px"></div>';
        h += '<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="window._addResultRow()"><i class="fas fa-plus"></i> Add Player</button>';
      }
      
      h += '<div style="margin-top:10px;padding:8px;background:rgba(255,215,0,.06);border-radius:8px;font-size:11px;color:var(--warning)"><i class="fas fa-info-circle"></i> Position 1/2/3 = winner, 0 = not ranked. Prize auto-paid to winners.</div>';
      h += '<button class="btn btn-primary w-full" style="margin-top:12px" onclick="window._publishResults(\'' + matchId + '\',\'' + matchName + '\',\'' + p1 + '\',\'' + p2 + '\',\'' + p3 + '\')"><i class="fas fa-trophy"></i> Publish & Auto-Pay</button>';
      h += '</div>';
      _modal('🏆 Publish Results — ' + matchName, h);
      /* Add empty row if no joined players */
      if (joinedPlayers.length === 0) {
        setTimeout(function() { window._addResultRow(); window._addResultRow(); window._addResultRow(); }, 100);
      }
    });
  };
  /* Auto-fill team rank - when one player rank entered, fill all teammates */
  window._autoFillTeamRank = function(input) {
    var teamKey = input.getAttribute('data-team');
    if (!teamKey) return;
    var rank = input.value;
    /* Find all inputs with same team key */
    document.querySelectorAll('.res-pos[data-team="' + teamKey + '"]').forEach(function(el) {
      if (el !== input && el.value == 0) el.value = rank;
    });
  };

  window._resultRowCount = 0;
  window._addResultRow = function () {
    var i = ++window._resultRowCount;
    var el = _$('resultEntries'); if (!el) return;
    var row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 60px 70px;gap:6px;align-items:center;padding:6px;background:var(--card-bg);border-radius:8px;border:1px solid var(--border)';
    row.innerHTML = '<input type="text" placeholder="Player IGN" class="form-input res-ign" style="font-size:12px">' +
      '<input type="number" placeholder="Pos" min="0" value="0" class="form-input res-pos" data-uid="" style="font-size:12px;text-align:center;padding:4px">' +
      '<input type="number" placeholder="Kills" min="0" value="0" class="form-input res-kills" style="font-size:12px;text-align:center;padding:4px">';
    el.appendChild(row);
  };
  window._publishResults = function (matchId, matchName, prize1, prize2, prize3) {
    var posInputs = document.querySelectorAll('.res-pos');
    var killInputs = document.querySelectorAll('.res-kills');
    var ignInputs = document.querySelectorAll('.res-ign');
    var results = [];
    posInputs.forEach(function(posEl, i) {
      var pos = Number(posEl.value) || 0;
      var kills = Number(killInputs[i] && killInputs[i].value) || 0;
      var uid = posEl.getAttribute('data-uid') || '';
      var name = posEl.getAttribute('data-name') || (ignInputs[i] ? ignInputs[i].value.trim() : '');
      if (!name && !uid) return;
      var prize = pos === 1 ? Number(prize1)||0 : pos === 2 ? Number(prize2)||0 : pos === 3 ? Number(prize3)||0 : 0;
      results.push({ rank: pos || 99, playerName: name, uid: uid, kills: kills, prize: prize });
    });
    if (!results.length) { _toast('Koi result nahi', true); return; }
    /* Get match mode for prize splitting */
    rtdb.ref('matches/' + matchId).once('value', function(matchSnap) {
      var matchData = matchSnap.val() || {};
      var mode = (matchData.mode || matchData.type || 'solo').toLowerCase();
      var teamSize = mode === 'duo' ? 2 : mode === 'squad' ? 4 : 1;

      /* For duo/squad: split rank prize among teammates who share same rank */
      /* Group by rank to find team members */
      var rankGroups = {};
      results.forEach(function(r) {
        if (!rankGroups[r.rank]) rankGroups[r.rank] = [];
        rankGroups[r.rank].push(r);
      });

      /* Adjust prize: split rank prize equally among same-rank players */
      results.forEach(function(r) {
        var sameRankPlayers = rankGroups[r.rank] || [r];
        var teamCount = Math.max(sameRankPlayers.length, 1);
        if (teamSize > 1 && teamCount > 1) {
          r.originalPrize = r.prize;
          r.prize = Math.floor(r.prize / teamCount);
          r.prizeNote = 'Team share (' + teamCount + ' members)';
        }
      });

      /* Write to matches/{id}/results - main path */
      var batch = {};
      results.forEach(function(r, i) { 
        if (r.uid) batch['matches/' + matchId + '/results/' + r.uid] = r;
        /* Also write to global results node for user panel */
        var rk = rtdb.ref('results').push().key;
        batch['results/' + rk] = {
          userId: r.uid, matchId: matchId, rank: r.rank,
          kills: r.kills, winnings: r.prize, totalWinning: r.prize, won: r.rank === 1,
          timestamp: Date.now(), createdAt: Date.now()
        };
      });
      rtdb.ref().update(batch);
      rtdb.ref('matches/' + matchId + '/status').set('resultPublished');

      /* Auto-pay winners */
      var paid = 0;
      results.forEach(function(r) {
        if (r.prize <= 0) return;
        var doPayByUid = function(uid) {
          if (!uid) return;
          /* Add winnings to realMoney.winnings */
          rtdb.ref('users/' + uid + '/realMoney/winnings').transaction(function(v) { return (v||0) + r.prize; });
          /* Track earnings in stats */
          rtdb.ref('users/' + uid + '/stats/earnings').transaction(function(v) { return (v||0) + r.prize; });
          /* TDS tracking */
          rtdb.ref('users/' + uid + '/tds/winningsCredited').transaction(function(v) { return (v||0) + r.prize; });
          if (r.rank === 1) rtdb.ref('users/' + uid + '/stats/wins').transaction(function(v) { return (v||0) + 1; });
          rtdb.ref('users/' + uid + '/stats/kills').transaction(function(v) { return (v||0) + r.kills; });
          /* Transaction record */
          rtdb.ref('users/' + uid + '/transactions').push({
            type: 'match_prize', amount: r.prize, matchId: matchId, matchName: matchName,
            rank: r.rank, kills: r.kills, timestamp: Date.now(), status: 'completed'
          });
          /* Notification */
          var prizeMsg = teamSize > 1
            ? 'Position #'+r.rank+' in '+matchName+'. Your share: 💎'+r.prize+'!'
            : 'Congratulations! Position #'+r.rank+' in '+matchName+'. 💎'+r.prize+' added to wallet!';
          rtdb.ref('users/' + uid + '/notifications').push({
            title: r.rank <= 3 ? '🏆 You Won 💎' + r.prize + '!' : '🎮 Match Result',
            message: r.rank <= 3 ? prizeMsg : 'Match '+matchName+' result published. Kills: '+r.kills,
            type: 'result', matchId: matchId, timestamp: Date.now(), read: false
          });
          paid++;
        };
        if (r.uid) { doPayByUid(r.uid); }
        else if (r.playerName) {
          rtdb.ref('users').orderByChild('ign').equalTo(r.playerName).once('value', function(s) {
            s.forEach(function(c) { doPayByUid(c.key); });
          });
        }
      });
      /* Log activity */
      if (window.logActivity) logActivity('publish_results', matchId, { count: results.length, matchName: matchName });
      _toast('✅ Results published! ' + results.filter(function(r){return r.prize>0;}).length + ' winners paid. Mode: ' + mode + (teamSize>1?' (Prize split '+teamSize+'-way)':''));
      _close();
    }); /* end rtdb.ref('matches').once */
  };

  /* ─── FEATURE 32: DISPUTE MANAGEMENT ─── */

  window.showDisputes = function () {
    rtdb.ref('disputes').orderByChild('status').equalTo('pending').once('value', function (s) {
      var disputes = [];
      if (s.exists()) s.forEach(function (c) { disputes.push(Object.assign({}, c.val(), { _key: c.key })); });
      var h = '<div>';
      if (!disputes.length) h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No pending disputes 🎉</p>';
      disputes.forEach(function (d) {
        h += '<div class="card" style="margin-bottom:8px"><div class="card-body compact">';
        h += '<div style="font-weight:700;font-size:13px">' + d.type + ' — ' + d.userName + '</div>';
        h += '<div class="text-xxs text-muted">Match: ' + (d.matchId || '—') + ' · Claimed Rank: ' + (d.claimedRank || '—') + '</div>';
        h += '<div style="font-size:12px;margin:6px 0">' + (d.message || '') + '</div>';
        h += '<div style="display:flex;gap:8px">';
        h += '<button class="btn btn-primary btn-xs flex-1" onclick="rtdb.ref(\'disputes/' + d._key + '\').update({status:\'resolved\'});showToast(\'Resolved\');window.showDisputes();">✅ Resolve</button>';
        h += '<button class="btn btn-ghost btn-xs flex-1" onclick="rtdb.ref(\'disputes/' + d._key + '\').update({status:\'rejected\'});showToast(\'Rejected\');window.showDisputes();">❌ Reject</button>';
        h += '</div></div></div>';
      });
      h += '</div>';
      _modal('⚠️ Disputes (' + disputes.length + ')', h);
    });
  };

  /* ─── FEATURE 33: LIVE USER COUNT ─── */
  window.showLiveUserCount = function () {
    rtdb.ref('presence').once('value', function (s) {
      var online = 0;
      if (s.exists()) s.forEach(function (c) { if (c.val() === true || (c.val() && c.val().online)) online++; });
      _toast('👥 Currently Online: ' + online + ' users', 'inf');
    });
  };

  /* ─── FEATURE 34: MATCH ANALYTICS (Per Match Stats) ─── */
  window.showMatchAnalytics = function (matchId, matchName) {
    rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value', function (s) {
      var total = 0, captains = 0, members = 0, modes = {};
      if (s.exists()) s.forEach(function (c) {
        var d = c.val(); total++;
        if (d.isTeamMember) members++;
        else captains++;
        modes[d.mode || 'solo'] = (modes[d.mode || 'solo'] || 0) + 1;
      });
      var h = '<div>';
      h += '<div style="font-size:14px;font-weight:700;margin-bottom:12px">' + matchName + '</div>';
      h += '<div class="stats-grid">';
      [['Total Players', total], ['Captains', captains], ['Team Members', members]].forEach(function (d) {
        h += '<div class="stat-card"><div class="value">' + d[1] + '</div><div class="label">' + d[0] + '</div></div>';
      });
      h += '</div>';
      if (Object.keys(modes).length) {
        h += '<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;margin-bottom:8px">Mode Breakdown:</div>';
        Object.entries(modes).forEach(function (e) {
          h += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><span>' + e[0].toUpperCase() + '</span><strong>' + e[1] + '</strong></div>';
        });
        h += '</div>';
      }
      h += '</div>';
      _modal('📊 Match Analytics', h);
    });
  };

  /* ─── FEATURE 35: VOUCHER MANAGER ─── */
  window.showVoucherManager = function () {
    rtdb.ref('vouchers').once('value', function (s) {
      var h = '<div>';
      h += '<div class="form-group"><label>New Voucher Code</label><input type="text" id="vcCode" class="form-input" placeholder="e.g. WELCOME50" style="text-transform:uppercase"></div>';
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
      h += '<div class="form-group"><label>Type</label><select id="vcType" class="form-input"><option value="coins">Coins</option><option value="money">Cash Bonus</option></select></div>';
      h += '<div class="form-group"><label>Amount</label><input type="number" id="vcAmt" class="form-input" placeholder="Amount"></div>';
      h += '</div>';
      h += '<div class="form-group"><label>Max Uses</label><input type="number" id="vcMax" class="form-input" placeholder="0 = unlimited"></div>';
      h += '<button class="btn btn-primary w-full" onclick="window._createVoucher()" style="margin-bottom:14px"><i class="fas fa-plus"></i> Create Voucher</button>';
      if (s.exists()) {
        h += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">Active Vouchers:</div>';
        h += '<table><thead><tr><th>Code</th><th>Reward</th><th>Uses</th><th>Action</th></tr></thead><tbody>';
        s.forEach(function (c) {
          var v = c.val();
          h += '<tr><td class="font-mono font-bold">' + c.key + '</td>';
          h += '<td>' + (v.rewardType || 'coins') + ' ' + (v.rewardAmount || 0) + '</td>';
          h += '<td>' + (v.usedCount || 0) + '/' + (v.maxUses || '∞') + '</td>';
          h += '<td><button class="btn btn-danger btn-xs" onclick="rtdb.ref(\'vouchers/' + c.key + '\').update({status:\'inactive\'});showVoucherManager();">Disable</button></td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '</div>';
      _modal('🎟️ Voucher Manager', h);
    });
  };
  window._createVoucher = function () {
    var code = ((_$('vcCode') || {}).value || '').toUpperCase().trim();
    var type = (_$('vcType') || {}).value;
    var amt = Number((_$('vcAmt') || {}).value) || 0;
    var maxUses = Number((_$('vcMax') || {}).value) || 0;
    if (!code || !amt) { _toast('Fill all fields', true); return; }
    rtdb.ref('vouchers/' + code).set({ rewardType: type, rewardAmount: amt, maxUses: maxUses || null, usedCount: 0, status: 'active', createdAt: Date.now() });
    _logAction('create_voucher', code, { type: type, amount: amt });
    _toast('✅ Voucher created: ' + code);
    window.showVoucherManager();
  };

  /* ─── FEATURE 36: ANNOUNCEMENT BANNER MANAGER ─── */
  window.showBannerManager = function () {
    rtdb.ref('appSettings/banner').once('value', function (s) {
      var b = s.val() || {};
      var h = '<div>';
      h += '<div class="form-group"><label>Banner Text</label><input type="text" id="bnText" class="form-input" value="' + (b.text || '') + '" placeholder="Announcement text..."></div>';
      h += '<div class="form-group"><label>Background Color</label><input type="color" id="bnColor" value="' + (b.color || '#00ff9c22') + '" class="form-input"></div>';
      h += '<div style="display:flex;gap:8px">';
      h += '<button class="btn btn-primary flex-1" onclick="window._saveBanner()"><i class="fas fa-save"></i> Save</button>';
      h += '<button class="btn btn-danger flex-1" onclick="rtdb.ref(\'appSettings/banner\').remove();showToast(\'Banner removed\');closeModal()"><i class="fas fa-times"></i> Remove</button>';
      h += '</div></div>';
      _modal('📢 Banner Manager', h);
    });
  };
  window._saveBanner = function () {
    rtdb.ref('appSettings/banner').set({
      text: (_$('bnText') || {}).value,
      color: (_$('bnColor') || {}).value,
      textColor: '#ffffff'
    });
    _toast('✅ Banner saved!');
    _close();
  };

  /* ─── FEATURE 37: TICKER / SCROLLING TEXT MANAGER ─── */
  window.showTickerManager = function () {
    rtdb.ref('appSettings/ticker').once('value', function (s) {
      var h = '<div>';
      h += '<div class="form-group"><label>Ticker Text (scrolls on home screen)</label><input type="text" id="tkText" class="form-input" value="' + (s.val() || '') + '" placeholder="e.g. 🎮 New tournaments every day!"></div>';
      h += '<button class="btn btn-primary w-full" onclick="rtdb.ref(\'appSettings/ticker\').set(document.getElementById(\'tkText\').value);showToast(\'✅ Ticker updated!\');closeModal()"><i class="fas fa-save"></i> Save Ticker</button>';
      h += '</div>';
      _modal('📜 Ticker Manager', h);
    });
  };

  /* ─── FEATURE 38: USER BAN / UNBAN MANAGER ─── */
  window.banUser = function (uid, name, reason) {
    var h = '<div>';
    h += '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Ban <strong>' + name + '</strong>?</div>';
    h += '<div class="form-group"><label>Ban Reason</label><input type="text" id="banReason" class="form-input" value="' + (reason || '') + '" placeholder="Reason..."></div>';
    h += '<div class="form-group"><label>Duration</label><select id="banDur" class="form-input"><option value="1">1 Day</option><option value="7">7 Days</option><option value="30">30 Days</option><option value="0">Permanent</option></select></div>';
    h += '<button class="btn btn-danger w-full" onclick="window._doBan(\'' + uid + '\',\'' + name + '\')">🚫 Ban User</button>';
    h += '</div>';
    _modal('🚫 Ban User', h);
  };
  window._doBan = function (uid, name) {
    var reason = (_$('banReason') || {}).value || 'Policy violation';
    var dur = Number((_$('banDur') || {}).value);
    var until = dur > 0 ? Date.now() + dur * 86400000 : 0;
    rtdb.ref('users/' + uid).update({ banned: true, bannedReason: reason, bannedUntil: until });
    rtdb.ref('users/' + uid + '/notifications').push().then(function (ref) {
      ref.set({ type: 'ban', title: '🚫 Account Banned', body: 'Reason: ' + reason + (until ? ' | Until: ' + new Date(until).toLocaleDateString() : ' | Permanent'), read: false, createdAt: Date.now() });
    });
    _logAction('ban', uid, { name: name, reason: reason, duration: dur });
    _toast('✅ User banned: ' + name);
    _close();
  };
  window.unbanUser = function (uid, name) {
    rtdb.ref('users/' + uid + '/banned').set(false);
    rtdb.ref('users/' + uid + '/bannedReason').remove();
    rtdb.ref('users/' + uid + '/bannedUntil').remove();
    _logAction('unban', uid, { name: name });
    _toast('✅ User unbanned: ' + name);
  };

  /* ─── FEATURE 39: PROFILE APPROVAL BULK ─── */
  window.showPendingProfiles = function () {
    rtdb.ref('profileRequests').orderByChild('status').equalTo('pending').once('value', function (s) {
      var reqs = [];
      if (s.exists()) s.forEach(function (c) { reqs.push(Object.assign({}, c.val(), { _key: c.key })); });
      var h = '<div>';
      if (!reqs.length) h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No pending profiles ✅</p>';
      reqs.forEach(function (r) {
        h += '<div class="card" style="margin-bottom:8px"><div class="card-body compact">';
        h += '<div style="display:flex;justify-content:space-between">';
        h += '<div><div style="font-weight:700;font-size:13px">' + (r.requestedIgn || r.ign || '?') + '</div>';
        h += '<div class="text-xxs text-muted">UID: ' + (r.requestedUid || r.ffUid || '?') + '</div>';
        h += '<div class="text-xxs text-muted">' + (r.displayName || '') + ' · ' + (r.type || 'verification') + '</div></div>';
        h += '<div style="display:flex;gap:4px">';
        h += '<button class="btn btn-primary btn-xs" onclick="window.approveProfile(\'' + r._key + '\',\'' + r.uid + '\',\'' + (r.requestedIgn || r.ign) + '\',\'' + (r.requestedUid || r.ffUid) + '\')">✅</button>';
        h += '<button class="btn btn-danger btn-xs" onclick="window.rejectProfile(\'' + r._key + '\',\'' + r.uid + '\')">❌</button>';
        h += '</div></div></div></div>';
      });
      h += '</div>';
      _modal('👤 Pending Profiles (' + reqs.length + ')', h);
    });
  };
  window.approveProfile = function (reqKey, uid, ign, ffUid) {
    rtdb.ref('profileRequests/' + reqKey).update({ status: 'approved', approvedAt: Date.now() });
    rtdb.ref('users/' + uid).update({ ign: ign, ffUid: ffUid, profileStatus: 'approved', profileRequired: null, pendingIgn: null, pendingUid: null });
    var nid = rtdb.ref('users/' + uid + '/notifications').push().key;
    rtdb.ref('users/' + uid + '/notifications/' + nid).set({ type: 'profile_approved', title: '✅ Profile Approved!', body: 'IGN: ' + ign + ' approved. Full access unlocked!', read: false, createdAt: Date.now() });
    _logAction('approve_profile', uid, { ign: ign });
    _toast('✅ Profile approved: ' + ign);
    window.showPendingProfiles();
  };
  window.rejectProfile = function (reqKey, uid) {
    rtdb.ref('profileRequests/' + reqKey).update({ status: 'rejected', rejectedAt: Date.now() });
    rtdb.ref('users/' + uid).update({ profileStatus: 'not_requested', profileRequired: null });
    _logAction('reject_profile', uid);
    _toast('Profile rejected');
    window.showPendingProfiles();
  };

  /* ─── FEATURE 40: MATCH RESULT HISTORY ─── */
  window.showResultHistory = function () {
    rtdb.ref('matchResults').limitToLast(10).once('value', function (s) {
      var h = '<div>';
      if (!s.exists()) { h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No results published yet</p></div>'; _modal('📋 Result History', h); return; }
      s.forEach(function (c) {
        var results = [];
        c.forEach(function (r) { results.push(r.val()); });
        results.sort(function (a, b) { return (a.rank || 99) - (b.rank || 99); });
        h += '<div class="card" style="margin-bottom:8px"><div class="card-header" style="font-size:12px">Match: ' + c.key.substring(0, 20) + '</div><div class="card-body compact">';
        results.slice(0, 3).forEach(function (r) {
          h += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0">';
          h += '<span>#' + r.rank + ' ' + r.playerName + '</span><span class="text-primary">₹' + r.prize + '</span></div>';
        });
        h += '</div></div>';
      });
      h += '</div>';
      _modal('📋 Result History', h);
    });
  };

  /* ─── FEATURE 41: KILL PROOF VIEWER ─── */
  window.showKillProofs = function () {
    rtdb.ref('killProofs').once('value', function (s) {
      var proofs = [];
      if (s.exists()) s.forEach(function (userNode) {
        userNode.forEach(function (matchNode) {
          proofs.push(Object.assign({}, matchNode.val(), { _uid: userNode.key, _mid: matchNode.key }));
        });
      });
      proofs = proofs.filter(function (p) { return p.status === 'pending'; });
      var h = '<div>';
      if (!proofs.length) h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No pending kill proofs</p>';
      proofs.forEach(function (p) {
        h += '<div class="card" style="margin-bottom:8px"><div class="card-body compact">';
        h += '<div style="font-weight:700;font-size:13px">' + (p.userName || 'Player') + '</div>';
        h += '<div class="text-xxs text-muted">Match: ' + p.matchId + '</div>';
        if (p.screenshot) h += '<img src="' + p.screenshot + '" style="width:100%;border-radius:8px;margin-top:8px;max-height:150px;object-fit:cover">';
        h += '<div style="display:flex;gap:8px;margin-top:8px">';
        h += '<button class="btn btn-primary btn-xs flex-1" onclick="rtdb.ref(\'killProofs/' + p._uid + '/' + p._mid + '/status\').set(\'approved\');showToast(\'Kill proof approved\');window.showKillProofs();">✅ Approve</button>';
        h += '<button class="btn btn-danger btn-xs flex-1" onclick="rtdb.ref(\'killProofs/' + p._uid + '/' + p._mid + '/status\').set(\'rejected\');showToast(\'Rejected\');window.showKillProofs();">❌ Reject</button>';
        h += '</div></div></div>';
      });
      h += '</div>';
      _modal('📸 Kill Proofs (' + proofs.length + ')', h);
    });
  };

  /* ─── FEATURE 42: ADMIN NOTES VIEWER (All Players) ─── */
  window.showAllNotes = function () {
    rtdb.ref('adminNotes').limitToLast(50).once('value', function (s) {
      var h = '<div>';
      if (!s.exists()) { h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No notes yet</p></div>'; _modal('📝 All Player Notes', h); return; }
      s.forEach(function (userNode) {
        var uid = userNode.key;
        h += '<div style="padding:8px;border-radius:10px;background:var(--bg-card);border:1px solid var(--border);margin-bottom:8px">';
        h += '<div class="font-mono text-xxs text-muted" style="margin-bottom:6px">' + uid.substring(0, 20) + '</div>';
        userNode.forEach(function (c) {
          var n = c.val();
          h += '<div style="padding:4px 8px;border-radius:6px;background:var(--bg-dark);font-size:11px;margin-bottom:3px"><span class="badge ' + (n.tag || 'yellow') + ' text-xxs">' + n.tag + '</span> ' + n.note + '</div>';
        });
        h += '</div>';
      });
      h += '</div>';
      _modal('📝 All Player Notes', h);
    });
  };

  /* ─── FEATURE 43: TEAM JOIN HEALTH CHECK ─── */
  window.runTeamJoinHealthCheck = function () {
    rtdb.ref('joinRequests').once('value', function (s) {
      var captains = {}, members = {};
      if (s.exists()) s.forEach(function (c) {
        var d = c.val();
        if (!d.matchId) return;
        var key = d.userId + '_' + d.matchId;
        if (d.isTeamMember) members[key] = d;
        else if (d.mode !== 'solo') captains[key] = d;
      });
      var issues = [];
      Object.entries(captains).forEach(function (e) {
        var captain = e[1];
        if (captain.mode === 'solo' || !captain.teamMembers) return;
        captain.teamMembers.forEach(function (m) {
          if (m.role === 'captain') return;
          var memberKey = m._fbUid + '_' + captain.matchId;
          if (!members[memberKey]) {
            issues.push({ captain: captain.userName, member: m.name, matchId: captain.matchId });
          }
        });
      });
      var h = '<div>';
      h += '<div style="padding:10px;background:' + (issues.length ? 'rgba(255,107,107,.1)' : 'rgba(0,255,106,.1)') + ';border-radius:10px;margin-bottom:12px;font-size:13px">';
      h += (issues.length ? '⚠️ ' + issues.length + ' missing teammate join(s) found!' : '✅ All team joins healthy!') + '</div>';
      if (issues.length) {
        h += '<table><thead><tr><th>Captain</th><th>Missing Member</th><th>Match</th></tr></thead><tbody>';
        issues.forEach(function (i) {
          h += '<tr><td>' + i.captain + '</td><td class="text-primary">' + i.member + '</td><td class="text-xxs font-mono">' + i.matchId.substring(0, 12) + '</td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '</div>';
      _modal('🔍 Team Join Health Check', h);
    });
  };

  /* ─── FEATURE 44: SEASON MANAGER ─── */
  window.showSeasonManager = function () {
    rtdb.ref('season').once('value', function (s) {
      var season = s.val() || { name: 'Season 1', endDate: null };
      var h = '<div>';
      h += '<div class="form-group"><label>Season Name</label><input type="text" id="snName" class="form-input" value="' + (season.name || '') + '"></div>';
      h += '<div class="form-group"><label>End Date</label><input type="date" id="snEnd" class="form-input" value="' + (season.endDate ? new Date(season.endDate).toISOString().slice(0, 10) : '') + '"></div>';
      h += '<div class="form-group"><label>Prize Pool (₹)</label><input type="number" id="snPrize" class="form-input" value="' + (season.prizePool || 0) + '"></div>';
      h += '<button class="btn btn-primary w-full" onclick="window._saveSeason()"><i class="fas fa-save"></i> Save Season</button>';
      h += '</div>';
      _modal('🏆 Season Manager', h);
    });
  };
  window._saveSeason = function () {
    var end = (_$('snEnd') || {}).value;
    rtdb.ref('season').set({
      name: (_$('snName') || {}).value,
      endDate: end ? new Date(end).getTime() : null,
      prizePool: Number((_$('snPrize') || {}).value) || 0,
      updatedAt: Date.now()
    });
    _toast('✅ Season updated!');
    _close();
  };

  /* ─── FEATURE 45: ADMIN QUICK STATS CARD ─── */
  window.renderAdminQuickStats = function (containerId) {
    var el = _$(containerId); if (!el) return;
    Promise.all([
      rtdb.ref('walletRequests').orderByChild('status').equalTo('pending').once('value'),
      rtdb.ref('profileRequests').orderByChild('status').equalTo('pending').once('value'),
      rtdb.ref('supportRequests').orderByChild('status').equalTo('open').once('value'),
      rtdb.ref('disputes').orderByChild('status').equalTo('pending').once('value'),
      rtdb.ref('banAppeals').orderByChild('status').equalTo('pending').once('value'),
    ]).then(function (r) {
      var counts = r.map(function (s) { var c = 0; if (s.exists()) s.forEach(function () { c++; }); return c; });
      var items = [
        { label: 'Wallet Pending', count: counts[0], icon: 'fas fa-wallet', action: 'showPendingWallet()', color: counts[0] > 0 ? '#ffd700' : 'var(--text-muted)' },
        { label: 'Profile Approvals', count: counts[1], icon: 'fas fa-user-check', action: 'showPendingProfiles()', color: counts[1] > 0 ? '#4d96ff' : 'var(--text-muted)' },
        { label: 'Support Tickets', count: counts[2], icon: 'fas fa-ticket-alt', action: 'loadSupportTickets()', color: counts[2] > 0 ? '#ff6b6b' : 'var(--text-muted)' },
        { label: 'Disputes', count: counts[3], icon: 'fas fa-exclamation-triangle', action: 'showDisputes()', color: counts[3] > 0 ? '#ff6b6b' : 'var(--text-muted)' },
        { label: 'Ban Appeals', count: counts[4], icon: 'fas fa-gavel', action: 'showBanAppeals()', color: counts[4] > 0 ? '#b964ff' : 'var(--text-muted)' },
      ];
      el.innerHTML = '<div class="stats-grid">' + items.map(function (item) {
        return '<div class="stat-card" onclick="' + item.action + '" style="cursor:pointer">' +
          '<div class="stat-icon"><i class="' + item.icon + '"></i></div>' +
          '<div class="value" style="color:' + item.color + '">' + item.count + '</div>' +
          '<div class="label">' + item.label + '</div></div>';
      }).join('') + '</div>';
    });
  };

  /* ─── FEATURE 46: MATCH FEEDBACK VIEWER ─── */
  window.showMatchFeedbacks = function () {
    rtdb.ref('matchFeedback').limitToLast(5).once('value', function (s) {
      var h = '<div>';
      if (!s.exists()) { h += '<p class="text-muted text-xs" style="text-align:center;padding:20px">No feedback yet</p></div>'; _modal('⭐ Match Feedback', h); return; }
      s.forEach(function (matchNode) {
        var matchId = matchNode.key;
        var ratings = [], total = 0, count = 0;
        matchNode.forEach(function (c) { var f = c.val(); total += (f.rating || 0); count++; });
        var avg = count > 0 ? (total / count).toFixed(1) : 0;
        h += '<div class="card" style="margin-bottom:8px"><div class="card-body compact">';
        h += '<div style="display:flex;justify-content:space-between"><div class="text-xxs font-mono">' + matchId.substring(0, 20) + '</div><div style="font-weight:700">⭐ ' + avg + ' (' + count + ' ratings)</div></div>';
        matchNode.forEach(function (c) {
          var f = c.val();
          if (f.text) h += '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">"' + f.text.substring(0, 60) + '"</div>';
        });
        h += '</div></div>';
      });
      h += '</div>';
      _modal('⭐ Match Feedback', h);
    });
  };

  /* ─── FEATURE 47: APP SETTINGS MANAGER ─── */
  window.showAppSettings = function () {
    rtdb.ref('appSettings').once('value', function (s) {
      var cfg = s.val() || {};
      var h = '<div>';
      h += '<div class="form-group"><label>Support Online Status</label><select id="asSupport" class="form-input"><option value="1"' + (cfg.supportOnline ? ' selected' : '') + '>Online 🟢</option><option value="0"' + (!cfg.supportOnline ? ' selected' : '') + '>Offline 🔴</option></select></div>';
      h += '<div class="form-group"><label>Maintenance Mode</label><select id="asMaintenance" class="form-input"><option value="0">Off</option><option value="1"' + (cfg.maintenance ? ' selected' : '') + '>On ⚠️</option></select></div>';
      h += '<div class="form-group"><label>Min App Version</label><input type="text" id="asVersion" class="form-input" value="' + (cfg.minVersion || '') + '" placeholder="e.g. 1.0"></div>';
      h += '<button class="btn btn-primary w-full" onclick="window._saveAppSettings()"><i class="fas fa-save"></i> Save Settings</button>';
      h += '</div>';
      _modal('⚙️ App Settings', h);
    });
  };
  window._saveAppSettings = function () {
    rtdb.ref('appSettings').update({
      supportOnline: (_$('asSupport') || {}).value === '1',
      maintenance: (_$('asMaintenance') || {}).value === '1',
      minVersion: (_$('asVersion') || {}).value
    });
    _logAction('update_app_settings');
    _toast('✅ App settings saved!');
    _close();
  };

  /* ─── FEATURE 48: PLAYER FULL PROFILE MODAL ─── */
  window.openUserModal = function (uid) {
    rtdb.ref('users/' + uid).once('value', function (s) {
      if (!s.exists()) { _toast('User not found', true); return; }
      var u = s.val(), st = u.stats || {}, rm = u.realMoney || {};
      var h = '<div>';
      h += '<div style="text-align:center;padding:16px 0;border-bottom:1px solid var(--border);margin-bottom:14px">';
      h += '<div style="width:60px;height:60px;border-radius:50%;background:rgba(0,255,156,.1);color:var(--primary);font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;margin:0 auto 8px">' + (u.ign || u.displayName || '?').charAt(0).toUpperCase() + '</div>';
      h += '<div style="font-size:18px;font-weight:900">' + (u.ign || u.displayName || 'User') + '</div>';
      h += '<div class="text-muted text-xxs">' + (u.email || '') + '</div>';
      h += '<div class="text-xxs font-mono" style="margin-top:4px">' + uid + '</div>';
      h += '</div>';
      h += '<table><tbody>';
      h += '<tr><td>FF UID</td><td class="font-mono">' + (u.ffUid || '—') + '</td></tr>';
      h += '<tr><td>Status</td><td><span class="badge ' + (u.profileStatus === 'approved' ? 'green' : 'yellow') + '">' + (u.profileStatus || 'unknown') + '</span></td></tr>';
      h += '<tr><td>Matches</td><td>' + (st.matches || 0) + '</td></tr>';
      h += '<tr><td>Wins</td><td>' + (st.wins || 0) + '</td></tr>';
      h += '<tr><td>Kills</td><td>' + (st.kills || 0) + '</td></tr>';
      h += '<tr><td>Earnings</td><td class="text-primary">₹' + (st.earnings || 0) + '</td></tr>';
      h += '<tr><td>Deposited</td><td>₹' + (rm.deposited || 0) + '</td></tr>';
      h += '<tr><td>Winnings</td><td>₹' + (rm.winnings || 0) + '</td></tr>';
      h += '<tr><td>Banned</td><td>' + (u.banned ? '🚫 Yes' : '✅ No') + '</td></tr>';
      h += '</tbody></table>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:14px">';
      h += '<button class="btn btn-ghost btn-xs" onclick="window.addToWatchlist(\'' + uid + '\',\'' + (u.ign || '') + '\')"><i class="fas fa-eye"></i> Watch</button>';
      h += '<button class="btn btn-ghost btn-xs" onclick="window.showAddNote(\'' + uid + '\',\'' + (u.ign || '') + '\')"><i class="fas fa-sticky-note"></i> Note</button>';
      if (!u.banned) h += '<button class="btn btn-danger btn-xs" onclick="window.banUser(\'' + uid + '\',\'' + (u.ign || '') + '\')"><i class="fas fa-ban"></i> Ban</button>';
      else h += '<button class="btn btn-primary btn-xs" onclick="window.unbanUser(\'' + uid + '\',\'' + (u.ign || '') + '\')"><i class="fas fa-user-check"></i> Unban</button>';
      h += '</div></div>';
      _modal('👤 Player Profile', h);
    });
  };

  /* ─── FEATURE 49: MATCH CREATE QUICK FORM ─── */
  window.showQuickMatchCreate = function () {
    var h = '<div>';
    h += '<div class="form-group"><label>Match Name</label><input type="text" id="qmName" class="form-input" placeholder="e.g. Daily Solo #1"></div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    h += '<div class="form-group"><label>Mode</label><select id="qmMode" class="form-input"><option value="solo">Solo</option><option value="duo">Duo</option><option value="squad">Squad</option></select></div>';
    h += '<div class="form-group"><label>Max Slots</label><input type="number" id="qmSlots" class="form-input" placeholder="25" value="25"></div>';
    h += '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    h += '<div class="form-group"><label>Entry Fee (₹)</label><input type="number" id="qmFee" class="form-input" placeholder="10" value="10"></div>';
    h += '<div class="form-group"><label>Prize Pool (₹)</label><input type="number" id="qmPrize" class="form-input" placeholder="100"></div>';
    h += '</div>';
    h += '<div class="form-group"><label>Match Time</label><input type="datetime-local" id="qmTime" class="form-input"></div>';
    h += '<div class="form-group"><label>Map</label><select id="qmMap" class="form-input"><option value="bermuda">Bermuda</option><option value="purgatory">Purgatory</option><option value="kalahari">Kalahari</option><option value="alpine">Alpine</option></select></div>';
    h += '<button class="btn btn-primary w-full" onclick="window._createQuickMatch()"><i class="fas fa-plus"></i> Create Match</button>';
    h += '</div>';
    _modal('🎮 Quick Match Create', h);
  };
  window._createQuickMatch = function () {
    var name = (_$('qmName') || {}).value;
    var time = (_$('qmTime') || {}).value;
    if (!name || !time) { _toast('Name and time required', true); return; }
    var matchData = {
      name: name, mode: (_$('qmMode') || {}).value, matchType: 'Battle Royale',
      maxSlots: Number((_$('qmSlots') || {}).value) || 25,
      entryFee: Number((_$('qmFee') || {}).value) || 0,
      prizePool: Number((_$('qmPrize') || {}).value) || 0,
      matchTime: new Date(time).getTime(),
      map: (_$('qmMap') || {}).value,
      joinedSlots: 0, filledSlots: 0, status: 'upcoming',
      createdAt: Date.now()
    };
    var id = rtdb.ref('matches').push().key;
    rtdb.ref('matches/' + id).set(Object.assign({}, matchData, { id: id }));
    _logAction('create_match', id, { name: name });
    _toast('✅ Match created: ' + name);
    _close();
  };

  /* ─── FEATURE 50: ADMIN DASHBOARD INIT ─── */
  window.initAdminDashboard = function () {
    // Auto-load all dashboard widgets
    setTimeout(function () {
      if (window.renderPlatformStats) renderPlatformStats('dashStatCards');
      if (window.renderAdminQuickStats) renderAdminQuickStats('adminQuickStatsGrid');
      if (window.renderRevenueAnalytics) renderRevenueAnalytics();
      if (window.renderUserGrowth) renderUserGrowth();
      if (window.renderTopPerformers) renderTopPerformers();
      if (window.renderMatchReport) renderMatchReport();
      if (window.renderReferralAnalytics) renderReferralAnalytics();
    }, 500);

    // Auto-refresh every 2 minutes
    setInterval(function () {
      if (window.renderAdminQuickStats) renderAdminQuickStats('adminQuickStatsGrid');
    }, 120000);

    console.log('[Mini eSports Admin] ✅ Dashboard initialized');
  };

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(window.initAdminDashboard, 1000);
  });

  console.log('[Mini eSports Admin] ✅ 50 Admin Features v9 loaded');
})();
