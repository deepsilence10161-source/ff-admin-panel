/* ============================================================
   FIX 13: REAL-TIME ANALYTICS DASHBOARD (Admin Panel)
   - Firebase Presence: active users track karo
   - Real-time graph: kis time kitne users active
   - Inject karo existing Admin Panel mein
   ============================================================ */

(function() {
  'use strict';

  /* ── Presence Data Store ── */
  var _presenceData  = {};   // uid → { lastSeen, online, page }
  var _hourlyBuckets = {};   // 'YYYY-MM-DD-HH' → peakCount
  var _chart         = null;
  var _chartCtx      = null;
  var _panelVisible  = false;

  /* ── Register THIS admin's presence ── */
  function registerPresence() {
    if (!window.db || !window.firebase) return;
    var uid = (window.currentAdminUid || 'admin');

    var presRef    = db.ref('presence/' + uid);
    var connRef    = db.ref('.info/connected');

    connRef.on('value', function(s) {
      if (s.val() !== true) return;
      presRef.onDisconnect().remove();
      presRef.set({
        online:   true,
        role:     'admin',
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
        page:     'admin-panel'
      });
    });
  }

  /* ── Listen to all presence nodes ── */
  function listenPresence() {
    if (!window.db) return;
    db.ref('presence').on('value', function(s) {
      _presenceData = {};
      if (s.exists()) {
        s.forEach(function(c) {
          var v = c.val();
          if (v && v.online) _presenceData[c.key] = v;
        });
      }
      var count = Object.keys(_presenceData).length;
      /* Record hourly bucket */
      var now  = new Date();
      var key  = now.getFullYear() + '-' +
                 String(now.getMonth()+1).padStart(2,'0') + '-' +
                 String(now.getDate()).padStart(2,'0') + '-' +
                 String(now.getHours()).padStart(2,'0');
      _hourlyBuckets[key] = Math.max(_hourlyBuckets[key]||0, count);
      /* Save to Firebase for persistence */
      db.ref('analytics/hourlyPeak/' + key).transaction(function(cur) {
        return Math.max(cur||0, count);
      });

      updatePanel(count);
    });
    /* Load historical hourly data */
    loadHistoricalBuckets();
  }

  function loadHistoricalBuckets() {
    var ago24h = new Date(Date.now() - 24*3600*1000);
    db.ref('analytics/hourlyPeak')
      .orderByKey()
      .startAt(fmtKey(ago24h))
      .once('value', function(s) {
        if (s.exists()) s.forEach(function(c) { _hourlyBuckets[c.key] = c.val(); });
        if (_chart) refreshChart();
      });
  }

  function fmtKey(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth()+1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0') + '-' +
           String(d.getHours()).padStart(2,'0');
  }

  /* ── Build/Update the panel ── */
  function buildPanel() {
    if (document.getElementById('rtAnalyticsPanel')) return;

    var panel = document.createElement('div');
    panel.id  = 'rtAnalyticsPanel';
    panel.style.cssText = [
      'background:var(--card,#1a1a2e)',
      'border:1px solid rgba(0,212,255,.2)',
      'border-radius:16px',
      'padding:20px',
      'margin:16px 0',
      'display:none'
    ].join(';');

    panel.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">',
        '<h3 style="margin:0;font-size:15px;font-weight:800;color:var(--info,#00d4ff)">',
          '📡 Real-Time User Activity',
        '</h3>',
        '<div style="display:flex;gap:8px;align-items:center">',
          '<div id="rtOnlineDot" style="width:8px;height:8px;border-radius:50%;background:#00ff9c;animation:rtPulse 1.5s infinite"></div>',
          '<span id="rtOnlineCount" style="font-size:13px;font-weight:700;color:#00ff9c">0 online</span>',
        '</div>',
      '</div>',

      /* Stat cards */
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">',
        '<div style="background:rgba(0,255,156,.08);border:1px solid rgba(0,255,156,.2);border-radius:10px;padding:12px;text-align:center">',
          '<div id="rtCount24h" style="font-size:22px;font-weight:800;color:#00ff9c">—</div>',
          '<div style="font-size:10px;color:#aaa;margin-top:2px">Peak 24h</div>',
        '</div>',
        '<div style="background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);border-radius:10px;padding:12px;text-align:center">',
          '<div id="rtCountNow" style="font-size:22px;font-weight:800;color:#00d4ff">0</div>',
          '<div style="font-size:10px;color:#aaa;margin-top:2px">Right Now</div>',
        '</div>',
        '<div style="background:rgba(255,183,0,.08);border:1px solid rgba(255,183,0,.2);border-radius:10px;padding:12px;text-align:center">',
          '<div id="rtCountPeak" style="font-size:22px;font-weight:800;color:#ffb700">—</div>',
          '<div style="font-size:10px;color:#aaa;margin-top:2px">Today\'s Peak</div>',
        '</div>',
      '</div>',

      /* Chart */
      '<div style="position:relative;height:140px;margin-bottom:12px">',
        '<canvas id="rtActivityChart" style="width:100%;height:100%"></canvas>',
      '</div>',

      /* Active pages breakdown */
      '<div id="rtPagesBreakdown" style="font-size:11px;color:#aaa;display:flex;gap:12px;flex-wrap:wrap"></div>',

      /* Recent active users table */
      '<div style="margin-top:14px">',
        '<div style="font-size:11px;font-weight:700;color:#aaa;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Active Users</div>',
        '<div id="rtUsersList" style="max-height:160px;overflow-y:auto"></div>',
      '</div>',

      /* Inject CSS */
      '<style>',
        '@keyframes rtPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}',
        '#rtAnalyticsPanel::-webkit-scrollbar{width:4px}',
        '.rtUserRow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:11px;margin-bottom:4px;background:rgba(255,255,255,.03)}',
      '</style>'
    ].join('');

    /* Find a good insertion point in admin panel */
    var target = document.querySelector('.stats-grid, .admin-stats, [id*="stats"], [class*="stats"]')
              || document.querySelector('main, .main-content, #mainContent, .container')
              || document.body;

    target.prepend(panel);
    initChart();
    return panel;
  }

  /* ── Chart (no external dep — pure Canvas) ── */
  function initChart() {
    var canvas = document.getElementById('rtActivityChart');
    if (!canvas) return;
    _chartCtx = canvas.getContext('2d');
    canvas.width  = canvas.offsetWidth  || 400;
    canvas.height = canvas.offsetHeight || 140;
    refreshChart();
  }

  function refreshChart() {
    if (!_chartCtx) return;
    var canvas = _chartCtx.canvas;
    var W = canvas.width, H = canvas.height;

    /* Build last 24 hourly labels */
    var labels = [], values = [];
    for (var i = 23; i >= 0; i--) {
      var d   = new Date(Date.now() - i * 3600000);
      var key = fmtKey(d);
      labels.push(d.getHours() + 'h');
      values.push(_hourlyBuckets[key] || 0);
    }

    var maxVal = Math.max.apply(null, values.concat([1]));
    var pad    = { top: 12, right: 10, bottom: 24, left: 28 };
    var gW     = W - pad.left - pad.right;
    var gH     = H - pad.top  - pad.bottom;

    _chartCtx.clearRect(0, 0, W, H);

    /* Grid lines */
    _chartCtx.strokeStyle = 'rgba(255,255,255,.06)';
    _chartCtx.lineWidth   = 1;
    for (var gi = 0; gi <= 4; gi++) {
      var gy = pad.top + gH - (gi / 4) * gH;
      _chartCtx.beginPath();
      _chartCtx.moveTo(pad.left, gy);
      _chartCtx.lineTo(pad.left + gW, gy);
      _chartCtx.stroke();
      _chartCtx.fillStyle = 'rgba(255,255,255,.3)';
      _chartCtx.font      = '9px monospace';
      _chartCtx.fillText(Math.round(maxVal * gi / 4), 2, gy + 3);
    }

    /* Area fill */
    var step = gW / (values.length - 1 || 1);
    _chartCtx.beginPath();
    _chartCtx.moveTo(pad.left, pad.top + gH);
    values.forEach(function(v, idx) {
      var x = pad.left + idx * step;
      var y = pad.top  + gH - (v / maxVal) * gH;
      idx === 0 ? _chartCtx.lineTo(x, y) : _chartCtx.lineTo(x, y);
    });
    _chartCtx.lineTo(pad.left + (values.length - 1) * step, pad.top + gH);
    _chartCtx.closePath();
    var grad = _chartCtx.createLinearGradient(0, pad.top, 0, pad.top + gH);
    grad.addColorStop(0, 'rgba(0,212,255,.35)');
    grad.addColorStop(1, 'rgba(0,212,255,.02)');
    _chartCtx.fillStyle = grad;
    _chartCtx.fill();

    /* Line */
    _chartCtx.beginPath();
    _chartCtx.strokeStyle = '#00d4ff';
    _chartCtx.lineWidth   = 2;
    _chartCtx.lineJoin    = 'round';
    values.forEach(function(v, idx) {
      var x = pad.left + idx * step;
      var y = pad.top  + gH - (v / maxVal) * gH;
      idx === 0 ? _chartCtx.moveTo(x, y) : _chartCtx.lineTo(x, y);
    });
    _chartCtx.stroke();

    /* X labels (every 6h) */
    _chartCtx.fillStyle = 'rgba(255,255,255,.4)';
    _chartCtx.font      = '9px monospace';
    labels.forEach(function(l, idx) {
      if (idx % 6 !== 0) return;
      var x = pad.left + idx * step;
      _chartCtx.fillText(l, x - 6, H - 4);
    });

    /* Peak marker */
    var peakIdx = values.indexOf(Math.max.apply(null, values));
    if (peakIdx >= 0 && values[peakIdx] > 0) {
      var px = pad.left + peakIdx * step;
      var py = pad.top  + gH - (values[peakIdx] / maxVal) * gH;
      _chartCtx.beginPath();
      _chartCtx.arc(px, py, 4, 0, Math.PI * 2);
      _chartCtx.fillStyle = '#ffb700';
      _chartCtx.fill();
    }
  }

  /* ── Update panel with current data ── */
  function updatePanel(count) {
    var countEl = document.getElementById('rtCountNow');
    if (countEl) countEl.textContent = count;

    var globalEl = document.getElementById('rtOnlineCount');
    if (globalEl) globalEl.textContent = count + (count === 1 ? ' online' : ' online');

    /* Peak today */
    var todayPrefix = fmtKey(new Date()).slice(0, 10);
    var todayPeak   = 0;
    var allTimePeak = 0;
    Object.keys(_hourlyBuckets).forEach(function(k) {
      if (k.startsWith(todayPrefix)) todayPeak = Math.max(todayPeak, _hourlyBuckets[k]);
      allTimePeak = Math.max(allTimePeak, _hourlyBuckets[k]);
    });
    var peakEl = document.getElementById('rtCountPeak');
    if (peakEl) peakEl.textContent = todayPeak || '—';
    var count24El = document.getElementById('rtCount24h');
    if (count24El) count24El.textContent = allTimePeak || '—';

    /* Page breakdown */
    var pages = {};
    Object.values(_presenceData).forEach(function(p) {
      var pg = p.page || 'unknown';
      pages[pg] = (pages[pg] || 0) + 1;
    });
    var pbEl = document.getElementById('rtPagesBreakdown');
    if (pbEl) {
      pbEl.innerHTML = Object.keys(pages).map(function(pg) {
        return '<span style="background:rgba(255,255,255,.07);padding:2px 8px;border-radius:10px">' + pg + ': <strong style="color:#fff">' + pages[pg] + '</strong></span>';
      }).join('');
    }

    /* Users list */
    var ulEl = document.getElementById('rtUsersList');
    if (ulEl) {
      var html = '';
      Object.keys(_presenceData).slice(0, 20).forEach(function(uid) {
        var p = _presenceData[uid];
        var ago = p.lastSeen ? Math.floor((Date.now() - p.lastSeen) / 60000) : 0;
        html += '<div class="rtUserRow">' +
          '<div style="width:6px;height:6px;border-radius:50%;background:#00ff9c;flex-shrink:0"></div>' +
          '<div style="flex:1;font-family:monospace;color:rgba(255,255,255,.7);">' + uid.slice(0,16) + '…</div>' +
          '<div style="color:#aaa">' + (p.page || '—') + '</div>' +
          '<div style="color:rgba(255,255,255,.4);margin-left:8px">' + (ago <= 0 ? 'now' : ago + 'm') + '</div>' +
        '</div>';
      });
      ulEl.innerHTML = html || '<div style="color:#aaa;font-size:11px;text-align:center;padding:10px">No active users</div>';
    }

    refreshChart();
  }

  /* ── Toggle panel visibility ── */
  window.toggleRtAnalytics = function() {
    var panel = document.getElementById('rtAnalyticsPanel') || buildPanel();
    _panelVisible = !_panelVisible;
    panel.style.display = _panelVisible ? 'block' : 'none';
    if (_panelVisible) {
      setTimeout(initChart, 100); /* ensure canvas sized */
    }
  };

  /* ── Add button to admin header ── */
  function injectButton() {
    if (document.getElementById('rtAnalyticsBtn')) return;
    var btn = document.createElement('button');
    btn.id        = 'rtAnalyticsBtn';
    btn.className = 'btn btn-ghost btn-sm';
    btn.style     = 'border-color:rgba(0,255,156,.3);color:#00ff9c;position:relative';
    btn.innerHTML = '<i class="fas fa-users"></i> Live Users <span id="rtBadge" style="position:absolute;top:-4px;right:-4px;background:#00ff9c;color:#000;border-radius:10px;font-size:9px;font-weight:800;padding:1px 5px;display:none">0</span>';
    btn.onclick   = window.toggleRtAnalytics;

    /* Place next to existing DB Rules button */
    var dbBtn = document.querySelector('[onclick*="showSecurityRules"]');
    if (dbBtn) {
      dbBtn.parentNode.insertBefore(btn, dbBtn.nextSibling);
    } else {
      var hdr = document.querySelector('.admin-header, header, nav');
      if (hdr) hdr.appendChild(btn);
    }
  }

  /* ── Update badge in header button ── */
  setInterval(function() {
    var badge = document.getElementById('rtBadge');
    var count = Object.keys(_presenceData).length;
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'block' : 'none';
    }
  }, 3000);

  /* ── Initialize ── */
  function init() {
    registerPresence();
    listenPresence();
    setTimeout(injectButton, 1500);
    buildPanel(); /* Build but keep hidden */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }

  console.log('[Mini eSports] ✅ Fix 13: Real-Time Analytics Dashboard loaded.');
})();
