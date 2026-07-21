/* ADMIN FEATURE A18: Per-Match Stats Summary
   Match complete hone ke baad: total joins, avg kills, top player, revenue generated. */
(function(){
'use strict';
window.fa18MatchStats=async function(matchId){
  try{
    var [ms,rs,js]=await Promise.all([
      rtdb.ref('matches/'+matchId).once('value'),
      rtdb.ref('matches/'+matchId+'/results').once('value'),
      rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value')
    ]);
    var match=ms.val()||{};
    var totalJoins=0; js.forEach(function(){totalJoins++;});
    var results=[]; rs.forEach(function(c){ results.push(c.val()); });
    var totalKills=results.reduce(function(a,r){return a+(r.kills||0);},0);
    var avgKills=results.length?Math.round(totalKills/results.length*10)/10:0;
    var topPlayer=results.reduce(function(a,r){return (r.kills||0)>(a.kills||0)?r:a},{kills:0});
    var revenue=(match.entryFee||0)*totalJoins;
    var prizePaid=(match.firstPrize||0)+(match.secondPrize||0)+(match.thirdPrize||0);
    var profit=revenue-prizePaid;

    var h='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    [
      ['👥 Total Joins',totalJoins,'#00d4ff'],
      ['💀 Avg Kills',avgKills,'#ff6b6b'],
      ['💰 Revenue','₹'+revenue,'#ffd700'],
      ['🏆 Profit','₹'+Math.max(0,profit),profit>=0?'#00ff9c':'#ff4444'],
    ].forEach(function(c){
      h+='<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;text-align:center">'
        +'<div style="font-size:11px;color:#aaa;margin-bottom:4px">'+c[0]+'</div>'
        +'<div style="font-size:20px;font-weight:900;color:'+c[2]+'">'+c[1]+'</div></div>';
    });
    h+='</div>';
    if(topPlayer.kills>0){
      h+='<div style="margin-top:10px;padding:10px;background:rgba(255,215,0,.08);border-radius:10px;font-size:12px">'
        +'<strong>💀 Most Kills:</strong> '+(topPlayer.ign||topPlayer.userId||'Unknown')+' ('+topPlayer.kills+' kills)</div>';
    }
    showAdminModal('📊 Match Stats: '+match.name,h);
  }catch(e){showToast('Error: '+e.message,true);}
};
})();
