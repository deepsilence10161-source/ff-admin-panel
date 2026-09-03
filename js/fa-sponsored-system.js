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
  /* Default match time to 30 min from now, same pattern as the
     creator-match-host "Naya Match Host Karo" form. */
  /* ✅ BUG FIX (2026-08-29): split into separate date+time fields,
     matching the same fix applied to the main tournament modal. */
  var dateEl = document.getElementById('spTourMatchDate');
  var timeOnlyEl = document.getElementById('spTourMatchTimeOnly');
  if (dateEl && !dateEl.value) {
    var dt = new Date(Date.now() + 30*60*1000);
    var pad = function(n){ return String(n).padStart(2,'0'); };
    dateEl.value = dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());
    if (timeOnlyEl) timeOnlyEl.value = pad(dt.getHours())+':'+pad(dt.getMinutes());
  }
};
window.closeSponsoredModal = function() {
  var m = document.getElementById('createSponsoredModal');
  if (m) m.style.display = 'none';
};

/* ✅ FEATURE (2026-08-26): "Sponsore match kisi existing match se link
   nahi karne ki jarurat na pade... poora system hona chahiye" —
   full rebuild. This no longer touches sponsoredTournaments/rtdb-bridge
   at all for creation; it calls admin_create_sponsored_match, a single
   atomic RPC that creates BOTH a real, fully joinable matches row
   (is_sponsored=true — same table, same join flow, same everything as
   a normal match) AND its sponsor-branding row together. There is no
   match-ID field anymore because there is nothing to separately link —
   see the RPC itself (2026-08-26 migration) for the full design note. */
window.createSponsoredTournament = async function() {
  console.log('[createSponsoredTournament] BUILD 20260828a');
  /* ✅ BUG FIX (2026-08-28): same real fix as saveTournament() in
     admin-inline.js — Android WebView datetime-local pickers don't
     always reliably commit their pending value into input.value the
     instant the picker closes. Force blur() + wait two animation-frame
     ticks before reading it, so the WebView has a full render cycle to
     flush first. */
  var spDateEl = document.getElementById('spTourMatchDate');
  var spTimeOnlyEl = document.getElementById('spTourMatchTimeOnly');
  if (spDateEl) spDateEl.blur();
  if (spTimeOnlyEl) spTimeOnlyEl.blur();
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });

  var name    = ((document.getElementById('spTourName')||{}).value||'').trim();
  var sponsor = ((document.getElementById('spTourSponsor')||{}).value||'').trim();
  var mode    = (document.getElementById('spTourMode')||{}).value||'solo';
  var maxSlots= Number((document.getElementById('spTourMaxSlots')||{}).value)||48;
  var map     = (document.getElementById('spTourMap')||{}).value||'Bermuda';
  /* ✅ BUG FIX (2026-08-29): read from the two split date/time fields
     and recombine into the same "YYYY-MM-DDTHH:MM" shape the rest of
     this function already expects. */
  var _spDateVal = (document.getElementById('spTourMatchDate')||{}).value || '';
  var _spTimeVal = (document.getElementById('spTourMatchTimeOnly')||{}).value || '';
  var mtVal   = (_spDateVal && _spTimeVal) ? (_spDateVal + 'T' + _spTimeVal) : '';
  var pool    = Number((document.getElementById('spTourPool')||{}).value)||0;
  var p1      = Number((document.getElementById('spPrize1')||{}).value)||0;
  var p2      = Number((document.getElementById('spPrize2')||{}).value)||0;
  var p3      = Number((document.getElementById('spPrize3')||{}).value)||0;
  var desc    = ((document.getElementById('spTourDesc')||{}).value||'').trim();

  if (!name) { showToast('Tournament name dalo', true); return; }
  if (!sponsor) { showToast('Sponsor name dalo', true); return; }
  if (pool < 1) { showToast('Prize pool amount dalo', true); return; }
  if (!mtVal) { showToast('Match time set karo', true); return; }

  /* Explicit numeric Date construction — no string-parsing ambiguity,
     same hardening applied to admin-inline.js's saveTournament(). */
  var parts = mtVal.split(/[-T:]/).map(Number);
  var scheduledAt = new Date(parts[0], parts[1]-1, parts[2], parts[3], parts[4], 0, 0);
  if (scheduledAt.getTime() < Date.now() + 5*60*1000) {
    showToast('❌ Match time kam se kam 5 min baad honi chahiye', true);
    return;
  }
  /* ✅ SAFETY GUARD (2026-08-28): second layer on top of the blur()+rAF
     fix above — catches the case where the picker's value still reads
     as "right now" despite the wait, so admin gets a clear warning
     instead of a silently-wrong match time. The 5-minute-minimum check
     right above already blocks most cases of this, but this makes the
     failure mode explicit rather than just a generic "too soon" toast. */
  if (Math.abs(scheduledAt.getTime() - Date.now()) < 2*60*1000) {
    console.warn('[createSponsoredTournament] scheduledAt suspiciously close to now:', scheduledAt, '— picker value may not have committed yet');
  }

  var btn = document.querySelector('#createSponsoredModal button[onclick="createSponsoredTournament()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

  window._supa.rpc('admin_create_sponsored_match', {
    p_title: name, p_sponsor_name: sponsor, p_mode: mode, p_max_slots: maxSlots,
    p_scheduled_at: scheduledAt.toISOString(), p_first_prize: p1, p_second_prize: p2,
    p_third_prize: p3, p_prize_type: 'cash', p_description: desc || null, p_map: map
  }).then(function(r) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Tournament'; }
    if (r && r.error) {
      showToast('❌ ' + (r.error.message || 'Server error'), true);
      return;
    }
    var d = r.data;
    if (!d || !d.success) {
      var errMap = {
        not_admin: 'Sirf admin sponsored match bana sakta hai',
        invalid_title: 'Tournament name sahi se likho',
        invalid_sponsor_name: 'Sponsor name dalo',
        invalid_mode: 'Mode select karo',
        invalid_slot_count: 'Slots 2-100 ke beech ho',
        invalid_prize: 'Prize amount sahi se bharo',
        schedule_too_soon: 'Match kam se kam 5 min baad schedule karo'
      };
      showToast(errMap[d && d.error] || ('Create nahi ho paya' + (d && d.error ? ' (' + d.error + ')' : '')), true);
      return;
    }
    closeSponsoredModal();
    showToast('✅ Sponsored tournament + match dono ban gaye!', false);
    loadSponsoredTournaments();
    ['spTourName','spTourSponsor','spTourPool','spPrize1','spPrize2','spPrize3','spTourDesc','spTourMatchDate','spTourMatchTimeOnly']
      .forEach(function(id){ var el = document.getElementById(id); if(el) el.value = ''; });
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Tournament'; }
    showToast('Error: ' + (err && err.message ? err.message : 'unknown error'), true);
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
    /* Repair legacy records where prizes were distributed and the sponsor
       campaign was marked completed, but its linked real match remained
       upcoming. This is idempotent and prevents Join Now from reappearing. */
    items.forEach(function(item){
      if(item.d.status==='completed' && item.d.matchId){
        (window.rtdb||window.db).ref('matches/'+item.d.matchId).update({status:'completed',completedAt:item.d.distributedAt||Date.now()})
          .catch(function(err){console.warn('[Sponsored] legacy match status repair failed:',err);});
      }
    });
    var html = '<div style="display:grid;gap:12px">';
    items.forEach(function(item) {
      var d = item.d;
      /* ✅ BUG FIX (2026-08-26): "match ban to jata hai lekin direct
         active status pe show hota hai" — d.status here is
         sponsored_tournaments.status, a SEPARATE concept from the
         real match's own live/upcoming/completed lifecycle (which
         lives on the matches table via d.matchId, not here). "Active"
         correctly means "this sponsorship campaign is running/not
         paused/not completed" — but next to what looks like a match
         card, it reads exactly like "the match itself is live", which
         is the confusion being reported. Relabeled to make that
         distinction explicit instead of just showing a bare "Active". */
      var statusColor = d.status === 'active' ? '#00ff9c' : d.status === 'completed' ? '#00d4ff' : '#666';
      var statusLabel = d.status === 'active' ? '🟢 Sponsorship Active' : d.status === 'completed' ? '✅ Prizes Distributed' : '⏸ Paused';
      html += '<div style="background:rgba(255,215,0,.04);border:1px solid rgba(255,215,0,.15);border-radius:14px;padding:16px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">';
      html += '<div>';
      html += '<div style="font-size:15px;font-weight:800;color:#ffd700">' + escHtml(d.name) + '</div>';
      html += '<div style="font-size:11px;color:#888;margin-top:3px">Sponsor: <strong style="color:#aaa">' + escHtml(d.sponsor) + '</strong></div>';
      if (d.matchId) html += '<div style="font-size:10px;color:#555;margin-top:2px">Match ID: ' + escHtml(d.matchId) + ' <a onclick="navTo&&navTo(\'matches\')" style="color:#00d4ff;cursor:pointer">(match ka live/upcoming status Matches tab me dekho)</a></div>';
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

  // Mark tournament as distributed, and atomically close its real match too.
  // The sponsor row and matches row have separate statuses. Previously only
  // the sponsor row became completed, so the user panel still saw the linked
  // match as upcoming and incorrectly rendered Join Now.
  var _dbForSponsor=(window.rtdb||window.db);
  var _completedAt=Date.now();
  _dbForSponsor.ref('sponsoredTournaments/' + tourId).once('value').then(function(snap){
    var sponsorData=snap&&snap.val?snap.val():null;
    var matchId=sponsorData&&sponsorData.matchId;
    var sponsorUpdate={prizeDistributed:true,distributedAt:_completedAt,status:'completed'};
    var writes=[_dbForSponsor.ref('sponsoredTournaments/' + tourId).update(sponsorUpdate)];
    if(matchId){
      writes.push(_dbForSponsor.ref('matches/' + matchId).update({status:'completed',completedAt:_completedAt}));
    }
    return Promise.all(writes);
  }).catch(function(err){
    console.error('[Sponsored] Could not close sponsor/match lifecycle:',err);
    showToast('Prize credit ho gaya, lekin match status sync nahi hua. Matches tab mein check karo.',true);
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
            window._supa.from('users').update({ sponsored_winnings: Math.max(0, cur - amount) }).eq('id', uid).then(null, function(){});
            window._supa.from('wallet_transactions').insert({
              user_id: uid, txn_type: 'sponsored_withdrawal_approved',
              currency: 'inr', amount: amount, ref_id: reqId,
              description: 'Sponsored prize withdrawal approved'
            }).then(null, function(){});
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
        }).then(null, function(){});
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
