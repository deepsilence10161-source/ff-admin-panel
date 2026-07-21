/* ================================================================
   MINI eSPORTS ADMIN — v17 NEW FEATURES
   Bracket Management, Clan War, City Championship,
   Mentor Management, Clean Badge, Rank-Locked Matches
================================================================ */
(function(){
'use strict';

function getDB(){ return window.db||window.firebase&&firebase.database(); } // RTDB only for chat
function _supa(){ return window._supa||window.supabaseClient; }

/* ============================================================
   1. INJECT NAV ITEMS
============================================================ */
var _navInj=0,_navT=setInterval(function(){
  _navInj++; if(_navInj>40){ clearInterval(_navT); return; }
  var nav=document.querySelector('.sidebar-nav');
  if(!nav||document.getElementById('_v17NavDiv')) return;
  clearInterval(_navT);
  var div=document.createElement('div');
  div.id='_v17NavDiv';
  div.innerHTML='<div class="nav-divider"></div>'
    +'<div class="nav-section-label">v17 Features</div>'
    +'<div class="nav-item" onclick="showSection(\'bracketAdmin\',this);window.loadBracketAdmin&&loadBracketAdmin()"><i class="fas fa-sitemap"></i><span class="nav-label">Brackets</span></div>'
    +'<div class="nav-item" onclick="showSection(\'clanWarAdmin\',this);window.loadClanWarAdmin&&loadClanWarAdmin()"><i class="fas fa-shield-alt" style="color:#ff6b6b"></i><span class="nav-label">Clan Wars</span></div>'
    +'<div class="nav-item" onclick="showSection(\'cityChampAdmin\',this);window.loadCityChampAdmin&&loadCityChampAdmin()"><i class="fas fa-city" style="color:#ffa500"></i><span class="nav-label">City Champ</span></div>'
    +'<div class="nav-item" onclick="showSection(\'mentorAdmin\',this);window.loadMentorAdmin&&loadMentorAdmin()"><i class="fas fa-graduation-cap" style="color:#ffd700"></i><span class="nav-label">Mentors</span></div>'
    +'<div class="nav-item" onclick="showSection(\'cleanBadgeAdmin\',this);window.loadCleanBadgeAdmin&&loadCleanBadgeAdmin()"><i class="fas fa-check-circle" style="color:#00ff9c"></i><span class="nav-label">Clean Badges</span></div>';
  nav.appendChild(div);
  /* Inject section HTML divs */
  var main=document.querySelector('.main-content');
  if(main){
    ['bracketAdmin','clanWarAdmin','cityChampAdmin','mentorAdmin','cleanBadgeAdmin'].forEach(function(id){
      if(!document.getElementById('section-'+id)){
        var sec=document.createElement('div');
        sec.className='section'; sec.id='section-'+id; sec.style.display='none';
        sec.innerHTML='<div class="section-header"><h2>'+_v17SectionTitle(id)+'</h2></div><div id="'+id+'Content" style="padding:16px"></div>';
        main.appendChild(sec);
      }
    });
  }
},400);

function _v17SectionTitle(id){
  return {bracketAdmin:'🏆 Tournament Brackets',clanWarAdmin:'⚔️ Clan Wars',cityChampAdmin:'🏙️ City Championship',mentorAdmin:'👨‍🏫 Mentor Management',cleanBadgeAdmin:'✅ Clean Badges'}[id]||id;
}

/* ============================================================
   2. BRACKET MANAGEMENT
============================================================ */
window.loadBracketAdmin = function(){
  var c=document.getElementById('bracketAdminContent'); if(!c) return;
  c.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i></div>';
  /* Load existing brackets */
  var s=_supa(); if(!s){ c.innerHTML='<p style="color:#ff6b6b">DB error</p>'; return; }
  s.from('tournament_brackets').select('id,name,format,team_count,status,champion,prize').order('created_at',{ascending:false}).limit(10)
  .then(function(res){ var list=(res.data||[]);
    var h='<div style="display:flex;justify-content:flex-end;margin-bottom:14px">'
      +'<button onclick="window.showCreateBracketForm()" class="btn-primary" style="padding:10px 16px;border-radius:11px;border:none;background:var(--primary);color:#000;font-weight:800;cursor:pointer"><i class="fas fa-plus"></i> New Bracket</button></div>';
    if(!list.length){ h+='<div class="empty-state">No brackets yet</div>'; c.innerHTML=h; return; }
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    list.forEach(function(b){
      var statusColor={live:'#00ff9c',upcoming:'#ffd700',finished:'#999'}[b.status||'']||'#999';
      h+='<div style="padding:16px;border-radius:14px;background:var(--card);border:1px solid var(--border)">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
      h+='<div><div style="font-size:15px;font-weight:800">'+(b.name||'Tournament')+'</div>';
      h+='<div style="font-size:12px;color:var(--txt2)">'+(b.format||'Single Elimination')+' · '+(b.teamCount||0)+' teams</div></div>';
      h+='<div style="display:flex;gap:8px;align-items:center">';
      h+='<span style="font-size:12px;font-weight:700;color:'+statusColor+'">'+(b.status||'upcoming').toUpperCase()+'</span>';
      h+='<button onclick="window.editBracket(\''+b._id+'\')" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;cursor:pointer;font-size:11px">Edit</button>';
      h+='<button onclick="window.deleteBracket(\''+b._id+'\')" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,107,107,.3);background:transparent;color:#ff6b6b;cursor:pointer;font-size:11px">Delete</button>';
      h+='</div></div>';
      if(b.champion) h+='<div style="font-size:12px;color:#ffd700">🏆 Champion: '+b.champion+'</div>';
      h+='</div>';
    });
    h+='</div>';
    c.innerHTML=h;
  });
};

window.showCreateBracketForm = function(existingId){
  var db=getDB(); if(!db) return;
  /* Load matches for linking */
  db.ref('matches').orderByChild('status').equalTo('upcoming').limitToLast(20).once('value',function(s){
    var matches=[]; s.forEach(function(m){ var d=m.val(); d._id=m.key; matches.push(d); });
    var h='';
    h+='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div><label style="font-size:12px;color:var(--txt2);display:block;margin-bottom:4px">Bracket Name</label>';
    h+='<input id="brkName" type="text" placeholder="e.g. Season 3 Finals" style="width:100%;padding:10px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--txt);box-sizing:border-box"></div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    h+='<div><label style="font-size:12px;color:var(--txt2);display:block;margin-bottom:4px">Format</label>';
    h+='<select id="brkFormat" style="width:100%;padding:10px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--txt)">';
    ['Single Elimination','Double Elimination','Round Robin','Swiss'].forEach(function(f){ h+='<option>'+f+'</option>'; });
    h+='</select></div>';
    h+='<div><label style="font-size:12px;color:var(--txt2);display:block;margin-bottom:4px">Status</label>';
    h+='<select id="brkStatus" style="width:100%;padding:10px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--txt)">';
    ['upcoming','live','finished'].forEach(function(s){ h+='<option value="'+s+'">'+s+'</option>'; });
    h+='</select></div></div>';
    /* Rounds builder */
    h+='<div><label style="font-size:12px;color:var(--txt2);display:block;margin-bottom:4px">Teams (comma-separated)</label>';
    h+='<textarea id="brkTeams" placeholder="Team Alpha, Team Beta, Team Gamma..." style="width:100%;padding:10px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--txt);height:60px;resize:none;box-sizing:border-box"></textarea></div>';
    h+='<div><label style="font-size:12px;color:var(--txt2);display:block;margin-bottom:4px">Prize</label>';
    h+='<input id="brkPrize" type="text" placeholder="e.g. 500 Green Diamonds + Champion Badge" style="width:100%;padding:10px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--txt);box-sizing:border-box"></div>';
    h+='<button onclick="window._saveBracket()" style="padding:12px;border-radius:11px;border:none;background:var(--primary);color:#000;font-weight:800;cursor:pointer;width:100%">✅ Create Bracket</button>';
    h+='</div>';
    if(window.openModal) openModal('🏆 New Bracket',h);
  });
};

window._saveBracket=function(){
  var name=(document.getElementById('brkName')||{}).value||'';
  var format=(document.getElementById('brkFormat')||{}).value||'Single Elimination';
  var status=(document.getElementById('brkStatus')||{}).value||'upcoming';
  var teamsRaw=(document.getElementById('brkTeams')||{}).value||'';
  var prize=(document.getElementById('brkPrize')||{}).value||'';
  if(!name){ toast('Name daalo!',true); return; }
  var teams=teamsRaw.split(',').map(function(t){ return t.trim(); }).filter(Boolean);
  /* Auto-generate rounds based on team count */
  var rounds=_generateRounds(teams);
  var s=_supa(); if(!s){ toast('DB error',true); return; }
  s.from('tournament_brackets').insert({name:name,format:format,status:status,prize:prize,team_count:teams.length,teams:JSON.stringify(teams),rounds:JSON.stringify(rounds)})
  .then(function(){ toast('✅ Bracket created!'); if(window.closeModal)closeModal(); if(window.loadBracketAdmin)loadBracketAdmin(); })
  .catch(function(e){ toast('Error: '+(e.message||'Try again'),true); });
};

function _generateRounds(teams){
  if(!teams||teams.length<2) return [];
  var rounds=[];
  var current=teams.slice();
  var roundNum=1;
  while(current.length>1){
    var matches=[];
    for(var i=0;i<current.length;i+=2){
      matches.push({ team1:{name:current[i],score:0}, team2:{name:current[i+1]||'TBD',score:0}, winner:null });
    }
    rounds.push({ name:roundNum===1?'Round of '+teams.length:roundNum===Math.ceil(Math.log2(teams.length))?'Grand Final':roundNum===Math.ceil(Math.log2(teams.length))-1?'Semi Final':'Quarter Final', matches:matches });
    current=current.filter(function(_,i){ return i%2===0; }); /* Advance winners (placeholder) */
    roundNum++;
  }
  return rounds;
}

window.editBracket=function(id){
  var db=getDB(); if(!db) return;
  db.ref('brackets/'+id).once('value',function(s){
    var b=s.val(); if(!b) return;
    /* Build round editor */
    var h='<div style="display:flex;flex-direction:column;gap:10px">';
    h+='<div style="display:flex;gap:10px">';
    h+='<select id="brkEditStatus" style="flex:1;padding:10px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--txt)">';
    ['upcoming','live','finished'].forEach(function(st){ h+='<option value="'+st+'"'+(b.status===st?' selected':'')+'>'+st+'</option>'; });
    h+='</select>';
    h+='<input id="brkEditChampion" type="text" placeholder="Champion name" value="'+(b.champion||'')+'" style="flex:1;padding:10px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--txt)">';
    h+='</div>';
    /* Round results */
    (b.rounds||[]).forEach(function(round,ri){
      h+='<div style="font-size:13px;font-weight:800;margin-top:6px">'+( round.name||'Round '+(ri+1))+'</div>';
      (round.matches||[]).forEach(function(match,mi){
        h+='<div style="display:flex;gap:8px;align-items:center;padding:8px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--border)">';
        h+='<span style="font-size:12px;flex:1">'+(match.team1&&match.team1.name||'TBD')+'</span>';
        h+='<input id="brkR'+ri+'M'+mi+'S1" type="number" value="'+(match.team1&&match.team1.score||0)+'" style="width:40px;padding:5px;border-radius:6px;background:var(--bg2);border:1px solid var(--border);color:var(--txt);text-align:center" min="0">';
        h+='<span style="color:var(--txt2)">—</span>';
        h+='<input id="brkR'+ri+'M'+mi+'S2" type="number" value="'+(match.team2&&match.team2.score||0)+'" style="width:40px;padding:5px;border-radius:6px;background:var(--bg2);border:1px solid var(--border);color:var(--txt);text-align:center" min="0">';
        h+='<span style="font-size:12px;flex:1;text-align:right">'+(match.team2&&match.team2.name||'TBD')+'</span>';
        h+='</div>';
      });
    });
    h+='<button onclick="window._updateBracket(\''+id+'\')" style="padding:12px;border-radius:11px;border:none;background:var(--primary);color:#000;font-weight:800;cursor:pointer">✅ Update Bracket</button>';
    h+='</div>';
    if(window.openModal) openModal('✏️ Edit Bracket: '+(b.name||''),h);
  });
};

window._updateBracket=function(id){
  var db=getDB(); if(!db) return;
  db.ref('brackets/'+id).once('value',function(s){
    var b=s.val(); if(!b) return;
    var status=(document.getElementById('brkEditStatus')||{}).value||b.status;
    var champion=((document.getElementById('brkEditChampion')||{}).value||'').trim();
    var rounds=(b.rounds||[]).map(function(round,ri){
      round.matches=(round.matches||[]).map(function(match,mi){
        var s1=parseInt((document.getElementById('brkR'+ri+'M'+mi+'S1')||{}).value)||0;
        var s2=parseInt((document.getElementById('brkR'+ri+'M'+mi+'S2')||{}).value)||0;
        match.team1=(match.team1||{}); match.team1.score=s1;
        match.team2=(match.team2||{}); match.team2.score=s2;
        match.winner=s1>s2?'team1':s2>s1?'team2':null;
        return match;
      });
      return round;
    });
    var upd={status:status,rounds:rounds,updatedAt:Date.now()};
    if(champion) upd.champion=champion;
    db.ref('brackets/'+id).update(upd,function(err){
      if(err){ toast('Error!',true); return; }
      toast('✅ Bracket updated!');
      if(window.closeModal) closeModal();
      if(window.loadBracketAdmin) loadBracketAdmin();
    });
  });
};

window.deleteBracket=function(id){
  if(!confirm('Bracket delete karo?')) return;
  var db=getDB(); if(!db) return;
  db.ref('brackets/'+id).remove(function(){ toast('Deleted'); if(window.loadBracketAdmin) loadBracketAdmin(); });
};

/* ============================================================
   3. CLAN WAR ADMIN
============================================================ */
window.loadClanWarAdmin=function(){
  var c=document.getElementById('clanWarAdminContent'); if(!c) return;
  c.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i></div>';
  var db=getDB(); if(!db){ c.innerHTML='<p style="color:#ff6b6b">DB error</p>'; return; }
  var week=_getAdminWeek();
  var mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var wd=new Date(week);
  var h='<div style="margin-bottom:16px;font-size:13px;color:var(--txt2)">Current War Week: <strong style="color:var(--txt)">'+wd.getDate()+' '+mon[wd.getMonth()]+' – '+(wd.getDate()+6)+' '+mon[wd.getMonth()]+'</strong></div>';
  /* Load war challenges */
  db.ref('clanWars/'+week+'/challenges').once('value',function(s){
    var challenges=[]; s.forEach(function(c){ var d=c.val(); d._id=c.key; challenges.push(d); });
    var pending=challenges.filter(function(c){ return c.status==='pending'; });
    var accepted=challenges.filter(function(c){ return c.status==='accepted'; });
    h+='<div style="font-size:14px;font-weight:800;margin-bottom:10px">⏳ Pending Challenges ('+pending.length+')</div>';
    if(pending.length){
      h+='<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">';
      pending.forEach(function(chal){
        h+='<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:13px;background:rgba(255,165,0,.06);border:1px solid rgba(255,165,0,.2)">';
        h+='<div style="flex:1"><div style="font-size:13px;font-weight:800">'+chal.fromClanName+' ⚔️ '+chal.toClanName+'</div>';
        h+='<div style="font-size:11px;color:var(--txt2)">Sent '+new Date(chal.ts||Date.now()).toLocaleDateString('en-IN')+'</div></div>';
        h+='<button onclick="window._acceptWarChallenge(\''+chal._id+'\',\''+chal.fromClan+'\',\''+chal.toClan+'\',\''+chal.fromClanName.replace(/'/g,"\\'")+ '\',\''+chal.toClanName.replace(/'/g,"\\'")+'\',\''+week+'\')" style="padding:7px 12px;border-radius:9px;border:none;background:var(--primary);color:#000;font-size:11px;font-weight:800;cursor:pointer">Activate</button>';
        h+='<button onclick="window.db&&window.db.ref(\'clanWars/'+week+'/challenges/'+chal._id+'/status\').set(\'declined\')" style="padding:7px 12px;border-radius:9px;border:1px solid rgba(255,107,107,.3);background:transparent;color:#ff6b6b;font-size:11px;cursor:pointer">Decline</button>';
        h+='</div>';
      });
      h+='</div>';
    }
    /* Active wars */
    db.ref('clanWars/'+week+'/matches').orderByChild('status').equalTo('active').once('value',function(ms){
      var wars=[]; ms.forEach(function(m){ var d=m.val(); d._id=m.key; wars.push(d); });
      h+='<div style="font-size:14px;font-weight:800;margin-bottom:10px">⚔️ Active Wars ('+wars.length+')</div>';
      if(wars.length){
        h+='<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">';
        wars.forEach(function(war){
          h+='<div style="padding:14px;border-radius:14px;background:rgba(255,68,68,.06);border:1.5px solid rgba(255,68,68,.2)">';
          h+='<div style="display:flex;justify-content:space-between;margin-bottom:10px">';
          h+='<div style="font-size:14px;font-weight:900">'+war.clan1Name+' <span style="color:#ff6b6b">VS</span> '+war.clan2Name+'</div>';
          h+='<button onclick="window._resolveWar(\''+war._id+'\',\''+week+'\')" style="padding:6px 10px;border-radius:8px;border:none;background:#ff6b6b;color:#fff;font-size:11px;font-weight:800;cursor:pointer">Resolve War</button>';
          h+='</div>';
          h+='<div style="display:flex;gap:16px">';
          h+='<div style="text-align:center"><div style="font-size:20px;font-weight:900;color:var(--green)">'+(war.clan1Score||0)+'</div><div style="font-size:11px;color:var(--txt2)">'+war.clan1Name+'</div></div>';
          h+='<div style="text-align:center"><div style="font-size:20px;font-weight:900;color:#ff6b6b">'+(war.clan2Score||0)+'</div><div style="font-size:11px;color:var(--txt2)">'+war.clan2Name+'</div></div>';
          h+='</div></div>';
        });
        h+='</div>';
      }
      /* Standings */
      db.ref('clanWars/'+week+'/clans').orderByChild('score').limitToLast(10).once('value',function(cs){
        var clans=[]; cs.forEach(function(c){ var d=c.val(); d._id=c.key; clans.push(d); }); clans.reverse();
        h+='<div style="font-size:14px;font-weight:800;margin-bottom:10px">🏆 Weekly Standings</div>';
        h+='<div style="display:flex;flex-direction:column;gap:6px">';
        clans.forEach(function(cl,i){
          h+='<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;background:var(--card);border:1px solid var(--border)">';
          h+='<span>'+(i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1))+'</span>';
          h+='<div style="flex:1;font-size:13px;font-weight:700">'+(cl.name||'Clan')+'</div>';
          h+='<span style="font-size:13px;font-weight:900;color:var(--green)">'+(cl.score||0)+'</span>';
          h+='</div>';
        });
        h+='</div>';
        document.getElementById('clanWarAdminContent').innerHTML=h;
      });
    });
  });
};

window._acceptWarChallenge=function(chalId,c1,c2,c1n,c2n,week){
  var db=getDB(); if(!db) return;
  db.ref('clanWars/'+week+'/challenges/'+chalId+'/status').set('accepted');
  var warId=db.ref('clanWars/'+week+'/matches').push().key;
  db.ref('clanWars/'+week+'/matches/'+warId).set({ clan1:c1,clan1Name:c1n,clan2:c2,clan2Name:c2n,clan1Score:0,clan2Score:0,status:'active',startedAt:Date.now() });
  /* Register both clans in standings */
  [c1,c2].forEach(function(cid,i){
    db.ref('clanWars/'+week+'/clans/'+cid).transaction(function(v){ v=v||{name:i===0?c1n:c2n,score:0,warWins:0,warLosses:0}; v.name=i===0?c1n:c2n; return v; });
  });
  toast('✅ Clan War activated!');
  if(window.loadClanWarAdmin) loadClanWarAdmin();
};

window._resolveWar=function(warId,week){
  var db=getDB(); if(!db) return;
  db.ref('clanWars/'+week+'/matches/'+warId).once('value',function(s){
    var war=s.val(); if(!war) return;
    var winner=war.clan1Score>war.clan2Score?{id:war.clan1,name:war.clan1Name}:{id:war.clan2,name:war.clan2Name};
    var loser =war.clan1Score>war.clan2Score?{id:war.clan2,name:war.clan2Name}:{id:war.clan1,name:war.clan1Name};
    db.ref('clanWars/'+week+'/matches/'+warId+'/status').set('finished');
    db.ref('clanWars/'+week+'/matches/'+warId+'/winnerId').set(winner.id);
    /* Update standings */
    db.ref('clanWars/'+week+'/clans/'+winner.id+'/warWins').transaction(function(v){ return (v||0)+1; });
    db.ref('clanWars/'+week+'/clans/'+loser.id+'/warLosses').transaction(function(v){ return (v||0)+1; });
    /* Notify winning clan members */
    db.ref('clans/'+winner.id+'/members').once('value',function(ms){
      ms.forEach(function(m){
        db.ref('users/'+m.key+'/notifications').push({ title:'⚔️ War Victory!', message:'Tumhare clan '+winner.name+' ne clan war jeet li! 🏆 Well played!', timestamp:Date.now(), read:false });
      });
    });
    toast('✅ War resolved! '+winner.name+' wins!');
    if(window.loadClanWarAdmin) loadClanWarAdmin();
  });
};

/* ============================================================
   4. CITY CHAMPIONSHIP ADMIN
============================================================ */
window.loadCityChampAdmin=function(){
  var c=document.getElementById('cityChampAdminContent'); if(!c) return;
  c.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i></div>';
  var db=getDB(); if(!db){ c.innerHTML='<p style="color:#ff6b6b">DB error</p>'; return; }
  var month=new Date().toISOString().substring(0,7);
  db.ref('cityChampionship/'+month+'/cities').orderByChild('score').limitToLast(20).once('value',function(s){
    var cities=[]; s.forEach(function(c){ var d=c.val(); d._city=c.key; cities.push(d); }); cities.reverse();
    var h='<div style="margin-bottom:12px;font-size:13px;color:var(--txt2)">Month: <strong style="color:var(--txt)">'+month+'</strong> · '+cities.length+' active cities</div>';
    h+='<div style="display:flex;gap:8px;margin-bottom:16px">';
    h+='<button onclick="window._resetCityChamp(\''+month+'\')" style="padding:9px 14px;border-radius:10px;border:1px solid rgba(255,107,107,.3);background:transparent;color:#ff6b6b;font-size:12px;cursor:pointer">⚠️ Reset This Month</button>';
    h+='</div>';
    if(!cities.length){ h+='<div class="empty-state">No cities this month</div>'; c.innerHTML=h; return; }
    h+='<div style="display:flex;flex-direction:column;gap:7px">';
    cities.forEach(function(ci,i){
      h+='<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:13px;background:var(--card);border:1px solid var(--border)">';
      h+='<span style="font-size:18px">'+(i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1))+'</span>';
      h+='<div style="flex:1"><div style="font-size:14px;font-weight:800">'+ci._city+'</div>';
      h+='<div style="font-size:11px;color:var(--txt2)">👥 '+( ci.playerCount||0)+' players · 🏆 '+(ci.wins||0)+' wins · 💀 '+(ci.kills||0)+' kills</div></div>';
      h+='<div style="font-size:16px;font-weight:900;color:var(--green)">'+(ci.score||0)+' pts</div>';
      h+='</div>';
    });
    h+='</div>';
    c.innerHTML=h;
  });
};

window._resetCityChamp=function(month){
  if(!confirm('Reset '+month+' city championship data? This is irreversible!')) return;
  var db=getDB(); if(!db) return;
  db.ref('cityChampionship/'+month).remove(function(){ toast('Reset done'); if(window.loadCityChampAdmin) loadCityChampAdmin(); });
};

/* ============================================================
   5. MENTOR ADMIN
============================================================ */
window.loadMentorAdmin=function(){
  var c=document.getElementById('mentorAdminContent'); if(!c) return;
  c.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i></div>';
  var db=getDB(); if(!db){ c.innerHTML='<p style="color:#ff6b6b">DB error</p>'; return; }
  db.ref('mentors').orderByChild('active').equalTo(true).once('value',function(s){
    var mentors=[]; s.forEach(function(m){ var d=m.val(); d._uid=m.key; mentors.push(d); });
    var h='<div style="margin-bottom:12px;font-size:13px;color:var(--txt2)">Active Mentors: <strong style="color:var(--txt)">'+mentors.length+'</strong></div>';
    if(!mentors.length){ h+='<div class="empty-state">Koi active mentor nahi</div>'; c.innerHTML=h; return; }
    h+='<div style="display:flex;flex-direction:column;gap:8px">';
    mentors.forEach(function(m){
      h+='<div style="padding:14px;border-radius:13px;background:var(--card);border:1px solid var(--border)">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">';
      h+='<div style="font-size:14px;font-weight:800">👨‍🏫 '+(m.ign||'Mentor')+' <span style="font-size:11px;color:#ffd700">'+(m.rankTier||'')+'</span></div>';
      h+='<button onclick="window._revokeMentor(\''+m._uid+'\')" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,107,107,.3);background:transparent;color:#ff6b6b;font-size:11px;cursor:pointer">Revoke</button>';
      h+='</div>';
      h+='<div style="display:flex;gap:14px;font-size:12px;color:var(--txt2)">';
      h+='<span>Students: <strong style="color:var(--txt)">'+(m.totalStudents||0)+'</strong></span>';
      h+='<span>Ranked Up: <strong style="color:var(--green)">'+(m.successfulStudents||0)+'</strong></span>';
      h+='<span>GD Earned: <strong style="color:#00d4ff">💎 '+(m.gdEarned||0)+'</strong></span>';
      h+='</div>';
      if(m.bio) h+='<div style="font-size:11px;color:var(--txt2);margin-top:4px;font-style:italic">"'+m.bio.substring(0,80)+'"</div>';
      h+='</div>';
    });
    h+='</div>';
    c.innerHTML=h;
  });
};

window._revokeMentor=function(uid){
  if(!confirm('Mentor status revoke karo?')) return;
  var db=getDB(); if(!db) return;
  db.ref('mentors/'+uid+'/active').set(false,function(){ toast('Revoked'); if(window.loadMentorAdmin) loadMentorAdmin(); });
};

/* ============================================================
   6. CLEAN BADGE ADMIN
============================================================ */
window.loadCleanBadgeAdmin=function(){
  var c=document.getElementById('cleanBadgeAdminContent'); if(!c) return;
  c.innerHTML='<div class="loading-state"><i class="fas fa-spinner fa-spin"></i></div>';
  if(!window._supa){ c.innerHTML='<p style="color:#ff6b6b">Supabase not connected</p>'; return; }
  /* Load users with clean badge via Firebase */
  var db=getDB(); if(!db){ c.innerHTML='<p style="color:#ff6b6b">DB error</p>'; return; }
  /* Query Firebase for users with cleanRecord.hasBadge = true */
  var h='<div style="margin-bottom:12px;font-size:13px;color:var(--txt2)">Users who have earned the Clean Player Badge</div>';
  h+='<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.2);border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:var(--txt2)">';
  h+='✅ Clean Badge = 30 matches without reports, rage quits, or warnings.<br>⚠️ Report a user to automatically revoke their badge.';
  h+='</div>';
  h+='<div id="cleanBadgeUserSearch"><div style="position:relative;margin-bottom:10px">';
  h+='<input id="cbSearchIn" type="text" placeholder="UID ya IGN se search..." oninput="window._cbSearch(this.value)" style="width:100%;padding:10px 40px 10px 14px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--txt);box-sizing:border-box">';
  h+='<i class="fas fa-search" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--txt2)"></i>';
  h+='</div><div id="cbResults"><div style="text-align:center;padding:16px;color:var(--txt2);font-size:12px">Search karo...</div></div></div>';
  c.innerHTML=h;
};

var _cbTimer=null;
window._cbSearch=function(q){
  q=(q||'').trim();
  var r=document.getElementById('cbResults'); if(!r) return;
  if(q.length<2){ r.innerHTML='<div style="text-align:center;padding:12px;color:var(--txt2);font-size:12px">2+ chars type karo</div>'; return; }
  r.innerHTML='<div style="text-align:center;padding:12px;color:var(--txt2)"><i class="fas fa-spinner fa-spin"></i></div>';
  clearTimeout(_cbTimer);
  _cbTimer=setTimeout(function(){
    if(!window._supa){ r.innerHTML='<div style="color:#ff6b6b;text-align:center">Supabase error</div>'; return; }
    window._supa.from('users').select('id,ign,ff_uid,rank_points').or('ign.ilike.%'+q+'%,ff_uid.ilike.%'+q+'%').limit(10)
    .then(function(res){
      var users=res.data||[];
      if(!users.length){ r.innerHTML='<div style="text-align:center;padding:12px;color:var(--txt2)">Not found</div>'; return; }
      var db=getDB(); var done=0; var allH='<div style="display:flex;flex-direction:column;gap:7px">';
      users.forEach(function(u){
        db.ref('users/'+u.id+'/cleanRecord').once('value',function(s){
          var rec=s.val()||{cleanMatches:0,hasBadge:false};
          allH+='<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;background:var(--card);border:1px solid '+(rec.hasBadge?'rgba(0,255,156,.3)':'var(--border)')+'">';
          allH+='<span style="font-size:18px">'+(rec.hasBadge?'✅':'⏳')+'</span>';
          allH+='<div style="flex:1"><div style="font-size:13px;font-weight:700">'+(u.ign||'Player')+'</div>';
          allH+='<div style="font-size:11px;color:var(--txt2)">'+(rec.cleanMatches||0)+'/30 clean matches</div></div>';
          if(rec.hasBadge) allH+='<button onclick="window._revokeCleanBadge(\''+u.id+'\')" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,107,107,.3);background:transparent;color:#ff6b6b;font-size:11px;cursor:pointer">Revoke</button>';
          allH+='</div>';
          done++;
          if(done===users.length) r.innerHTML=allH+'</div>';
        });
      });
    }).catch(function(){ r.innerHTML='<div style="color:#ff6b6b;text-align:center">Error</div>'; });
  },300);
};

window._revokeCleanBadge=function(uid){
  if(!confirm('Clean badge revoke karo?')) return;
  var db=getDB(); if(!db) return;
  db.ref('users/'+uid+'/cleanRecord').update({ hasBadge:false, revokedAt:Date.now(), revokedBy:'admin', cleanMatches:0 },function(){
    db.ref('users/'+uid+'/notifications').push({ title:'⚠️ Clean Badge Revoked', message:'Tumhara Clean Player badge admin ke zariye revoke hua hai.', timestamp:Date.now(), read:false });
    toast('Badge revoked'); if(window.loadCleanBadgeAdmin) loadCleanBadgeAdmin();
  });
};

/* ============================================================
   7. RANK-LOCKED MATCH CREATION PATCH
   Adds rank_tier selector to Quick Create + regular match forms
============================================================ */
var _rankPatchI=0,_rankPatchT=setInterval(function(){
  _rankPatchI++; if(_rankPatchI>60){ clearInterval(_rankPatchT); return; }
  /* Patch the Quick Create overlay when it opens */
  var orig=window._qcCreate;
  if(!orig||window._qcCreateRankPatched) return;
  clearInterval(_rankPatchT);
  window._qcCreateRankPatched=true;
  window._qcCreate=function(){
    /* Read rank tier if set */
    var rankTier=((document.getElementById('_qcRankTier')||{}).value||'all');
    /* Call original to create match */
    var origRef=window.db&&window.db.ref;
    /* Hook db.ref().set to intercept matchData */
    var origPush=window.db&&window.db.ref('matches').push;
    orig.call(this);
    /* Post-patch: find last created match and add rank_tier */
    setTimeout(function(){
      if(rankTier==='all') return;
      var db=getDB(); if(!db) return;
      db.ref('matches').orderByChild('createdAt').limitToLast(1).once('value',function(s){
        s.forEach(function(m){ db.ref('matches/'+m.key+'/rank_tier').set(rankTier); });
      });
    },1000);
  };
  /* Also inject rank tier select into Quick Create form when it opens */
  var _qcObs=setInterval(function(){
    var form=document.getElementById('_qcTime'); if(!form) return;
    if(document.getElementById('_qcRankTier')) return;
    var wrap=form.closest('div[style]')||form.parentNode;
    if(!wrap) return;
    var rankDiv=document.createElement('div');
    rankDiv.style.cssText='margin-top:10px';
    rankDiv.innerHTML='<label style="font-size:11px;color:rgba(255,255,255,.5);font-weight:700;display:block;margin-bottom:5px">🎯 RANK TIER (optional)</label>'
      +'<select id="_qcRankTier" style="width:100%;padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:13px">'
      +'<option value="all">All Ranks (Open)</option>'
      +'<option value="Bronze">🏅 Bronze Only</option>'
      +'<option value="Silver">🥈 Silver Only</option>'
      +'<option value="Gold">🥇 Gold Only</option>'
      +'<option value="Diamond">💎 Diamond Only</option>'
      +'</select>';
    wrap.insertBefore(rankDiv, wrap.lastElementChild);
  },300);
},500);

/* ============================================================
   HELPERS
============================================================ */
function _getAdminWeek(){
  /* ✅ Bug 20 Fix: ISO week Monday calculation (Sunday = day 0 → needs to go back 6 days to Monday) */
  var d = new Date();
  var day = d.getDay(); /* 0=Sun, 1=Mon, ... 6=Sat */
  var mon = new Date(d);
  /* Days to subtract to reach Monday:
     Mon(1)→0, Tue(2)→1, Wed(3)→2, Thu(4)→3, Fri(5)→4, Sat(6)→5, Sun(0)→6 */
  var daysBack = (day === 0) ? 6 : (day - 1);
  mon.setDate(d.getDate() - daysBack);
  mon.setHours(0, 0, 0, 0);
  /* Return YYYY-MM-DD using local date parts to avoid UTC shift */
  var yyyy = mon.getFullYear();
  var mm   = String(mon.getMonth() + 1).padStart(2, '0');
  var dd   = String(mon.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

})();
