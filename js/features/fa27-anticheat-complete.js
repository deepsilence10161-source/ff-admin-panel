/* ADMIN: Anti-Fraud Complete System
   - Cheat Reports Dashboard
   - Admin Fraud Heatmap
   - Trusted Player Tag management
   - Refund Queue (room not opened)
   - Suspicious Kill Review
   - Kill Pattern Anomaly Detection
   - Prize Dispute Queue
   - Match Integrity Monitor
*/
(function(){
'use strict';

var rt = function() { return window.rtdb || window.db; };
function _modal(title, html) {
  if (window.showAdminModal) showAdminModal(title, html);
  else if (window.showModal) showModal(title, html);
}
function _toast(msg) { if (window.showToast) showToast(msg); }

/* ══ CHEAT REPORTS DASHBOARD ══ */
window.showCheatReports = function() {
  var db = rt(); if (!db) return;
  db.ref('cheatReports').orderByChild('status').equalTo('pending').limitToLast(50).once('value', function(s) {
    var reports = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; reports.push(d); });

    // Group by target UID — same UID reported multiple times = higher priority
    var grouped = {};
    reports.forEach(function(r) {
      var key = r.targetFfUid || 'unknown';
      if (!grouped[key]) grouped[key] = { ffUid: key, reports: [], types: {} };
      grouped[key].reports.push(r);
      grouped[key].types[r.cheatType] = (grouped[key].types[r.cheatType] || 0) + 1;
    });

    var groups = Object.values(grouped).sort(function(a,b) { return b.reports.length - a.reports.length; });

    var h = '<div>';
    if (!groups.length) { h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi pending cheat reports nahi</div>'; }

    groups.forEach(function(g) {
      var count = g.reports.length;
      var borderColor = count >= 3 ? 'rgba(255,68,68,.3)' : 'rgba(255,170,0,.2)';
      var labelColor = count >= 3 ? '#ff4444' : '#ffaa00';
      var typeStr = Object.keys(g.types).map(function(t) { return t.replace(/_/g,' ') + ' x' + g.types[t]; }).join(', ');
      var latestReport = g.reports[g.reports.length-1];
      var matchId = latestReport.matchId || '';

      h += '<div style="background:rgba(255,255,255,.04);border:1px solid ' + borderColor + ';border-radius:12px;padding:12px;margin-bottom:10px">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      h += '<div><div style="font-size:13px;font-weight:700">FF UID: <span style="font-family:monospace;color:#00d4ff">' + g.ffUid + '</span></div>';
      h += '<div style="font-size:10px;color:#aaa;margin-top:2px">' + typeStr + '</div></div>';
      h += '<span style="background:rgba(0,0,0,.3);padding:3px 9px;border-radius:10px;font-size:12px;font-weight:800;color:' + labelColor + '">' + count + ' Reports</span>';
      h += '</div>';
      if (matchId) h += '<div style="font-size:10px;color:#666;margin-bottom:8px">Match: ' + matchId + '</div>';
      h += '<div style="display:flex;gap:6px">';
      h += '<button onclick="resolveCheatReport(\'' + g.reports.map(function(r){return r._key;}).join(',') + '\',\'warn\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,170,0,.1);border:1px solid rgba(255,170,0,.25);color:#ffaa00;font-size:11px;font-weight:700;cursor:pointer">⚠️ Warn</button>';
      h += '<button onclick="resolveCheatReport(\'' + g.reports.map(function(r){return r._key;}).join(',') + '\',\'ban\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.25);color:#ff4444;font-size:11px;font-weight:700;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="resolveCheatReport(\'' + g.reports.map(function(r){return r._key;}).join(',') + '\',\'dismiss\')" style="padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#aaa;font-size:11px;cursor:pointer">Dismiss</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal('🚨 Cheat Reports (' + groups.length + ')', h);
  });
};

window.resolveCheatReport = function(keysStr, action) {
  var db = rt(); if (!db) return;
  var keys = keysStr.split(',');
  keys.forEach(function(key) {
    db.ref('cheatReports/' + key).update({ status: action, resolvedAt: Date.now() });
  });
  if (action === 'ban') {
    // Get UID from first report and ban
    db.ref('cheatReports/' + keys[0]).once('value', function(s) {
      // Look up user by FF UID
      var r = s.val();
      if (!r) return;
      db.ref('users').orderByChild('ffUid').equalTo(r.targetFfUid).once('value', function(us) {
        if (!us.exists()) { _toast('User not found for UID: ' + r.targetFfUid); return; }
        us.forEach(function(c) {
          db.ref('users/' + c.key + '/banned').set({ banned: true, reason: 'Cheat report - ' + (r.cheatType||'unknown'), bannedAt: Date.now(), bannedBy: 'admin' });
          _toast('🚫 User banned: ' + r.targetFfUid);
        });
      });
    });
  } else {
    _toast(action === 'warn' ? '⚠️ Warning logged' : '✅ Dismissed');
  }
  setTimeout(window.showCheatReports, 300);
};

/* ══ ADMIN FRAUD HEATMAP ══ */
window.showFraudHeatmap = function() {
  var db = rt(); if (!db) return;

  Promise.all([
    db.ref('adminAlerts').orderByChild('timestamp').limitToLast(200).once('value'),
    db.ref('cheatReports').orderByChild('timestamp').limitToLast(200).once('value')
  ]).then(function(results) {
    var alertSnap = results[0], reportSnap = results[1];

    // Count by day of week and hour of day
    var dayHeatmap = [0,0,0,0,0,0,0]; // Sun-Sat
    var hourHeatmap = new Array(24).fill(0);
    var typeCount = {};

    [alertSnap, reportSnap].forEach(function(snap) {
      if (!snap.exists()) return;
      snap.forEach(function(c) {
        var d = c.val();
        var ts = Number(d.timestamp || d.createdAt) || 0;
        if (!ts) return;
        var date = new Date(ts);
        dayHeatmap[date.getDay()]++;
        hourHeatmap[date.getHours()]++;
        var type = d.type || d.cheatType || 'unknown';
        typeCount[type] = (typeCount[type] || 0) + 1;
      });
    });

    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var maxDay = Math.max.apply(null, dayHeatmap) || 1;
    var maxHour = Math.max.apply(null, hourHeatmap) || 1;

    var h = '<div>';

    // Type breakdown
    h += '<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:800;color:#aaa;margin-bottom:8px">FRAUD TYPES</div>';
    var sortedTypes = Object.keys(typeCount).sort(function(a,b) { return typeCount[b]-typeCount[a]; });
    sortedTypes.slice(0,6).forEach(function(type) {
      var pct = Math.round((typeCount[type] / (alertSnap.numChildren() + reportSnap.numChildren())) * 100);
      h += '<div style="margin-bottom:5px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>' + type.replace(/_/g,' ') + '</span><span style="color:#ff4444">' + typeCount[type] + ' (' + pct + '%)</span></div>';
      h += '<div style="height:4px;background:rgba(255,255,255,.06);border-radius:4px"><div style="height:100%;width:' + pct + '%;background:#ff4444;border-radius:4px"></div></div></div>';
    });
    h += '</div>';

    // Day heatmap
    h += '<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:800;color:#aaa;margin-bottom:8px">BY DAY OF WEEK</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';
    days.forEach(function(day, i) {
      var intensity = Math.round((dayHeatmap[i] / maxDay) * 100);
      h += '<div style="text-align:center"><div style="height:40px;border-radius:6px;background:rgba(255,68,68,' + (intensity/100 * 0.7 + 0.05).toFixed(2) + ');margin-bottom:3px"></div>';
      h += '<div style="font-size:9px;color:#aaa">' + day + '</div></div>';
    });
    h += '</div></div>';

    // Hour heatmap
    h += '<div><div style="font-size:11px;font-weight:800;color:#aaa;margin-bottom:8px">BY HOUR (24h)</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:3px">';
    for (var i = 0; i < 24; i++) {
      var intensity = Math.round((hourHeatmap[i] / maxHour) * 100);
      h += '<div style="text-align:center"><div style="height:30px;border-radius:4px;background:rgba(255,170,0,' + (intensity/100 * 0.8 + 0.05).toFixed(2) + ')"></div>';
      h += '<div style="font-size:8px;color:#666">' + (i < 10 ? '0'+i : i) + '</div></div>';
    }
    h += '</div></div>';

    h += '</div>';
    _modal('🗺️ Fraud Heatmap', h);
  });
};

/* ══ TRUSTED PLAYER TAG ══ */
window.manageTrustedPlayer = function() {
  var db = rt(); if (!db) return;
  db.ref('users').orderByChild('trustedPlayer').equalTo(true).once('value', function(s) {
    var trusted = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._uid = c.key; trusted.push(d); });

    var h = '<div>';
    h += '<div style="margin-bottom:12px">';
    h += '<input id="tpSearch" type="text" placeholder="FF UID ya Username search karo" style="width:100%;padding:9px;border-radius:9px;background:#111;border:1px solid #333;color:#fff;font-size:13px;box-sizing:border-box">';
    h += '<button onclick="addTrustedPlayer()" style="width:100%;margin-top:6px;padding:9px;border-radius:9px;background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.25);color:#00d4ff;font-weight:700;font-size:12px;cursor:pointer">🛡️ Mark as Trusted</button>';
    h += '</div>';

    if (!trusted.length) {
      h += '<div style="text-align:center;padding:14px;color:#aaa">Koi trusted players nahi hain</div>';
    }
    trusted.forEach(function(u) {
      h += '<div style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.1);margin-bottom:6px">';
      h += '<div style="flex:1"><div style="font-size:12px;font-weight:700">🛡️ ' + (u.ign||u.displayName||'User') + '</div>';
      h += '<div style="font-size:10px;color:#aaa">UID: ' + u._uid + '</div></div>';
      h += '<button onclick="removeTrustedPlayer(\'' + u._uid + '\')" style="padding:5px 10px;border-radius:7px;background:rgba(255,68,68,.08);border:1px solid rgba(255,68,68,.2);color:#ff4444;font-size:10px;cursor:pointer">Remove</button>';
      h += '</div>';
    });
    h += '</div>';
    _modal('🛡️ Trusted Players', h);
  });
};

window.addTrustedPlayer = function() {
  var db = rt(); if (!db) return;
  var query = ((document.getElementById('tpSearch')||{}).value||'').trim();
  if (!query) { _toast('UID ya Username enter karo'); return; }
  db.ref('users').orderByChild('ffUid').equalTo(query).once('value', function(s) {
    if (!s.exists()) {
      // Try by displayName
      db.ref('users').orderByChild('ign').equalTo(query).once('value', function(s2) {
        if (!s2.exists()) { _toast('User not found: ' + query); return; }
        s2.forEach(function(c) {
          db.ref('users/' + c.key + '/trustedPlayer').set(true);
          _toast('✅ ' + (c.val().ign||'User') + ' ko Trusted mark kiya!');
        });
        window.manageTrustedPlayer();
      });
      return;
    }
    s.forEach(function(c) {
      db.ref('users/' + c.key + '/trustedPlayer').set(true);
      _toast('✅ ' + (c.val().ign||'User') + ' ko Trusted mark kiya!');
    });
    window.manageTrustedPlayer();
  });
};

window.removeTrustedPlayer = function(uid) {
  var db = rt(); if (!db) return;
  db.ref('users/' + uid + '/trustedPlayer').remove().then(function() {
    _toast('Removed from trusted');
    window.manageTrustedPlayer();
  });
};

/* ══ ROOM NOT OPENED REFUND QUEUE ══ */
window.showRefundQueue = function() {
  var db = rt(); if (!db) return;
  db.ref('refundRequests').orderByChild('status').equalTo('auto_pending').once('value', function(s) {
    var list = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; list.push(d); });

    var h = '<div>';
    if (!list.length) { h += '<div style="text-align:center;padding:20px;color:#00ff9c">✅ Koi pending refunds nahi!</div>'; }
    list.forEach(function(r) {
      h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,170,0,.2);border-radius:12px;padding:12px;margin-bottom:8px">';
      h += '<div style="font-size:12px;font-weight:700;margin-bottom:4px">Match: ' + (r.matchName||r.matchId) + '</div>';
      h += '<div style="font-size:11px;color:#aaa;margin-bottom:4px">User: ' + (r.uid||'') + '</div>';
      h += '<div style="font-size:11px;color:#ffaa00;margin-bottom:8px">Amount: ' + (r.entryType==='coin'?r.fee+' coins':'₹'+r.fee) + ' • Reason: Room not opened (45+ min)</div>';
      h += '<div style="display:flex;gap:6px">';
      h += '<button onclick="processRefund(\'' + r._key + '\',\'' + r.uid + '\',' + r.fee + ',\'' + (r.entryType||'money') + '\')" style="flex:1;padding:8px;border-radius:8px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.25);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer">✅ Approve Refund</button>';
      h += '<button onclick="denyRefund(\'' + r._key + '\')" style="flex:1;padding:8px;border-radius:8px;background:rgba(255,68,68,.08);border:1px solid rgba(255,68,68,.2);color:#ff4444;font-size:11px;font-weight:700;cursor:pointer">❌ Deny</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal('💸 Refund Queue (' + list.length + ')', h);
  });
};

window.processRefund = function(key, uid, fee, entryType) {
  var db = rt(); if (!db) return;
  db.ref('refundRequests/' + key).update({ status: 'approved', approvedAt: Date.now() });
  if (entryType === 'coin') {
    db.ref('users/' + uid + '/coins').transaction(function(v) { return (v||0) + Number(fee); });
  } else {
    db.ref('users/' + uid + '/realMoney/deposited').transaction(function(v) { return (v||0) + Number(fee); });
  }
  var nk = db.ref('users/' + uid + '/notifications').push().key;
  db.ref('users/' + uid + '/notifications/' + nk).set({
    title: '💸 Refund Approved!',
    message: (entryType==='coin' ? fee+' coins' : '₹'+fee) + ' refund ho gaya — room release nahi hua tha.',
    type: 'wallet_approved', timestamp: Date.now(), read: false
  });
  _toast('✅ Refund processed!');
  window.showRefundQueue();
};

window.denyRefund = function(key) {
  var db = rt(); if (!db) return;
  db.ref('refundRequests/' + key).update({ status: 'denied', deniedAt: Date.now() });
  _toast('Refund denied');
  window.showRefundQueue();
};

/* ══ KILL ANOMALY DETECTION (run after result publish) ══ */
window.runKillAnomalyCheck = function(matchId) {
  var db = rt(); if (!db || !matchId) return;
  db.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value', function(s) {
    if (!s.exists()) return;
    var results = [];
    s.forEach(function(c) {
      var jr = c.val();
      if (jr.result && jr.result.kills != null) {
        results.push({ uid: jr.userId, kills: Number(jr.result.kills), jrKey: c.key });
      }
    });
    if (results.length < 3) return;
    var avg = results.reduce(function(sum, r) { return sum + r.kills; }, 0) / results.length;
    var max = Math.max.apply(null, results.map(function(r) { return r.kills; }));
    results.forEach(function(r) {
      // If kills > 3x average AND > 15 = suspicious
      if (r.kills > avg * 3 && r.kills > 15) {
        db.ref('adminAlerts').push({
          type: 'kill_anomaly',
          uid: r.uid,
          matchId: matchId,
          kills: r.kills,
          avgKills: Math.round(avg * 10) / 10,
          timestamp: Date.now(),
          severity: 'MEDIUM',
          message: 'Player ne ' + r.kills + ' kills kiye jabki average ' + (Math.round(avg*10)/10) + ' tha! Suspicious.'
        });
      }
    });
  });
};

/* ══ BUTTONS IN ADMIN TOOLBAR ══ */
// Add buttons to toolbar once DOM loads
document.addEventListener('DOMContentLoaded', function() {
  // Badge for cheat reports
  var db = rt();
  if (db) {
    db.ref('cheatReports').orderByChild('status').equalTo('pending').on('value', function(s) {
      var badge = document.getElementById('cheatReportBadge');
      var count = s.numChildren ? s.numChildren() : 0;
      if (badge) {
        badge.textContent = count;
        badge.style.display = count ? '' : 'none';
      }
    });
    db.ref('refundRequests').orderByChild('status').equalTo('auto_pending').on('value', function(s) {
      var badge = document.getElementById('refundQueueBadge');
      var count = s.numChildren ? s.numChildren() : 0;
      if (badge) {
        badge.textContent = count;
        badge.style.display = count ? '' : 'none';
      }
    });
  }
});

console.log('[Admin] ✅ Anti-Fraud Complete System loaded');
})();

/* ════════════════════════════════════════════════════
   FA27 UPGRADE: Enhanced Kill Anomaly — auto-runs after every result publish
   + Prize Dispute Queue + Match Integrity Score
   ════════════════════════════════════════════════════ */
(function() {
'use strict';
var rt = function() { return window.rtdb || window.db; };

/* Enhanced kill anomaly — also checks for impossible stats */
window.runKillAnomalyCheck = function(matchId) {
  var db = rt(); if (!db || !matchId) return;
  db.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value', function(s) {
    if (!s.exists()) return;
    var results = [];
    s.forEach(function(c) {
      var jr = c.val(); if (!jr) return;
      var kills = 0;
      if (jr.result && jr.result.kills != null) kills = Number(jr.result.kills);
      else if (jr.kills != null) kills = Number(jr.kills);
      if (kills >= 0) results.push({ uid: jr.userId || jr.uid, kills: kills, rank: jr.rank || 0, jrKey: c.key });
    });
    if (results.length < 2) return;

    var avg = results.reduce(function(sum, r) { return sum + r.kills; }, 0) / results.length;
    var totalKills = results.reduce(function(sum, r) { return sum + r.kills; }, 0);

    results.forEach(function(r) {
      var alerts = [];
      // Impossible kills (FF max ~20 per solo match practically)
      if (r.kills > 25) alerts.push('Kills > 25 (' + r.kills + ')');
      // Way above average
      if (r.kills > avg * 4 && r.kills > 10) alerts.push(r.kills + ' kills vs avg ' + Math.round(avg));
      // Rank 1 but 0 kills suspicious
      if (r.rank === 1 && r.kills === 0) alerts.push('Rank 1 but 0 kills');
      // Low rank but high kills
      if (r.rank > 10 && r.kills > 15) alerts.push('Low rank(' + r.rank + ') but high kills(' + r.kills + ')');

      if (alerts.length) {
        db.ref('adminAlerts').push({
          type: 'kill_anomaly',
          uid: r.uid,
          matchId: matchId,
          kills: r.kills,
          rank: r.rank,
          avgKills: Math.round(avg * 10) / 10,
          timestamp: Date.now(),
          severity: r.kills > 25 ? 'HIGH' : 'MEDIUM',
          message: '🎯 Kill anomaly in match ' + matchId + ': ' + alerts.join(', '),
          resolved: false,
          source: 'fa27_kill_check'
        });
      }
    });

    // Total kills sanity check
    if (totalKills > results.length * 15) {
      db.ref('adminAlerts').push({
        type: 'total_kills_impossible',
        matchId: matchId,
        totalKills: totalKills,
        players: results.length,
        timestamp: Date.now(),
        severity: 'HIGH',
        message: '🚨 Impossible total kills: ' + totalKills + ' kills by ' + results.length + ' players!',
        resolved: false,
        source: 'fa27_total_kills'
      });
    }
  });
};

/* Auto-run kill check whenever result is published */
var origPublish = window.publishMatchResult;
if (origPublish) {
  window.publishMatchResult = function(matchId) {
    var r = origPublish.apply(this, arguments);
    setTimeout(function() { window.runKillAnomalyCheck(matchId); }, 3000);
    return r;
  };
}

})();
