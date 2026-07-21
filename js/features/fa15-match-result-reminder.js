/* ADMIN FEATURE A15: Auto Result Entry Reminder
   Match khatam hone ke 30 min baad agar result entry nahi hui → browser alert + badge. */
(function(){
'use strict';
var _checked={};

function checkPending(){
  rtdb.ref('matches').orderByChild('status').equalTo('ongoing').once('value',function(s){
    var now=Date.now();
    s.forEach(function(c){
      var d=c.val()||{};
      var mid=c.key;
      if(_checked[mid]) return;
      var end=Number(d.matchTime||0)+(d.duration||30)*60000;
      if(now>end+30*60000){
        _checked[mid]=true;
        var badge=document.getElementById('pendingResultBadge');
        if(badge){ badge.style.display='flex'; badge.textContent=(parseInt(badge.textContent)||0)+1; }
        if(window.toast) toast('⚠️ '+d.name+' result entry pending!','warn');
      }
    });
  });
}

setInterval(checkPending, 5*60*1000);
setTimeout(checkPending, 3000);
window.fa15Reminders={check:checkPending};
})();
