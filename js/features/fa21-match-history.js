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

/* ─── RESULT CORRECTION (dedup) ───
   window.openResultCorrection / submitResultCorrection ab sirf admin-inline-e.js
   me hain (R24-fixed: totalWinnings double-credit hataya). fa21 ke stale copies hata
   diye — rcAutoCalc / rcToggleManual yahin bane hain kyunki admin-inline-e ke
   correction modal ke inline handlers inhin ko bulate hain. ─── */

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
