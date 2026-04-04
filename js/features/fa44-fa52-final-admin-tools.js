/* ====== ADMIN ANTI-SPAM FEATURES fa44-fa52: FINAL ADMIN FRAUD TOOLS ======
   fa44 - One-Click User Evidence Pack
   fa45 - Blacklist Import/Export Tool
   fa46 - Referral Fraud Network Visualizer
   fa47 - Login Anomaly Monitor
   fa48 - VPN/Device Flag Review
   fa49 - Auto-Escalation Rules
   fa50 - Withdrawal Pattern Monitor
   fa51 - Suspicious Match Result Review
   fa52 - Admin Fraud Notes (case management)
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
   fa44: ONE-CLICK USER EVIDENCE PACK
   (Downloads all fraud data for a user as JSON)
   ══════════════════════════════════════════════════ */
window.downloadUserEvidencePack = function(uid) {
  var db = rt(); if (!db) { _toast('DB not connected'); return; }
  _toast('⏳ Evidence pack generate ho rahi hai...');

  Promise.all([
    db.ref('users/' + uid).once('value'),
    db.ref('joinRequests').orderByChild('userId').equalTo(uid).limitToLast(50).once('value'),
    db.ref('coinRequests').orderByChild('uid').equalTo(uid).limitToLast(30).once('value'),
    db.ref('adminAlerts').orderByChild('uid').equalTo(uid).limitToLast(30).once('value'),
    db.ref('cheatReports').orderByChild('reportedByUid').equalTo(uid).limitToLast(20).once('value'),
    db.ref('deviceJoins').once('value')
  ]).then(function(results) {
    var userData = results[0].val() || {};
    var joinReqs = {}; if(results[1].exists()) results[1].forEach(function(c){ joinReqs[c.key]=c.val(); });
    var coinReqs = {}; if(results[2].exists()) results[2].forEach(function(c){ coinReqs[c.key]=c.val(); });
    var alerts = {}; if(results[3].exists()) results[3].forEach(function(c){ alerts[c.key]=c.val(); });
    var cheatRpts = {}; if(results[4].exists()) results[4].forEach(function(c){ cheatRpts[c.key]=c.val(); });

    // Device join history
    var deviceHistory = {};
    if(results[5].exists()) {
      results[5].forEach(function(devSnap) {
        devSnap.forEach(function(matchSnap) {
          var d = matchSnap.val();
          if (d && d.uid === uid) {
            deviceHistory[devSnap.key + '_' + matchSnap.key] = { device: devSnap.key, match: matchSnap.key, data: d };
          }
        });
      });
    }

    var pack = {
      generatedAt: new Date().toISOString(),
      generatedBy: 'Admin Panel',
      targetUID: uid,
      userData: userData,
      fraudScore: window.calculateFraudScore ? window.calculateFraudScore(userData) : 'N/A',
      joinRequests: joinReqs,
      coinRequests: coinReqs,
      adminAlerts: alerts,
      cheatReportsBy: cheatRpts,
      deviceHistory: deviceHistory,
      summary: {
        totalJoins: Object.keys(joinReqs).length,
        totalDeposits: Object.keys(coinReqs).length,
        totalAlerts: Object.keys(alerts).length,
        cheatReports: Object.keys(cheatRpts).length,
        deviceCount: Object.keys(deviceHistory).length,
        accountCreated: userData.createdAt ? new Date(Number(userData.createdAt)).toISOString() : 'Unknown',
        banned: userData.banned || false,
        flags: userData.flags || {}
      }
    };

    var json = JSON.stringify(pack, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'evidence_' + uid.slice(0,8) + '_' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    _toast('✅ Evidence pack downloaded! (' + Object.keys(alerts).length + ' alerts, ' + Object.keys(joinReqs).length + ' joins)');
  }).catch(function(e) { _toast('Error: ' + e.message); });
};

/* ══════════════════════════════════════════════════
   fa45: BLACKLIST IMPORT/EXPORT TOOL
   ══════════════════════════════════════════════════ */
window.showBlacklistIOTool = function() {
  var h = '<div>';
  h += '<div style="margin-bottom:14px">';
  h += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">📤 Export Blacklists</div>';
  h += '<div style="display:flex;gap:6px">';
  h += '<button onclick="exportBlacklist(\'utrBlacklist\',\'utr_blacklist\')" style="flex:1;padding:9px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#aaa;font-size:12px;font-weight:700;cursor:pointer">💸 UTR List</button>';
  h += '<button onclick="exportBlacklist(\'deviceBlacklist\',\'device_blacklist\')" style="flex:1;padding:9px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#aaa;font-size:12px;font-weight:700;cursor:pointer">📱 Device List</button>';
  h += '</div></div>';

  h += '<div style="border-top:1px solid rgba(255,255,255,.06);padding-top:14px">';
  h += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">📥 Import Blacklist</div>';
  h += '<div style="font-size:11px;color:#aaa;margin-bottom:8px">JSON file upload karo (exported format mein)</div>';
  h += '<input type="file" id="blImportFile" accept=".json" style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#aaa;font-size:12px;box-sizing:border-box;cursor:pointer">';
  h += '<button onclick="importBlacklist()" style="width:100%;padding:11px;border-radius:9px;background:linear-gradient(135deg,#00d4ff,#0077ff);color:#fff;font-weight:800;border:none;cursor:pointer;margin-top:8px">📥 Import</button>';
  h += '</div></div>';
  _modal('📋 Blacklist Import/Export', h);
};

window.exportBlacklist = function(ref, filename) {
  var db = rt(); if (!db) return;
  db.ref(ref).once('value', function(s) {
    var data = s.val() || {};
    var json = JSON.stringify({ ref: ref, exportedAt: new Date().toISOString(), data: data }, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename + '_' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    _toast('✅ Exported: ' + Object.keys(data).length + ' entries');
  });
};

window.importBlacklist = function() {
  var file = (document.getElementById('blImportFile')||{}).files;
  if (!file || !file[0]) { _toast('File select karo'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var parsed = JSON.parse(e.target.result);
      if (!parsed.ref || !parsed.data) { _toast('Invalid format'); return; }
      var db = rt(); if (!db) return;
      db.ref(parsed.ref).update(parsed.data).then(function() {
        _toast('✅ Imported ' + Object.keys(parsed.data).length + ' entries to ' + parsed.ref);
      });
    } catch(err) { _toast('Parse error: ' + err.message); }
  };
  reader.readAsText(file[0]);
};

/* ══════════════════════════════════════════════════
   fa46: REFERRAL FRAUD NETWORK VISUALIZER
   ══════════════════════════════════════════════════ */
window.showReferralFraudNetwork = function() {
  var db = rt(); if (!db) return;
  db.ref('adminAlerts').orderByChild('type').equalTo('referral_abuse').limitToLast(20).once('value', function(s) {
    var abusers = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; abusers.push(d); });

    db.ref('adminAlerts').orderByChild('type').equalTo('referral_chain_abuse').limitToLast(20).once('value', function(s2) {
      if (s2.exists()) s2.forEach(function(c) { var d = c.val(); d._key = c.key; abusers.push(d); });

      var h = '<div style="max-height:65vh;overflow-y:auto">';
      if (!abusers.length) { h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi referral fraud detect nahi hua</div>'; }

      abusers.forEach(function(alert) {
        h += '<div style="background:rgba(255,170,0,.06);border:1px solid rgba(255,170,0,.2);border-radius:10px;padding:10px;margin-bottom:8px">';
        h += '<div style="font-size:12px;font-weight:700;color:#ffaa00;margin-bottom:4px">🔗 ' + (alert.type||'').replace(/_/g,' ').toUpperCase() + '</div>';
        h += '<div style="font-size:11px;color:#ddd;margin-bottom:6px">' + (alert.message||'') + '</div>';
        if (alert.uid) h += '<div style="font-size:10px;color:#aaa">Main UID: <span style="font-family:monospace;color:#ff9c00">' + alert.uid + '</span></div>';
        if (alert.existingCount) h += '<div style="font-size:10px;color:#aaa">Total referrals: <span style="color:#ff4444;font-weight:700">' + alert.existingCount + '</span></div>';
        if (alert.uniqueDevices) h += '<div style="font-size:10px;color:#aaa">Unique devices: <span style="color:#ffaa00;font-weight:700">' + alert.uniqueDevices + '</span></div>';
        h += '<div style="display:flex;gap:6px;margin-top:8px">';
        h += '<button onclick="adminBanUser(\'' + (alert.uid||'') + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.25);color:#ff4444;font-size:11px;font-weight:700;cursor:pointer">🚫 Ban</button>';
        h += '<button onclick="revokeReferralBonus(\'' + (alert.uid||'') + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,170,0,.1);border:1px solid rgba(255,170,0,.25);color:#ffaa00;font-size:11px;cursor:pointer">💸 Revoke Bonus</button>';
        h += '</div></div>';
      });
      h += '</div>';
      _modal('🔗 Referral Fraud Network (' + abusers.length + ')', h);
    });
  });
};

window.revokeReferralBonus = function(uid) {
  if (!uid) { _toast('UID required'); return; }
  var db = rt(); if (!db) return;

  if (!confirm('Kya aap ' + uid + ' ka referral bonus revoke karna chahte hain?')) return;

  // Get referral bonus coins and deduct
  db.ref('users/' + uid + '/referralBonusCoins').once('value', function(s) {
    var bonusCoins = Number(s.val()) || 0;
    if (bonusCoins <= 0) { _toast('No referral bonus found for this user'); return; }

    db.ref('users/' + uid + '/coins').transaction(function(c) {
      return Math.max(0, (Number(c)||0) - bonusCoins);
    }).then(function() {
      db.ref('users/' + uid + '/referralBonusRevoked').set({ amount: bonusCoins, revokedAt: Date.now(), reason: 'Referral fraud' });
      db.ref('users/' + uid + '/referralBonusCoins').set(0);
      _toast('✅ Revoked ' + bonusCoins + ' referral bonus coins from ' + uid);
    });
  });
};

/* ══════════════════════════════════════════════════
   fa47: LOGIN ANOMALY MONITOR
   ══════════════════════════════════════════════════ */
window.showLoginAnomalies = function() {
  var db = rt(); if (!db) return;
  db.ref('adminAlerts').orderByChild('type').equalTo('login_anomaly').limitToLast(30).once('value', function(s) {
    var anomalies = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; if(!d.resolved) anomalies.push(d); });
    anomalies.sort(function(a,b){ return b.timestamp - a.timestamp; });

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    if (!anomalies.length) {
      h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi login anomaly nahi</div>';
    }

    anomalies.forEach(function(alert) {
      h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,170,0,.15);border-radius:10px;padding:10px;margin-bottom:8px">';
      h += '<div style="font-size:12px;font-weight:700;margin-bottom:4px">🔐 Login Anomaly</div>';
      if (alert.message) h += '<div style="font-size:11px;color:#ddd;margin-bottom:4px">' + alert.message + '</div>';
      if (alert.uid) h += '<div style="font-size:10px;color:#aaa">UID: <span style="font-family:monospace;color:#00d4ff">' + alert.uid + '</span></div>';
      h += '<div style="font-size:10px;color:#666;margin-top:3px">' + new Date(alert.timestamp).toLocaleString('en-IN') + '</div>';
      h += '<div style="display:flex;gap:6px;margin-top:8px">';
      h += '<button onclick="adminBanUser(\'' + (alert.uid||'') + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);color:#ff4444;font-size:11px;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="resolveAlert(\'' + alert._key + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);color:#00ff9c;font-size:11px;cursor:pointer">✅ OK</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal('🔐 Login Anomalies (' + anomalies.length + ')', h);
  });
};

/* ══════════════════════════════════════════════════
   fa48: VPN/DEVICE FLAG REVIEW
   ══════════════════════════════════════════════════ */
window.showVPNFlagReview = function() {
  var db = rt(); if (!db) return;
  var types = ['vpn_proxy_suspected', 'webrtc_vpn_detected', 'emulator_detected'];
  var promises = types.map(function(t) {
    return db.ref('adminAlerts').orderByChild('type').equalTo(t).limitToLast(15).once('value');
  });

  Promise.all(promises).then(function(snaps) {
    var alerts = [];
    snaps.forEach(function(s) {
      if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; if(!d.resolved) alerts.push(d); });
    });
    alerts.sort(function(a,b){ return b.timestamp - a.timestamp; });

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    if (!alerts.length) h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi VPN/device flag nahi</div>';

    alerts.forEach(function(alert) {
      var icon = alert.type === 'emulator_detected' ? '🤖' : '🔒';
      h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,170,0,.15);border-radius:10px;padding:10px;margin-bottom:8px">';
      h += '<div style="font-size:12px;font-weight:700;margin-bottom:4px">' + icon + ' ' + (alert.type||'').replace(/_/g,' ').toUpperCase() + '</div>';
      h += '<div style="font-size:11px;color:#ddd;margin-bottom:4px">' + (alert.message||'') + '</div>';
      if (alert.uid) h += '<div style="font-size:10px;color:#aaa">UID: <span style="font-family:monospace;color:#00d4ff">' + alert.uid + '</span></div>';
      if (alert.signals && alert.signals.length) {
        h += '<div style="font-size:10px;color:#aaa;margin-top:3px">Signals: ' + alert.signals.join(', ') + '</div>';
      }
      h += '<div style="display:flex;gap:6px;margin-top:8px">';
      h += '<button onclick="blockDevice(\'' + (alert.deviceFP||'unknown') + '\',\'VPN abuse\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(255,170,0,.1);border:1px solid rgba(255,170,0,.25);color:#ffaa00;font-size:10px;font-weight:700;cursor:pointer">📱 Block Device</button>';
      h += '<button onclick="adminBanUser(\'' + (alert.uid||'') + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);color:#ff4444;font-size:10px;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="resolveAlert(\'' + alert._key + '\')" style="padding:6px 8px;border-radius:7px;background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);color:#00ff9c;font-size:10px;cursor:pointer">✅</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal(icon + ' VPN/Device Flags (' + alerts.length + ')', h);
  });
};

/* ══════════════════════════════════════════════════
   fa49: WITHDRAWAL PATTERN MONITOR
   ══════════════════════════════════════════════════ */
window.showWithdrawalPatternMonitor = function() {
  var db = rt(); if (!db) return;
  db.ref('withdrawalRequests').orderByChild('requestedAt').limitToLast(50).once('value', function(s) {
    if (!s.exists()) { _toast('No withdrawal data'); return; }

    var byUser = {};
    s.forEach(function(c) {
      var d = c.val(); d._key = c.key;
      if (!d.uid) return;
      if (!byUser[d.uid]) byUser[d.uid] = [];
      byUser[d.uid].push(d);
    });

    var suspicious = [];
    Object.entries(byUser).forEach(function(entry) {
      var uid = entry[0], reqs = entry[1];
      var total = reqs.reduce(function(sum, r) { return sum + (Number(r.amount)||0); }, 0);
      var last24h = reqs.filter(function(r) { return r.requestedAt > Date.now() - 86400000; });
      var last24total = last24h.reduce(function(sum, r) { return sum + (Number(r.amount)||0); }, 0);

      if (last24total > 3000 || last24h.length >= 3) {
        suspicious.push({ uid: uid, last24total: last24total, count24h: last24h.length, allTotal: total });
      }
    });

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    if (!suspicious.length) {
      h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi suspicious withdrawal pattern nahi</div>';
    } else {
      suspicious.sort(function(a,b){ return b.last24total - a.last24total; });
      suspicious.forEach(function(u) {
        h += '<div style="background:rgba(255,68,68,.05);border:1px solid rgba(255,68,68,.2);border-radius:10px;padding:10px;margin-bottom:8px">';
        h += '<div style="font-size:12px;font-weight:700;margin-bottom:4px">💸 Suspicious Withdrawals</div>';
        h += '<div style="font-size:10px;color:#aaa">UID: <span style="font-family:monospace;color:#00d4ff">' + u.uid + '</span></div>';
        h += '<div style="font-size:11px;color:#ff6464;font-weight:700;margin-top:4px">₹' + u.last24total + ' in 24h (' + u.count24h + ' requests)</div>';
        h += '<div style="display:flex;gap:6px;margin-top:8px">';
        h += '<button onclick="showCoinAuditTrail(\'' + u.uid + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-size:11px;cursor:pointer">💰 Audit</button>';
        h += '<button onclick="adminBanUser(\'' + u.uid + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.25);color:#ff4444;font-size:11px;cursor:pointer">🚫 Ban</button>';
        h += '</div></div>';
      });
    }
    h += '</div>';
    _modal('💸 Withdrawal Pattern Monitor (' + suspicious.length + ' suspicious)', h);
  });
};

/* ══════════════════════════════════════════════════
   fa50: ADMIN FRAUD NOTES (Case Management)
   ══════════════════════════════════════════════════ */
window.showFraudNotes = function(uid) {
  var db = rt(); if (!db) return;
  db.ref('fraudCases/' + uid).once('value', function(s) {
    var caseData = s.val() || { notes: [], status: 'open' };
    var notes = caseData.notes || [];

    var h = '<div>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    h += '<div style="font-family:monospace;font-size:11px;color:#aaa">' + uid + '</div>';
    h += '<span style="padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;background:' + (caseData.status==='open'?'rgba(255,68,68,.15)':'rgba(0,255,156,.1)') + ';color:' + (caseData.status==='open'?'#ff4444':'#00ff9c') + '">' + (caseData.status||'open').toUpperCase() + '</span>';
    h += '</div>';

    h += '<div style="max-height:200px;overflow-y:auto;margin-bottom:12px">';
    if (!notes.length) { h += '<div style="text-align:center;color:#aaa;padding:10px;font-size:12px">Koi notes nahi abhi tak</div>'; }
    notes.forEach(function(note) {
      h += '<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px;margin-bottom:6px">';
      h += '<div style="font-size:12px;color:#ddd">' + note.text + '</div>';
      h += '<div style="font-size:10px;color:#aaa;margin-top:3px">' + new Date(note.at).toLocaleString('en-IN') + '</div>';
      h += '</div>';
    });
    h += '</div>';

    h += '<textarea id="fnNote" rows="3" placeholder="Admin note likho..." style="width:100%;padding:9px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt);font-size:12px;resize:none;box-sizing:border-box;margin-bottom:8px"></textarea>';
    h += '<div style="display:flex;gap:8px">';
    h += '<button onclick="addFraudNote(\'' + uid + '\')" style="flex:1;padding:11px;border-radius:9px;background:linear-gradient(135deg,#ff6b35,#ff4444);color:#fff;font-weight:800;border:none;cursor:pointer">➕ Add Note</button>';
    h += '<button onclick="closeFraudCase(\'' + uid + '\')" style="padding:11px 14px;border-radius:9px;background:rgba(0,255,156,.08);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-weight:700;cursor:pointer">' + (caseData.status==='open'?'✅ Close':'🔄 Reopen') + '</button>';
    h += '</div></div>';
    _modal('📋 Case: ' + uid.slice(0,8) + '...', h);
  });
};

window.addFraudNote = function(uid) {
  var db = rt(); if (!db) return;
  var text = (document.getElementById('fnNote')||{}).value || '';
  if (!text.trim()) { _toast('Note empty hai'); return; }

  var newNote = { text: text.trim(), at: Date.now(), by: 'admin' };
  db.ref('fraudCases/' + uid + '/notes').push(newNote).then(function() {
    db.ref('fraudCases/' + uid + '/status').set('open');
    db.ref('fraudCases/' + uid + '/lastUpdated').set(Date.now());
    _toast('✅ Note added');
    setTimeout(function(){ window.showFraudNotes(uid); }, 300);
  });
};

window.closeFraudCase = function(uid) {
  var db = rt(); if (!db) return;
  db.ref('fraudCases/' + uid + '/status').once('value', function(s) {
    var current = s.val() || 'open';
    var newStatus = current === 'open' ? 'closed' : 'open';
    db.ref('fraudCases/' + uid + '/status').set(newStatus).then(function() {
      _toast((newStatus === 'closed' ? '✅ Case closed' : '🔄 Case reopened') + ': ' + uid.slice(0,8));
      setTimeout(function(){ window.showFraudNotes(uid); }, 300);
    });
  });
};

/* ══════════════════════════════════════════════════
   fa51: SUSPICIOUS MATCH RESULT REVIEW
   ══════════════════════════════════════════════════ */
window.showSuspiciousResultReview = function() {
  var db = rt(); if (!db) return;
  db.ref('adminAlerts').orderByChild('type').equalTo('result_too_fast').limitToLast(20).once('value', function(s) {
    var alerts = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; if(!d.resolved) alerts.push(d); });
    alerts.sort(function(a,b){ return b.timestamp - a.timestamp; });

    var h = '<div style="max-height:65vh;overflow-y:auto">';
    if (!alerts.length) h += '<div style="text-align:center;padding:20px;color:#aaa">✅ Koi suspicious results nahi</div>';

    alerts.forEach(function(alert) {
      h += '<div style="background:rgba(255,68,68,.05);border:1px solid rgba(255,68,68,.15);border-radius:10px;padding:10px;margin-bottom:8px">';
      h += '<div style="font-size:12px;font-weight:700;margin-bottom:4px">⏱️ Fast Result Submit</div>';
      h += '<div style="font-size:11px;color:#ddd;margin-bottom:4px">' + (alert.message||'') + '</div>';
      h += '<div style="font-size:10px;color:#aaa">UID: <span style="font-family:monospace;color:#00d4ff">' + (alert.uid||'?') + '</span></div>';
      h += '<div style="font-size:10px;color:#aaa">Match: ' + (alert.matchId||'?') + ' | Time: ' + (alert.elapsedMinutes||'?') + ' min</div>';
      h += '<div style="display:flex;gap:6px;margin-top:8px">';
      h += '<button onclick="showFraudNotes(\'' + (alert.uid||'') + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-size:10px;cursor:pointer">📋 Notes</button>';
      h += '<button onclick="adminBanUser(\'' + (alert.uid||'') + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);color:#ff4444;font-size:10px;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="resolveAlert(\'' + alert._key + '\')" style="padding:6px 8px;border-radius:7px;background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);color:#00ff9c;font-size:10px;cursor:pointer">✅</button>';
      h += '</div></div>';
    });
    h += '</div>';
    _modal('⏱️ Suspicious Results (' + alerts.length + ')', h);
  });
};

/* ══════════════════════════════════════════════════
   fa52: ADMIN ANTI-SPAM DASHBOARD (Main Entry Point)
   ══════════════════════════════════════════════════ */
window.showAntiSpamDashboard = function() {
  var h = '<div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';

  var buttons = [
    { icon: '📊', label: 'Fraud Score Dashboard', fn: 'showFraudScoreDashboard()' },
    { icon: '📈', label: 'Fraud Analytics', fn: 'showFraudAnalytics()' },
    { icon: '🚨', label: 'Cheat Reports', fn: 'showCheatReports()' },
    { icon: '🖼️', label: 'Screenshot Fraud', fn: 'showScreenshotFraudQueue()' },
    { icon: '💀', label: 'Kill Fraud Queue', fn: 'showKillFraudQueue()' },
    { icon: '💬', label: 'Chat Abuse Log', fn: 'showChatAbuseLog()' },
    { icon: '🔗', label: 'Referral Network', fn: 'showReferralFraudNetwork()' },
    { icon: '💸', label: 'UTR Blacklist', fn: 'showUTRBlacklist()' },
    { icon: '📱', label: 'Device Blacklist', fn: 'showDeviceBlacklist()' },
    { icon: '🔒', label: 'VPN/Device Flags', fn: 'showVPNFlagReview()' },
    { icon: '💰', label: 'Withdrawal Monitor', fn: 'showWithdrawalPatternMonitor()' },
    { icon: '🔐', label: 'Login Anomalies', fn: 'showLoginAnomalies()' },
    { icon: '⏱️', label: 'Suspicious Results', fn: 'showSuspiciousResultReview()' },
    { icon: '⚠️', label: 'Penalty Manager', fn: 'showPenaltyManager()' },
    { icon: '⚙️', label: 'Auto-Ban Config', fn: 'showAutoBanConfig()' },
    { icon: '🔧', label: 'Anti-Cheat Config', fn: 'showAntiCheatConfig()' },
    { icon: '📋', label: 'Blacklist Import/Export', fn: 'showBlacklistIOTool()' },
    { icon: '📥', label: 'Download Report (CSV)', fn: 'downloadSuspiciousUsersCSV()' }
  ];

  buttons.forEach(function(btn) {
    h += '<button onclick="' + btn.fn + ';if(window.closeAdminModal)closeAdminModal();" style="padding:12px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:var(--txt,#fff);font-size:12px;font-weight:700;cursor:pointer;text-align:left">';
    h += btn.icon + ' ' + btn.label;
    h += '</button>';
  });

  h += '</div></div>';
  _modal('🛡️ Anti-Spam Dashboard', h);
};

console.log('[Admin Anti-Spam] ✅ fa44-fa52: Final Admin Fraud Tools loaded (9 features)');
})();

/* ====== ADMIN GLOBAL ALIASES ======
   Mapping standard function names to actual admin panel functions.
   Used by fraud control features.
*/
(function(){
  // adminBanUser → fa16QuickBan
  window.adminBanUser = window.adminBanUser || function(uid, reason) {
    if (!uid) return;
    var db = window.rtdb || window.db;
    if (!db) return;
    reason = reason || 'Fraud/Anti-spam auto-flag';
    if (!confirm('Ban user: ' + uid + '?\nReason: ' + reason)) return;
    db.ref('users/' + uid).update({
      banned: true,
      banReason: reason,
      bannedAt: Date.now(),
      bannedBy: 'admin-auto'
    }).then(function() {
      if (window.showToast) showToast('🚫 User banned: ' + uid.slice(0,8));
      // Push ban notification to user
      db.ref('users/' + uid + '/notifications').push({
        title: '🚫 Account Suspended',
        message: 'Your account has been suspended. Reason: ' + reason,
        type: 'system',
        timestamp: Date.now(),
        read: false
      });
    });
  };

  // openPlayerProfile / adminViewUser → fa14PlayerLookup or inline search
  window.openPlayerProfile = window.openPlayerProfile || function(uid) {
    if (!uid) return;
    var db = window.rtdb || window.db;
    if (!db) return;
    db.ref('users/' + uid).once('value', function(s) {
      var ud = s.val() || {};
      var h = '<div>';
      h += '<div style="text-align:center;margin-bottom:14px">';
      h += '<div style="font-size:16px;font-weight:800">' + (ud.displayName || ud.ign || uid) + '</div>';
      h += '<div style="font-family:monospace;font-size:11px;color:#aaa;margin-top:3px">' + uid + '</div>';
      if (ud.banned) h += '<div style="color:#ff4444;font-weight:700;margin-top:6px">🚫 BANNED</div>';
      h += '</div>';
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
      [
        { l: 'IGN', v: ud.ign || '-' },
        { l: 'Phone', v: ud.phone ? ud.phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2') : '-' },
        { l: 'Coins', v: ud.coins || 0 },
        { l: 'Matches', v: (ud.stats && ud.stats.matches) || 0 },
        { l: 'Account Age', v: ud.createdAt ? Math.floor((Date.now() - Number(ud.createdAt)) / 86400000) + ' days' : '-' },
        { l: 'Trust Level', v: ud.trustLevel || 'normal' }
      ].forEach(function(item) {
        h += '<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px">';
        h += '<div style="font-size:10px;color:#666">' + item.l + '</div>';
        h += '<div style="font-size:13px;font-weight:700">' + item.v + '</div></div>';
      });
      h += '</div>';
      h += '<div style="display:flex;gap:8px">';
      h += '<button onclick="adminBanUser(\'' + uid + '\')" style="flex:1;padding:10px;border-radius:9px;background:rgba(255,68,68,.12);border:1px solid rgba(255,68,68,.3);color:#ff4444;font-weight:800;cursor:pointer">🚫 Ban</button>';
      h += '<button onclick="showFraudNotes(\'' + uid + '\')" style="flex:1;padding:10px;border-radius:9px;background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.2);color:#ffaa00;font-weight:700;cursor:pointer">📋 Notes</button>';
      h += '<button onclick="showCoinAuditTrail(\'' + uid + '\')" style="flex:1;padding:10px;border-radius:9px;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-weight:700;cursor:pointer">💰 Audit</button>';
      h += '</div></div>';
      if (window.showAdminModal) showAdminModal('👤 User Profile', h);
    });
  };

  window.adminViewUser = window.adminViewUser || window.openPlayerProfile;

  // Global showAdminModal fallback (uses showModal from main admin HTML)
  if (!window.showAdminModal) {
    window.showAdminModal = window.showModal || function(title, html) {
      var overlay = document.getElementById('adminModalOverlay') || document.getElementById('modalOverlay');
      if (overlay) {
        var titleEl = overlay.querySelector('.modal-title, #modalTitle, h2');
        var bodyEl = overlay.querySelector('.modal-body, #modalBody, .modal-content');
        if (titleEl) titleEl.innerHTML = title;
        if (bodyEl) bodyEl.innerHTML = html;
        overlay.style.display = 'flex';
      } else {
        alert(title + '\n(Modal not found)');
      }
    };
  }

  // closeAdminModal fallback
  if (!window.closeAdminModal) {
    window.closeAdminModal = window.closeModal || function() {
      var overlay = document.getElementById('adminModalOverlay') || document.getElementById('modalOverlay');
      if (overlay) overlay.style.display = 'none';
    };
  }

  // calculateFraudScore (used by fa28 dashboard - expose globally)
  if (!window.calculateFraudScore) {
    window.calculateFraudScore = function(userData) {
      var total = 0, factors = [];
      var pp = Number(userData.penaltyPoints) || 0;
      if (pp > 0) { total += pp * 5; factors.push('Penalty: ' + pp + 'pts'); }
      var flags = userData.flags || {};
      if (flags.multiAccount) { total += 30; factors.push('Multi-Account'); }
      if (flags.fakeScreenshot) { total += 25; factors.push('Fake Screenshot'); }
      if (flags.vpnDetected) { total += 15; factors.push('VPN'); }
      if (flags.emulatorSuspected) { total += 20; factors.push('Emulator'); }
      var daysSince = (Date.now() - (Number(userData.createdAt) || Date.now())) / 86400000;
      if (daysSince < 3) { total += 15; factors.push('New Account'); }
      if (userData.banned) { total += 50; factors.push('Banned'); }
      return { total: Math.min(total, 100), factors: factors };
    };
  }

  console.log('[Admin] ✅ Global aliases registered: adminBanUser, openPlayerProfile, showAdminModal, calculateFraudScore');
})();
