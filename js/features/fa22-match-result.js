/* ADMIN FEATURE A22: Match Result Section
   Joined Players jaisi table — In Room/Verify ki jagah Rank/Kills input
   + Screenshot upload + Publish/Correct results */
(function(){
'use strict';

var _mrScreenshots = [];
var _mrMatchData = null; // current match data
var _mrExistingResults = {}; // uid -> result (for correction mode)

// Expose to window so OCR (fa53) and other features can access
Object.defineProperty(window, '_mrScreenshots', {
  get: function() { return _mrScreenshots; },
  set: function(v) { _mrScreenshots = v; },
  configurable: true
});
Object.defineProperty(window, '_mrMatchData', {
  get: function() { return _mrMatchData; },
  configurable: true
});

/* ── Screenshot helpers ── */
window.mrAddScreenshots = function(input) {
  var files = input.files;
  if (!files || !files.length) return;
  for (var i = 0; i < files.length; i++) {
    (function(file) {
      var reader = new FileReader();
      reader.onload = function(e) {
        _mrScreenshots.push(e.target.result);
        mrRenderSsPreviews();
      };
      reader.readAsDataURL(file);
    })(files[i]);
  }
  input.value = '';
};

window.mrClearScreenshots = function() {
  _mrScreenshots = [];
  mrRenderSsPreviews();
};

function mrRenderSsPreviews() {
  var preview = document.getElementById('mrSsPreview');
  var countEl = document.getElementById('mrScreenshotCount');
  if (!preview) return;
  if (countEl) countEl.textContent = _mrScreenshots.length + ' selected';
  if (!_mrScreenshots.length) { preview.innerHTML = ''; return; }
  preview.innerHTML = _mrScreenshots.map(function(src, i) {
    return '<div style="position:relative;display:inline-block">' +
      '<img src="' + src + '" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:2px solid rgba(0,255,156,.3)">' +
      '<button onclick="mrRemoveSs(' + i + ')" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#ff4444;border:none;color:#fff;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1">&times;</button>' +
    '</div>';
  }).join('');
}

window.mrRemoveSs = function(idx) {
  _mrScreenshots.splice(idx, 1);
  mrRenderSsPreviews();
};

/* ── Populate match filter — same way as joinedPlayers section ── */
async function mrPopulateFilter() {
  var sel = document.getElementById('mrMatchFilter');
  if (!sel) return;
  var currentVal = sel.value;
  var matches = {};

  // Fast path: use allTournaments if already loaded
  if (window.allTournaments && Object.keys(window.allTournaments).length > 0) {
    matches = window.allTournaments;
  } else {
    // Fallback: fetch from Firebase with 8s timeout
    try {
      var _snap = await Promise.race([
        rtdb.ref('matches').once('value'),
        new Promise(function(_, rej) { setTimeout(function() { rej(new Error('timeout')); }, 8000); })
      ]);
      if (_snap.exists()) {
        _snap.forEach(function(c) { var d = c.val(); if (d) matches[c.key] = d; });
      }
    } catch(e) { console.warn('mrPopulateFilter fetch error:', e); }
  }

  sel.innerHTML = '<option value="">-- Select Match --</option>';
  // Sort by matchTime descending (newest first)
  var sorted = Object.keys(matches).sort(function(a, b) {
    return (matches[b].matchTime || 0) - (matches[a].matchTime || 0);
  });
  sorted.forEach(function(mid) {
    var m = matches[mid];
    if (!m) return;
    // ✅ FIX: Skip resultPublished matches — sirf unpublished dikhao
    if (m.status === 'resultPublished') return;
    var opt = document.createElement('option');
    opt.value = mid;
    opt.textContent = m.name || mid;
    sel.appendChild(opt);
  });
  // Store for use in loadMatchResultSection
  window._mrMatches = matches;
  if (currentVal) sel.value = currentVal;
}

/* ── Load players for selected match ── */
window.loadMatchResultSection = async function() {
  // If allTournaments not yet loaded, trigger loadTournaments first
  if (!window.allTournaments || Object.keys(window.allTournaments).length === 0) {
    if (window.loadTournaments) {
      try { await window.loadTournaments(); } catch(e) {}
    }
  }
  await mrPopulateFilter(); // await so matches are loaded before reading value
  var mid = (document.getElementById('mrMatchFilter') || {}).value || '';
  var tb = document.getElementById('mrPlayerTable');
  var countEl = document.getElementById('mrPlayerCount');
  var statusEl = document.getElementById('mrPublishStatus');
  if (!mid) {
    if (tb) tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#aaa">Select a match to load players</td></tr>';
    return;
  }
  if (typeof rtdb === 'undefined') return;
  if (tb) tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:14px;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

  try {
    _mrMatchData = (window._mrMatches || {})[mid] || null;
    var t = _mrMatchData;

    // Check if already published
    var statusSnap = await rtdb.ref('matches/' + mid + '/status').once('value');
    var alreadyPublished = (statusSnap.val() === 'resultPublished');

    // Load existing results for pre-fill
    _mrExistingResults = {};
    var eResSnap = await rtdb.ref('results').orderByChild('matchId').equalTo(mid).once('value');
    if (eResSnap.exists()) {
      eResSnap.forEach(function(c) { var d = c.val(); if (d && d.userId) _mrExistingResults[d.userId] = d; });
    }
    // Also check matches/{mid}/results/
    var mResSnap = await rtdb.ref('matches/' + mid + '/results').once('value');
    if (mResSnap.exists()) {
      mResSnap.forEach(function(c) { 
        var d = c.val();
        if (d && !_mrExistingResults[c.key]) _mrExistingResults[c.key] = { rank: d.rank, kills: d.kills, winnings: d.totalWinning || 0 };
      });
    }

    // Load join requests for this match
    var jsSnap = await rtdb.ref(DB_JOIN || 'joinRequests').once('value');
    var rows = [];
    if (jsSnap.exists()) {
      jsSnap.forEach(function(c) {
        var j = c.val();
        var tid = j.tournamentId || j.matchId;
        if (tid !== mid) return;
        var isJoined = j.status === 'approved' || j.status === 'joined' || j.status === 'confirmed' || !j.status;
        if (!isJoined) return;
        var uid = getUid ? getUid(j) : (j.userId || j.uid || c.key);
        rows.push({ uid: uid, reqKey: c.key, j: j });
      });
    }

    // Batch load phones
    var allUids = [...new Set(rows.map(function(r) { return r.uid; }).filter(Boolean))];
    var phones = {};
    if (allUids.length && rtdb) {
      await Promise.all(allUids.slice(0, 30).map(function(uid) {
        return rtdb.ref((DB_USERS || 'users') + '/' + uid + '/phone').once('value').then(function(s) {
          phones[uid] = s.val() || '';
        }).catch(function(){});
      }));
    }

    if (!rows.length) {
      if (tb) tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#aaa">No players found for this match</td></tr>';
      if (countEl) countEl.textContent = '0';
      return;
    }

    // Update publish button text
    var pubBtn = document.getElementById('mrPublishBtn');
    if (pubBtn) {
      if (alreadyPublished) {
        pubBtn.innerHTML = '<i class="fas fa-edit"></i> Correct Results (Already Published)';
        pubBtn.style.background = 'rgba(255,165,0,.15)';
        pubBtn.style.border = '1px solid rgba(255,165,0,.3)';
        pubBtn.style.color = '#ffa500';
      } else {
        pubBtn.innerHTML = '<i class="fas fa-check-double"></i> Publish Results & Distribute Prizes';
        pubBtn.style.background = '';
        pubBtn.style.border = '';
        pubBtn.style.color = '';
      }
    }
    if (statusEl) statusEl.textContent = alreadyPublished ? '⚠️ Results already published — editing will correct & re-notify users' : '';

    if (countEl) countEl.textContent = rows.length;

    // ✅ FIX: Prize pool info show karo (match-history wala style) — perKillPrize bhi dikhao
    var prizeInfoEl = document.getElementById('mrPrizePoolInfo');
    if (prizeInfoEl && t) {
      var f1 = t.firstPrize || 0, f2 = t.secondPrize || 0, f3 = t.thirdPrize || 0;
      var pk = Number(t.perKillPrize) || 0;
      var piHtml = '<span style="color:#ffd700">🥇 ₹'+f1+'</span> <span style="color:#c0c0c0">🥈 ₹'+f2+'</span> <span style="color:#cd7f32">🥉 ₹'+f3+'</span>';
      if (pk) piHtml += ' <span style="color:#ff9c00">💀 ₹'+pk+'/Kill</span>';
      prizeInfoEl.innerHTML = piHtml;
      prizeInfoEl.style.display = '';
    }

    var html = '';
    rows.forEach(function(r, i) {
      var j = r.j;
      var uid = r.uid;
      var nm = j.playerName || j.ign || j.userName || (getUserName ? getUserName(uid) : '') || 'Unknown';
      var ff = j.ffUid || j.userFFUID || j.gameUid || j.playerFfUid || '—';
      var slot = j.slotNumber || j.slot || '—';
      var phone = phones[uid] || j.phone || '—';
      var mode = (j.mode || (t && (t.gameMode || t.matchType)) || 'solo').toUpperCase();
      var entry = j.entryFee || (t && t.entryFee) || 0;
      var joinedAt = j.joinedAt || j.createdAt || j.timestamp || 0;
      var joinedStr = joinedAt ? new Date(joinedAt).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12: true }) : '—';

      // Pre-fill from existing results
      var er = _mrExistingResults[uid] || {};
      var preRank = er.rank || 0;
      var preKills = er.kills || 0;
      var preRp = er.rankPrize || 0;
      var preKp = er.killPrize || 0;
      var prePrize = er.winnings || er.totalWinning || 0;
      var prizeColor = prePrize > 0 ? '#00ff9c' : '#aaa';
      // Breakdown string for pre-filled prize
      var preBreakdown = '';
      if (preRp || preKp) preBreakdown = ' <span style="font-size:9px;color:#666">(R:₹'+preRp+'+K:₹'+preKp+')</span>';

      // ✅ FIX: data-slot row mein save karo squad sync ke liye
      var slotStr = String(slot);
      var teamId = (slotStr.indexOf('/') > -1) ? slotStr.split('/')[0] : '';

      // ✅ FIX: 0 value show mat karo — placeholder use karo taaki "20" issue na ho
      var rankVal = preRank > 0 ? preRank : '';
      var killsVal = preKills > 0 ? preKills : '';

      var rowBg = i % 2 === 0 ? 'rgba(255,255,255,.015)' : 'transparent';

      html += '<tr data-uid="' + uid + '" data-reqid="' + r.reqKey + '" data-slot="' + slotStr + '" data-team="' + teamId + '" style="background:' + rowBg + ';border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<td style="padding:7px 5px;color:#555;font-size:11px">' + (i+1) + '</td>' +
        '<td style="padding:7px 5px"><div style="font-size:12px;font-weight:700;color:var(--primary,#00ff9c);max-width:115px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + nm + '">' + nm + '</div></td>' +
        '<td style="padding:7px 5px"><span style="font-family:monospace;font-size:10px;color:#00d4ff;background:rgba(0,212,255,.08);padding:2px 5px;border-radius:4px">' + ff + '</span></td>' +
        '<td style="padding:7px 5px;text-align:center"><span style="background:rgba(0,212,255,.12);border:1.5px solid rgba(0,212,255,.4);color:#00d4ff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:800;font-family:monospace">' + slot + '</span></td>' +
        '<td style="padding:7px 5px;font-size:11px;color:#aaa;font-family:monospace">' + phone + '</td>' +
        '<td style="padding:7px 5px"><span style="font-size:10px;font-weight:700;color:#aaa">' + mode + '</span></td>' +
        '<td style="padding:7px 5px;color:#ffd700;font-size:11px;font-weight:700">₹' + entry + '</td>' +
        '<td style="padding:7px 5px;font-size:10px;color:#666">' + joinedStr + '</td>' +
        /* Rank input — onfocus: 0 clear karo | oninput: squad sync + prize calc */
        '<td style="padding:5px 4px;text-align:center"><input type="number" class="mr-rank-input" placeholder="0" min="0" value="' + rankVal + '" style="width:46px;padding:5px 3px;border-radius:6px;background:rgba(255,215,0,.08);border:1.5px solid rgba(255,215,0,.3);color:#ffd700;font-size:13px;text-align:center;font-weight:700;outline:none" onfocus="mrClearIfZero(this)" oninput="mrSquadSync(this,\'rank\');mrCalcPrize(this)"></td>' +
        /* Kills input — onfocus: 0 clear karo */
        '<td style="padding:5px 4px;text-align:center"><input type="number" class="mr-kills-input" placeholder="0" min="0" value="' + killsVal + '" style="width:46px;padding:5px 3px;border-radius:6px;background:rgba(255,107,107,.08);border:1.5px solid rgba(255,107,107,.3);color:#ff6b6b;font-size:13px;text-align:center;font-weight:700;outline:none" onfocus="mrClearIfZero(this)" oninput="mrCalcPrize(this)"></td>' +
        /* Auto-calculated prize */
        '<td class="mr-prize-cell" style="padding:7px 5px;font-weight:800;color:' + prizeColor + ';font-size:12px"><span style="color:' + prizeColor + '">₹' + prePrize + '</span>' + preBreakdown + '</td>' +
      '</tr>';
    });

    if (tb) tb.innerHTML = html;

  } catch(e) {
    if (tb) tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:14px;color:#ff4444">Error: ' + e.message + '</td></tr>';
    console.error('mrLoad error:', e);
  }
};

/* ── Auto-calc prize on rank/kills change (same logic as match-history correction) ── */
window.mrCalcPrize = function(inp) {
  var row = inp.closest('tr');
  if (!row) return;
  var rank = Number(row.querySelector('.mr-rank-input').value) || 0;
  var kills = Number(row.querySelector('.mr-kills-input').value) || 0;
  // Kills sanity check — FF max possible ~28 in a solo match
  if (kills > 30) {
    inp.style.borderColor = '#ff4444';
    inp.title = '⚠️ ' + kills + ' kills — suspicious! Check screenshot.';
  } else {
    inp.style.borderColor = '';
    inp.title = '';
  }
  var t = _mrMatchData;
  var rp = 0;
  if (rank === 1) rp = t ? t.firstPrize || 0 : 0;
  else if (rank === 2) rp = t ? t.secondPrize || 0 : 0;
  else if (rank === 3) rp = t ? t.thirdPrize || 0 : 0;
  // ✅ FIX: Per-kill prize include karo (match-history wala same method)
  var pk = t ? (Number(t.perKillPrize) || 0) : 0;
  var kp = kills * pk;
  var tw = rp + kp;
  var prizeCell = row.querySelector('.mr-prize-cell');
  if (prizeCell) {
    // Show total + breakdown
    var breakdownParts = [];
    if (rp > 0) breakdownParts.push('R:₹' + rp);
    if (kp > 0) breakdownParts.push(kills + 'k×₹' + pk);
    var breakdown = breakdownParts.length ? ' <span style="font-size:9px;color:#666">(' + breakdownParts.join('+') + ')</span>' : '';
    prizeCell.innerHTML = '<span style="color:' + (tw > 0 ? '#00ff9c' : '#aaa') + ';font-weight:800">₹' + tw + '</span>' + breakdown;
  }
  // ✅ FIX: Duplicate rank check karo after every change
  mrCheckDuplicateRanks();
};

/* ── Rank duplicate validator ── */
/* Solo/Duo: koi bhi 2 players same rank nahi rakh sakte
   Squad: same team ke players same rank rakh sakte hain (shared slot prefix) */
window.mrCheckDuplicateRanks = function() {
  var allRows = document.querySelectorAll('#mrPlayerTable tr[data-uid]');
  // Map: rank -> array of team IDs that have that rank
  var rankTeamMap = {};
  allRows.forEach(function(row) {
    var rank = Number(row.querySelector('.mr-rank-input').value) || 0;
    if (!rank) return;
    // Determine team from slot (e.g. "1/2" → team "1", solo "3" → team "row-uid")
    var slotEl = row.querySelector('td:nth-child(4) span');
    var slot = slotEl ? slotEl.textContent.trim() : '';
    var teamId;
    if (slot && slot.indexOf('/') > -1) {
      teamId = slot.split('/')[0]; // squad: team number is before "/"
    } else {
      teamId = row.dataset.uid; // solo/duo: each player is own team
    }
    if (!rankTeamMap[rank]) rankTeamMap[rank] = [];
    if (rankTeamMap[rank].indexOf(teamId) === -1) rankTeamMap[rank].push(teamId);
  });

  // Find ranks with more than 1 team
  var dupRanks = {};
  Object.keys(rankTeamMap).forEach(function(r) {
    if (rankTeamMap[r].length > 1) dupRanks[r] = true;
  });

  // Highlight duplicate rows
  allRows.forEach(function(row) {
    var rank = Number(row.querySelector('.mr-rank-input').value) || 0;
    var rankInp = row.querySelector('.mr-rank-input');
    if (rank && dupRanks[rank]) {
      rankInp.style.border = '2px solid #ff4444';
      rankInp.style.background = 'rgba(255,68,68,.15)';
      rankInp.title = '⚠️ Duplicate rank! Alag teams ki same rank nahi ho sakti';
    } else {
      rankInp.style.border = '1.5px solid rgba(255,215,0,.3)';
      rankInp.style.background = 'rgba(255,215,0,.08)';
      rankInp.title = '';
    }
  });

  // Show/hide warning banner
  var warn = document.getElementById('mrDupRankWarn');
  if (Object.keys(dupRanks).length > 0) {
    if (!warn) {
      var tb = document.getElementById('mrPlayerTable');
      if (tb && tb.parentNode) {
        var div = document.createElement('div');
        div.id = 'mrDupRankWarn';
        div.style.cssText = 'background:rgba(255,68,68,.12);border:1px solid rgba(255,68,68,.3);border-radius:8px;padding:8px 12px;margin-bottom:8px;color:#ff6b6b;font-size:12px;font-weight:700';
        div.innerHTML = '⚠️ Duplicate rank detected! Red highlighted players ki rank same hai — alag teams ki rank alag honi chahiye.';
        tb.parentNode.insertBefore(div, tb);
      }
    }
  } else {
    if (warn) warn.remove();
  }
};

/* ── ✅ FIX: Focus pe 0 clear karo taaki "20" issue na ho ── */
window.mrClearIfZero = function(inp) {
  if (inp.value === '0' || inp.value === '') {
    inp.value = '';
  }
  inp.select(); // full text select karo easy editing ke liye
};

/* ── ✅ FIX: Squad rank sync — ek member ka rank bharo, poori team sync hogi ── */
window.mrSquadSync = function(inp, field) {
  var row = inp.closest('tr');
  if (!row) return;
  var teamId = row.dataset.team;
  if (!teamId) return; // solo/duo — sync nahi karna

  var val = inp.value;
  // Same team ke baaki rows dhundho
  var allRows = document.querySelectorAll('#mrPlayerTable tr[data-uid]');
  allRows.forEach(function(r) {
    if (r === row) return; // khud ko skip
    if (r.dataset.team !== teamId) return; // alag team skip
    var targetInp = r.querySelector('.mr-rank-input');
    if (targetInp && targetInp.value !== val) {
      targetInp.value = val;
      mrCalcPrize(targetInp); // prize bhi update karo
    }
  });
};

/* ── Publish / Correct results ── */
window.mrPublishResults = async function() {
  var mid = (document.getElementById('mrMatchFilter') || {}).value || '';
  if (!mid) return showToast('Select a match first', true);
  if (typeof rtdb === 'undefined') return;

  var t = _mrMatchData;
  var rows = document.querySelectorAll('#mrPlayerTable tr[data-uid]');
  if (!rows.length) return showToast('No players loaded', true);

  // ✅ FIX: Duplicate rank check — publish se pehle block karo
  var rankTeamCheck = {};
  var hasDup = false;
  rows.forEach(function(row) {
    var rank = Number(row.querySelector('.mr-rank-input').value) || 0;
    if (!rank) return;
    var slotEl = row.querySelector('td:nth-child(4) span');
    var slot = slotEl ? slotEl.textContent.trim() : '';
    var teamId = (slot && slot.indexOf('/') > -1) ? slot.split('/')[0] : row.dataset.uid;
    if (!rankTeamCheck[rank]) rankTeamCheck[rank] = [];
    if (rankTeamCheck[rank].indexOf(teamId) === -1) rankTeamCheck[rank].push(teamId);
    if (rankTeamCheck[rank].length > 1) hasDup = true;
  });
  if (hasDup) return showToast('⚠️ Duplicate ranks hain! Fix karo phir publish karo.', true);

  // Check published status
  var statusSnap = await rtdb.ref('matches/' + mid + '/status').once('value');
  var alreadyPublished = (statusSnap.val() === 'resultPublished');

  var confirmMsg = alreadyPublished
    ? '⚠️ Results already published!\n\nCorrect karna chahte ho?\n• Zyada paise gaye → extra wapas katenge\n• Kam paise gaye → baaki add honge\n• Users ko notification milegi'
    : 'Confirm: Results publish karein aur prizes distribute karein?';
  if (!confirm(confirmMsg)) return;

  // Warn about unfilled rows
  var unfilledNames = [];
  rows.forEach(function(row) {
    var rank = Number(row.querySelector('.mr-rank-input').value) || 0;
    var kills = Number(row.querySelector('.mr-kills-input').value) || 0;
    if (!rank && !kills) {
      var nameEl = row.querySelector('td:nth-child(2) div');
      unfilledNames.push(nameEl ? nameEl.textContent.trim() : 'Unknown');
    }
  });
  if (unfilledNames.length > 0) {
    var warnMsg = '⚠️ ' + unfilledNames.length + ' players ka rank/kills fill nahi hai:\n' +
      unfilledNames.slice(0, 5).join(', ') + (unfilledNames.length > 5 ? '...' : '') +
      '\n\nFir bhi publish karna hai?';
    if (!confirm(warnMsg)) return;
  }

  var pubBtn = document.getElementById('mrPublishBtn');
  var statusEl = document.getElementById('mrPublishStatus');
  if (pubBtn) { pubBtn.disabled = true; pubBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing (0/' + rows.length + ')...'; }
  if (statusEl) statusEl.textContent = 'Processing...';

  try {
    // Upload screenshots
    var uploadedUrls = [];
    if (_mrScreenshots.length > 0 && storage) {
      for (var si = 0; si < _mrScreenshots.length; si++) {
        try {
          var sRef = storage.ref('resultScreenshots/' + mid + '/' + Date.now() + '_' + si + '.jpg');
          await sRef.putString(_mrScreenshots[si], 'data_url');
          var sUrl = await sRef.getDownloadURL();
          uploadedUrls.push(sUrl);
        } catch(se) { console.warn('Screenshot upload failed:', se); }
      }
      if (uploadedUrls.length) {
        await rtdb.ref('matches/' + mid + '/resultScreenshot').set(uploadedUrls[0]);
        await rtdb.ref('matches/' + mid + '/resultScreenshots').set(uploadedUrls);
      }
    }

    var totalPlayers = rows.length;
    var DB_U = DB_USERS || 'users';
    var DB_J = DB_JOIN || 'joinRequests';

    for (var i = 0; i < rows.length; i++) {
      if (pubBtn) pubBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing (' + (i+1) + '/' + rows.length + ')...';
      var row = rows[i];
      var uid = row.dataset.uid;
      var reqId = row.dataset.reqid;
      var rank = Number(row.querySelector('.mr-rank-input').value) || 0;
      var kills = Number(row.querySelector('.mr-kills-input').value) || 0;
      var rp = 0;
      if (rank === 1) rp = t ? t.firstPrize || 0 : 0;
      else if (rank === 2) rp = t ? t.secondPrize || 0 : 0;
      else if (rank === 3) rp = t ? t.thirdPrize || 0 : 0;
      // ✅ FIX: Per-kill prize bhi add karo (match-history wala same method)
      var pk = t ? (Number(t.perKillPrize) || 0) : 0;
      var kp = kills * pk;
      var tw = rp + kp;

      if (alreadyPublished) {
        // CORRECTION MODE
        var oldResult = _mrExistingResults[uid] || {};
        var oldTw = oldResult.winnings || oldResult.totalWinning || 0;
        var oldKills = oldResult.kills || 0;
        var delta = tw - oldTw;
        var killDelta = kills - oldKills;

        await rtdb.ref('matches/' + mid + '/results/' + uid).update({ rank: rank, kills: kills, rankPrize: rp, killPrize: kp, totalWinning: tw, correctedAt: Date.now() });
        await rtdb.ref(DB_J + '/' + reqId).update({ kills: kills, rank: rank, reward: tw, resultStatus: 'completed' });

        if (delta !== 0) {
          await rtdb.ref(DB_U + '/' + uid + '/realMoney/winnings').transaction(function(v){ return Math.max(0, (v||0) + delta); });
          await rtdb.ref(DB_U + '/' + uid + '/wallet/winningBalance').transaction(function(v){ return Math.max(0, (v||0) + delta); });
          await rtdb.ref(DB_U + '/' + uid + '/stats/earnings').transaction(function(v){ return Math.max(0, (v||0) + delta); });
          await rtdb.ref(DB_U + '/' + uid + '/totalWinnings').transaction(function(v){ return Math.max(0, (v||0) + delta); });

          var deltaReason = delta > 0
            ? '₹' + delta + ' add kiya — ' + (t ? t.name : 'Match') + ' result correction (Rank #' + rank + ')'
            : '₹' + Math.abs(delta) + ' adjust kiya — ' + (t ? t.name : 'Match') + ' result correction (Rank #' + rank + ')';
          await rtdb.ref(DB_U + '/' + uid + '/transactions').push({ type: delta > 0 ? 'correction_credit' : 'correction_debit', amount: Math.abs(delta), description: deltaReason, timestamp: Date.now() });

          var notifMsg = delta > 0
            ? '✅ Result correction: ₹' + delta + ' add kiya gaya. Match: ' + (t ? t.name : '') + ', Rank #' + rank + '. Pehle record mein galti thi, ab sahi kar diya gaya.'
            : '⚠️ Result correction: ₹' + Math.abs(delta) + ' wapas liya gaya. Match: ' + (t ? t.name : '') + ', Rank #' + rank + '. Pehle galti se zyada prize diya gaya tha.';
          await rtdb.ref(DB_U + '/' + uid + '/notifications').push({ title: '🔧 Result Correction', message: notifMsg, timestamp: Date.now(), read: false, type: 'correction', uid: uid });
        }
        if (killDelta !== 0) {
          await rtdb.ref(DB_U + '/' + uid + '/totalKills').transaction(function(v){ return Math.max(0, (v||0) + killDelta); });
          await rtdb.ref(DB_U + '/' + uid + '/stats/kills').transaction(function(v){ return Math.max(0, (v||0) + killDelta); });
        }

      } else {
        // FIRST PUBLISH
        await rtdb.ref('matches/' + mid + '/results/' + uid).set({ rank: rank, kills: kills, killPrize: kp, rankPrize: rp, totalWinning: tw, timestamp: Date.now() });
        var resultRef = rtdb.ref('results').push();
        await resultRef.set({ userId: uid, matchId: mid, matchName: t ? t.name : '', rank: rank, kills: kills, winnings: tw, won: rank === 1, entryFee: t ? t.entryFee || 0 : 0, totalPlayers: totalPlayers, timestamp: Date.now(), createdAt: Date.now(), cashbackGiven: false });
        await rtdb.ref(DB_J + '/' + reqId).update({ kills: kills, rank: rank, reward: tw, resultStatus: 'completed' });
        await rtdb.ref(DB_U + '/' + uid + '/totalKills').transaction(function(v){ return (v||0) + kills; });
        await rtdb.ref(DB_U + '/' + uid + '/stats/kills').transaction(function(v){ return (v||0) + kills; });
        if (tw > 0) {
          await rtdb.ref(DB_U + '/' + uid + '/realMoney/winnings').transaction(function(v){ return (v||0) + tw; });
          await rtdb.ref(DB_U + '/' + uid + '/wallet/winningBalance').transaction(function(v){ return (v||0) + tw; });
          await rtdb.ref(DB_U + '/' + uid + '/stats/earnings').transaction(function(v){ return (v||0) + tw; });
          await rtdb.ref(DB_U + '/' + uid + '/totalWinnings').transaction(function(v){ return (v||0) + tw; });
          if (rank === 1) await rtdb.ref(DB_U + '/' + uid + '/stats/wins').transaction(function(v){ return (v||0) + 1; });
          await rtdb.ref(DB_U + '/' + uid + '/transactions').push({ type: 'winning', amount: tw, description: (t ? t.name : 'Match') + ' — Rank #' + rank + ', ' + kills + ' kills', timestamp: Date.now() });
          await rtdb.ref(DB_U + '/' + uid + '/notifications').push({ title: '🏆 Match Result!', message: '₹' + tw + ' jeeta! ' + (t ? t.name : '') + ' — Rank #' + rank + ', ' + kills + ' kills. Paise wallet mein add ho gaye.', timestamp: Date.now(), read: false, type: 'result', uid: uid, matchId: mid });
        } else {
          await rtdb.ref(DB_U + '/' + uid + '/notifications').push({ title: '📋 Match Result', message: (t ? t.name : 'Match') + ' — Tumhara rank: ' + (rank ? '#' + rank : 'Unranked') + ', Kills: ' + kills + '. Better luck next time! 💪', timestamp: Date.now(), read: false, type: 'result', uid: uid, matchId: mid });
        }
        // Cashback for top 50%
        var entryF = t ? t.entryFee || 0 : 0;
        var cbThreshold = Math.ceil(totalPlayers / 2);
        if (rank > 0 && rank <= cbThreshold && entryF > 0 && tw === 0) {
          var cb = Math.floor(entryF * 0.25);
          if (cb > 0) {
            await rtdb.ref(DB_U + '/' + uid + '/coins').transaction(function(v){ return (v||0) + cb; });
            await rtdb.ref(DB_U + '/' + uid + '/coinHistory').push({ amount: cb, reason: '25% cashback — ' + (t ? t.name : '') + ' (Rank #' + rank + ')', timestamp: Date.now(), type: 'cashback' });
            await rtdb.ref(DB_U + '/' + uid + '/notifications').push({ title: '🎁 Cashback!', message: cb + ' coins cashback mila! ' + (t ? t.name : '') + ', Rank #' + rank + '. Top 50% finishers ko 25% entry fee cashback milta hai.', timestamp: Date.now(), read: false, type: 'cashback', uid: uid });
          }
        }
        // Platform earnings
        await rtdb.ref('platformEarnings').push({ matchId: mid, entryFee: entryF, prizeGiven: tw, profit: entryF - tw, userId: uid, timestamp: Date.now() });
        // lastResult for recap
        await rtdb.ref(DB_U + '/' + uid + '/lastResult').set({ rank: rank, kills: kills, winnings: tw, matchName: t ? t.name : '', matchId: mid, timestamp: Date.now() });
      }
    }

    if (!alreadyPublished) {
      await rtdb.ref('matches/' + mid).update({ status: 'resultPublished', resultPublishedAt: Date.now() });
    } else {
      await rtdb.ref('matches/' + mid).update({ resultCorrectedAt: Date.now() });
    }

    _mrScreenshots = [];
    mrRenderSsPreviews();

    if (pubBtn) { pubBtn.disabled = false; }
    if (statusEl) statusEl.textContent = alreadyPublished ? '✅ Correction done! Users notified.' : '✅ Results published! Prizes distributed.';
    showToast(alreadyPublished ? '✅ Result correction done!' : '✅ Results published!');
    // Navigate to match history after 1 second
    setTimeout(function() {
      if (window.showSection) showSection('match-history', null);
    }, 1200);

  } catch(err) {
    if (pubBtn) { pubBtn.disabled = false; pubBtn.innerHTML = '<i class="fas fa-check-double"></i> Publish Results'; }
    if (statusEl) statusEl.textContent = '❌ Error: ' + err.message;
    showToast('Error: ' + err.message, true);
    console.error('mrPublish error:', err);
  }
};

})();

/* ── FA22 EXTENSION: 3-Currency Prize Distribution ── */
window.distributePrizesV2 = function(matchId, results) {
  var db = window.rtdb || window.db;
  if (!db) return;

  db.ref('matches/' + matchId).once('value', function(snap) {
    var match = snap.val(); if (!match) return;
    var prizes = match.prizes || {};
    var matchCategory = match.matchCategory || match.entryType || 'paid';

    results.forEach(function(r) {
      if (!r.userId) return;
      var reward = { coins: 0, skyDiamonds: 0, greenDiamonds: 0 };
      var rankPrize = null;

      if (r.rank === 1) rankPrize = prizes.first;
      else if (r.rank === 2) rankPrize = prizes.second;
      else if (r.rank === 3) rankPrize = prizes.third;

      if (rankPrize) {
        reward.coins = Number(rankPrize.coins || 0);
        reward.skyDiamonds = Number(rankPrize.skyDiamonds || 0);
        reward.greenDiamonds = Number(rankPrize.greenDiamonds || 0);
      }

      // Per-kill reward
      var kills = Number(r.kills || 0);
      if (kills > 0 && prizes.perKill) {
        reward.coins += kills * Number(prizes.perKill.coins || 0);
        reward.skyDiamonds += kills * Number(prizes.perKill.skyDiamonds || 0);
        reward.greenDiamonds += kills * Number(prizes.perKill.greenDiamonds || 0);
      }

      // Apply to user
      var userRef = db.ref('users/' + r.userId);
      if (reward.coins > 0) {
        userRef.child('coins').transaction(function(c) { return (c||0) + reward.coins; });
        userRef.child('coinHistory').push({ amount: reward.coins, reason: 'Match Prize: ' + (match.name||'Match'), rank: r.rank, timestamp: Date.now() });
      }
      if (reward.skyDiamonds > 0) {
        userRef.child('skyDiamonds').transaction(function(c) { return (c||0) + reward.skyDiamonds; });
        userRef.child('skyDiamondHistory').push({ amount: reward.skyDiamonds, reason: 'Match Prize: ' + (match.name||'Match'), rank: r.rank, timestamp: Date.now() });
        // Also update realMoney.winnings for backward compat
        userRef.child('realMoney/winnings').transaction(function(c) { return (c||0) + reward.skyDiamonds; });
      }
      if (reward.greenDiamonds > 0) {
        userRef.child('greenDiamonds').transaction(function(c) { return (c||0) + reward.greenDiamonds; });
        userRef.child('greenDiamondHistory').push({ amount: reward.greenDiamonds, reason: 'Match Prize: ' + (match.name||'Match'), rank: r.rank, timestamp: Date.now() });
        // Track in stats
        userRef.child('stats/greenDiamonds').transaction(function(c) { return (c||0) + reward.greenDiamonds; });
      }

      // Update match stats
      if (matchCategory === 'ad') userRef.child('stats/adMatches').transaction(function(c) { return (c||0)+1; });
      else if (matchCategory === 'coin') userRef.child('stats/coinMatches').transaction(function(c) { return (c||0)+1; });
      else userRef.child('stats/paidMatches').transaction(function(c) { return (c||0)+1; });

      if (r.rank === 1) userRef.child('stats/wins').transaction(function(c) { return (c||0)+1; });
      if (kills > 0) userRef.child('stats/kills').transaction(function(c) { return (c||0)+kills; });

      // Notify user
      userRef.child('notifications').push({
        type: 'result',
        title: '🏆 Match Result!',
        message: 'Rank #' + r.rank + ', Kills: ' + kills +
          (reward.coins ? ' | 🪙 +' + reward.coins : '') +
          (reward.skyDiamonds ? ' | 💠 +' + reward.skyDiamonds : '') +
          (reward.greenDiamonds ? ' | 💚 +' + reward.greenDiamonds : ''),
        matchId: matchId, matchName: match.name || '',
        read: false, timestamp: Date.now()
      });
    });

    // Mark match distributed
    db.ref('matches/' + matchId + '/prizeDistributed').set(true);
    db.ref('matches/' + matchId + '/distributedAt').set(Date.now());
    if (window.showToast) showToast('Prizes distributed! (3-currency system)', false);
  });
};
