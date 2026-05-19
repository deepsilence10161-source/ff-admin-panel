/* =============================================
   FEATURE A05: Platform Health Dashboard
   - Admin ko sab kuch ek jagah dikhta hai
   - Open matches, pending payments, pending verifications
   - System alerts (agar kuch wrong ho)
   - Auto-refresh every 60s
   ============================================= */
(function() {
  'use strict';

  var _healthData = {};

  function runHealthCheck(callback) {
    var rtdb = window.rtdb || window.db;
    if (!rtdb) return;

    var results = {
      openMatches: 0,
      liveMatches: 0,
      completedUnpaid: 0,
      pendingVerif: 0,
      pendingUpdates: 0,
      pendingWithdrawals: 0,
      totalUsers: 0,
      activeUsers: 0,
      alertCount: 0,
      alerts: []
    };

    var done = 0;
    var total = 6;

    function checkDone() {
      done++;
      if (done >= total) {
        // Generate alerts
        if (results.pendingWithdrawals >= 5) results.alerts.push({ type: 'warning', msg: results.pendingWithdrawals + ' withdrawal requests pending!' });
        if (results.pendingVerif >= 10) results.alerts.push({ type: 'warning', msg: results.pendingVerif + ' profile verifications pending!' });
        if (results.completedUnpaid >= 1) results.alerts.push({ type: 'danger', msg: results.completedUnpaid + ' completed matches with unpaid results!' });
        results.alertCount = results.alerts.length;
        _healthData = results;
        if (callback) callback(results);
      }
    }

    // Matches
    rtdb.ref(window.DB_MATCHES || 'matches').once('value', function(s) {
      if (s.exists()) s.forEach(function(c) {
        var v = c.val(); if (!v) return;
        var st = (v.status||'').toLowerCase();
        if (st === 'upcoming' || st === '' || !st) results.openMatches++;
        if (st === 'live') results.liveMatches++;
        if ((st === 'completed' || st === 'finished') && !v.resultPublished) results.completedUnpaid++;
      });
      checkDone();
    });

    // Users
    rtdb.ref('users').once('value', function(s) {
      results.totalUsers = s.numChildren ? s.numChildren() : 0;
      var weekAgo = Date.now() - 7*24*60*60*1000;
      if (s.exists()) s.forEach(function(c) {
        var u = c.val(); if (!u) return;
        if (Number(u.lastSeen||0) > weekAgo || Number(u.lastLoginAt||0) > weekAgo) results.activeUsers++;
      });
      checkDone();
    });

    // Verifications
    rtdb.ref('profileRequests').once('value', function(s) {
      if (s.exists()) s.forEach(function(c) {
        var v = c.val();
        if (v && (!v.status || v.status === 'pending')) results.pendingVerif++;
      });
      checkDone();
    });

    // Profile updates
    rtdb.ref('profileUpdates').once('value', function(s) {
      if (s.exists()) s.forEach(function(c) {
        var v = c.val();
        if (v && (!v.status || v.status === 'pending')) results.pendingUpdates++;
      });
      checkDone();
    });

    // Withdrawals
    rtdb.ref('walletRequests').orderByChild('status').equalTo('pending').once('value', function(s) {
      results.pendingWithdrawals = s.numChildren ? s.numChildren() : 0;
      if (!results.pendingWithdrawals && s.exists()) { s.forEach(function(c) { var v = c.val(); if (v && v.type === 'withdraw' && v.status === 'pending') results.pendingWithdrawals++; }); }
      checkDone();
    });

    // Feedback/surveys
    rtdb.ref('matchFeedback').once('value', function(s) {
      // Just check it exists
      checkDone();
    });
  }

  function showHealthDashboard() {
    var h = '<div id="fa05HealthBody"><div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Checking platform health...</div></div>';
    showAdminModal('❤️ Platform Health', h);

    runHealthCheck(function(data) {
      var bodyEl = document.getElementById('fa05HealthBody');
      if (!bodyEl) return;

      var html = '';

      // Alerts
      if (data.alerts.length > 0) {
        html += '<div style="margin-bottom:12px">';
        data.alerts.forEach(function(a) {
          html += '<div style="padding:10px 12px;border-radius:10px;background:rgba(255,' + (a.type==='danger'?'45,85':'170,0') + ',.08);border:1px solid rgba(255,' + (a.type==='danger'?'45,85':'170,0') + ',.2);color:' + (a.type==='danger'?'#ff2d55':'#ffaa00') + ';font-size:12px;font-weight:700;margin-bottom:6px"><i class="fas fa-exclamation-triangle"></i> ' + a.msg + '</div>';
        });
        html += '</div>';
      }

      // Stats grid
      var stats = [
        { label: 'Upcoming Matches', val: data.openMatches, icon: 'fa-gamepad', color: '#00d4ff' },
        { label: 'Live Now', val: data.liveMatches, icon: 'fa-circle', color: '#ff2d55' },
        { label: 'Unpaid Results', val: data.completedUnpaid, icon: 'fa-exclamation', color: data.completedUnpaid > 0 ? '#ff2d55' : '#00ff9c' },
        { label: 'Pending Verif.', val: data.pendingVerif, icon: 'fa-user-check', color: '#ffaa00' },
        { label: 'Pending Updates', val: data.pendingUpdates, icon: 'fa-user-edit', color: '#b964ff' },
        { label: 'Pending Withdrawals', val: data.pendingWithdrawals, icon: 'fa-wallet', color: data.pendingWithdrawals >= 5 ? '#ff2d55' : '#00ff9c' },
        { label: 'Total Users', val: data.totalUsers, icon: 'fa-users', color: '#00d4ff' },
        { label: 'Active (7d)', val: data.activeUsers, icon: 'fa-user-clock', color: '#00ff9c' }
      ];

      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
      stats.forEach(function(s) {
        html += '<div style="padding:12px;background:var(--bg-dark);border:1px solid var(--border);border-radius:12px;text-align:center">';
        html += '<i class="fas ' + s.icon + '" style="color:' + s.color + ';font-size:16px;margin-bottom:4px;display:block"></i>';
        html += '<div style="font-size:22px;font-weight:900;color:' + s.color + '">' + s.val + '</div>';
        html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + s.label + '</div>';
        html += '</div>';
      });
      html += '</div>';

      html += '<div style="display:flex;gap:8px">';
      html += '<button onclick="window.fA05Health.refresh()" class="btn btn-ghost btn-sm" style="flex:1"><i class="fas fa-sync"></i> Refresh</button>';
      html += '<button onclick="closeGenericModal()" class="btn btn-ghost btn-sm" style="flex:1">Close</button>';
      html += '</div>';

      bodyEl.innerHTML = html;
    });
  }

  window.fA05Health = {
    show: showHealthDashboard,
    refresh: function() { showHealthDashboard(); },
    getData: function() { return _healthData; }
  };

  window.checkPlatformHealth = showHealthDashboard;

  function showAdminModal(title, body) {
    // Use genericModal which exists in index.html
    var m = document.getElementById('genericModal'), mt = document.getElementById('genericModalTitle'), mb = document.getElementById('genericModalBody');
    if (m && mt && mb) {
      mt.innerHTML = title;
      mb.innerHTML = body;
      m.classList.add('show');
    }
  }

  // Add health badge to sidebar
  var _try = 0;
  var _check = setInterval(function() {
    _try++;
    if (window.db || window.rtdb) {
      clearInterval(_check);
      // Run initial health check after 5s
      setTimeout(function() {
        runHealthCheck(function(data) {
          if (data.alertCount > 0) {
            // Add red badge to platform health button
            var healthBtn = document.querySelector('[onclick*="checkPlatformHealth"], [onclick*="platformHealth"]');
            if (healthBtn && !healthBtn.querySelector('.health-badge')) {
              var badge = document.createElement('span');
              badge.className = 'health-badge nav-badge';
              badge.style.cssText = 'background:var(--danger);color:#fff;font-size:9px';
              badge.textContent = data.alertCount;
              healthBtn.appendChild(badge);
            }
          }
        });
      }, 5000);
    }
    if (_try > 30) clearInterval(_check);
  }, 1000);
})();
