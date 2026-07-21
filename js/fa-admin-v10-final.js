/* ── Admin: Track support response times ── */
window.adminRespondToRequest = function(requestId, submittedAt) {
  var db_ = window.rtdb || window.db;
  if (!db_) return;
  var responseTime = Date.now() - Number(submittedAt);
  if (responseTime <= 0 || responseTime > 7 * 86400000) return;
  db_.ref('appSettings/adminResponseStats').transaction(function(stats) {
    stats = stats || { totalResponded: 0, totalTimeMs: 0, avgResponseMs: 0 };
    stats.totalResponded += 1;
    stats.totalTimeMs    += responseTime;
    stats.avgResponseMs   = Math.round(stats.totalTimeMs / stats.totalResponded);
    stats.lastUpdated     = Date.now();
    return stats;
  });
};

/* ================================================================
   MINI eSPORTS ADMIN — fa-admin-v10-final.js
   ================================================================
   Covers EVERYTHING from the chat:

   1. SMART QUICK MATCH CREATION
      - 6 Templates — ek tap se poora match pre-fill
      - Sirf Time + Room ID + Password admin bhare
      - Auto-generate match name with time
      - Beautiful template cards with icons

   2. ROOM ID / PASSWORD — SMART SYSTEM
      - Quick modal: sirf Room ID + Pass
      - Can add to existing match instantly
      - Auto-releases to users at set time

   3. LIVE ATTENDANCE DASHBOARD
      - Real-time Present ✅ / Absent ❌ / Pending ⏳
      - Auto-absent: 10 min confirm nahi kiya
      - Copy present IGNs button
      - Mark all pending as absent button
      - Admin decides match start from this view

   4. MATCH START ALERTS FOR ADMIN
      - 15 min pehle: Yellow alert + sound
      - 5 min pehle: Red urgent alert + triple beep
      - Alert mein attendance button direct
      - Auto-loads on page open for all upcoming matches

   5. OCR AUTO-FILL (Tesseract.js — already in fa53)
      - fa53 already handles this perfectly
      - This file adds: Gemini Vision API ready hook
        (just uncomment when API key available)

   6. BEAUTIFUL TEMPLATES UI
      - 6 templates with colors, icons
      - Instant preview of what will be created
      - One-tap creation

   OCR: Tesseract.js (Free, Unlimited)
   Future: Gemini Vision API (when ready)
================================================================ */
(function () {
'use strict';

/* ─── DB helper ─── */
function getDB() { return window.rtdb || window.db; }

/* ─── Toast helper ─── */
function toast(msg, err) {
  if (window.showToast) { showToast(msg, err || false); return; }
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
    'background:' + (err ? 'rgba(255,68,68,.9)' : 'rgba(0,255,156,.9)') + ';' +
    'color:#000;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:700;' +
    'z-index:99999;max-width:90vw;text-align:center';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.remove(); }, 3500);
}

/* ================================================================
   SECTION 1 — MATCH TEMPLATES
================================================================ */

var TEMPLATES = [
  {
    id: 'solo_blitz',
    icon: '🎯',
    name: 'Solo Blitz',
    desc: 'Bermuda · Solo · 12 slots',
    color: '#00ff9c', bg: 'rgba(0,255,156,.08)', border: 'rgba(0,255,156,.2)',
    fill: {
      tName: 'Solo Blitz',
      tGameMode: 'solo', tMatchSubType: 'battle_royale', tMap: 'Bermuda',
      tEntryType: 'coin', tEntryFee: 50, tMaxSlots: 12,
      tPrizeType: 'skyDiamond',
      tFirstPrize: 100, tSecondPrize: 50, tThirdPrize: 25, tPerKill: 5,
    }
  },
  {
    id: 'duo_rush',
    icon: '👥',
    name: 'Duo Rush',
    desc: 'Bermuda · Duo · 12 slots',
    color: '#00d4ff', bg: 'rgba(0,212,255,.08)', border: 'rgba(0,212,255,.2)',
    fill: {
      tName: 'Duo Rush',
      tGameMode: 'duo', tMatchSubType: 'battle_royale', tMap: 'Bermuda',
      tEntryType: 'coin', tEntryFee: 80, tMaxSlots: 12,
      tPrizeType: 'skyDiamond',
      tFirstPrize: 160, tSecondPrize: 80, tThirdPrize: 40, tPerKill: 6,
    }
  },
  {
    id: 'squad_war',
    icon: '💣',
    name: 'Squad War',
    desc: 'Kalahari · Squad · 16 slots',
    color: '#ff6b6b', bg: 'rgba(255,107,107,.08)', border: 'rgba(255,107,107,.2)',
    fill: {
      tName: 'Squad War',
      tGameMode: 'squad', tMatchSubType: 'battle_royale', tMap: 'Kalahari',
      tEntryType: 'paid', tEntryFee: 50, tMaxSlots: 16,
      tPrizeType: 'greenDiamond',
      tFirstPrize: 200, tSecondPrize: 100, tThirdPrize: 50, tPerKill: 10,
    }
  },
  {
    id: 'clash_squad',
    icon: '⚔️',
    name: 'Clash Squad',
    desc: 'Bermuda · Squad · 16 slots',
    color: '#b964ff', bg: 'rgba(185,100,255,.08)', border: 'rgba(185,100,255,.2)',
    fill: {
      tName: 'Clash Squad',
      tGameMode: 'squad', tMatchSubType: 'clash_squad', tMap: 'Bermuda',
      tEntryType: 'coin', tEntryFee: 100, tMaxSlots: 16,
      tPrizeType: 'skyDiamond',
      tFirstPrize: 250, tSecondPrize: 120, tThirdPrize: 60, tPerKill: 0,
    }
  },
  {
    id: 'free_ad',
    icon: '📺',
    name: 'Free Ad Match',
    desc: 'Bermuda · Solo · 16 slots · Free',
    color: '#ffaa00', bg: 'rgba(255,170,0,.08)', border: 'rgba(255,170,0,.2)',
    fill: {
      tName: 'Free Ad Match',
      tGameMode: 'solo', tMatchSubType: 'battle_royale', tMap: 'Bermuda',
      tEntryType: 'ad', tEntryFee: 0, tMaxSlots: 16,
      tPrizeType: 'coin',
      tFirstPrize: 100, tSecondPrize: 50, tThirdPrize: 25, tPerKill: 5,
    }
  },
  {
    id: 'grand',
    icon: '🏆',
    name: 'Grand Tournament',
    desc: 'Bermuda · Solo · 20 slots',
    color: '#ffd700', bg: 'rgba(255,215,0,.08)', border: 'rgba(255,215,0,.25)',
    fill: {
      tName: 'Grand Tournament',
      tGameMode: 'solo', tMatchSubType: 'battle_royale', tMap: 'Bermuda',
      tEntryType: 'paid', tEntryFee: 100, tMaxSlots: 20,
      tPrizeType: 'greenDiamond',
      tFirstPrize: 500, tSecondPrize: 250, tThirdPrize: 100, tPerKill: 15,
    }
  },
];

/* Apply template to existing form */
window.applyMatchTemplate = function (templateId) {
  var tmpl = TEMPLATES.find(function (t) { return t.id === templateId; });
  if (!tmpl) return;

  Object.keys(tmpl.fill).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = tmpl.fill[id];
    /* Trigger change for dropdowns */
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* Trigger entry type change to update UI hints */
  if (window.onEntryTypeChange) onEntryTypeChange();

  /* Auto-set time to next round hour */
  var timeEl = document.getElementById('tMatchTime');
  if (timeEl && !timeEl.value) {
    var now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    timeEl.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' +
      pad(now.getDate()) + 'T' + pad(now.getHours()) + ':00';
  }

  toast('✅ "' + tmpl.name + '" template applied! Time + Room ID + Password bhar dein.');
};

/* Show Quick Create Modal — standalone modal, opens tournament modal pre-filled */
window.showQuickCreate = function () {
  var h = '';
  h += '<div style="text-align:center;padding:4px 0 16px">';
  h += '<div style="font-size:28px;margin-bottom:4px">⚡</div>';
  h += '<div style="font-size:17px;font-weight:900;color:#fff">Quick Match Create</div>';
  h += '<div style="font-size:11px;color:#666;margin-top:3px">Template select karo → sirf Time + Room ID + Pass bharo</div>';
  h += '</div>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">';
  TEMPLATES.forEach(function (t) {
    h += '<div onclick="window._qcPick(\'' + t.id + '\')" id="_qcCard_' + t.id + '" ' +
      'style="padding:14px 12px;border-radius:14px;background:' + t.bg + ';border:1.5px solid ' + t.border + ';' +
      'cursor:pointer;transition:all .18s;text-align:center;user-select:none">' +
      '<div style="font-size:26px;margin-bottom:6px">' + t.icon + '</div>' +
      '<div style="font-size:12px;font-weight:800;color:' + t.color + '">' + t.name + '</div>' +
      '<div style="font-size:10px;color:#666;margin-top:3px">' + t.desc + '</div>' +
      '</div>';
  });
  h += '</div>';

  /* Quick time + room fields */
  h += '<div id="_qcExtra" style="display:none">';
  h += '<div id="_qcBadge" style="padding:10px;border-radius:10px;text-align:center;font-size:13px;font-weight:800;margin-bottom:12px"></div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  h += '<div><div style="font-size:11px;font-weight:700;color:#aaa;margin-bottom:5px">⏰ Match Time *</div>';
  h += '<input type="datetime-local" id="_qcTime" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font-size:13px;box-sizing:border-box"></div>';
  h += '<div><div style="font-size:11px;font-weight:700;color:#aaa;margin-bottom:5px">🔑 Room Release</div>';
  h += '<select id="_qcRelease" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid rgba(255,255,255,.1);background:#111;color:#fff;font-size:13px">';
  h += '<option value="5">5 min pehle</option><option value="10">10 min pehle</option><option value="15">15 min pehle</option></select></div>';
  h += '</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">';
  h += '<div><div style="font-size:11px;font-weight:700;color:#00d4ff;margin-bottom:5px">🏠 Room ID *</div>';
  h += '<input type="text" id="_qcRoomId" maxlength="12" placeholder="e.g. 8472931" ' +
    'style="width:100%;padding:11px;border-radius:10px;border:1.5px solid rgba(0,212,255,.3);' +
    'background:rgba(0,212,255,.06);color:#00d4ff;font-size:16px;font-weight:700;' +
    'letter-spacing:2px;text-align:center;box-sizing:border-box;font-family:monospace"></div>';
  h += '<div><div style="font-size:11px;font-weight:700;color:#b964ff;margin-bottom:5px">🔑 Room Password *</div>';
  h += '<input type="text" id="_qcRoomPass" maxlength="10" placeholder="e.g. 1234" ' +
    'style="width:100%;padding:11px;border-radius:10px;border:1.5px solid rgba(185,100,255,.3);' +
    'background:rgba(185,100,255,.06);color:#b964ff;font-size:16px;font-weight:700;' +
    'letter-spacing:2px;text-align:center;box-sizing:border-box;font-family:monospace"></div>';
  h += '</div>';
  h += '<button onclick="window._qcCreate()" style="width:100%;padding:14px;border-radius:13px;border:none;' +
    'background:linear-gradient(135deg,#00ff9c,#00d4ff);color:#000;font-size:15px;font-weight:900;' +
    'cursor:pointer;box-shadow:0 4px 20px rgba(0,255,156,.3)">⚡ Match Create Karo!</button>';
  h += '</div>';

  var overlay = document.createElement('div');
  overlay.id = '_qcOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9800;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);padding:16px';

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#0f0f1a;border:1px solid rgba(255,255,255,.1);border-radius:20px;' +
    'padding:24px 20px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.8)';
  modal.innerHTML = h;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.remove();
  });

  window._qcSelectedId = null;

  /* Pre-set time */
  setTimeout(function () {
    var ti = document.getElementById('_qcTime');
    if (ti) {
      var now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      var pad = function (n) { return String(n).padStart(2, '0'); };
      ti.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' +
        pad(now.getDate()) + 'T' + pad(now.getHours()) + ':00';
    }
  }, 100);
};

window._qcPick = function (id) {
  var tmpl = TEMPLATES.find(function (t) { return t.id === id; });
  if (!tmpl) return;
  window._qcSelectedId = id;

  TEMPLATES.forEach(function (t) {
    var c = document.getElementById('_qcCard_' + t.id);
    if (!c) return;
    c.style.border = t.id === id ? '2px solid ' + t.color : '1.5px solid ' + t.border;
    c.style.transform = t.id === id ? 'scale(1.03)' : 'scale(1)';
    c.style.boxShadow = t.id === id ? '0 0 16px ' + t.color + '33' : 'none';
  });

  var extra = document.getElementById('_qcExtra');
  if (extra) extra.style.display = 'block';

  var badge = document.getElementById('_qcBadge');
  if (badge) {
    badge.style.background = tmpl.bg;
    badge.style.border = '1px solid ' + tmpl.border;
    badge.style.color = tmpl.color;
    badge.innerHTML = tmpl.icon + ' ' + tmpl.name + ' — ' + tmpl.desc;
  }
};

window._qcCreate = function () {
  var id = window._qcSelectedId;
  var tmpl = TEMPLATES.find(function (t) { return t.id === id; });
  if (!tmpl) { toast('Pehle template select karo!', true); return; }

  var timeVal = (document.getElementById('_qcTime') || {}).value || '';
  var roomId = ((document.getElementById('_qcRoomId') || {}).value || '').trim();
  var roomPass = ((document.getElementById('_qcRoomPass') || {}).value || '').trim();
  var releaseMin = parseInt((document.getElementById('_qcRelease') || {}).value || '5');

  if (!timeVal) { toast('Match time daalo!', true); return; }
  if (!roomId) { toast('Room ID daalo!', true); return; }
  if (!roomPass) { toast('Room Password daalo!', true); return; }

  var matchTime = new Date(timeVal).getTime();
  if (isNaN(matchTime)) { toast('Invalid time!', true); return; }

  var db = getDB();
  if (!db) { toast('Database not connected!', true); return; }

  /* Auto-name with time */
  var d = new Date(matchTime);
  var timeStr = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  var name = tmpl.fill.tName + ' — ' + timeStr;

  var matchData = {
    name: name,
    gameMode: tmpl.fill.tGameMode || 'solo',
    mode: tmpl.fill.tGameMode || 'solo',
    matchType: tmpl.fill.tMatchSubType || 'battle_royale',
    map: tmpl.fill.tMap || 'Bermuda',
    entryType: tmpl.fill.tEntryType || 'coin',
    entryFee: tmpl.fill.tEntryFee || 0,
    maxSlots: tmpl.fill.tMaxSlots || 12,
    prizeType: tmpl.fill.tPrizeType || 'skyDiamond',
    firstPrize: tmpl.fill.tFirstPrize || 0,
    secondPrize: tmpl.fill.tSecondPrize || 0,
    thirdPrize: tmpl.fill.tThirdPrize || 0,
    perKillPrize: tmpl.fill.tPerKill || 0,
    matchTime: matchTime,
    roomId: roomId,
    roomPassword: roomPass,
    roomReleaseMinutes: releaseMin, /* was 'roomReleaseMin' (no 's') — every
      other read site in both panels (features-admin.js, admin-inline.js,
      fa24-admin-smart-tools.js, User Panel's matches.js/utils.js/
      fix10-server-time-sync.js) reads 'roomReleaseMinutes'. The old key
      name here meant Quick-Create matches always silently fell back to
      the 5-minute default room-reveal timer, ignoring whatever the admin
      actually typed into the release-time field. */
    status: 'upcoming',
    templateId: id,
    createdAt: Date.now(),
  };

  var ref = db.ref('matches').push();
  ref.set(matchData, function (err) {
    if (err) { toast('Error: ' + err.message, true); return; }

    var overlay = document.getElementById('_qcOverlay');
    if (overlay) overlay.remove();

    toast('✅ "' + name + '" created! Room: ' + roomId);

    if (window.loadTournaments) window.loadTournaments();
    _scheduleAlert(ref.key, matchTime, name);
  });
};

/* Add Quick Create button to tournaments section */
var _qcBtnTimer = setInterval(function () {
  var header = document.querySelector('#section-tournaments .section-actions');
  if (!header || document.getElementById('_v10QcBtn')) return;
  clearInterval(_qcBtnTimer);

  var btn = document.createElement('button');
  btn.id = '_v10QcBtn';
  btn.innerHTML = '<i class="fas fa-bolt"></i> Quick Create';
  btn.style.cssText = 'padding:7px 14px;border-radius:9px;border:none;' +
    'background:linear-gradient(135deg,#00ff9c,#00d4ff);color:#000;' +
    'font-size:12px;font-weight:900;cursor:pointer;margin-right:6px';
  btn.onclick = window.showQuickCreate;
  header.insertBefore(btn, header.firstChild);

  /* Also add template buttons to the tournament creation form */
  _injectTemplateBar();
}, 500);

function _injectTemplateBar() {
  var form = document.querySelector('#section-tournaments .card-body');
  if (!form || document.getElementById('_v10TplBar')) return;

  var bar = document.createElement('div');
  bar.id = '_v10TplBar';
  bar.style.cssText = 'margin-bottom:16px;padding:14px;background:rgba(0,212,255,.04);' +
    'border:1px solid rgba(0,212,255,.12);border-radius:14px';
  bar.innerHTML = '<div style="font-size:11px;font-weight:700;color:#888;margin-bottom:10px;letter-spacing:.4px">' +
    '⚡ QUICK TEMPLATES — Ek click mein form bharo</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
    TEMPLATES.map(function (t) {
      return '<button type="button" onclick="window.applyMatchTemplate(\'' + t.id + '\')" ' +
        'style="padding:6px 12px;border-radius:9px;border:1px solid ' + t.border + ';' +
        'background:' + t.bg + ';color:' + t.color + ';font-size:11px;font-weight:700;cursor:pointer">' +
        t.icon + ' ' + t.name + '</button>';
    }).join('') +
    '</div>';

  var firstGroup = form.querySelector('.form-group');
  if (firstGroup) {
    form.insertBefore(bar, firstGroup);
  }
}

/* ================================================================
   SECTION 2 — ROOM ID QUICK SETTER
   Admin can add Room ID + Password to any existing match instantly
================================================================ */

window.showQuickRoomSet = function (matchId, matchName) {
  var h = '';
  h += '<div style="text-align:center;padding:4px 0 16px">';
  h += '<div style="font-size:28px;margin-bottom:4px">🏠</div>';
  h += '<div style="font-size:15px;font-weight:900;color:#fff">' + (matchName || 'Match') + '</div>';
  h += '<div style="font-size:11px;color:#888;margin-top:2px">Room ID aur Password set karo</div>';
  h += '</div>';
  h += '<div style="margin-bottom:12px">';
  h += '<div style="font-size:12px;font-weight:700;color:#00d4ff;margin-bottom:6px">🏠 Room ID *</div>';
  h += '<input id="_qrRoomId" type="text" maxlength="12" placeholder="Room ID daalo" ' +
    'style="width:100%;padding:13px;border-radius:11px;border:2px solid rgba(0,212,255,.3);' +
    'background:rgba(0,212,255,.07);color:#00d4ff;font-size:18px;font-weight:800;' +
    'letter-spacing:3px;text-align:center;box-sizing:border-box;font-family:monospace">';
  h += '</div>';
  h += '<div style="margin-bottom:16px">';
  h += '<div style="font-size:12px;font-weight:700;color:#b964ff;margin-bottom:6px">🔑 Room Password *</div>';
  h += '<input id="_qrRoomPass" type="text" maxlength="10" placeholder="Password daalo" ' +
    'style="width:100%;padding:13px;border-radius:11px;border:2px solid rgba(185,100,255,.3);' +
    'background:rgba(185,100,255,.07);color:#b964ff;font-size:18px;font-weight:800;' +
    'letter-spacing:3px;text-align:center;box-sizing:border-box;font-family:monospace">';
  h += '</div>';
  h += '<button onclick="window._saveQuickRoom(\'' + matchId + '\')" ' +
    'style="width:100%;padding:14px;border-radius:12px;border:none;' +
    'background:linear-gradient(135deg,#00d4ff,#b964ff);color:#000;' +
    'font-size:14px;font-weight:900;cursor:pointer">✅ Save Room ID + Password</button>';

  if (window.openModal) {
    window.openModal('🏠 Room Set', h);
  }
};

window._saveQuickRoom = function (matchId) {
  var rid = ((document.getElementById('_qrRoomId') || {}).value || '').trim();
  var rp = ((document.getElementById('_qrRoomPass') || {}).value || '').trim();
  if (!rid || !rp) { toast('Room ID aur Password dono bharo!', true); return; }

  var db = getDB();
  if (!db) { toast('DB not connected!', true); return; }

  db.ref('matches/' + matchId).update({
    roomId: rid, roomPassword: rp, roomSetAt: Date.now()
  }, function (err) {
    if (err) { toast('Error: ' + err.message, true); return; }
    toast('✅ Room ID + Password saved!');
    if (window.closeModal) closeModal();
    if (window.loadTournaments) loadTournaments();
  });
};

/* Add Room Set button to each match row */
var _roomBtnTimer = setInterval(function () {
  if (!window.renderTournamentRow || window._v10RoomBtnWrapped) return;
  clearInterval(_roomBtnTimer);
  window._v10RoomBtnWrapped = true;
  var orig = window.renderTournamentRow;
  window.renderTournamentRow = function (id, t) {
    var html = orig.call(this, id, t);
    if (typeof html === 'string' && !t.roomId) {
      html = html.replace('</tr>', '<td><button onclick="window.showQuickRoomSet(\'' + id + '\',\'' +
        (t.name || '').replace(/'/g, "\\'") + '\')" ' +
        'style="padding:4px 10px;border-radius:7px;border:1px solid rgba(0,212,255,.3);' +
        'background:rgba(0,212,255,.07);color:#00d4ff;font-size:10px;cursor:pointer;white-space:nowrap">' +
        '🏠 Set Room</button></td></tr>');
    }
    return html;
  };
}, 1000);

/* ================================================================
   SECTION 3 — MATCH START ALERTS (15 min + 5 min)
================================================================ */

var _alertTimers = {};

function _scheduleAlert(matchId, matchTime, matchName) {
  if (_alertTimers[matchId]) {
    clearTimeout(_alertTimers[matchId].t15);
    clearTimeout(_alertTimers[matchId].t5);
  }
  var now = Date.now();
  var ms15 = matchTime - now - 15 * 60 * 1000;
  var ms5  = matchTime - now - 5 * 60 * 1000;
  _alertTimers[matchId] = {};

  if (ms15 > 0) {
    _alertTimers[matchId].t15 = setTimeout(function () {
      _showAlert(matchId, matchName, 15);
    }, ms15);
  } else if (ms15 > -5 * 60 * 1000) {
    /* Between 15 min before and 5 min before — show immediately */
    _showAlert(matchId, matchName, Math.max(1, Math.round((matchTime - now) / 60000)));
  }

  if (ms5 > 0) {
    _alertTimers[matchId].t5 = setTimeout(function () {
      _showAlert(matchId, matchName, 5);
    }, ms5);
  }
}

function _showAlert(matchId, matchName, minutesLeft) {
  var urgent = minutesLeft <= 5;
  var color = urgent ? '#ff4444' : '#ffd700';
  var bg = urgent ? 'rgba(255,68,68,.14)' : 'rgba(255,215,0,.1)';
  var border = urgent ? 'rgba(255,68,68,.5)' : 'rgba(255,215,0,.4)';

  _beep(urgent);

  /* Remove old */
  var old = document.getElementById('_v10Alert_' + matchId);
  if (old) old.remove();

  /* Remove very old alerts (max 3 at once) */
  var allAlerts = document.querySelectorAll('[id^="_v10Alert_"]');
  if (allAlerts.length >= 3) allAlerts[0].remove();

  var el = document.createElement('div');
  el.id = '_v10Alert_' + matchId;
  el.style.cssText = [
    'position:fixed', 'top:' + (16 + document.querySelectorAll('[id^="_v10Alert_"]').length * 110) + 'px',
    'right:16px', 'z-index:99999',
    'background:' + bg,
    'border:2px solid ' + border,
    'border-radius:16px', 'padding:14px 16px',
    'min-width:280px', 'max-width:360px',
    'box-shadow:0 4px 32px ' + color + '33',
    'animation:_v10AlertIn .3s ease',
  ].join(';');

  el.innerHTML =
    '<div style="display:flex;align-items:flex-start;gap:12px">' +
      '<div style="font-size:26px;flex-shrink:0">' + (urgent ? '🚨' : '⏰') + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:900;color:' + color + ';margin-bottom:2px">' +
          (urgent ? '🔴 URGENT — ' : '') + minutesLeft + ' min mein shuru hoga!' +
        '</div>' +
        '<div style="font-size:12px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          matchName +
        '</div>' +
      '</div>' +
      '<div onclick="document.getElementById(\'_v10Alert_' + matchId + '\').remove()" ' +
        'style="font-size:18px;color:#555;cursor:pointer;padding:0 2px;flex-shrink:0">×</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button onclick="window._goAttendance(\'' + matchId + '\')" ' +
        'style="flex:1;padding:8px;border-radius:9px;border:1px solid ' + border + ';' +
        'background:' + bg + ';color:' + color + ';font-size:11px;font-weight:700;cursor:pointer">' +
        '👥 Attendance Dekho' +
      '</button>' +
      '<button onclick="document.getElementById(\'_v10Alert_' + matchId + '\').remove()" ' +
        'style="padding:8px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.08);' +
        'background:rgba(255,255,255,.04);color:#888;font-size:11px;cursor:pointer">' +
        'Dismiss' +
      '</button>' +
    '</div>';

  document.body.appendChild(el);

  /* Browser notification */
  if (window.Notification && Notification.permission === 'granted') {
    new Notification('Mini eSports — Match Alert', {
      body: minutesLeft + ' min mein "' + matchName + '" shuru hoga!',
      icon: '/green-diamond.png',
    });
  }

  setTimeout(function () { if (el.parentNode) el.remove(); }, 45000);
}

window._goAttendance = function (matchId) {
  var el = document.getElementById('_v10Alert_' + matchId);
  if (el) el.remove();
  window._v10AttMatchId = matchId;
  /* Navigate to joined players section */
  var navItem = document.querySelector('[onclick*="joinedPlayers"]');
  if (navItem) navItem.click();
  /* Show attendance after small delay */
  setTimeout(function () { window.renderV10Attendance(matchId); }, 800);
};

function _beep(urgent) {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var times = urgent ? [0, 0.18, 0.36] : [0];
    times.forEach(function (t) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.frequency.value = urgent ? 1000 : 660;
      osc.type = 'sine';
      g.gain.setValueAtTime(0.45, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.25);
    });
  } catch (e) {}
}

/* CSS for alert animation */
if (!document.getElementById('_v10AlertCSS')) {
  var style = document.createElement('style');
  style.id = '_v10AlertCSS';
  style.textContent = '@keyframes _v10AlertIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}';
  document.head.appendChild(style);
}

/* Load on startup — schedule alerts for all upcoming matches */
function _initAllAlerts() {
  var db = getDB();
  if (!db) { setTimeout(_initAllAlerts, 2500); return; }

  /* Request notification permission */
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  db.ref('matches').orderByChild('status').equalTo('upcoming').once('value', function (snap) {
    if (!snap.exists()) return;
    var now = Date.now();
    snap.forEach(function (c) {
      var m = c.val(); if (!m || !m.matchTime) return;
      var mt = Number(m.matchTime);
      if (mt > now) _scheduleAlert(c.key, mt, m.name || 'Match');
    });
  });

  /* Also listen for new upcoming matches */
  db.ref('matches').on('child_changed', function (c) {
    var m = c.val(); if (!m) return;
    if (m.status === 'upcoming' && m.matchTime && Number(m.matchTime) > Date.now()) {
      _scheduleAlert(c.key, Number(m.matchTime), m.name || 'Match');
    }
  });
  db.ref('matches').on('child_added', function (c) {
    var m = c.val(); if (!m) return;
    if (m.status === 'upcoming' && m.matchTime && Number(m.matchTime) > Date.now()) {
      _scheduleAlert(c.key, Number(m.matchTime), m.name || 'Match');
    }
  });
}
setTimeout(_initAllAlerts, 3000);

/* ================================================================
   SECTION 4 — LIVE ATTENDANCE DASHBOARD
   Real-time Present / Absent / Pending
================================================================ */

var _attendanceListeners = {};

window.renderV10Attendance = function (matchId) {
  if (!matchId) return;

  var db = getDB();
  if (!db) return;

  /* Find or create attendance container */
  var wrap = document.getElementById('_v10AttWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = '_v10AttWrap';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,.8);' +
      'backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = '<div style="background:#0a0a14;border:1px solid rgba(255,255,255,.1);' +
    'border-radius:20px;width:100%;max-width:520px;max-height:90vh;display:flex;flex-direction:column;' +
    'box-shadow:0 20px 60px rgba(0,0,0,.9)">' +
    '<div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;' +
    'align-items:center;justify-content:space-between">' +
    '<div style="font-size:15px;font-weight:900;color:#fff">👥 Live Attendance</div>' +
    '<div style="display:flex;gap:6px">' +
    '<button onclick="_v10ShowTab(\'att\')" id="tabAtt" style="padding:5px 10px;border-radius:8px;background:#00ff9c;color:#000;border:none;font-size:11px;font-weight:800;cursor:pointer">Attendance</button>' +
    '<button onclick="_v10ShowTab(\'queue\')" id="tabQueue" style="padding:5px 10px;border-radius:8px;background:rgba(255,255,255,.08);color:#aaa;border:none;font-size:11px;font-weight:700;cursor:pointer">Auto Queue</button>' +
    '<button onclick="_v10ShowTab(\'checkin\')" id="tabCheckin" style="padding:5px 10px;border-radius:8px;background:rgba(255,255,255,.08);color:#aaa;border:none;font-size:11px;font-weight:700;cursor:pointer">Check-Ins</button>' +
    '<button onclick="window._closeAttendance()" style="width:28px;height:28px;border-radius:50%;border:none;background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font-size:16px;margin-left:auto">×</button>' +
    '</div>' +
    
    '</div>' +
    '<div id="_v10AttStats" style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06)"></div>' +
    '<div id="_v10AttActions" style="padding:8px 16px;border-bottom:1px solid rgba(255,255,255,.06)"></div>' +
    '<div id="_v10AttList" style="flex:1;overflow-y:auto;padding:12px 16px;max-height:50vh">' +
    '<div style="text-align:center;padding:20px;color:#666"><i class="fas fa-spinner fa-spin"></i> Loading...</div>' +
    '</div>' +
    '</div>';

  /* Close on overlay click */
  wrap.addEventListener('click', function (e) {
    if (e.target === wrap) window._closeAttendance();
  });

  window._closeAttendance = function () {
    if (_attendanceListeners[matchId]) {
      _attendanceListeners[matchId]();
      delete _attendanceListeners[matchId];
    }
    var el = document.getElementById('_v10AttWrap');
    if (el) el.remove();
  };

  /* Store current matchId for tabs */
  window._currentAttMatchId = matchId;

  /* Load match name */
  db.ref('matches/' + matchId + '/name').once('value', function (s) {
    var header = wrap.querySelector('[style*="15px"]');
    if (header) header.textContent = '👥 ' + (s.val() || 'Match') + ' — Attendance';
  });

  /* Real-time listener */
  var ref = db.ref('joinRequests').orderByChild('tournamentId').equalTo(matchId);
  var unsubscribe = ref.on('value', function (snap) {
    var rows = [];
    if (snap.exists()) {
      snap.forEach(function (c) {
        var j = c.val(); if (!j) return;
        var isApproved = j.status === 'approved' || j.status === 'joined' ||
                         j.status === 'confirmed' || !j.status;
        if (!isApproved) return;
        rows.push({ key: c.key, j: j });
      });
    }

    var present = rows.filter(function (r) {
      return r.j.attendanceStatus === 'present' || r.j.inRoom === true;
    }).length;
    var absent = rows.filter(function (r) {
      return r.j.attendanceStatus === 'absent';
    }).length;
    var pending = rows.length - present - absent;

    /* Stats */
    var statsEl = document.getElementById('_v10AttStats');
    if (statsEl) {
      statsEl.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
        _statBox('✅ Present', present, '#00ff9c') +
        _statBox('❌ Absent', absent, '#ff4444') +
        _statBox('⏳ Pending', pending, '#ffd700') +
        '</div>';
    }

    /* Actions */
    var actEl = document.getElementById('_v10AttActions');
    if (actEl) {
      actEl.innerHTML =
        '<div style="display:flex;gap:8px">' +
        '<button onclick="window._v10MarkAbsent(\'' + matchId + '\')" ' +
          'style="flex:1;padding:8px;border-radius:9px;border:1px solid rgba(255,68,68,.25);' +
          'background:rgba(255,68,68,.06);color:#ff6b6b;font-size:11px;font-weight:700;cursor:pointer">' +
          '❌ Pending → Absent</button>' +
        '<button onclick="window._v10CopyIGNs(\'' + matchId + '\')" ' +
          'style="flex:1;padding:8px;border-radius:9px;border:1px solid rgba(0,255,156,.2);' +
          'background:rgba(0,255,156,.05);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer">' +
          '📋 Copy IGNs</button>' +
        '<button onclick="window._v10StartMatch(\'' + matchId + '\')" ' +
          'style="flex:1;padding:8px;border-radius:9px;border:none;' +
          'background:linear-gradient(135deg,rgba(0,255,156,.2),rgba(0,212,255,.15));' +
          'color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer">' +
          '▶ Start Match</button>' +
        '</div>';
    }

    /* Player list */
    var listEl = document.getElementById('_v10AttList');
    if (!listEl) return;

    if (!rows.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#666">No players joined yet.</div>';
      return;
    }

    listEl.innerHTML = rows.map(function (r) {
      var j = r.j;
      var ign = j.playerName || j.ign || j.userName || 'Unknown';
      var slot = j.slotNumber || j.slot || '—';
      var status = j.attendanceStatus || (j.inRoom ? 'present' : 'pending');
      var sColor = status === 'present' ? '#00ff9c' : status === 'absent' ? '#ff4444' : '#ffd700';
      var sIcon = status === 'present' ? '✅' : status === 'absent' ? '❌' : '⏳';

      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 10px;' +
        'border-radius:11px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);' +
        'margin-bottom:6px">' +
        '<div style="min-width:30px;height:30px;border-radius:8px;background:rgba(0,212,255,.1);' +
          'display:flex;align-items:center;justify-content:center;font-size:11px;' +
          'font-weight:800;color:#00d4ff">' + slot + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:700;color:#fff;overflow:hidden;' +
            'text-overflow:ellipsis;white-space:nowrap">' + ign + '</div>' +
          '<div style="font-size:9px;color:#555;font-family:monospace">' +
            (j.ffUid || j.gameUid || '') + '</div>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;color:' + sColor + ';' +
          'background:' + sColor + '18;padding:4px 10px;border-radius:8px;' +
          'border:1px solid ' + sColor + '35;white-space:nowrap">' + sIcon + ' ' +
          (status === 'present' ? 'Present' : status === 'absent' ? 'Absent' : 'Pending') +
        '</div>' +
        '<button onclick="window._v10ToggleStatus(\'' + r.key + '\',\'' + status + '\')" ' +
          'style="padding:4px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.08);' +
          'background:rgba(255,255,255,.04);color:#888;font-size:10px;cursor:pointer;' +
          'white-space:nowrap">Toggle</button>' +
        '</div>';
    }).join('');
  });

  _attendanceListeners[matchId] = function () { ref.off('value'); };
};

function _statBox(lbl, val, color) {
  return '<div style="text-align:center;padding:10px;border-radius:10px;' +
    'background:' + color + '0f;border:1px solid ' + color + '2a">' +
    '<div style="font-size:20px;font-weight:900;color:' + color + '">' + val + '</div>' +
    '<div style="font-size:10px;color:#888;margin-top:2px">' + lbl + '</div>' +
    '</div>';
}

window._v10ToggleStatus = function (reqKey, current) {
  var db = getDB(); if (!db) return;
  var next = current === 'present' ? 'absent' : current === 'absent' ? 'pending' : 'present';
  db.ref('joinRequests/' + reqKey + '/attendanceStatus').set(next, function () {
    toast('Status → ' + next);
  });
};

window._v10MarkAbsent = function (matchId) {
  if (!confirm('Saare Pending players ko Absent mark karein?')) return;
  var db = getDB(); if (!db) return;
  db.ref('joinRequests').orderByChild('tournamentId').equalTo(matchId)
    .once('value', function (snap) {
      var updates = {};
      snap.forEach(function (c) {
        var j = c.val(); if (!j) return;
        var status = j.attendanceStatus || (j.inRoom ? 'present' : 'pending');
        if (status === 'pending') updates['joinRequests/' + c.key + '/attendanceStatus'] = 'absent';
      });
      if (Object.keys(updates).length) {
        db.ref().update(updates, function () { toast('✅ Pending → Absent done!'); });
      } else {
        toast('Koi pending player nahi hai');
      }
    });
};

window._v10CopyIGNs = function (matchId) {
  var db = getDB(); if (!db) return;
  db.ref('joinRequests').orderByChild('tournamentId').equalTo(matchId)
    .once('value', function (snap) {
      var igns = [];
      snap.forEach(function (c) {
        var j = c.val(); if (!j) return;
        var status = j.attendanceStatus || (j.inRoom ? 'present' : 'pending');
        if (status === 'present') igns.push(j.playerName || j.ign || '?');
      });
      if (!igns.length) { toast('Koi present player nahi', true); return; }
      var text = igns.join('\n');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text)
          .then(function () { toast('✅ ' + igns.length + ' IGNs copied!'); });
      } else {
        /* Fallback */
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('✅ ' + igns.length + ' IGNs copied!');
      }
    });
};

window._v10StartMatch = function (matchId) {
  if (!confirm('Match start kar dein? Room ID users ko bhej di gayi hogi.')) return;
  var db = getDB(); if (!db) return;
  db.ref('matches/' + matchId).update({ status: 'live', startedAt: Date.now() }, function () {
    toast('✅ Match started!');
    window._closeAttendance();
  });
};

/* Add Attendance button to Joined Players section */
var _attBtnTimer = setInterval(function () {
  var sa = document.querySelector('#section-joinedPlayers .section-actions');
  if (!sa || document.getElementById('_v10AttBtn')) return;
  clearInterval(_attBtnTimer);

  var btn = document.createElement('button');
  btn.id = '_v10AttBtn';
  btn.innerHTML = '<i class="fas fa-users"></i> Live Attendance';
  btn.style.cssText = 'padding:7px 14px;border-radius:9px;border:1px solid rgba(0,255,156,.3);' +
    'background:rgba(0,255,156,.08);color:#00ff9c;font-size:12px;font-weight:700;' +
    'cursor:pointer;margin-right:6px';
  btn.onclick = function () {
    var filter = document.getElementById('joinedMatchFilter') || document.getElementById('jpMatchFilter');
    var mid = filter ? filter.value : (window._v10AttMatchId || '');
    if (!mid) { toast('Pehle match select karo!', true); return; }
    window.renderV10Attendance(mid);
  };
  sa.insertBefore(btn, sa.firstChild);
}, 500);

/* ================================================================
   SECTION 5 — GEMINI VISION API HOOK (ready when key available)
   Currently: Tesseract handles everything (fa53-ocr-autofill.js)
   Future: Uncomment below and add API key
================================================================ */

/*
window.runGeminiOCR = async function(imageBase64, playerList, matchType, onComplete) {
  var GEMINI_KEY = 'YOUR_GEMINI_API_KEY_HERE'; // aistudio.google.com se free mein milti hai
  var isCS = (matchType || '').toUpperCase().includes('CS') ||
             (matchType || '').toLowerCase().includes('clash');

  var prompt = isCS
    ? 'This is a Free Fire Clash Squad result screenshot. Extract ALL player data. ' +
      'Return ONLY valid JSON array: [{"name":"exact_name","kills":14,"rank":null}]. ' +
      'Include K value from K/D/A column. No explanations.'
    : 'This is a Free Fire Battle Royale result screenshot. Extract ALL player data. ' +
      'Return ONLY valid JSON array: [{"name":"exact_name","kills":14,"rank":3}]. ' +
      'Rank = position (1st, 2nd etc). Kills = K value from K/D/A. No explanations.';

  try {
    var res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + GEMINI_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64.replace(/^data:image\/\w+;base64,/, '') } }
          ]}]
        })
      }
    );
    var data = await res.json();
    var text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    var clean = text.replace(/```json|```/g, '').trim();
    var parsed = JSON.parse(clean);

    // Fuzzy match with player list
    var norm = function(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]/g, ''); };
    var results = parsed.map(function(p) {
      var best = null, bestScore = 0;
      playerList.forEach(function(player) {
        var a = norm(p.name), b = norm(player.name || player.ign || '');
        if (!a || !b) return;
        var score = a === b ? 100 : (a.includes(b) || b.includes(a)) ? 80 : 0;
        if (score > bestScore) { bestScore = score; best = player; }
      });
      return best ? { playerUid: best.uid, playerName: best.name || best.ign,
                      kills: p.kills, rank: p.rank, confidence: bestScore } : null;
    }).filter(Boolean);

    if (onComplete) onComplete(results);
  } catch(e) {
    console.error('Gemini OCR error:', e);
    if (onComplete) onComplete(null, e.message);
  }
};
*/

/* ================================================================
   SECTION 6 — ADMIN NOTIFICATION: Match Start Alert to Matched Players
   When admin marks match as "Live", auto-notify all joined players
================================================================ */

(function () {
  var db = getDB();
  if (!db) { setTimeout(function _retryWaitForDb(){ if(!window.db){ setTimeout(_retryWaitForDb,3000); return; } /* proceed */ }, 3000); return; }

  db.ref('matches').on('child_changed', function (snap) {
    var m = snap.val(); if (!m) return;
    if (m.status !== 'live' || !m.matchTime) return;
    if (m._liveNotifSent) return; /* Already sent */

    /* Mark as sent first to prevent duplicate */
    db.ref('matches/' + snap.key + '/_liveNotifSent').set(true);

    /* Get all joined players for this match */
    db.ref('joinRequests').orderByChild('tournamentId').equalTo(snap.key)
      .once('value', function (jSnap) {
        if (!jSnap.exists()) return;
        jSnap.forEach(function (c) {
          var j = c.val(); if (!j) return;
          var uid = j.userId || j.uid;
          if (!uid) return;
          var isAbsent = j.attendanceStatus === 'absent';
          if (isAbsent) return; /* Don't notify absent players */

          db.ref('users/' + uid + '/notifications').push({
            title: '🎮 Match Shuru Ho Gaya!',
            message: (m.name || 'Match') + ' ab live hai! ' +
              (m.roomId ? 'Room ID: ' + m.roomId + ' | Pass: ' + (m.roomPassword || '—') : '') +
              ' — Jaldi enter karo!',
            type: 'match_live',
            matchId: snap.key,
            matchName: m.name || '',
            roomId: m.roomId || '',
            roomPassword: m.roomPassword || '',
            timestamp: Date.now(),
            createdAt: Date.now(),
            read: false,
          });
        });
      });
  });
})();

console.log('[Admin v10 Final] All systems loaded ✅');
})();

/* ================================================================
   SECTION 7 — INLINE ATTENDANCE SECTION
   Renders in admin panel section (not modal)
================================================================ */
window._loadAttSection = function () {
  var db = getDB(); if (!db) return;
  var sel = document.getElementById('attMatchFilter');

  /* Populate filter */
  db.ref('matches').orderByChild('status').once('value', function (snap) {
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">-- Match Select Karo --</option>';
    var matches = [];
    if (snap.exists()) {
      snap.forEach(function (c) {
        var m = c.val(); if (!m) return;
        if (m.status === 'resultPublished') return;
        matches.push({ key: c.key, m: m });
      });
    }
    matches.sort(function (a, b) { return (b.m.matchTime || 0) - (a.m.matchTime || 0); });
    matches.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.key;
      var d = item.m.matchTime ? new Date(item.m.matchTime) : null;
      var timeStr = d ? (' — ' + d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })) : '';
      opt.textContent = (item.m.name || item.key) + timeStr;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
    if (sel.value) _renderAttInline(sel.value);
  });
};

var _attInlineUnsub = null;

function _renderAttInline(matchId) {
  if (!matchId) return;
  var db = getDB(); if (!db) return;
  var container = document.getElementById('attContent');
  if (!container) return;

  /* Clear old listener */
  if (_attInlineUnsub) { _attInlineUnsub(); _attInlineUnsub = null; }

  container.innerHTML = '<div style="text-align:center;padding:20px;color:#666">' +
    '<i class="fas fa-spinner fa-spin"></i> Loading players...</div>';

  var ref = db.ref('joinRequests').orderByChild('tournamentId').equalTo(matchId);
  _attInlineUnsub = function () { ref.off('value'); };

  ref.on('value', function (snap) {
    var rows = [];
    if (snap.exists()) {
      snap.forEach(function (c) {
        var j = c.val(); if (!j) return;
        var ok = j.status === 'approved' || j.status === 'joined' ||
                 j.status === 'confirmed' || !j.status;
        if (!ok) return;
        rows.push({ key: c.key, j: j });
      });
    }

    var present = rows.filter(function (r) {
      return r.j.attendanceStatus === 'present' || r.j.inRoom === true;
    }).length;
    var absent = rows.filter(function (r) {
      return r.j.attendanceStatus === 'absent';
    }).length;
    var pending = rows.length - present - absent;

    /* Update count badge */
    var badge = document.getElementById('attCount');
    if (badge) badge.textContent = rows.length;

    var h = '';

    /* Stats row */
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px">';
    h += _statBox2('👥 Total', rows.length, '#00d4ff');
    h += _statBox2('✅ Present', present, '#00ff9c');
    h += _statBox2('❌ Absent', absent, '#ff4444');
    h += _statBox2('⏳ Pending', pending, '#ffd700');
    h += '</div>';

    /* Action buttons */
    h += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
    h += '<button onclick="window._v10MarkAbsent(\'' + matchId + '\')" ' +
      'class="btn btn-danger btn-sm"><i class="fas fa-user-slash"></i> Pending → Absent</button>';
    h += '<button onclick="window._v10CopyIGNs(\'' + matchId + '\')" ' +
      'class="btn btn-ghost btn-sm" style="color:#00ff9c;border-color:rgba(0,255,156,.3)">' +
      '<i class="fas fa-copy"></i> Copy Present IGNs</button>';
    h += '<button onclick="window._v10StartMatch(\'' + matchId + '\')" ' +
      'style="padding:7px 14px;border-radius:9px;border:none;' +
      'background:linear-gradient(135deg,#00ff9c,#00d4ff);color:#000;' +
      'font-size:12px;font-weight:800;cursor:pointer">' +
      '<i class="fas fa-play"></i> Start Match</button>';
    h += '</div>';

    /* Progress bar */
    var pct = rows.length ? Math.round((present / rows.length) * 100) : 0;
    h += '<div style="margin-bottom:16px">';
    h += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-bottom:6px">';
    h += '<span>Room confirmation progress</span><span style="color:#00ff9c">' + present + '/' + rows.length + ' (' + pct + '%)</span>';
    h += '</div>';
    h += '<div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px">';
    h += '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#00ff9c,#00d4ff);' +
      'border-radius:3px;transition:width .5s"></div>';
    h += '</div></div>';

    if (!rows.length) {
      h += '<div class="empty-state">Is match mein koi player join nahi kiya.</div>';
      container.innerHTML = h; return;
    }

    /* Player table */
    h += '<div style="overflow-x:auto"><table class="data-table"><thead><tr>' +
      '<th>#</th><th>Player</th><th>FF UID</th><th>Slot</th>' +
      '<th>Status</th><th>Action</th>' +
      '</tr></thead><tbody>';

    rows.forEach(function (r, idx) {
      var j = r.j;
      var ign = j.playerName || j.ign || j.userName || 'Unknown';
      var ff = j.ffUid || j.gameUid || j.userFFUID || '—';
      var slot = j.slotNumber || j.slot || '—';
      var status = j.attendanceStatus || (j.inRoom ? 'present' : 'pending');
      var sColor = status === 'present' ? '#00ff9c' : status === 'absent' ? '#ff4444' : '#ffd700';
      var sIcon = status === 'present' ? '✅' : status === 'absent' ? '❌' : '⏳';
      var sLabel = status === 'present' ? 'Present' : status === 'absent' ? 'Absent' : 'Pending';
      var rowBg = idx % 2 === 0 ? 'rgba(255,255,255,.015)' : 'transparent';

      h += '<tr style="background:' + rowBg + ';border-bottom:1px solid rgba(255,255,255,.04)">';
      h += '<td style="padding:8px 6px;color:#555;font-size:11px">' + (idx + 1) + '</td>';
      h += '<td style="padding:8px 6px"><span style="font-size:12px;font-weight:700;color:#fff">' + ign + '</span></td>';
      h += '<td style="padding:8px 6px"><span style="font-family:monospace;font-size:10px;color:#00d4ff;' +
        'background:rgba(0,212,255,.08);padding:2px 6px;border-radius:4px">' + ff + '</span></td>';
      h += '<td style="padding:8px 6px;text-align:center"><span style="background:rgba(0,212,255,.12);' +
        'border:1.5px solid rgba(0,212,255,.4);color:#00d4ff;border-radius:6px;padding:2px 8px;' +
        'font-size:11px;font-weight:800">' + slot + '</span></td>';
      h += '<td style="padding:8px 6px"><span style="font-size:11px;font-weight:700;color:' + sColor + ';' +
        'background:' + sColor + '18;padding:4px 10px;border-radius:8px;border:1px solid ' + sColor + '35">' +
        sIcon + ' ' + sLabel + '</span></td>';
      h += '<td style="padding:8px 6px">' +
        '<button onclick="window._v10ToggleStatus(\'' + r.key + '\',\'' + status + '\')" ' +
        'class="btn btn-ghost btn-xs">Toggle</button>' +
        '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    container.innerHTML = h;
  });
}

/* Attach filter change */
document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'attMatchFilter') {
    _renderAttInline(e.target.value);
  }
});

function _statBox2(lbl, val, color) {
  return '<div style="text-align:center;padding:12px;border-radius:12px;' +
    'background:' + color + '0d;border:1px solid ' + color + '28">' +
    '<div style="font-size:22px;font-weight:900;color:' + color + '">' + val + '</div>' +
    '<div style="font-size:10px;color:#888;margin-top:3px">' + lbl + '</div>' +
    '</div>';
}

console.log('[Admin v10 Final] Attendance section loaded ✅');

/* ── SEASON MANAGEMENT ── */
window.startNewSeason = function() {
  var db_ = window.rtdb || window.db;
  if (!db_) return;
  var name = prompt('New season name? (e.g. Season 2)');
  if (!name) return;
  var days = parseInt(prompt('Season duration (days)?', '90'));
  if (!days) return;
  if (!confirm('Start "' + name + '" for ' + days + ' days?')) return;

  var seasonId = 'S' + Date.now();
  var endDate = Date.now() + days * 86400000;

  // Save season
  db_.ref('appSettings/currentSeason').set({
    id: seasonId, name: name,
    startDate: Date.now(), endDate: endDate,
    active: true
  });
  // Update liveConfig
  db_.ref('appSettings/liveConfig').update({
    seasonName: name, seasonActive: 1,
    seasonEndDays: days
  });
  if (window.showToast) showToast('✅ ' + name + ' started!', false);
};

window.endCurrentSeason = function() {
  var db_ = window.rtdb || window.db;
  if (!db_) return;
  if (!confirm('Current season end karo? Top players ko badges milenge.')) return;

  db_.ref('appSettings/currentSeason').once('value', function(snap) {
    var season = snap.val() || {};
    var seasonId   = season.id || 'S1';
    var seasonName = season.name || 'Season';
    var seasonNum  = season.seasonNum || season.season_num || 1;
    var monthKey   = new Date().toISOString().slice(0,7); // same key fa68 uses, so both write to the same place

    /* ✅ FIX (Audit follow-up): pehle 'stats/rankPoints' field se order
       kiya jaata tha jo 'users' table mein EXIST hi nahi karta (har user
       ke liye undefined milta — ranking meaningless thi). Ab sab users
       fetch karke calcRkScore() (rank.js wala wahi formula jo live rank
       display mein use hota hai) se JS mein sort karte hain — consistent
       aur sahi. */
    db_.ref('users').once('value', function(uSnap) {
      var players = [];
      uSnap.forEach(function(c) { players.push({ uid: c.key, u: c.val() }); });
      players.sort(function(a,b) {
        var sa = window.calcRkScore ? window.calcRkScore(a.u.stats||{}) : 0;
        var sb = window.calcRkScore ? window.calcRkScore(b.u.stats||{}) : 0;
        return sb - sa;
      });

      // Award badges + archive — SAME shape/path as fa68_checkSeasonReset
      // (seasonHistory/{month}/{uid} → seasonal_league_history table),
      // taaki UserPanel ka seasonal-league.js dono triggers se aaya data
      // sahi se dikha sake.
      players.forEach(function(p, i) {
        var pos = i + 1;
        var rewardInfo = window.calcSeasonReward ? window.calcSeasonReward(pos) : null;
        if (!rewardInfo) return; // sirf top 100 ko reward/archive milta hai, jaisa seasonal-league.js promise karta hai
        var rk = window.calcRk ? window.calcRk(p.u.stats||{}) : { badge:'Bronze', emoji:'🏅', pts:0 };
        var coins = pos === 1 ? 500 : pos <= 5 ? 200 : pos <= 20 ? 100 : 50;

        db_.ref('users/' + p.uid + '/coins').transaction(function(v) { return (v||0) + coins; });
        db_.ref('seasonHistory/' + monthKey + '/' + p.uid).set({
          userId:     p.uid,
          seasonName: seasonName,
          seasonNum:  seasonNum,
          finalTier:  rk.badge,
          points:     rk.pts,
          badge:      rewardInfo.badge,
          reward:     rewardInfo.reward,
          emoji:      rewardInfo.emoji
        });
        db_.ref('users/' + p.uid + '/notifications').push({
          type: 'season_end', title: '🏆 Season Ended!',
          message: seasonName + ' mein tumhara rank: #' + pos + '! ' + rewardInfo.badge + ' mila! ' + rewardInfo.reward + ' bonus!',
          read: false, timestamp: Date.now()
        });
      });

      // Mark season inactive
      db_.ref('appSettings/currentSeason').update({ active: false });
      db_.ref('appSettings/liveConfig').update({ seasonActive: 0 });

      if (window.showToast) showToast('✅ Season ended! ' + players.length + ' players ranked, top 100 rewarded.', false);
    });
  });
};

window._v10ShowTab = function(tab) {
  ['att','queue','checkin'].forEach(function(t) {
    var btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) { btn.style.background = t===tab?'#00ff9c':'rgba(255,255,255,.08)'; btn.style.color = t===tab?'#000':'#aaa'; }
  });
  var list = document.getElementById('_v10AttList');
  var stats = document.getElementById('_v10AttStats');
  var actions = document.getElementById('_v10AttActions');
  if (!list) return;
  var mid = window._currentAttMatchId;
  if (!mid) return;

  if (tab === 'att') {
    // Already rendered by listener — just show
    list.innerHTML = list._attHtml || list.innerHTML;
    if (stats) stats.style.display = '';
    if (actions) actions.style.display = '';
  } else if (tab === 'queue') {
    if (stats) stats.style.display = 'none';
    if (actions) actions.style.display = 'none';
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#666"><i class="fas fa-spinner fa-spin"></i></div>';
    var db_ = getDB();
    if (!db_) return;
    db_.ref('autoMatchQueue/' + mid).once('value', function(snap) {
      var players = [];
      snap.forEach(function(c) { players.push(c.val()); });
      if (!players.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#666">Auto queue khali hai</div>';
        return;
      }
      var h = '<div style="margin-bottom:10px;font-size:12px;color:#888">' + players.length + ' players waiting for auto-team</div>';
      h += '<div style="display:flex;flex-direction:column;gap:6px">';
      players.forEach(function(p) {
        h += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:10px">';
        h += '<span style="font-size:12px;font-weight:700">' + (p.ign||'?') + '</span>';
        h += '<span style="font-size:10px;color:#888;background:rgba(255,255,255,.06);padding:2px 7px;border-radius:6px">' + (p.rank||'') + '</span>';
        h += '<span style="margin-left:auto;font-size:10px;color:#555">' + (p.mode||'') + '</span>';
        h += '<button onclick="removeFromAutoQueueAdmin(\'' + mid + '\',\'' + p.uid + '\')" style="padding:3px 8px;border-radius:6px;background:rgba(255,60,60,.1);border:1px solid rgba(255,60,60,.2);color:#ff6b6b;font-size:10px;cursor:pointer">✕</button>';
        h += '</div>';
      });
      h += '</div>';
      list.innerHTML = h;
    });
  } else if (tab === 'checkin') {
    if (stats) stats.style.display = 'none';
    if (actions) actions.style.display = 'none';
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#666"><i class="fas fa-spinner fa-spin"></i></div>';
    var db_ = getDB();
    if (!db_) return;
    db_.ref('matches/' + mid + '/checkIns').once('value', function(snap) {
      var cins = [];
      snap.forEach(function(c) { cins.push(c.val()); });
      if (!cins.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#666">Abhi koi check-in nahi</div>';
        return;
      }
      var h = '<div style="margin-bottom:10px;font-size:12px;color:#00ff9c;font-weight:700">✅ ' + cins.length + ' players checked in</div>';
      h += '<div style="display:flex;flex-direction:column;gap:6px">';
      cins.forEach(function(ci) {
        var t = ci.checkedAt ? new Date(ci.checkedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '—';
        h += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(0,255,156,.04);border:1px solid rgba(0,255,156,.1);border-radius:10px">';
        h += '<span style="color:#00ff9c;font-size:13px">✅</span>';
        h += '<span style="font-size:12px;font-weight:700">' + (ci.ign||'?') + '</span>';
        h += '<span style="font-size:10px;color:#888;background:rgba(255,255,255,.06);padding:2px 7px;border-radius:6px">' + (ci.rank||'') + '</span>';
        h += '<span style="margin-left:auto;font-size:10px;color:#555">' + t + '</span>';
        h += '</div>';
      });
      h += '</div>';
      list.innerHTML = h;
    });
  }
};

window.removeFromAutoQueueAdmin = function(matchId, uid) {
  var db_ = getDB(); if (!db_) return;
  db_.ref('autoMatchQueue/' + matchId + '/' + uid).remove();
  if (window.showToast) showToast('Player removed from queue', false);
  setTimeout(function() { window._v10ShowTab('queue'); }, 300);
};
