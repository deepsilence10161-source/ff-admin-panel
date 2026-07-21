/* ============================================================
   SPONSORED TOURNAMENT SYSTEM — fa-sponsored-system.js
   Mini eSports Admin Panel v10
   
   ☪️ HALAL: No entry fee. Sponsor funds prize pool.
   Only winners get real money withdrawal.
   ============================================================ */

window.loadSponsoredSection = function() {
  loadSponsoredTournaments();
  loadSponsoredWithdrawals();
};

/* ── CREATE MODAL ── */
window.openCreateSponsoredModal = function() {
  var m = document.getElementById('createSponsoredModal');
  if (m) m.style.display = 'flex';
};
window.closeSponsoredModal = function() {
  var m = document.getElementById('createSponsoredModal');
  if (m) m.style.display = 'none';
};

window.createSponsoredTournament = function() {
  var name    = (document.getElementById('spTourName')||{}).value||'';
  var matchId = (document.getElementById('spTourMatchId')||{}).value||'';
  var sponsor = (document.getElementById('spTourSponsor')||{}).value||'';
  var pool    = Number((document.getElementById('spTourPool')||{}).value)||0;
  var p1      = Number((document.getElementById('spPrize1')||{}).value)||0;
  var p2      = Number((document.getElementById('spPrize2')||{}).value)||0;
  var p3      = Number((document.getElementById('spPrize3')||{}).value)||0;
  var p4to10  = Number((document.getElementById('spPrize4to10')||{}).value)||0;
  var desc    = (document.getElementById('spTourDesc')||{}).value||'';

  if (!name.trim()) { showToast('Tournament name dalo', true); return; }
  if (!sponsor.trim()) { showToast('Sponsor name dalo', true); return; }
  if (pool < 1) { showToast('Prize pool amount dalo', true); return; }

  var data = {
    name: name.trim(),
    sponsor: sponsor.trim(),
    description: desc.trim(),
    prizePool: pool,
    prizes: { first: p1, second: p2, third: p3, fourthToTenth: p4to10 },
    matchId: matchId.trim(),
    status: 'active',
    prizeDistributed: false,
    createdAt: Date.now()
  };

  (window.rtdb||window.db).ref('sponsoredTournaments').push(data, function(err) {
    if (err) { showToast('Error: ' + err.message, true); return; }
    closeSponsoredModal();
    showToast('✅ Sponsored tournament create ho gaya!', false);
    loadSponsoredTournaments();
    // Clear form
    ['spTourName','spTourMatchId','spTourSponsor','spTourPool','spPrize1','spPrize2','spPrize3','spPrize4to10','spTourDesc']
      .forEach(function(id){ var el = document.getElementById(id); if(el) el.value = ''; });
  });
};

/* ── LOAD TOURNAMENTS — Bug#71 Fix: paginated load with cursor ── */
var _sponsorPageSize = 20;
var _sponsorLastKey  = null;   /* cursor for next page */
var _sponsorAllItems = {};     /* id → data, accumulated across pages */

function loadSponsoredTournaments(loadMore) {
  var container = document.getElementById('sponsoredTournamentList');
  if (!container) return;
  if (!loadMore) {
    _sponsorLastKey  = null;
    _sponsorAllItems = {};
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#555">Loading...</div>';
  }

  /* Bug#71 Fix: use orderByChild+limitToLast for indexed, size-bounded reads.
     Firebase requires .indexOn: ["createdAt"] on sponsoredTournaments in rules. */
  var query = (window.rtdb||window.db).ref('sponsoredTournaments')
    .orderByChild('createdAt')
    .limitToLast(_sponsorPageSize);
  if (_sponsorLastKey) query = query.endBefore(null, _sponsorLastKey);

  query.once('value', function(snap) {
    if (!snap.exists() && !loadMore) {
      container.innerHTML = '<div class="empty-state" style="padding:30px 0"><i class="fas fa-trophy" style="font-size:32px;color:#333;margin-bottom:12px;display:block"></i><span>Koi sponsored tournament nahi. Upar "New Sponsored Tournament" se banao.</span></div>';
      return;
    }

    /* Accumulate items across pages */
    snap.forEach(function(c) { _sponsorAllItems[c.key] = { id: c.key, d: c.val() }; });
    var keys = Object.keys(_sponsorAllItems);
    if (keys.length === 0 && !loadMore) {
      container.innerHTML = '<div class="empty-state" style="padding:30px 0"><i class="fas fa-trophy" style="font-size:32px;color:#333;margin-bottom:12px;display:block"></i><span>Koi sponsored tournament nahi. Upar "New Sponsored Tournament" se banao.</span></div>';
      return;
    }
    /* Track cursor for next page (oldest key in this batch) */
    var batchKeys = []; snap.forEach(function(c) { batchKeys.push(c.key); });
    if (batchKeys.length > 0) _sponsorLastKey = batchKeys[0];
    var hasMore = snap.numChildren() === _sponsorPageSize;

    var items = Object.values(_sponsorAllItems).sort(function(a,b){ return (b.d.createdAt||0) - (a.d.createdAt||0); });
    var html = '<div style="display:grid;gap:12px">';
    items.forEach(function(item) {
      var d = item.d;
      var statusColor = d.status === 'active' ? '#00ff9c' : d.status === 'completed' ? '#00d4ff' : '#666';
      var statusLabel = d.status === 'active' ? '🟢 Active' : d.status === 'completed' ? '✅ Completed' : '⏸ Paused';
      html += '<div style="background:rgba(255,215,0,.04);border:1px solid rgba(255,215,0,.15);border-radius:14px;padding:16px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">';
      html += '<div>';
      html += '<div style="font-size:15px;font-weight:800;color:#ffd700">' + escHtml(d.name) + '</div>';
      html += '<div style="font-size:11px;color:#888;margin-top:3px">Sponsor: <strong style="color:#aaa">' + escHtml(d.sponsor) + '</strong></div>';
      if (d.matchId) html += '<div style="font-size:10px;color:#555;margin-top:2px">Match ID: ' + escHtml(d.matchId) + '</div>';
      html += '</div>';
      html += '<span style="font-size:11px;color:' + statusColor + ';font-weight:700">' + statusLabel + '</span>';
      html += '</div>';
      // Prize pool
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">';
      html += '<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);border-radius:10px;padding:8px 12px;text-align:center;min-width:70px"><div style="font-size:10px;color:#888">Pool</div><div style="font-size:15px;font-weight:900;color:#00ff9c">₹' + (d.prizePool||0) + '</div></div>';
      if (d.prizes) {
        if (d.prizes.first) html += '<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.2);border-radius:10px;padding:8px 12px;text-align:center;min-width:60px"><div style="font-size:10px;color:#888">🥇 1st</div><div style="font-size:14px;font-weight:800;color:#ffd700">₹' + d.prizes.first + '</div></div>';
        if (d.prizes.second) html += '<div style="background:rgba(180,180,180,.06);border:1px solid rgba(180,180,180,.2);border-radius:10px;padding:8px 12px;text-align:center;min-width:60px"><div style="font-size:10px;color:#888">🥈 2nd</div><div style="font-size:14px;font-weight:800;color:#ccc">₹' + d.prizes.second + '</div></div>';
        if (d.prizes.third) html += '<div style="background:rgba(205,127,50,.06);border:1px solid rgba(205,127,50,.2);border-radius:10px;padding:8px 12px;text-align:center;min-width:60px"><div style="font-size:10px;color:#888">🥉 3rd</div><div style="font-size:14px;font-weight:800;color:#cd7f32">₹' + d.prizes.third + '</div></div>';
      }
      html += '</div>';
      // Action buttons
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      if (d.status === 'active' && !d.prizeDistributed) {
        html += '<button onclick="openDistributePrizesModal(\'' + item.id + '\')" style="padding:8px 14px;border-radius:10px;background:linear-gradient(135deg,#00ff9c,#00cc7a);border:none;color:#000;font-size:12px;font-weight:800;cursor:pointer"><i class="fas fa-trophy"></i> Distribute Prizes</button>';
      }
      if (d.prizeDistributed) {
        html += '<span style="padding:8px 14px;border-radius:10px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.3);color:#00d4ff;font-size:12px;font-weight:700">✅ Prizes Distributed</span>';
      }
      html += '<button onclick="deleteSponsoredTournament(\'' + item.id + '\')" style="padding:8px 12px;border-radius:10px;background:rgba(255,60,60,.08);border:1px solid rgba(255,60,60,.2);color:#ff6b6b;font-size:12px;cursor:pointer"><i class="fas fa-trash"></i></button>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
    /* Bug#71 Fix: append "Load More" button if there are more pages */
    if (hasMore) {
      html += '</div><div style="text-align:center;margin-top:14px">' +
        '<button onclick="loadSponsoredTournaments(true)" style="background:rgba(255,215,0,.1);border:1px solid rgba(255,215,0,.3);color:#ffd700;padding:8px 24px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700">' +
        '<i class="fas fa-chevron-down"></i> Load More</button></div>';
    } else {
      html += '</div>';
    }
    container.innerHTML = html;
  });
}

/* ── PRIZE DISTRIBUTION MODAL ── */
window.openDistributePrizesModal = function(tourId) {
  (window.rtdb||window.db).ref('sponsoredTournaments/' + tourId).once('value', function(snap) {
    if (!snap.exists()) return;
    var d = snap.val();

    var h = '<div style="margin-bottom:16px">';
    h += '<div style="font-size:15px;font-weight:800;color:#ffd700;margin-bottom:4px">' + escHtml(d.name) + '</div>';
    h += '<div style="font-size:12px;color:#888">Prize Pool: <strong style="color:#00ff9c">₹' + (d.prizePool||0) + '</strong></div>';
    h += '</div>';

    h += '<div style="background:rgba(0,255,156,.05);border:1px solid rgba(0,255,156,.15);border-radius:12px;padding:12px;margin-bottom:16px;font-size:12px;color:#888;line-height:1.7">';
    h += '☪️ <strong style="color:#00ff9c">Halal:</strong> Ye prize pool sponsor ka paisa hai.<br>';
    h += 'Winners ke Firebase account mein <code>sponsoredWinnings</code> credit hogi.<br>';
    h += 'Winners apne UPI pe withdraw request daal sakte hain.';
    h += '</div>';

    h += '<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px">Winner User IDs enter karo:</div>';

    var prizes = d.prizes || {};
    var fields = [
      { label: '🥇 1st Place', key: 'w1', prize: prizes.first || 0, color: '#ffd700' },
      { label: '🥈 2nd Place', key: 'w2', prize: prizes.second || 0, color: '#ccc' },
      { label: '🥉 3rd Place', key: 'w3', prize: prizes.third || 0, color: '#cd7f32' },
    ];
    // 4th-10th
    for (var i = 4; i <= 10; i++) {
      if (prizes.fourthToTenth > 0) {
        fields.push({ label: '#' + i + ' Place', key: 'w' + i, prize: prizes.fourthToTenth, color: '#666' });
      }
    }

    fields.forEach(function(f) {
      h += '<div class="form-group" style="margin-bottom:10px">';
      h += '<label style="color:' + f.color + '">' + f.label + ' — <strong>₹' + f.prize + '</strong></label>';
      h += '<input type="text" id="dist_' + f.key + '" class="form-input" placeholder="Firebase UID ya IGN" style="font-size:12px">';
      h += '</div>';
    });

    h += '<button onclick="confirmDistributePrizes(\'' + tourId + '\')" style="width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,#ffd700,#ff8c00);border:none;color:#000;font-size:14px;font-weight:800;cursor:pointer;margin-top:8px"><i class="fas fa-trophy"></i> Prizes Distribute Karo</button>';

    if (window.openModal) {
      openModal('🏆 Distribute Prizes', h);
    } else {
      // Fallback: use a simple admin modal if available
      var m = document.createElement('div');
      m.id = 'distModal';
      m.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center';
      m.innerHTML = '<div style="background:#1a1a2e;border:1px solid rgba(255,215,0,.25);border-radius:20px;padding:24px;max-width:480px;width:90%;max-height:90vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-size:16px;font-weight:800;color:#ffd700">🏆 Distribute Prizes</span><button onclick="document.getElementById(\'distModal\').remove()" style="background:rgba(255,255,255,.08);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer">✕</button></div>' +
        h + '</div>';
      document.body.appendChild(m);
    }

    window._distTourId = tourId;
    window._distFields = fields;
  });
};

window.confirmDistributePrizes = function(tourId) {
  var fields = window._distFields || [];
  var updates = [];

  fields.forEach(function(f) {
    var uid = ((document.getElementById('dist_' + f.key)||{}).value||'').trim();
    if (uid && f.prize > 0) {
      updates.push({ uid: uid, prize: f.prize, rank: f.label });
    }
  });

  if (!updates.length) { showToast('Koi winner UID nahi diya', true); return; }

  var done = 0;
  updates.forEach(function(u) {
    // Credit sponsoredWinnings field
    (window.rtdb||window.db).ref('users/' + u.uid + '/sponsoredWinnings').transaction(function(v) {
      return (v||0) + u.prize;
    });
    // Add to winnings history
    (window.rtdb||window.db).ref('users/' + u.uid + '/sponsoredWinningsHistory').push({
      amount: u.prize,
      tournamentId: tourId,
      rank: u.rank,
      type: 'sponsored_prize',
      timestamp: Date.now()
    });
    // Send notification to user
    (window.rtdb||window.db).ref('users/' + u.uid + '/notifications').push({
      type: 'sponsored_prize',
      title: '🏆 Sponsored Prize Mili!',
      message: u.rank + ' — ₹' + u.prize + ' aapke wallet mein add ho gayi! Wallet > Withdraw se UPI pe bhej sakte hain.',
      read: false,
      timestamp: Date.now()
    });
    done++;
  });

  // Mark tournament as distributed
  (window.rtdb||window.db).ref('sponsoredTournaments/' + tourId).update({
    prizeDistributed: true,
    distributedAt: Date.now(),
    status: 'completed'
  });

  // Close modal
  if (window.closeModal) closeModal();
  var dm = document.getElementById('distModal');
  if (dm) dm.remove();

  showToast('✅ ' + done + ' winners ko prizes credit ho gaye!', false);
  loadSponsoredTournaments();
};

window.deleteSponsoredTournament = function(id) {
  if (!confirm('Is sponsored tournament ko delete karo?')) return;
  (window.rtdb||window.db).ref('sponsoredTournaments/' + id).remove(function() {
    showToast('Tournament deleted', false);
    loadSponsoredTournaments();
  });
};

/* ── LOAD SPONSORED WITHDRAWALS ── */
function loadSponsoredWithdrawals() {
  var tbody = document.getElementById('sponsoredWdTable');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#555;padding:16px">Loading...</td></tr>';

  (window.rtdb||window.db).ref('walletRequests').orderByChild('type').equalTo('sponsored_withdraw').once('value', function(snap) {
    if (!snap.exists()) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#555;padding:20px">Abhi koi withdrawal request nahi</td></tr>';
      // Update badge
      updateBadge('sponsoredBadge', 0);
      return;
    }

    var rows = [];
    var pendingCount = 0;
    snap.forEach(function(c) {
      var d = c.val();
      if (d.status === 'pending') pendingCount++;
      rows.unshift({ id: c.key, d: d });
    });

    updateBadge('sponsoredBadge', pendingCount);
    document.getElementById('sponsoredCount').textContent = rows.length;

    var html = '';
    rows.forEach(function(row) {
      var d = row.d;
      var statusHtml = '';
      var dateStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN') : '—';
      if (d.status === 'pending') {
        statusHtml = '<span style="color:#ffd700;font-weight:700">⏳ Pending</span>';
      } else if (d.status === 'approved') {
        statusHtml = '<span style="color:#00ff9c;font-weight:700">✅ Approved</span>';
      } else {
        statusHtml = '<span style="color:#ff6b6b;font-weight:700">❌ Rejected</span>';
      }
      var actionsBtns = '';
      if (d.status === 'pending') {
        actionsBtns = '<button onclick="approveSponsoredWd(\'' + row.id + '\',\'' + escAttr(d.uid) + '\',' + (d.amount||0) + ')" style="padding:5px 10px;border-radius:8px;background:linear-gradient(135deg,#00ff9c,#00cc7a);border:none;color:#000;font-size:11px;font-weight:800;cursor:pointer;margin-right:4px">✅ Approve</button>' +
          '<button onclick="rejectSponsoredWd(\'' + row.id + '\',\'' + escAttr(d.uid) + '\',' + (d.amount||0) + ')" style="padding:5px 10px;border-radius:8px;background:rgba(255,60,60,.12);border:1px solid rgba(255,60,60,.3);color:#ff6b6b;font-size:11px;font-weight:700;cursor:pointer">❌ Reject</button>';
      }
      html += '<tr>';
      html += '<td>' + escHtml(d.userName||d.uid||'—') + '</td>';
      html += '<td style="color:#00ff9c;font-weight:800">₹' + (d.amount||0) + '</td>';
      html += '<td><code style="font-size:11px">' + escHtml(d.upiId||'—') + '</code></td>';
      html += '<td style="font-size:11px;color:#888">Sponsored Prize</td>';
      html += '<td style="font-size:11px;color:#666">' + dateStr + '</td>';
      html += '<td>' + statusHtml + (actionsBtns ? '<br><div style="margin-top:5px">' + actionsBtns + '</div>' : '') + '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;
  });
}

window.approveSponsoredWd = function(reqId, uid, amount) {
  if (!confirm('₹' + amount + ' ki withdrawal approve karo?')) return;
  var rtdb = window.rtdb || window.db;
  if (!rtdb) return;

  /* Bug Critical #4 Fix: Deduct sponsoredWinnings BEFORE marking approved.
     Previous code only updated status — users could resubmit the same amount
     repeatedly since the balance was never reduced, draining sponsor funds. */
  if (uid && amount > 0) {
    // Deduct from Firebase sponsoredWinnings
    rtdb.ref('users/' + uid + '/sponsoredWinnings').transaction(function(v) {
      var cur = Number(v) || 0;
      if (cur < amount) return cur; // insufficient — abort transaction
      return cur - amount;
    }, function(err, committed) {
      if (err || !committed) {
        if (window.showToast) showToast('❌ Insufficient sponsored balance — transaction aborted', true);
        return;
      }
      // Deduction succeeded — now mark approved
      rtdb.ref('walletRequests/' + reqId).update({ status: 'approved', approvedAt: Date.now(), deductedAmount: amount });

      // Also deduct from Supabase if available
      if (window._supa) {
        window._supa.from('users').select('sponsored_winnings').eq('id', uid).single()
          .then(function(r) {
            var cur = Number((r.data || {}).sponsored_winnings) || 0;
            window._supa.from('users').update({ sponsored_winnings: Math.max(0, cur - amount) }).eq('id', uid).catch(function(){});
            window._supa.from('wallet_transactions').insert({
              user_id: uid, txn_type: 'sponsored_withdrawal_approved',
              currency: 'inr', amount: amount, ref_id: reqId,
              description: 'Sponsored prize withdrawal approved'
            }).catch(function(){});
          }).catch(function(){});
      }

      // Notify user via dual-write
      var notif = { type: 'withdrawal_approved', title: '✅ Withdrawal Approved!',
        message: '₹' + amount + ' ki withdrawal request approve ho gayi. Payment aapke UPI pe bheja ja raha hai.',
        read: false, timestamp: Date.now() };
      rtdb.ref('users/' + uid + '/notifications').push(notif);
      if (window._supa) {
        window._supa.from('notifications').insert({
          user_id: uid, type: notif.type, title: notif.title, body: notif.message, is_read: false
        }).catch(function(){});
      }

      if (window.showToast) showToast('✅ Withdrawal approved & balance deducted!', false);
      loadSponsoredWithdrawals();
    });
  } else {
    // Zero amount or no uid — just update status
    rtdb.ref('walletRequests/' + reqId).update({ status: 'approved', approvedAt: Date.now() });
    if (window.showToast) showToast('✅ Withdrawal approved!', false);
    loadSponsoredWithdrawals();
  }
};

window.rejectSponsoredWd = function(reqId, uid, amount) {
  if (!confirm('Reject karo? Amount wapas user ke balance mein add ho jayega.')) return;
  (window.rtdb||window.db).ref('walletRequests/' + reqId).update({ status: 'rejected', rejectedAt: Date.now() });
  // Refund
  if (uid) {
    (window.rtdb||window.db).ref('users/' + uid + '/sponsoredWinnings').transaction(function(v) { return (v||0) + amount; });
    (window.rtdb||window.db).ref('users/' + uid + '/notifications').push({
      type: 'withdrawal_rejected',
      title: '❌ Withdrawal Rejected',
      message: '₹' + amount + ' ki request reject ho gayi. Amount wapas aapke balance mein aa gaya.',
      read: false, timestamp: Date.now()
    });
  }
  showToast('Withdrawal rejected. Refund done.', false);
  loadSponsoredWithdrawals();
};

/* ── Helpers ── */
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s||'').replace(/'/g,"\\'").replace(/"/g,"&quot;");
}

console.log('✅ fa-sponsored-system.js loaded');
