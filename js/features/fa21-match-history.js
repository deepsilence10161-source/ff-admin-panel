/* ADMIN FEATURE A21: Match History
   Complete record of all matches played — who joined, results, fees, prizes */
(function(){
'use strict';

var _allJoinData = [], _matchNames = {}, _loaded = false;

window.loadMatchHistory = async function() {
  var el = document.getElementById('matchHistoryTable');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  
  // Timeout helper
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function(_, rej) { setTimeout(function() { rej(new Error('Timeout: Firebase slow/blocked')); }, ms); })
    ]);
  }
  
  try {
    // Load matches, joinRequests, results in parallel with 10s timeout
    var results = await withTimeout(
      Promise.all([
        rtdb.ref('matches').once('value'),
        rtdb.ref('joinRequests').once('value'),
        rtdb.ref('results').once('value')
      ]),
      10000
    );
    var ms = results[0], js = results[1], resSnap = results[2];

    // Match names
    _matchNames = {};
    if (ms.exists()) ms.forEach(function(c){ var d=c.val(); if(d) _matchNames[c.key] = d.name || c.key; });
    
    // Populate match filter
    var sel = document.getElementById('mhMatchFilter');
    if (sel) {
      sel.innerHTML = '<option value="">All Matches</option>';
      Object.keys(_matchNames).forEach(function(mid) {
        var opt = document.createElement('option');
        opt.value = mid; opt.textContent = _matchNames[mid];
        sel.appendChild(opt);
      });
    }
    
    // Join requests
    _allJoinData = [];
    if (js.exists()) {
      js.forEach(function(c) {
        var d = c.val(); if (!d) return;
        d._key = c.key;
        _allJoinData.push(d);
      });
    }
    
    // Results
    var resultsByUser = {};
    if (resSnap.exists()) {
      resSnap.forEach(function(c) {
        var d = c.val(); if (!d || !d.userId) return;
        var key = (d.matchId||'')+'__'+(d.userId||'');
        resultsByUser[key] = d;
      });
    }
    
    // Merge results into join data
    _allJoinData.forEach(function(d) {
      var key = (d.matchId||d.tournamentId||'')+'__'+(d.userId||d.uid||'');
      var res = resultsByUser[key];
      if (res) {
        d.rank = d.rank || res.rank;
        d.kills = d.kills || res.kills;
        d.reward = d.reward || res.winnings;
        d.resultStatus = d.resultStatus || 'completed';
      }
    });
    
    _loaded = true;
    renderMatchHistory(_allJoinData);
  } catch(e) {
    if (el) el.innerHTML = '<div style="color:#ff4444;padding:14px;text-align:center">⚠️ Error: ' + e.message + '</div>';
    console.error('loadMatchHistory error:', e);
  }
};

function renderMatchHistory(data) {
  var el = document.getElementById('matchHistoryTable');
  if (!el) return;
  
  if (!data.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa">No match history found</div>';
    return;
  }
  
  // Sort by newest first
  data = data.slice().sort(function(a,b){ return (b.createdAt||0) - (a.createdAt||0); });
  
  var h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
    + '<thead><tr style="background:rgba(255,255,255,.04);border-bottom:2px solid rgba(0,255,156,.2)">'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">#</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Match</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Player</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">FF UID</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Mode</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Slot</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Fee</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Rank</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Kills</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Prize</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Date</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Status</th>'
    + '<th style="padding:8px 10px;text-align:left;color:var(--primary,#00ff9c);font-size:11px">Action</th>'
    + '</tr></thead><tbody>';
  
  data.forEach(function(d, i) {
    var ts = d.createdAt || d.timestamp || 0;
    var dateStr = ts ? new Date(ts).toLocaleString('en-IN',{day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
    var matchName = _matchNames[d.matchId] || d.matchName || d.matchId || '-';
    var ign = d.userName || d.playerName || d.ign || 'Unknown';
    var ffUid = d.userFFUID || d.ffUid || '-';
    var mode = (d.mode || 'solo').toUpperCase();
    var slot = d.slotNumber || d.slot || '-';
    var fee = d.entryFee || 0;
    var rank = d.rank || 0;
    var kills = d.kills || 0;
    var prize = d.reward || d.winnings || 0;
    var status = d.resultStatus || d.status || 'joined';
    var statusColor = status === 'completed' ? '#00ff9c' : status === 'cancelled' ? '#ff4444' : '#ffd700';
    
    var rowBg = i % 2 === 0 ? 'rgba(255,255,255,.02)' : 'transparent';
    h += '<tr style="background:'+rowBg+';border-bottom:1px solid rgba(255,255,255,.04)">'
      + '<td style="padding:7px 10px;color:#aaa">'+(i+1)+'</td>'
      + '<td style="padding:7px 10px;font-weight:600;color:#fff;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+matchName+'">'+matchName+'</td>'
      + '<td style="padding:7px 10px;color:var(--primary,#00ff9c);font-weight:700">'+ign+'</td>'
      + '<td style="padding:7px 10px;color:#00d4ff;font-family:monospace;font-size:11px">'+ffUid+'</td>'
      + '<td style="padding:7px 10px;color:#aaa">'+mode+'</td>'
      + '<td style="padding:7px 10px;color:#aaa">'+slot+'</td>'
      + '<td style="padding:7px 10px;color:#ffd700">₹'+fee+'</td>'
      + '<td style="padding:7px 10px;font-weight:700;color:'+(rank===1?'#ffd700':rank===2?'#c0c0c0':rank===3?'#cd7f32':'#aaa')+'">'+(rank?'#'+rank:'-')+'</td>'
      + '<td style="padding:7px 10px;color:#ff6b6b">'+kills+'</td>'
      + '<td style="padding:7px 10px;font-weight:700;color:'+(prize>0?'#00ff9c':'#aaa')+'">₹'+prize+'</td>'
      + '<td style="padding:7px 10px;color:#aaa;font-size:11px">'+dateStr+'</td>'
      + '<td style="padding:7px 10px"><span style="font-size:10px;font-weight:700;color:'+statusColor+'">'+status.toUpperCase()+'</span></td>'
      + '<td style="padding:7px 10px"><button onclick="openResultCorrection(\'' + (d.matchId||d.tournamentId||'') + '\',\'' + (d.userId||d.uid||'') + '\',\'' + (d.userName||d.ign||'') + '\')" style="padding:4px 8px;border-radius:6px;background:rgba(255,170,0,.12);color:#ffaa00;border:1px solid rgba(255,170,0,.2);font-size:9px;font-weight:700;cursor:pointer"><i class="fas fa-edit"></i> Fix</button></td>'
      + '</tr>';
  });
  
  h += '</tbody></table></div>';
  h += '<div style="font-size:11px;color:#aaa;padding:8px;text-align:right">Total records: '+data.length+'</div>';
  el.innerHTML = h;
}

window.filterMatchHistory = function() {
  if (!_loaded) { loadMatchHistory(); return; }
  var q = (document.getElementById('mhSearch')||{}).value||'';
  var mid = (document.getElementById('mhMatchFilter')||{}).value||'';
  q = q.toLowerCase().trim();
  var filtered = _allJoinData.filter(function(d) {
    if (mid && d.matchId !== mid) return false;
    if (!q) return true;
    var s = [d.userName,d.ign,d.playerName,d.userFFUID,d.ffUid,d.matchName,_matchNames[d.matchId]].join(' ').toLowerCase();
    return s.indexOf(q) > -1;
  });
  renderMatchHistory(filtered);
};

})();

/* ─── RESULT CORRECTION ─── */
window.openResultCorrection = async function(matchId, userId, userName) {
  var rtdb = window.rtdb || window.db;
  if (!rtdb) return;

  /* Fetch fresh match data + existing result for this player */
  var m = document.getElementById('genericModal'), mt = document.getElementById('genericModalTitle'), mb = document.getElementById('genericModalBody');
  if(!m || !mt || !mb) return;
  mt.innerHTML = '✏️ Correct Result';
  mb.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  m.classList.add('show');

  try {
    var results = await Promise.all([
      rtdb.ref('matches/' + matchId).once('value'),
      rtdb.ref('results').orderByChild('userId').equalTo(userId).once('value'),
      rtdb.ref('users/' + userId).once('value'),
      rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value')
    ]);
    var matchSnap = results[0], resSnap = results[1], userSnap = results[2], jrSnap = results[3];
    var match = matchSnap.val() || {};
    var userData = userSnap.val() || {};

    /* Find existing result for this player in this match */
    var existRes = null, resKey = null;
    if (resSnap.exists()) {
      resSnap.forEach(function(c) {
        var d = c.val();
        if ((d.matchId || d.tournamentId) === matchId) { existRes = d; resKey = c.key; }
      });
    }

    /* Find joinRequest for this player */
    var jrData = null;
    if (jrSnap.exists()) {
      jrSnap.forEach(function(c) {
        var d = c.val();
        if (d.userId === userId || d.userId === userId) jrData = d;
      });
    }

    var preRank = existRes ? (existRes.rank || 0) : 0;
    var preKills = existRes ? (existRes.kills || 0) : 0;
    var preRp = existRes ? (existRes.rankPrize || 0) : 0;
    var preKp = existRes ? (existRes.killPrize || 0) : 0;
    var preTw = existRes ? (existRes.winnings || existRes.totalWinning || 0) : 0;
    var ffUid = userData.ffUid || jrData?.userFFUID || '-';
    var slot = jrData ? (jrData.slotNumber || '-') : '-';
    var entryFee = jrData ? (jrData.entryFee || 0) : (match.entryFee || 0);
    var f1 = match.firstPrize || 0, f2 = match.secondPrize || 0, f3 = match.thirdPrize || 0;
    var pk = Number(match.perKillPrize) || 0;

    var h = '<div style="padding:4px">';

    /* Player info card - read only */
    h += '<div style="background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.15);border-radius:10px;padding:10px;margin-bottom:12px">';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">';
    h += '<div><span style="color:#aaa">👤 Player</span><br><strong style="color:#00d4ff">'+userName+'</strong></div>';
    h += '<div><span style="color:#aaa">🎮 FF UID</span><br><strong style="color:#00d4ff;font-family:monospace">'+ffUid+'</strong></div>';
    h += '<div><span style="color:#aaa">🗂️ Match</span><br><strong style="color:#fff;font-size:10px">'+( match.name || matchId)+'</strong></div>';
    h += '<div><span style="color:#aaa">🎯 Slot</span><br><strong style="color:#ffd700">'+slot+'</strong></div>';
    h += '<div><span style="color:#aaa">💰 Entry Paid</span><br><strong style="color:#ffd700">₹'+entryFee+'</strong></div>';
    h += '<div><span style="color:#aaa">🏆 Mode</span><br><strong style="color:#fff">'+(match.mode||match.gameMode||'-').toUpperCase()+'</strong></div>';
    h += '</div></div>';

    /* Prize pool info */
    h += '<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.15);border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:11px;display:flex;gap:12px;flex-wrap:wrap">';
    h += '<span style="color:#ffd700">🥇 ₹'+f1+'</span><span style="color:#c0c0c0">🥈 ₹'+f2+'</span><span style="color:#cd7f32">🥉 ₹'+f3+'</span>';
    if(pk) h += '<span style="color:#ff9c00">💀 ₹'+pk+'/Kill</span>';
    h += '</div>';

    /* Old result if exists */
    if(existRes) {
      h += '<div style="background:rgba(255,100,0,.06);border:1px solid rgba(255,100,0,.2);border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:11px">';
      h += '<div style="color:#ff9c00;font-weight:700;margin-bottom:4px">📋 Current (Published) Result:</div>';
      h += '<span style="margin-right:10px">Rank: <strong style="color:#fff">'+(preRank?'#'+preRank:'—')+'</strong></span>';
      h += '<span style="margin-right:10px">Kills: <strong style="color:#ff6b6b">'+preKills+'</strong></span>';
      h += '<span>Prize: <strong style="color:#00ff9c">₹'+preTw+'</strong>';
      if(preRp||preKp) h += ' <span style="font-size:10px;color:#888">(R:₹'+preRp+' + K:₹'+preKp+')</span>';
      h += '</span></div>';
    }

    /* Editable fields */
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
    h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:5px">🎯 Correct Rank</label>';
    h += '<input type="number" id="rcRank" min="0" max="99" value="'+preRank+'" oninput="rcAutoCalc()" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid #333;color:#ffd700;font-size:16px;text-align:center;font-weight:800;box-sizing:border-box"></div>';
    h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:5px">💀 Correct Kills</label>';
    h += '<input type="number" id="rcKills" min="0" value="'+preKills+'" oninput="rcAutoCalc()" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid #333;color:#ff6b6b;font-size:16px;text-align:center;font-weight:800;box-sizing:border-box"></div>';
    h += '</div>';

    /* Auto-calculated prize preview */
    h += '<div id="rcPrizePreview" style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);border-radius:10px;padding:10px;margin-bottom:12px;text-align:center">';
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:4px">Calculated Prize</div>';
    h += '<div id="rcPrizeVal" style="font-size:22px;font-weight:800;color:#00ff9c">₹'+preTw+'</div>';
    h += '<div id="rcPrizeBreakdown" style="font-size:10px;color:#666;margin-top:2px"></div>';
    h += '</div>';

    /* Manual override toggle */
    h += '<div style="margin-bottom:12px">';
    h += '<label style="font-size:11px;color:#aaa;cursor:pointer"><input type="checkbox" id="rcManualOverride" onchange="rcToggleManual()" style="margin-right:5px"> Manual prize override karo (auto-calc ignore karo)</label>';
    h += '<div id="rcManualWrap" style="display:none;margin-top:8px">';
    h += '<input type="number" id="rcPrize" min="0" placeholder="Override prize amount" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid rgba(255,170,0,.3);color:#ffaa00;font-size:14px;text-align:center;box-sizing:border-box">';
    h += '</div></div>';

    h += '<button onclick="submitResultCorrection(\''+matchId+'\',\''+userId+'\',\''+userName+'\')" style="width:100%;padding:12px;border-radius:10px;background:linear-gradient(135deg,#ffaa00,#ff8800);color:#000;font-weight:800;border:none;cursor:pointer;font-size:14px"><i class="fas fa-save"></i> Save Correction</button>';
    h += '</div>';

    mb.innerHTML = h;

    /* Store match data for auto-calc */
    window._rcMatchData = { f1: f1, f2: f2, f3: f3, pk: pk, preTw: preTw };
    /* Trigger initial calc */
    if (window.rcAutoCalc) window.rcAutoCalc();

  } catch(e) {
    mb.innerHTML = '<div style="padding:20px;color:#f55">Error: '+e.message+'</div>';
  }
};

/* Auto-calc prize in correction modal */
window.rcAutoCalc = function() {
  var r = Number((document.getElementById('rcRank')||{}).value)||0;
  var k = Number((document.getElementById('rcKills')||{}).value)||0;
  var d = window._rcMatchData || {};
  var rp = 0;
  if(r===1) rp = d.f1||0;
  else if(r===2) rp = d.f2||0;
  else if(r===3) rp = d.f3||0;
  var kp = k * (d.pk||0);
  var tw = rp + kp;
  var pv = document.getElementById('rcPrizeVal');
  var pb = document.getElementById('rcPrizeBreakdown');
  if(pv) { pv.textContent = '₹'+tw; pv.style.color = tw > 0 ? '#00ff9c' : '#aaa'; }
  if(pb) {
    var parts = [];
    if(rp > 0) parts.push('Rank #'+r+': ₹'+rp);
    if(kp > 0) parts.push(k+' kills × ₹'+(d.pk||0)+' = ₹'+kp);
    pb.textContent = parts.join(' + ');
  }
};

window.rcToggleManual = function() {
  var chk = document.getElementById('rcManualOverride');
  var wrap = document.getElementById('rcManualWrap');
  if(wrap) wrap.style.display = chk && chk.checked ? '' : 'none';
};

window.submitResultCorrection = async function(matchId, userId, userName) {
  var rank = Number((document.getElementById('rcRank')||{}).value)||0;
  var kills = Number((document.getElementById('rcKills')||{}).value)||0;
  var manualOverride = document.getElementById('rcManualOverride') && document.getElementById('rcManualOverride').checked;
  var manualPrize = Number((document.getElementById('rcPrize')||{}).value)||0;
  var d = window._rcMatchData || {};

  /* Calculate prize */
  var rp = 0;
  if(rank===1) rp = d.f1||0;
  else if(rank===2) rp = d.f2||0;
  else if(rank===3) rp = d.f3||0;
  var kp = kills * (d.pk||0);
  var prize = manualOverride ? manualPrize : (rp + kp);

  if(!rank && !kills) { if(window.showToast) showToast('❌ Rank ya Kills to daalo', true); return; }

  try {
    var rtdb = window.rtdb || window.db;
    /* Find existing result key */
    var resSnap = await rtdb.ref('results').orderByChild('userId').equalTo(userId).once('value');
    var resKey = null, oldPrize = 0;
    if(resSnap.exists()) resSnap.forEach(function(c){
      var cv = c.val();
      if((cv.matchId||cv.tournamentId)===matchId){ resKey=c.key; oldPrize=cv.winnings||cv.totalWinning||0; }
    });

    var updateData = {
      rank: rank, kills: kills,
      rankPrize: rp, killPrize: kp,
      winnings: prize, totalWinning: prize,
      correctedAt: Date.now(), correctedBy: 'admin'
    };

    if(resKey) {
      await rtdb.ref('results/' + resKey).update(updateData);
    } else {
      await rtdb.ref('results').push(Object.assign({ userId: userId, matchId: matchId, userName: userName, timestamp: Date.now() }, updateData));
    }

    /* Update match result node too */
    await rtdb.ref('matches/' + matchId + '/results/' + userId).update(updateData);

    /* Wallet delta */
    var delta = prize - oldPrize;
    if(delta !== 0) {
      await rtdb.ref('users/' + userId + '/realMoney/winnings').transaction(function(v){ return Math.max(0,(v||0)+delta); });
      await rtdb.ref('users/' + userId + '/stats/earnings').transaction(function(v){ return Math.max(0,(v||0)+delta); });
      await rtdb.ref('users/' + userId + '/totalWinnings').transaction(function(v){ return Math.max(0,(v||0)+delta); });
      await rtdb.ref('users/' + userId + '/transactions').push({
        type: delta>0 ? 'correction_credit' : 'correction_debit',
        amount: Math.abs(delta),
        description: 'Result correction — Rank #'+rank+', '+kills+' kills (₹'+rp+' rank + ₹'+kp+' kills)',
        timestamp: Date.now()
      });
    }

    /* JoinRequest update */
    var jrQ = await rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value');
    if(jrQ.exists()) jrQ.forEach(function(c){
      if(c.val().userId === userId) {
        rtdb.ref('joinRequests/' + c.key).update({ rank: rank, kills: kills, killPrize: kp, rankPrize: rp, reward: prize, resultStatus: 'completed' });
      }
    });

    /* Notify player */
    var note = '✅ Result corrected! Match: '+matchId+'. New result: Rank #'+rank+', '+kills+' kills, Prize ₹'+prize;
    if(rp||kp) note += ' (₹'+rp+' rank + ₹'+kp+' kills)';
    await rtdb.ref('users/' + userId + '/notifications').push({
      title: '🔧 Result Correction',
      message: note,
      timestamp: Date.now(), read: false, type: 'correction'
    });

    /* Log */
    await rtdb.ref('adminActions').push({ action: 'result_correction', matchId: matchId, userId: userId, userName: userName, newRank: rank, newKills: kills, newPrize: prize, timestamp: Date.now() });

    if(window.showToast) showToast('✅ Result corrected! Prize: ₹'+prize+(delta>0?' (+₹'+delta+')':delta<0?' (-₹'+Math.abs(delta)+')':''));
    document.getElementById('genericModal').classList.remove('show');
    if(window.loadMatchHistory) loadMatchHistory();
  } catch(e) { if(window.showToast) showToast('❌ Error: ' + e.message, true); }
};
