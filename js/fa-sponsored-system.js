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

/* ══════════════════════════════════════════════════════════════
   MATCH TIME — REVERTED (2026-09-05), per Junaid's explicit request:
   the custom bottom-sheet picker was disliked and had a Save-button
   hang bug. Back to a simple native <input type="datetime-local">
   (id="spTourMatchTime" in index.html), matching AdminPanel-FIXED-v20
   and the same revert applied to admin-inline.js. */
var _spCapturedMatchTime = '';

function _onSpMatchTimeChange(){
  var el = document.getElementById('spTourMatchTime');
  _spCapturedMatchTime = el ? el.value : '';
  var preview = document.getElementById('spTourMatchTimePreview');
  if (preview && _spCapturedMatchTime) {
    var parts = _spCapturedMatchTime.split(/[-T:]/).map(Number);
    var dt = new Date(parts[0], parts[1]-1, parts[2], parts[3], parts[4], 0, 0);
    var diffMins = Math.round((dt.getTime() - Date.now()) / 60000);
    preview.style.color = diffMins < 2 ? '#ff4444' : '#00ff9c';
    preview.innerHTML = '📅 Save hoga: <b>' + dt.toLocaleString('en-IN', {weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) + '</b>' + (diffMins < 2 ? ' ⚠️ ABHI KE KAREEB!' : '');
  } else if (preview) { preview.textContent = ''; }
}

/* ── CREATE MODAL ── */
/* ✅ B11 FIX (2026-10-07): pool ab PRIZES ka jod hai (1st+2nd+3rd +
   7×4th-10th), aur unit (₹/🪙) prize type ke saath badalta hai.
   Pehle "Total Prize Pool" ek alag number tha jise server poora IGNORE
   karta tha (pool = 1st+2nd+3rd hota tha) — user card par ek pool
   dikhta tha aur asli obligation kuch aur hoti thi. Ab dono ek hi
   cheez hain, isliye galat number ka sawaal hi nahi. */
window.spRecalcPool = function() {
  var g = function(id) { var el = document.getElementById(id); return el ? (Number(el.value) || 0) : 0; };
  var isCoin = ((document.getElementById('spTourPrizeType') || {}).value === 'coin');
  var unit = isCoin ? '🪙' : '₹';
  var p4 = g('spPrize4to10');
  var total = g('spPrize1') + g('spPrize2') + g('spPrize3') + (7 * p4);
  var poolEl = document.getElementById('spTourPool');
  if (poolEl) poolEl.value = total > 0 ? total : '';
  var uEl = document.getElementById('spPoolUnit');
  if (uEl) uEl.textContent = '(' + unit + ')';
  Array.prototype.forEach.call(document.querySelectorAll('#createSponsoredModal .sp-unit'), function(s) {
    s.textContent = '(' + (isCoin ? '🪙' : '₹') + (s.textContent.indexOf('each') !== -1 ? ' each' : '') + ')';
  });
  var hint = document.getElementById('spPoolHint');
  if (hint) {
    hint.textContent = total > 0
      ? ('Pool = ' + unit + g('spPrize1') + ' + ' + unit + g('spPrize2') + ' + ' + unit + g('spPrize3') + ' + 7×' + unit + p4 + ' = ' + unit + total)
      : 'Neeche prize amounts bharo — pool khud jud jayega.';
  }
  return total;
};

window.openCreateSponsoredModal = function() {
  var m = document.getElementById('createSponsoredModal');
  if (m) m.style.display = 'flex';
  window.spRecalcPool();
  /* Default match time to 30 min from now, same pattern as the
     creator-match-host "Naya Match Host Karo" form. */
  var el = document.getElementById('spTourMatchTime');
  if (el && !el.value) {
    var dt = new Date(Date.now() + 30*60*1000);
    var pad = function(n){ return String(n).padStart(2,'0'); };
    el.value = dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate())+'T'+pad(dt.getHours())+':'+pad(dt.getMinutes());
    _onSpMatchTimeChange();
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
  console.log('[createSponsoredTournament] BUILD 20260913a — trust captured value, no re-read at save time');
  /* ✅ ROOT CAUSE FOUND (2026-09-13) — see admin-inline.js's
     saveTournament() for the full story. Trust _spCapturedMatchTime
     directly; only fall back to a fresh DOM read if it's empty. */
  if (!_spCapturedMatchTime) {
    var _spTimeEl = document.getElementById('spTourMatchTime');
    if (_spTimeEl) {
      _spTimeEl.blur();
      await new Promise(function(r){ requestAnimationFrame(r); });
      var _spRead1 = _spTimeEl.value;
      await new Promise(function(r){ setTimeout(r, 120); });
      var _spRead2 = _spTimeEl.value;
      _spCapturedMatchTime = _spRead2 || _spRead1;
    }
  }

  var name    = ((document.getElementById('spTourName')||{}).value||'').trim();
  var sponsor = ((document.getElementById('spTourSponsor')||{}).value||'').trim();
  var mode    = (document.getElementById('spTourMode')||{}).value||'solo';
  var maxSlots= Number((document.getElementById('spTourMaxSlots')||{}).value)||48;
  var map     = (document.getElementById('spTourMap')||{}).value||'Bermuda';
  var mtVal   = _spCapturedMatchTime;
  /* ✅ B11 FIX: pool ab local jod hai (server bhi yahi jod karta hai) —
     form ka readonly pool field sirf dikhane ke liye hai. */
  var p1      = Number((document.getElementById('spPrize1')||{}).value)||0;
  var p2      = Number((document.getElementById('spPrize2')||{}).value)||0;
  var p3      = Number((document.getElementById('spPrize3')||{}).value)||0;
  var p4to10  = Number((document.getElementById('spPrize4to10')||{}).value)||0;
  var pool    = window.spRecalcPool() || (p1 + p2 + p3 + (7 * p4to10));
  /* ✅ B11: admin ka chuna hua prize type hi bhejna hai ('cash' default) */
  var prizeType = (document.getElementById('spTourPrizeType')||{}).value === 'coin' ? 'coin' : 'cash';
  var desc    = ((document.getElementById('spTourDesc')||{}).value||'').trim();

  if (!name) { showToast('Tournament name dalo', true); return; }
  if (!sponsor) { showToast('Sponsor name dalo', true); return; }
  if (pool < 1) { showToast('Kam se kam ek prize amount dalo (1st/2nd/3rd ya 4th-10th)', true); return; }
  if (!mtVal) { showToast('Match time set karo', true); return; }

  /* Explicit numeric Date construction — no string-parsing ambiguity,
     same hardening applied to admin-inline.js's saveTournament(). */
  var parts = mtVal.split(/[-T:]/).map(Number);
  var scheduledAt = new Date(parts[0], parts[1]-1, parts[2], parts[3], parts[4], 0, 0);
  if (scheduledAt.getTime() < Date.now() + 5*60*1000) {
    showToast('❌ Match time kam se kam 5 min baad honi chahiye', true);
    return;
  }
  /* Genuine last-resort sanity check (the 5-min-minimum check above
     already blocks true "now" values in the normal case, so this
     mainly protects against a manually cleared/edited field). Stops
     the save and asks — a silent console.warn here was the actual
     reason a wrong time used to go through without the admin ever
     seeing it. */
  if (Math.abs(scheduledAt.getTime() - Date.now()) < 2*60*1000) {
    /* ✅ B3 ka usool: koi native browser popup nahi — app ka apna dialog. */
    var okNear = window.appConfirm
      ? await window.appConfirm('⚠️ Match time abhi (' + scheduledAt.toLocaleString('en-IN') + ') ke bahut kareeb hai — save hote hi match LIVE ho jayega. Sahi hai?', { icon: '⚠️', danger: true, okText: 'Haan, banao' })
      : true;
    if (!okNear) return;
  }

  var btn = document.querySelector('#createSponsoredModal button[onclick="createSponsoredTournament()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

  window._supa.rpc('admin_create_sponsored_match', {
    p_title: name, p_sponsor_name: sponsor, p_mode: mode, p_max_slots: maxSlots,
    p_scheduled_at: scheduledAt.toISOString(), p_first_prize: p1, p_second_prize: p2,
    p_third_prize: p3, p_fourth_prize: p4to10, p_prize_type: prizeType,
    p_description: desc || null, p_map: map
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
        invalid_prize_type: 'Prize type galat hai — Real Money ya Coins chuno',
        schedule_too_soon: 'Match kam se kam 5 min baad schedule karo'
      };
      showToast(errMap[d && d.error] || ('Create nahi ho paya' + (d && d.error ? ' (' + d.error + ')' : '')), true);
      return;
    }
    closeSponsoredModal();
    showToast('✅ Sponsored match ban gaya (' + (prizeType === 'coin' ? '🪙 Coins' : '₹ Real Money') + ' prize)!', false);
    /* ✅ B9: naye match ka asli status turant laane ke liye cached status saaf */
    _spMatchInfo = {};
    loadSponsoredTournaments();
    ['spTourName','spTourSponsor','spTourPool','spPrize1','spPrize2','spPrize3','spPrize4to10','spTourDesc','spTourMatchTime']
      .forEach(function(id){ var el = document.getElementById(id); if(el) el.value = ''; });
    var ptEl = document.getElementById('spTourPrizeType'); if (ptEl) ptEl.value = 'cash';
    window.spRecalcPool();
    _spCapturedMatchTime = '';
    var _spPreview = document.getElementById('spTourMatchTimePreview'); if (_spPreview) _spPreview.textContent = '';
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Tournament'; }
    showToast('Error: ' + (err && err.message ? err.message : 'unknown error'), true);
  });
};

/* ── LOAD TOURNAMENTS — Bug#71 Fix: paginated load with cursor ── */
var _sponsorPageSize = 20;
var _sponsorLastKey  = null;   /* cursor for next page */
var _sponsorAllItems = {};     /* id → data, accumulated across pages */

/* ══════════════════════════════════════════════════════════════
   ✅ B9 FIX (2026-10-07): "Sponsored tab me match CARD ki jagah
   data-table jaisa dikhe."
   ──────────────────────────────────────────────────────────────
   PEHLE: har sponsored tournament ek bada match-jaisa card hota tha
   (gradient, prize boxes, join button…) — admin panel ke baaki sab
   sections asli data-tables hain, isliye ye section alag-thalag
   lagta tha aur ek nazar me compare karna mushkil tha (kaunsa match
   kab hai, kitna baaki hai, kiska prize baantna hai).
   AB: ek asli table — ek row = ek sponsored tournament. Mobile par
   bhi theek rehta hai kyunki poora table `.table-wrapper` ke andar
   hai (wahi wrapper jo admin ke baaki tables use karte hain) — wo
   horizontally scroll ho jaata hai, layout tootta nahi.

   ✅ B11/B14 (is row ke saath juda): "Prize Type" column ab asli
   `prize_type` dikhata hai (₹ Real Money / 🪙 Coins), aur
   "Distribute Prizes" button ab match ke ASLI status par bandh
   chalta hai — wahi `_admPrizeDistributeGate` niyam jo Publish
   Results par laga hai (upcoming/cancelled = रोक, live/completed =
   chalne do). Pehle sponsored par ye gate lagaa hi nahi tha.
   ══════════════════════════════════════════════════════════════ */
var _spMatchInfo = {};                          /* matchId → {status, scheduled_at, filled_slots, max_slots} */
var _spUuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Asli match ka status ek hi query me (jitni rows dikh rahi hain unke ids se) */
function _spLoadMatchInfo(ids, cb) {
  var need = (ids || []).filter(function(id) { return _spUuidRe.test(id) && !_spMatchInfo[id]; });
  if (!need.length || !window._supa) { cb(); return; }
  window._supa.from('matches').select('id,status,scheduled_at,filled_slots,max_slots')
    .in('id', need)
    .then(function(r) {
      (r.data || []).forEach(function(m) { _spMatchInfo[m.id] = m; });
      cb();
    })
    .catch(function(e) { console.warn('[Sponsored] match info fail:', e && e.message); cb(); });
}

function _spMatchTimeMs(spId, rm) {
  if (rm && rm.scheduled_at) return new Date(rm.scheduled_at).getTime();
  return 0;
}

function _spRenderTable(items) {
  var container = document.getElementById('sponsoredTournamentList');
  if (!container) return;

  var h = '<div class="table-wrapper"><table><thead><tr>';
  h += '<th>Tournament</th><th>Prize Type</th><th>Pool</th><th>Prizes (1st / 2nd / 3rd / 4-10th)</th>';
  h += '<th>Match</th><th>Sponsorship</th><th>Winners Paid?</th><th>Actions</th>';
  h += '</tr></thead><tbody>';

  items.forEach(function(item) {
    var d = item.d;                                  /* bridge → {name, sponsor, prizePool, prizes, prizeType, matchId, status, prizeDistributed, createdAt} */
    var prizes = d.prizes || {};
    var pType = String(d.prizeType || 'cash').toLowerCase();
    var isCoin = (pType === 'coin' || pType === 'coins');
    var unit = isCoin ? '🪙' : '₹';
    var typeLabel = isCoin
      ? '<span style="color:#ffd700;font-weight:800">🪙 Coins</span>'
      : '<span style="color:#00ff9c;font-weight:800">₹ Real Money</span>';

    /* Asli match ka status (bridge se ya _spLoadMatchInfo se) */
    var matchId = d.matchId || '';
    var rm = matchId ? _spMatchInfo[matchId] : null;
    var mtObj = { status: rm ? rm.status : '', matchTime: _spMatchTimeMs(matchId, rm) };
    var stTxt = '—', stColor = '#888';
    if (rm) {
      var st = (rm.status || '').toLowerCase();
      if (st === 'live')            { stTxt = '🔴 LIVE';      stColor = '#ff5555'; }
      else if (st === 'completed')  { stTxt = '✅ Completed'; stColor = '#00d4ff'; }
      else if (st === 'cancelled')  { stTxt = '❌ Cancelled'; stColor = '#ff5555'; }
      else                          { stTxt = '⏱ Upcoming';  stColor = '#00ff9c'; }
    } else if (matchId) {
      stTxt = '… check'; stColor = '#888';
    }
    var whenTxt = mtObj.matchTime
      ? new Date(mtObj.matchTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—';

    /* ✅ B14: Distribute button par wahi gate jo Publish Results par hai */
    var gate = window._admPrizeDistributeGate ? window._admPrizeDistributeGate(mtObj) : { ok: true };
    var canDist = (d.status === 'active' && !d.prizeDistributed && gate.ok !== false);

    var campTxt = d.status === 'active' ? '<span style="color:#00ff9c">🟢 Active</span>'
                : d.status === 'completed' ? '<span style="color:#00d4ff">✅ Prizes Distributed</span>'
                : '<span style="color:#888">⏸ Paused</span>';

    h += '<tr>';
    h += '<td><div style="font-weight:800;color:#ffd700">' + escHtml(d.name || 'Sponsored') + '</div>'
       + '<div style="font-size:11px;color:#888">Sponsor: <strong style="color:#aaa">' + escHtml(d.sponsor || '—') + '</strong></div>'
       + '<div style="font-size:10px;color:#555">' + escHtml(String(d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN') : '')) + '</div></td>';
    /* ✅ B11: admin ne jo prize type chuna, wahi yahan nazar aata hai */
    h += '<td>' + typeLabel + '</td>';
    h += '<td><strong style="color:' + (isCoin ? '#ffd700' : '#00ff9c') + '">' + unit + (d.prizePool || 0) + '</strong></td>';
    h += '<td style="font-size:11px;white-space:nowrap">'
       + unit + (Number(prizes.first) || 0) + ' / ' + unit + (Number(prizes.second) || 0) + ' / ' + unit + (Number(prizes.third) || 0)
       + ' / ' + unit + (Number(prizes.fourthToTenth) || 0)
       + '</td>';
    h += '<td><span style="font-weight:700;color:' + stColor + '">' + stTxt + '</span>'
       + '<div style="font-size:11px;color:#888;white-space:nowrap">' + whenTxt + '</div>'
       + (matchId ? '<div style="font-size:10px;color:#555">' + escHtml(matchId.slice(0, 8)) + '…</div>' : '') + '</td>';
    h += '<td>' + campTxt + '</td>';
    h += '<td>' + (d.prizeDistributed
          ? '<span style="color:#00d4ff;font-weight:700">✅ Ha</span>'
          : '<span style="color:#888">⏳ Nahi</span>') + '</td>';
    h += '<td style="white-space:nowrap">';
    if (d.prizeDistributed) {
      h += '<span style="color:#00d4ff;font-size:11px;font-weight:700">✅ Prizes Distributed</span>';
    } else if (canDist) {
      h += '<button onclick="openDistributePrizesModal(\'' + item.id + '\')" title="' + (gate.note || '') + '" style="padding:6px 12px;border-radius:8px;background:linear-gradient(135deg,#00ff9c,#00cc7a);border:none;color:#000;font-size:11px;font-weight:800;cursor:pointer;margin-right:4px"><i class="fas fa-trophy"></i> Distribute</button>';
    } else {
      /* Band kyun hai — wahi wajah jo B14 me hai */
      var blockMsg = gate.ok === false ? gate.msg : (!d.status || d.status !== 'active' ? '⏸ Sponsorship paused hai — pehle active karo.' : '… match status check ho raha hai');
      h += '<button disabled title="' + escAttr(blockMsg) + '" style="padding:6px 12px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#777;font-size:11px;font-weight:700;cursor:not-allowed;margin-right:4px"><i class="fas fa-trophy"></i> Distribute</button>';
    }
    h += '<button onclick="deleteSponsoredTournament(\'' + item.id + '\')" title="Delete" style="padding:6px 10px;border-radius:8px;background:rgba(255,60,60,.08);border:1px solid rgba(255,60,60,.2);color:#ff6b6b;font-size:11px;cursor:pointer"><i class="fas fa-trash"></i></button>';
    h += '</td>';
    h += '</tr>';
  });

  h += '</tbody></table></div>';

  /* Load More (Bug#71 pagination) — pehle jaisa hi, bas table ke neeche */
  if (window._spHasMore) {
    h += '<div style="text-align:center;margin-top:14px">'
      + '<button onclick="loadSponsoredTournaments(true)" style="background:rgba(255,215,0,.1);border:1px solid rgba(255,215,0,.3);color:#ffd700;padding:8px 24px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700">'
      + '<i class="fas fa-chevron-down"></i> Load More</button></div>';
  }
  container.innerHTML = h;
}

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
    window._spHasMore = (snap.numChildren() === _sponsorPageSize);

    var items = Object.values(_sponsorAllItems).sort(function(a,b){ return ((b.d && b.d.createdAt)||0) - ((a.d && a.d.createdAt)||0); });
    document.getElementById('sponsoredCount').textContent = items.length;

    /* Pehle table render (turant), phir asli match status aa jaane par dobara render —
       isse screen khaali nahi lagti aur B14 ka gate asli status par lagta hai. */
    _spRenderTable(items);
    _spLoadMatchInfo(items.map(function(i){ return i.d.matchId; }), function() {
      _spRenderTable(items);
    });
  });
}


/* ── PRIZE DISTRIBUTION MODAL (with Screenshot Upload + OCR Auto-Fill + Joined Player Lookup) ── */
window._spDistScreenshots = [];
window._spDistJoinedPlayers = [];

window.openDistributePrizesModal = async function(tourId) {
  var rtdbRef = (window.rtdb||window.db);
  rtdbRef.ref('sponsoredTournaments/' + tourId).once('value', async function(snap) {
    if (!snap.exists()) return;
    var d = snap.val();
    window._spDistScreenshots = [];
    window._spDistJoinedPlayers = [];

    /* Load joined players for this sponsored match (or all users as fallback) */
    var matchId = d.matchId || d.match_id || tourId;
    try {
      if (window._supa) {
        var jrRes = await window._supa.from('join_requests').select('user_id, ign_at_join, user_ign, user_ff_uid, slot_number').eq('match_id', matchId);
        if (jrRes && Array.isArray(jrRes.data) && jrRes.data.length) {
          jrRes.data.forEach(function(r) {
            window._spDistJoinedPlayers.push({
              uid: r.user_id || '',
              ign: r.user_ign || r.ign_at_join || '',
              ffUid: r.user_ff_uid || '',
              slot: r.slot_number || ''
            });
          });
        }
        if (!window._spDistJoinedPlayers.length) {
          var uRes = await window._supa.from('users').select('id, ign, ff_uid').limit(100);
          if (uRes && Array.isArray(uRes.data)) {
            uRes.data.forEach(function(u) {
              if (u.ign || u.ff_uid) {
                window._spDistJoinedPlayers.push({ uid: u.id, ign: u.ign || '', ffUid: u.ff_uid || '', slot: '' });
              }
            });
          }
        }
      }
    } catch(e) {}

    /* ✅ B11 FIX (2026-10-07): modal ab wahi currency dikhata hai jo
       admin ne create karte waqt chuni thi (₹ real money / 🪙 coins) —
       pehle yahan SAB KUCH hardcoded ₹ tha, isliye coin-prize wale
       sponsored match par bhi "₹" likha aata tha (aur paisa galat
       wallet me jaane ka khatra tha). Currency server bhi tournament
       row se hi uthata hai (anti-tamper) — yahan bas dikhane/bhejne ke
       liye wahi value rakhi jaati hai. */
    var _pt = String(d.prizeType || 'cash').toLowerCase();
    window._distCurrency = (_pt === 'coin' || _pt === 'coins') ? 'coin' : 'cash';
    var _u = window._distCurrency === 'coin' ? '🪙' : '₹';
    var h = '<div style="margin-bottom:14px">';
    h += '<div style="font-size:15px;font-weight:800;color:#ffd700;margin-bottom:4px">' + escHtml(d.name) + '</div>';
    h += '<div style="font-size:12px;color:#888">Prize Pool: <strong style="color:#00ff9c">' + _u + (d.prizePool||0) + '</strong>'
       + ' &nbsp;·&nbsp; Type: <strong style="color:' + (window._distCurrency === 'coin' ? '#ffd700' : '#00ff9c') + '">'
       + (window._distCurrency === 'coin' ? '🪙 Coins (wallet me coins)' : '₹ Real Money (UPI withdrawal)') + '</strong></div>';
    h += '</div>';

    h += '<div style="background:rgba(0,255,156,.05);border:1px solid rgba(0,255,156,.15);border-radius:12px;padding:10px 12px;margin-bottom:14px;font-size:11.5px;color:#aaa;line-height:1.6">';
    h += '☪️ <strong style="color:#00ff9c">Halal Sponsored Prize:</strong> Winner ka <b>IGN</b>, <b>FF UID</b>, ya <b>User UID</b> daalo — ya neeche Result Screenshot upload karke <b>⚡ OCR Auto-Fill</b> dabao.';
    h += '</div>';

    /* Result Screenshot Upload + OCR Auto-Fill Box */
    h += '<div style="background:rgba(0,212,255,.04);border:1.5px dashed rgba(0,212,255,.3);border-radius:12px;padding:12px;margin-bottom:14px">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">';
    h += '<div style="font-size:12px;font-weight:700;color:#00d4ff"><i class="fas fa-camera"></i> Match Result Screenshot (OCR)</div>';
    h += '<div style="display:flex;gap:6px">';
    h += '<button type="button" onclick="document.getElementById(\'spDistSsInput\').click()" class="btn btn-ghost btn-xs" style="border-color:rgba(0,212,255,.35);color:#00d4ff"><i class="fas fa-upload"></i> Upload Screenshot</button>';
    h += '<button type="button" id="spDistOcrBtn" onclick="window._spDistRunOcr()" class="btn btn-xs" style="background:linear-gradient(135deg,#00ff9c,#00d4ff);color:#000;font-weight:800;border:none"><i class="fas fa-bolt"></i> ⚡ OCR Auto-Fill</button>';
    h += '</div></div>';
    h += '<input type="file" id="spDistSsInput" accept="image/*" multiple style="display:none" onchange="window._spDistHandleScreenshots(this)">';
    h += '<div id="spDistSsPreview" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>';
    h += '<div id="spDistOcrStatus" style="font-size:11px;color:#aaa;margin-top:6px;display:none"></div>';
    h += '</div>';

    h += '<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px">Winner Details (IGN / FF UID / User UID):</div>';

    /* Datalist of joined players */
    h += '<datalist id="spDistPlayersList">';
    window._spDistJoinedPlayers.forEach(function(p) {
      if (p.ign) h += '<option value="' + escHtml(p.ign) + '">' + escHtml(p.ign) + (p.ffUid ? ' (FF: ' + escHtml(p.ffUid) + ')' : '') + '</option>';
      if (p.ffUid) h += '<option value="' + escHtml(p.ffUid) + '">' + escHtml(p.ign || 'Player') + ' — FF UID</option>';
    });
    h += '</datalist>';

    var prizes = d.prizes || {};
    var fields = [
      { label: '🥇 1st Place', key: 'w1', prize: prizes.first || 0, color: '#ffd700' },
      { label: '🥈 2nd Place', key: 'w2', prize: prizes.second || 0, color: '#ccc' },
      { label: '🥉 3rd Place', key: 'w3', prize: prizes.third || 0, color: '#cd7f32' },
    ];
    for (var i = 4; i <= 10; i++) {
      if (prizes.fourthToTenth > 0) {
        fields.push({ label: '#' + i + ' Place', key: 'w' + i, prize: prizes.fourthToTenth, color: '#888' });
      }
    }

    fields.forEach(function(f) {
      h += '<div class="form-group" style="margin-bottom:10px">';
      h += '<label style="color:' + f.color + '">' + f.label + ' — <strong>' + _u + f.prize + '</strong></label>';
      h += '<input type="text" id="dist_' + f.key + '" list="spDistPlayersList" class="form-input" placeholder="IGN, FF UID, ya User UID enter karo" style="font-size:12px">';
      h += '</div>';
    });

    h += '<button id="spDistSubmitBtn" onclick="confirmDistributePrizes(\'' + tourId + '\')" style="width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,#ffd700,#ff8c00);border:none;color:#000;font-size:14px;font-weight:800;cursor:pointer;margin-top:8px"><i class="fas fa-trophy"></i> Prizes Distribute Karo</button>';

    var existingModal = document.getElementById('distModal');
    if (existingModal) existingModal.remove();

    if (window.openModal) {
      openModal('🏆 Distribute Prizes', h);
    } else {
      var m = document.createElement('div');
      m.id = 'distModal';
      m.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center';
      m.innerHTML = '<div style="background:#1a1a2e;border:1px solid rgba(255,215,0,.25);border-radius:20px;padding:24px;max-width:500px;width:92%;max-height:90vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-size:16px;font-weight:800;color:#ffd700">🏆 Distribute Prizes</span><button onclick="document.getElementById(\'distModal\').remove()" style="background:rgba(255,255,255,.08);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer">✕</button></div>' +
        h + '</div>';
      document.body.appendChild(m);
    }

    window._distTourId = tourId;
    window._distFields = fields;
  });
};

window._spDistHandleScreenshots = function(inp) {
  if (!inp || !inp.files || !inp.files.length) return;
  var prev = document.getElementById('spDistSsPreview');
  var st = document.getElementById('spDistOcrStatus');
  Array.from(inp.files).forEach(function(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      window._spDistScreenshots.push(e.target.result);
      if (prev) {
        var img = document.createElement('img');
        img.src = e.target.result;
        img.style.cssText = 'width:72px;height:48px;object-fit:cover;border-radius:6px;border:1px solid rgba(0,212,255,.4)';
        prev.appendChild(img);
      }
      if (st) {
        st.style.display = 'block';
        st.style.color = '#00ff9c';
        st.textContent = '✅ ' + window._spDistScreenshots.length + ' screenshot ready — "⚡ OCR Auto-Fill" dabao!';
      }
    };
    reader.readAsDataURL(file);
  });
};

window._spDistRunOcr = async function() {
  var st = document.getElementById('spDistOcrStatus');
  if (!window._spDistScreenshots || !window._spDistScreenshots.length) {
    var inp = document.getElementById('spDistSsInput');
    if (inp) inp.click();
    if (st) { st.style.display = 'block'; st.style.color = '#ffaa00'; st.textContent = '📸 Pehle result screenshot select karo!'; }
    return;
  }
  if (st) { st.style.display = 'block'; st.style.color = '#00d4ff'; st.innerHTML = '<i class="fas fa-spinner fa-spin"></i> OCR scanning screenshot...'; }

  try {
    if (!window.Tesseract) {
      await new Promise(function(res, rej) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    var fullText = '';
    for (var i = 0; i < window._spDistScreenshots.length; i++) {
      var r = await window.Tesseract.recognize(window._spDistScreenshots[i], 'eng');
      fullText += '\n' + ((r && r.data && r.data.text) || '');
    }
    var lines = fullText.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length >= 2; });
    var matchedWinners = [];
    var players = window._spDistJoinedPlayers || [];
    var norm = function(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };

    /* 1. Match against joined players in order of appearance in scoreboard */
    lines.forEach(function(line) {
      var nl = norm(line);
      if (nl.length < 3) return;
      players.forEach(function(p) {
        var np = norm(p.ign);
        var nf = norm(p.ffUid);
        if ((np.length >= 3 && nl.indexOf(np) !== -1) || (nf.length >= 5 && nl.indexOf(nf) !== -1)) {
          var val = p.ign || p.ffUid || p.uid;
          if (val && matchedWinners.indexOf(val) === -1) matchedWinners.push(val);
        }
      });
    });

    /* 2. Fallback: extract clean player tokens from scoreboard lines if no joined players matched */
    if (!matchedWinners.length) {
      var skipRe = /^(booyah|match|result|rank|kills|damage|score|total|squad|solo|duo|bermuda|purgatory|kalahari|alpine|nextera|free|fire|victory|defeat|mvp|team|name|player|status)$/i;
      lines.forEach(function(line) {
        var tokens = line.split(/\s+/).filter(function(tok) {
          var cl = tok.replace(/[^a-zA-Z0-9_.-]/g, '');
          return cl.length >= 3 && !/^\d+$/.test(cl) && !skipRe.test(cl);
        });
        if (tokens.length) {
          var candidate = tokens[0].replace(/[^a-zA-Z0-9_.-]/g, '');
          if (candidate.length >= 3 && matchedWinners.indexOf(candidate) === -1) {
            matchedWinners.push(candidate);
          }
        }
      });
    }

    var fields = window._distFields || [];
    var filled = 0;
    fields.forEach(function(f, idx) {
      var inpEl = document.getElementById('dist_' + f.key);
      if (inpEl && matchedWinners[idx]) {
        inpEl.value = matchedWinners[idx];
        inpEl.style.borderColor = '#00ff9c';
        filled++;
      }
    });

    if (st) {
      if (filled > 0) {
        st.style.color = '#00ff9c';
        st.textContent = '✅ OCR Auto-Filled ' + filled + ' winner(s): ' + matchedWinners.slice(0, filled).join(', ');
      } else {
        st.style.color = '#ffaa00';
        st.textContent = '⚠️ Screenshot se naam match nahi hua — manually IGN ya FF UID enter karo.';
      }
    }
  } catch (err) {
    if (st) {
      st.style.color = '#ff4444';
      st.textContent = '❌ OCR Error: ' + (err && err.message ? err.message : 'Scan failed');
    }
  }
};

window.confirmDistributePrizes = async function(tourId) {
  var fields = window._distFields || [];
  var updates = [];

  fields.forEach(function(f) {
    var uid = ((document.getElementById('dist_' + f.key)||{}).value||'').trim();
    if (uid && Number(f.prize) > 0) {
      updates.push({ uid: uid, prize: Number(f.prize), rank: f.label });
    }
  });

  if (!updates.length) { showToast('Koi winner IGN / FF UID / User UID nahi diya', true); return; }
  if (!window._supa) { showToast('Supabase client not ready', true); return; }

  /* ✅ B11 SURAKSHA (2026-10-07): paisa jaane se PEHLE app ka apna confirm —
     kis-kis ko kitna ja raha hai wo saaf likha hota hai (native popup nahi).
     Server side par teen aur taale hain: duplicate-guard (ek tournament me
     ek user ko dobara credit nahi), pool-cap (pool se zyada nahi) aur
     audit-log (kis admin ne kya kiya). */
  var _c = window._distCurrency === 'coin' ? 'coin' : 'cash';
  var _cu = _c === 'coin' ? '🪙' : '₹';
  var _lines = updates.map(function(u) { return '• ' + u.rank + ' → ' + u.uid + ' = ' + _cu + u.prize; }).join('\n');
  var _go = window.appConfirm
    ? await window.appConfirm('Ye prizes credit karne hain?\n\n' + _lines + '\n\n(' + (_c === 'coin' ? '🪙 coins wallet me jayenge' : '₹ real money — winner withdraw kar sakta hai') + ')',
        { icon: '🏆', okText: 'Haan, credit karo' })
    : true;
  if (!_go) return;

  var btn = document.getElementById('spDistSubmitBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Distributing Prizes...'; }

  var done = 0, failed = 0, lastErr = '';
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    try {
      var r = await window._supa.rpc('admin_distribute_sponsored_prize', {
        p_uid: u.uid, p_amount: u.prize, p_tour_id: tourId, p_rank: u.rank, p_currency: _c
      });
      if (r.error || (r.data && r.data.success === false)) {
        failed++;
        var _e = (r.data && r.data.error) || (r.error && r.error.message) || 'user_not_found';
        /* server ke saaf messages ko admin ki bhasha me */
        var _eMap = {
          already_credited: 'pehle hi credit ho chuka hai (duplicate block)',
          exceeds_prize_pool: 'pool se zyada ho raha hai (pool-cap ne roka)',
          invalid_amount: 'amount galat',
          not_admin: 'aap admin nahi hain'
        };
        lastErr = _eMap[_e] || _e;
      } else {
        done++;
        var targetUid = (r.data && r.data.resolved_uid) || u.uid;
        if (window.rtdb) {
          window.rtdb.ref('users/' + targetUid + '/notifications').push({
            type: 'sponsored_prize',
            title: '🏆 Sponsored Prize Mili!',
            message: u.rank + ' — ₹' + u.prize + ' aapke wallet mein add ho gayi! Wallet > Withdraw se UPI pe bhej sakte hain.',
            read: false, timestamp: Date.now()
          });
        }
      }
    } catch (e) {
      failed++;
      lastErr = e && e.message ? e.message : 'RPC error';
    }
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trophy"></i> Prizes Distribute Karo'; }

  if (done > 0) {
    (window.rtdb||window.db).ref('sponsoredTournaments/' + tourId).update({
      prizeDistributed: true, distributedAt: Date.now(), status: 'completed'
    });
    if (window.closeModal) closeModal();
    var dm = document.getElementById('distModal');
    if (dm) dm.remove();
  }

  showToast(failed === 0
    ? ('✅ ' + done + ' winners ko prizes credit ho gaye!')
    : ('⚠️ ' + done + ' credited, ' + failed + ' fail (' + lastErr + ')'), failed > 0 && done === 0);
  /* Fail hone par wajah ek saaf app-dialog me bhi (admin ko turant pata chale) */
  if (failed > 0 && window.appAlert) {
    window.appAlert('⚠️ ' + failed + ' winner ka prize credit NAHI hua.\n\nWajah: ' + lastErr + '\n\n(Tip: ek hi winner ko dobara credit nahi hota, aur pool se zyada nahi ja sakta — dono server par blocked hain.)', { icon: '⚠️' });
  }
  loadSponsoredTournaments();
};

window.deleteSponsoredTournament = async function(id) {
  /* ✅ B3 usool: native popup nahi — app ka apna dialog. */
  var ok = window.appConfirm
    ? await window.appConfirm('Is sponsored tournament ko delete karo? (Match aur uska data alag rehta hai — sirf sponsorship branding row hattee hai.)', { danger: true, icon: '🗑️', okText: 'Haan, delete' })
    : true;
  if (!ok) return;
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
  /* ✅ R5 (2026-09-23): LEGACY OVERRIDE REMOVED — ye 2-path approve tha
     (Firebase walletRequests + admin-side users.sponsored_winnings direct
     update) jo SERVER resolve_sponsored_withdrawal RPC ke saat double-
     authority bana raha tha. Ab keval admin-supabase-sponsored.js ka
     single-authoritative approve (resolve_sponsored_withdrawal) hi chalta
     hai. Ye filename backward-compat stub hai (koई backup state nahin). */
  if (window.showToast) showToast('✅ Withdrawal system single-authority hai — approve sirf resolve_sponsored_withdrawal RPC se hota hai', true);
};

window.rejectSponsoredWd = function(reqId, uid, amount) {
  /* ✅ R5: legacy reject भी inert — reject सिर्फ़ admin-supabase-sponsored.js
     (resolve_sponsored_withdrawal RPC, status-only, no client balance write). */
  if (window.showToast) showToast('Reject sirf resolve_sponsored_withdrawal RPC se hota hai', true);
};

/* ── Helpers ── */
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s||'').replace(/'/g,"\\'").replace(/"/g,"&quot;");
}

console.log('✅ fa-sponsored-system.js loaded');
