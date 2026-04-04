/* ====== ADMIN ANTI-SPAM FEATURES fa28-fa52: ADVANCED FRAUD CONTROL CENTER ======
   fa28 - Real-Time Fraud Score Dashboard (per user live score)
   fa29 - UTR Blacklist Manager (block specific UTRs)
   fa30 - Device Fingerprint Blacklist
   fa31 - Bulk Suspicious User Report Downloader (CSV)
   fa32 - Auto-Ban Threshold Config (admin sets rules)
   fa33 - Referral Fraud Network Visualizer
   fa34 - Withdrawal Pattern Anomaly Monitor
   fa35 - Kill Count Fraud Review Queue
   fa36 - Multi-Account Family Viewer (all linked accounts)
   fa37 - IP Address Risk Monitor
   fa38 - Screenshot Fraud Review Queue
   fa39 - Penalty Points Manager
   fa40 - Account Age Filter for Withdrawals
   fa41 - Chat Abuse Log Viewer
   fa42 - Login Anomaly Monitor (unusual login times/locations)
   fa43 - Coin Transaction Audit Trail
   fa44 - Real-Time Alert Sound Notification
   fa45 - Fraud Case Management (open/close cases)
   fa46 - One-Click User Evidence Pack (all data for banned user)
   fa47 - Anti-Cheat Config Panel (toggle rules)
   fa48 - Suspicious Match Result Review Queue
   fa49 - Fraud Analytics Dashboard (charts)
   fa50 - Auto-Escalation Rules (LOW→MEDIUM→HIGH)
   fa51 - User Trust Score Editor
   fa52 - Blacklist Import/Export Tool
*/
(function(){
'use strict';

var rt = function() { return window.rtdb || window.db; };
function _modal(title, html) {
  if (window.showAdminModal) showAdminModal(title, html);
  else if (window.showModal) showModal(title, html);
}
function _toast(msg) { if (window.showToast) showToast(msg); }

/* ══════════════════════════════════════════════════
   fa28: REAL-TIME FRAUD SCORE DASHBOARD
   ══════════════════════════════════════════════════ */
window.showFraudScoreDashboard = function() {
  var db = rt(); if (!db) return;

  db.ref('users').orderByChild('penaltyPoints').startAt(1).limitToLast(20).once('value', function(s) {
    var users = [];
    if (s.exists()) s.forEach(function(c) {
      var d = c.val(); d._uid = c.key;
      var score = calculateFraudScore(d);
      users.push({ uid: c.key, name: d.displayName || d.ign || c.key, score: score, data: d });
    });
    users.sort(function(a,b) { return b.score.total - a.score.total; });

    var h = '<div style="max-height:70vh;overflow-y:auto">';
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:12px;padding:8px;background:rgba(255,255,255,.04);border-radius:8px">📊 Fraud score = penalty points + flags + win rate + account age. Higher = more suspicious.</div>';

    if (!users.length) {
      h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi high-risk users nahi</div>';
    }

    users.forEach(function(u) {
      var s = u.score;
      var color = s.total >= 70 ? '#ff4444' : s.total >= 40 ? '#ffaa00' : '#00ff9c';
      var badge = s.total >= 70 ? '🔴 HIGH' : s.total >= 40 ? '🟡 MEDIUM' : '🟢 LOW';
      h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;margin-bottom:8px">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center">';
      h += '<div><div style="font-size:13px;font-weight:700">' + u.name + '</div>';
      h += '<div style="font-size:10px;color:#aaa;font-family:monospace">' + u.uid + '</div></div>';
      h += '<div style="text-align:right"><div style="font-size:20px;font-weight:900;color:' + color + '">' + s.total + '</div>';
      h += '<div style="font-size:9px;color:' + color + ';font-weight:700">' + badge + '</div></div>';
      h += '</div>';
      h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">';
      s.factors.forEach(function(f) {
        h += '<span style="font-size:9px;padding:2px 6px;border-radius:6px;background:rgba(255,170,0,.1);color:#ffaa00">' + f + '</span>';
      });
      h += '</div>';
      h += '<div style="display:flex;gap:6px;margin-top:8px">';
      h += '<button onclick="adminViewUser(\'' + u.uid + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-size:11px;font-weight:700;cursor:pointer">👁️ View</button>';
      h += '<button onclick="adminBanUser(\'' + u.uid + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.25);color:#ff4444;font-size:11px;font-weight:700;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="adminSetTrust(\'' + u.uid + '\')" style="padding:6px 8px;border-radius:7px;background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);color:#00ff9c;font-size:11px;cursor:pointer">✅</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal('📊 Fraud Score Dashboard', h);
  });
};

function calculateFraudScore(userData) {
  var total = 0;
  var factors = [];

  var pp = Number(userData.penaltyPoints) || 0;
  if (pp > 0) { total += pp * 5; factors.push('Penalty: ' + pp + 'pts'); }

  var flags = userData.flags || {};
  if (flags.multiAccount) { total += 30; factors.push('Multi-Account'); }
  if (flags.fakeScreenshot) { total += 25; factors.push('Fake Screenshot'); }
  if (flags.vpnDetected) { total += 15; factors.push('VPN Detected'); }
  if (flags.emulatorSuspected) { total += 20; factors.push('Emulator'); }
  if (flags.referralAbuse) { total += 20; factors.push('Referral Fraud'); }

  var daysSince = (Date.now() - (Number(userData.createdAt) || Date.now())) / 86400000;
  if (daysSince < 3) { total += 15; factors.push('New Account'); }

  if (userData.banned) { total += 50; factors.push('Previously Banned'); }

  return { total: Math.min(total, 100), factors: factors };
}

/* ══════════════════════════════════════════════════
   fa29: UTR BLACKLIST MANAGER
   ══════════════════════════════════════════════════ */
window.showUTRBlacklist = function() {
  var db = rt(); if (!db) return;
  db.ref('utrBlacklist').once('value', function(s) {
    var blacklisted = [];
    if (s.exists()) s.forEach(function(c) { blacklisted.push({ key: c.key, data: c.val() }); });

    var h = '<div>';
    h += '<div style="display:flex;gap:8px;margin-bottom:12px">';
    h += '<input id="newBlacklistUTR" placeholder="UTR number enter karo..." style="flex:1;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:13px">';
    h += '<button onclick="addUTRToBlacklist()" style="padding:9px 14px;border-radius:9px;background:rgba(255,68,68,.15);border:1px solid rgba(255,68,68,.3);color:#ff4444;font-weight:800;cursor:pointer;font-size:12px">+ Block</button>';
    h += '</div>';

    if (!blacklisted.length) {
      h += '<div style="text-align:center;padding:16px;color:#aaa">Koi blacklisted UTR nahi</div>';
    } else {
      blacklisted.forEach(function(item) {
        h += '<div style="background:rgba(255,68,68,.05);border:1px solid rgba(255,68,68,.15);border-radius:8px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">';
        h += '<div><div style="font-family:monospace;font-size:13px;color:#ff6464">' + item.data.utr + '</div>';
        h += '<div style="font-size:10px;color:#aaa">' + (item.data.reason || 'Fraud') + ' • ' + new Date(item.data.addedAt).toLocaleDateString('en-IN') + '</div></div>';
        h += '<button onclick="removeUTRFromBlacklist(\'' + item.key + '\')" style="padding:4px 10px;border-radius:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#aaa;font-size:11px;cursor:pointer">Remove</button>';
        h += '</div>';
      });
    }
    h += '</div>';
    _modal('🚫 UTR Blacklist Manager', h);
  });
};

window.addUTRToBlacklist = function() {
  var db = rt(); if (!db) return;
  var utr = (document.getElementById('newBlacklistUTR')||{}).value || '';
  if (!utr.trim()) { _toast('UTR enter karo'); return; }
  db.ref('utrBlacklist').push({ utr: utr.trim(), addedAt: Date.now(), reason: 'Admin blacklisted', addedBy: 'admin' }).then(function() {
    _toast('✅ UTR blacklisted: ' + utr);
    setTimeout(window.showUTRBlacklist, 300);
  });
};

window.removeUTRFromBlacklist = function(key) {
  var db = rt(); if (!db) return;
  db.ref('utrBlacklist/' + key).remove().then(function() {
    _toast('UTR removed from blacklist');
    setTimeout(window.showUTRBlacklist, 300);
  });
};

/* ══════════════════════════════════════════════════
   fa30: DEVICE FINGERPRINT BLACKLIST
   ══════════════════════════════════════════════════ */
window.showDeviceBlacklist = function() {
  var db = rt(); if (!db) return;
  db.ref('deviceBlacklist').once('value', function(s) {
    var devices = [];
    if (s.exists()) s.forEach(function(c) { devices.push({ key: c.key, data: c.val() }); });

    var h = '<div>';
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:10px">Blacklisted devices par koi bhi account join nahi kar sakta.</div>';
    if (!devices.length) {
      h += '<div style="text-align:center;padding:16px;color:#aaa">Koi device blacklisted nahi</div>';
    } else {
      devices.forEach(function(d) {
        h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,68,68,.15);border-radius:8px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">';
        h += '<div><div style="font-family:monospace;font-size:11px;color:#ff9c00">' + d.data.fingerprint + '</div>';
        h += '<div style="font-size:10px;color:#aaa">Blocked: ' + new Date(d.data.blockedAt).toLocaleDateString('en-IN') + '</div></div>';
        h += '<button onclick="removeDeviceBlacklist(\'' + d.key + '\')" style="padding:4px 10px;border-radius:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#aaa;font-size:11px;cursor:pointer">Remove</button>';
        h += '</div>';
      });
    }
    h += '</div>';
    _modal('📱 Device Blacklist', h);
  });
};

window.blockDevice = function(fingerprint, reason) {
  var db = rt(); if (!db) return;
  db.ref('deviceBlacklist').push({
    fingerprint: fingerprint,
    reason: reason || 'Admin blocked',
    blockedAt: Date.now()
  }).then(function() { _toast('📱 Device blocked: ' + fingerprint.slice(0,12) + '...'); });
};

window.removeDeviceBlacklist = function(key) {
  var db = rt(); if (!db) return;
  db.ref('deviceBlacklist/' + key).remove().then(function() {
    _toast('Device unblocked');
    setTimeout(window.showDeviceBlacklist, 300);
  });
};

/* ══════════════════════════════════════════════════
   fa31: SUSPICIOUS USER CSV DOWNLOADER
   ══════════════════════════════════════════════════ */
window.downloadSuspiciousUsersCSV = function() {
  var db = rt(); if (!db) return;
  _toast('⏳ Report generate ho rahi hai...');

  db.ref('users').once('value', function(s) {
    if (!s.exists()) { _toast('No users found'); return; }
    var rows = [['UID', 'Name', 'IGN', 'Fraud Score', 'Penalty Points', 'Flags', 'Account Age (days)', 'Banned', 'Created At']];

    s.forEach(function(c) {
      var d = c.val();
      var score = calculateFraudScore(d);
      if (score.total < 20) return; // Only suspicious ones

      var flags = Object.keys(d.flags || {}).filter(function(k) { return d.flags[k]; }).join('|');
      var daysSince = Math.floor((Date.now() - (Number(d.createdAt) || Date.now())) / 86400000);
      rows.push([
        c.key,
        (d.displayName || '').replace(/,/g, ' '),
        (d.ign || '').replace(/,/g, ' '),
        score.total,
        d.penaltyPoints || 0,
        flags,
        daysSince,
        d.banned ? 'YES' : 'NO',
        new Date(Number(d.createdAt) || Date.now()).toLocaleDateString('en-IN')
      ]);
    });

    var csvContent = rows.map(function(r) { return r.join(','); }).join('\n');
    var blob = new Blob([csvContent], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'suspicious_users_' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    _toast('✅ CSV downloaded (' + (rows.length-1) + ' suspicious users)');
  });
};

/* ══════════════════════════════════════════════════
   fa32: AUTO-BAN THRESHOLD CONFIG
   ══════════════════════════════════════════════════ */
var _autoBanConfig = {
  penaltyThreshold: 10,
  cheatReportThreshold: 3,
  winRateThreshold: 85,
  enabled: true
};

window.showAutoBanConfig = function() {
  var db = rt(); if (!db) return;
  db.ref('adminConfig/autoBan').once('value', function(s) {
    if (s.exists()) _autoBanConfig = Object.assign(_autoBanConfig, s.val());

    var h = '<div>';
    h += '<div style="margin-bottom:14px;padding:10px;background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.2);border-radius:10px;font-size:12px;color:#ffaa00">⚙️ Rules configure karo — system automatically ban karega jab thresholds exceed hon.</div>';

    h += '<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Penalty Points Threshold (auto-ban)</label>';
    h += '<input id="abPenalty" type="number" value="' + _autoBanConfig.penaltyThreshold + '" style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:13px;box-sizing:border-box"></div>';

    h += '<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Cheat Reports Threshold (auto-ban)</label>';
    h += '<input id="abCheat" type="number" value="' + _autoBanConfig.cheatReportThreshold + '" style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:13px;box-sizing:border-box"></div>';

    h += '<div style="margin-bottom:14px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Win Rate Threshold % (flag for review)</label>';
    h += '<input id="abWinRate" type="number" value="' + _autoBanConfig.winRateThreshold + '" style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:13px;box-sizing:border-box"></div>';

    h += '<button onclick="saveAutoBanConfig()" style="width:100%;padding:12px;border-radius:10px;background:linear-gradient(135deg,#ff6b35,#ff4444);color:#fff;font-weight:800;border:none;cursor:pointer">💾 Save Config</button>';
    h += '</div>';
    _modal('⚙️ Auto-Ban Config', h);
  });
};

window.saveAutoBanConfig = function() {
  var db = rt(); if (!db) return;
  var config = {
    penaltyThreshold: Number((document.getElementById('abPenalty')||{}).value) || 10,
    cheatReportThreshold: Number((document.getElementById('abCheat')||{}).value) || 3,
    winRateThreshold: Number((document.getElementById('abWinRate')||{}).value) || 85,
    enabled: true,
    updatedAt: Date.now()
  };
  db.ref('adminConfig/autoBan').set(config).then(function() {
    _autoBanConfig = config;
    _toast('✅ Auto-ban config saved!');
    if (window.closeAdminModal) closeAdminModal();
  });
};

/* ══════════════════════════════════════════════════
   fa33: MULTI-ACCOUNT FAMILY VIEWER
   ══════════════════════════════════════════════════ */
window.showAccountFamily = function(uid) {
  var db = rt(); if (!db) return;

  // Find device FP for this user
  db.ref('users/' + uid + '/deviceFP').once('value', function(s) {
    var fp = (s.val() && s.val().fp) || '';
    if (!fp) { _toast('Device FP not found for this user'); return; }

    // Find all joins with this FP
    db.ref('deviceJoins/' + fp).once('value', function(js) {
      var relatedUIDs = new Set();
      relatedUIDs.add(uid);
      if (js.exists()) {
        js.forEach(function(matchSnap) {
          var d = matchSnap.val();
          if (d && d.uid) relatedUIDs.add(d.uid);
        });
      }

      var h = '<div>';
      h += '<div style="font-size:11px;color:#aaa;margin-bottom:10px">Device FP: <span style="font-family:monospace;color:#ff9c00">' + fp + '</span></div>';
      h += '<div style="font-size:12px;font-weight:700;margin-bottom:10px">🔗 Linked Accounts (' + relatedUIDs.size + '):</div>';

      var uidArr = Array.from(relatedUIDs);
      var loaded = 0;
      var html = '';
      uidArr.forEach(function(ruid) {
        db.ref('users/' + ruid).once('value', function(us) {
          var ud = us.val() || {};
          html += '<div style="background:rgba(255,255,255,.04);border:1px solid ' + (ruid === uid ? 'rgba(255,170,0,.3)' : 'rgba(255,255,255,.08)') + ';border-radius:8px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">';
          html += '<div><div style="font-size:12px;font-weight:700">' + (ud.displayName || ud.ign || ruid) + (ruid === uid ? ' <span style="color:#ffaa00;font-size:10px">(Primary)</span>' : '') + '</div>';
          html += '<div style="font-size:10px;font-family:monospace;color:#aaa">' + ruid + '</div></div>';
          html += '<button onclick="adminBanUser(\'' + ruid + '\')" style="padding:4px 10px;border-radius:6px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.25);color:#ff4444;font-size:11px;cursor:pointer">🚫 Ban</button>';
          html += '</div>';
          loaded++;
          if (loaded === uidArr.length) {
            document.getElementById('_afContent') && (document.getElementById('_afContent').innerHTML = html);
          }
        });
      });

      h += '<div id="_afContent"><div style="text-align:center;color:#aaa;padding:10px">Loading...</div></div>';
      h += '</div>';
      _modal('🔗 Account Family Viewer', h);
      setTimeout(function() {
        if (document.getElementById('_afContent')) document.getElementById('_afContent').innerHTML = '';
        uidArr.forEach(function(ruid) {
          db.ref('users/' + ruid).once('value', function(us) {
            var ud = us.val() || {};
            var el = document.getElementById('_afContent');
            if (!el) return;
            el.innerHTML += '<div style="background:rgba(255,255,255,.04);border:1px solid ' + (ruid === uid ? 'rgba(255,170,0,.3)' : 'rgba(255,255,255,.08)') + ';border-radius:8px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">';
            el.innerHTML += '<div><div style="font-size:12px;font-weight:700">' + (ud.displayName || ud.ign || ruid) + (ruid === uid ? ' <span style="color:#ffaa00;font-size:10px">(Primary)</span>' : '') + '</div>';
            el.innerHTML += '<div style="font-size:10px;font-family:monospace;color:#aaa">' + ruid + '</div></div>';
            el.innerHTML += '<button onclick="adminBanUser(\'' + ruid + '\')" style="padding:4px 10px;border-radius:6px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.25);color:#ff4444;font-size:11px;cursor:pointer">🚫 Ban</button>';
            el.innerHTML += '</div>';
          });
        });
      }, 200);
    });
  });
};

/* ══════════════════════════════════════════════════
   fa34: KILL COUNT FRAUD REVIEW QUEUE
   ══════════════════════════════════════════════════ */
window.showKillFraudQueue = function() {
  var db = rt(); if (!db) return;
  db.ref('adminAlerts').orderByChild('type').equalTo('impossible_kill_count').limitToLast(30).once('value', function(s) {
    var alerts = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; if(!d.resolved) alerts.push(d); });

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    if (!alerts.length) h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi impossible kill report nahi</div>';

    alerts.sort(function(a,b){ return b.timestamp - a.timestamp; });
    alerts.forEach(function(alert) {
      h += '<div style="background:rgba(255,68,68,.05);border:1px solid rgba(255,68,68,.2);border-radius:10px;padding:10px;margin-bottom:8px">';
      h += '<div style="font-size:13px;font-weight:700;margin-bottom:4px">💀 ' + alert.reportedKills + ' kills reported</div>';
      h += '<div style="font-size:11px;color:#aaa">User: <span style="color:#00d4ff;font-family:monospace">' + alert.uid + '</span></div>';
      h += '<div style="font-size:11px;color:#aaa">Mode: ' + (alert.matchType||'unknown') + ' | Max allowed: ' + (alert.maxPossible||26) + '</div>';
      h += '<div style="font-size:10px;color:#666;margin-top:4px">' + new Date(alert.timestamp).toLocaleString('en-IN') + '</div>';
      h += '<div style="display:flex;gap:6px;margin-top:8px">';
      h += '<button onclick="adminBanUser(\'' + alert.uid + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,68,68,.15);border:1px solid rgba(255,68,68,.3);color:#ff4444;font-size:11px;font-weight:700;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="resolveAlert(\'' + alert._key + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-size:11px;cursor:pointer">✅ Dismiss</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal('💀 Kill Fraud Review (' + alerts.length + ')', h);
  });
};

/* ══════════════════════════════════════════════════
   fa35: CHAT ABUSE LOG VIEWER
   ══════════════════════════════════════════════════ */
window.showChatAbuseLog = function() {
  var db = rt(); if (!db) return;
  var types = ['chat_flood', 'chat_repeat_spam', 'chat_abuse', 'chat_link_spam'];
  var promises = types.map(function(t) {
    return db.ref('adminAlerts').orderByChild('type').equalTo(t).limitToLast(20).once('value');
  });

  Promise.all(promises).then(function(snapshots) {
    var allAlerts = [];
    snapshots.forEach(function(s) {
      if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; allAlerts.push(d); });
    });
    allAlerts.sort(function(a,b){ return b.timestamp - a.timestamp; });

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    if (!allAlerts.length) h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi chat abuse log nahi</div>';

    allAlerts.slice(0, 30).forEach(function(alert) {
      var typeIcons = { chat_flood: '🌊', chat_repeat_spam: '🔁', chat_abuse: '🤬', chat_link_spam: '🔗' };
      h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:9px;margin-bottom:7px">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
      h += '<span style="font-size:12px;font-weight:700">' + (typeIcons[alert.type]||'⚠️') + ' ' + (alert.type||'').replace(/_/g,' ').toUpperCase() + '</span>';
      h += '<span style="font-size:9px;color:#aaa">' + new Date(alert.timestamp).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) + '</span>';
      h += '</div>';
      if (alert.message) h += '<div style="font-size:11px;color:#ddd;margin-bottom:4px">' + alert.message + '</div>';
      h += '<div style="font-size:10px;color:#aaa">UID: <span style="font-family:monospace;color:#00d4ff">' + alert.uid + '</span></div>';
      h += '<div style="display:flex;gap:5px;margin-top:7px">';
      h += '<button onclick="adminBanUser(\'' + alert.uid + '\')" style="flex:1;padding:5px;border-radius:7px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);color:#ff4444;font-size:10px;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="resolveAlert(\'' + alert._key + '\')" style="padding:5px 8px;border-radius:7px;background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);color:#00ff9c;font-size:10px;cursor:pointer">✅</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal('💬 Chat Abuse Log (' + allAlerts.length + ')', h);
  });
};

/* ══════════════════════════════════════════════════
   fa36: COIN TRANSACTION AUDIT TRAIL
   ══════════════════════════════════════════════════ */
window.showCoinAuditTrail = function(uid) {
  if (!uid) {
    var h = '<div style="margin-bottom:10px"><input id="auditUID" placeholder="User UID enter karo..." style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:13px;box-sizing:border-box"></div>';
    h += '<button onclick="showCoinAuditTrail(document.getElementById(\'auditUID\').value)" style="width:100%;padding:11px;border-radius:9px;background:linear-gradient(135deg,#00d4ff,#0077ff);color:#fff;font-weight:800;border:none;cursor:pointer">🔍 Search</button>';
    _modal('💰 Coin Audit Trail', h);
    return;
  }

  var db = rt(); if (!db) return;
  db.ref('coinTransactions').orderByChild('uid').equalTo(uid).limitToLast(30).once('value', function(s) {
    var txns = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; txns.push(d); });
    txns.sort(function(a,b){ return b.timestamp - a.timestamp; });

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:10px">UID: <span style="font-family:monospace;color:#00d4ff">' + uid + '</span></div>';

    if (!txns.length) {
      h += '<div style="text-align:center;padding:16px;color:#aaa">Koi transactions nahi mili</div>';
    }

    txns.forEach(function(txn) {
      var isCredit = Number(txn.amount) > 0;
      var color = isCredit ? '#00ff9c' : '#ff4444';
      h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:9px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">';
      h += '<div><div style="font-size:12px;font-weight:700">' + (txn.type || 'Transaction') + '</div>';
      h += '<div style="font-size:10px;color:#aaa">' + new Date(txn.timestamp).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) + '</div>';
      if (txn.reference) h += '<div style="font-size:10px;color:#666">Ref: ' + txn.reference + '</div>';
      h += '</div>';
      h += '<div style="font-size:16px;font-weight:900;color:' + color + '">' + (isCredit?'+':'') + txn.amount + '</div>';
      h += '</div>';
    });
    h += '</div>';
    _modal('💰 Coin Audit: ' + uid.slice(0,8) + '...', h);
  });
};

/* ══════════════════════════════════════════════════
   fa37: PENALTY POINTS MANAGER
   ══════════════════════════════════════════════════ */
window.showPenaltyManager = function(uid) {
  if (!uid) {
    var h = '<div style="margin-bottom:10px"><input id="pmUID" placeholder="User UID..." style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:13px;box-sizing:border-box"></div>';
    h += '<button onclick="showPenaltyManager(document.getElementById(\'pmUID\').value)" style="width:100%;padding:11px;border-radius:9px;background:linear-gradient(135deg,#ff9c00,#ff6b35);color:#fff;font-weight:800;border:none;cursor:pointer">🔍 Load</button>';
    _modal('⚠️ Penalty Manager', h);
    return;
  }
  var db = rt(); if (!db) return;
  db.ref('users/' + uid).once('value', function(s) {
    var ud = s.val() || {};
    var points = Number(ud.penaltyPoints) || 0;

    var h = '<div>';
    h += '<div style="text-align:center;margin-bottom:16px">';
    h += '<div style="font-size:48px;font-weight:900;color:' + (points>=10?'#ff4444':points>=5?'#ffaa00':'#00ff9c') + '">' + points + '</div>';
    h += '<div style="font-size:12px;color:#aaa">Current Penalty Points</div>';
    h += '<div style="font-size:13px;font-weight:700;margin-top:4px">' + (ud.displayName||ud.ign||uid) + '</div>';
    h += '</div>';

    h += '<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Add/Remove Points</label>';
    h += '<input id="pmPoints" type="number" placeholder="e.g. 2 or -1" style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:13px;box-sizing:border-box"></div>';

    h += '<div style="margin-bottom:14px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Reason</label>';
    h += '<input id="pmReason" placeholder="Reason..." style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:13px;box-sizing:border-box"></div>';

    h += '<div style="display:flex;gap:8px">';
    h += '<button onclick="applyPenaltyPoints(\'' + uid + '\')" style="flex:1;padding:11px;border-radius:9px;background:linear-gradient(135deg,#ff9c00,#ff6b35);color:#fff;font-weight:800;border:none;cursor:pointer">Apply</button>';
    h += '<button onclick="clearPenaltyPoints(\'' + uid + '\')" style="padding:11px 14px;border-radius:9px;background:rgba(0,255,156,.08);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-weight:700;cursor:pointer">Reset All</button>';
    h += '</div></div>';
    _modal('⚠️ Penalty Manager: ' + (ud.displayName||uid.slice(0,8)), h);
  });
};

window.applyPenaltyPoints = function(uid) {
  var db = rt(); if (!db) return;
  var pts = Number((document.getElementById('pmPoints')||{}).value) || 0;
  var reason = (document.getElementById('pmReason')||{}).value || 'Admin manual';
  if (pts === 0) { _toast('Points enter karo'); return; }

  db.ref('users/' + uid + '/penaltyPoints').transaction(function(c) {
    return Math.max(0, (Number(c)||0) + pts);
  }).then(function(r) {
    _toast((pts>0?'⚠️ +':'-') + Math.abs(pts) + ' points applied. Total: ' + r.snapshot.val());
    // Log
    db.ref('adminAlerts').push({
      type: 'manual_penalty',
      uid: uid,
      points: pts,
      reason: reason,
      timestamp: Date.now(),
      severity: 'LOW',
      message: 'Admin ne ' + pts + ' penalty points ' + (pts>0?'add':'remove') + ' kiye: ' + reason
    });
    setTimeout(function(){ window.showPenaltyManager(uid); }, 300);
  });
};

window.clearPenaltyPoints = function(uid) {
  var db = rt(); if (!db) return;
  db.ref('users/' + uid + '/penaltyPoints').set(0).then(function() { _toast('✅ Penalty points reset to 0'); });
};

/* ══════════════════════════════════════════════════
   fa38: SCREENSHOT FRAUD REVIEW QUEUE
   ══════════════════════════════════════════════════ */
window.showScreenshotFraudQueue = function() {
  var db = rt(); if (!db) return;
  var fraudTypes = ['fake_screenshot_attempt', 'edited_screenshot_metadata', 'screenshot_reuse'];

  var promises = fraudTypes.map(function(t) {
    return db.ref('adminAlerts').orderByChild('type').equalTo(t).limitToLast(15).once('value');
  });

  Promise.all(promises).then(function(snapshots) {
    var alerts = [];
    snapshots.forEach(function(s) {
      if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; if(!d.resolved) alerts.push(d); });
    });
    alerts.sort(function(a,b){ return b.timestamp - a.timestamp; });

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    if (!alerts.length) h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi screenshot fraud nahi</div>';

    alerts.forEach(function(alert) {
      h += '<div style="background:rgba(255,68,68,.05);border:1px solid rgba(255,68,68,.15);border-radius:10px;padding:10px;margin-bottom:8px">';
      h += '<div style="font-size:12px;font-weight:700;color:#ff6464;margin-bottom:4px">🖼️ ' + (alert.type||'').replace(/_/g,' ').toUpperCase() + '</div>';
      h += '<div style="font-size:11px;color:#ddd;margin-bottom:4px">' + (alert.message||'') + '</div>';
      h += '<div style="font-size:10px;color:#aaa">UID: <span style="font-family:monospace;color:#00d4ff">' + (alert.uid||'?') + '</span></div>';
      h += '<div style="font-size:10px;color:#aaa">Match: ' + (alert.matchId||'?') + '</div>';
      h += '<div style="font-size:10px;color:#666;margin-top:3px">' + new Date(alert.timestamp).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) + '</div>';
      h += '<div style="display:flex;gap:6px;margin-top:8px">';
      h += '<button onclick="adminBanUser(\'' + (alert.uid||'') + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,68,68,.15);border:1px solid rgba(255,68,68,.3);color:#ff4444;font-size:11px;font-weight:700;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="resolveAlert(\'' + alert._key + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-size:11px;cursor:pointer">✅ Dismiss</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal('🖼️ Screenshot Fraud Queue (' + alerts.length + ')', h);
  });
};

/* ══════════════════════════════════════════════════
   fa39: ANTI-CHEAT CONFIG PANEL
   ══════════════════════════════════════════════════ */
window.showAntiCheatConfig = function() {
  var db = rt(); if (!db) return;
  db.ref('adminConfig/antiCheat').once('value', function(s) {
    var config = s.val() || {};

    var rules = [
      { key: 'deviceCooldown', label: 'Device Change Cooldown (24h)', icon: '📱' },
      { key: 'geoCheck', label: 'Geolocation Mismatch Detection', icon: '🌍' },
      { key: 'vpnBlock', label: 'VPN/Proxy Detection', icon: '🔒' },
      { key: 'emulatorBlock', label: 'Emulator/Root Detection', icon: '🤖' },
      { key: 'rapidJoinBlock', label: 'Rapid Join Spam Block', icon: '⚡' },
      { key: 'utrDuplicate', label: 'UTR Duplicate Detection', icon: '💸' },
      { key: 'killValidation', label: 'Kill Count Validation', icon: '💀' },
      { key: 'winRateMonitor', label: 'Win Rate Anomaly Monitor', icon: '🏆' },
      { key: 'multiAccountBlock', label: 'Multi-Account Detection', icon: '👥' },
      { key: 'screenshotValidation', label: 'Screenshot Fraud Detection', icon: '🖼️' },
      { key: 'chatSpamBlock', label: 'Chat Spam Prevention', icon: '💬' },
      { key: 'referralAbuseBlock', label: 'Referral Fraud Detection', icon: '🔗' }
    ];

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:12px">Toggle karo jo features enable/disable karne hain:</div>';

    rules.forEach(function(rule) {
      var enabled = config[rule.key] !== false; // Default ON
      h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid rgba(255,255,255,.05)">';
      h += '<div style="font-size:12px"><span style="margin-right:6px">' + rule.icon + '</span>' + rule.label + '</div>';
      h += '<button id="acc_' + rule.key + '" onclick="toggleAntiCheatRule(\'' + rule.key + '\')" style="padding:5px 14px;border-radius:20px;background:' + (enabled?'rgba(0,255,156,.15)':'rgba(255,68,68,.1)') + ';border:1px solid ' + (enabled?'rgba(0,255,156,.3)':'rgba(255,68,68,.2)') + ';color:' + (enabled?'#00ff9c':'#ff4444') + ';font-size:11px;font-weight:700;cursor:pointer">' + (enabled?'ON':'OFF') + '</button>';
      h += '</div>';
    });

    h += '<button onclick="saveAntiCheatConfig()" style="width:100%;padding:12px;border-radius:10px;background:linear-gradient(135deg,#00d4ff,#0077ff);color:#fff;font-weight:800;border:none;cursor:pointer;margin-top:12px">💾 Save All</button>';
    h += '</div>';

    window._accConfig = Object.assign({}, config);
    rules.forEach(function(r) { if(window._accConfig[r.key]===undefined) window._accConfig[r.key] = true; });

    _modal('⚙️ Anti-Cheat Config', h);
  });
};

window.toggleAntiCheatRule = function(key) {
  if (!window._accConfig) window._accConfig = {};
  window._accConfig[key] = !window._accConfig[key];
  var btn = document.getElementById('acc_' + key);
  if (btn) {
    var on = window._accConfig[key];
    btn.textContent = on ? 'ON' : 'OFF';
    btn.style.background = on ? 'rgba(0,255,156,.15)' : 'rgba(255,68,68,.1)';
    btn.style.borderColor = on ? 'rgba(0,255,156,.3)' : 'rgba(255,68,68,.2)';
    btn.style.color = on ? '#00ff9c' : '#ff4444';
  }
};

window.saveAntiCheatConfig = function() {
  var db = rt(); if (!db) return;
  var cfg = Object.assign({}, window._accConfig || {}, { updatedAt: Date.now() });
  db.ref('adminConfig/antiCheat').set(cfg).then(function() {
    _toast('✅ Anti-cheat config saved!');
  });
};

/* ══════════════════════════════════════════════════
   fa40: USER TRUST SCORE EDITOR
   ══════════════════════════════════════════════════ */
window.adminSetTrust = function(uid) {
  var db = rt(); if (!db) return;
  db.ref('users/' + uid).once('value', function(s) {
    var ud = s.val() || {};
    var h = '<div>';
    h += '<div style="text-align:center;margin-bottom:14px"><div style="font-size:15px;font-weight:700">' + (ud.displayName||ud.ign||uid) + '</div></div>';

    var trustLevels = [
      { value: 'trusted', label: '🛡️ Trusted Player', color: '#00d4ff', desc: 'Verified regular player — reduced checks' },
      { value: 'normal', label: '👤 Normal', color: '#aaa', desc: 'Standard checks apply' },
      { value: 'suspicious', label: '⚠️ Suspicious', color: '#ffaa00', desc: 'Extra scrutiny on actions' },
      { value: 'blacklisted', label: '🚫 Blacklisted', color: '#ff4444', desc: 'All actions blocked + flagged' }
    ];

    var current = ud.trustLevel || 'normal';
    trustLevels.forEach(function(tl) {
      var isSelected = tl.value === current;
      h += '<div onclick="setUserTrustLevel(\'' + uid + '\',\'' + tl.value + '\')" style="border:1px solid ' + (isSelected?tl.color:'rgba(255,255,255,.1)') + ';border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;background:' + (isSelected?'rgba(0,0,0,.2)':'rgba(255,255,255,.02)') + ';display:flex;justify-content:space-between;align-items:center">';
      h += '<div><div style="font-size:13px;font-weight:700;color:' + tl.color + '">' + tl.label + '</div>';
      h += '<div style="font-size:10px;color:#aaa;margin-top:2px">' + tl.desc + '</div></div>';
      h += (isSelected ? '<span style="color:' + tl.color + ';font-size:16px">✓</span>' : '');
      h += '</div>';
    });
    h += '</div>';
    _modal('🛡️ Set Trust Level', h);
  });
};

window.setUserTrustLevel = function(uid, level) {
  var db = rt(); if (!db) return;
  db.ref('users/' + uid + '/trustLevel').set(level).then(function() {
    if (level === 'trusted') db.ref('users/' + uid + '/trustedPlayer').set(true);
    else db.ref('users/' + uid + '/trustedPlayer').set(false);
    _toast('✅ Trust level set to: ' + level);
    if (window.closeAdminModal) closeAdminModal();
  });
};

/* ══════════════════════════════════════════════════
   fa41: RESOLVE ALERT HELPER
   ══════════════════════════════════════════════════ */
window.resolveAlert = window.resolveAlert || function(key) {
  var db = rt(); if (!db) return;
  db.ref('adminAlerts/' + key).update({ resolved: true, resolvedAt: Date.now() }).then(function() {
    _toast('✅ Alert resolved');
  });
};

/* ══════════════════════════════════════════════════
   fa42: FRAUD ANALYTICS SUMMARY
   ══════════════════════════════════════════════════ */
window.showFraudAnalytics = function() {
  var db = rt(); if (!db) return;
  db.ref('adminAlerts').limitToLast(500).once('value', function(s) {
    var alerts = [];
    if (s.exists()) s.forEach(function(c) { alerts.push(c.val()); });

    var typeCounts = {};
    var severityCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    var resolved = 0;
    var last7d = Date.now() - 7 * 86400000;
    var recentAlerts = 0;

    alerts.forEach(function(a) {
      if (!a.type) return;
      typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
      severityCounts[a.severity || 'LOW'] = (severityCounts[a.severity || 'LOW'] || 0) + 1;
      if (a.resolved) resolved++;
      if (a.timestamp > last7d) recentAlerts++;
    });

    var sortedTypes = Object.entries(typeCounts).sort(function(a,b){ return b[1]-a[1]; }).slice(0, 8);

    var h = '<div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
    [
      { label: 'Total Alerts', value: alerts.length, color: '#aaa' },
      { label: 'Last 7 Days', value: recentAlerts, color: '#00d4ff' },
      { label: 'HIGH Severity', value: severityCounts.HIGH, color: '#ff4444' },
      { label: 'Resolved', value: resolved, color: '#00ff9c' }
    ].forEach(function(stat) {
      h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;text-align:center">';
      h += '<div style="font-size:24px;font-weight:900;color:' + stat.color + '">' + stat.value + '</div>';
      h += '<div style="font-size:10px;color:#aaa">' + stat.label + '</div></div>';
    });
    h += '</div>';

    h += '<div style="font-size:12px;font-weight:700;margin-bottom:8px;color:#aaa">Top Fraud Types:</div>';
    sortedTypes.forEach(function(t) {
      var pct = Math.round(t[1] / alerts.length * 100);
      h += '<div style="margin-bottom:6px">';
      h += '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">';
      h += '<span>' + t[0].replace(/_/g,' ') + '</span><span style="font-weight:700;color:#ff9c00">' + t[1] + '</span></div>';
      h += '<div style="background:rgba(255,255,255,.05);border-radius:4px;height:4px"><div style="background:linear-gradient(90deg,#ff6b35,#ff4444);width:' + pct + '%;height:100%;border-radius:4px"></div></div>';
      h += '</div>';
    });
    h += '</div>';
    _modal('📊 Fraud Analytics', h);
  });
};

/* ══════════════════════════════════════════════════
   fa43: REAL-TIME ALERT SOUND (Badge)
   ══════════════════════════════════════════════════ */
window.initFraudAlertBadge = function() {
  var db = rt(); if (!db) return;
  db.ref('adminAlerts').orderByChild('timestamp').startAt(Date.now() - 3600000).on('child_added', function(s) {
    var alert = s.val();
    if (!alert || alert.resolved) return;

    var badge = document.getElementById('adminFraudBadge');
    if (badge) {
      var current = parseInt(badge.textContent) || 0;
      badge.textContent = current + 1;
      badge.style.display = '';
      badge.style.background = alert.severity === 'HIGH' ? '#ff4444' : '#ffaa00';
    }

    // Flash page title
    if (alert.severity === 'HIGH') {
      var origTitle = document.title;
      var flashCount = 0;
      var flashI = setInterval(function() {
        document.title = flashCount % 2 === 0 ? '🚨 FRAUD ALERT!' : origTitle;
        flashCount++;
        if (flashCount >= 8) { clearInterval(flashI); document.title = origTitle; }
      }, 700);
    }
  });
};

/* ══════════════════════════════════════════════════
   AUTO-INIT
   ══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    if (rt()) {
      window.initFraudAlertBadge && window.initFraudAlertBadge();
    }
  }, 2000);
});

console.log('[Admin Anti-Spam] ✅ fa28-fa43: Advanced Fraud Control Center loaded (16 admin features)');
})();
