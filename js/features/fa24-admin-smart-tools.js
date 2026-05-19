/* =============================================
   ADMIN FEATURES A24-A43: 20 New Smart Tools
   ============================================= */
(function(){ 'use strict';
var rtdb = function() { return window.rtdb || window.db; };

/* ─── A24: QUICK MATCH STATUS CHANGER ─── */
window.showQuickStatusPanel = function() {
  var rt = rtdb(); if (!rt) return;
  var h = '<div style="padding:4px">';
  h += '<div style="font-size:12px;color:#aaa;margin-bottom:12px">Kisi bhi match ka status ek click mein change karo</div>';
  var matches = window.allTournaments || {};
  Object.keys(matches).forEach(function(mid) {
    var m = matches[mid]; if (!m) return;
    var st = m.status || 'upcoming';
    var stColor = st==='live'?'#00ff9c':st==='completed'?'#aaa':st==='resultPublished'?'#ffd700':'#00d4ff';
    h += '<div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:6px;border:1px solid rgba(255,255,255,.06)">';
    h += '<div style="flex:1;font-size:12px;font-weight:600">' + (m.name||mid) + '</div>';
    h += '<span style="font-size:10px;color:'+stColor+';font-weight:700">' + st.toUpperCase() + '</span>';
    h += '<select onchange="window._changeMatchStatus(\''+mid+'\',this.value)" style="background:#111;border:1px solid #333;color:#fff;padding:3px 6px;border-radius:6px;font-size:11px">';
    ['upcoming','live','completed','resultPublished','cancelled'].forEach(function(s) {
      h += '<option value="'+s+'"'+(s===st?' selected':'')+'>'+s+'</option>';
    });
    h += '</select></div>';
  });
  if (!Object.keys(matches).length) h += '<div style="text-align:center;padding:20px;color:#aaa">No matches loaded. Matches section mein jao pehle.</div>';
  h += '</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='⚡ Quick Status';mb.innerHTML=h;m.classList.add('show');}
};
window._changeMatchStatus = async function(mid, newStatus) {
  var rt = rtdb(); if (!rt) return;
  try {
    await rt.ref('matches/'+mid+'/status').set(newStatus);
    if (window.showToast) showToast('✅ Status changed to '+newStatus);
    if (window.loadTournaments) loadTournaments();
  } catch(e) { if(window.showToast) showToast('Error: '+e.message, true); }
};

/* ─── A25: PRIZE POOL CALCULATOR ─── */
window.showPrizeCalc = function() {
  var h = '<div style="padding:4px">';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
  h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Entry Fee (₹)</label><input type="number" id="pcFee" class="form-input" placeholder="e.g. 20" oninput="window._calcPrize()" min="0"></div>';
  h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Max Players</label><input type="number" id="pcPlayers" class="form-input" placeholder="e.g. 12" oninput="window._calcPrize()" min="1"></div>';
  h += '</div>';
  h += '<div style="margin-bottom:8px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Platform Cut %</label><input type="number" id="pcCut" class="form-input" value="15" oninput="window._calcPrize()" min="0" max="50"></div>';
  h += '<div id="pcResult" style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);border-radius:10px;padding:12px;min-height:80px;font-size:13px"></div>';
  h += '</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='🧮 Prize Calculator';mb.innerHTML=h;m.classList.add('show');}
};
window._calcPrize = function() {
  var fee=Number((document.getElementById('pcFee')||{}).value)||0;
  var players=Number((document.getElementById('pcPlayers')||{}).value)||0;
  var cut=Number((document.getElementById('pcCut')||{}).value)||15;
  var el=document.getElementById('pcResult'); if(!el) return;
  if(!fee||!players){el.innerHTML='<span style="color:#aaa">Enter fee and players...</span>';return;}
  var total=fee*players, profit=Math.round(total*cut/100), pool=total-profit;
  var p1=Math.round(pool*0.5), p2=Math.round(pool*0.3), p3=Math.round(pool*0.2);
  el.innerHTML='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">'
    +'<div>💰 Total Collected</div><div style="font-weight:700;color:#00ff9c">₹'+total+'</div>'
    +'<div>📊 Your Profit ('+cut+'%)</div><div style="font-weight:700;color:#ffd700">₹'+profit+'</div>'
    +'<div>🏆 Prize Pool</div><div style="font-weight:700;color:#00d4ff">₹'+pool+'</div>'
    +'<div>🥇 1st Prize</div><div style="font-weight:700;color:#ffd700">₹'+p1+'</div>'
    +'<div>🥈 2nd Prize</div><div style="font-weight:700;color:#c0c0c0">₹'+p2+'</div>'
    +'<div>🥉 3rd Prize</div><div style="font-weight:700;color:#cd7f32">₹'+p3+'</div>'
    +'</div>';
};

/* ─── A26: PLAYER BLACKLIST MANAGER ─── */
window.showBlacklist = async function() {
  var rt = rtdb(); if (!rt) return;
  var h = '<div style="padding:4px">';
  try {
    var snap = await rt.ref('blacklist').once('value');
    var list = [];
    if (snap.exists()) snap.forEach(function(c){ list.push({key:c.key, val:c.val()}); });
    h += '<div style="display:flex;gap:8px;margin-bottom:12px">';
    h += '<input type="text" id="blFF" class="form-input" placeholder="FF UID to blacklist" style="flex:1">';
    h += '<input type="text" id="blReason" class="form-input" placeholder="Reason" style="flex:1">';
    h += '<button onclick="window._addBlacklist()" style="padding:8px 12px;border-radius:8px;background:rgba(255,68,68,.15);border:1px solid rgba(255,68,68,.3);color:#ff4444;cursor:pointer;font-weight:700;white-space:nowrap"><i class="fas fa-ban"></i> Add</button>';
    h += '</div>';
    if (list.length) {
      list.forEach(function(item) {
        var v = item.val;
        h += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,68,68,.06);border:1px solid rgba(255,68,68,.15);border-radius:8px;margin-bottom:6px">';
        h += '<div style="flex:1"><div style="font-size:12px;font-weight:700;color:#ff6b6b;font-family:monospace">'+(v.ffUid||item.key)+'</div>';
        h += '<div style="font-size:10px;color:#aaa">'+(v.reason||'No reason')+'</div></div>';
        h += '<button onclick="window._removeBlacklist(\''+item.key+'\')" style="padding:4px 8px;border-radius:6px;background:rgba(255,68,68,.1);border:none;color:#ff4444;cursor:pointer;font-size:11px">Remove</button>';
        h += '</div>';
      });
    } else {
      h += '<div style="text-align:center;padding:20px;color:#aaa">Blacklist empty</div>';
    }
  } catch(e) { h += '<div style="color:#ff4444">Error: '+e.message+'</div>'; }
  h += '</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='🚫 Blacklist Manager';mb.innerHTML=h;m.classList.add('show');}
};
window._addBlacklist = async function() {
  var rt = rtdb(); if (!rt) return;
  var ff=(document.getElementById('blFF')||{}).value||'', reason=(document.getElementById('blReason')||{}).value||'Fraud';
  if(!ff){if(window.showToast)showToast('FF UID enter karo',true);return;}
  await rt.ref('blacklist/'+ff).set({ffUid:ff, reason:reason, addedAt:Date.now()});
  if(window.showToast)showToast('✅ Blacklisted: '+ff);
  window.showBlacklist();
};
window._removeBlacklist = async function(key) {
  var rt = rtdb(); if (!rt) return;
  await rt.ref('blacklist/'+key).remove();
  if(window.showToast)showToast('Removed from blacklist');
  window.showBlacklist();
};

/* ─── A27: DAILY EARNINGS REPORT ─── */
window.showDailyReport = async function() {
  var rt = rtdb(); if (!rt) return;
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(!m||!mt||!mb) return;
  mt.innerHTML='📊 Daily Earnings Report';
  mb.innerHTML='<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="color:#00ff9c;font-size:20px"></i><div style="margin-top:8px;color:#aaa">Calculating...</div></div>';
  m.classList.add('show');
  try {
    var today=new Date(); today.setHours(0,0,0,0);
    var todayMs=today.getTime();
    var [wrSnap, rSnap] = await Promise.all([rt.ref('walletRequests').once('value'), rt.ref('results').once('value')]);
    var todayDep=0, todayWin=0, todayTxns=0;
    if(wrSnap.exists()) wrSnap.forEach(function(c){
      var w=c.val(); if(!w) return;
      var ts=w.timestamp||w.createdAt||0;
      if(ts<todayMs) return;
      if(w.type==='deposit'&&w.status==='approved') todayDep+=Number(w.amount)||0;
    });
    if(rSnap.exists()) rSnap.forEach(function(c){
      var r=c.val(); if(!r) return;
      var ts=r.timestamp||r.createdAt||0;
      if(ts<todayMs) return;
      todayWin+=Number(r.winnings)||0; todayTxns++;
    });
    var profit=todayDep-todayWin;
    var h='<div style="padding:4px">';
    var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    h+='<div style="text-align:center;font-size:11px;color:#aaa;margin-bottom:12px">'+new Date().toDateString()+' ('+days[new Date().getDay()]+')</div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
    h+='<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:#00ff9c">₹'+todayDep+'</div><div style="font-size:11px;color:#aaa">Deposits Today</div></div>';
    h+='<div style="background:rgba(255,100,100,.06);border:1px solid rgba(255,100,100,.15);border-radius:12px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:900;color:#ff6b6b">₹'+todayWin+'</div><div style="font-size:11px;color:#aaa">Prizes Distributed</div></div>';
    h+='</div>';
    h+='<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.2);border-radius:12px;padding:14px;text-align:center;margin-bottom:8px">';
    h+='<div style="font-size:11px;color:#aaa;margin-bottom:4px">NET PROFIT TODAY</div>';
    h+='<div style="font-size:32px;font-weight:900;color:'+(profit>=0?'#ffd700':'#ff4444')+'">₹'+profit+'</div>';
    h+='</div>';
    h+='<div style="font-size:12px;color:#aaa;text-align:center">'+todayTxns+' results published today</div>';
    h+='</div>';
    mb.innerHTML=h;
  } catch(e) { mb.innerHTML='<div style="color:#ff4444;padding:12px">Error: '+e.message+'</div>'; }
};

/* ─── A28: MASS BAN BY FF UID LIST ─── */
window.showMassBan = function() {
  var h='<div style="padding:4px">';
  h+='<div style="font-size:12px;color:#aaa;margin-bottom:8px">Multiple FF UIDs ko ek saath ban karo (ek per line)</div>';
  h+='<textarea id="massBanUIDs" style="width:100%;height:100px;padding:10px;border-radius:10px;background:#0a0a0a;border:1px solid #2a2a2a;color:#fff;font-family:monospace;font-size:12px;resize:none;box-sizing:border-box" placeholder="476488&#10;12345678&#10;7298487277"></textarea>';
  h+='<div style="display:flex;gap:8px;margin-top:10px">';
  h+='<button onclick="window._doMassBan()" style="flex:1;padding:11px;border-radius:10px;background:rgba(255,68,68,.15);border:1px solid rgba(255,68,68,.3);color:#ff4444;font-weight:700;cursor:pointer"><i class="fas fa-ban"></i> Ban All</button>';
  h+='<button onclick="window._doMassBlacklist()" style="flex:1;padding:11px;border-radius:10px;background:rgba(255,170,0,.12);border:1px solid rgba(255,170,0,.25);color:#ffaa00;font-weight:700;cursor:pointer"><i class="fas fa-shield-halved"></i> Blacklist All</button>';
  h+='</div></div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='🚫 Mass Ban';mb.innerHTML=h;m.classList.add('show');}
};
window._doMassBan = async function() {
  var rt = rtdb(); if (!rt) return;
  var raw=(document.getElementById('massBanUIDs')||{}).value||'';
  var uids=raw.split('\n').map(function(s){return s.trim();}).filter(Boolean);
  if(!uids.length){if(window.showToast)showToast('UIDs enter karo',true);return;}
  if(!confirm(uids.length+' FF UIDs ko ban karna chahte ho?')) return;
  if(window.showToast)showToast('⏳ Banning...');
  var done=0, promises=[];
  // Use usersCache first (fast), fallback to Firebase
  var cache=window.usersCache||{};
  Object.keys(cache).forEach(function(firebaseUid){
    var u=cache[firebaseUid];
    if(u&&uids.indexOf(u.ffUid)>-1){
      done++;
      promises.push(rt.ref('users/'+firebaseUid).update({isBanned:true,blocked:true,banReason:'Mass ban - fraud',bannedAt:Date.now()}));
      promises.push(rt.ref('users/'+firebaseUid+'/notifications').push({title:'🚫 Account Banned',message:'Your account has been banned for fraudulent activity.',type:'system',timestamp:Date.now(),read:false}));
      // Update cache
      cache[firebaseUid].isBanned=true; cache[firebaseUid].blocked=true;
    }
  });
  // If nothing found in cache, fall back to DB
  if(!done){
    var usSnap=await rt.ref('users').once('value');
    usSnap.forEach(function(c){
      var u=c.val();
      if(u&&uids.indexOf(u.ffUid)>-1){
        done++;
        promises.push(rt.ref('users/'+c.key).update({isBanned:true,blocked:true,banReason:'Mass ban - fraud',bannedAt:Date.now()}));
      }
    });
  }
  await Promise.all(promises);
  if(window.showToast)showToast('✅ '+done+' users banned ('+uids.length+' UIDs given)');
  if(window.closeGenericModal)closeGenericModal();
};
window._doMassBlacklist = async function() {
  var rt = rtdb(); if (!rt) return;
  var raw=(document.getElementById('massBanUIDs')||{}).value||'';
  var uids=raw.split('\n').map(function(s){return s.trim();}).filter(Boolean);
  if(!uids.length){if(window.showToast)showToast('UIDs enter karo',true);return;}
  // Promise.all — parallel writes, fast
  await Promise.all(uids.map(function(ffUid){
    return rt.ref('blacklist/'+ffUid).set({ffUid:ffUid,reason:'Mass blacklist',addedAt:Date.now()});
  }));
  if(window.showToast)showToast('✅ '+uids.length+' UIDs blacklisted');
  if(window.closeGenericModal)closeGenericModal();
};

/* ─── A29: WITHDRAWAL SUMMARY ─── */
window.showWithdrawalSummary = async function() {
  var rt = rtdb(); if (!rt) return;
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(!m||!mt||!mb) return;
  mt.innerHTML='💸 Withdrawal Summary';
  mb.innerHTML='<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="color:#ffd700;font-size:20px"></i></div>';
  m.classList.add('show');
  try {
    var snap=await rt.ref('walletRequests').orderByChild('type').equalTo('withdraw').once('value');
    var pending=0,pAmt=0, approved=0,aAmt=0, rejected=0,rAmt=0;
    if(snap.exists()) snap.forEach(function(c){
      var w=c.val(); if(!w) return;
      var amt=Number(w.amount)||0;
      if(w.status==='pending'){pending++;pAmt+=amt;}
      else if(w.status==='approved'){approved++;aAmt+=amt;}
      else if(w.status==='rejected'){rejected++;rAmt+=amt;}
    });
    var h='<div style="padding:4px;display:grid;grid-template-columns:1fr;gap:8px">';
    h+='<div style="background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.2);border-radius:12px;padding:12px;display:flex;justify-content:space-between;align-items:center">';
    h+='<div><div style="font-size:13px;font-weight:700;color:#ffaa00">⏳ Pending</div><div style="font-size:11px;color:#aaa">'+pending+' requests</div></div>';
    h+='<div style="font-size:22px;font-weight:900;color:#ffaa00">₹'+pAmt+'</div></div>';
    h+='<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);border-radius:12px;padding:12px;display:flex;justify-content:space-between;align-items:center">';
    h+='<div><div style="font-size:13px;font-weight:700;color:#00ff9c">✅ Approved</div><div style="font-size:11px;color:#aaa">'+approved+' requests</div></div>';
    h+='<div style="font-size:22px;font-weight:900;color:#00ff9c">₹'+aAmt+'</div></div>';
    h+='<div style="background:rgba(255,68,68,.06);border:1px solid rgba(255,68,68,.15);border-radius:12px;padding:12px;display:flex;justify-content:space-between;align-items:center">';
    h+='<div><div style="font-size:13px;font-weight:700;color:#ff6b6b">❌ Rejected</div><div style="font-size:11px;color:#aaa">'+rejected+' requests</div></div>';
    h+='<div style="font-size:22px;font-weight:900;color:#ff6b6b">₹'+rAmt+'</div></div>';
    h+='</div>';
    mb.innerHTML=h;
  } catch(e){ mb.innerHTML='<div style="color:#ff4444;padding:12px">Error: '+e.message+'</div>'; }
};

/* ─── A30: MATCH CLONE ─── */
window.showMatchClone = function() {
  var matches=window.allTournaments||{};
  var h='<div style="padding:4px">';
  h+='<div style="font-size:12px;color:#aaa;margin-bottom:12px">Existing match ki copy banao naye time ke saath</div>';
  h+='<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Select Match to Clone</label>';
  h+='<select id="cloneMid" class="form-input"><option value="">-- Select --</option>';
  Object.keys(matches).forEach(function(mid){ h+='<option value="'+mid+'">'+(matches[mid].name||mid)+'</option>'; });
  h+='</select></div>';
  h+='<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">New Match Time</label>';
  h+='<input type="datetime-local" id="cloneTime" class="form-input"></div>';
  h+='<button onclick="window._doCloneMatch()" style="width:100%;padding:12px;border-radius:10px;background:linear-gradient(135deg,#00ff9c,#00cc7a);color:#000;font-weight:800;border:none;cursor:pointer"><i class="fas fa-copy"></i> Clone Match</button>';
  h+='</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='📋 Clone Match';mb.innerHTML=h;m.classList.add('show');}
};
window._doCloneMatch = async function() {
  var rt=rtdb(); if(!rt) return;
  var mid=(document.getElementById('cloneMid')||{}).value;
  var timeStr=(document.getElementById('cloneTime')||{}).value;
  if(!mid||!timeStr){if(window.showToast)showToast('Select match and time',true);return;}
  var orig=(window.allTournaments||{})[mid]; if(!orig){if(window.showToast)showToast('Match not found',true);return;}
  var clone=Object.assign({},orig);
  clone.matchTime=new Date(timeStr).getTime();
  clone.status='upcoming';
  clone.roomId='';clone.roomPassword='';clone.roomStatus='';
  clone.joinedSlots=0;clone.filledSlots=0;
  clone.name=clone.name+' (Copy)';
  clone.createdAt=Date.now();
  // Clean result-related fields from clone
  delete clone.resultPublished; delete clone.resultPublishedAt; delete clone.resultCorrectedAt;
  delete clone.resultScreenshot; delete clone.resultScreenshots; delete clone.results;
  delete clone.joined; // don't clone who joined
  var newKey=rt.ref('matches').push().key;
  await rt.ref('matches/'+newKey).set(clone);
  if(window.showToast)showToast('✅ Match cloned! ID: '+newKey);
  if(window.loadTournaments)loadTournaments();
  if(window.closeGenericModal)closeGenericModal();
};

/* ─── A31: PLAYER STATS RESET (for cheaters) ─── */
window.showStatsReset = function() {
  var h='<div style="padding:4px">';
  h+='<div style="background:rgba(255,68,68,.08);border:1px solid rgba(255,68,68,.2);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:#ff6b6b"><i class="fas fa-exclamation-triangle"></i> Warning: Yeh action undo nahi ho sakta!</div>';
  h+='<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Firebase UID (User)</label><input type="text" id="srUid" class="form-input" placeholder="User Firebase UID"></div>';
  h+='<div style="margin-bottom:12px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">What to reset?</label>';
  h+='<div style="display:flex;flex-direction:column;gap:6px">';
  ['stats (kills/matches/wins/earnings)','coins','referralCount','level'].forEach(function(opt,i){
    h+='<label style="display:flex;align-items:center;gap:8px;font-size:12px"><input type="checkbox" id="srOpt'+i+'" value="'+opt.split(' ')[0]+'"> '+opt+'</label>';
  });
  h+='</div></div>';
  h+='<button onclick="window._doStatsReset()" style="width:100%;padding:12px;border-radius:10px;background:rgba(255,68,68,.15);border:1.5px solid rgba(255,68,68,.3);color:#ff4444;font-weight:800;cursor:pointer"><i class="fas fa-redo"></i> Reset Selected</button>';
  h+='</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='🔄 Stats Reset';mb.innerHTML=h;m.classList.add('show');}
};
window._doStatsReset = async function() {
  var rt=rtdb(); if(!rt) return;
  var uid=(document.getElementById('srUid')||{}).value||'';
  if(!uid){if(window.showToast)showToast('Enter UID',true);return;}
  if(!confirm('Really reset?')) return;
  var opts=['stats','coins','referralCount','level'];
  var updates={};
  opts.forEach(function(opt,i){
    var cb=document.getElementById('srOpt'+i);
    if(cb&&cb.checked){
      if(opt==='stats') updates.stats={matches:0,kills:0,wins:0,earnings:0};
      else if(opt==='coins') updates.coins=0;
      else if(opt==='referralCount'){updates.referralCount=0;updates.referralCoinsEarned=0;}
      else if(opt==='level'){updates.level=1;updates.exp=0;}
    }
  });
  if(!Object.keys(updates).length){if(window.showToast)showToast('Select at least one option',true);return;}
  await rt.ref('users/'+uid).update(updates);
  if(window.showToast)showToast('✅ Stats reset done!');
  if(window.closeGenericModal)closeGenericModal();
};

/* ─── A32: MATCH REVENUE COMPARISON ─── */
window.showRevenueComparison = async function() {
  var rt=rtdb(); if(!rt) return;
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(!m||!mt||!mb) return;
  mt.innerHTML='📈 Revenue by Match';
  mb.innerHTML='<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="color:#00ff9c;font-size:20px"></i></div>';
  m.classList.add('show');
  try {
    var [jSnap,rSnap]=await Promise.all([rt.ref('joinRequests').once('value'),rt.ref('results').once('value')]);
    var matchFees={},matchPrizes={};
    var matches=window.allTournaments||{};
    if(jSnap.exists()) jSnap.forEach(function(c){ var j=c.val(); if(!j) return; var mid=j.matchId||j.tournamentId; if(!mid) return; matchFees[mid]=(matchFees[mid]||0)+Number(j.entryFee||0); });
    if(rSnap.exists()) rSnap.forEach(function(c){ var r=c.val(); if(!r) return; var mid=r.matchId||r.tournamentId; if(!mid) return; matchPrizes[mid]=(matchPrizes[mid]||0)+Number(r.winnings||0); });
    var allMids=Object.keys(Object.assign({},matchFees,matchPrizes));
    allMids.sort(function(a,b){return (matchFees[b]||0)-(matchFees[a]||0);});
    var h='<div style="padding:4px">';
    if(!allMids.length){h+='<div style="text-align:center;padding:20px;color:#aaa">No data yet</div>';mb.innerHTML=h+'</div>';return;}
    allMids.slice(0,10).forEach(function(mid){
      var fee=matchFees[mid]||0,prize=matchPrizes[mid]||0,profit=fee-prize;
      var name=(matches[mid]||{}).name||mid.substring(0,12);
      h+='<div style="padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:6px;border:1px solid rgba(255,255,255,.06)">';
      h+='<div style="font-size:12px;font-weight:700;margin-bottom:4px">'+name+'</div>';
      h+='<div style="display:flex;gap:12px;font-size:11px">';
      h+='<span style="color:#00ff9c">💰 Fees: ₹'+fee+'</span>';
      h+='<span style="color:#ff6b6b">🏆 Prizes: ₹'+prize+'</span>';
      h+='<span style="color:'+(profit>=0?'#ffd700':'#ff4444')+'">📊 Profit: ₹'+profit+'</span>';
      h+='</div></div>';
    });
    h+='</div>';
    mb.innerHTML=h;
  } catch(e){mb.innerHTML='<div style="color:#ff4444;padding:12px">Error: '+e.message+'</div>';}
};

/* ─── A33: USER NOTES / WATCHLIST ─── */
window.showUserNote = async function(uid, ign) {
  var rt=rtdb(); if(!rt) return;
  var snap=await rt.ref('adminNotes/'+uid).once('value');
  var existing=snap.val()||'';
  var h='<div style="padding:4px">';
  h+='<div style="font-size:12px;color:#aaa;margin-bottom:8px">User: <strong style="color:#fff">'+(ign||uid)+'</strong></div>';
  h+='<textarea id="noteText" style="width:100%;height:80px;padding:10px;border-radius:10px;background:#0a0a0a;border:1px solid #2a2a2a;color:#fff;font-size:13px;resize:none;box-sizing:border-box" placeholder="Admin note likhno...">'+existing+'</textarea>';
  h+='<div style="display:flex;gap:8px;margin-top:10px">';
  h+='<button onclick="window._saveNote(\''+uid+'\')" style="flex:1;padding:11px;border-radius:10px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-weight:700;cursor:pointer"><i class="fas fa-save"></i> Save</button>';
  h+='<button onclick="window._deleteNote(\''+uid+'\')" style="padding:11px 14px;border-radius:10px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);color:#ff4444;cursor:pointer"><i class="fas fa-trash"></i></button>';
  h+='</div></div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='📝 User Note';mb.innerHTML=h;m.classList.add('show');}
};
window._saveNote = async function(uid) {
  var rt=rtdb(); var txt=(document.getElementById('noteText')||{}).value||'';
  await rt.ref('adminNotes/'+uid).set(txt||null);
  if(window.showToast)showToast('✅ Note saved');
  if(window.closeGenericModal)closeGenericModal();
};
window._deleteNote = async function(uid) {
  var rt=rtdb();
  await rt.ref('adminNotes/'+uid).remove();
  if(window.showToast)showToast('Note deleted');
  if(window.closeGenericModal)closeGenericModal();
};

/* ─── A34: CHEAT DETECTION - ABNORMAL KILLS ─── */
window.showCheatDetection = async function() {
  var rt=rtdb(); if(!rt) return;
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(!m||!mt||!mb) return;
  mt.innerHTML='🕵️ Cheat Detection';
  mb.innerHTML='<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="color:#ff6b6b;font-size:20px"></i><div style="color:#aaa;margin-top:8px">Scanning results...</div></div>';
  m.classList.add('show');
  try {
    var threshold = window._cheatKillThreshold || 20;
    var rSnap=await rt.ref('results').once('value');
    var suspects=[];
    var cache = window.usersCache || {};
    if(rSnap.exists()) rSnap.forEach(function(c){
      var r=c.val(); if(!r) return;
      var kills=Number(r.kills||0), rank=Number(r.rank||99);
      var uid = r.userId || '';
      // Fix: get playerName from usersCache if not in result
      var playerName = r.playerName || r.userName || r.matchName ||
        (cache[uid] ? (cache[uid].ign || cache[uid].displayName) : '') || uid;
      // Suspicious: threshold+ kills OR rank 1 with 0 kills
      if(kills >= threshold || (rank===1 && kills===0)) {
        suspects.push({uid:uid, name:playerName, kills:kills, rank:rank, matchId:r.matchId||r.tournamentId, prize:r.winnings||0, resultKey:c.key});
      }
    });
    var h='<div style="padding:4px">';
    // Threshold control
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;background:rgba(255,255,255,.04);border-radius:8px;padding:8px 12px">';
    h+='<span style="font-size:11px;color:#aaa">Kill threshold:</span>';
    h+='<input type="number" id="cheatThreshold" value="'+threshold+'" min="5" max="50" style="width:55px;padding:4px;border-radius:6px;background:#111;border:1px solid #333;color:#ffd700;font-size:13px;text-align:center">';
    h+='<button onclick="window._cheatKillThreshold=Number(document.getElementById(\'cheatThreshold\').value)||20;window.showCheatDetection()" style="padding:4px 10px;border-radius:6px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-size:11px;cursor:pointer">Re-scan</button>';
    h+='</div>';
    if(!suspects.length){
      h+='<div style="text-align:center;padding:24px;color:#00ff9c"><div style="font-size:32px">✅</div><div style="font-size:14px;font-weight:700;margin-top:8px">Koi suspicious activity nahi (threshold: '+threshold+'+ kills)</div></div>';
    } else {
      h+='<div style="font-size:12px;color:#ffaa00;margin-bottom:10px">'+suspects.length+' suspicious result(s) ('+threshold+'+ kills):</div>';
      suspects.forEach(function(s){
        var matchName = (window.allTournaments&&window.allTournaments[s.matchId]) ? window.allTournaments[s.matchId].name : s.matchId;
        h+='<div style="background:rgba(255,100,0,.06);border:1px solid rgba(255,100,0,.2);border-radius:8px;padding:10px;margin-bottom:8px">';
        h+='<div style="display:flex;justify-content:space-between;align-items:flex-start">';
        h+='<div><div style="font-size:12px;font-weight:700;color:#ff8c00">'+s.name+'</div>';
        h+='<div style="font-size:11px;color:#aaa;margin-top:2px">Kills: <span style="color:#ff4444;font-weight:700">'+s.kills+'</span> | Rank: #'+s.rank+' | Prize: ₹'+s.prize+'</div>';
        h+='<div style="font-size:10px;color:#666;margin-top:2px">Match: '+(matchName||s.matchId)+'</div></div>';
        h+='</div>';
        if(s.uid){
          h+='<div style="display:flex;gap:6px;margin-top:8px">';
          h+='<button onclick="window.openUserModal&&openUserModal(\''+s.uid+'\')" style="flex:1;padding:6px;border-radius:7px;background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-size:11px;cursor:pointer">👁️ View</button>';
          h+='<button onclick="if(confirm(\'Ban '+s.name+'?\'))rtdb().ref(\'users/\'+\''+s.uid+'\').update({isBanned:true,blocked:true,banReason:\'Cheat detection: \'+'+s.kills+'+\' kills\',bannedAt:Date.now()}).then(function(){showToast(\'🚫 Banned!\');window.showCheatDetection();})" style="flex:1;padding:6px;border-radius:7px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.25);color:#ff4444;font-size:11px;cursor:pointer">🚫 Ban</button>';
          h+='</div>';
        }
        h+='</div>';
      });
    }
    h+='</div>';
    mb.innerHTML=h;
  } catch(e){mb.innerHTML='<div style="color:#ff4444;padding:12px">Error: '+e.message+'</div>';}
};

/* ─── A35: PLATFORM ANNOUNCEMENTS HISTORY ─── */
window.showAnnouncementHistory = async function() {
  var rt=rtdb(); if(!rt) return;
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(!m||!mt||!mb) return;
  mt.innerHTML='📢 Announcement History';
  mb.innerHTML='<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="color:#00d4ff;font-size:20px"></i></div>';
  m.classList.add('show');
  try {
    var snap=await rt.ref('announcements').limitToLast(20).once('value');
    var list=[];
    if(snap.exists()) snap.forEach(function(c){ list.push(Object.assign({key:c.key},c.val())); });
    list.reverse();
    var h='<div style="padding:4px">';
    if(!list.length){h+='<div style="text-align:center;padding:20px;color:#aaa">No announcements yet</div>';}
    list.forEach(function(a){
      h+='<div style="padding:10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:8px;border:1px solid rgba(255,255,255,.07)">';
      h+='<div style="font-size:12px;font-weight:700">'+(a.title||a.message||'Announcement')+'</div>';
      h+='<div style="font-size:10px;color:#aaa;margin-top:2px">'+new Date(a.timestamp||a.createdAt||0).toLocaleString()+'</div>';
      h+='</div>';
    });
    h+='</div>';
    mb.innerHTML=h;
  } catch(e){mb.innerHTML='<div style="color:#ff4444;padding:12px">Error: '+e.message+'</div>';}
};

/* ─── A36: QUICK ROOM ID SETTER (all matches at once) ─── */
window.showBulkRoomSetter = function() {
  var matches=window.allTournaments||{};
  var h='<div style="padding:4px">';
  h+='<div style="font-size:12px;color:#aaa;margin-bottom:12px">Sirf joined matches dikhenge</div>';
  var shown=0;
  Object.keys(matches).forEach(function(mid){
    var t=matches[mid];
    var st=(t.status||'').toLowerCase();
    if(st==='resultpublished'||st==='cancelled') return;
    shown++;
    var curReleaseMin = t.roomReleaseMinutes || 5;
    h+='<div style="padding:10px;background:rgba(255,255,255,.03);border-radius:10px;margin-bottom:8px;border:1px solid rgba(255,255,255,.07)">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    h+='<div style="font-size:12px;font-weight:700;color:#00ff9c">'+t.name+'</div>';
    h+='<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#aaa"><i class="fas fa-clock" style="color:#ffd700"></i>Release: <input type="number" id="rrm_'+mid+'" value="'+curReleaseMin+'" min="1" max="60" style="width:42px;padding:2px 4px;border-radius:5px;background:rgba(255,215,0,.1);border:1px solid rgba(255,215,0,.3);color:#ffd700;font-size:11px;text-align:center"> min pehle</div>';
    h+='</div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    h+='<input type="text" id="rid_'+mid+'" class="form-input" placeholder="Room ID" value="'+(t.roomId||'')+'" style="font-size:12px">';
    h+='<input type="text" id="rpw_'+mid+'" class="form-input" placeholder="Password" value="'+(t.roomPassword||'')+'" style="font-size:12px">';
    h+='</div>';
    h+='<button onclick="window._setRoomQuick(\''+mid+'\')" style="margin-top:6px;padding:6px 14px;border-radius:8px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer"><i class="fas fa-key"></i> Save Room</button>';
    h+='</div>';
  });
  if(!shown) h+='<div style="text-align:center;padding:20px;color:#aaa">No active matches</div>';
  h+='</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='🔑 Bulk Room Setter';mb.innerHTML=h;m.classList.add('show');}
};
window._setRoomQuick = async function(mid) {
  var rt=rtdb(); if(!rt) return;
  var rid=(document.getElementById('rid_'+mid)||{}).value||'';
  var rpw=(document.getElementById('rpw_'+mid)||{}).value||'';
  var rrm=Number((document.getElementById('rrm_'+mid)||{}).value)||5;
  if(!rid||!rpw){if(window.showToast)showToast('Room ID & Password dono enter karo',true);return;}
  await rt.ref('matches/'+mid).update({roomId:rid,roomPassword:rpw,roomStatus:'saved',roomReleaseMinutes:rrm});
  // Auto-notify joined players
  var matchName = (window.allTournaments&&window.allTournaments[mid]) ? window.allTournaments[mid].name : 'Match';
  var notified = 0;
  try {
    if(window.sendRoomNotificationToMatch) {
      notified = await sendRoomNotificationToMatch(mid, rid, rpw, matchName);
    }
  } catch(ne) { /* notification optional — don't block */ }
  if(window.showToast)showToast('✅ Room saved' + (notified>0 ? ' & '+notified+' players ko notify kiya!' : '! '+rrm+' min pehle release hogi.'));
  if(window.loadTournaments)loadTournaments();
};

/* ─── A37: COIN BALANCE MANAGER ─── */
window.showCoinManager = function() {
  var h='<div style="padding:4px">';
  h+='<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Firebase UID</label><input type="text" id="cmUid" class="form-input" placeholder="User Firebase UID"></div>';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
  h+='<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Amount (coins)</label><input type="number" id="cmAmt" class="form-input" placeholder="e.g. 100" min="1"></div>';
  h+='<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Action</label><select id="cmAction" class="form-input"><option value="add">Add Coins</option><option value="remove">Remove Coins</option><option value="set">Set Exact</option></select></div>';
  h+='</div>';
  h+='<button onclick="window._doCoinManager()" style="width:100%;padding:12px;border-radius:10px;background:linear-gradient(135deg,#ffd700,#ff8c00);color:#000;font-weight:800;border:none;cursor:pointer"><i class="fas fa-coins"></i> Apply</button>';
  h+='</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='🪙 Coin Manager';mb.innerHTML=h;m.classList.add('show');}
};
window._doCoinManager = async function() {
  var rt=rtdb(); if(!rt) return;
  var uid=(document.getElementById('cmUid')||{}).value||'';
  var amt=Number((document.getElementById('cmAmt')||{}).value)||0;
  var action=(document.getElementById('cmAction')||{}).value||'add';
  if(!uid||!amt){if(window.showToast)showToast('UID and amount enter karo',true);return;}
  var snap=await rt.ref('users/'+uid+'/coins').once('value');
  var cur=Number(snap.val())||0;
  var newVal=action==='add'?cur+amt:action==='remove'?Math.max(0,cur-amt):amt;
  await rt.ref('users/'+uid+'/coins').set(newVal);
  await rt.ref('users/'+uid+'/notifications').push({title:'🪙 Coins Updated',message:'Coins '+(action==='add'?'added: +':'removed: -')+amt+'. New balance: '+newVal,timestamp:Date.now(),read:false});
  if(window.showToast)showToast('✅ Coins updated! '+cur+' → '+newVal);
  if(window.closeGenericModal)closeGenericModal();
};

/* ─── A38: TOP PLAYERS LEADERBOARD ─── */
window.showTopPlayers = async function() {
  var rt=rtdb(); if(!rt) return;
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(!m||!mt||!mb) return;
  mt.innerHTML='🏆 Top Players';
  mb.innerHTML='<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="color:#ffd700;font-size:20px"></i></div>';
  m.classList.add('show');
  try {
    var snap=await rt.ref('users').once('value');
    var players=[];
    if(snap.exists()) snap.forEach(function(c){
      var u=c.val(); if(!u) return;
      var st=u.stats||{};
      var rm=u.realMoney||{};
      players.push({uid:c.key,ign:u.ign||'?',kills:st.kills||0,wins:st.wins||0,matches:st.matches||0,earnings:rm.winnings||st.earnings||0});
    });
    players.sort(function(a,b){ return (b.kills*3+b.wins*10+b.matches+b.earnings*0.05)-(a.kills*3+a.wins*10+a.matches+a.earnings*0.05); });
    var h='<div style="padding:4px">';
    var medals=['🥇','🥈','🥉'];
    players.slice(0,10).forEach(function(p,i){
      h+='<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:6px;border:1px solid rgba(255,255,255,.07)">';
      h+='<span style="font-size:16px;min-width:24px">'+(medals[i]||'#'+(i+1))+'</span>';
      h+='<div style="flex:1"><div style="font-size:13px;font-weight:700;color:#00ff9c">'+p.ign+'</div>';
      h+='<div style="font-size:10px;color:#aaa">'+p.kills+' kills · '+p.wins+' wins · ₹'+p.earnings+' earned</div></div>';
      h+='</div>';
    });
    if(!players.length) h+='<div style="text-align:center;padding:20px;color:#aaa">No players yet</div>';
    h+='</div>';
    mb.innerHTML=h;
  } catch(e){mb.innerHTML='<div style="color:#ff4444;padding:12px">Error: '+e.message+'</div>';}
};

/* ─── A39: MATCH AUTO-COMPLETE WITH ZERO RESULTS ─── */
window.showAutoComplete = function() {
  var matches=window.allTournaments||{};
  var h='<div style="padding:4px">';
  h+='<div style="font-size:12px;color:#aaa;margin-bottom:12px">Match mark karo completed without publishing results (refund sab ko)</div>';
  var shown=0;
  Object.keys(matches).forEach(function(mid){
    var t=matches[mid]; if(!t) return;
    var st=(t.status||'').toLowerCase();
    if(st==='resultpublished'||st==='cancelled'||st==='completed') return;
    shown++;
    h+='<div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:6px">';
    h+='<div style="flex:1;font-size:12px;font-weight:600">'+t.name+'</div>';
    h+='<button onclick="window._cancelAndRefund(\''+mid+'\',\''+t.name+'\')" style="padding:5px 10px;border-radius:6px;background:rgba(255,170,0,.1);border:1px solid rgba(255,170,0,.2);color:#ffaa00;font-size:11px;cursor:pointer">Cancel+Refund</button>';
    h+='</div>';
  });
  if(!shown) h+='<div style="text-align:center;padding:20px;color:#aaa">No active matches</div>';
  h+='</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='⚡ Auto Complete';mb.innerHTML=h;m.classList.add('show');}
};
window._cancelAndRefund = async function(mid, name) {
  var rt=rtdb(); if(!rt) return;
  if(!confirm('Cancel "'+name+'" and refund all? Are you sure?')) return;
  if(window.cancelTournament){cancelTournament(mid);}
  else {
    await rt.ref('matches/'+mid).update({status:'cancelled'});
    if(window.showToast)showToast('✅ Match cancelled');
  }
};

/* ─── A40: SUSPICIOUS ACTIVITY LOG VIEWER ─── */
window.showSuspiciousLog = async function() {
  var rt=rtdb(); if(!rt) return;
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(!m||!mt||!mb) return;
  mt.innerHTML='🚨 Suspicious Activity Log';
  mb.innerHTML='<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="color:#ff6b6b;font-size:20px"></i></div>';
  m.classList.add('show');
  try {
    var snap=await rt.ref('suspiciousActivity').limitToLast(30).once('value');
    var list=[];
    if(snap.exists()) snap.forEach(function(c){ list.push(Object.assign({key:c.key},c.val())); });
    list.reverse();
    var h='<div style="padding:4px">';
    if(!list.length){h+='<div style="text-align:center;padding:20px;color:#00ff9c;font-size:24px">✅ No suspicious activity logged</div>';}
    list.forEach(function(a){
      var typeColor=a.type==='balance_spike'?'#ffaa00':a.type==='overdraft_attempt'?'#ff4444':'#ff8c00';
      h+='<div style="padding:10px;background:rgba(255,100,0,.05);border:1px solid rgba(255,100,0,.15);border-radius:8px;margin-bottom:8px">';
      h+='<div style="display:flex;justify-content:space-between;align-items:center">';
      h+='<span style="font-size:11px;font-weight:700;color:'+typeColor+'">'+a.type+'</span>';
      h+='<span style="font-size:10px;color:#aaa">'+new Date(a.timestamp||0).toLocaleString()+'</span>';
      h+='</div>';
      h+='<div style="font-size:11px;color:#aaa;margin-top:4px">User: '+(a.userId||'?')+'</div>';
      if(a.from!==undefined) h+='<div style="font-size:11px;color:#aaa">Balance: ₹'+a.from+' → ₹'+a.to+'</div>';
      if(a.amt) h+='<div style="font-size:11px;color:#ff4444">Attempted: ₹'+a.amt+'</div>';
      h+='</div>';
    });
    h+='<button onclick="window.rtdb().ref(\'suspiciousActivity\').remove().then(function(){window.showToast&&showToast(\'Log cleared\');window.closeGenericModal&&closeGenericModal()})" style="width:100%;margin-top:10px;padding:10px;border-radius:8px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);color:#ff4444;font-weight:700;cursor:pointer">Clear All Logs</button>';
    h+='</div>';
    mb.innerHTML=h;
  } catch(e){mb.innerHTML='<div style="color:#ff4444;padding:12px">Error: '+e.message+'</div>';}
};

/* ─── A41: INSTANT TOURNAMENT SNAPSHOT ─── */
window.showTournamentSnapshot = function() {
  var matches=window.allTournaments||{};
  var total=0,live=0,upcoming=0,completed=0,totalFees=0,totalPrize=0;
  Object.keys(matches).forEach(function(mid){
    var t=matches[mid]; if(!t) return;
    total++;
    var st=(t.status||'').toLowerCase();
    if(st==='live') live++;
    else if(st==='resultpublished'||st==='completed') completed++;
    else upcoming++;
    totalFees+=Number(t.entryFee||0)*Number(t.filledSlots||0);
    totalPrize+=Number(t.prizePool||0);
  });
  var h='<div style="padding:4px;display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  h+='<div style="background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.15);border-radius:12px;padding:12px;text-align:center"><div style="font-size:28px;font-weight:900;color:#00d4ff">'+total+'</div><div style="font-size:11px;color:#aaa">Total Matches</div></div>';
  h+='<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);border-radius:12px;padding:12px;text-align:center"><div style="font-size:28px;font-weight:900;color:#00ff9c">'+live+'</div><div style="font-size:11px;color:#aaa">Live Now</div></div>';
  h+='<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.15);border-radius:12px;padding:12px;text-align:center"><div style="font-size:28px;font-weight:900;color:#ffd700">'+upcoming+'</div><div style="font-size:11px;color:#aaa">Upcoming</div></div>';
  h+='<div style="background:rgba(170,85,255,.06);border:1px solid rgba(170,85,255,.15);border-radius:12px;padding:12px;text-align:center"><div style="font-size:28px;font-weight:900;color:#aa55ff">'+completed+'</div><div style="font-size:11px;color:#aaa">Completed</div></div>';
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;padding:0 4px">';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;text-align:center"><div style="font-size:18px;font-weight:900;color:#00ff9c">₹'+totalFees+'</div><div style="font-size:11px;color:#aaa">Total Fees Collected</div></div>';
  h+='<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;text-align:center"><div style="font-size:18px;font-weight:900;color:#ff6b6b">₹'+totalPrize+'</div><div style="font-size:11px;color:#aaa">Total Prize Pool</div></div>';
  h+='</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='📸 Tournament Snapshot';mb.innerHTML=h;m.classList.add('show');}
};

/* ─── A42: PLAYER SEARCH BY FF UID ─── */
window.showPlayerSearch = async function() {
  var h='<div style="padding:4px">';
  h+='<div style="display:flex;gap:8px;margin-bottom:12px">';
  h+='<input type="text" id="psQuery" class="form-input" placeholder="FF UID ya IGN search karo..." style="flex:1">';
  h+='<button onclick="window._doPlayerSearch()" style="padding:8px 14px;border-radius:8px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.2);color:#00ff9c;cursor:pointer;font-weight:700"><i class="fas fa-search"></i></button>';
  h+='</div>';
  h+='<div id="psResults">Type to search...</div>';
  h+='</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='🔍 Player Search';mb.innerHTML=h;m.classList.add('show');}
};
window._doPlayerSearch = async function() {
  var rt=rtdb(); if(!rt) return;
  var q=((document.getElementById('psQuery')||{}).value||'').toLowerCase().trim();
  var el=document.getElementById('psResults'); if(!el||!q||q.length<2) return;
  el.innerHTML='<div style="color:#aaa;text-align:center"><i class="fas fa-spinner fa-spin"></i></div>';

  // Use usersCache first (instant, no Firebase call)
  var cache=window.usersCache||{};
  var results=[];
  Object.keys(cache).forEach(function(uid){
    var u=cache[uid]; if(!u) return;
    var ign=(u.ign||'').toLowerCase(), ff=(u.ffUid||'').toLowerCase(), em=(u.email||'').toLowerCase(), ph=(u.phone||'').toLowerCase();
    if(ign.indexOf(q)>-1||ff.indexOf(q)>-1||em.indexOf(q)>-1||ph.indexOf(q)>-1||uid.toLowerCase().indexOf(q)>-1)
      results.push(Object.assign({uid:uid},u));
  });

  // Cache miss — fallback fetch
  if(!results.length&&Object.keys(cache).length===0){
    try{
      var snap=await rt.ref('users').once('value');
      if(snap.exists())snap.forEach(function(c){
        var u=c.val();if(!u)return;
        var ign=(u.ign||'').toLowerCase(),ff=(u.ffUid||'').toLowerCase(),em=(u.email||'').toLowerCase();
        if(ign.indexOf(q)>-1||ff.indexOf(q)>-1||em.indexOf(q)>-1)results.push(Object.assign({uid:c.key},u));
      });
    }catch(e){}
  }

  if(!results.length){el.innerHTML='<div style="text-align:center;color:#aaa;padding:12px">No results found</div>';return;}
  var h='<div>';
  results.slice(0,8).forEach(function(u){
    var dep=(u.realMoney||{}).deposited||(u.wallet||{}).depositBalance||0;
    var win=(u.realMoney||{}).winnings||(u.wallet||{}).winningBalance||0;
    var banned=u.isBanned||u.blocked;
    h+='<div onclick="window.openUserModal&&openUserModal(\''+u.uid+'\')" style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:6px;cursor:pointer;border:1px solid rgba(255,255,255,.07)">';
    h+='<div style="width:36px;height:36px;border-radius:10px;background:rgba(0,255,156,.1);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;color:#00ff9c">'+(u.ign||'?').charAt(0).toUpperCase()+'</div>';
    h+='<div style="flex:1"><div style="font-size:13px;font-weight:700;color:#00ff9c">'+(u.ign||'N/A')+(banned?' <span style="color:#ff4444;font-size:10px">🚫</span>':'')+'</div>';
    h+='<div style="font-size:10px;color:#00d4ff;font-family:monospace">FF: '+(u.ffUid||'N/A')+'</div></div>';
    h+='<div style="text-align:right;font-size:11px"><div style="color:#00ff9c;font-weight:700">₹'+(dep+win)+'</div><div style="color:#aaa">'+(u.stats?u.stats.matches||0:0)+' matches</div></div>';
    h+='</div>';
  });
  if(results.length>8)h+='<div style="text-align:center;font-size:11px;color:#aaa;padding:4px">+' +(results.length-8)+' more results — search more specific karo</div>';
  h+='</div>';
  el.innerHTML=h;
};

/* ─── A43: UPI PAYMENT VERIFIER ─── */
window.showUPIVerifier = function() {
  var h='<div style="padding:4px">';
  h+='<div style="font-size:12px;color:#aaa;margin-bottom:12px">UTR number se deposit verify karo</div>';
  h+='<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">UTR / Transaction ID</label><input type="text" id="utrInput" class="form-input" placeholder="e.g. 312456789012"></div>';
  h+='<button onclick="window._checkUTR()" style="width:100%;padding:12px;border-radius:10px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-weight:800;cursor:pointer;margin-bottom:12px"><i class="fas fa-search"></i> Check in Wallet Requests</button>';
  h+='<div id="utrResult"></div>';
  h+='</div>';
  var m=document.getElementById('genericModal'),mt=document.getElementById('genericModalTitle'),mb=document.getElementById('genericModalBody');
  if(m&&mt&&mb){mt.innerHTML='🔍 UPI Verifier';mb.innerHTML=h;m.classList.add('show');}
};
window._checkUTR = async function() {
  var rt=rtdb(); if(!rt) return;
  var utr=((document.getElementById('utrInput')||{}).value||'').trim();
  var el=document.getElementById('utrResult'); if(!el||!utr) return;
  el.innerHTML='<div style="color:#aaa;text-align:center"><i class="fas fa-spinner fa-spin"></i> Checking...</div>';
  var snap=await rt.ref('walletRequests').once('value');
  var found=[];
  if(snap.exists()) snap.forEach(function(c){
    var w=c.val(); if(!w) return;
    if((w.utr||w.transactionId||'').toString().toLowerCase().indexOf(utr.toLowerCase())>-1) found.push(Object.assign({key:c.key},w));
  });
  if(!found.length){el.innerHTML='<div style="background:rgba(255,68,68,.08);border:1px solid rgba(255,68,68,.2);border-radius:8px;padding:12px;color:#ff6b6b;text-align:center">❌ UTR not found in any deposit request</div>';return;}
  var h='';
  found.forEach(function(w){
    var stColor=w.status==='approved'?'#00ff9c':w.status==='rejected'?'#ff4444':'#ffaa00';
    h+='<div style="background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.15);border-radius:10px;padding:12px">';
    h+='<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px">';
    h+='<span style="color:#aaa">UTR</span><span style="font-family:monospace;color:#00d4ff">'+(w.utr||w.transactionId)+'</span>';
    h+='<span style="color:#aaa">Amount</span><span style="font-weight:700;color:#00ff9c">₹'+w.amount+'</span>';
    h+='<span style="color:#aaa">User</span><span>'+(w.ign||w.userName||w.userId||'?')+'</span>';
    h+='<span style="color:#aaa">Status</span><span style="font-weight:700;color:'+stColor+'">'+w.status+'</span>';
    h+='<span style="color:#aaa">Date</span><span>'+new Date(w.timestamp||0).toLocaleString()+'</span>';
    h+='</div></div>';
  });
  el.innerHTML=h;
};

})();
