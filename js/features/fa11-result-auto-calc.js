/* ADMIN FEATURE A11: Auto Result Calculator
   Admin sirf rank+kills daale → system calculates prize, kills prize, total.
   Also updates user stats, wallet, leaderboard, cashback flag. */
(function(){
'use strict';
window.fa11CalcResult=function(matchId){
  var t=window.matchCache&&window.matchCache[matchId];
  if(!t){ showToast('Match data nahi mila',true); return; }
  var first=Number(t.firstPrize||0);
  var second=Number(t.secondPrize||0);
  var third=Number(t.thirdPrize||0);
  var perKill=Number(t.perKillPrize||t.perKill||0);
  // Return prize for a given rank
  return function(rank,kills){
    var rp=rank===1?first:rank===2?second:rank===3?third:0;
    var kp=kills*perKill;
    return {rankPrize:rp,killPrize:kp,total:rp+kp};
  };
};

// Hook into result rows — auto-fill prize when rank+kills entered
window.fa11AutoFillRow=function(row,matchId){
  var calc=window.fa11CalcResult&&window.fa11CalcResult(matchId);
  if(!calc) return;
  var rankEl=row.querySelector('.rank-input');
  var killEl=row.querySelector('.kills-input');
  var prizeEl=row.querySelector('.prize-display');
  function update(){
    var rank=Number(rankEl&&rankEl.value)||0;
    var kills=Number(killEl&&killEl.value)||0;
    if(!rank) return;
    var res=calc(rank,kills);
    if(prizeEl) prizeEl.textContent='₹'+res.total+' (R:'+res.rankPrize+'+K:'+res.killPrize+')';
    row._calcData=res;
  }
  if(rankEl) rankEl.addEventListener('input',update);
  if(killEl) killEl.addEventListener('input',update);
};
})();
