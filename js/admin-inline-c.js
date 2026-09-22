/* ── admin-inline.js · Part C: MATCH MANAGEMENT (status, tournaments, joined players, results) ── */
function getMatchStatus(matchTime){
  var now=Date.now();
  var startTime=Number(matchTime)||0;
  
  if(!startTime)return 'Upcoming';
  
  var endTime=startTime+(60*60*1000); /* 1 hour match duration */
  
  if(now<startTime)return 'Upcoming';
  if(now>=startTime&&now<endTime)return 'Live';
  return 'Completed';
}

/* getAdminMatchStatus — Enhanced wrapper with terminal state handling
   - Uses getMatchStatus() internally for time calculation
   - Respects 'resultPublished' and 'cancelled' as immutable states
   - Returns lowercase for badge CSS class compatibility
   
   Returns: 'upcoming' | 'live' | 'completed' | 'resultPublished' | 'cancelled'
*/
function getAdminMatchStatus(m){
  if(!m)return 'upcoming';
  
  /* Terminal states — admin-set, NEVER overridden by time calculation */
  if(m.status==='resultPublished')return 'resultPublished';
  if(m.status==='cancelled')return 'cancelled';
  
  /* All other states — calculate from matchTime */
  var mt=Number(m.matchTime)||0;
  if(!mt)return 'upcoming';
  
  return getMatchStatus(mt).toLowerCase();
}

/* getStatusBadgeColor — Badge color based on calculated status */
function getStatusBadgeColor(status){
  switch(status){
    case 'live': return 'red';
    case 'upcoming': return 'yellow';
    case 'completed': return 'blue';
    case 'resultPublished': return 'green';
    case 'cancelled': return 'gray';
    default: return 'blue';
  }
}

/* Legacy function for backward compatibility */
function getStatus(t){if(!t)return 'upcoming';return Date.now()>=t?'live':'upcoming';}

/* =============================================
   TOURNAMENTS — ALL data goes to matches/ node
   ============================================= */
async function loadTournaments(){
  try{
    var arr=await Promise.all([rtdb.ref(DB_MATCHES).once('value'),rtdb.ref(DB_JOIN).once('value')]);
    var tS=arr[0],jS=arr[1];allTournaments={};allJoinRequests={};var jc={};
    
    /* Count joined players from joinRequests node */
    jS.forEach(function(c){
      var j=c.val();
      allJoinRequests[c.key]=j;
      /* Accept multiple status variants for counting: approved, joined, confirmed, or no status (direct join) */
      /* ✅ BUG FIX (2026-08-22): 'pending' was NOT in this list — but
      validate_and_join_match() (the RPC that actually deducts the entry
      fee and creates the row) sets status='pending' by default. Money is
      already taken at that point; 'pending' here means room/attendance
      pending, NOT membership pending. Excluding it meant a player who
      had genuinely joined (and paid) simply never appeared in Joined
      Players / notification lists / refund lists until some OTHER admin
      action happened to flip status — confirmed live (Testing2: user
      showed 'Joined' in their own app but the row was invisible here).
      Now only the genuinely-not-joined terminal statuses are excluded. */
      var _NOT_JOINED=['cancelled','refunded','rejected','no_show'];
      var isJoined=(_NOT_JOINED.indexOf(j.status)===-1);
      if(isJoined){
        var tid=j.tournamentId||j.matchId;
        jc[tid]=(jc[tid]||0)+1;
      }
    });
    
    /* Also check matches/{id}/joined node for direct joins */
    tS.forEach(function(c){
      var d=c.val(),id=c.key;
      /* If match has a 'joined' sub-node, count those too */
      if(d.joined&&typeof d.joined==='object'){
        var joinedCount=Object.keys(d.joined).length;
        jc[id]=Math.max(jc[id]||0,joinedCount);
        console.log('Match '+id+' has '+joinedCount+' players in matches/'+id+'/joined');
      }
    });
    var tb=document.getElementById('tournamentsTable');if(tb)tb.innerHTML='';var cnt=0;
    var rS=document.getElementById('resultTournamentSelect'),nS=document.getElementById('notifTournamentSelect'),jF=document.getElementById('joinedTournamentFilter');
    if(rS)rS.innerHTML='<option value="">-- Select --</option>';
    var mhSel=document.getElementById('mhMatchSelect');
    if(mhSel)mhSel.innerHTML='<option value="">-- Select Match --</option>';
    if(nS)nS.innerHTML='<option value="">-- Select --</option>';
    if(jF)jF.innerHTML='<option value="all">All</option>';
    tS.forEach(function(c){
      var d=c.val(),id=c.key;
      allTournaments[id]=d;
      
      /* Calculate filled slots — use Math.max of all sources for accuracy */
      d.filledSlots=Math.max(d.joinedSlots||0, jc[id]||0, d.filledSlots||0);
      
      /* Apply filter — now supports status filters too */
      if(currentFilter!=='all'){
        if(currentFilter==='special'&&!d.isSpecial)return;
        if(currentFilter==='paid'&&d.entryType!=='paid')return;
        if(currentFilter==='coin'&&d.entryType!=='coin')return;
        if(currentFilter==='ad'&&d.entryType!=='ad')return;
        /* Status filters using smart status */
        var smartSt=getAdminMatchStatus(d);
        if(currentFilter==='upcoming'&&smartSt!=='upcoming')return;
        if(currentFilter==='live'&&smartSt!=='live')return;
        if(currentFilter==='completed'&&smartSt!=='completed'&&smartSt!=='resultPublished')return;
      }
      cnt++;
      
      /* Get status — use smart time-based calculation for UI display */
      var st=getAdminMatchStatus(d);
      var sb=getStatusBadgeColor(st);
      var tm=d.matchTime?new Date(d.matchTime).toLocaleString():'N/A';
      
      /* Game mode — normalize and display correctly */
      var gameMode=(d.gameMode||d.matchType||'solo').toLowerCase().trim();
      /* Fix: Ensure proper capitalization for display */
      var gameModeDisplay=gameMode.charAt(0).toUpperCase()+gameMode.slice(1);
      var modeBadgeColor=gameMode==='squad'?'purple':gameMode==='duo'?'cyan':'blue';
      
      /* Cancel button — only show for active matches */
      var cb='';
      if(st!=='cancelled'&&st!=='resultPublished'){
        cb='<button class="btn btn-danger btn-xs" onclick="cancelTournament(\''+id+'\')" title="Cancel & Refund"><i class="fas fa-ban"></i></button>';
      }
      
      /* Build row */
      if(tb) tb.innerHTML+='<tr>'+
        '<td class="font-bold text-xs">'+(d.isSpecial?'⭐ ':'')+d.name+'</td>'+
        '<td><span class="badge '+modeBadgeColor+'">'+gameModeDisplay+'</span></td>'+
        '<td><span class="badge '+(d.entryType==='paid'?'green':d.entryType==='ad'?'yellow':'purple')+'">'+d.entryType+'</span>'+(d.entryType==='ad'?' 📺 '+(d.adsRequired||2)+' ads':' ₹'+(d.entryFee||0))+(d.minRank?'<br><span style="font-size:10px;color:#ffd700">🏅'+d.minRank+'+</span>':'')+'</td>'+
        '<td class="text-primary font-bold">'+(d.perKillPrize?'₹'+d.perKillPrize+'/Kill':'—')+'</td>'+
        '<td>'+slotBar(d.filledSlots,d.maxSlots||0)+'</td>'+
        '<td class="text-xxs">'+(d.map||'N/A')+'</td>'+
        '<td class="text-xxs">'+tm+'</td>'+
        '<td><span class="badge '+sb+'">'+st+'</span></td>'+
        '<td class="flex gap-1 items-center">'+
          '<button class="btn btn-ghost btn-xs" onclick="editTournament(\''+id+'\')"><i class="fas fa-edit"></i></button>'+
          '<button class="btn btn-ghost btn-xs" style="color:var(--info)" onclick="window.showRoomManager&&showRoomManager(\''+id+'\',\''+d.name+'\')" title="Room ID"><i class="fas fa-key"></i></button>'+
          '<button class="btn btn-ghost btn-xs" style="color:var(--purple)" onclick="window.broadcastToMatch&&broadcastToMatch(\''+id+'\',\''+d.name+'\')" title="Broadcast"><i class="fas fa-broadcast-tower"></i></button>'+
          '<button class="btn btn-ghost btn-xs" style="color:var(--warning)" onclick="window.showMatchAnalytics&&showMatchAnalytics(\''+id+'\',\''+d.name+'\')" title="Analytics"><i class="fas fa-chart-bar"></i></button>'+
          cb+
          '<button class="btn btn-ghost btn-xs" onclick="deleteTournament(\''+id+'\')" style="color:var(--danger)"><i class="fas fa-trash"></i></button>'+
        '</td>'+
      '</tr>';
      
      /* Add to dropdowns — filtered by status */
      /* Match Result: only unpublished/active matches */
      if(st !== 'resultPublished' && st !== 'cancelled') {
        rS.innerHTML+='<option value="'+id+'">'+d.name+'</option>';
      }
      /* Match History: only published matches */
      var mhSel = document.getElementById('mhMatchSelect');
      if(mhSel && st === 'resultPublished') {
        mhSel.innerHTML+='<option value="'+id+'">'+d.name+' ✅</option>';
      }
      nS.innerHTML+='<option value="'+id+'">'+d.name+'</option>';
    });
    /* Show empty message if no matches */
    if(cnt===0){
      tb.innerHTML='<tr><td colspan="9" class="text-muted text-xs" style="text-align:center;padding:20px"><i class="fas fa-trophy" style="font-size:24px;opacity:0.3;display:block;margin-bottom:8px"></i>No matches found. Click "Create" to add a new match.</td></tr>';
    }
    
    var tcEl=document.getElementById('tournamentCount');if(tcEl)tcEl.textContent=cnt;
    console.log('Loaded',cnt,'matches from',DB_MATCHES+'/');
    
    /* Populate joined tournament filter */
    populateJoinedFilter();
    loadJoinedPlayers();
  }catch(e){
    console.error('loadTournaments Error:',e);
    var _tbl=document.getElementById('tournamentsTable');if(_tbl)document.getElementById('tournamentsTable').innerHTML='<tr><td colspan="9" class="text-danger text-xs" style="text-align:center;padding:20px">Error loading matches. Check console.</td></tr>';
  }
}

/* Populate the Joined Players tournament filter dropdown */
function populateJoinedFilter(){
  var jF=document.getElementById('joinedTournamentFilter');
  if(!jF)return;
  var currentVal=jF.value;
  jF.innerHTML='<option value="all">All Matches</option>';
  Object.keys(allTournaments).forEach(function(id){
    var t=allTournaments[id];
    jF.innerHTML+='<option value="'+id+'">'+t.name+'</option>';
  });
  jF.value=currentVal||'all';
}
function filterTournaments(f,btn){currentFilter=f;document.querySelectorAll('.filter-tab').forEach(function(t){t.classList.remove('active')});if(btn)btn.classList.add('active');loadTournaments();}
function openTournamentModal(){
  ['tournamentId','tName','tEntryFee','tMaxSlots','tFirstPrize','tSecondPrize','tThirdPrize','tPerKill','tMatchTime','tRoomId','tRoomPass'].forEach(function(i){var e=document.getElementById(i);if(e)e.value=''});
  document.getElementById('tGameMode').value='solo';
  document.getElementById('tMap').value='Bermuda';
  document.getElementById('tEntryType').value='paid';
  document.getElementById('tIsSpecial').checked=false;
  var scEl2 = document.getElementById('tSpecialCategory'); if (scEl2) scEl2.value = 'none';
  document.getElementById('currentStatusHint').style.display='none';
  /* Reset the original match time tracker — new match has no original time */
  _editOriginalMatchTime=0;
  _capturedMatchTime='';
  _updateTMatchTimePreview();
  var _logReset1 = document.getElementById('tMatchTimeChangeLog'); if (_logReset1) _logReset1.innerHTML = '';
  onEntryTypeChange();
  document.getElementById('tournamentModal').classList.add('show');
  console.log('📅 New Match modal opened — _editOriginalMatchTime reset to 0');
  /* Load saved templates */
  setTimeout(loadTemplates, 100);
}
function onEntryTypeChange(){
  var t=document.getElementById('tEntryType').value;
  var h=document.getElementById('entryTypeHint');
  var adReqWrap=document.getElementById('adsRequiredWrap');
  var entryFeeWrap=document.getElementById('entryFeeWrap');
  var prizeTypeEl=document.getElementById('tPrizeType');
  var entryFeeLabel=document.getElementById('entryFeeLabel');
  var p1lbl=document.getElementById('prize1Label');
  var p2lbl=document.getElementById('prize2Label');
  var p3lbl=document.getElementById('prize3Label');

  // Show/hide entry fee for ad type
  if(entryFeeWrap) entryFeeWrap.style.display = t==='ad' ? 'none' : '';

  // Show ads required only for ad type
  if(adReqWrap) adReqWrap.style.display = t==='ad' ? 'block' : 'none';

  /* ✅ FIX: Auto-set default prize type based on entry type
     Priority: 1) Admin ki pichli saved preference  2) Sensible default
     Admin chahe to dropdown se baad mein change kar sakta hai */
  var _PRIZE_STORAGE_KEY = 'admin_prize_pref_' + t;
  var _savedPrize = null;
  try { _savedPrize = localStorage.getItem(_PRIZE_STORAGE_KEY); } catch(e) {}

  /* Sensible defaults (fixed — coin match pehle skyDiamond tha, galat tha) */
  var _defaultPrize = t==='paid' ? 'greenDiamond' : t==='coin' ? 'coin' : 'coin';
  var _chosenPrize  = _savedPrize || _defaultPrize;

  if(t==='paid'){
    h.className='info-box green';
    if(entryFeeLabel) entryFeeLabel.textContent='💠 Entry Fee (Sky Diamond) *';
    h.innerHTML='<i class="fas fa-info-circle"></i> <b>Paid Match</b> — Entry: 💠 Sky Diamond | Default prize: <img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block"> GD <span style="color:#888;font-size:11px">(neeche se change kar sakte ho)</span>';
  } else if(t==='coin'){
    h.className='info-box purple';
    if(entryFeeLabel) entryFeeLabel.textContent='🪙 Entry Fee (Coins) *';
    h.innerHTML='<i class="fas fa-info-circle"></i> <b>Coin Match</b> — Entry: 🪙 Coins | Default prize: 🪙 Coins <span style="color:#888;font-size:11px">(neeche se change kar sakte ho)</span>';
  } else {
    h.className='info-box yellow';
    if(entryFeeLabel) entryFeeLabel.textContent='Entry Fee';
    h.innerHTML='<i class="fas fa-info-circle"></i> <b>Ad Match</b> — Entry: 📺 Watch Ads | Default prize: 🪙 Coins <span style="color:#888;font-size:11px">(neeche se change kar sakte ho)</span>';
  }

  /* Apply chosen prize type to dropdown */
  if(prizeTypeEl) prizeTypeEl.value = _chosenPrize;

  /* Update prize labels based on chosen prize type */
  _updatePrizeLabels(_chosenPrize, p1lbl, p2lbl, p3lbl);
  // Show creator field only for paid Sky Diamond matches
  var _cfg=document.getElementById('creatorFieldGroup');
  if(_cfg) _cfg.style.display=(t==='paid'?'':'none');
}
/* ✅ Helper: update prize column labels when prize type changes */
function _updatePrizeLabels(pt, p1lbl, p2lbl, p3lbl){
  var sym = pt==='greenDiamond' ? '<img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block"> GD'
           : pt==='skyDiamond'  ? '💠 SD'
           : '🪙 Coins';
  if(p1lbl) p1lbl.textContent='1st Prize (' + sym.replace(/<[^>]+>/g,'').trim() + ')';
  if(p2lbl) p2lbl.textContent='2nd Prize (' + sym.replace(/<[^>]+>/g,'').trim() + ')';
  if(p3lbl) p3lbl.textContent='3rd Prize (' + sym.replace(/<[^>]+>/g,'').trim() + ')';
}

/* ✅ Called when admin manually changes prize type dropdown */
function onPrizeTypeChange(){
  var et = (document.getElementById('tEntryType')||{}).value || 'paid';
  var pt = (document.getElementById('tPrizeType')||{}).value  || 'greenDiamond';
  var p1lbl = document.getElementById('prize1Label');
  var p2lbl = document.getElementById('prize2Label');
  var p3lbl = document.getElementById('prize3Label');

  /* Save admin's preference for this entry type */
  try { localStorage.setItem('admin_prize_pref_' + et, pt); } catch(e) {}

  /* Update labels */
  _updatePrizeLabels(pt, p1lbl, p2lbl, p3lbl);

  /* Update hint text */
  var h = document.getElementById('entryTypeHint');
  if(h){
    var prizeLabel = pt==='greenDiamond' ? 'Green Diamond 💎' : pt==='skyDiamond' ? 'Sky Diamond 💠' : 'Coins 🪙';
    var entryLabel = et==='paid' ? 'Sky Diamond 💠' : et==='coin' ? 'Coins 🪙' : 'Ads 📺';
    h.innerHTML = '<i class="fas fa-info-circle"></i> Entry: ' + entryLabel + ' | Prize: <b>' + prizeLabel + '</b>';
  }
}
function resolveCreatorCode(){
  var code=((document.getElementById('tCreatorCode')||{}).value||'').toUpperCase().trim();
  var status=document.getElementById('creatorCodeStatus');
  if(!status) return;
  if(!code||code.length<3){status.textContent='';window._resolvedCreatorUid=null;return;}
  (window.rtdb||window.db).ref('creatorCodes/'+code).once('value',function(s){
    if(s.val()){
      window._resolvedCreatorUid=s.val();
      (window.rtdb||window.db).ref('users/'+s.val()+'/ign').once('value',function(u){
        status.innerHTML='<span style="color:#00ff9c;font-weight:700">✅ Creator found: '+(u.val()||'Creator')+'</span>';
      });
    } else {
      window._resolvedCreatorUid=null;
      status.innerHTML='<span style="color:#ff6b6b">❌ Creator code not found</span>';
    }
  });
}
/* _editOriginalMatchTime — stores the EXACT database matchTime (ms) when edit modal opens
   Used by saveTournament() to compare: did admin actually change the time?
   This prevents status recalculation when only Room ID/other fields change.
*/
var _editOriginalMatchTime=0;

/* ══════════════════════════════════════════════════════════════
   MATCH TIME — REVERTED (2026-09-05), per Junaid's explicit request:
   the custom bottom-sheet picker (calendar/chips/wheel) was disliked
   ("bahut hi ghatiya") and had a Save-button hang bug. Back to the
   simple, single native <input type="datetime-local"> from
   AdminPanel-FIXED-v20 — one tap opens the phone's own native
   date+time picker, no custom UI, no "drama".
   Kept the race-condition hardening from earlier sessions though,
   since that was never the complaint: _capturedMatchTime is set
   inside the field's own 'change' event (the one moment a WebView
   guarantees the value is actually committed), and saveTournament()
   falls back to a direct re-read only if that's somehow empty. */
var _capturedMatchTime = ''; // "YYYY-MM-DDTHH:MM", set by _onTMatchTimeChange()

function _onTMatchTimeChange(){
  var el = document.getElementById('tMatchTime');
  _capturedMatchTime = el ? el.value : '';
  _updateTMatchTimePreview();
  /* ✅ DIAGNOSTIC (2026-09-13), added after the time-mismatch bug
     reproduced even with the correct value visibly shown in the
     preview line moments before Save was tapped — this proves
     something changes _capturedMatchTime AFTER the preview last
     rendered it correctly but BEFORE saveTournament() reads it. Native
     datetime-local pickers on some Android versions can fire multiple
     'change' events during a single interaction (once per segment —
     day/month/year/hour/minute), and if a later one fires with a
     different or reset value, this handler would silently overwrite
     _capturedMatchTime to something the admin never saw, since the
     preview re-render is fast enough that a human would not notice a
     flash between two different values. This log keeps every single
     change event's value + timestamp on screen (not just the latest),
     so if this is what's happening, it becomes directly visible. */
  var log = document.getElementById('tMatchTimeChangeLog');
  if (log) {
    var ts = new Date().toLocaleTimeString('en-IN', {hour12:false});
    var line = document.createElement('div');
    line.textContent = ts + ' → ' + (_capturedMatchTime || '(empty)');
    log.insertBefore(line, log.firstChild);
    while (log.children.length > 6) log.removeChild(log.lastChild);
  }
}

/* ✅ ADDED (2026-09-13) — see the HTML comment above #tMatchTimePreview
   for the full reasoning. Renders a plain-language confirmation of
   exactly what _capturedMatchTime currently holds, using the same
   explicit-numeric-parts parsing saveTournament() itself uses (never
   new Date(string) directly), so this preview is guaranteed to show
   the SAME value saveTournament() would actually save — not a
   separately-computed approximation that could itself disagree. */
function _updateTMatchTimePreview(){
  var preview = document.getElementById('tMatchTimePreview');
  if (!preview) return;
  if (!_capturedMatchTime) { preview.textContent = ''; return; }
  var parts = _capturedMatchTime.split(/[-T:]/).map(Number);
  var dt = new Date(parts[0], parts[1]-1, parts[2], parts[3], parts[4], 0, 0);
  var diffMs = dt.getTime() - Date.now();
  var diffMins = Math.round(diffMs / 60000);
  var whenText = diffMins < 0 ? '⚠️ BEET CHUKA HAI (' + Math.abs(diffMins) + ' min pehle)' :
                 diffMins < 2 ? '⚠️ ABHI KE BAHUT KAREEB (' + diffMins + ' min baad) — LIVE ho jayega turant!' :
                 diffMins < 60 ? diffMins + ' min baad' :
                 Math.round(diffMins/60) + ' ghante baad';
  preview.style.color = diffMins < 2 ? '#ff4444' : '#00ff9c';
  preview.innerHTML = '📅 Save hoga: <b>' + dt.toLocaleString('en-IN', {weekday:'short', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}) + '</b> (' + whenText + ')<br><span style="font-size:10px;color:#666;font-weight:400">build 20260913c</span>';
}

function editTournament(id){
  var d=allTournaments[id];if(!d)return;
  document.getElementById('tournamentId').value=id;
  document.getElementById('tName').value=d.name||'';
  document.getElementById('tGameMode').value=(d.gameMode||d.matchType||'solo').toLowerCase().trim();
  document.getElementById('tMap').value=d.map||'Bermuda';
  document.getElementById('tEntryType').value=d.entryType||'paid';
  if(document.getElementById('tCreatorCode')) document.getElementById('tCreatorCode').value=d.creatorCode||'';
  window._resolvedCreatorUid = d.creatorUid || null;
  if(d.creatorCode && d.creatorCode.length > 0) {
    var cfg = document.getElementById('creatorFieldGroup');
    if(cfg) cfg.style.display = '';
    var cs = document.getElementById('creatorCodeStatus');
    if(cs && d.creatorCode) cs.innerHTML = '<span style="color:#00d4ff;font-weight:700">🔵 Creator: '+d.creatorCode+'</span>';
  }
  document.getElementById('tEntryFee').value=d.entryFee||'';
  if(document.getElementById('tPrizeType')) {
    /* ✅ FIX: coin match default was skyDiamond (wrong). Now coin → coin */
    var _editPrize = d.prizeType || (d.entryType==='paid'?'greenDiamond' : 'coin');
    document.getElementById('tPrizeType').value = _editPrize;
    _updatePrizeLabels(_editPrize,
      document.getElementById('prize1Label'),
      document.getElementById('prize2Label'),
      document.getElementById('prize3Label')
    );
  }
  if(document.getElementById('tMinRank')) document.getElementById('tMinRank').value=d.minRank||'';
  if(document.getElementById('tAdsRequired')) document.getElementById('tAdsRequired').value=d.adsRequired||2;
  if(window.onEntryTypeChange) onEntryTypeChange();
  // prizePool auto-calced from prizes
  if(document.getElementById('tPerKill')) document.getElementById('tPerKill').value=d.perKillPrize||'';
  
  document.getElementById('tMaxSlots').value=d.maxSlots||'';
  document.getElementById('tFirstPrize').value=d.firstPrize||'';
  document.getElementById('tSecondPrize').value=d.secondPrize||'';
  document.getElementById('tThirdPrize').value=d.thirdPrize||'';
  
  /* ╔══════════════════════════════════════════════════════════╗
     ║  MATCH TIME FIX — Load EXACT database time as LOCAL     ║
     ║  ══════════════════════════════════════════════════════  ║
     ║  BUG: .toISOString() converts to UTC, but datetime-    ║
     ║  local input expects LOCAL time → time shifts by        ║
     ║  timezone offset → saving "unchanged" time actually     ║
     ║  saves a DIFFERENT time → status recalculates wrongly   ║
     ║                                                         ║
     ║  FIX: Convert timestamp to LOCAL datetime string using  ║
     ║  getFullYear/getMonth/getDate/getHours/getMinutes       ║
     ║  Store original timestamp for precise comparison later  ║
     ╚══════════════════════════════════════════════════════════╝ */
  _editOriginalMatchTime=Number(d.matchTime)||0;
  
  if(d.matchTime){
    var dt=new Date(d.matchTime);
    var yyyy=dt.getFullYear();
    var mm=String(dt.getMonth()+1).padStart(2,'0');
    var dd=String(dt.getDate()).padStart(2,'0');
    var hh=String(dt.getHours()).padStart(2,'0');
    var mi=String(dt.getMinutes()).padStart(2,'0');
    var localStr=yyyy+'-'+mm+'-'+dd+'T'+hh+':'+mi;
    document.getElementById('tMatchTime').value=localStr;
    _capturedMatchTime = localStr;
    _updateTMatchTimePreview();
    console.log('📅 Edit Match — Loaded matchTime from DB:');
    console.log('   Database timestamp: '+d.matchTime+' ('+new Date(d.matchTime).toString()+')');
    console.log('   Input field set to: '+localStr+' (LOCAL time, NOT UTC)');
    console.log('   _editOriginalMatchTime saved: '+_editOriginalMatchTime);
  }else{
    document.getElementById('tMatchTime').value='';
    _capturedMatchTime = '';
    _updateTMatchTimePreview();
    _editOriginalMatchTime=0;
    console.log('📅 Edit Match — No matchTime in database');
  }
  
  document.getElementById('tRoomId').value=d.roomId||'';
  document.getElementById('tRoomPass').value=d.roomPassword||'';
  var rrm = document.getElementById('tRoomReleaseMin');
  if (rrm) rrm.value = d.roomReleaseMinutes || 5;
  // Set special category dropdown
  var sc = d.specialCategory || (d.isSundaySpecial ? 'sunday_special' : d.isMonthlySpecial ? 'monthly_special' : 'none');
  var scEl = document.getElementById('tSpecialCategory');
  if (scEl) scEl.value = sc;
  document.getElementById('tIsSpecial').checked = sc !== 'none';
  
  /* Show current status indicator — uses CALCULATED status, not database */
  var calculatedSt=getAdminMatchStatus(d);
  var dbStatus=d.status||'upcoming';
  var stHint=document.getElementById('currentStatusHint');
  var stText=document.getElementById('currentStatusText');
  if(stHint){stHint.style.display='flex';
  stHint.className='info-box '+getStatusBadgeColor(calculatedSt);}
  
  /* Build detailed status explanation */
  var statusExplain='';
  if(calculatedSt==='upcoming'){
    statusExplain='Match has not started yet. Will become LIVE when match time arrives.';
  }else if(calculatedSt==='live'){
    statusExplain='Match is currently LIVE. Will become COMPLETED 1 hour after start.';
  }else if(calculatedSt==='completed'){
    statusExplain='Match ended. Click "Publish Results" to finalize.';
  }else if(calculatedSt==='resultPublished'){
    statusExplain='Results already published. Cannot change status.';
  }else if(calculatedSt==='cancelled'){
    statusExplain='Match was cancelled. Players were refunded.';
  }
  
  if(stText){stText.innerHTML='<strong>Calculated Status: '+calculatedSt.toUpperCase()+'</strong> <span style="font-size:9px;}opacity:0.6">(DB: '+dbStatus+')</span><br><span style="font-size:10px;opacity:0.8">'+statusExplain+'</span><br><span style="font-size:9px;color:var(--text-muted)">📌 <b>RULE:</b> Editing Room ID/Password/Per Kill does NOT change status. Status ONLY recalculates if you change Match Time. Otherwise it stays as "'+dbStatus+'".</span>';
  }
  onEntryTypeChange();
  document.getElementById('tournamentModal').classList.add('show');
}

/* saveTournament — writes to matches/ 
   ╔══════════════════════════════════════════════╗
   ║  SMART STATUS LOGIC (FINAL v5)              ║
   ║  ─────────────────────────────────────────── ║
   ║  • Status recalculates ONLY if matchTime     ║
   ║    actually CHANGES (old != new)              ║
   ║  • Room ID / Per Kill / other field edits     ║
   ║    do NOT touch status at all                 ║
   ║  • Terminal states (resultPublished/cancelled)║
   ║    are NEVER overwritten                      ║
   ║  • Room ID change auto-sends notification     ║
   ║    to joined players only                     ║
   ╚══════════════════════════════════════════════╝
   
   gameMode/matchType saved as 'solo', 'duo', or 'squad' (lowercase)
*/
async function saveTournament(){
  console.log('[saveTournament] BUILD 20260913c — trust-captured-value fix + on-screen build marker');
  var _saveWallClockStart = Date.now();
  var saveBtn=document.getElementById('saveTournamentBtn');
  setLoading(saveBtn,true);

  /* ✅ ROOT CAUSE FOUND (2026-09-13), confirmed live via the new preview
     line + a direct DB check: Junaid picked a time 2 hours out, the
     preview correctly showed "2 ghante baad", but the match still
     saved as live/now. Traced to THIS exact block — it was doing a
     FRESH re-read of tMatchTimeEl.value at Save-click time, completely
     independent of _capturedMatchTime (the value the preview line
     displays, captured earlier by _onTMatchTimeChange() the moment the
     admin actually picked the time). If the native datetime-local
     input's own DOM .value silently changes or reverts between when
     the admin picks a time and when they tap Save — which is exactly
     the class of WebView/browser quirk every earlier session's fix
     was trying to work around — this block was re-reading that
     drifted value instead of trusting the one already known to be
     correct. Every previous "fix" (blur+rAF, double-read settle-check,
     capture-on-change) still ultimately re-read .value fresh right
     here at save time, so the underlying bug never actually went away
     — it just moved to different code between sessions.
     Fixed by trusting _capturedMatchTime directly and NOT reading
     tMatchTimeEl.value again at all unless _capturedMatchTime is
     genuinely empty (e.g. very old cached JS with no change-handler
     ever attached) — that fallback path also gets the same blur+
     double-read hardening as a last resort only. */
  var mts = _capturedMatchTime;
  var _logAtSave = document.getElementById('tMatchTimeChangeLog');
  if (_logAtSave) {
    var _tsSave = new Date().toLocaleTimeString('en-IN', {hour12:false});
    var _lineSave = document.createElement('div');
    _lineSave.style.color = '#ffd700';
    _lineSave.style.fontWeight = '800';
    _lineSave.textContent = _tsSave + ' [SAVE READ] → ' + (mts || '(empty)');
    _logAtSave.insertBefore(_lineSave, _logAtSave.firstChild);
  }
  if (!mts) {
    var tMatchTimeEl = document.getElementById('tMatchTime');
    if (tMatchTimeEl) {
      tMatchTimeEl.blur();
      await new Promise(function(r){ requestAnimationFrame(r); });
      var _read1 = tMatchTimeEl.value;
      await new Promise(function(r){ setTimeout(r, 120); });
      var _read2 = tMatchTimeEl.value;
      mts = _read2 || _read1;
      if (mts) { _capturedMatchTime = mts; console.warn('[saveTournament] _capturedMatchTime was empty at save time — fell back to a fresh DOM read:', mts); }
    }
  }

  var id=document.getElementById('tournamentId').value;
  var nm=document.getElementById('tName').value.trim();
  
  /* FIX: Ensure gameMode is saved correctly as 'solo', 'duo', or 'squad' */
  var gmRaw=document.getElementById('tGameMode').value;
  var gm=gmRaw.toLowerCase().trim();
  if(gm!=='solo'&&gm!=='duo'&&gm!=='squad'){
    gm='solo';
    console.warn('Invalid gameMode "'+gmRaw+'", defaulting to solo');
  }
  // Special category from dropdown
  var specialCat = (document.getElementById('tSpecialCategory') ? document.getElementById('tSpecialCategory').value : 'none');
  var matchType = specialCat !== 'none' ? specialCat : 'normal';
  var sp = specialCat !== 'none';
  console.log('Saving gameMode as: "'+gm+'" (raw input: "'+gmRaw+'")');
  
  var mp=document.getElementById('tMap').value;
  var et=document.getElementById('tEntryType').value;
  var ef=et==='ad'?0:(Number(document.getElementById('tEntryFee').value)||0);
  var adsRequired=et==='ad'?(Number((document.getElementById('tAdsRequired')||{}).value)||2):0;
  var prizeType=(document.getElementById('tPrizeType')||{}).value||(et==='paid'?'greenDiamond':'coin'); /* ✅ coin match → coin prize (not skyDiamond) */
  var minRank=(document.getElementById('tMinRank')||{}).value||'';
  var pk=Number(document.getElementById('tPerKill').value)||0; // per kill prize
  var ms=Number(document.getElementById('tMaxSlots').value)||12;
  var f1=Number(document.getElementById('tFirstPrize').value)||0;
  var f2=Number(document.getElementById('tSecondPrize').value)||0;
  var f3=Number(document.getElementById('tThirdPrize').value)||0;
  var pp=f1+f2+f3; // auto-calc from prizes — must be after f1,f2,f3
  /* mts is already set above (settled double-read, before this
     synchronous field-gathering block runs) — do NOT re-read
     tMatchTime.value here, that would undo the settle-check. */
  var ri=document.getElementById('tRoomId').value.trim();
  var rp=document.getElementById('tRoomPass').value.trim();
  var roomReleaseMin = Number((document.getElementById('tRoomReleaseMin')||{}).value)||5;
  var matchSubType = (document.getElementById('tMatchSubType')||{}).value || 'battle_royale';
  var tournamentFormat = (document.getElementById('tTournamentFormat')||{}).value || 'normal';
  // sp already set above from specialCat
  
  /* ===== STRICT VALIDATION ===== */
  if(!nm){
    showToast('❌ Please fill: Match Name',true);
    document.getElementById('tName').focus();
    setLoading(saveBtn,false);return;
  }
  if(!mts){
    showToast('❌ Please fill: Match Time',true);
    document.getElementById('tMatchTime').focus();
    setLoading(saveBtn,false);return;
  }
  if(et!=='paid'&&et!=='coin'&&et!=='ad'&&et!=='free'){
    showToast('❌ Please select a valid Entry Type',true);
    setLoading(saveBtn,false);return;
  }
  if(et==='paid'&&ef<=0){
    showToast('❌ Entry Fee must be > 0 for paid matches',true);
    document.getElementById('tEntryFee').focus();
    setLoading(saveBtn,false);return;
  }
  if(et==='coin'&&ef<=0){
    showToast('❌ Entry Fee (coins) must be > 0 for coin matches',true);
    document.getElementById('tEntryFee').focus();
    setLoading(saveBtn,false);return;
  }
  /* Room ID/Password no longer required at creation — admin adds via Room Manager */
  if(ms<=0){
    showToast('❌ Please fill: Max Slots (must be > 0)',true);
    document.getElementById('tMaxSlots').focus();
    setLoading(saveBtn,false);return;
  }

  if(f1<0||f2<0||f3<0){
    showToast('❌ Rank prizes cannot be negative',true);
    setLoading(saveBtn,false);return;
  }
  /* FIX Bug#46: Also validate per-kill prize cannot be negative */
  var pkEl=document.getElementById('tPerKill');
  var pkVal=pkEl?Number(pkEl.value)||0:0;
  if(pkVal<0){
    showToast('❌ Per-Kill prize cannot be negative',true);
    if(pkEl)pkEl.focus();
    setLoading(saveBtn,false);return;
  }
  /* FIX Bug#108: Prevent scheduling matches for past dates */
  if(mts){
    var _bug108Parts = mts.split(/[-T:]/).map(Number);
    var scheduledMs = new Date(_bug108Parts[0], _bug108Parts[1]-1, _bug108Parts[2], _bug108Parts[3], _bug108Parts[4], 0, 0).getTime();
    if(scheduledMs<Date.now()-60000){ /* 1 minute tolerance */
      showToast('❌ Match time cannot be in the past!',true);
      setLoading(saveBtn,false);return;
    }
  }
  
  console.log('Match validation PASSED — all required fields present');
  console.log('GameMode to save: '+gm+', EntryType: '+et);
  
  /* ✅ HARDENING (2026-08-26): reported live — typed 08:39 into Match
     Time, saved, and the match immediately showed as LIVE with the
     time silently showing as 06:39 on reopen — a 2-hour shift with no
     obvious cause in this code (getMatchStatus, the save path, and the
     edit-reload path were all individually verified timezone-safe:
     epoch-ms comparisons throughout, no UTC/local mixing found).
     `new Date("YYYY-MM-DDTHH:MM")` is spec-correct as local time in
     every modern engine, but relies on the browser/WebView parsing
     that exact string shape — some Android System WebView versions
     have shown inconsistent behavior parsing seconds-less datetime-
     local strings under certain locale/DST configurations. Building
     the Date from explicit numeric parts instead removes any string-
     parsing ambiguity entirely — this is the most robust form
     regardless of what the root cause on the device turns out to be. */
  var mt;
  if (mts) {
    var _mtParts = mts.split(/[-T:]/).map(Number);
    mt = new Date(_mtParts[0], _mtParts[1]-1, _mtParts[2], _mtParts[3], _mtParts[4], 0, 0).getTime();
  } else {
    mt = 0;
  }

  /* Genuine last-resort sanity check (not a race workaround anymore —
     _capturedMatchTime above already removed the actual race). Only
     fires if the admin's real selected time happens to land within
     2 min of now, which would make the match go live almost
     immediately — worth a confirm either way. */
  if (mt && Math.abs(mt - Date.now()) < 2*60*1000) {
    if (!confirm('⚠️ Match time abhi (' + new Date(mt).toLocaleString() + ') ke bahut kareeb hai — save hote hi match LIVE ho jayega. Sahi hai?')) {
      setLoading(saveBtn,false);
      return;
    }
  }

  try{
    if(id){
      /* ═══════════════════════════════════════
         EDITING EXISTING MATCH
         ═══════════════════════════════════════ */
      var existingMatch=allTournaments[id]||{};
      /* Use _editOriginalMatchTime for PRECISE comparison
         This is the exact timestamp that was loaded into the input field.
         If admin didn't touch the time field, the parsed value from the
         LOCAL datetime string will match this exactly (no UTC shift).
      */
      var oldMatchTime=_editOriginalMatchTime||Number(existingMatch.matchTime)||0;
      var oldRoomId=existingMatch.roomId||'';
      var oldRoomPass=existingMatch.roomPassword||'';
      var currentDbStatus=existingMatch.status||'upcoming';
      
      /* ── Build update data ── 
         CRITICAL: status field is NOT included here.
         It is only added below IF matchTime actually changed.
      */
      var updateData={
        name:nm,
        gameMode:gm,
        matchType:matchType!=='normal'?matchType:gm,
        specialType:matchType!=='normal'?matchType:null,
        isSundaySpecial:matchType==='sunday_special',
        isMonthlySpecial:matchType==='monthly_special',
        mode:gm,
        map:mp,
        entryType:et,
        entryFee:ef,
        adsRequired:adsRequired||null,
        prizeType:prizeType||null,
        minRank:minRank||null,
        perKillPrize:pk,
        
        maxSlots:ms,
        firstPrize:f1, prize1st:f1,
        secondPrize:f2, prize2nd:f2,
        thirdPrize:f3, prize3rd:f3,
        matchTime:mt,
        roomId:ri,
        roomPassword:rp,
        roomStatus: (ri && rp) ? 'released' : 'pending',
        roomReleaseMinutes: roomReleaseMin,
        isSpecial:sp,
        specialCategory:specialCat,
        matchSubType:matchSubType,
        tournamentFormat:tournamentFormat,
        creatorUid:(window._resolvedCreatorUid||null),
        creatorCode:((document.getElementById('tCreatorCode')||{}).value||'').toUpperCase().trim()||null,
        updatedAt:Date.now()
        /* ⛔ NO status field here — added conditionally below */
      };
      
      /* ── SMART STATUS DECISION ──
         Only recalculate status if matchTime ACTUALLY changed.
         If admin only changed Room ID, Per Kill, Prize, etc → status stays as-is.
      */
      /* ── PRECISE TIME COMPARISON ──
         Compare new parsed time with the EXACT original time that was loaded.
         Using _editOriginalMatchTime ensures no UTC/Local conversion drift.
         
         Allow 60-second tolerance for rounding (datetime-local drops seconds)
      */
      var timeDiff=Math.abs(mt-oldMatchTime);
      var matchTimeChanged=(timeDiff>60000); /* Changed if difference > 1 minute */
      /* Bug#13 Fix: Guard against undefined oldRoomId causing false-positive notifications.
         oldRoomId could be undefined if the match record lacks roomId field (new match).
         Only trigger if BOTH old value exists AND new value is genuinely different. */
      var roomIdChanged=(!!oldRoomId&&ri!==oldRoomId&&ri!=='')||(!!ri&&!oldRoomId);
      var roomPassChanged=(!!oldRoomPass&&rp!==oldRoomPass&&rp!=='')||(!!rp&&!oldRoomPass);
      
      console.log('───── TIME COMPARISON ─────');
      console.log('Old matchTime (DB):    '+oldMatchTime+' → '+new Date(oldMatchTime).toString());
      console.log('New matchTime (input): '+mt+' → '+new Date(mt).toString());
      console.log('Difference:            '+timeDiff+'ms ('+(timeDiff/1000)+'s)');
      console.log('Time actually changed: '+matchTimeChanged+' (threshold: 60s)');
      console.log('───────────────────────────');
      
      if(matchTimeChanged){
        /* matchTime changed → recalculate status from the NEW time */
        var isTerminal=(currentDbStatus==='resultPublished'||currentDbStatus==='cancelled');
        
        if(!isTerminal){
          /* Use getMatchStatus for proper calculation with 1hr duration */
          var calculatedStatus=getMatchStatus(mt).toLowerCase();
          updateData.status=calculatedStatus;
          console.log('⏰ Match Time CHANGED: '+new Date(oldMatchTime).toLocaleString()+' → '+new Date(mt).toLocaleString());
          console.log('📌 Status recalculated to: '+calculatedStatus+' (was: '+currentDbStatus+')');
        }else{
          console.log('⚠️ Match Time changed but status is TERMINAL ('+currentDbStatus+'), NOT updating status');
        }
      }else{
        /* matchTime NOT changed → do NOT touch status at all */
        console.log('⏰ Match Time UNCHANGED (within 60s tolerance) — status will remain: '+currentDbStatus);
        console.log('   (Room ID, Per Kill, or other fields may have changed — status NOT affected)');
        /* Also use the original matchTime to avoid saving a drifted value */
        updateData.matchTime=oldMatchTime;
        console.log('   matchTime in update set to original: '+oldMatchTime);
      }
      
      console.log('═══════════════════════════════');
      console.log('EDIT MATCH: '+nm+' ('+id+')');
      console.log('Fields updated: '+Object.keys(updateData).join(', '));
      console.log('Status in update: '+(updateData.status?'YES → '+updateData.status:'NO → unchanged ('+currentDbStatus+')'));
      console.log('Room ID changed: '+roomIdChanged+', Match Time changed: '+matchTimeChanged);
      console.log('═══════════════════════════════');
      
      /* ── Save to database using .update() (never .set()) ── */
      var _editSaveStartTs = Date.now();
      await rtdb.ref(DB_MATCHES+'/'+id).update(updateData);
      console.log('⏱️ Match update DB write took '+(Date.now()-_editSaveStartTs)+'ms');
      console.log('✅ Match updated in database!');

      /* ✅ Audit Fix: mirror the edit to Supabase matches table too.
         User Panel reads matches from Supabase — without this, admin edits
         (room ID, prizes, time, status, etc.) never reached the app.
         Column names verified against COMPLETE_SCHEMA.sql — 'name' is a
         GENERATED column (derived from 'title'), so it must not be written. */
      if(window._supa){
        var _supaMatchUpd={
          title:nm,mode:gm,map:mp,entry_type:et,entry_fee:ef,
          prize_type:prizeType||null,per_kill_prize:pk,max_slots:ms,
          first_prize:f1,second_prize:f2,third_prize:f3,
          scheduled_at:new Date(updateData.matchTime||mt).toISOString(),
          room_id:ri||null,room_password:rp||null,
          match_sub_type:matchSubType,
          is_special:sp,special_category:specialCat
        };
        if(updateData.status)_supaMatchUpd.status=updateData.status;
        window._supa.from('matches').update(_supaMatchUpd).eq('id',id)
          .catch(function(e){console.warn('[saveTournament] Supabase sync failed:',e.message);});
      }
      
      /* ── AUTO ROOM NOTIFICATION ──
         When Room ID is added or changed, auto-notify all joined players.
         ✅ BUG FIX (2026-08-22): this used to run its OWN full notify-loop
         inline here (with a comment literally saying "duplicates are
         harmless") AND sendRoomNotificationToMatch() existed as a
         separate, never-called-from-here function doing the exact same
         thing — so any admin flow that also invoked
         sendRoomNotificationToMatch (e.g. the auto-release scheduler)
         combined with an edit here produced 2-4x duplicate
         notifications for the same room release. Now this just calls
         the single deduped implementation.
      */
      if((roomIdChanged||roomPassChanged)&&ri&&rp){
        console.log('🔔 Room details changed → auto-notifying joined players...');
        var notifyCount=await sendRoomNotificationToMatch(id, ri, rp, nm);
        showToast('✅ Match updated! Room details sent to '+notifyCount+' players.');
      }else{
        showToast('✅ Match updated successfully!');
      }
      console.log('⏱️⏱️ TOTAL saveTournament (edit) wall-clock time: '+(Date.now()-_saveWallClockStart)+'ms');
      
    }else{
      /* ═══════════════════════════════════════
         CREATING NEW MATCH
         ═══════════════════════════════════════ */
      /* For new matches, calculate initial status from matchTime */
      var initialStatus=getMatchStatus(mt).toLowerCase();
      
      var createData={
        name:nm,
        gameMode:gm,
        matchType:matchType!=='normal'?matchType:gm,
        specialType:matchType!=='normal'?matchType:null,
        isSundaySpecial:matchType==='sunday_special',
        isMonthlySpecial:matchType==='monthly_special',
        mode:gm,
        map:mp,
        entryType:et,
        entryFee:ef,
        adsRequired:adsRequired||null,
        prizeType:prizeType||null,
        minRank:minRank||null,
        perKillPrize:pk,
        
        maxSlots:ms,
        firstPrize:f1, prize1st:f1,
        secondPrize:f2, prize2nd:f2,
        thirdPrize:f3, prize3rd:f3,
        matchTime:mt,
        roomId:ri,
        roomPassword:rp,
        roomStatus: (ri && rp) ? 'released' : 'pending',
        isSpecial:sp,
        specialCategory:specialCat,
        matchSubType:matchSubType,
        tournamentFormat:tournamentFormat,
        roomReleaseMinutes: roomReleaseMin,
        status:initialStatus,
        filledSlots:0,
        createdAt:Date.now()
      };
      
      console.log('═══════════════════════════════');
      console.log('CREATE NEW MATCH: '+nm);
      console.log('GameMode: '+gm+', EntryType: '+et);
      console.log('Initial Status: '+initialStatus+' (calculated from matchTime)');
      console.log('═══════════════════════════════');
      
      var _saveStartTs = Date.now();
      var nr=await rtdb.ref(DB_MATCHES).push(createData);
      console.log('⏱️ Match create DB write took '+(Date.now()-_saveStartTs)+'ms');
      
      console.log('✅ Match created: '+nr.key);
      console.log('⏱️⏱️ TOTAL saveTournament (create) wall-clock time: '+(Date.now()-_saveWallClockStart)+'ms');
      showToast('✅ Match created! Status: '+initialStatus);
    }
    
    closeModal('tournamentModal');
    setLoading(saveBtn,false);
    loadTournaments();
  }catch(e){
    console.error('saveTournament error:',e);
    setLoading(saveBtn,false);
    showToast('Error: '+e.message,true);
  }
}

/* sendRoomNotificationToMatch — SINGLE SOURCE OF TRUTH for room-release
   notifications. Called internally when Room ID is updated via
   saveTournament(), from the standalone "Release Now" button
   (_releaseRoom in features-admin.js), and from the auto-release
   scheduler (fa24-admin-smart-tools.js).
   ✅ BUG FIX (2026-08-22): previously THREE independent code paths each
   ran their own full notify-loop for the same room-release event
   (saveTournament's inline block, _releaseRoom(), and this function),
   so a single room release could fire 2-4 duplicate notifications to
   the same player — confirmed live (Image: same "Room Details
   Released!" notification appearing 3x). Fixed by making this the only
   function that ever writes room-release notifications, with a
   uid-level dedup set so even querying both join_requests AND
   matches/{id}/joined can never double-notify the same player.
*/
async function sendRoomNotificationToMatch(matchId, roomId, roomPassword, matchName){
  if(!matchId||!roomId||!roomPassword){
    console.error('sendRoomNotificationToMatch: matchId, roomId, roomPassword required');
    return 0;
  }

  try{
    /* Create global notification entry in notifications/ node */
    var globalNotifRef=rtdb.ref('notifications').push();
    await globalNotifRef.set({
      matchId:matchId,
      matchName:matchName||'Match',
      title:'🎮 Room Details Released!',
      message:'Room ID: '+roomId+' | Pass: '+roomPassword,
      type:'room_released',
      createdAt:Date.now()
    });
    console.log('Created notification entry in notifications/');

    /* Send private notification to ONLY joined players of this specific match.
       ✅ dedup: a uid can appear in both join_requests AND matches/{id}/joined
       for the same match — notifiedUids ensures each player gets exactly ONE
       notification regardless of how many places they show up as "joined". */
    /* ✅ PERFORMANCE FIX (2026-09-07), per Junaid's urgent report: "pehle
       aisa nahi tha, ab bahut slow ho gaya" — the Save spinner would run
       for 15+ seconds on any edit that changed a Room ID. Root cause:
       this line used to be `await rtdb.ref(DB_JOIN).once('value')` with
       NO filter — that downloads the ENTIRE join_requests table (every
       join, for every match, ever created on the platform) on every
       single Room ID save, then filtered client-side for just this
       match's rows. As the table grew with real usage this got
       progressively slower — exactly matching "used to be fast, now
       isn't". Fixed to filter server-side instead, using the bridge's
       Firebase-style .orderByChild('matchId').equalTo(matchId) query
       (translates to a real Postgres WHERE match_id = ... — see
       supabase-rtdb-bridge.js's resolveOrderCol(), which converts the
       camelCase 'matchId' to the real snake_case column via toSnake()).
       Now only this match's own join rows are ever fetched. */
    var _notifyStartTs=Date.now();
    var jS=await rtdb.ref(DB_JOIN).orderByChild('matchId').equalTo(matchId).once('value');
    console.log('⏱️ Scoped join_requests fetch took '+(Date.now()-_notifyStartTs)+'ms');
    var notifiedUids={};
    var notifyCount=0;
    var promises=[];

    jS.forEach(function(ch){
      var j=ch.val();
      var tid=j.tournamentId||j.matchId;
      /* ✅ BUG FIX (2026-08-22): 'pending' was NOT in this list — but
      validate_and_join_match() (the RPC that actually deducts the entry
      fee and creates the row) sets status='pending' by default. Money is
      already taken at that point; 'pending' here means room/attendance
      pending, NOT membership pending. Excluding it meant a player who
      had genuinely joined (and paid) simply never appeared in Joined
      Players / notification lists / refund lists until some OTHER admin
      action happened to flip status — confirmed live (Testing2: user
      showed 'Joined' in their own app but the row was invisible here).
      Now only the genuinely-not-joined terminal statuses are excluded. */
      var _NOT_JOINED=['cancelled','refunded','rejected','no_show'];
      var isJoined=(_NOT_JOINED.indexOf(j.status)===-1);
      if(tid===matchId&&isJoined){
        var uid=getUid(j);
        if(uid&&!notifiedUids[uid]){
          notifiedUids[uid]=true;
          notifyCount++;
          promises.push(rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({
            title:'🎮 Room Details!',
            message:'Match: '+(matchName||'Match')+'\nRoom ID: '+roomId+'\nPassword: '+roomPassword,
            matchId:matchId,
            roomId:roomId,
            roomPassword:roomPassword,
            timestamp:Date.now(),
            read:false,
            type:'room_released'
          }));
        }
      }
    });

    /* Also check matches/{id}/joined for direct joins NOT already covered above */
    var matchSnap=await rtdb.ref(DB_MATCHES+'/'+matchId+'/joined').once('value');
    if(matchSnap.exists()){
      matchSnap.forEach(function(playerSnap){
        var puid=playerSnap.key;
        if(puid&&!notifiedUids[puid]){
          notifiedUids[puid]=true;
          notifyCount++;
          promises.push(rtdb.ref(DB_USERS+'/'+puid+'/notifications').push({
            title:'🎮 Room Details!',
            message:'Match: '+(matchName||'Match')+'\nRoom ID: '+roomId+'\nPassword: '+roomPassword,
            matchId:matchId,
            roomId:roomId,
            roomPassword:roomPassword,
            timestamp:Date.now(),
            read:false,
            type:'room_released'
          }));
        }
      });
    }

    await Promise.all(promises);
    console.log('Room notification sent to '+notifyCount+' unique joined players of match: '+matchId);
    return notifyCount;
  }catch(e){
    console.error('sendRoomNotificationToMatch error:',e);
    return 0;
  }
}

/* cancelTournament — auto-refund ALL joined players
   Checks BOTH joinRequests/ AND matches/{id}/joined/ for players
   Refunds to deposit balance (paid) or coins (coin matches)
*/
async function cancelTournament(id){
  if(!confirm('Cancel & refund ALL joined players?\n\nThis will:\n• Set status to "cancelled"\n• Refund entry fee to ALL joined players\n• Send notification to each player'))return;
  try{
    var t=allTournaments[id];
    var entryFee=t?Number(t.entryFee)||0:0;
    var matchName=t?t.name:'Match';
    var isC=t&&t.entryType==='coin';
    var pr=[];
    var rc=0;
    var refundedUids={};  /* Track to avoid double refunds */
    
    /* ── Check joinRequests/ node ── */
    var jS=await rtdb.ref(DB_JOIN).once('value');
    jS.forEach(function(c){
      var j=c.val(),tid=j.tournamentId||j.matchId;
      /* ✅ BUG FIX (2026-08-22): 'pending' was NOT in this list — but
      validate_and_join_match() (the RPC that actually deducts the entry
      fee and creates the row) sets status='pending' by default. Money is
      already taken at that point; 'pending' here means room/attendance
      pending, NOT membership pending. Excluding it meant a player who
      had genuinely joined (and paid) simply never appeared in Joined
      Players / notification lists / refund lists until some OTHER admin
      action happened to flip status — confirmed live (Testing2: user
      showed 'Joined' in their own app but the row was invisible here).
      Now only the genuinely-not-joined terminal statuses are excluded. */
      var _NOT_JOINED=['cancelled','refunded','rejected','no_show'];
      var isJoined=(_NOT_JOINED.indexOf(j.status)===-1);
      if(tid===id&&isJoined){
        var uid=getUid(j);
        var fee=Number(j.entryFee)||entryFee;
        /* ✅ Bug 8 Fix: isC from joinRequest's own entryType (not just match entryType) */
        var jIsC = j.entryType === 'coin' || j.entryType === 'coins' || isC;
        var supaCol = jIsC ? 'coins' : 'sky_diamonds';
        if(uid&&fee&&!refundedUids[uid]){
          rc++;
          refundedUids[uid]=true;
          /* Firebase RTDB update (admin-supabase-sync.js will also sync) */
          var rp1=jIsC?'coins':'realMoney/deposited',rp2=jIsC?null:'wallet/depositBalance';
          pr.push(rtdb.ref(DB_USERS+'/'+uid+'/'+rp1).transaction(function(v){return(v||0)+fee}));
          if(rp2)pr.push(rtdb.ref(DB_USERS+'/'+uid+'/'+rp2).transaction(function(v){return(v||0)+fee}));
          pr.push(rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:'refund',amount:fee,description:'Cancelled: '+matchName,timestamp:Date.now()}));
          pr.push(rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'Match Cancelled 🚫',message:matchName+' cancelled. '+(jIsC?fee+' coins':'💎'+fee)+' refunded.',timestamp:Date.now(),read:false}));
          /* ✅ Supabase sync — correct column per currency */
          if(window._supa){
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:supaCol,p_amount:fee}).then(null, function(){});
            window._supa.from('wallet_transactions').insert({user_id:uid,currency:supaCol,txn_type:'credit',amount:fee,reason:'match_refund',ref_id:id}).then(null, function(){});
            window._supa.from('join_requests').update({status:'refunded'}).eq('id',c.key).then(null, function(){});
          }
        }
        pr.push(rtdb.ref(DB_JOIN+'/'+c.key).update({status:'refunded'}));
      }
    });
    
    /* ── Also check matches/{id}/joined/ node for direct joins ── */
    var mJoined=await rtdb.ref(DB_MATCHES+'/'+id+'/joined').once('value');
    if(mJoined.exists()){
      mJoined.forEach(function(ps){
        var puid=ps.key;
        var pdata=ps.val();
        var fee=Number(pdata.entryFee)||entryFee;
        var pIsC = pdata.entryType === 'coin' || pdata.entryType === 'coins' || isC;
        var pSupaCol = pIsC ? 'coins' : 'sky_diamonds';
        if(!refundedUids[puid]&&fee){
          rc++;
          refundedUids[puid]=true;
          var rp1=pIsC?'coins':'realMoney/deposited',rp2=pIsC?null:'wallet/depositBalance';
          pr.push(rtdb.ref(DB_USERS+'/'+puid+'/'+rp1).transaction(function(v){return(v||0)+fee}));
          if(rp2)pr.push(rtdb.ref(DB_USERS+'/'+puid+'/'+rp2).transaction(function(v){return(v||0)+fee}));
          pr.push(rtdb.ref(DB_USERS+'/'+puid+'/transactions').push({type:'refund',amount:fee,description:'Cancelled: '+matchName,timestamp:Date.now()}));
          pr.push(rtdb.ref(DB_USERS+'/'+puid+'/notifications').push({title:'Match Cancelled 🚫',message:matchName+' cancelled. '+(pIsC?fee+' coins':'💎'+fee)+' refunded.',timestamp:Date.now(),read:false}));
          if(window._supa){
            window._supa.rpc('increment_balance',{p_uid:puid,p_col:pSupaCol,p_amount:fee}).then(null, function(){});
            window._supa.from('wallet_transactions').insert({user_id:puid,currency:pSupaCol,txn_type:'credit',amount:fee,reason:'match_refund',ref_id:id}).then(null, function(){});
          }
        }
      });
    }
    
    /* ── Set match status to cancelled ── */
    pr.push(rtdb.ref(DB_MATCHES+'/'+id).update({status:'cancelled',cancelledAt:Date.now(),cancelledBy:_adminUid()}));
    
    await Promise.all(pr);
    console.log('✅ Match cancelled: '+matchName+' — '+rc+' players refunded');
    showToast('✅ Cancelled — '+rc+' players refunded');
    loadTournaments();
  }catch(e){
    console.error('cancelTournament error:',e);
    showToast('Error: '+e.message,true);
  }
}
async function deleteTournament(id){
  /* Base implementation — security-patches.js overrides this with refund logic */
  if(!confirm('⚠️ Match delete karna hai? Joined players ko refund check kiya jayega.'))return;
  try{
    var DB_J=window.DB_JOIN||'joinRequests';
    /* Cancel all join requests first */
    var snap=await rtdb.ref(DB_J).orderByChild('matchId').equalTo(id).once('value');
    if(snap.exists()){
      var updates={};
      snap.forEach(function(c){updates[DB_J+'/'+c.key+'/status']='cancelled';});
      await rtdb.ref().update(updates);
    }
    await rtdb.ref(DB_MATCHES+'/'+id).remove();
    showToast('Deleted');loadTournaments();
  }catch(e){showToast('Error: '+e.message,true);}
}
/* syncTournamentStatuses — Auto-update DATABASE status based on time
   Uses the same 1-hour duration logic as getMatchStatus()
   
   ╔══════════════════════════════════════════════╗
   ║  AUTO-STATUS SYNC (runs every 30 seconds)   ║
   ║  ─────────────────────────────────────────── ║
   ║  upcoming → live:  now >= matchTime          ║
   ║  live → completed: now >= matchTime + 1 hour ║
   ║  ─────────────────────────────────────────── ║
   ║  NEVER auto-updates:                         ║
   ║  • resultPublished (admin published results) ║
   ║  • cancelled (admin cancelled match)         ║
   ╚══════════════════════════════════════════════╝
*/
async function syncTournamentStatuses(){
  try{
    var s=await rtdb.ref(DB_MATCHES).once('value');
    var now=Date.now();
    var updateCount=0;
    var logLines=[];
    
    s.forEach(function(c){
      var d=c.val(),id=c.key;
      var mt=Number(d.matchTime)||0;
      if(!mt)return;
      
      /* ⛔ Skip terminal states — these are admin-controlled, NEVER auto-change */
      if(d.status==='resultPublished'||d.status==='cancelled')return;
      
      /* Calculate what the status SHOULD be based on time using getMatchStatus */
      var calculatedStatus=getMatchStatus(mt).toLowerCase();
      var currentDbStatus=(d.status||'upcoming').toLowerCase();
      
      /* Only update database if the calculated status differs from current */
      if(calculatedStatus!==currentDbStatus){
        updateCount++;
        rtdb.ref(DB_MATCHES+'/'+id).update({status:calculatedStatus});
        logLines.push('  → '+d.name+': '+currentDbStatus+' → '+calculatedStatus);
      }
    });
    
    if(updateCount>0){
      console.log('⏱️ syncTournamentStatuses: Updated '+updateCount+' matches:');
      logLines.forEach(function(l){console.log(l);});
      /* Refresh UI after status changes */
      loadTournaments();
    }
  }catch(e){
    console.error('syncTournamentStatuses error:',e);
  }
}

/* =============================================
   JOINED PLAYERS — FIXED: Properly fetches from joinRequests/
   Shows Player IGN, UID, FF UID, Teammates with IGN+UID
   ============================================= */
async function refreshJoinedPlayers(){
  showToast('Refreshing joined players...');
  try{
    /* Reload join requests from Firebase joinRequests node */
    var jS=await rtdb.ref(DB_JOIN).once('value');
    allJoinRequests={};
    jS.forEach(function(c){
      allJoinRequests[c.key]=c.val();
    });
    
    /* Also check matches/{matchId}/joined for direct joins */
    var mS=await rtdb.ref(DB_MATCHES).once('value');
    mS.forEach(function(mc){
      var m=mc.val(),mid=mc.key;
      if(m.joined&&typeof m.joined==='object'){
        Object.keys(m.joined).forEach(function(uid){
          var jData=m.joined[uid];
          /* Create a synthetic join request entry */
          var syntheticKey='joined_'+mid+'_'+uid;
          if(!allJoinRequests[syntheticKey]){
            allJoinRequests[syntheticKey]={
              matchId:mid,
              tournamentId:mid,
              uid:uid,
              oderId:uid,
              playerName:jData.playerName||jData.ign||getUserName(uid),
              ign:jData.ign||jData.playerName,
              ffUid:jData.ffUid||jData.gameUid||'',
              entryFee:jData.entryFee||m.entryFee||0,
              status:'approved',
              joinedAt:jData.joinedAt||jData.timestamp||Date.now(),
              teammates:jData.teammates||[],
              source:'matches_joined_node'
            };
            console.log('Found direct join: '+uid+' in matches/'+mid+'/joined');
          }
        });
      }
    });
    
    loadJoinedPlayers();
    showToast('Joined players refreshed!');
  }catch(e){
    console.error('refreshJoinedPlayers error:',e);
    showToast('Error: '+e.message,true);
  }
}

async function loadJoinedPlayers(){
  var f=document.getElementById('joinedTournamentFilter').value;
  var tb=document.getElementById('joinedPlayersTable');
  tb.innerHTML='<tr><td colspan="8" class="text-muted text-xs" style="text-align:center;padding:14px"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';
  var c=0;
  var keys=Object.keys(allJoinRequests);

  if(keys.length===0){
    tb.innerHTML='<tr><td colspan="8" class="text-muted text-xs" style="text-align:center;padding:20px">No players joined yet.</td></tr>';
    document.getElementById('joinedCount').textContent=0;
    return;
  }

  var rowsData=[];
  keys.forEach(function(k){
    var j=allJoinRequests[k];
    /* ✅ BUG FIX (2026-08-22): 'pending' was NOT in this list — but
      validate_and_join_match() (the RPC that actually deducts the entry
      fee and creates the row) sets status='pending' by default. Money is
      already taken at that point; 'pending' here means room/attendance
      pending, NOT membership pending. Excluding it meant a player who
      had genuinely joined (and paid) simply never appeared in Joined
      Players / notification lists / refund lists until some OTHER admin
      action happened to flip status — confirmed live (Testing2: user
      showed 'Joined' in their own app but the row was invisible here).
      Now only the genuinely-not-joined terminal statuses are excluded. */
      var _NOT_JOINED=['cancelled','refunded','rejected','no_show'];
      var isJoined=(_NOT_JOINED.indexOf(j.status)===-1);
    if(!isJoined)return;
    var tid=j.tournamentId||j.matchId;
    if(f!=='all'&&tid!==f)return;
    c++;
    var match=allTournaments[tid];
    var tn=match?match.name:'Unknown Match';
    var gameMode=match?(match.gameMode||match.matchType||'solo').toLowerCase():'solo';
    var mode=gameMode.toUpperCase();
    var modeBadgeColor=gameMode==='squad'?'purple':gameMode==='duo'?'cyan':'blue';
    var dt=(j.joinedAt||j.createdAt)?new Date(j.joinedAt||j.createdAt).toLocaleString('en-IN'):'N/A';
    var uid=getUid(j)||j.oderId||'';
    var nm=j.playerName||j.ign||j.userName||getUserName(uid)||'Player';
    var ffUid=j.ffUid||j.userFFUID||j.gameUid||j.playerFfUid||'N/A';
    var reqKey=k;
    rowsData.push({uid:uid,nm:nm,ffUid:ffUid,tn:tn,mode:mode,modeBadgeColor:modeBadgeColor,gameMode:gameMode,dt:dt,j:j,entryFee:j.entryFee||0,tid:tid,reqKey:reqKey,phone:'',verified:j.adminVerified||false});
  });

  /* Batch fetch phone numbers from users table */
  var allUids=[...new Set(rowsData.map(function(r){return r.uid;}).filter(Boolean))];
  if(allUids.length>0){
    try{
      await Promise.all(allUids.map(function(uid){
        return rtdb.ref(DB_USERS+'/'+uid+'/phone').once('value').then(function(s){
          var ph=s.val()||'';
          rowsData.forEach(function(r){if(r.uid===uid)r.phone=ph;});
        });
      }));
    }catch(e){console.log('phone fetch error:',e);}
  }

  /* Batch fetch FF UIDs if missing */
  var missingFf=rowsData.filter(function(r){return !r.ffUid||r.ffUid==='N/A';}).map(function(r){return r.uid;});
  if(missingFf.length>0){
    try{
      await Promise.all(missingFf.map(function(uid){
        return rtdb.ref(DB_USERS+'/'+uid+'/ffUid').once('value').then(function(s){
          var ff=s.val()||'N/A';
          rowsData.forEach(function(r){if(r.uid===uid)r.ffUid=ff;});
        });
      }));
    }catch(e){}
  }

  tb.innerHTML='';
  var rendered={};
  var isFiltered=(f!=='all');

  /* Helper: Slot badge */
  function _slotBadge(slot) {
    /* Bug#31 Fix: Show "Solo" instead of "—" for players with no slot number */
    if (!slot) return '<span style="font-size:10px;color:rgba(255,255,255,.3);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:2px 8px">Solo</span>';
    /* Bug#1 Fix: escape slot value before inserting into HTML */
    var _safeSlot=String(slot).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return '<span style="background:linear-gradient(135deg,rgba(0,212,255,.2),rgba(185,100,255,.2));border:1.5px solid rgba(0,212,255,.5);color:#00d4ff;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800;font-family:monospace;display:inline-block">' + _safeSlot + '</span>';
  }

  /* Helper: In Room badge */
  function _inRoomBadge(inRoom, inRoomAt) {
    if (inRoom) {
      var t = inRoomAt ? new Date(inRoomAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';
      return '<div style="display:inline-flex;flex-direction:column;align-items:center;gap:2px">' +
        '<span style="background:rgba(0,255,156,.15);border:1.5px solid #00ff9c;color:#00ff9c;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;white-space:nowrap"><i class="fas fa-gamepad" style="margin-right:3px"></i>In Room</span>' +
        (t ? '<span style="font-size:8px;color:rgba(0,255,156,.6)">' + t + '</span>' : '') +
      '</div>';
    }
    return '<span style="background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.3);border-radius:20px;padding:3px 10px;font-size:10px;font-weight:600;white-space:nowrap">Pending</span>';
  }

  /* Helper: verify checkbox */
  function _verifyChk(reqKey,verified){
    var chkId='vchk_'+reqKey;
    return '<td style="text-align:center;vertical-align:middle">'+
      '<div class="verify-chk-wrap" id="vwrap_'+reqKey+'" onclick="toggleVerify(\''+reqKey+'\',this)" title="Click to verify player in room" style="'+
        'width:36px;height:36px;border-radius:8px;border:2px solid '+(verified?'#00ff9c':'rgba(255,255,255,.2)')+';'+
        'background:'+(verified?'rgba(0,255,156,.12)':'rgba(255,255,255,.04)')+';'+
        'display:flex;align-items:center;justify-content:center;cursor:pointer;margin:auto;transition:all .2s">'+
        '<i class="fas fa-check" style="font-size:16px;color:'+(verified?'#00ff9c':'rgba(255,255,255,.2)')+'"></i>'+
      '</div></td>';
  }

  /* Helper: solo row */
  function _renderSoloRow(r){
    var j=r.j;
    var sb=j.resultStatus==='completed'?'<span class="badge blue">Done</span>':'<span class="badge green">Joined</span>';
    return '<tr data-uid="'+r.uid+'" data-mid="'+r.tid+'">'+
      /* Col 1: Player Name */
      '<td style="min-width:140px">'+
        '<span class="badge primary" style="font-size:11px;font-weight:700;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block" title="'+r.nm+'">'+r.nm+'</span>'+
      '</td>'+
      /* Col 2: Slot */
      '<td style="text-align:center;min-width:70px">'+_slotBadge(r.j.slotNumber)+'</td>'+
      /* Col 3: FF UID */
      '<td style="min-width:110px">'+
        '<span class="font-mono" style="font-size:11px;color:var(--info);background:rgba(0,212,255,.1);padding:2px 7px;border-radius:4px;display:inline-block">'+(r.ffUid&&r.ffUid!=='N/A'?r.ffUid:'—')+'</span>'+
      '</td>'+
      /* Col 3: Phone */
      '<td style="min-width:100px">'+
        '<span style="font-size:11px;color:var(--text-muted);font-family:monospace">'+(r.phone||'—')+'</span>'+
      '</td>'+
      /* Col 4: Match */
      '<td style="min-width:120px"><span class="text-xs">'+r.tn+'</span></td>'+
      /* Col 5: Mode */
      '<td><span class="badge '+r.modeBadgeColor+'">'+r.mode+'</span></td>'+
      /* Col 6: Entry */
      '<td><span style="font-weight:700">₹'+r.entryFee+'</span></td>'+
      /* Col 7: Joined At */
      '<td class="text-xxs" style="min-width:130px">'+r.dt+'</td>'+
      /* Col 8: Status */
      '<td>'+sb+'</td>'+
      /* Col 9: In Room */
      '<td style="text-align:center">'+_inRoomBadge(r.j.inRoom, r.j.inRoomAt)+'</td>'+
      /* Col 10: Verify */
      _verifyChk(r.reqKey,r.verified)+
    '</tr>';
  }

  /* Helper: team member mini-row inside glow box */
  function _teamMemberRow(m,isCap){
    var roleBadge=isCap
      ?'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(0,212,255,.15);color:#00d4ff;font-weight:700">&#128081; Cap</span>'
      :'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(255,215,0,.12);color:#ffd700;font-weight:700">Member</span>';
    var ffStr=(m.ffUid&&m.ffUid!=='N/A')?m.ffUid:'—';
    var phStr=m.phone||'—';
    var sb=m.j.resultStatus==='completed'?'<span class="badge blue" style="font-size:9px">Done</span>':'<span class="badge green" style="font-size:9px">Joined</span>';
    return '<div style="display:grid;grid-template-columns:130px 65px 120px 100px 110px 55px 45px 130px 65px 80px 44px;align-items:center;gap:6px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:4px">'+
      /* Col 1: Name + role */
      '<div style="min-width:0">'+
        '<div style="display:flex;flex-direction:column;gap:3px">'+
          '<span class="badge primary" style="font-size:11px;font-weight:700;max-width:125px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+m.nm+'">'+m.nm+'</span>'+
          roleBadge+
        '</div>'+
      '</div>'+
      /* Col 2: Slot */
      '<div style="display:flex;justify-content:center">'+_slotBadge(m.j.slotNumber)+'</div>'+
      /* Col 3: FF UID */
      '<div>'+
        '<span class="font-mono" style="font-size:10px;color:var(--info);background:rgba(0,212,255,.1);padding:2px 6px;border-radius:4px;display:inline-block">'+ffStr+'</span>'+
      '</div>'+
      /* Col 3: Phone */
      '<div>'+
        '<span style="font-size:10px;color:var(--text-muted);font-family:monospace">'+phStr+'</span>'+
      '</div>'+
      /* Col 4: Match */
      '<div>'+
        '<span class="text-xs" style="color:var(--text-muted)">'+m.tn+'</span>'+
      '</div>'+
      /* Col 5: Mode */
      '<div>'+
        '<span class="badge '+m.modeBadgeColor+'" style="font-size:9px">'+m.mode+'</span>'+
      '</div>'+
      /* Col 6: Entry */
      '<div>'+
        '<span style="font-size:11px;font-weight:700">₹'+m.entryFee+'</span>'+
      '</div>'+
      /* Col 7: Joined At */
      '<div>'+
        '<span class="text-xxs" style="color:var(--text-muted)">'+m.dt+'</span>'+
      '</div>'+
      /* Col 8: Status */
      '<div>'+sb+'</div>'+
      /* Col 9: In Room */
      '<div style="display:flex;justify-content:center">'+_inRoomBadge(m.j.inRoom, m.j.inRoomAt)+'</div>'+
      /* Col 10: Verify */
      '<div style="display:flex;justify-content:center">'+
        '<div data-rk="'+m.reqKey+'" onclick="toggleVerify(this.dataset.rk,this)" class="tm-vchk" style="width:36px;height:36px;border-radius:8px;border:2px solid '+(m.verified?'#00ff9c':'rgba(255,255,255,.2)')+';background:'+(m.verified?'rgba(0,255,156,.12)':'rgba(255,255,255,.04)')+';display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s">'+
          '<i class="fas fa-check" style="font-size:15px;color:'+(m.verified?'#00ff9c':'rgba(255,255,255,.2)')+'"></i>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  /* Render all rows */
  rowsData.forEach(function(r){
    var mid=r.tid;
    var mode=r.gameMode;
    var rkey=r.uid+mid;
    if(rendered[rkey])return;

    if(mode==='solo'){
      rendered[rkey]=true;
      tb.innerHTML+=_renderSoloRow(r);
      return;
    }

    // Duo/Squad: find teammates in same match
    var teamMates=[];
    rowsData.forEach(function(other){
      if(other===r)return;
      var omid=other.tid;
      if(omid!==mid)return;
      // Group: same captain (either both have same captainUid, or one is captain of the other)
      var rCap = r.j.captainUid;
      var oCap = other.j.captainUid;
      var isMate = false;
      if (rCap && oCap && rCap === oCap) isMate = true;          // same captain
      else if (rCap === other.uid) isMate = true;                  // r's captain is the other
      else if (oCap === r.uid) isMate = true;                      // other's captain is r
      if(isMate)teamMates.push(other);
    });

    var allTeam=[r].concat(teamMates);
    allTeam.forEach(function(m){rendered[m.uid+mid]=true;});

    var teamColor=mode==='squad'?'#b964ff':'#00d4ff';
    var glowShadow=mode==='squad'?'0 0 12px rgba(185,100,255,.25)':'0 0 12px rgba(0,212,255,.25)';
    var teamSb=r.j.resultStatus==='completed'?'<span class="badge blue">Done</span>':'<span class="badge green">Joined</span>';

    var memberRows=allTeam.map(function(m,i){
      var isCap=(i===0&&!m.j.isTeamMember)||m.j.captainUid===undefined;
      return _teamMemberRow(m,isCap);
    }).join('');

    tb.innerHTML+='<tr>'+
      '<td colspan="11" style="padding:6px 10px">'+
        '<div style="border:1px solid '+teamColor+'55;border-radius:10px;padding:10px;background:'+teamColor+'06;box-shadow:'+glowShadow+'">'+
          '<div style="font-size:10px;color:'+teamColor+';font-weight:700;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">'+
            '<span><i class="fas fa-users" style="margin-right:5px"></i>'+mode.toUpperCase()+' Team · '+r.tn+'</span>'+
            '<span style="display:flex;gap:6px;align-items:center">'+
              '<span class="badge '+r.modeBadgeColor+'">'+r.mode+'</span>'+
              teamSb+
              '<span class="text-xxs text-muted">'+r.dt+'</span>'+
              '<span class="text-xxs" style="background:rgba(255,255,255,.06);padding:1px 8px;border-radius:8px">₹'+r.entryFee+'</span>'+
            '</span>'+
          '</div>'+
          '<div style="display:grid;grid-template-columns:130px 65px 120px 100px 110px 55px 45px 130px 65px 80px 44px;gap:6px;padding:4px 10px 8px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:6px">'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">PLAYER</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35);text-align:center">SLOT</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">FF UID</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">PHONE</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">MATCH</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">MODE</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">ENTRY</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">JOINED AT</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">STATUS</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35);text-align:center">IN ROOM</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35);text-align:center">VERIFY</div>'+
          '</div>'+
          memberRows+
        '</div>'+
      '</td>'+
    '</tr>';
  });

  if(tb.innerHTML===''){
    tb.innerHTML='<tr><td colspan="8" class="text-muted text-xs" style="text-align:center;padding:20px">No players found.</td></tr>';
  }
  document.getElementById('joinedCount').textContent=c;
}


var resultScreenshots = [];

function addResultScreenshots(inp) {
  var files = inp.files; if (!files || !files.length) return;
  var grid = document.getElementById('screenshotPreviewGrid');
  var count = document.getElementById('screenshotCount');
  Array.from(files).forEach(function(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      resultScreenshots.push(e.target.result);
      if (!resultScreenshotBase64) resultScreenshotBase64 = e.target.result;
      if (grid) {
        var idx2 = resultScreenshots.length - 1;
        var div2 = document.createElement('div');
        div2.style.cssText = 'position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.1)';
        div2.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover">'
          + '<button onclick="removeScreenshot(' + idx2 + ')" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:#ff4444;color:#fff;border:none;font-size:10px;cursor:pointer;line-height:1">×</button>';
        grid.appendChild(div2);
      }
      if (count) count.textContent = resultScreenshots.length + ' selected';
    };
    reader.readAsDataURL(file);
  });
  inp.value = '';
}

function removeScreenshot(idx3) {
  resultScreenshots.splice(idx3, 1);
  if (resultScreenshots.length === 0) resultScreenshotBase64 = '';
  else resultScreenshotBase64 = resultScreenshots[0];
  var grid = document.getElementById('screenshotPreviewGrid');
  var count = document.getElementById('screenshotCount');
  if (grid) { var divs = Array.from(grid.children); if (divs[idx3]) grid.removeChild(divs[idx3]); }
  if (count) count.textContent = resultScreenshots.length + ' selected';
}

function previewResultScreenshot(inp){
  addResultScreenshots(inp);
}

async function loadParticipants(){
  var mid=document.getElementById('resultTournamentSelect').value,ct=document.getElementById('resultsContainer'),ls=document.getElementById('participantsList');
  if(!mid){ct.style.display='none';return;}
  ct.style.display='block';
  ls.innerHTML='<tr><td colspan="11" class="text-muted text-xs" style="padding:12px;text-align:center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';
  try{
    /* Always fetch fresh from Firebase — allTournaments cache might miss perKillPrize */
    var _freshSnap = await rtdb.ref('matches/'+mid).once('value');
    if (_freshSnap.exists()) {
      currentTournamentData = _freshSnap.val();
      currentTournamentData._id = mid;
      /* Also update allTournaments cache */
      allTournaments[mid] = currentTournamentData;
    } else {
      currentTournamentData = allTournaments[mid] || {};
    }
    var t=currentTournamentData;
    ls.setAttribute('data-pk', Number(t.perKillPrize)||0);
    ls.setAttribute('data-f1', Number(t.firstPrize)||0);
    ls.setAttribute('data-f2', Number(t.secondPrize)||0);
    ls.setAttribute('data-f3', Number(t.thirdPrize)||0);
    /* Set _MRD right here — this is the latest fresh data */
    window._MRD = {f1:Number(t.firstPrize)||0, f2:Number(t.secondPrize)||0, f3:Number(t.thirdPrize)||0, pk:Number(t.perKillPrize)||0};
    /* Show per kill info too */
    var _pk=Number(t.perKillPrize)||0, _f1=Number(t.firstPrize)||0, _f2=Number(t.secondPrize)||0, _f3=Number(t.thirdPrize)||0;
    var pkInfo = _pk ? ' | <span style="color:#ff9c00">💀 Per Kill: ₹'+_pk+'</span>' : '';
    document.getElementById('resultTournamentInfo').innerHTML='<div class="flex justify-between mb-1"><span class="text-dim">1st/2nd/3rd:</span><strong>₹'+_f1+' / ₹'+_f2+' / ₹'+_f3+'</strong>'+pkInfo+'</div>';
    
    // Load existing results (if already published) to pre-fill rank/kills
    var existingResults = {};
    var _resSnap = await rtdb.ref('results').orderByChild('matchId').equalTo(mid).once('value');
    if (_resSnap.exists()) {
      _resSnap.forEach(function(c){ var d=c.val(); if(d && d.userId) existingResults[d.userId] = d; });
    }
    
    var jS=await rtdb.ref(DB_JOIN).once('value');var html='',pc=0;
    /* ✅ R24 FIX: RPC-join (validate_and_join_match) rows are status='pending'
       (money already deducted — pending = room/attendance pending, NOT membership
       pending, same semantics as sendRoomNotificationToMatch's _NOT_JOINED list).
       Old filter (approved/joined/confirmed only) hid PAID players from the
       result-publish screen ("No participants found") — live-proven R24 E2E. */
    var _RJ_NOT_JOINED=['cancelled','refunded','rejected','no_show'];
    jS.forEach(function(c){
      var j=c.val(),tid=j.tournamentId||j.matchId;
      if(tid===mid&&_RJ_NOT_JOINED.indexOf(j.status)===-1){pc++;
        var uid=getUid(j);
        var nm=j.playerName||j.ign||j.userName||getUserName(uid)||'Unknown';
        var ff=j.ffUid||j.userFFUID||j.gameUid||j.playerFfUid||'-';
        var slot=j.slotNumber||j.slot||'-';
        var phone=j.phone||j.userPhone||'-';
        var mode=(j.mode||t&&t.mode||'solo').toUpperCase();
        var entry=j.entryFee||t&&t.entryFee||0;
        var joinedAt=j.createdAt||j.timestamp||j.joinedAt||0;
        var joinedStr=joinedAt ? new Date(joinedAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}) : '-';
        var jFeeType = j.feeType || 'captain_pays';
        var jCaptainUid = j.captainUid || '';
        var jIsTeamMember = j.isTeamMember ? '1' : '0';
        
        // Pre-fill rank/kills if result already exists
        var er = existingResults[uid] || {};
        var preRank = er.rank || 0;
        var preKills = er.kills || 0;
        var preRp = er.winnings || 0;
        
        // Show badge if this player's winnings go to captain (captain_pays + isTeamMember)
        var feeNote = (jFeeType==='captain_pays' && jIsTeamMember==='1') 
          ? '<span style="font-size:9px;background:rgba(0,212,255,.12);color:#00d4ff;padding:1px 5px;border-radius:4px;margin-left:4px">Cap Paid</span>'
          : (jFeeType==='each_pays' ? '<span style="font-size:9px;background:rgba(0,255,156,.1);color:#00ff9c;padding:1px 5px;border-radius:4px;margin-left:4px">Self Paid</span>' : '');
        
        html += '<tr data-uid="'+uid+'" data-reqid="'+c.key+'" data-name="'+nm.toLowerCase()+'" data-feetype="'+jFeeType+'" data-captainuid="'+jCaptainUid+'" data-isteam="'+jIsTeamMember+'">'
          +'<td style="color:#666;font-size:11px;padding:5px 4px">'+pc+'</td>'
          +'<td style="padding:5px 4px"><div style="font-size:12px;font-weight:700;color:var(--primary)">'+nm+feeNote+'</div></td>'
          +'<td style="padding:5px 4px;color:#00d4ff;font-family:monospace;font-size:10px">'+ff+'</td>'
          +'<td style="padding:5px 4px;color:#aaa;font-size:11px">'+slot+'</td>'
          +'<td style="padding:5px 4px;color:#aaa;font-size:11px">'+phone+'</td>'
          +'<td style="padding:5px 4px;color:#aaa;font-size:10px;font-weight:700">'+mode+'</td>'
          +'<td style="padding:5px 4px;color:#ffd700;font-size:11px">&#8377;'+entry+'</td>'
          +'<td style="padding:5px 4px;color:#aaa;font-size:10px">'+joinedStr+'</td>'
          +'<td style="padding:5px 4px"><input type="number" class="rank-input" placeholder="0" min="0" value="'+preRank+'" style="width:44px;padding:4px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);color:var(--text);font-size:12px;text-align:center;font-weight:700" oninput="calcPrize(this)"></td>'
          +'<td style="padding:5px 4px"><input type="number" class="kills-input" placeholder="0" min="0" value="'+preKills+'" style="width:44px;padding:4px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);color:var(--text);font-size:12px;text-align:center;font-weight:700" oninput="calcPrize(this)"></td>'
          +'<td class="prize-cell" style="padding:5px 4px;font-weight:800;color:'+(preRp>0?'var(--primary)':'#aaa')+';font-size:11px">&#8377;'+preRp+'</td>'
          +'</tr>';
      }
    });
    ls.innerHTML=html||'<tr><td colspan="11" class="text-muted text-xs" style="padding:16px;text-align:center">No participants found for this match</td></tr>';
    /* Auto-recalculate prize preview for all pre-filled rows */
    setTimeout(function(){
      ls.querySelectorAll('tr').forEach(function(row){
        var ki=row.querySelector('.kills-input');
        if(ki) calcPrize(ki);
      });
    }, 50);
  }catch(e){
    ls.innerHTML='<tr><td colspan="11" class="text-danger text-xs" style="padding:12px;text-align:center">Error: '+e.message+'</td></tr>';
    console.error('loadParticipants error:', e);
  }
}
function calcPrize(inp){
  var row = inp.closest('tr');
  var k = Number(row.querySelector('.kills-input').value)||0;
  var r = Number(row.querySelector('.rank-input').value)||0;
  /* Read prize data from tbody data attributes — bulletproof, no global dependency */
  var tb = document.getElementById('participantsList');
  var f1 = tb ? Number(tb.dataset.f1)||0 : 0;
  var f2 = tb ? Number(tb.dataset.f2)||0 : 0;
  var f3 = tb ? Number(tb.dataset.f3)||0 : 0;
  var pk = tb ? Number(tb.dataset.pk)||0 : 0;
  /* Fallback chain */
  if(!f1 && !f2 && !f3){
    f1=window._cF1||0; f2=window._cF2||0; f3=window._cF3||0; pk=window._cPK||0;
  }
  if(!f1 && !f2 && !f3 && window.currentTournamentData){
    var _t=window.currentTournamentData;
    f1=Number(_t.firstPrize)||0; f2=Number(_t.secondPrize)||0; f3=Number(_t.thirdPrize)||0; pk=Number(_t.perKillPrize)||0;
  }

  /* AUTO-FILL TEAM rank */
  var isRankInput = inp.classList.contains('rank-input');
  if(isRankInput && r > 0){
    var captUid = row.dataset.captainuid || '';
    var isTeam = row.dataset.isteam === '1';
    var thisUid = row.dataset.uid || '';
    var allRows = document.querySelectorAll('#participantsList tr');
    allRows.forEach(function(oRow){
      if(oRow===row) return;
      var oCap=oRow.dataset.captainuid||'', oUid=oRow.dataset.uid||'';
      var same = (captUid&&oCap===captUid)||(captUid&&oUid===captUid)||(!isTeam&&oCap===thisUid);
      if(!same) return;
      var oRI=oRow.querySelector('.rank-input');
      if(oRI&&(!oRI.value||oRI.value=='0')){oRI.value=r;calcPrize(oRI);}
    });
    /* Duplicate rank check */
    if(r>=1&&r<=3){
      var dup=false;
      allRows.forEach(function(oRow){
        if(oRow===row||oRow.dataset.isteam==='1') return;
        var oUid2=oRow.dataset.uid||'', oCap2=oRow.dataset.captainuid||'';
        if(oUid2===captUid||(captUid&&oCap2===captUid)||(!isTeam&&oCap2===thisUid)) return;
        var oRI2=oRow.querySelector('.rank-input');
        if(oRI2&&Number(oRI2.value)===r) dup=true;
      });
      var cell=row.querySelector('.prize-cell');
      if(dup){cell.innerHTML='<span style="color:#ff4444;font-size:10px;font-weight:800">⚠️ Dup #'+r+'!</span>';row.style.background='rgba(255,0,0,.06)';return;}
      else row.style.background='';
    }
  }

  var rp = r===1?f1:r===2?f2:r===3?f3:0;
  var kp = k*pk;
  var isTM = row.dataset.isteam==='1';
  var ft = row.dataset.feetype||'each_pays';
  var tw = (isTM&&ft==='captain_pays') ? 0 : (rp+kp);
  var cell = row.querySelector('.prize-cell');
  if(isTM&&ft==='captain_pays'){
    cell.style.color='#555';
    cell.innerHTML='<span style="font-size:9px;color:#555">→ Cap</span>';
  } else {
    cell.style.color = tw>0?'var(--primary)':'#aaa';
    var bd = (rp||kp)?'<br><span style="font-size:9px;color:#888">'+(rp?'R:₹'+rp:'')+(rp&&kp?'+':'')+(kp?k+'k×₹'+pk:'')+'</span>':'';
    cell.innerHTML='<span style="font-weight:800">₹'+tw+'</span>'+bd;
  }
}

function filterParticipants(s){s=s.toLowerCase();document.querySelectorAll('#participantsList tr').forEach(function(r){r.style.display=(r.dataset.name||'').indexOf(s)>=0?'':'none';});}

/* Bug 17 Fix: Processing flag — prevents double submission */
var _publishResultsInProgress = false;

async function publishResults(){
  if(_publishResultsInProgress){ showToast('Publishing already in progress...', true); return; }
  _publishResultsInProgress = true;
  var _pubBtn = document.getElementById('publishResultsBtn');
  if(_pubBtn){ _pubBtn.disabled = true; _pubBtn.style.opacity = '0.6'; }

  var mid=document.getElementById('resultTournamentSelect').value;
  if(!mid){ _publishResultsInProgress=false; if(_pubBtn){_pubBtn.disabled=false;_pubBtn.style.opacity='';} return showToast('Select match',true); }
  var t=currentTournamentData;
  
  // DOUBLE PAYMENT GUARD — check Supabase result_published_at (source of truth)
  var alreadyPublished = false;
  try {
    if (window._supa) {
      var _pubChk = await window._supa.from('matches').select('result_published_at').eq('id', mid).single();
      alreadyPublished = !!(_pubChk.data && _pubChk.data.result_published_at);
    }
    if (!alreadyPublished) {
      /* Fallback: check Firebase status too */
      var _existSnap = await rtdb.ref(DB_MATCHES + '/' + mid + '/status').once('value');
      alreadyPublished = (_existSnap.val() === 'resultPublished');
    }
  } catch(e) { alreadyPublished = false; }
  
  if(alreadyPublished){
    if(!confirm('⚠️ Results already published!\n\nKya aap results CORRECT karna chahte ho?\n\n• Zyada paise mile the → extra wapas katenge\n• Kam paise mile the → baaki add honge\n• Users ko notification milegi reason ke saath')) return;
  } else {
    if(!confirm('Publish & distribute prizes?')) return;
  }
  
  var rows=document.querySelectorAll('#participantsList tr[data-uid]');
  if(!rows.length) return showToast('No participants',true);
  
  /* ✅ Bug 8 Fix: DUPLICATE RANK CHECK — ALL ranks, ALL modes */
  var rankMap = {};
  var dupError = false;
  var matchMode = (currentTournamentData && currentTournamentData.mode || currentTournamentData && currentTournamentData.type || 'solo').toLowerCase();
  var isSoloMode = matchMode === 'solo';
  rows.forEach(function(row){
    if(row.dataset.isteam === '1') return; // skip team members for rank check (team leaders only)
    var ri = row.querySelector('.rank-input');
    var rank = ri ? Number(ri.value) : 0;
    if(rank >= 1){
      if(rankMap[rank]){
        var dupName = row.querySelector('td') ? row.querySelector('td').textContent : ('UID:' + row.dataset.uid);
        showToast('❌ Duplicate Rank #' + rank + ' — do players ko ek rank nahi de sakte! Fix karo.', true);
        row.style.background = 'rgba(255,0,0,.12)';
        /* Also highlight the first duplicate row */
        rows.forEach(function(r2){ if(r2.dataset.uid === rankMap[rank]) r2.style.background = 'rgba(255,0,0,.12)'; });
        dupError = true;
      } else {
        rankMap[rank] = row.dataset.uid;
      }
    }
  });
  /* For solo mode: verify ranks are sequential (1,2,3...) with no gaps if prize positions filled */
  if(isSoloMode && !dupError){
    var allRanks = Object.keys(rankMap).map(Number).filter(function(r){ return r >= 1; }).sort(function(a,b){return a-b;});
    /* Just check no duplicates — gaps allowed (not all players need to be ranked) */
  }
  if(dupError) return;
  
  var pubBtn=document.getElementById('publishResultsBtn');
  setLoading(pubBtn,true);
  
  try{
    // Load existing results if correction mode
    var existingResults={};
    if(alreadyPublished){
      var _eRes=await rtdb.ref('results').orderByChild('matchId').equalTo(mid).once('value');
      if(_eRes.exists()) _eRes.forEach(function(c){ var d=c.val(); if(d&&d.userId) existingResults[d.userId]=d; });
    }
    
    // Upload result screenshots via ImgBB (Firebase Storage removed — not configured)
    var uploadedUrls=[];
    if(resultScreenshots.length>0 && typeof window.uploadToImgBB==='function'){
      for(var si=0;si<resultScreenshots.length;si++){
        try{
          var _imgName='result_'+mid+'_'+Date.now()+'_'+si;
          var sUrl=await new Promise(function(resolve){
            window.uploadToImgBB(resultScreenshots[si],_imgName,function(err,url){resolve(err?null:url);});
          });
          if(sUrl) uploadedUrls.push(sUrl);
        }catch(se){ console.warn('Screenshot upload failed:',se); }
      }
    }
    if(uploadedUrls.length>0){
      await rtdb.ref(DB_MATCHES+'/'+mid+'/resultScreenshot').set(uploadedUrls[0]);
    /* ✅ FIX 9: Also save screenshot to Supabase matches.result_screenshot */
    if (window._supa) {
      window._supa.from('matches').update({ result_screenshot: uploadedUrls[0] }).eq('id', mid).then(null, function(){});
    }
      await rtdb.ref(DB_MATCHES+'/'+mid+'/resultScreenshots').set(uploadedUrls);
    }
    
    var totalPlayers=rows.length;
    window._captainExtraWin = {}; // reset captain extra winnings tracker
    var _failedUids = []; /* Track failed players for retry/report */
    
    for(var i=0;i<rows.length;i++){
      var row=rows[i];
      var uid=row.dataset.uid;
      var rid=row.dataset.reqid;
      /* ── Per-player individual try/catch: one failure NEVER stops others ── */
      try {
      var rank=Number(row.querySelector('.rank-input').value)||0;
      var kills=Number(row.querySelector('.kills-input').value)||0;
      var rowFeeType = row.dataset.feetype || 'captain_pays';
      var rowIsTeam = row.dataset.isteam === '1';
      var rowCaptainUid = row.dataset.captainuid || '';
      
      var rp=0;
      /* Use _MPD (set at load time from fresh Firebase fetch) for prize values */
      var _pd = window._MRD || {};
      var _f1 = _pd.f1 || (t?Number(t.firstPrize)||0:0);
      var _f2 = _pd.f2 || (t?Number(t.secondPrize)||0:0);
      var _f3 = _pd.f3 || (t?Number(t.thirdPrize)||0:0);
      var perKill = _pd.pk || (t?Number(t.perKillPrize)||0:0);
      if(rank===1) rp=_f1;
      else if(rank===2) rp=_f2;
      else if(rank===3) rp=_f3;
      var killPrize = kills * perKill;
      var tw = rp + killPrize; // rank prize + kill prize
      
      /* captain_pays + isTeamMember: this player's winnings go to captain instead */
      /* We still record rank/kills for the team member but tw=0 for them */
      /* Captain's tw will be accumulated from all team members' prizes */
      if (rowFeeType === 'captain_pays' && rowIsTeam) {
        /* Store this team member's prize to be given to captain later */
        if (!window._captainExtraWin) window._captainExtraWin = {};
        if (!window._captainExtraWin[rowCaptainUid]) window._captainExtraWin[rowCaptainUid] = 0;
        window._captainExtraWin[rowCaptainUid] += tw;
        tw = 0; // team member gets nothing
      } else if (rowFeeType === 'captain_pays' && !rowIsTeam) {
        /* Captain row: add team members' prizes to captain's total (collected above) */
        var extra = (window._captainExtraWin && window._captainExtraWin[uid]) || 0;
        tw += extra;
      }
      
      if(alreadyPublished){
        // CORRECTION MODE: calculate delta
        var oldResult=existingResults[uid]||{};
        var oldTw=oldResult.winnings||oldResult.totalWinning||0;
        var delta=tw-oldTw;
        
        // Update result records
        await rtdb.ref(DB_MATCHES+'/'+mid+'/results/'+uid).update({rank:rank,kills:kills,killPrize:killPrize,rankPrize:rp,totalWinning:tw,correctedAt:Date.now()});
        await rtdb.ref(DB_JOIN+'/'+rid).update({kills:kills,rank:rank,killPrize:killPrize,rankPrize:rp,reward:tw,resultStatus:'completed'});
        
        // Apply delta to user wallet
        if(delta!==0){
          /* ✅ R24 FIX: wallet/winningBalance (→green_diamonds, same column as
             realMoney/winnings) and totalWinnings (→total_winnings, same column
             as stats/earnings) were DOUBLE-applying every correction delta in
             Supabase. One canonical path per column now. */
          await rtdb.ref(DB_USERS+'/'+uid+'/realMoney/winnings').transaction(function(v){return Math.max(0,(v||0)+delta);});
          await rtdb.ref(DB_USERS+'/'+uid+'/stats/earnings').transaction(function(v){return Math.max(0,(v||0)+delta);});
          
          // Transaction record with reason
          var deltaReason=delta>0
            ? '+'+'₹'+delta+' added — '+( t?t.name:'Match')+' result correction (Rank #'+rank+')'
            : '₹'+Math.abs(delta)+' adjusted — '+(t?t.name:'Match')+' result correction (Rank #'+rank+')';
          await rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:delta>0?'correction_credit':'correction_debit',amount:Math.abs(delta),description:deltaReason,timestamp:Date.now()});
          
          // Notification with reason
          var notifMsg=delta>0
            ? '✅ Result correction: ₹'+delta+' add kiya gaya. Match: '+(t?t.name:'')+', Rank #'+rank+'. Reason: Pehle record mein galti thi.'
            : '⚠️ Result correction: ₹'+Math.abs(delta)+' adjust kiya gaya. Match: '+(t?t.name:'')+', Rank #'+rank+'. Reason: Pehle zyada prize distribute hua tha.';
          await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'🔧 Result Correction',message:notifMsg,timestamp:Date.now(),read:false,type:'correction',uid:uid});
        }
        
        // Update kills stats delta
        var oldKills=oldResult.kills||0;
        var killDelta=kills-oldKills;
        if(killDelta!==0){
          /* ✅ R24 FIX: totalKills txn removed — bridge maps it to the SAME
             supa column (total_kills) as stats/kills below → killDelta was
             applied twice. stats/kills is the single canonical path. */
          await rtdb.ref(DB_USERS+'/'+uid+'/stats/kills').transaction(function(v){return Math.max(0,(v||0)+killDelta);});
        }
        
      } else {
        // FIRST PUBLISH (normal flow)
        await rtdb.ref(DB_MATCHES+'/'+mid+'/results/'+uid).set({rank:rank,kills:kills,killPrize:killPrize,rankPrize:rp,totalWinning:tw,timestamp:Date.now()});
        var resultPushRef=rtdb.ref('results').push();
        await resultPushRef.set({userId:uid,matchId:mid,matchName:t?t.name:'',rank:rank,kills:kills,killPrize:killPrize,rankPrize:rp,winnings:tw,won:rank===1,entryFee:t?t.entryFee||0:0,totalPlayers:totalPlayers,timestamp:Date.now(),createdAt:Date.now(),synced:false,cashbackGiven:false});
        await rtdb.ref(DB_JOIN+'/'+rid).update({kills:kills,rank:rank,killPrize:killPrize,rankPrize:rp,reward:tw,resultStatus:'completed'});
        /* ✅ FIX (2026-08-18): removed the `userMatches/...` result write —
           user_matches has no kills/rank/kill_prize/rank_prize/reward/
           result_status columns (REST 42703) and the filter never matched
           (id=uid vs real UUID), so it always failed/affected 0 rows. The
           authoritative result record is matches/{id}/results/{uid} (above)
           and the join_requests row; user_matches is not read by the user
           panel (verified) nor kept in sync, so dropping it loses nothing. */
        /* ✅ R24 FIX (stats triple-count): the bridge maps BOTH users/{uid}/totalKills
           AND users/{uid}/stats/kills to the SAME supa column total_kills
           (USER_FIELD_MAP + NESTED_FIELD_MAP), and the supa-block below ALSO
           incremented total_kills via RPC — live-proven +6 kills per +2-kill
           publish. Same for totalWinnings/stats/earnings → total_winnings
           (×2) and stats/wins + total_wins RPC (×2). Each metric now written
           EXACTLY ONCE via its canonical stats/* path; only rank_points and
           total_matches stay RPC (no RTDB path writes them). */
        await rtdb.ref(DB_USERS+'/'+uid+'/stats/kills').transaction(function(v){return(v||0)+kills;});
        if(tw>0){
          // Credit prize to correct currency based on prizeType
          /* ✅ Prize type: paid/SD entry → Green Diamond prize (non-withdrawable) | coin entry → coin prize */
          var _prizeType = t ? (t.prizeType || (
            (t.entryType==='paid' || t.entryType==='sky_diamond' || t.entryType==='skyDiamond') ? 'greenDiamond' :
            t.entryType==='coin' ? 'coin' : 'coin'
          )) : 'coin';
          var _pricePath = _prizeType==='greenDiamond' ? '/greenDiamonds' : _prizeType==='skyDiamond' ? '/skyDiamonds' : '/coins';
          var _prizeSymbol = _prizeType==='greenDiamond' ? '<img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block">' : _prizeType==='skyDiamond' ? '💎' : '🪙';
          await rtdb.ref(DB_USERS+'/'+uid+_pricePath).transaction(function(v){return(v||0)+tw;});
          await rtdb.ref(DB_USERS+'/'+uid+'/stats/earnings').transaction(function(v){return(v||0)+tw;});
          /* ✅ R24 FIX: totalWinnings txn removed — bridge maps it to the SAME
             supa column (total_winnings) as stats/earnings above → prizes were
             counted twice in total_winnings. stats/earnings is canonical. */
          if(rank===1){
            await rtdb.ref(DB_USERS+'/'+uid+'/stats/wins').transaction(function(v){return(v||0)+1;});
            await rtdb.ref(DB_USERS+'/'+uid+'/stats/winStreak').transaction(function(v){return(v||0)+1;});
          } else {
            await rtdb.ref(DB_USERS+'/'+uid+'/stats/winStreak').set(0);
          }
          var breakdownMsg = (rp>0?'Rank #'+rank+' = '+_prizeSymbol+rp:'') + (killPrize>0?(rp>0?' + ':'')+kills+' kills × '+_prizeSymbol+perKill+' = '+_prizeSymbol+killPrize:'');
          await rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:'winning',currency:_prizeType,amount:tw,description:(t?t.name:'Match')+' — '+breakdownMsg,timestamp:Date.now()});
          var winMsg='🏆 '+_prizeSymbol+tw+' jeeta! '+(t?t.name:'')+' — '+(rank?'Rank #'+rank+': '+_prizeSymbol+rp+', ':'')+(kills+' Kills: '+_prizeSymbol+killPrize)+'. Wallet mein add ho gaye.';
          /* Bug Critical #1 Fix: dual-write notification to Firebase + Supabase */
          await window._adminNotifyUser(uid,{title:'🏆 Match Result!',message:winMsg,type:'result',matchId:mid});
          /* Bug Critical #5 Fix: Credit prize in Supabase wallet_transactions */
          if(window._supa && tw > 0){
            var _supaCurrency = _prizeType==='greenDiamond'?'green_diamonds':_prizeType==='skyDiamond'?'sky_diamonds':'coins';
            /* ✅ R24 FIX (double-credit #2): NO increment_balance here!
               The rtdb.ref(DB_USERS+'/'+uid+_pricePath).transaction() above is
               already translated by the supabase-rtdb-bridge into a single
               atomic Supabase users.coins/sky_diamonds update (supaTransaction
               nested-field handler). This block's own increment_balance ran ON
               TOP of that — every winner got paid TWICE in Supabase (live-proven
               E2E twice: 450→478 and 292→320 instead of 464/306). Keep the
               ledger row + join_requests/stats bookkeeping below; the balance
               move itself happens exactly once via the bridge. */
            window._supa.from('wallet_transactions').insert({user_id:uid,txn_type:'match_win',currency:_supaCurrency,amount:tw,ref_id:mid,description:(t?t.name:'Match')+' — Rank #'+rank+' prize'}).then(null, function(){});
            window._supa.from('join_requests').update({status:'completed',placement:rank,prize_earned:tw,kills:kills}).eq('user_id',uid).eq('match_id',mid).then(null, function(){});
            /* ✅ BUG 2 FIX: Update rank_points + stats in Supabase (leaderboard uses these) */
            var _rankPts = rank===1?25 : rank===2?15 : rank===3?10 : rank<=10?5 : 1;
            var _killRankPts = Math.min(kills, 3); /* cap kill bonus at 3 pts */
            var _totalRankPts = _rankPts + _killRankPts;
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'rank_points',p_amount:_totalRankPts}).then(null, function(){});
            /* ✅ R24 FIX (stats triple-count): total_kills/total_wins RPCs removed —
               stats/kills and stats/wins RTDB txns above ALREADY reach these same
               columns via the bridge (NESTED_FIELD_MAP). The win_streak read-modify
               block also removed — stats/winStreak txn covers win_streak; the old
               read+cur+1 raced the bridge txn and bumped it twice. */
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'total_matches',p_amount:1}).then(null, function(){});
            /* ✅ Insert match_results row for Supabase analytics */
            window._supa.from('match_results').upsert({match_id:mid,user_id:uid,placement:rank,kills:kills,prize:tw},{onConflict:'match_id,user_id'}).then(null, function(e){ console.error('[publishResults] match_results upsert FAIL uid='+uid+':', e && (e.message||e.code)); window._supaResultErrors=(window._supaResultErrors||0)+1; });
          }
        } else {
          await rtdb.ref(DB_USERS+'/'+uid+'/stats/winStreak').set(0);
          var noWinMsg='📋 '+(t?t.name:'')+' ka result publish ho gaya! Tumhara rank: '+(rank?'#'+rank:'Unranked')+', Kills: '+kills+'. Better luck next time! 💪';
          /* Bug Critical #1 Fix: dual-write notification */
          await window._adminNotifyUser(uid,{title:'📋 Result Published — Dekho!',message:noWinMsg,type:'result',matchId:mid});
          /* ✅ Mark join_request completed + update stats for non-winners */
          if(window._supa){
            window._supa.from('join_requests').update({status:'completed',placement:rank,prize_earned:0,kills:kills}).eq('user_id',uid).eq('match_id',mid).then(null, function(){});
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'rank_points',p_amount:1}).then(null, function(){}); /* participation point */
            /* ✅ R24 FIX: total_kills RPC removed here too — the unconditional
               stats/kills RTDB txn already covers total_kills via the bridge. */
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'total_matches',p_amount:1}).then(null, function(){});
            window._supa.from('users').update({win_streak:0}).eq('id',uid).then(null, function(){});
            window._supa.from('match_results').upsert({match_id:mid,user_id:uid,placement:rank,kills:kills,prize:0},{onConflict:'match_id,user_id'}).then(null, function(e){ console.error('[publishResults] match_results upsert FAIL (non-winner) uid='+uid+':', e && (e.message||e.code)); window._supaResultErrors=(window._supaResultErrors||0)+1; });
          }
        }
        // Cashback removed — no real money refund
        // Platform profit tracking
        var entryF=t?t.entryFee||0:0;
        await rtdb.ref('platformEarnings').push({matchId:mid,entryFee:entryF,prizeGiven:tw,profit:entryF-tw,userId:uid,timestamp:Date.now()});
        // lastResult for recap
        await rtdb.ref(DB_USERS+'/'+uid+'/lastResult').set({rank:rank,kills:kills,winnings:tw,matchName:t?t.name:'',matchId:mid,timestamp:Date.now()});
      }
      } catch(_playerErr) {
        /* One player failed — log it but CONTINUE with next player */
        console.error('[publishResults] Player ' + uid + ' failed:', _playerErr && _playerErr.message);
        _failedUids.push(uid);
        /* Mark this row red so admin can see which player failed */
        try { rows[i].style.background = 'rgba(255,60,60,0.15)'; } catch(e) {}
        /* Continue loop — don't break */
        continue;
      }
    }
    /* Report failures if any */
    if (_failedUids.length > 0) {
      showToast('⚠️ ' + _failedUids.length + ' player(s) mein error — red rows check karo, dubara publish karo', true);
    }
    
    // Update match status
    if(!alreadyPublished){
      await rtdb.ref(DB_MATCHES+'/'+mid).update({status:'resultPublished',resultPublishedAt:Date.now()});
      /* ✅ FIX 10: Set result_published_at in Supabase — prevents double-publish on reload */
      if(window._supa) window._supa.from('matches').update({
        status: 'completed',
        result_published_at: new Date().toISOString()
      }).eq('id', mid).then(null, function(){});
    /* Update season stats for all players
       ✅ R24 FIX: the RTDB seasonStats transaction was a silent no-op — the
       bridge intercepts it, and its generic supa-transaction path has NO
       insert fallback (live-proven: season_stats had 0 rows even after
       multiple publishes). Write the real season_stats table directly
       (read-modify-upsert on month_key+user_id). */
    rows.forEach(function(row){
      var rUid=row.dataset.uid; if(!rUid || !window._supa) return;
      var rKills=Number(row.querySelector('.kills-input').value)||0;
      var rRank=Number(row.querySelector('.rank-input').value)||0;
      var now=new Date(); var monthKey=now.getFullYear()+'_'+String(now.getMonth()+1).padStart(2,'0');
      window._supa.from('season_stats').select('wins,kills,matches').eq('month_key',monthKey).eq('user_id',rUid).maybeSingle()
        .then(function(r){
          var cur=(r && r.data)||{wins:0,kills:0,matches:0};
          return window._supa.from('season_stats').upsert({
            month_key:monthKey, user_id:rUid,
            kills:(cur.kills||0)+rKills,
            matches:(cur.matches||0)+1,
            wins:(cur.wins||0)+(rRank===1?1:0)
          },{onConflict:'month_key,user_id'});
        }).then(null, function(e){ console.warn('[publishResults] season_stats upsert fail', rUid, e && e.message); });
    });
    } else {
      await rtdb.ref(DB_MATCHES+'/'+mid).update({resultCorrectedAt:Date.now()});
    }
    
    resultScreenshots=[];
    var ssP=document.getElementById('ssPreview');if(ssP)ssP.innerHTML='';
    var ssC=document.getElementById('screenshotCount');if(ssC)ssC.textContent='0 selected';
    
    setLoading(pubBtn,false);
    showToast(alreadyPublished?'✅ Result correction done! Users notified.':'✅ Results published! Prizes distributed.');
    loadParticipants();
    _publishResultsInProgress = false;
    if(_pubBtn){ _pubBtn.disabled = false; _pubBtn.style.opacity = ''; }
  }catch(err){
    setLoading(pubBtn,false);
    _publishResultsInProgress = false;
    if(_pubBtn){ _pubBtn.disabled = false; _pubBtn.style.opacity = ''; }
    showToast('Error: '+err.message,true);
    console.error('publishResults error:',err);
  }
}
/* ✅ REMOVED (2026-08-19): setupWalletListener() and its helper
   _refreshSdRequestsIntoWallet() deleted along with the rest of the
   Wallet Requests tab — see the sidebar nav-item removal comment in
   index.html for the full explanation. Sky Diamond purchase AND
   withdrawal requests are now read directly by
   loadSkyDiamondReqSection() (Supabase sd_requests, both request
   types); Sponsored Prize withdrawals are read directly by
   admin-supabase-sponsored.js's loadSponsoredWithdrawals() (Supabase
   wallet_transactions) — neither needs this merged Firebase+Supabase
   listener anymore. */
/* ✅ Audit Fix: allJoinRequests was only refreshed inside loadTournaments()/refreshJoinedPlayers()
   (both one-time .once('value') reads). New joins made after the admin opened the panel never
   appeared until an explicit manual reload. A live listener keeps it continuously in sync,
   same pattern as setupWalletListener/setupUsersListener above. */
