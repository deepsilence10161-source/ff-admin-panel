/* ADMIN: Fraud Alert Dashboard + Enhanced Withdrawal Limits
   Firebase adminAlerts ko monitor karo real-time */
(function(){
'use strict';

/* ── Real-time fraud alert count badge ── */
window.initFraudAlerts = function() {
  var rt = window.rtdb || window.db;
  if (!rt) return;

  rt.ref('adminAlerts').orderByChild('timestamp').limitToLast(100).on('value', function(s) {
    var alerts = [];
    if (s.exists()) s.forEach(function(c) {
      var d = c.val(); d._key = c.key;
      if (!d.resolved) alerts.push(d);
    });

    // Badge update
    var badge = document.getElementById('fraudAlertBadge');
    var highAlerts = alerts.filter(function(a) { return a.severity === 'HIGH'; });
    if (badge) {
      badge.textContent = alerts.length;
      badge.style.display = alerts.length ? '' : 'none';
      badge.style.background = highAlerts.length ? '#ff4444' : '#ffaa00';
    }

    window._fraudAlerts = alerts;
  });
};

/* ── Show fraud alerts panel ── */
window.showFraudAlerts = async function() {
  var rt = window.rtdb || window.db;
  if (!rt) return;

  var alerts = window._fraudAlerts || [];

  if (!alerts.length) {
    if (window.showToast) showToast('✅ Koi fraud alert nahi!');
    return;
  }

  var typeIcons = {
    'multi_account': '👥',
    'fake_screenshot_attempt': '🖼️',
    'suspicious_withdrawal': '💸',
    'cheat_detected': '🎯'
  };

  var severityColors = {
    'HIGH': '#ff4444',
    'MEDIUM': '#ffaa00',
    'LOW': '#00ff9c'
  };

  var h = '<div style="max-height:70vh;overflow-y:auto">';

  // Summary stats
  var highCount = alerts.filter(function(a) { return a.severity === 'HIGH'; }).length;
  var medCount = alerts.filter(function(a) { return a.severity === 'MEDIUM'; }).length;
  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">';
  h += '<div style="background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:900;color:#ff4444">' + highCount + '</div><div style="font-size:10px;color:#aaa">HIGH</div></div>';
  h += '<div style="background:rgba(255,170,0,.1);border:1px solid rgba(255,170,0,.2);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:900;color:#ffaa00">' + medCount + '</div><div style="font-size:10px;color:#aaa">MEDIUM</div></div>';
  h += '<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.1);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:900;color:#00ff9c">' + alerts.length + '</div><div style="font-size:10px;color:#aaa">TOTAL</div></div>';
  h += '</div>';

  // Sort HIGH first
  alerts.sort(function(a, b) {
    var order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return (order[a.severity] || 2) - (order[b.severity] || 2);
  });

  alerts.forEach(function(alert) {
    var icon = typeIcons[alert.type] || '⚠️';
    var col = severityColors[alert.severity] || '#aaa';
    var time = new Date(alert.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(' + (alert.severity === 'HIGH' ? '255,68,68' : '255,170,0') + ',.2);border-radius:10px;padding:10px;margin-bottom:8px">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
    h += '<span style="font-size:13px;font-weight:700">' + icon + ' ' + (alert.type || 'Unknown').replace(/_/g, ' ').toUpperCase() + '</span>';
    h += '<span style="font-size:10px;font-weight:700;color:' + col + ';background:rgba(0,0,0,.3);padding:2px 7px;border-radius:8px">' + (alert.severity || 'LOW') + '</span>';
    h += '</div>';

    if (alert.message) h += '<div style="font-size:12px;color:#ddd;margin-bottom:6px">' + alert.message + '</div>';
    if (alert.uid) h += '<div style="font-size:11px;color:#aaa">UID: <span style="font-family:monospace;color:#00d4ff">' + alert.uid + '</span></div>';
    if (alert.fingerprint) h += '<div style="font-size:11px;color:#aaa">Device FP: <span style="font-family:monospace;color:#ff9c00">' + alert.fingerprint + '</span></div>';
    if (alert.utr) h += '<div style="font-size:11px;color:#aaa">UTR: <span style="font-family:monospace;color:#ffd700">' + alert.utr + '</span></div>';
    if (alert.reason) h += '<div style="font-size:11px;color:#ff9c00">Reason: ' + alert.reason + '</div>';
    h += '<div style="font-size:10px;color:#666;margin-top:4px">' + time + '</div>';

    // Action buttons
    h += '<div style="display:flex;gap:6px;margin-top:8px">';
    if (alert.uid) {
      h += '<button onclick="quickBanFromAlert(\'' + alert.uid + '\',\'' + alert._key + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(255,68,68,.15);border:1px solid rgba(255,68,68,.3);color:#ff4444;font-size:11px;font-weight:700;cursor:pointer">🚫 Ban User</button>';
      h += '<button onclick="openPlayerProfile(\'' + alert.uid + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-size:11px;font-weight:700;cursor:pointer">👁️ View User</button>';
    }
    h += '<button onclick="resolveAlert(\'' + alert._key + '\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(0,255,156,.08);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer">✅ Resolve</button>';
    h += '</div>';
    h += '</div>';
  });

  h += '</div>';

  if (window.showAdminModal) showAdminModal('🚨 Fraud Alerts (' + alerts.length + ')', h);
  else if (window.showModal) showModal('🚨 Fraud Alerts', h);
};

window.resolveAlert = function(key) {
  var rt = window.rtdb || window.db;
  if (!rt) return;
  rt.ref('adminAlerts/' + key).update({ resolved: true, resolvedAt: Date.now() });
  if (window.showToast) showToast('✅ Alert resolved');
};

window.quickBanFromAlert = async function(uid, alertKey) {
  var rt = window.rtdb || window.db;
  if (!rt || !uid) return;
  if (!confirm('User ' + uid + ' ko ban karna chahte ho?')) return;
  await rt.ref('users/' + uid + '/banned').set({ banned: true, reason: 'Fraud/Multi-account detected', bannedAt: Date.now(), bannedBy: 'admin' });
  await rt.ref('adminAlerts/' + alertKey).update({ resolved: true, action: 'banned', resolvedAt: Date.now() });
  if (window.showToast) showToast('🚫 User banned!');
  window.showFraudAlerts();
};

/* ── Enhanced Withdrawal Config — Min/Max/Daily + per-user limit ── */
window.showEnhancedWithdrawalConfig = function() {
  var rt = window.rtdb || window.db;
  if (!rt) return;

  rt.ref('appSettings/withdrawal').once('value', function(s) {
    var cfg = s.val() || { minAmount: 50, maxAmount: 5000, dailyLimit: 10000, requireUTR: true, requireScreenshot: false, firstMatchRequired: true };

    var h = '<div style="display:grid;gap:12px">';

    // Amount limits
    h += '<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.15);border-radius:10px;padding:12px">';
    h += '<div style="font-size:12px;font-weight:700;color:#ffd700;margin-bottom:10px">💰 Amount Limits</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Minimum (₹)</label><input type="number" id="wdMin" value="' + (cfg.minAmount||50) + '" style="width:100%;padding:8px;border-radius:8px;background:#111;border:1px solid #333;color:#ffd700;font-size:14px;font-weight:700;text-align:center;box-sizing:border-box"></div>';
    h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Maximum per Request (₹)</label><input type="number" id="wdMax" value="' + (cfg.maxAmount||5000) + '" style="width:100%;padding:8px;border-radius:8px;background:#111;border:1px solid #333;color:#ffd700;font-size:14px;font-weight:700;text-align:center;box-sizing:border-box"></div>';
    h += '</div></div>';

    // Daily limit
    h += '<div style="background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.15);border-radius:10px;padding:12px">';
    h += '<div style="font-size:12px;font-weight:700;color:#00d4ff;margin-bottom:10px">📅 Daily Limit per User</div>';
    h += '<input type="number" id="wdDaily" value="' + (cfg.dailyLimit||10000) + '" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid #333;color:#00d4ff;font-size:16px;font-weight:800;text-align:center;box-sizing:border-box">';
    h += '<div style="font-size:10px;color:#666;margin-top:4px">Is limit ke upar user aaj withdraw nahi kar sakta</div>';
    h += '</div>';

    // Security toggles
    h += '<div style="background:rgba(0,255,156,.04);border:1px solid rgba(0,255,156,.1);border-radius:10px;padding:12px">';
    h += '<div style="font-size:12px;font-weight:700;color:#00ff9c;margin-bottom:10px">🛡️ Security Requirements</div>';
    h += '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin-bottom:8px"><input type="checkbox" id="wdUTR" ' + (cfg.requireUTR ? 'checked' : '') + ' style="width:16px;height:16px"> UTR Number mandatory (Fake payment rokne ke liye)</label>';
    h += '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin-bottom:8px"><input type="checkbox" id="wdSS" ' + (cfg.requireScreenshot ? 'checked' : '') + ' style="width:16px;height:16px"> Payment Screenshot mandatory</label>';
    h += '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="wdFirstMatch" ' + (cfg.firstMatchRequired !== false ? 'checked' : '') + ' style="width:16px;height:16px"> Pehle ek match khela ho (Fraud accounts rokne ke liye)</label>';
    h += '</div>';

    // Auto approve
    h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px">';
    h += '<div style="font-size:12px;font-weight:700;color:#aaa;margin-bottom:8px">⚡ Auto-Approve below (₹) — 0 = manual only</div>';
    h += '<input type="number" id="wdAuto" value="' + (cfg.autoApprove||0) + '" style="width:100%;padding:8px;border-radius:8px;background:#111;border:1px solid #333;color:#aaa;font-size:14px;text-align:center;box-sizing:border-box">';
    h += '</div>';

    h += '<button onclick="saveEnhancedWdConfig()" style="width:100%;padding:12px;border-radius:10px;background:linear-gradient(135deg,#00ff9c,#00d4aa);color:#000;font-weight:800;border:none;cursor:pointer;font-size:14px"><i class="fas fa-save"></i> Save Config</button>';
    h += '</div>';

    if (window.showAdminModal) showAdminModal('⚙️ Withdrawal Config', h);
    else if (window.showModal) showModal('⚙️ Withdrawal Config', h);
  });
};

window.saveEnhancedWdConfig = function() {
  var rt = window.rtdb || window.db;
  if (!rt) return;
  var cfg = {
    minAmount: Number((document.getElementById('wdMin')||{}).value) || 50,
    maxAmount: Number((document.getElementById('wdMax')||{}).value) || 5000,
    dailyLimit: Number((document.getElementById('wdDaily')||{}).value) || 10000,
    autoApprove: Number((document.getElementById('wdAuto')||{}).value) || 0,
    requireUTR: (document.getElementById('wdUTR')||{}).checked || false,
    requireScreenshot: (document.getElementById('wdSS')||{}).checked || false,
    firstMatchRequired: (document.getElementById('wdFirstMatch')||{}).checked !== false,
    updatedAt: Date.now()
  };
  rt.ref('appSettings/withdrawal').set(cfg).then(function() {
    if (window.showToast) showToast('✅ Withdrawal config saved!');
    // Old function bhi update karo for compatibility
    window._saveWdConfig && window._saveWdConfig();
  });
  if (document.getElementById('genericModal')) {
    document.getElementById('genericModal').classList.remove('show');
  }
};

/* ── Override old showWithdrawalConfig with enhanced version ── */
window.showWithdrawalConfig = window.showEnhancedWithdrawalConfig;

/* ── Auto-init on load ── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initFraudAlerts);
} else {
  setTimeout(window.initFraudAlerts, 1500);
}

console.log('[Admin] ✅ Fraud Alerts + Enhanced WD Config loaded');
})();
