/* ================================================================
   MINI eSPORTS ADMIN — fa-admin-v10.js
   ================================================================
   1. SMART MATCH TEMPLATES  — 6 templates, sirf Time+Room+Pass
   2. LIVE ATTENDANCE DASHBOARD — Present/Absent/Pending real-time
   3. ADMIN MATCH-START ALERTS  — 15min + 5min pehle
   4. OCR RESULT SYSTEM         — Tesseract + Fuzzy match (Levenshtein)
   5. BEAUTIFUL RESULT UI       — Screenshot → auto-fill → verify → publish
   ================================================================ */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     SECTION 1 — MATCH TEMPLATES
     6 pre-built templates. Admin sirf Time + Room ID + Pass bhare.
  ───────────────────────────────────────────────────────────── */

  var TEMPLATES = [
    {
      id: 'solo_blitz',
      icon: '🎯',
      name: 'Solo Blitz',
      color: '#00ff9c',
      bg: 'rgba(0,255,156,.08)',
      border: 'rgba(0,255,156,.25)',
      defaults: {
        name: 'Solo Blitz #{TIME}',
        map: 'Bermuda',
        mode: 'solo',
        matchType: 'BR',
        entryType: 'coin',
        entryFee: 50,
        maxSlots: 12,
        firstPrize: 0, secondPrize: 0, thirdPrize: 0,
        perKillPrize: 0,
        prizeType: 'skyDiamond',
        firstPrizeSD: 100, secondPrizeSD: 50, thirdPrizeSD: 25,
        perKillSD: 5,
      }
    },
    {
      id: 'duo_rush',
      icon: '👥',
      name: 'Duo Rush',
      color: '#00d4ff',
      bg: 'rgba(0,212,255,.08)',
      border: 'rgba(0,212,255,.25)',
      defaults: {
        name: 'Duo Rush #{TIME}',
        map: 'Bermuda',
        mode: 'duo',
        matchType: 'BR',
        entryType: 'coin',
        entryFee: 80,
        maxSlots: 12,
        firstPrize: 0, secondPrize: 0, thirdPrize: 0,
        perKillPrize: 0,
        prizeType: 'skyDiamond',
        firstPrizeSD: 160, secondPrizeSD: 80, thirdPrizeSD: 40,
        perKillSD: 6,
      }
    },
    {
      id: 'squad_war',
      icon: '💣',
      name: 'Squad War',
      color: '#ff6b6b',
      bg: 'rgba(255,107,107,.08)',
      border: 'rgba(255,107,107,.25)',
      defaults: {
        name: 'Squad War #{TIME}',
        map: 'Kalahari',
        mode: 'squad',
        matchType: 'BR',
        entryType: 'paid',
        entryFee: 50,
        maxSlots: 16,
        firstPrize: 0, secondPrize: 0, thirdPrize: 0,
        perKillPrize: 0,
        prizeType: 'greenDiamond',
        firstPrizeGD: 200, secondPrizeGD: 100, thirdPrizeGD: 50,
        perKillGD: 10,
      }
    },
    {
      id: 'clash_squad',
      icon: '⚔️',
      name: 'Clash Squad',
      color: '#b964ff',
      bg: 'rgba(185,100,255,.08)',
      border: 'rgba(185,100,255,.25)',
      defaults: {
        name: 'Clash Squad #{TIME}',
        map: 'Bermuda',
        mode: 'squad',
        matchType: 'CS',
        entryType: 'coin',
        entryFee: 100,
        maxSlots: 16,
        firstPrize: 0, secondPrize: 0, thirdPrize: 0,
        perKillPrize: 0,
        prizeType: 'skyDiamond',
        firstPrizeSD: 250, secondPrizeSD: 120, thirdPrizeSD: 60,
        perKillSD: 0,
      }
    },
    {
      id: 'ad_match',
      icon: '📺',
      name: 'Free Ad Match',
      color: '#ffaa00',
      bg: 'rgba(255,170,0,.08)',
      border: 'rgba(255,170,0,.25)',
      defaults: {
        name: 'Free Match #{TIME}',
        map: 'Bermuda',
        mode: 'solo',
        matchType: 'BR',
        entryType: 'ad',
        entryFee: 0,
        maxSlots: 16,
        firstPrize: 0, secondPrize: 0, thirdPrize: 0,
        perKillPrize: 0,
        prizeType: 'coin',
        firstPrizeCoin: 100, secondPrizeCoin: 50, thirdPrizeCoin: 25,
        perKillCoin: 5,
      }
    },
    {
      id: 'grand_tournament',
      icon: '🏆',
      name: 'Grand Tournament',
      color: '#ffd700',
      bg: 'rgba(255,215,0,.08)',
      border: 'rgba(255,215,0,.3)',
      defaults: {
        name: 'Grand Tournament #{TIME}',
        map: 'Bermuda',
        mode: 'solo',
        matchType: 'BR',
        entryType: 'paid',
        entryFee: 100,
        maxSlots: 20,
        firstPrize: 0, secondPrize: 0, thirdPrize: 0,
        perKillPrize: 0,
        prizeType: 'greenDiamond',
        firstPrizeGD: 500, secondPrizeGD: 250, thirdPrizeGD: 100,
        perKillGD: 15,
      }
    },
  ];

  /* Show Quick Create Modal */
  window.showQuickCreate = function () {
    var h = '';
    h += '<div style="text-align:center;padding:0 0 14px">';
    h += '<div style="font-size:28px;margin-bottom:4px">⚡</div>';
    h += '<div style="font-size:17px;font-weight:900;color:#fff">Quick Match Create</div>';
    h += '<div style="font-size:11px;color:#888;margin-top:3px">Template select karo — sirf Time + Room ID + Password bhar</div>';
    h += '</div>';

    /* Template grid */
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">';
    TEMPLATES.forEach(function (t) {
      h += '<div onclick="window._qcSelectTemplate(\'' + t.id + '\')" id="_qcT_' + t.id + '" ' +
        'style="padding:14px 12px;border-radius:14px;background:' + t.bg + ';border:1.5px solid ' + t.border + ';' +
        'cursor:pointer;transition:all .2s;text-align:center">' +
        '<div style="font-size:24px;margin-bottom:6px">' + t.icon + '</div>' +
        '<div style="font-size:12px;font-weight:800;color:' + t.color + '">' + t.name + '</div>' +
        '<div style="font-size:10px;color:#666;margin-top:3px">' +
        t.defaults.map + ' · ' + t.defaults.mode.toUpperCase() + ' · ' + t.defaults.maxSlots + ' slots' +
        '</div></div>';
    });
    h += '</div>';

    /* Time + Room + Pass fields (hidden until template selected) */
    h += '<div id="_qcFields" style="display:none">';
    h += '<div id="_qcTemplateBadge" style="padding:10px 14px;border-radius:12px;margin-bottom:14px;font-size:13px;font-weight:800;text-align:center"></div>';
    /* Match time */
    h += '<div style="margin-bottom:12px">';
    h += '<div style="font-size:12px;font-weight:700;color:#aaa;margin-bottom:6px">⏰ Match Time *</div>';
    h += '<input type="datetime-local" id="_qcTime" style="width:100%;padding:11px 12px;border-radius:11px;' +
      'border:1.5px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font-size:14px;box-sizing:border-box">';
    h += '</div>';
    /* Room ID */
    h += '<div style="margin-bottom:12px">';
    h += '<div style="font-size:12px;font-weight:700;color:#aaa;margin-bottom:6px">🏠 Room ID *</div>';
    h += '<input type="text" id="_qcRoomId" placeholder="e.g. 8472931" maxlength="12" ' +
      'style="width:100%;padding:11px 12px;border-radius:11px;border:1.5px solid rgba(0,212,255,.25);' +
      'background:rgba(0,212,255,.05);color:#00d4ff;font-size:16px;font-weight:700;letter-spacing:2px;' +
      'text-align:center;box-sizing:border-box;font-family:monospace">';
    h += '</div>';
    /* Password */
    h += '<div style="margin-bottom:20px">';
    h += '<div style="font-size:12px;font-weight:700;color:#aaa;margin-bottom:6px">🔑 Room Password *</div>';
    h += '<input type="text" id="_qcRoomPass" placeholder="e.g. 1234" maxlength="10" ' +
      'style="width:100%;padding:11px 12px;border-radius:11px;border:1.5px solid rgba(185,100,255,.25);' +
      'background:rgba(185,100,255,.05);color:#b964ff;font-size:16px;font-weight:700;letter-spacing:2px;' +
      'text-align:center;box-sizing:border-box;font-family:monospace">';
    h += '</div>';
    /* Create button */
    h += '<button onclick="window._qcCreate()" style="width:100%;padding:14px;border-radius:13px;border:none;' +
      'background:linear-gradient(135deg,#00ff9c,#00d4ff);color:#000;font-size:15px;font-weight:900;cursor:pointer;' +
      'box-shadow:0 4px 20px rgba(0,255,156,.35)">⚡ Create Match Now</button>';
    h += '</div>';

    if (window.openModal) openModal('⚡ Quick Create', h);

    window._qcSelectedTemplate = null;
  };

  /* Select template */
  window._qcSelectTemplate = function (id) {
    var tmpl = TEMPLATES.find(function (t) { return t.id === id; });
    if (!tmpl) return;
    window._qcSelectedTemplate = tmpl;

    /* Highlight selected */
    TEMPLATES.forEach(function (t) {
      var el = document.getElementById('_qcT_' + t.id);
      if (!el) return;
      if (t.id === id) {
        el.style.border = '2px solid ' + t.color;
        el.style.boxShadow = '0 0 16px ' + t.color + '44';
      } else {
        el.style.border = '1.5px solid ' + t.border;
        el.style.boxShadow = 'none';
      }
    });

    /* Show fields */
    var fields = document.getElementById('_qcFields');
    if (fields) fields.style.display = 'block';

    /* Badge */
    var badge = document.getElementById('_qcTemplateBadge');
    if (badge) {
      badge.style.background = tmpl.bg;
      badge.style.border = '1px solid ' + tmpl.border;
      badge.style.color = tmpl.color;
      badge.innerHTML = tmpl.icon + ' ' + tmpl.name + ' selected · ' +
        tmpl.defaults.maxSlots + ' slots · ' + tmpl.defaults.map;
    }

    /* Pre-fill time to next round hour */
    var timeInp = document.getElementById('_qcTime');
    if (timeInp && !timeInp.value) {
      var now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      var pad = function (n) { return String(n).padStart(2, '0'); };
      timeInp.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
        'T' + pad(now.getHours()) + ':00';
    }
  };

  /* Create match from template */
  window._qcCreate = function () {
    var tmpl = window._qcSelectedTemplate;
    if (!tmpl) { if (window.showToast) showToast('Pehle template select karo!', true); return; }

    var timeVal = (document.getElementById('_qcTime') || {}).value || '';
    var roomId = ((document.getElementById('_qcRoomId') || {}).value || '').trim();
    var roomPass = ((document.getElementById('_qcRoomPass') || {}).value || '').trim();

    if (!timeVal) { if (window.showToast) showToast('Match time daalo!', true); return; }
    if (!roomId) { if (window.showToast) showToast('Room ID daalo!', true); return; }
    if (!roomPass) { if (window.showToast) showToast('Room Password daalo!', true); return; }

    var matchTime = new Date(timeVal).getTime();
    if (isNaN(matchTime)) { if (window.showToast) showToast('Invalid time!', true); return; }

    /* Auto-generate name with time */
    var d = new Date(matchTime);
    var timeStr = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    var name = tmpl.defaults.name.replace('{TIME}', timeStr);

    var matchData = Object.assign({}, tmpl.defaults, {
      name: name,
      matchTime: matchTime,
      roomId: roomId,
      roomPassword: roomPass,
      status: 'upcoming',
      createdAt: Date.now(),
      templateId: tmpl.id,
    });

    var db = window.rtdb || window.db;
    if (!db) { if (window.showToast) showToast('DB not connected!', true); return; }

    var ref = db.ref('matches').push();
    ref.set(matchData, function (err) {
      if (err) {
        if (window.showToast) showToast('Error: ' + err.message, true);
        return;
      }
      if (window.closeModal) closeModal();
      if (window.showToast) showToast('✅ "' + name + '" created! Room: ' + roomId, false);
      if (window.loadTournaments) window.loadTournaments();
      /* Start alert timer for this match */
      _scheduleMatchAlert(ref.key, matchTime, name);
    });
  };

  /* ─────────────────────────────────────────────────────────────
     SECTION 2 — ADMIN MATCH-START ALERTS
     15 min + 5 min pehle admin ko notification + sound
  ───────────────────────────────────────────────────────────── */

  var _alertTimers = {};

  function _scheduleMatchAlert(matchId, matchTime, matchName) {
    if (_alertTimers[matchId]) {
      clearTimeout(_alertTimers[matchId].t15);
      clearTimeout(_alertTimers[matchId].t5);
    }
    var now = Date.now();
    var ms15 = matchTime - now - (15 * 60 * 1000); /* 15 min pehle */
    var ms5  = matchTime - now - (5  * 60 * 1000); /* 5 min pehle */

    _alertTimers[matchId] = {};

    if (ms15 > 0) {
      _alertTimers[matchId].t15 = setTimeout(function () {
        _showAdminAlert(matchId, matchName, 15);
      }, ms15);
    }
    if (ms5 > 0) {
      _alertTimers[matchId].t5 = setTimeout(function () {
        _showAdminAlert(matchId, matchName, 5);
      }, ms5);
    }
  }

  function _showAdminAlert(matchId, matchName, minutesLeft) {
    var isUrgent = minutesLeft <= 5;
    var color = isUrgent ? '#ff4444' : '#ffd700';
    var bgColor = isUrgent ? 'rgba(255,68,68,.12)' : 'rgba(255,215,0,.1)';

    /* Sound alert */
    _playAlertSound(isUrgent);

    /* Show floating alert */
    var existing = document.getElementById('_adminMatchAlert');
    if (existing) existing.remove();

    var alert = document.createElement('div');
    alert.id = '_adminMatchAlert';
    alert.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:99999',
      'background:' + bgColor,
      'border:2px solid ' + color,
      'border-radius:16px',
      'padding:14px 20px',
      'min-width:280px',
      'max-width:90vw',
      'box-shadow:0 4px 32px ' + color + '44',
      'animation:alertSlideIn .3s ease',
      'cursor:pointer',
    ].join(';');

    alert.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="font-size:28px">' + (isUrgent ? '🚨' : '⏰') + '</div>' +
        '<div style="flex:1">' +
          '<div style="font-size:14px;font-weight:900;color:' + color + '">' +
            (isUrgent ? 'URGENT: ' : '') + matchName +
          '</div>' +
          '<div style="font-size:12px;color:#aaa;margin-top:2px">' +
            minutesLeft + ' minute' + (minutesLeft > 1 ? 's' : '') + ' mein shuru hoga!' +
          '</div>' +
        '</div>' +
        '<div onclick="document.getElementById(\'_adminMatchAlert\').remove()" ' +
          'style="font-size:18px;color:#666;cursor:pointer;padding:4px">×</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button onclick="window._goToAttendance(\'' + matchId + '\')" ' +
          'style="flex:1;padding:8px;border-radius:9px;border:1px solid ' + color + ';' +
          'background:' + bgColor + ';color:' + color + ';font-size:12px;font-weight:700;cursor:pointer">' +
          '👥 Attendance' +
        '</button>' +
        '<button onclick="document.getElementById(\'_adminMatchAlert\').remove()" ' +
          'style="flex:1;padding:8px;border-radius:9px;border:1px solid rgba(255,255,255,.1);' +
          'background:rgba(255,255,255,.04);color:#aaa;font-size:12px;cursor:pointer">' +
          'Dismiss' +
        '</button>' +
      '</div>';

    document.body.appendChild(alert);

    /* Auto dismiss after 30 seconds */
    setTimeout(function () {
      if (alert.parentNode) alert.remove();
    }, 30000);
  }

  window._goToAttendance = function (matchId) {
    var alert = document.getElementById('_adminMatchAlert');
    if (alert) alert.remove();
    window._liveAttendanceMatchId = matchId;
    if (window.showSection) showSection('attendance', null);
    renderLiveAttendance(matchId);
  };

  function _playAlertSound(urgent) {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var times = urgent ? [0, 0.15, 0.3] : [0];
      times.forEach(function (t) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = urgent ? 880 : 660;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.5, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.2);
      });
    } catch (e) { /* audio not available */ }
  }

  /* On page load: schedule alerts for all upcoming matches */
  function _initAlerts() {
    var db = window.rtdb || window.db;
    if (!db) { setTimeout(_initAlerts, 2000); return; }
    db.ref('matches').orderByChild('status').equalTo('upcoming').once('value', function (snap) {
      if (!snap.exists()) return;
      var now = Date.now();
      snap.forEach(function (c) {
        var m = c.val();
        if (!m || !m.matchTime) return;
        var mt = Number(m.matchTime);
        /* Only schedule if match is in future */
        if (mt > now) {
          _scheduleMatchAlert(c.key, mt, m.name || 'Match');
        }
      });
    });
  }

  setTimeout(_initAlerts, 3000);

  /* ─────────────────────────────────────────────────────────────
     SECTION 3 — LIVE ATTENDANCE DASHBOARD
     Present / Absent / Pending — real-time Firebase listener
  ───────────────────────────────────────────────────────────── */

  window.renderLiveAttendance = function (matchId) {
    var container = document.getElementById('_attendanceContainer');
    if (!container) return;

    var db = window.rtdb || window.db;
    if (!db) return;

    container.innerHTML = '<div style="text-align:center;padding:20px;color:#888">' +
      '<i class="fas fa-spinner fa-spin"></i> Loading players...</div>';

    /* Load match info */
    db.ref('matches/' + matchId).once('value', function (mSnap) {
      var match = mSnap.val() || {};

      /* Real-time listener for join requests */
      db.ref('joinRequests').orderByChild('tournamentId').equalTo(matchId)
        .on('value', function (snap) {
          var rows = [];
          if (snap.exists()) {
            snap.forEach(function (c) {
              var j = c.val();
              if (!j) return;
              var isJoined = j.status === 'approved' || j.status === 'joined' || !j.status;
              if (!isJoined) return;
              rows.push({ key: c.key, j: j });
            });
          }

          /* Counts */
          var present = rows.filter(function (r) {
            return r.j.attendanceStatus === 'present' || r.j.inRoom === true;
          }).length;
          var absent = rows.filter(function (r) {
            return r.j.attendanceStatus === 'absent';
          }).length;
          var pending = rows.length - present - absent;

          /* Header */
          var h = '';
          h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);' +
            'border-radius:14px;padding:14px;margin-bottom:14px">';
          h += '<div style="font-size:14px;font-weight:900;color:#fff;margin-bottom:10px">' +
            '👥 ' + (match.name || 'Match') + ' — Live Attendance</div>';
          /* Stats row */
          h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">';
          h += _statBox('✅ Present', present, '#00ff9c');
          h += _statBox('❌ Absent', absent, '#ff4444');
          h += _statBox('⏳ Pending', pending, '#ffd700');
          h += '</div>';

          /* Action buttons */
          h += '<div style="display:flex;gap:8px;margin-top:12px">';
          h += '<button onclick="window._markAllAbsent(\'' + matchId + '\')" ' +
            'style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(255,68,68,.3);' +
            'background:rgba(255,68,68,.08);color:#ff6b6b;font-size:12px;font-weight:700;cursor:pointer">' +
            '❌ Mark All Pending → Absent</button>';
          h += '<button onclick="window._copyPresentIGNs(\'' + matchId + '\')" ' +
            'style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(0,255,156,.2);' +
            'background:rgba(0,255,156,.05);color:#00ff9c;font-size:12px;font-weight:700;cursor:pointer">' +
            '📋 Copy IGNs</button>';
          h += '</div></div>';

          /* Player list */
          h += '<div style="display:flex;flex-direction:column;gap:6px">';
          rows.forEach(function (r) {
            var j = r.j;
            var ign = j.playerName || j.ign || 'Unknown';
            var slot = j.slotNumber || j.slot || '—';
            var ffUid = j.ffUid || j.gameUid || '—';
            var status = j.attendanceStatus || (j.inRoom ? 'present' : 'pending');

            var statusColor = status === 'present' ? '#00ff9c' : status === 'absent' ? '#ff4444' : '#ffd700';
            var statusIcon = status === 'present' ? '✅' : status === 'absent' ? '❌' : '⏳';
            var statusLabel = status === 'present' ? 'Present' : status === 'absent' ? 'Absent' : 'Pending';

            h += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;' +
              'border-radius:11px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07)">';
            /* Slot badge */
            h += '<div style="min-width:32px;height:32px;border-radius:8px;background:rgba(0,212,255,.1);' +
              'border:1px solid rgba(0,212,255,.2);display:flex;align-items:center;justify-content:center;' +
              'font-size:12px;font-weight:800;color:#00d4ff">' + slot + '</div>';
            /* Player info */
            h += '<div style="flex:1;min-width:0">';
            h += '<div style="font-size:13px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + ign + '</div>';
            h += '<div style="font-size:10px;color:#666;font-family:monospace">' + ffUid + '</div>';
            h += '</div>';
            /* Status badge */
            h += '<div style="font-size:11px;font-weight:700;color:' + statusColor + ';' +
              'background:' + statusColor + '18;padding:4px 10px;border-radius:8px;' +
              'border:1px solid ' + statusColor + '44;white-space:nowrap">' +
              statusIcon + ' ' + statusLabel + '</div>';
            /* Toggle button */
            h += '<button onclick="window._toggleAttendance(\'' + matchId + '\',\'' + r.key + '\',\'' + status + '\')" ' +
              'style="padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);' +
              'background:rgba(255,255,255,.04);color:#888;font-size:10px;cursor:pointer">Toggle</button>';
            h += '</div>';
          });
          h += '</div>';

          if (!rows.length) {
            h += '<div style="text-align:center;padding:24px;color:#666">No players joined this match yet.</div>';
          }

          container.innerHTML = h;
        });
    });
  };

  function _statBox(label, val, color) {
    return '<div style="text-align:center;padding:10px;border-radius:11px;' +
      'background:' + color + '10;border:1px solid ' + color + '30">' +
      '<div style="font-size:22px;font-weight:900;color:' + color + '">' + val + '</div>' +
      '<div style="font-size:10px;color:#888;margin-top:2px">' + label + '</div>' +
      '</div>';
  }

  window._toggleAttendance = function (matchId, reqKey, currentStatus) {
    var db = window.rtdb || window.db;
    if (!db) return;
    var nextStatus = currentStatus === 'present' ? 'absent' :
                     currentStatus === 'absent' ? 'pending' : 'present';
    db.ref('joinRequests/' + reqKey + '/attendanceStatus').set(nextStatus, function () {
      if (window.showToast) showToast('Status → ' + nextStatus, false);
    });
  };

  window._markAllAbsent = function (matchId) {
    if (!confirm('Saare pending players ko absent mark karein?')) return;
    var db = window.rtdb || window.db;
    if (!db) return;
    db.ref('joinRequests').orderByChild('tournamentId').equalTo(matchId)
      .once('value', function (snap) {
        var batch = {};
        snap.forEach(function (c) {
          var j = c.val();
          var status = j.attendanceStatus || (j.inRoom ? 'present' : 'pending');
          if (status === 'pending') {
            batch['joinRequests/' + c.key + '/attendanceStatus'] = 'absent';
          }
        });
        if (Object.keys(batch).length) {
          db.ref().update(batch, function () {
            if (window.showToast) showToast('✅ Pending players marked absent!', false);
          });
        }
      });
  };

  window._copyPresentIGNs = function (matchId) {
    var db = window.rtdb || window.db;
    if (!db) return;
    db.ref('joinRequests').orderByChild('tournamentId').equalTo(matchId)
      .once('value', function (snap) {
        var igns = [];
        snap.forEach(function (c) {
          var j = c.val();
          var status = j.attendanceStatus || (j.inRoom ? 'present' : 'pending');
          if (status === 'present') igns.push(j.playerName || j.ign || '?');
        });
        if (navigator.clipboard) {
          navigator.clipboard.writeText(igns.join('\n'))
            .then(function () { if (window.showToast) showToast('✅ ' + igns.length + ' IGNs copied!', false); });
        }
      });
  };

  /* ─────────────────────────────────────────────────────────────
     SECTION 4 — OCR RESULT SYSTEM
     Tesseract.js + Levenshtein fuzzy match
     BR mode: rank + kills per player
     CS mode: kills per player (no overall rank, team rank)
  ───────────────────────────────────────────────────────────── */

  /* Levenshtein Distance — pure JS, no deps */
  function levenshtein(a, b) {
    a = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    b = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var m = a.length, n = b.length;
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [i];
      for (var j = 1; j <= n; j++) {
        if (!dp[i]) dp[i] = [];
        dp[i][j] = i === 0 ? j :
          a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] :
          1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }

  /* Find best match from player list */
  function fuzzyMatch(ocrName, playerList) {
    if (!ocrName || !playerList || !playerList.length) return null;
    var best = null, bestDist = Infinity;
    var cleanOcr = ocrName.toLowerCase().replace(/[^a-z0-9]/g, '');
    playerList.forEach(function (p) {
      var cleanP = (p.name || p.ign || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      var dist = levenshtein(cleanOcr, cleanP);
      /* Similarity ratio */
      var maxLen = Math.max(cleanOcr.length, cleanP.length);
      var ratio = maxLen > 0 ? 1 - (dist / maxLen) : 0;
      if (dist < bestDist && ratio > 0.5) {
        bestDist = dist;
        best = { player: p, distance: dist, ratio: ratio };
      }
    });
    return best;
  }

  /* Parse OCR text for BR mode: extract name, rank, kills */
  function parseOcrTextBR(rawText) {
    var lines = rawText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var results = [];

    lines.forEach(function (line) {
      /* Pattern: name + K/D/A pattern e.g. "PlayerName 14/2/2 5035" */
      /* Also handle rank numbers at start */

      /* Try to find kills from K/D/A: e.g. 14/2/2 */
      var kdaMatch = line.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
      var kills = kdaMatch ? parseInt(kdaMatch[1]) : null;

      /* Try rank from beginning: "1 PlayerName ..." or "#1 PlayerName" */
      var rankMatch = line.match(/^#?(\d+)\s+(.+)/);
      var rank = null, namePart = line;
      if (rankMatch && parseInt(rankMatch[1]) <= 20) {
        rank = parseInt(rankMatch[1]);
        namePart = rankMatch[2];
      }

      /* Extract name: everything before the K/D/A pattern */
      if (kdaMatch) {
        var idx = line.indexOf(kdaMatch[0]);
        namePart = line.substring(0, idx).trim();
        /* Clean up rank from name */
        namePart = namePart.replace(/^#?\d+\s+/, '').trim();
      }

      /* Damage number (large number at end) — ignore for our purposes */

      if (namePart && namePart.length >= 2) {
        results.push({
          rawName: namePart,
          rank: rank,
          kills: kills,
        });
      }
    });

    return results;
  }

  /* Parse OCR text for Clash Squad mode */
  function parseOcrTextCS(rawText) {
    var lines = rawText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var results = [];

    lines.forEach(function (line) {
      var kdaMatch = line.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
      if (!kdaMatch) return;
      var kills = parseInt(kdaMatch[1]);
      var idx = line.indexOf(kdaMatch[0]);
      var namePart = line.substring(0, idx).trim().replace(/^#?\d+\s+/, '').trim();
      if (namePart && namePart.length >= 2) {
        results.push({ rawName: namePart, kills: kills, rank: null });
      }
    });

    return results;
  }

  /* Main OCR function — called when screenshot is uploaded in result section */
  window.runOCROnScreenshot = function (imageData, matchType, playerList, onComplete) {
    var isCS = (matchType || '').toUpperCase() === 'CS';

    /* Show progress */
    var progressEl = document.getElementById('_ocrProgress');
    if (progressEl) {
      progressEl.style.display = 'block';
      progressEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> OCR running... (Tesseract)';
    }

    /* Check if Tesseract is loaded */
    if (typeof Tesseract === 'undefined') {
      /* Load Tesseract dynamically */
      var script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js';
      script.onload = function () { _runTesseract(imageData, isCS, playerList, onComplete, progressEl); };
      script.onerror = function () {
        if (progressEl) progressEl.innerHTML = '❌ Tesseract load failed. Manual fill karo.';
        if (onComplete) onComplete(null, 'Tesseract load failed');
      };
      document.head.appendChild(script);
      return;
    }

    _runTesseract(imageData, isCS, playerList, onComplete, progressEl);
  };

  function _runTesseract(imageData, isCS, playerList, onComplete, progressEl) {
    Tesseract.recognize(imageData, 'eng', {
      logger: function (m) {
        if (progressEl && m.progress) {
          var pct = Math.round(m.progress * 100);
          progressEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> OCR ' + pct + '%...';
        }
      }
    }).then(function (result) {
      var rawText = result.data.text;

      /* Parse based on match type */
      var parsed = isCS ? parseOcrTextCS(rawText) : parseOcrTextBR(rawText);

      /* Fuzzy match each OCR result against player list */
      var matched = [];
      var unmatchedOCR = [];

      parsed.forEach(function (ocrEntry) {
        var match = fuzzyMatch(ocrEntry.rawName, playerList);
        if (match && match.ratio >= 0.5) {
          matched.push({
            playerUid: match.player.uid,
            playerName: match.player.name || match.player.ign,
            ocrName: ocrEntry.rawName,
            rank: ocrEntry.rank,
            kills: ocrEntry.kills,
            confidence: Math.round(match.ratio * 100),
          });
        } else {
          unmatchedOCR.push(ocrEntry.rawName);
        }
      });

      if (progressEl) {
        progressEl.innerHTML = '✅ OCR complete — ' + matched.length + ' players matched, ' +
          unmatchedOCR.length + ' unmatched';
        progressEl.style.color = '#00ff9c';
      }

      if (onComplete) onComplete(matched, null, unmatchedOCR);
    }).catch(function (err) {
      if (progressEl) progressEl.innerHTML = '❌ OCR error: ' + err.message;
      if (onComplete) onComplete(null, err.message);
    });
  }

  /* Apply OCR results to the result table */
  window.applyOCRToTable = function (matched) {
    if (!matched || !matched.length) return;
    var applied = 0;
    var rows = document.querySelectorAll('#mrPlayerTable tr[data-uid]');

    matched.forEach(function (m) {
      rows.forEach(function (row) {
        if (row.dataset.uid !== m.playerUid) return;
        /* Fill rank */
        if (m.rank !== null && m.rank !== undefined) {
          var rankInp = row.querySelector('.mr-rank-input');
          if (rankInp) {
            rankInp.value = m.rank;
            rankInp.style.background = 'rgba(0,255,156,.15)'; /* green flash */
            rankInp.style.borderColor = '#00ff9c';
            setTimeout(function () {
              rankInp.style.background = 'rgba(255,215,0,.08)';
              rankInp.style.borderColor = 'rgba(255,215,0,.3)';
            }, 2000);
          }
        }
        /* Fill kills */
        if (m.kills !== null && m.kills !== undefined) {
          var killsInp = row.querySelector('.mr-kills-input');
          if (killsInp) {
            killsInp.value = m.kills;
            killsInp.style.background = 'rgba(0,255,156,.15)';
            killsInp.style.borderColor = '#00ff9c';
            setTimeout(function () {
              killsInp.style.background = 'rgba(255,107,107,.08)';
              killsInp.style.borderColor = 'rgba(255,107,107,.3)';
            }, 2000);
          }
        }
        /* Recalculate prize */
        if (window.mrCalcPrize) {
          var anyInp = row.querySelector('.mr-rank-input');
          if (anyInp) mrCalcPrize(anyInp);
        }
        applied++;
      });
    });

    if (window.showToast) showToast('✅ OCR: ' + applied + ' players auto-filled!', false);
    if (window.mrCheckDuplicateRanks) mrCheckDuplicateRanks();
  };

  /* ─────────────────────────────────────────────────────────────
     SECTION 5 — ENHANCED RESULT UI
     Screenshot upload triggers OCR automatically
  ───────────────────────────────────────────────────────────── */

  /* Wrap mrAddScreenshots to trigger OCR automatically */
  var _origMrAdd = null;
  function _wrapMrAddScreenshots() {
    if (!window.mrAddScreenshots || window._mrOCRWrapped) return;
    window._mrOCRWrapped = true;
    _origMrAdd = window.mrAddScreenshots;
    window.mrAddScreenshots = function (input) {
      _origMrAdd.call(this, input);
      /* After file is read, trigger OCR */
      setTimeout(function () {
        _triggerAutoOCR();
      }, 500);
    };
  }

  function _triggerAutoOCR() {
    var screenshots = window._mrScreenshots || [];
    if (!screenshots.length) return;
    var matchData = window._mrMatchData;
    var matchType = matchData ? (matchData.matchType || 'BR') : 'BR';

    /* Get player list from table */
    var rows = document.querySelectorAll('#mrPlayerTable tr[data-uid]');
    if (!rows.length) return;
    var playerList = [];
    rows.forEach(function (row) {
      var uid = row.dataset.uid;
      var nameEl = row.querySelector('td:nth-child(2) div');
      var name = nameEl ? nameEl.textContent.trim() : '';
      if (uid && name) playerList.push({ uid: uid, name: name });
    });

    if (!playerList.length) return;

    /* Use first screenshot */
    window.runOCROnScreenshot(screenshots[0], matchType, playerList, function (matched, err, unmatched) {
      if (err) {
        if (window.showToast) showToast('OCR error — manual fill karo: ' + err, true);
        return;
      }
      if (!matched || !matched.length) {
        if (window.showToast) showToast('OCR: Koi player nahi mila — manual fill karo', true);
        return;
      }

      /* Show confirmation before applying */
      _showOCRConfirmation(matched, unmatched || []);
    });
  }

  function _showOCRConfirmation(matched, unmatched) {
    var h = '';
    h += '<div style="font-size:13px;font-weight:900;color:#00ff9c;margin-bottom:12px">' +
      '✅ OCR Complete — ' + matched.length + ' players found</div>';

    /* Matched players table */
    h += '<div style="max-height:300px;overflow-y:auto;margin-bottom:12px">';
    h += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    h += '<thead><tr style="background:rgba(255,255,255,.05)">' +
      '<th style="padding:6px;text-align:left">Player</th>' +
      '<th style="padding:6px;text-align:center;color:#ffd700">Rank</th>' +
      '<th style="padding:6px;text-align:center;color:#ff6b6b">Kills</th>' +
      '<th style="padding:6px;text-align:center;color:#00d4ff">Confidence</th>' +
      '</tr></thead><tbody>';

    matched.forEach(function (m) {
      var confColor = m.confidence >= 80 ? '#00ff9c' : m.confidence >= 60 ? '#ffd700' : '#ff6b6b';
      h += '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">';
      h += '<td style="padding:6px">';
      h += '<div style="font-weight:700;color:#fff">' + m.playerName + '</div>';
      if (m.ocrName !== m.playerName) {
        h += '<div style="font-size:10px;color:#555">OCR: ' + m.ocrName + '</div>';
      }
      h += '</td>';
      h += '<td style="padding:6px;text-align:center;color:#ffd700;font-weight:800">' +
        (m.rank !== null ? m.rank : '—') + '</td>';
      h += '<td style="padding:6px;text-align:center;color:#ff6b6b;font-weight:800">' +
        (m.kills !== null ? m.kills : '—') + '</td>';
      h += '<td style="padding:6px;text-align:center;color:' + confColor + ';font-weight:700">' +
        m.confidence + '%</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';

    /* Unmatched */
    if (unmatched.length) {
      h += '<div style="padding:8px 12px;background:rgba(255,170,0,.06);border:1px solid rgba(255,170,0,.2);' +
        'border-radius:10px;margin-bottom:12px;font-size:11px;color:#ffaa00">';
      h += '⚠️ ' + unmatched.length + ' OCR names unmatched: ' + unmatched.join(', ');
      h += '</div>';
    }

    h += '<div style="display:flex;gap:8px">';
    h += '<button onclick="window.applyOCRToTable(window._pendingOCRResults);window.closeModal&&closeModal()" ' +
      'style="flex:1;padding:12px;border-radius:11px;border:none;background:linear-gradient(135deg,#00ff9c,#00d4ff);' +
      'color:#000;font-size:13px;font-weight:900;cursor:pointer">✅ Apply to Table</button>';
    h += '<button onclick="window.closeModal&&closeModal()" ' +
      'style="flex:1;padding:12px;border-radius:11px;border:1px solid rgba(255,255,255,.1);' +
      'background:rgba(255,255,255,.04);color:#aaa;font-size:13px;cursor:pointer">Cancel</button>';
    h += '</div>';

    window._pendingOCRResults = matched;
    if (window.openModal) openModal('🤖 OCR Results — Verify karo', h);
  }

  /* Add OCR progress bar to result section */
  function _injectOCRUI() {
    var ssArea = document.querySelector('#section-matchResult .card-body');
    if (!ssArea || document.getElementById('_ocrProgress')) return;

    var bar = document.createElement('div');
    bar.id = '_ocrProgress';
    bar.style.cssText = 'display:none;padding:10px 14px;background:rgba(0,212,255,.07);' +
      'border:1px solid rgba(0,212,255,.2);border-radius:10px;font-size:12px;' +
      'color:#00d4ff;margin-bottom:10px;font-weight:600';
    bar.innerHTML = '<i class="fas fa-robot"></i> OCR ready — screenshot upload karo';

    /* Insert after screenshot area */
    var ssDiv = ssArea.querySelector('div[style*="rgba(0,255,156"]');
    if (ssDiv && ssDiv.nextSibling) {
      ssArea.insertBefore(bar, ssDiv.nextSibling);
    } else if (ssArea.firstChild) {
      ssArea.insertBefore(bar, ssArea.firstChild.nextSibling);
    }
  }

  /* CSS animations */
  var style = document.createElement('style');
  style.textContent =
    '@keyframes alertSlideIn{from{transform:translateX(-50%) translateY(-20px);opacity:0}' +
    'to{transform:translateX(-50%) translateY(0);opacity:1}}';
  document.head.appendChild(style);

  /* Init */
  var _initTimer = setInterval(function () {
    if (window.mrAddScreenshots && !window._mrOCRWrapped) {
      _wrapMrAddScreenshots();
    }
    if (document.getElementById('section-matchResult')) {
      _injectOCRUI();
    }
  }, 1000);

  /* Quick Create button — add to tournament section */
  var _btnTimer = setInterval(function () {
    var header = document.querySelector('#section-tournaments .section-header .section-actions');
    if (!header || document.getElementById('_qcBtn')) return;
    clearInterval(_btnTimer);
    var btn = document.createElement('button');
    btn.id = '_qcBtn';
    btn.className = 'btn btn-primary btn-sm';
    btn.style.cssText = 'background:linear-gradient(135deg,#00ff9c,#00d4ff);color:#000;' +
      'font-weight:900;border:none;margin-right:8px';
    btn.innerHTML = '<i class="fas fa-bolt"></i> Quick Create';
    btn.onclick = window.showQuickCreate;
    header.insertBefore(btn, header.firstChild);
  }, 500);

  console.log('[Admin v10] fa-admin-v10.js loaded ✅');
})();
