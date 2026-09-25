/* ── admin-inline.js · Part E: PERIPHERAL (exportCSV, roster, activity log, sky-diamond, premium, season pass) ── */
function loadDisputes() {
  var tb = document.getElementById('disputesTable');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';
  rtdb.ref('disputes').orderByChild('createdAt').limitToLast(100).once('value', function(snap) {
    if (!snap.exists()) {
      tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#aaa">No disputes found</td></tr>';
      document.getElementById('disputeCount').textContent = 0;
      return;
    }
    var rows = [];
    snap.forEach(function(c) { rows.push({ id: c.key, d: c.val() }); });
    rows.reverse(); // newest first
    var pending = rows.filter(function(r) { return r.d.status === 'pending'; }).length;
    document.getElementById('disputeCount').textContent = rows.length;
    updateBadge('disputesBadge', pending);
    tb.innerHTML = '';
    rows.forEach(function(r) {
      var d = r.d, id = r.id;
      var ts = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'}) : '—';
      var typeLabels = { wrong_rank: 'Wrong Rank', missing_kills: 'Kills Wrong', not_credited: 'Prize Missing', other: 'Other' };
      var sb = d.status === 'resolved' ? 'green' : d.status === 'rejected' ? 'red' : 'yellow';
      var ssCell = d.screenshot
        ? '<a href="' + d.screenshot + '" target="_blank" style="color:var(--info);font-size:10px"><i class="fas fa-image"></i> View</a>'
        : '<span style="color:#666;font-size:10px">—</span>';
      var acts = d.status === 'pending'
        ? '<button class="btn btn-primary btn-xs" onclick="resolveDispute(\'' + id + '\',\'resolved\')" title="Resolve"><i class="fas fa-check"></i></button> '
          + '<button class="btn btn-danger btn-xs" onclick="resolveDispute(\'' + id + '\',\'rejected\')" title="Reject"><i class="fas fa-times"></i></button>'
        : '<span style="color:#666;font-size:10px">' + d.status + '</span>';
      tb.innerHTML += '<tr>'
        + '<td><strong class="text-primary" style="font-size:11px">' + (d.userName || '—') + '</strong></td>'
        + '<td style="font-size:10px;color:#aaa;font-family:monospace">' + ((d.matchId||'').substring(0,10) + '…') + '</td>'
        + '<td><span class="badge yellow" style="font-size:9px">' + (typeLabels[d.type] || d.type || '—') + '</span></td>'
        + '<td style="font-weight:700;text-align:center">' + (d.claimedRank ? '#' + d.claimedRank : '—') + '</td>'
        + '<td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (d.message||'') + '">' + (d.message||'—') + '</td>'
        + '<td>' + ssCell + '</td>'
        + '<td style="font-size:10px;white-space:nowrap">' + ts + '</td>'
        + '<td><span class="badge ' + sb + '">' + (d.status||'pending') + '</span></td>'
        + '<td>' + acts + '</td>'
        + '</tr>';
    });
  });
}

async function resolveDispute(id, status) {
  if (!confirm('Mark dispute as ' + status + '?')) return;
  try {
    await rtdb.ref('disputes/' + id).update({ status: status, resolvedAt: Date.now(), resolvedBy: 'admin' });
    showToast('✅ Dispute marked as ' + status);
    loadDisputes();
  } catch(e) { showToast('❌ ' + e.message, true); }
}

/* ═══ END DISPUTES ═══ */

/* ═══ FIX: renderProfileUpdates DB path ═══ */
/* profileUpdates data is in 'profileUpdateRequests' but listener uses it correctly */

/* ✅ REMOVED (2026-08): Coin Requests admin approve/reject flow —
   coins are never purchasable in the User Panel (no coin-purchase UI
   exists there), so this queue could never receive a request. The
   coin_requests table was confirmed empty and will stay empty. */


/* =============================================
   MATCH TEMPLATES SYSTEM
   Admin tournament form me save/load/delete templates
   Firebase: matchTemplates/{templateId}
   ============================================= */

function loadTemplates() {
  var list = document.getElementById('templateList');
  if (!list) return;
  rtdb.ref('matchTemplates').once('value', function(s) {
    if (!s.exists()) {
      list.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">No templates — fill form aur "Save Template" dabao</span>';
      return;
    }
    var html = '';
    s.forEach(function(c) {
      var t = c.val(), id = c.key;
      html += '<div class="tpl-chip" data-tid="' + id + '">' +
        '<span class="tpl-name" onclick="applyTemplate(this.parentNode.dataset.tid)">' + (t.name||'') + ' <span style="font-size:9px;opacity:.6">' + (t.gameMode||'') + '</span></span>' +
        '<span class="tpl-del" onclick="deleteTemplate(this.parentNode.dataset.tid)">✕</span>' +
        '</div>';
    });
    list.innerHTML = html;
  });
}

function saveAsTemplate() {
  var nm = document.getElementById('tName') ? document.getElementById('tName').value.trim() : '';
  var tplName = nm || ('Template ' + new Date().toLocaleDateString('en-IN'));
  
  var tpl = {
    name: tplName,
    gameMode: (document.getElementById('tGameMode')||{}).value || 'solo',
    map: (document.getElementById('tMap')||{}).value || 'Bermuda',
    entryType: (document.getElementById('tEntryType')||{}).value || 'paid',
    entryFee: Number((document.getElementById('tEntryFee')||{}).value) || 0,
    perKillPrize: Number((document.getElementById('tPerKill')||{}).value) || 0,
    
    maxSlots: Number((document.getElementById('tMaxSlots')||{}).value) || 12,
    firstPrize: Number((document.getElementById('tFirstPrize')||{}).value) || 0,
    secondPrize: Number((document.getElementById('tSecondPrize')||{}).value) || 0,
    thirdPrize: Number((document.getElementById('tThirdPrize')||{}).value) || 0,
    isSpecial: document.getElementById('tIsSpecial') ? document.getElementById('tIsSpecial').checked : false,
    savedAt: Date.now()
  };

  rtdb.ref('matchTemplates').push(tpl).then(function() {
    showToast('✅ Template "' + tplName + '" saved!');
    loadTemplates();
  }).catch(function(e) { showToast('Error: ' + e.message, true); });
}

function applyTemplate(id) {
  rtdb.ref('matchTemplates/' + id).once('value', function(s) {
    if (!s.exists()) { showToast('Template not found', true); return; }
    var t = s.val();
    
    /* Fill all form fields */
    if (document.getElementById('tName')) document.getElementById('tName').value = t.name || '';
    if (document.getElementById('tGameMode')) document.getElementById('tGameMode').value = t.gameMode || 'solo';
    if (document.getElementById('tMap')) document.getElementById('tMap').value = t.map || 'Bermuda';
    if (document.getElementById('tEntryType')) { document.getElementById('tEntryType').value = t.entryType || 'paid'; if(window.onEntryTypeChange) onEntryTypeChange(); }
    if (document.getElementById('tEntryFee')) document.getElementById('tEntryFee').value = t.entryFee || 0;
    // prizePool auto-calc from prizes
    
    if (document.getElementById('tMaxSlots')) document.getElementById('tMaxSlots').value = t.maxSlots || 12;
    if (document.getElementById('tFirstPrize')) document.getElementById('tFirstPrize').value = t.firstPrize || 0;
    if (document.getElementById('tSecondPrize')) document.getElementById('tSecondPrize').value = t.secondPrize || 0;
    if (document.getElementById('tThirdPrize')) document.getElementById('tThirdPrize').value = t.thirdPrize || 0;
    if (document.getElementById('tIsSpecial') && t.isSpecial !== undefined) document.getElementById('tIsSpecial').checked = t.isSpecial;
    /* Clear time and room fields — these are always fresh */
    if (document.getElementById('tMatchTime')) document.getElementById('tMatchTime').value = '';
    _capturedMatchTime = '';
    _updateTMatchTimePreview();
    if (document.getElementById('tRoomId')) document.getElementById('tRoomId').value = '';
    if (document.getElementById('tRoomPass')) document.getElementById('tRoomPass').value = '';
    
    showToast('✅ Template applied! Time aur Room ID add karo.');
  });
}

function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  rtdb.ref('matchTemplates/' + id).remove().then(function() {
    showToast('Template deleted');
    loadTemplates();
  });
}


/* =============================================
   VERIFY CHECKBOX — Admin marks player as verified in room
   Firebase: joinRequests/{reqKey}/adminVerified = true/false
   ============================================= */
async function toggleVerify(reqKey, el) {
  if (!reqKey) return;
  var wrap = el.classList.contains('verify-chk-wrap') ? el : el.closest('.verify-chk-wrap,.tm-vchk');
  if (!wrap) wrap = el;
  var icon = wrap.querySelector('i');
  var isVerified = wrap.style.borderColor.includes('00ff9c') || wrap.dataset.verified === 'true';
  var newState = !isVerified;
  
  /* Optimistic UI update */
  wrap.style.borderColor = newState ? '#00ff9c' : 'rgba(255,255,255,.2)';
  wrap.style.background = newState ? 'rgba(0,255,156,.12)' : 'rgba(255,255,255,.04)';
  if (icon) icon.style.color = newState ? '#00ff9c' : 'rgba(255,255,255,.2)';
  wrap.dataset.verified = newState ? 'true' : 'false';
  
  /* Save to Firebase */
  try {
    await rtdb.ref('joinRequests/' + reqKey).update({
      adminVerified: newState,
      verifiedAt: newState ? Date.now() : null,
      verifiedBy: auth.currentUser ? _adminUid() : 'admin'
    });
    /* FIX Bug#25: Sync verified status to Supabase — user-app reads join_requests.checked_in */
    if(window._supa){
      window._supa.from('join_requests').update({
        checked_in:newState,
        in_room:newState,
        checked_in_at:newState?new Date().toISOString():null
      }).eq('id',reqKey)
        .catch(function(e){console.warn('[Bug#25 Fix] toggleVerify Supabase sync:',e.message);});
    }
    showToast(newState ? '✅ Player verified!' : 'Verification removed');
  } catch(e) {
    showToast('Error: ' + e.message, true);
    /* Revert on error */
    wrap.style.borderColor = isVerified ? '#00ff9c' : 'rgba(255,255,255,.2)';
    wrap.style.background = isVerified ? 'rgba(0,255,156,.12)' : 'rgba(255,255,255,.04)';
    if (icon) icon.style.color = isVerified ? '#00ff9c' : 'rgba(255,255,255,.2)';
  }
}

/* ====== FIX MISSING TEAMMATE JOIN REQUESTS ====== */
/* Scans all joinRequests for duo/squad captains and creates missing teammate JRs */
async function fixMissingTeammateJRs() {
  if (!confirm('Yeh scan karega sab active duo/squad captain JRs aur missing teammate entries create karega. Continue?')) return;
  showToast('Scanning...', 'info');
  
  var snap = await rtdb.ref('joinRequests').once('value');
  var allJRs = snap.val() || {};
  
  // Group by matchId+captainUid to find who already has team JRs
  var captainJRs = {};
  var existingTeamJRs = {}; // key = matchId+userId
  
  Object.keys(allJRs).forEach(function(k) {
    var jr = allJRs[k];
    if (!jr || !jr.matchId) return;
    var st = (jr.status || '').toLowerCase();
    if (st === 'cancelled') return;
    
    if (!jr.isTeamMember && (jr.mode === 'duo' || jr.mode === 'squad')) {
      // Captain entry
      var key = jr.matchId + '_' + jr.userId;
      captainJRs[key] = { k: k, jr: jr };
    }
    if (jr.isTeamMember && jr.captainUid) {
      // Teammate entry already exists
      existingTeamJRs[jr.matchId + '_' + jr.userId] = true;
    }
  });
  
  var created = 0;
  var errors = 0;
  
  for (var capKey in captainJRs) {
    var entry = captainJRs[capKey];
    var jr = entry.jr;
    var teamMembers = jr.teamMembers || [];
    if (teamMembers.length <= 1) continue; // solo effectively
    
    // Find members who are NOT the captain
    var members = teamMembers.filter(function(m) { return m.uid !== (jr.userFFUID || '') && m.role !== 'captain'; });
    
    for (var mi = 0; mi < members.length; mi++) {
      var m = members[mi];
      var mFfUid = m.uid || m.ffUid || '';
      if (!mFfUid) continue;
      
      // Look up Firebase UID by FF UID
      try {
        var userSnap = await rtdb.ref('users').orderByChild('ffUid').equalTo(mFfUid).once('value');
        if (!userSnap.exists()) { errors++; continue; }
        var fbKey = null;
        userSnap.forEach(function(c) { fbKey = c.key; });
        if (!fbKey) { errors++; continue; }
        
        // Check if JR already exists for this player in this match
        var alreadyKey = jr.matchId + '_' + fbKey;
        if (existingTeamJRs[alreadyKey]) continue; // already exists
        
        // Check in allJRs
        var alreadyHas = Object.keys(allJRs).some(function(k2) {
          var j2 = allJRs[k2];
          return j2 && j2.matchId === jr.matchId && j2.userId === fbKey && (j2.status || '') !== 'cancelled';
        });
        if (alreadyHas) continue;
        
        // Create the missing teammate JR
        var pjid = rtdb.ref('joinRequests').push().key;
        var allSlots = jr.allSlots || null;
        var pSlot = allSlots ? (allSlots[mi + 1] || allSlots[0]) : null;
        
        await rtdb.ref('joinRequests/' + pjid).set({
          requestId: pjid,
          userId: fbKey,
          userName: m.name || '',
          userFFUID: mFfUid,
          displayName: m.name || '',
          matchId: jr.matchId,
          matchName: jr.matchName || '',
          entryFee: 0,
          entryType: jr.entryType || 'money',
          mode: jr.mode || 'duo',
          status: 'joined',
          slotsBooked: 0,
          teamMembers: jr.teamMembers,
          captainUid: jr.userId,
          captainName: jr.userName || '',
          slotNumber: pSlot || null,
          allSlots: allSlots,
          isTeamMember: true,
          fixedByAdmin: true,
          createdAt: Date.now()
        });
        
        // Notify the user
        var notifId = rtdb.ref('users/' + fbKey + '/notifications').push().key;
        await rtdb.ref('users/' + fbKey + '/notifications/' + notifId).set({
          type: 'team_joined',
          title: '🎮 Team Entry Fixed!',
          body: 'Admin ne tumhari "' + (jr.matchName||'match') + '" ki entry fix kar di. Tum team mein ho!',
          matchId: jr.matchId,
          read: false,
          createdAt: Date.now()
        });
        
        existingTeamJRs[alreadyKey] = true; // mark as done
        created++;
      } catch(e) {
        console.error('Fix JR error:', e);
        errors++;
      }
    }
  }
  
  showToast('✅ Fix complete! Created: ' + created + ' entries' + (errors > 0 ? ', Errors: ' + errors : ''), errors > 0 ? 'warning' : 'success');
  if (created > 0) refreshJoinedPlayers();
}

/* ✅ FIX (2026-08-17, CRITICAL): loadMatchResultSection() was called by the
   sidebar's "Match Result" nav item (showSection('matchResult',this);
   loadMatchResultSection()) but was NEVER DEFINED ANYWHERE in the entire
   codebase — clicking that nav item always left "-- Select Match --" as
   the only option, exactly as reported. Worse, tracing further: the whole
   section-matchResult panel this nav item opens also has no working base
   for mrPublishResults, mrAddScreenshots, or mrClearScreenshots either —
   only wrapper-patches (security-patches.js, admin-fixes-v21/22/23) that
   each expect an earlier version to already exist via `var orig =
   window.mrX; if (!orig) return;`, so all of them silently no-op forever.
   This entire panel has never had a working foundation to patch onto.

   Rather than hand-rebuild an entire second OCR/screenshot/anomaly-check
   result-publishing pipeline from scratch (duplicating real, working,
   already-tested logic), this redirects into section-results —
   confirmed fully functional (loadParticipants() + publishResults(),
   already synced to Supabase via admin-supabase-sync.js) — populating
   its match dropdown so the admin can pick a match immediately instead
   of landing on a dead end. */
window.loadMatchResultSection = function() {
  /* Note: showSection('results', this) is now called directly from the
     sidebar nav item itself (index.html), so this just ensures the
     dropdown is populated — no redirect needed here anymore. */
  setTimeout(function() {
    var sel = document.getElementById('resultTournamentSelect');
    if (sel && !sel.options.length) {
      /* Defensive: resultTournamentSelect is normally populated by the
         same central loadTournaments() pass that fills mhMatchSelect etc.
         If for any reason it's still empty (e.g. this is the very first
         section opened this session), populate it directly from
         allTournaments here so the admin never sees a blank dropdown. */
      var opts = '<option value="">-- Select Match --</option>';
      Object.keys(allTournaments || {}).forEach(function(id) {
        var t = allTournaments[id];
        opts += '<option value="' + id + '">' + (t.name || t.title || id) + '</option>';
      });
      sel.innerHTML = opts;
    }
    /* ✅ R19 (2026-09-21): mrMatchFilter (पुराना dead dropdown) को असली
       result-dropdown से sync रखो — वरना वहाँ से match चुनने पर कुछ नहीं
       होता था (mrPlayerTable को भरने वाला कोई code ही नहीं था)। */
    var _mf = document.getElementById('mrMatchFilter');
    if (_mf) {
      var _mo = '<option value="">-- Select Match --</option>';
      Object.keys(allTournaments || {}).forEach(function(id) {
        var t = allTournaments[id];
        _mo += '<option value="' + id + '">' + (t.name || t.title || id) + '</option>';
      });
      _mf.innerHTML = _mo;
      if (sel && sel.value) _mf.value = sel.value;
    }
  }, 100);
};

window.showResultPublisher = window.showResultPublisher || function(mid, matchName) {
  /* ✅ FIX (Audit M6): pehle yahan document.querySelector('.nav-item[onclick*="results"]')
     tha — koi bhi sidebar nav-item ke onclick mein literal "results" substring nahi
     hai (yeh section sidebar mein permanent slot ke bina, sirf match se "Publish Result"
     click karne par khulta hai by design), isliye yeh hamesha null hi return karta tha.
     showSection() null-safe hai (crash nahi hota), bas dead/misleading code tha — clean kar diya. */
  showSection('results', null);
  setTimeout(function() {
    var sel = document.getElementById('resultTournamentSelect');
    if (sel) { sel.value = mid; var ev = new Event('change'); sel.dispatchEvent(ev); }
  }, 400);
};

/* ===== CORRECT RESULT - FULL UI (inline override) ===== */
window.openResultCorrection = async function(matchId, userId, userName) {
  var rtdb = window.rtdb || window.db;
  if (!rtdb) return;
  var m = document.getElementById('genericModal'), mt = document.getElementById('genericModalTitle'), mb = document.getElementById('genericModalBody');
  if(!m || !mt || !mb) return;
  mt.innerHTML = '✏️ Correct Result';
  mb.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading player data...</div>';
  m.classList.add('show');
  try {
    var results = await Promise.all([
      rtdb.ref('matches/' + matchId).once('value'),
      rtdb.ref('results').orderByChild('userId').equalTo(userId).once('value'),
      rtdb.ref('users/' + userId).once('value'),
      rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value')
    ]);
    var match = results[0].val() || {};
    var resSnap = results[1], userSnap = results[2], jrSnap = results[3];
    var userData = userSnap.val() || {};
    var existRes = null, resKey = null;
    if(resSnap.exists()) resSnap.forEach(function(c){ var d=c.val(); if((d.matchId||d.tournamentId)===matchId){existRes=d;resKey=c.key;} });
    var jrData = null;
    if(jrSnap.exists()) jrSnap.forEach(function(c){ var d=c.val(); if(d.userId===userId) jrData=d; });
    var preRank = existRes ? (existRes.rank||0) : 0;
    var preKills = existRes ? (existRes.kills||0) : 0;
    var preTw = existRes ? (existRes.winnings||existRes.totalWinning||0) : 0;
    var preRp = existRes ? (existRes.rankPrize||0) : 0;
    var preKp = existRes ? (existRes.killPrize||0) : 0;
    var ffUid = userData.ffUid || '-';
    var slot = jrData ? (jrData.slotNumber||'-') : '-';
    var entryFee = jrData ? (jrData.entryFee||0) : (match.entryFee||0);
    var f1=match.firstPrize||0, f2=match.secondPrize||0, f3=match.thirdPrize||0;
    var pk=Number(match.perKillPrize)||0;
    window._rcMatchData = {f1:f1, f2:f2, f3:f3, pk:pk};
    var h = '<div style="padding:4px">';
    h += '<div style="background:rgba(0,212,255,.07);border:1px solid rgba(0,212,255,.18);border-radius:10px;padding:10px;margin-bottom:10px">';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">';
    h += '<div><div style="color:#888">👤 Player</div><strong style="color:#00d4ff">'+userName+'</strong></div>';
    h += '<div><div style="color:#888">🎮 FF UID</div><strong style="color:#00d4ff;font-family:monospace;font-size:10px">'+ffUid+'</strong></div>';
    h += '<div><div style="color:#888">🗂️ Match</div><strong style="color:#fff;font-size:10px">'+(match.name||matchId)+'</strong></div>';
    h += '<div><div style="color:#888">💰 Entry / Slot</div><strong style="color:#ffd700">₹'+entryFee+' / '+slot+'</strong></div>';
    h += '</div></div>';
    h += '<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.15);border-radius:8px;padding:8px;margin-bottom:10px;font-size:11px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">';
    h += '<span style="color:#ffd700;font-weight:700">🥇₹'+f1+'</span><span style="color:#c0c0c0;font-weight:700">🥈₹'+f2+'</span><span style="color:#cd7f32;font-weight:700">🥉₹'+f3+'</span>';
    if(pk) h += '<span style="color:#ff9c00;font-weight:700">💀₹'+pk+'/Kill</span>';
    h += '</div>';
    if(existRes){
      h += '<div style="background:rgba(255,100,0,.07);border:1px solid rgba(255,100,0,.2);border-radius:8px;padding:8px;margin-bottom:10px;font-size:11px">';
      h += '<div style="color:#ff9c00;font-weight:700;margin-bottom:4px">📋 Published Result:</div>';
      h += '<span style="margin-right:10px">Rank: <strong style="color:#fff">'+(preRank?'#'+preRank:'—')+'</strong></span>';
      h += '<span style="margin-right:10px">Kills: <strong style="color:#ff6b6b">'+preKills+'</strong></span>';
      h += '<span>Prize: <strong style="color:#00ff9c">₹'+preTw+'</strong>';
      if(preRp||preKp) h += ' <span style="color:#666;font-size:10px">(R:₹'+preRp+' K:₹'+preKp+')</span>';
      h += '</span></div>';
    }
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
    h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:5px">🎯 New Rank</label>';
    h += '<input type="number" id="rcRank" min="0" max="99" value="'+preRank+'" oninput="rcAutoCalc()" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid #333;color:#ffd700;font-size:18px;text-align:center;font-weight:800;box-sizing:border-box"></div>';
    h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:5px">💀 New Kills</label>';
    h += '<input type="number" id="rcKills" min="0" value="'+preKills+'" oninput="rcAutoCalc()" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid #333;color:#ff6b6b;font-size:18px;text-align:center;font-weight:800;box-sizing:border-box"></div>';
    h += '</div>';
    h += '<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.18);border-radius:10px;padding:10px;margin-bottom:10px;text-align:center">';
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:3px">Auto Calculated Prize</div>';
    h += '<div id="rcPrizeVal" style="font-size:24px;font-weight:800;color:#00ff9c">₹'+preTw+'</div>';
    h += '<div id="rcPrizeBreakdown" style="font-size:10px;color:#666;margin-top:2px"></div>';
    h += '</div>';
    h += '<div style="margin-bottom:12px"><label style="font-size:11px;color:#aaa;cursor:pointer;display:flex;align-items:center;gap:6px"><input type="checkbox" id="rcManualOverride" onchange="rcToggleManual()"> Manual prize override</label>';
    h += '<div id="rcManualWrap" style="display:none;margin-top:8px"><input type="number" id="rcPrize" min="0" placeholder="Override amount ₹" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid rgba(255,170,0,.3);color:#ffaa00;font-size:14px;text-align:center;box-sizing:border-box"></div></div>';
    h += '<button onclick="submitResultCorrection(\''+matchId+'\',\''+userId+'\',\''+encodeURIComponent(userName)+'\')" style="width:100%;padding:13px;border-radius:10px;background:linear-gradient(135deg,#ffaa00,#ff8800);color:#000;font-weight:800;border:none;cursor:pointer;font-size:14px"><i class="fas fa-save"></i> Save Correction</button>';
    h += '</div>';
    mb.innerHTML = h;
    setTimeout(function(){ if(window.rcAutoCalc) rcAutoCalc(); }, 50);
  } catch(e) {
    mb.innerHTML = '<div style="padding:20px;color:#f55">Error: '+e.message+'</div>';
  }
};

;

;

window.submitResultCorrection = async function(matchId, userId, userNameEncoded) {
  var userName=decodeURIComponent(userNameEncoded||'');
  var rank=Number((document.getElementById('rcRank')||{}).value)||0;
  var kills=Number((document.getElementById('rcKills')||{}).value)||0;
  var manualOn=document.getElementById('rcManualOverride')&&document.getElementById('rcManualOverride').checked;
  var manualAmt=Number((document.getElementById('rcPrize')||{}).value)||0;
  if(!rank&&!kills&&!manualOn){if(window.showToast)showToast('❌ Rank ya Kills daalo',true);return;}
  var supa=window._supa;
  if(!supa){ if(window.showToast)showToast('❌ Supabase not ready — correction nahi ho sakti',true); return; }
  try{
    /* ✅ R7 FOLLOW-UP (2026-09-25): result correction ab SINGLE authoritative
       RPC `correct_match_result()` se — server khud prize compute karta hai
       (matches.first/second/third/per_kill_prize + prize_type/entry_type
       currency), wallet delta + wallet_transactions ledger + notifications +
       match_results + join_requests + admin_actions sab EK txn me. Client
       sirf {rank, kills} ya admin manual-override amount bhejta hai — koi
       prize/currency NAHI. Firebase mirror loop NAHI likha gaya (purana path
       users/{uid}/realMoney + transactions ko client-side mutate karta tha
       = client financial authority + double ledger). Server hi single writer. */
    var payload={ p_match_id: matchId, p_user_id: userId, p_user_name: userName };
    if(manualOn){ payload.p_manual_amount=manualAmt; }
    else { if(rank) payload.p_rank=rank; if(kills) payload.p_kills=kills; }
    var r=await supa.rpc('correct_match_result', payload);
    if(r.error || !r.data || r.data.ok!==true){
      var msg=(r.data&&r.data.error)||(r.error&&r.error.message)||'Server rejected correction';
      if(window.showToast)showToast('❌ '+msg,true);
      return;
    }
    var d=r.data;
    var prize=(d.new_prize!=null)?d.new_prize:0, delta=(d.delta!=null)?d.delta:0;
    if(window.showToast) showToast('✅ Corrected! Rank#'+d.new_rank+', '+d.new_kills+' kills → Prize ₹'+prize+(delta>0?' (+₹'+delta+')':delta<0?' (-₹'+Math.abs(delta)+')':''));
    document.getElementById('genericModal').classList.remove('show');
    if(window.loadMatchHistory) loadMatchHistory();
  }catch(e){if(window.showToast)showToast('❌ Error: '+e.message,true);}
};

/* ===== MATCH RESULT PRIZE DATA — set fresh when loadParticipants runs ===== */
window._MRD = {f1:0,f2:0,f3:0,pk:0};

/* Override loadParticipants to store fresh prize data in _MRD */
(function(){
  var _orig = window.loadParticipants;
  window.loadParticipants = async function() {
    var mid = (document.getElementById('resultTournamentSelect')||{}).value;
    if(mid && (window.rtdb||window.db)){
      try {
        var snap = await (window.rtdb||window.db).ref('matches/'+mid).once('value');
        if(snap.exists()){
          var d = snap.val();
          window.currentTournamentData = d; window.currentTournamentData._id = mid;
          if(window.allTournaments) window.allTournaments[mid] = d;
          window._MRD = {f1:Number(d.firstPrize)||0, f2:Number(d.secondPrize)||0, f3:Number(d.thirdPrize)||0, pk:Number(d.perKillPrize)||0};
        }
      } catch(e){}
    }
    var result = _orig ? _orig.apply(this, arguments) : null;
    return result;
  };
})();

/* calcPrize — reads from _MRD directly, same pattern as mhCalcPrize */
window.calcPrize = function(inp) {
  var row = inp.closest('tr'); if(!row) return;
  var r = Number((row.querySelector('.rank-input')||{}).value)||0;
  var k = Number((row.querySelector('.kills-input')||{}).value)||0;
  var d = window._MRD;
  /* Also sync from data attrs if _MRD not yet set */
  var tb = document.getElementById('participantsList');
  if((!d.f1&&!d.f2&&!d.f3&&!d.pk) && tb && (tb.dataset.f1||tb.dataset.pk)) {
    d = {f1:Number(tb.dataset.f1)||0, f2:Number(tb.dataset.f2)||0, f3:Number(tb.dataset.f3)||0, pk:Number(tb.dataset.pk)||0};
  }
  /* Final fallback to currentTournamentData */
  if(!d.f1&&!d.f2&&!d.f3&&!d.pk && window.currentTournamentData) {
    var t=window.currentTournamentData;
    d = {f1:Number(t.firstPrize)||0, f2:Number(t.secondPrize)||0, f3:Number(t.thirdPrize)||0, pk:Number(t.perKillPrize)||0};
  }

  /* AUTO-FILL TEAM rank */
  if(inp.classList.contains('rank-input') && r>0){
    var cap=row.dataset.captainuid||'', isT=row.dataset.isteam==='1', me=row.dataset.uid||'';
    document.querySelectorAll('#participantsList tr').forEach(function(or){
      if(or===row) return;
      var oc=or.dataset.captainuid||'', ou=or.dataset.uid||'';
      if((cap&&oc===cap)||(cap&&ou===cap)||(!isT&&oc===me)){var ri=or.querySelector('.rank-input');if(ri&&!Number(ri.value)){ri.value=r;window.calcPrize(ri);}}
    });
    /* Dup check */
    if(r>=1&&r<=3){
      var dup=false;
      document.querySelectorAll('#participantsList tr').forEach(function(or){
        if(or===row||or.dataset.isteam==='1') return;
        var ou2=or.dataset.uid||'',oc2=or.dataset.captainuid||'';
        if(ou2===cap||(cap&&oc2===cap)||(!isT&&oc2===me)) return;
        var ri2=or.querySelector('.rank-input'); if(ri2&&Number(ri2.value)===r) dup=true;
      });
      var pc=row.querySelector('.prize-cell');
      if(dup){pc.innerHTML='<span style="color:#ff4444;font-size:10px;font-weight:800">⚠️ Dup #'+r+'!</span>';row.style.background='rgba(255,0,0,.06)';return;}
      else row.style.background='';
    }
  }

  var rp=r===1?d.f1:r===2?d.f2:r===3?d.f3:0, kp=k*d.pk;
  var isTM=row.dataset.isteam==='1', ft=row.dataset.feetype||'each_pays';
  var tw=(isTM&&ft==='captain_pays')?0:(rp+kp);
  var cell=row.querySelector('.prize-cell');
  if(!cell) return;
  if(isTM&&ft==='captain_pays'){cell.style.color='#555';cell.innerHTML='<span style="font-size:9px;color:#555">→ Cap</span>';}
  else{cell.style.color=tw>0?'var(--primary)':'#aaa';var bd=(rp||kp)?'<br><span style="font-size:9px;color:#888">'+(rp?'R:₹'+rp:'')+(rp&&kp?'+':'')+(kp?k+'k×₹'+d.pk:'')+'</span>':'';cell.innerHTML='<span style="font-weight:800">₹'+tw+'</span>'+bd;}
  row.dataset.prize=tw; row.dataset.rank=r; row.dataset.kills=k;
};
window.adminCalcPrize = window.calcPrize;

/* ===== MATCH HISTORY — exact Match Result UI, published matches only ===== */
window._MHD = null; // current MH match data
window._MHR = {};   // existing results

window.loadMatchHistorySection = async function() {
  var sel = document.getElementById('mhMatchSelect');
  if(!sel || sel.options.length > 1) return; // already populated
  /* Use allTournaments if loaded, else fetch */
  var rtdb = window.rtdb||window.db;
  try {
    var snap = await rtdb.ref('matches').once('value');
    sel.innerHTML = '<option value="">-- Select Match --</option>';
    if(snap.exists()) snap.forEach(function(c){
      var d=c.val();
      if(d.status==='resultPublished'||d.resultPublished===true){
        var opt=document.createElement('option'); opt.value=c.key; opt.textContent=(d.name||c.key)+' ✅'; sel.appendChild(opt);
      }
    });
  } catch(e){}
};

window.loadMatchHistoryResult = async function() {
  var mid = (document.getElementById('mhMatchSelect')||{}).value;
  var container = document.getElementById('mhResultContainer');
  var tbody = document.getElementById('mhParticipantsList');
  var prizeInfo = document.getElementById('mhPrizeInfo');
  if(!mid){ if(container) container.style.display='none'; return; }
  if(container) container.style.display='block';
  if(tbody) tbody.innerHTML='<tr><td colspan="9" style="padding:16px;text-align:center;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading participants...</td></tr>';
  var rtdb = window.rtdb||window.db;
  try {
    var res = await Promise.all([
      rtdb.ref('matches/'+mid).once('value'),
      rtdb.ref('joinRequests').orderByChild('matchId').equalTo(mid).once('value'),
      rtdb.ref('results').orderByChild('matchId').equalTo(mid).once('value'),
      rtdb.ref('users').once('value')
    ]);
    var match = res[0].val()||{};
    var f1=Number(match.firstPrize)||0, f2=Number(match.secondPrize)||0, f3=Number(match.thirdPrize)||0, pk=Number(match.perKillPrize)||0;
    window._MHD = {mid:mid,f1:f1,f2:f2,f3:f3,pk:pk};
    /* Set data attrs on mh tbody */
    if(tbody){ tbody.dataset.f1=f1; tbody.dataset.f2=f2; tbody.dataset.f3=f3; tbody.dataset.pk=pk; }
    if(prizeInfo) prizeInfo.innerHTML='<i class="fas fa-calculator"></i> 🥇₹'+f1+' 🥈₹'+f2+' 🥉₹'+f3+(pk?' | 💀₹'+pk+'/Kill':'');
    /* Existing results */
    window._MHR = {};
    if(res[2].exists()) res[2].forEach(function(c){ var d=c.val(); if(d.userId) window._MHR[d.userId]={key:c.key,rank:d.rank||0,kills:d.kills||0,winnings:d.winnings||d.totalWinning||0,rankPrize:d.rankPrize||0,killPrize:d.killPrize||0}; });
    var usersMap={};
    if(res[3].exists()) res[3].forEach(function(c){ usersMap[c.key]=c.val(); });
    var html='', cnt=0;
    if(res[1].exists()) res[1].forEach(function(c){
      var j=c.val();
      /* Accept any status for published matches */
      if(!j || !j.userId) return;
      cnt++;
      var uid=j.userId;
      var u=usersMap[uid]||{};
      var nm=j.playerName||j.ign||j.userName||u.ign||'Unknown';
      var ff=j.ffUid||j.userFFUID||u.ffUid||'-';
      var slot=j.slotNumber||j.slot||'-';
      var mode=(j.mode||match.mode||'solo').toUpperCase();
      var entry=j.entryFee||match.entryFee||0;
      var ft=j.feeType||'solo', capUid=j.captainUid||'', isTM=j.isTeamMember?'1':'0';
      var er=window._MHR[uid]||{};
      var preR=er.rank||0, preK=er.kills||0;
      var preRp=preR===1?f1:preR===2?f2:preR===3?f3:0, preKp=preK*pk;
      var preTw=(isTM==='1'&&ft==='captain_pays')?0:(preRp+preKp);
      var prizeHtml;
      if(isTM==='1'&&ft==='captain_pays') prizeHtml='<span style="font-size:9px;color:#555">→ Cap</span>';
      else prizeHtml='<span style="font-weight:800;color:'+(preTw>0?'var(--primary)':'#aaa')+'">₹'+preTw+'</span>'+(preRp||preKp?'<br><span style="font-size:9px;color:#888">'+(preRp?'R:₹'+preRp:'')+(preRp&&preKp?'+':'')+(preKp?preK+'k×₹'+pk:'')+'</span>':'');
      var feeNote=(ft==='captain_pays'&&isTM==='1')?'<span style="font-size:9px;background:rgba(0,212,255,.12);color:#00d4ff;padding:1px 5px;border-radius:4px;margin-left:4px">Cap</span>':(ft==='each_pays'?'<span style="font-size:9px;background:rgba(0,255,156,.1);color:#00ff9c;padding:1px 5px;border-radius:4px;margin-left:4px">Self</span>':'');
      html+='<tr data-uid="'+uid+'" data-name="'+nm.toLowerCase()+'" data-feetype="'+ft+'" data-captainuid="'+capUid+'" data-isteam="'+isTM+'">';
      html+='<td style="color:#666;font-size:11px;padding:5px 4px">'+cnt+'</td>';
      html+='<td style="padding:5px 4px"><div style="font-size:12px;font-weight:700;color:'+(isTM==='1'?'#b9aaff':'var(--primary)')+'">'+nm+feeNote+'</div></td>';
      html+='<td style="padding:5px 4px;color:#00d4ff;font-family:monospace;font-size:10px">'+ff+'</td>';
      html+='<td style="padding:5px 4px;color:#aaa;font-size:11px">'+slot+'</td>';
      html+='<td style="padding:5px 4px;color:#aaa;font-size:10px;font-weight:700">'+mode+'</td>';
      html+='<td style="padding:5px 4px;color:#ffd700;font-size:11px">₹'+entry+'</td>';
      html+='<td style="padding:5px 4px;text-align:center"><input type="number" class="mh-rank" placeholder="0" min="0" value="'+preR+'" oninput="mhCalcPrize(this)" style="width:44px;padding:4px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);color:#ffd700;font-size:12px;text-align:center;font-weight:700"></td>';
      html+='<td style="padding:5px 4px;text-align:center"><input type="number" class="mh-kills" placeholder="0" min="0" value="'+preK+'" oninput="mhCalcPrize(this)" style="width:44px;padding:4px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);color:#ff6b6b;font-size:12px;text-align:center;font-weight:700"></td>';
      html+='<td class="mh-prize" style="padding:5px 4px;font-size:11px">'+prizeHtml+'</td>';
      html+='</tr>';
    });
    tbody.innerHTML = html||'<tr><td colspan="9" style="padding:16px;text-align:center;color:#aaa">No participants found — check joinRequests in Firebase</td></tr>';
  } catch(e) {
    if(tbody) tbody.innerHTML='<tr><td colspan="9" style="padding:16px;text-align:center;color:#f55">Error: '+e.message+'</td></tr>';
  }
};

window.mhCalcPrize = function(inp) {
  var row=inp.closest('tr');
  var k=Number((row.querySelector('.mh-kills')||{}).value)||0;
  var r=Number((row.querySelector('.mh-rank')||{}).value)||0;
  var d=window._MHD||{f1:0,f2:0,f3:0,pk:0};
  var rp=r===1?d.f1:r===2?d.f2:r===3?d.f3:0, kp=k*d.pk;
  var isTM=row.dataset.isteam==='1', ft=row.dataset.feetype||'solo';
  var tw=(isTM&&ft==='captain_pays')?0:(rp+kp);
  var cell=row.querySelector('.mh-prize');
  if(cell){ var bd=(rp||kp)?'<br><span style="font-size:9px;color:#888">'+(rp?'R:₹'+rp:'')+(rp&&kp?'+':'')+(kp?k+'k×₹'+d.pk:'')+'</span>':''; cell.innerHTML='<span style="font-weight:800;color:'+(tw>0?'var(--primary)':'#aaa')+'">₹'+tw+'</span>'+bd; }
};

window.mhFilterRows = function(s) {
  s=s.toLowerCase();
  document.querySelectorAll('#mhParticipantsList tr').forEach(function(r){ r.style.display=(r.dataset.name||'').indexOf(s)>=0?'':'none'; });
};

window.saveMhCorrections = async function() {
  /* ⛔ R7 SECURITY (2026-09-26, P0): Match History ka bulk "Save All" ab single
     authoritative server RPC `correct_match_result()` per player. Purana path
     Firebase `users/{uid}/realMoney/winnings` + `stats/earnings` + `transactions`
     client-side mutate karta tha = client financial authority + double ledger —
     JAISA KE single-player correction (openResultCorrection) kab ka server RPC
     par hata hai. Ab: client sirf {p_match_id, p_user_id, p_rank, p_kills}
     bhejta hai. Koi prize/currency NAHI. koi Firebase money-write NAHI.
     Server match_results/join_requests ka old-prize snapshot leke wallet delta +
     wallet_transactions + notifications + admin_actions sab EK txn me karta hai.
     (v22 ka duo/squad prize-split patch ab dead hai — server khud compute karta
     hai; old-prize baseline bhi server hi hota hai, yahan client ne jo dekha
     usse nahi.) */
  var d=window._MHD; if(!d){if(window.showToast)showToast('Match select karo pehle',true);return;}
  var rows=document.querySelectorAll('#mhParticipantsList tr[data-uid]');
  if(!rows.length) return;
  var btn=document.getElementById('mhSaveBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Saving...';}
  var mid=d.mid;
  var results=[];
  rows.forEach(function(row){
    var uid=row.dataset.uid;
    var rank=Number((row.querySelector('.mh-rank')||{}).value)||0;
    var kills=Number((row.querySelector('.mh-kills')||{}).value)||0;
    if(!uid) return;
    if(!rank && !kills) return; /* koi correction nahi */
    results.push({ p_match_id: mid, p_user_id: uid, p_rank: rank, p_kills: kills });
  });
  if(!results.length){ if(window.showToast)showToast('Koi correction nahi dali',true); if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-save"></i> Save All Corrections';} return; }

  try {
    var supa=window._supa;
    if(!supa){ throw new Error('Supabase not ready — correction nahi ho sakti'); }
    var okCount=0, failRows=[];
    /* sequential — har player ke liye server-side atomic + fail साफ़ दिखे */
    for(var k=0;k<results.length;k++){
      var pr=results[k];
      var r=await supa.rpc('correct_match_result', pr);
      if(r.error){ failRows.push(pr.p_user_id+' ('+(r.error.message||'RPC error')+')'); continue; }
      var dd=r.data||{};
      if(dd.ok===true || dd.success===true){ okCount++; }
      else { failRows.push(pr.p_user_id+' ('+(dd.error||'Server rejected')+')'); }
    }
    if(okCount && !failRows.length){
      if(window.showToast) showToast('✅ '+okCount+' players ke results server se correct ho gaye!');
    } else if(okCount && failRows.length) {
      if(window.showToast) showToast('⚠️ '+okCount+' corrected, '+failRows.length+' rejected — '+failRows.join(', '),true);
    } else {
      if(window.showToast) showToast('❌ Koi correction nahi hui — '+failRows.join(', '),true);
    }
    /* Firebase results-tree MIRROR (admin-supabase-sync listener) apne aap
       match_results se sync karega — client yahan sirf UI display update
       karne ke liye reload karta hai, koi money-write nahi. */
    window._MHR={};
    if(window.loadMatchHistoryResult) await loadMatchHistoryResult();
  } catch(e){ if(window.showToast) showToast('❌ Error: '+e.message,true); }
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-save"></i> Save All Corrections';}
};

/* ═══════════════════════════════════════════════════
   MISSING UTILITY FUNCTIONS — exportCSV, Roster, Activity Log
   ═══════════════════════════════════════════════════ */

function _downloadCSV(filename, rows) {
  var csv = rows.map(function(r){ return r.map(function(c){ return '"'+(c+'').replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

window.exportCSV = function(type) {
  if (type === 'users') {
    var cache = window.usersCache || {};
    var rows = [['Firebase UID','IGN','FF UID','Phone','Deposit','Winnings','Coins','Matches','Kills','Banned','Verified']];
    Object.keys(cache).forEach(function(uid){
      var u = cache[uid] || {}; var rm = u.realMoney||{}; var w = u.wallet||{}; var st = u.stats||{};
      rows.push([uid, u.ign||'', u.ffUid||'', u.phone||'',
        Number(rm.deposited||w.depositBalance||0), Number(rm.winnings||w.winningBalance||0),
        u.coins||0, st.matches||0, st.kills||0,
        (u.isBanned||u.blocked)?'Yes':'No', (u.profileStatus==='approved')?'Yes':'No']);
    });
    if (rows.length < 2) { showToast('Users load nahi hue. Pehle Users section mein jao.', true); return; }
    _downloadCSV('ff_users_'+new Date().toISOString().slice(0,10)+'.csv', rows);
    showToast('✅ ' + (rows.length-1) + ' users exported!');
  } else if (type === 'matches') {
    var matches = window.allTournaments || {};
    var rows2 = [['Match ID','Name','Mode','Entry Fee','Prize Pool','Max Slots','Filled','Status','Match Time']];
    Object.keys(matches).forEach(function(mid){
      var m = matches[mid] || {};
      rows2.push([mid, m.name||'', m.gameMode||m.mode||'', m.entryFee||0, m.prizePool||0,
        m.maxSlots||0, m.filledSlots||m.joinedSlots||0, m.status||'',
        m.matchTime ? new Date(m.matchTime).toLocaleString('en-IN') : '']);
    });
    if (rows2.length < 2) { showToast('Matches load nahi hue.', true); return; }
    _downloadCSV('ff_matches_'+new Date().toISOString().slice(0,10)+'.csv', rows2);
    showToast('✅ ' + (rows2.length-1) + ' matches exported!');
  }
};

window._rosterData = [];
;
window._toggleRosterStatus = async function(key,idx){
  var r=window._rosterData[idx];if(!r)return;
  var ns=r.status==='kicked'?'present':'kicked'; r.status=ns;
  try{
    /* ✅ Supabase join_requests.roster_status */
    if(window._supa) await window._supa.from('join_requests').update({roster_status:ns}).eq('id',key);
    else if(typeof rtdb!=='undefined') await rtdb.ref('joinRequests/'+key).update({rosterStatus:ns});
    window.loadRoster();showToast((ns==='kicked'?'🚫 Kicked: ':'✅ Restored: ')+r.ign);
  }catch(e){showToast('Error: '+e.message,true);}
};
;
window.clearRosterStatus = async function(){
  var rows=window._rosterData||[];if(!rows.length){showToast('Pehle match select karo',true);return;}
  if(!confirm('Sab players ki roster status clear karni hai?'))return;
  /* ✅ Supabase join_requests — safe fallback */
  if(window._supa){
    await Promise.all(rows.map(function(r){ return window._supa.from('join_requests').update({roster_status:'present'}).eq('id',r.key).then(null, function(){}); }));
  } else if(typeof rtdb!=='undefined'){
    await Promise.all(rows.map(function(r){return rtdb.ref('joinRequests/'+r.key).update({rosterStatus:'present'});}));
  }
  window._rosterData.forEach(function(r){r.status='present';});
  window.loadRoster();showToast('✅ All status cleared');
};

window._activityLogData = [];
window._activityLogFilter = 'all';
window.loadActivityLog = async function(){
  var el=document.getElementById('activityLogList');if(!el)return;
  el.innerHTML='<p class="text-muted text-xs" style="padding:20px;text-align:center"><i class="fas fa-spinner fa-spin"></i> Loading...</p>';
  try{
    var filter=window._activityLogFilter||'all';
    /* ✅ FIX: Supabase admin_activity_log + Firebase fallback (wrapped in try/catch) */
    window._activityLogData = [];
    try {
      if (window._supa) {
        var _actRes = await window._supa.from('admin_activity_log')
          .select('*').order('created_at',{ascending:false}).limit(100);
        (_actRes.data||[]).forEach(function(row) {
          window._activityLogData.push({
            _key:      row.id,
            type:      row.action_type || 'action',
            action:    row.note       || row.action_type || 'Activity',
            message:   row.note       || '',
            adminEmail:row.admin_uid  || 'admin',
            by:        row.admin_uid  || 'admin',
            timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now()
          });
        });
      }
      if (!window._activityLogData.length && typeof rtdb !== 'undefined') {
        var snap = await rtdb.ref('adminActivityLog').limitToLast(200).once('value');
        if (snap.exists()) snap.forEach(function(c){ window._activityLogData.unshift(Object.assign({_key:c.key},c.val())); });
      }
    } catch(e) { console.warn('[ActivityLog]', e.message); }
    var filtered=window._activityLogData.filter(function(log){return filter==='all'||(log.type||'').toLowerCase().includes(filter);});
    if(!filtered.length){el.innerHTML='<p class="text-muted text-xs" style="padding:20px;text-align:center">No activity logs found</p>';return;}
    var html='<div style="display:flex;flex-direction:column;gap:4px;padding:8px">';
    filtered.slice(0,100).forEach(function(log){
      var tc=log.type==='ban'?'#ff4444':log.type==='wallet'||log.type==='credit'||log.type==='debit'?'#ffd700':log.type==='result'?'#00ff9c':'#00d4ff';
      html+='<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;border:1px solid rgba(255,255,255,.06)">';
      html+='<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(0,0,0,.3);color:'+tc+';white-space:nowrap">'+(log.type||'action').toUpperCase()+'</span>';
      html+='<div style="flex:1"><div style="font-size:12px;font-weight:600">'+(log.action||log.message||'Activity')+'</div>';
      html+='<div style="font-size:10px;color:#aaa">'+(log.adminEmail||log.by||'admin')+' · '+new Date(log.timestamp||0).toLocaleString('en-IN')+'</div></div></div>';
    });
    html+='</div>';el.innerHTML=html;
  }catch(e){el.innerHTML='<p style="color:#ff4444;padding:12px">Error: '+e.message+'</p>';}
};
;
;

/* ════ SKY DIAMOND REQUESTS ════ */
window.showSkyDiamondRequests = function() {
  var modal = document.getElementById('adminGenericModal');
  var body  = document.getElementById('adminGenericModalBody');
  if (!modal || !body) return;
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#888"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  modal.style.display = 'flex';
  /* ✅ Supabase sd_requests (Firebase skyDiamondRequests was old path) */
  if (!window._supa) { body.innerHTML = '<div style="color:#ff4444;padding:20px">Supabase not ready</div>'; return; }
  window._supa.from('sd_requests').select('*').eq('status','pending')
    .order('created_at',{ascending:false}).limit(50)
    .then(function(res) {
      var rows = res.data || [];
      if (!rows.length) { body.innerHTML = '<div style="text-align:center;padding:30px;color:#888">No pending Sky Diamond requests</div>'; return; }
      var h = '<div style="padding:4px">';
      rows.forEach(function(r) {
        var id = r.id;
        h += '<div style="background:#1a1a2e;border:1px solid rgba(0,212,255,.2);border-radius:12px;padding:14px;margin-bottom:10px">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
        h += '<div><div style="font-weight:800;color:#fff">' + (r.ign||r.user_id||'User') + '</div>';
        h += '<div style="font-size:11px;color:#888">' + new Date(r.created_at).toLocaleString('en-IN') + '</div>';
        if (r.upi_ref) h += '<div style="font-size:11px;color:#aaa">UPI: ' + r.upi_ref + '</div>';
        h += '</div>';
        h += '<div style="font-size:20px;font-weight:900;color:#00d4ff">💎 ' + r.sd_amount + '</div></div>';
        h += '<div style="font-size:12px;color:#aaa;margin-bottom:8px">₹' + r.amount_inr + ' payment claimed</div>';
        if (r.screenshot_url) h += '<a href="' + r.screenshot_url + '" target="_blank" style="display:block;margin-bottom:10px;font-size:11px;color:#00d4ff">📸 Screenshot dekho</a>';
        h += '<div style="display:flex;gap:8px">';
        h += '<button onclick="approveSkyDiamond(\x27' + id + '\x27,\x27' + r.user_id + '\x27,' + r.sd_amount + ')" style="flex:1;padding:8px;border-radius:8px;background:rgba(0,212,255,.15);border:1px solid rgba(0,212,255,.3);color:#00d4ff;font-weight:700;cursor:pointer">✅ Approve</button>';
        h += '<button onclick="rejectSkyDiamond(\x27' + id + '\x27)" style="flex:1;padding:8px;border-radius:8px;background:rgba(255,50,50,.1);border:1px solid rgba(255,50,50,.2);color:#ff5555;font-weight:700;cursor:pointer">❌ Reject</button>';
        h += '</div></div>';
      });
      h += '</div>';
      body.innerHTML = h;
    }).catch(function(e) {
      body.innerHTML = '<div style="color:#ff4444;padding:20px">Error: ' + (e.message||'Load failed') + '</div>';
    });
};
window.approveSkyDiamond = async function(reqId, uid, amount) {
  /* ⛔ R7 FOLLOW-UP (2026-09-25): legacy Firebase-only SD approve (Sky
     Diamonds direct client-side credit + Firebase skyDiamondRequests) ab
     authoritative `resolve_sd_request` RPC par route karta hai — server
     apni taraf se sd_requests FOR UPDATE lock, wallet credit + ledger
     (wallet_transactions reason='sd_purchase_approved') + notifications
     karta hai. Client balance NAHI likhta. */
  if (!uid || !amount) return;
  var supa = window._supa;
  if (supa) {
    var supaId = await window._resolveSdRequestId(reqId);
    if (!supaId) { showToast('❌ Could not find matching Supabase request', true); return; }
    var res = await supa.rpc('resolve_sd_request', { p_request_id: supaId, p_action: 'approve' });
    if (res.error || (res.data && res.data.ok === false)) {
      var msg = res.error ? res.error.message : (res.data && res.data.error);
      showToast('❌ Approve failed: ' + msg, true);
      showSkyDiamondRequests();
      return;
    }
  } else {
    showToast('❌ Supabase not ready — paisa credit nahi hua', true);
    return;
  }
  /* Mirror-only notification (Supabase resolve_sd_request already credited
     balance + ledger; Firebase skyDiamondRequests now legacy mirror) */
  try {
    rtdb.ref('skyDiamondRequests/' + reqId).update({ status:'approved', approvedAt: Date.now() }).catch(function(){});
  } catch(e) {}
  showToast('✅ ' + amount + ' Sky Diamonds credited (server ledger)!');
  showSkyDiamondRequests();
};
window.rejectSkyDiamond = async function(reqId) {
  /* ✅ BUG FIX (2026-07-17): same fix as rejectSkyDiaReq below — this
     duplicate has no live callers currently (confirmed dead code), but
     fixed anyway so it doesn't reintroduce the Firebase-only, no-refund
     bug if it's ever wired up later. */
  var supa = window._supa;
  if (supa) {
    /* ✅ FIX (2026-08-17): resolve Firebase key or UUID → real UUID */
    var supaId = await window._resolveSdRequestId(reqId);
    if (!supaId) {
      showToast('❌ Could not find matching Supabase request', true);
      return;
    }
    var res = await supa.rpc('resolve_sd_request', { p_request_id: supaId, p_action: 'reject' });
    if (res.error || (res.data && res.data.ok === false)) {
      var msg = res.error ? res.error.message : (res.data && res.data.error);
      showToast('❌ Reject failed: ' + msg, true);
      return;
    }
  }
  rtdb.ref('skyDiamondRequests/' + reqId).update({ status:'rejected', rejectedAt: Date.now() }).catch(function(){});
  showToast('Request rejected.');
  showSkyDiamondRequests();
};

/* ════ PREMIUM REQUESTS ════ */
window.showPremiumRequests = function() {
  var modal = document.getElementById('adminGenericModal');
  var body  = document.getElementById('adminGenericModalBody');
  if (!modal || !body) return;
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#888">Loading...</div>';
  modal.style.display = 'flex';
  rtdb.ref('premiumRequests').orderByChild('status').equalTo('pending').once('value', function(s) {
    if (!s.exists()) { body.innerHTML = '<div style="text-align:center;padding:30px;color:#888">No pending Premium requests</div>'; return; }
    var h = '<div style="padding:4px">';
    s.forEach(function(c) {
      var r = c.val(); var id = c.key;
      h += '<div style="background:#1a1a2e;border:1px solid rgba(255,215,0,.2);border-radius:12px;padding:14px;margin-bottom:10px">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      h += '<div><div style="font-weight:800;color:#fff">' + (r.ign||r.uid||'User') + '</div><div style="font-size:11px;color:#888">' + new Date(r.createdAt).toLocaleString('en-IN') + '</div></div>';
      h += '<div style="text-align:right"><div style="font-size:14px;font-weight:900;color:#ffd700">👑 ' + r.tierName + '</div><div style="font-size:11px;color:#aaa">₹' + r.price + '/mo</div></div></div>';
      h += '<button onclick="approvePremium(\'' + id + '\',\'' + r.uid + '\',\'' + r.tierId + '\',' + r.gdBonus + ')" style="width:100%;padding:9px;border-radius:8px;background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.3);color:#ffd700;font-weight:700;cursor:pointer">✅ Approve (30 days)</button>';
      h += '</div>';
    });
    h += '</div>';
    body.innerHTML = h;
  });
};
window.approvePremium = async function(reqId, uid, tierId, gdBonus) {
  /* ⛔ R7 FOLLOW-UP (2026-09-25): legacy Firebase-only premium approve
     (premiumTier/premiumExpires client write + GD bonus client credit) ab
     authoritative `approve_premium` RPC par route karta hai. Server premium
     level/expiry + (bundle) Battle Pass atomic grant karta hai; R29E model:
     GD bonus approve par NAHI (monthly Coins claim server-side hai). */
  if (!uid) return;
  var supa = window._supa;
  if (supa) {
    var r = await supa.rpc('approve_premium', { p_uid: uid, p_tier: Number(tierId)||1, p_days: 30, p_grant_bp: false });
    if (r.error || (r.data && r.data.success === false)) {
      var msg = (r.data && r.data.error) || (r.error && r.error.message) || 'Unknown error';
      showToast('❌ ' + msg, true);
      return;
    }
  } else {
    showToast('❌ Supabase not ready — premium activate nahi hua', true);
    return;
  }
  try {
    rtdb.ref('premiumRequests/' + reqId).update({ status:'approved', approvedAt: Date.now() }).catch(function(){});
  } catch(e) {}
  showToast('✅ Premium activated for 30 days (server authoritative)!');
  showPremiumRequests();
};


/* ══════════════════════════════════════════════════════
   NEW SECTION LOADERS — Sky Diamond + Premium Requests
   ══════════════════════════════════════════════════════ */

/* ✅ BUG FIX (2026-08-22): Sky Diamond approve/reject buttons had no
   double-click / double-tap guard. resolve_sd_request() correctly locks
   the row (FOR UPDATE) and rejects a second call with "Request already
   resolved", but the SECOND click's request had already left the
   browser by the time the first one's response came back and re-rendered
   the list — a fast double-tap (very easy on a touchscreen "Approve"
   button) fired both. This disables the exact button immediately on
   the first click so a second tap can't even reach the network. */
window._guardedApprove = function(btn, reqId, uid, diamonds) {
  if (btn.disabled) return;
  document.querySelectorAll('[data-req-id="'+reqId+'"]').forEach(function(b){ b.disabled = true; b.style.opacity = '0.5'; b.style.pointerEvents = 'none'; });
  window.approveSkyDiaReq(reqId, uid, diamonds, true);
};
window._guardedReject = function(btn, reqId) {
  if (btn.disabled) return;
  document.querySelectorAll('[data-req-id="'+reqId+'"]').forEach(function(b){ b.disabled = true; b.style.opacity = '0.5'; b.style.pointerEvents = 'none'; });
  window.rejectSkyDiaReq(reqId, true);
};

window.loadSkyDiamondReqSection = async function() {
  var list = document.getElementById('skyDiaReqList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#888"><div class="spinner" style="margin:0 auto 10px"></div>Loading...</div>';
  try {
    /* ✅ FIX (2026-08-17): This used to read Firebase walletRequests/
       skyDiamondRequests nodes, which quick-deposit.js never actually
       wrote UTR/UPI or screenshot_url into (see quick-deposit.js fix) —
       so this table always showed "No photo" and had no UTR/UPI column
       at all, even after a user uploaded proof. sd_requests in Supabase
       is now the real source of truth for this data (screenshot_url,
       upi_ref columns), so read from there instead.
       ✅ FIX (2026-08-19): also now includes request_type =
       'green_diamond_withdrawal' rows, not just 'sky_diamond_purchase'.
       These are a genuinely separate, currently-live flow (confirmed in
       user/js/diamond-system.js — a user withdrawing Green Diamonds
       writes directly to this same sd_requests table with that
       request_type) that had ZERO admin UI to view/approve them once
       the old Wallet Requests tab's Firebase-only 'withdraw' rows were
       retired (nothing writes to that legacy Firebase path anymore —
       diamond-system.js writes straight to Supabase). Both types share
       the same resolve_sd_request RPC and already-correct approve/
       reject handling below, which branches on request_type server-side
       — only the display needed updating to show both, clearly
       distinguished by a Type column, instead of silently having no UI
       for withdrawals at all. */
    var supa = window._supa;
    if (!supa) { list.innerHTML = '<div style="text-align:center;padding:20px;color:#f66">Supabase not connected</div>'; return; }
    var res = await supa.from('sd_requests')
      .select('id, user_id, ign, sd_amount, amount_inr, screenshot_url, upi_ref, status, created_at, request_type')
      .in('request_type', ['sky_diamond_purchase', 'green_diamond_withdrawal'])
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (res.error) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:#f66">Error: ' + res.error.message + '</div>';
      return;
    }
    var rows = (res.data || []).map(function(r) { return { id: r.id, data: r }; });
    document.getElementById('skyDiaCount').textContent = rows.length;
    var bd = document.getElementById('skyDiaBadge');
    if (bd) { bd.textContent = rows.length; bd.style.display = rows.length ? 'flex' : 'none'; }
    if (!rows.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#666"><i class="fas fa-gem" style="font-size:32px;margin-bottom:10px;display:block;color:#00d4ff33"></i>No pending Sky Diamond requests</div>';
      return;
    }
    var h = '<div class="table-wrapper"><table><thead><tr><th>User</th><th>FF UID</th><th>Type</th><th>Diamonds</th><th>Amount</th><th>UTR / UPI</th><th>Screenshot</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(item) {
      var r = item.data; var id = item.id;
      var isWithdrawal = r.request_type === 'green_diamond_withdrawal';
      var uid = r.user_id || '';
      var ign = r.ign || uid.substring(0,8) || '—';
      /* ✅ FIX (2026-08-19): Wallet Requests tab (now removed — see
         admin-inline.js's setupWalletListener removal comment) had an
         FF UID column that this dedicated section never had, since
         sd_requests itself has no ff_uid column. Sourced the same way
         the removed tab did: from the live usersCache (populated by
         setupUsersListener at boot), keyed by user_id. */
      var ffUid = (window.usersCache && window.usersCache[uid] && window.usersCache[uid].ffUid) || '—';
      var diamonds = r.sd_amount || 0;
      var price = r.amount_inr || 0;
      var utr = r.upi_ref || '<span class="text-muted text-xxs">—</span>';
      var ss = r.screenshot_url || '';
      var ssHtml = ss ? '<img src="'+ss+'" style="width:40px;height:40px;border-radius:6px;cursor:pointer;object-fit:cover;border:1px solid rgba(0,212,255,.3)" onclick="viewScreenshot(this.src)">' : '<span class="text-muted text-xxs">' + (isWithdrawal ? 'N/A (payout)' : 'No photo') + '</span>';
      var status = r.status || 'pending';
      var statusColor = status==='approved'?'#00ff9c':status==='rejected'?'#ff5555':'#ffd700';
      var time = r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '—';
      var typeBadge = isWithdrawal
        ? '<span style="padding:2px 8px;border-radius:7px;background:rgba(255,100,100,.12);border:1px solid rgba(255,100,100,.3);color:#ff6464;font-size:10px;font-weight:800">💸 Withdraw</span>'
        : '<span style="padding:2px 8px;border-radius:7px;background:rgba(0,255,156,.12);border:1px solid rgba(0,255,156,.3);color:#00ff9c;font-size:10px;font-weight:800">🛒 Purchase</span>';
      h += '<tr>';
      h += '<td><span style="font-weight:700;color:var(--primary)">' + ign + '</span><div style="font-size:9px;color:#666;font-family:monospace">' + uid.substring(0,10) + '</div></td>';
      h += '<td><span style="font-family:monospace;font-size:10px;color:var(--info);background:rgba(0,212,255,.08);padding:2px 6px;border-radius:5px">' + ffUid + '</span></td>';
      h += '<td>' + typeBadge + '</td>';
      h += '<td><span style="font-size:15px;font-weight:900;color:#00d4ff">💎 ' + diamonds + '</span></td>';
      h += '<td><span style="font-weight:700;color:#00ff9c">₹' + price + (isWithdrawal ? ' <span style="font-size:9px;color:#888;font-weight:400">(payout)</span>' : '') + '</span></td>';
      h += '<td><span style="font-family:monospace;font-size:10px;color:#ccc">' + utr + (isWithdrawal ? ' <span style="font-size:9px;color:#888">(payout UPI)</span>' : '') + '</span></td>';
      h += '<td>' + ssHtml + '</td>';
      h += '<td><span style="color:' + statusColor + ';font-weight:700;font-size:10px;text-transform:uppercase">' + status + '</span></td>';
      h += '<td style="font-size:11px;color:#666">' + time + '</td>';
      h += '<td>';
      /* ✅ Note (2026-08-17): id here is already the real sd_requests.id
         (Supabase UUID), since this table now reads directly from
         Supabase — approveSkyDiaReq/rejectSkyDiaReq below are tolerant of
         receiving either a UUID or a legacy Firebase key. Both purchase
         and withdrawal rows route through the same resolve_sd_request
         RPC, which already correctly branches on request_type — only
         the withdrawal case involves a real-money UPI payout the admin
         must actually send before approving (same as the Sponsored
         Prizes payout flow), so the button label reflects that. */
      if (isWithdrawal) {
        h += '<button class="btn btn-primary btn-xs" data-req-id="' + id + '" onclick="_guardedApprove(this,\'' + id + '\',\'' + uid + '\',' + diamonds + ')"><i class="fas fa-money-bill-wave"></i> Paid, Approve</button> ';
      } else {
        h += '<button class="btn btn-primary btn-xs" data-req-id="' + id + '" onclick="_guardedApprove(this,\'' + id + '\',\'' + uid + '\',' + diamonds + ')"><i class="fas fa-check"></i> Approve</button> ';
      }
      h += '<button class="btn btn-danger btn-xs" data-req-id="' + id + '" onclick="_guardedReject(this,\'' + id + '\')"><i class="fas fa-times"></i></button>';
      h += '</td></tr>';
    });
    h += '</tbody></table></div>';
    list.innerHTML = h;
  } catch(e) {
    list.innerHTML = '<div style="color:var(--danger);padding:16px">Error: ' + e.message + '</div>';
  }
};

window.approveSkyDiaReq = async function(reqId, uid, diamonds, isSkyNode, requestType) {
  if (!uid || !diamonds) return showToast('Invalid data', true);
  try {
    /* BUG #26 FIX (2026-07): same triple-credit root cause as approveAddMoney —
       both writes below mapped to the same sky_diamonds column via the bridge,
       and admin-supabase-sync.js's _wrapApproveSkyDia() adds a THIRD credit via
       increment_balance() on top. The credit now happens exactly once, via that
       wrapper. See approveAddMoney's comment above for the full explanation. */
    /* ✅ FIX (2026-08-19): requestType (passed by the wrapper, from the
       RPC's own authoritative response) now distinguishes a diamond
       PURCHASE (diamonds credited to the user) from a diamond
       WITHDRAWAL (real money already paid out via UPI by the admin
       before clicking approve) — these need opposite-meaning
       notifications and transaction-log entries; previously this always
       said "Sky Diamonds Added!" even for a withdrawal approval, which
       is backwards. */
    /* ✅ BUG FIX (2026-08-23, CRITICAL): "User ne SD purchase approve
       hote hi Entry Fee 260 diamond ki fake transaction history entry
       dekhi — na koi match join kiya, na diamonds kam hue". Root cause:
       resolve_sd_request (the RPC _wrapApproveSkyDia already calls
       before this function even runs) ALREADY inserts the correct
       wallet_transactions row itself — txn_type:'credit',
       reason:'sd_purchase_approved' (same for the withdrawal-reject-
       refund case: reason:'withdrawal_rejected_refund'). The two
       rtdb.ref('users/{uid}/transactions').push({type:'sky_diamond_
       credit',...}) / push({type:'green_diamond_withdrawal_paid',...})
       calls below were a SECOND, fully redundant write of the same
       event through the old Firebase-bridge path. Worse than just
       duplicated: walletTxnToSupa() maps d.type straight to txn_type
       with no translation, so 'sky_diamond_credit' landed as a literal
       txn_type value the User Panel's _loadTransactions() doesn't
       recognize as a credit (its allow-list only knows the word
       'credit', not 'sky_diamond_credit') — everything unrecognized
       defaults to 'debit' and gets its amount NEGATED, then
       wallet.js's typeMap renders any 'debit' row as "🎮 Entry Fee".
       That's the exact fake entry reported. Removed both redundant
       pushes; the notification pushes (real, still-needed UI alerts,
       not money-affecting) are kept. */
    var isWithdrawal = requestType === 'green_diamond_withdrawal';
    // Update request status
    var node = isSkyNode ? 'skyDiamondRequests' : 'walletRequests';
    await rtdb.ref(node + '/' + reqId).update({ status: 'approved', approvedAt: Date.now(), approvedBy: _adminUid() });
    // Send notification
    if (isWithdrawal) {
      await rtdb.ref('users/' + uid + '/notifications').push({
        title: '💰 Withdrawal Paid Out!',
        message: '💰 Aapki ' + diamonds + ' Green Diamonds ki withdrawal request approve ho gayi — payment UPI par bhej diya gaya hai.',
        type: 'wallet_approved', read: false, timestamp: Date.now()
      });
      showToast('✅ 💰 Withdrawal of ' + diamonds + ' Green Diamonds marked paid!');
    } else {
      await rtdb.ref('users/' + uid + '/notifications').push({
        title: '💎 Sky Diamonds Added!',
        message: '💎 ' + diamonds + ' Sky Diamonds aapke wallet mein add ho gaye! Ab paid matches join kar sakte ho.',
        type: 'wallet_approved', read: false, timestamp: Date.now()
      });
      showToast('✅ 💎 ' + diamonds + ' Sky Diamonds credited!');
    }
    loadSkyDiamondReqSection();
  } catch(e) { showToast('Error: ' + e.message, true); }
};

window.rejectSkyDiaReq = async function(reqId, isSkyNode) {
  /* ✅ BUG FIX (2026-07-17, CRITICAL): this was Firebase-RTDB-only — a
     plain status flag flip with zero Supabase sync and zero refund logic
     of any kind. For request_type='green_diamond_withdrawal' (routed
     through this same function via isSkyNode=false), that meant a
     rejected withdrawal NEVER refunded the user's already-deducted
     green_diamonds, in any code path, ever — this was the direct,
     confirmed mechanism behind that finding. resolve_sd_request handles
     both request types correctly: refunds on a rejected withdrawal,
     no balance change on a rejected purchase (which never took money from
     the user's in-app balance to begin with). */
  var supa = window._supa;
  if (supa) {
    /* ✅ FIX (2026-08-17): reqId can be either the Firebase key or (from
       the now-Supabase-backed Sky Diamond table) an already-real UUID —
       _resolveSdRequestId handles both. */
    var supaId = await window._resolveSdRequestId(reqId);
    if (!supaId) {
      showToast('❌ Could not find matching Supabase request', true);
      return;
    }
    var res = await supa.rpc('resolve_sd_request', { p_request_id: supaId, p_action: 'reject' });
    if (res.error || (res.data && res.data.ok === false)) {
      var msg = res.error ? res.error.message : (res.data && res.data.error);
      showToast('❌ Reject failed: ' + msg, true);
      return;
    }
  } else {
    console.error('[rejectSkyDiaReq] window._supa not available — cannot reject via RPC, refusing to silently fall back to the broken Firebase-only path');
    showToast('❌ Supabase not connected — reject cancelled', true);
    return;
  }
  /* Keep Firebase in sync too, for anything still reading the old node. */
  var node = isSkyNode ? 'skyDiamondRequests' : 'walletRequests';
  await rtdb.ref(node + '/' + reqId).update({ status: 'rejected', rejectedAt: Date.now() }).catch(function(){});
  showToast('Request rejected.');
  loadSkyDiamondReqSection();
};

window.loadPremiumReqSection = async function() {
  var list = document.getElementById('premiumReqList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#888"><div class="spinner" style="margin:0 auto 10px"></div>Loading...</div>';
  try {
    var snap = await rtdb.ref('premiumRequests').orderByChild('status').equalTo('pending').once('value');
    var rows = [];
    if (snap.exists()) snap.forEach(function(c){ rows.push({ id: c.key, data: c.val() }); });
    document.getElementById('premiumReqCount').textContent = rows.length;
    var bd = document.getElementById('premiumBadge');
    if (bd) { bd.textContent = rows.length; bd.style.display = rows.length ? 'flex' : 'none'; }
    if (!rows.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#666"><i class="fas fa-crown" style="font-size:32px;margin-bottom:10px;display:block;color:#ffd70033"></i>No pending Premium requests</div>';
      return;
    }
    var tierColors = { '1': '#ffd700', '2': '#00d4ff', '3': '#b964ff' };
    var tierNames  = { '1': 'Tier 1 — ₹49', '2': 'Tier 2 — ₹99', '3': 'Tier 3 — ₹199' };
    var h = '<div class="table-wrapper"><table><thead><tr><th>User</th><th>FF UID</th><th>Plan</th><th>Price</th><th>Screenshot</th><th>Requested</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(item) {
      var r = item.data; var id = item.id;
      var uid = r.uid || '';
      var ign = r.userName || r.ign || uid.substring(0,8) || '—';
      /* ✅ FIX (2026-08-19): Wallet Requests tab (now removed) had an FF
         UID column this dedicated section never had — sourced the same
         way, from the live usersCache (populated at boot). */
      var ffUid = (window.usersCache && window.usersCache[uid] && window.usersCache[uid].ffUid) || '—';
      var tier = String(r.tier || r.tierId || '1');
      var price = r.price || 49;
      var col = tierColors[tier] || '#ffd700';
      var ss = r.screenshotBase64 || '';
      var planType = r.planType || r.plan_type || 'monthly';
      var bundleId = r.bundleId || r.bundle_id || null;
      var ssHtml = ss ? '<img src="'+ss+'" style="width:40px;height:40px;border-radius:6px;cursor:pointer;object-fit:cover;border:1px solid rgba(255,215,0,.3)" onclick="viewScreenshot(this.src)">' : '<span class="text-muted text-xxs">No photo</span>';
      var time = r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '—';
      h += '<tr>';
      h += '<td><span style="font-weight:700;color:var(--primary)">' + ign + '</span><div style="font-size:9px;color:#666;font-family:monospace">' + uid.substring(0,10) + '</div></td>';
      h += '<td><span style="font-family:monospace;font-size:10px;color:var(--info);background:rgba(0,212,255,.08);padding:2px 6px;border-radius:5px">' + ffUid + '</span></td>';
      h += '<td><span style="padding:3px 10px;border-radius:8px;background:' + col + '22;border:1px solid ' + col + '55;color:' + col + ';font-weight:800;font-size:12px">👑 Premium ' + (tierNames[tier] || 'Tier '+tier) + '</span>' +
           (planType === 'bundle' ? '<div style="margin-top:4px;font-size:10px;font-weight:700;color:#b964ff">🎫 + Battle Pass bundle</div>' : '') +
           (planType === 'annual' ? '<div style="margin-top:4px;font-size:10px;font-weight:700;color:#00ff9c">📅 Annual plan</div>' : '') + '</td>';
      h += '<td><span style="font-weight:700;color:#00ff9c">₹' + price + '</span></td>';
      h += '<td>' + ssHtml + '</td>';
      h += '<td style="font-size:11px;color:#666">' + time + '</td>';
      h += '<td><button class="btn btn-primary btn-xs" style="background:linear-gradient(135deg,' + col + ',#ff8c00);border:none;color:#000" onclick="approvePremiumReq(\'' + id + '\',\'' + uid + '\',' + tier + (planType === 'bundle' ? ',true' : ',false') + ')"><i class="fas fa-crown"></i> Approve 30d</button> <button class="btn btn-danger btn-xs" onclick="rejectPremiumReq(\'' + id + '\')"><i class="fas fa-times"></i></button></td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    list.innerHTML = h;
  } catch(e) {
    list.innerHTML = '<div style="color:var(--danger);padding:16px">Error: ' + e.message + '</div>';
  }
};

window.approvePremiumReq = async function(reqId, uid, tier, grantBp) {
  if (!uid) return;
  try {
    var tierNames  = { 1: 'Silver', 2: 'Gold', 3: 'Diamond' };
    /* R29E P0-FIX (2026-09-22): approve ke waqt Green Diamonds credit
       (5/15/35) NAHI karna — user-facing premium model ab COINS bonus
       hai {50/150/400}/mahina, jo server-authoritative
       claim_premium_monthly_bonus() se claim hota hai. Purana GD-credit
       = old-model double-bonus leakage (GD + monthly coins dono). */
    /* BUG #4/#5/#29 FIX (2026-07): the old multi-key rtdb.ref(...).update({...}) call was
       silently dropped entirely by the Supabase bridge's converter (didn't recognize any of
       these slash-keys or camelCase field names), AND separately mapped to columns
       (premium_tier, premium_expires_at) that don't exist in the schema — premium never
       actually activated for anyone, ever, regardless of how many times admin approved a
       request. Also, premium_level/premium_expires are now locked from direct client writes
       (Category A security fix), so this must go through an admin-checked RPC regardless. */
    var r = await window._supa.rpc('approve_premium', { p_uid: uid, p_tier: tier, p_days: 30, p_grant_bp: (grantBp === true) });
    if (r.error || (r.data && r.data.success === false)) {
      var msg = (r.data && r.data.error) || (r.error && r.error.message) || 'Unknown error';
      showToast('❌ ' + msg, true);
      return;
    }
    /* R29E: GD credit removed — bonus ab sirf monthly Coins claim hai
       (claim_premium_monthly_bonus, server-authoritative, user panel se
       har mahine claim hota hai). Bundle ke liye Battle Pass bhi
       approve_premium RPC ke andar ATOMIC grant hua hai (battlePass flag
       response me). */
    await rtdb.ref('premiumRequests/' + reqId).update({ status: 'approved', approvedAt: Date.now(), approvedBy: auth.currentUser ? _adminUid() : 'admin' });
    await rtdb.ref('users/' + uid + '/notifications').push({
      title: '👑 Premium ' + (tierNames[tier]||('Tier '+tier)) + ' Activated!',
      message: 'Premium ' + (tierNames[tier]||'Tier '+tier) + ' 30 din ke liye activate ho gaya! Monthly Coins bonus ab Premium screen se claim kar sakte ho.' + (grantBp ? ' Battle Pass bhi unlock ho gaya!' : ''),
      type: 'premium_activated', read: false, timestamp: Date.now(), createdAt: Date.now()
    });
    showToast('✅ Premium ' + (tierNames[tier]||('Tier '+tier)) + ' activated!' + (grantBp ? ' + Battle Pass unlocked!' : '') + ' Monthly Coins bonus claim-ready.');
    loadPremiumReqSection();
  } catch(e) { showToast('Error: ' + e.message, true); }
};

window.rejectPremiumReq = async function(reqId) {
  await rtdb.ref('premiumRequests/' + reqId).update({ status: 'rejected', rejectedAt: Date.now() });
  showToast('Request rejected.');
  loadPremiumReqSection();
};

/* ══ SEASON PASS APPROVAL ══ */
window.approveSeasonPass = async function(reqId, uid, season) {
  if (!uid) return;
  try {
    await rtdb.ref('battlePass/' + season + '/' + uid + '/hasPremium').set(true);
    await rtdb.ref('seasonPassRequests/' + reqId).update({ status: 'approved', approvedAt: Date.now() });
    await rtdb.ref('users/' + uid + '/notifications').push({
      title: '🎫 Season Pass Activated!',
      message: 'Season Pass activate ho gaya! Saare 50 tiers ke premium rewards unlock ho gaye.',
      type: 'seasonpass_activated', read: false, timestamp: Date.now(), createdAt: Date.now()
    });
    showToast('✅ Season Pass approved!');
    loadSeasonPassSection();
  } catch(e) { showToast('Error: ' + e.message, true); }
};

window.rejectSeasonPass = async function(reqId) {
  await rtdb.ref('seasonPassRequests/' + reqId).update({ status: 'rejected', rejectedAt: Date.now() });
  showToast('Season Pass request rejected.');
  loadSeasonPassSection();
};

window.loadSeasonPassSection = async function() {
  var el = document.getElementById('section-seasonPass');
  if (!el) return;
  /* ✅ R29F (2026-09-22): Season Manager card — mahina khatam hone par
     admin one-click se naya season roll karta hai (admin_roll_battle_pass_season
     RPC: purane season ko inactive + naya season_key 'YYYY_MM' + SAME tiers
     shape jisme freeCos/premCos + freeGd/premGd). Pehle ye fully manual tha
     (SQL seed) — bhoolne par users ki BP screen naye season par "Season not
     found" maarti thi. */
  var _mg = '<div style="background:linear-gradient(135deg,rgba(185,100,255,.08),rgba(255,215,0,.05));border:1.5px solid rgba(185,100,255,.35);border-radius:14px;padding:14px;margin-bottom:16px">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:16px">📅</span><span style="font-size:13px;font-weight:800;color:#b964ff">Season Manager</span></div>'
    + '<div id="bpSeasonInfo" style="font-size:11px;color:#aaa;margin-bottom:10px">Loading…</div>'
    + '<button id="bpRollBtn" onclick="window.rollBattlePassSeason()" style="padding:10px 16px;border-radius:11px;border:none;background:linear-gradient(135deg,#b964ff,#7b2ff7);color:#fff;font-size:12px;font-weight:800;cursor:pointer">🔄 Naya Month Season Roll Karo</button>'
    + '</div>';
  el.innerHTML = '<div class="section-title"><i class="fas fa-ticket-alt" style="color:#b964ff"></i> Season Pass Requests <span class="count" id="spCount">0</span></div>' + _mg + '<div id="spReqList"><div class="empty-state">Loading...</div></div>';
  /* season info + roll button ka उपलब्ध-state refresh */
  if (window._supa) {
    window._supa.from('battle_passes').select('season_key,season_num,name,is_active,start_date,end_date')
      .order('start_date', { ascending: false }).limit(3)
      .then(function(r) {
        var rows = (r && r.data) || [];
        var infoEl = document.getElementById('bpSeasonInfo');
        var btnEl = document.getElementById('bpRollBtn');
        if (!infoEl) return;
        var active = null, nextKey = null;
        rows.forEach(function(s) { if (s.is_active && !active) active = s; });
        if (rows.length) nextKey = rows[0].season_key;
        if (active) {
          var _sd = new Date(parseInt(active.season_key.slice(0,4),10), parseInt(active.season_key.slice(5,7),10)-1, 1);
          _sd.setMonth(_sd.getMonth()+1);
          var _nxt = _sd.getFullYear()+'_'+String(_sd.getMonth()+1).padStart(2,'0');
          infoEl.innerHTML = 'Active: <b style="color:#b964ff">' + (active.name||active.season_key) + '</b> (' + active.season_key + ') · ends <b>' + ((active.end_date||'').substring(0,10)) + '</b>'
            + '<br><span style="color:#888">Roll karne par agla season auto-banega: ' + _nxt + ' (same tiers: cosmetics + GD)</span>';
        } else {
          infoEl.innerHTML = '<span style="color:#ff9f1c">⚠️ Koi active season nahi!</span>';
        }
      }, function(){});
  }
  var snap = await rtdb.ref('seasonPassRequests').orderByChild('status').equalTo('pending').once('value');
  var list = document.getElementById('spReqList');
  if (!list) return;
  if (!snap.exists()) { list.innerHTML = '<div class="empty-state">No pending Season Pass requests.</div>'; return; }
  var rows = [];
  snap.forEach(function(c) { rows.push(Object.assign({_id: c.key}, c.val())); });
  rows.sort(function(a,b) { return (b.createdAt||0)-(a.createdAt||0); });
  document.getElementById('spCount').textContent = rows.length;
  /* ✅ BUG FIX (2026-08-22): missing .table-wrapper — every other admin
     table wraps in this (overflow-x:auto + touch-scroll, see
     admin-base.css), but this one didn't, so on a narrow screen the
     table just got clipped with no way to reach the hidden columns. */
  var h = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>User</th><th>Season</th><th>Amount</th><th>Time</th><th>Screenshot</th><th>Action</th></tr></thead><tbody>';
  rows.forEach(function(r) {
    var id = r._id;
    h += '<tr>';
    h += '<td><strong>' + (r.userName||'Unknown') + '</strong><br><small style="color:#888">' + (r.uid||'').substring(0,10) + '</small></td>';
    h += '<td>' + (r.season||'-') + '</td>';
    h += '<td>₹' + (r.price||49) + '</td>';
    h += '<td>' + new Date(r.createdAt||0).toLocaleString('en-IN') + '</td>';
    h += '<td>' + (r.screenshotBase64 ? '<img src="' + r.screenshotBase64 + '" style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="window.open(this.src)">' : '-') + '</td>';
    h += '<td><button class="btn btn-primary btn-xs" style="background:linear-gradient(135deg,#b964ff,#7b2ff7);border:none;color:#fff" onclick="approveSeasonPass(\'' + id + '\',\'' + r.uid + '\',\'' + (r.season||'') + '\')"><i class="fas fa-check"></i> Approve</button> <button class="btn btn-danger btn-xs" onclick="rejectSeasonPass(\'' + id + '\')"><i class="fas fa-times"></i></button></td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  list.innerHTML = h;
};

/* ✅ R29F (2026-09-22): Season roll action — admin-only RPC
   admin_roll_battle_pass_season() server-side verify karta hai ki caller
   is_admin hai + current season khatam ho chuka hai, phir sab ko inactive
   karke naya 'YYYY_MM' season banata hai (SAME tiers — cosmetic + GD
   values preserve). Double-run / mid-month roll server hi rokta hai. */
window.rollBattlePassSeason = async function() {
  if (!window._supa) { showToast('❌ Supabase connected nahi', true); return; }
  var btn = document.getElementById('bpRollBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Rolling...'; }
  if (!confirm('Naya month ka Battle Pass season roll karna hai?\nCurrent season inactive ho jayega aur agla season (is month + 1) active ho jayega — same tiers (cosmetics + GD).')) {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Naya Month Season Roll Karo'; }
    return;
  }
  try {
    var r = await window._supa.rpc('admin_roll_battle_pass_season', {});
    if (r.error) { showToast('❌ ' + (r.error.message || 'Roll failed'), true); if (btn) { btn.disabled = false; btn.textContent = '🔄 Naya Month Season Roll Karo'; } return; }
    var d = r.data || {};
    if (d.ok === false) { showToast('⚠️ ' + (d.error || 'Roll nahi hua'), true); }
    else { showToast('✅ Season ' + d.season + ' roll ho gaya (' + d.tiers + ' tiers)!', false); }
  } catch(e) { showToast('❌ Roll error: ' + e.message, true); }
  if (btn && !btn.disabled) btn.disabled = false;
  if (btn) { btn.textContent = '🔄 Naya Month Season Roll Karo'; }
  loadSeasonPassSection();
};

/* ══════════════════════════════════════════════════════
   ✅ REMOVED (2026-08): DIAMOND PACKAGES editor (Settings page) —
   duplicate of App Settings' "Sky Diamond Packages" card. This version
   wrote to Firebase (appSettings/diamondPackages), which was a second,
   disconnected config source from the one the User Panel actually reads
   (Supabase app_settings.live_config, via window.CFG.sdPackages).
   Manage packages from App Settings only now.
   ══════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════
   BADGE COUNTERS — Sky Diamond + Premium pending badges
   ══════════════════════════════════════════════════════ */
(function watchPendingBadges() {
  /* ✅ FIX (live-testing — likely the single biggest source of the
     permission_denied-at-/matches-and-/profileRequests spam seen in
     testing): this file loads FIRST (before supabase-rtdb-bridge.js),
     so `window.rtdb` is truthy almost immediately as raw Firebase RTDB
     — well before the bridge installs. The old guard only checked
     existence, not window.rtdb._isSupaBridge, so these THREE permanent
     .on('value') listeners (walletRequests, skyDiamondRequests,
     premiumRequests — none in firebase-rules.json's allowlist) bound to
     raw Firebase and stayed bound for the rest of the session no matter
     how long anything else waited for the bridge. Wait for the bridge
     explicitly. */
  var _iv = setInterval(function() {
    if (!(window.rtdb && window.rtdb._isSupaBridge)) return;
    clearInterval(_iv);
    // Watch sky diamond requests
    rtdb.ref('walletRequests').orderByChild('status').equalTo('pending').on('value', function(s) {
      var cnt = 0;
      if (s.exists()) s.forEach(function(c){ var t = (c.val().type||''); if(t==='diamond_purchase'||t==='add'||t==='sky_diamond') cnt++; });
      var bd = document.getElementById('skyDiaBadge');
      if (bd) { bd.textContent = cnt; bd.style.display = cnt ? 'flex' : 'none'; }
    });
    rtdb.ref('skyDiamondRequests').orderByChild('status').equalTo('pending').on('value', function(s) {
      var cnt = s.exists() ? s.numChildren() : 0;
      var bd = document.getElementById('skyDiaBadge');
      if (bd) { var cur = parseInt(bd.textContent)||0; bd.textContent = cur+cnt; bd.style.display = (cur+cnt)?'flex':'none'; }
    });
    // Watch premium requests
    rtdb.ref('premiumRequests').orderByChild('status').equalTo('pending').on('value', function(s) {
      var cnt = s.exists() ? s.numChildren() : 0;
      var bd = document.getElementById('premiumBadge');
      if (bd) { bd.textContent = cnt; bd.style.display = cnt ? 'flex' : 'none'; }
    });
  }, 1200);
})();

/* ✅ AUDIT FIX: header "DB Rules" button called window.showSecurityRules,
   which was never defined anywhere — tap did nothing. Real implementation:
   fetch the actual deployed firebase-rules.json (same file this admin panel
   ships next to) and show it, so admins have a quick read-only reference
   without leaving the page. */
if (!window.showSecurityRules) {
  window.showSecurityRules = function() {
    fetch('firebase-rules.json').then(function(r) { return r.text(); }).then(function(text) {
      alert('Current firebase-rules.json (read-only reference — deploy changes via Firebase Console):\n\n' + text);
    }).catch(function(e) {
      alert('Could not load firebase-rules.json: ' + e.message);
    });
  };
}