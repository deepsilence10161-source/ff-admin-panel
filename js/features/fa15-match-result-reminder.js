/* ADMIN FEATURE A15: Auto Result Entry Reminder
   Match khatam hone ke 30 min baad agar result entry nahi hui → browser alert + badge. */
(function(){
'use strict';
var _checked={};

function checkPending(){
  rtdb.ref('matches').orderByChild('status').equalTo('live').once('value',function(s){
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

// ✅ FIX (live-testing): queries `matches` (Supabase-only) starting 3s
// after load with no bridge check — wait for the actual Supabase bridge.
function _waitForBridgeThenCheckPending(waited){
  waited = waited || 0;
  if (window.rtdb && window.rtdb._isSupaBridge) { checkPending(); return; }
  if (waited >= 20000) { return; }
  setTimeout(function(){ _waitForBridgeThenCheckPending(waited + 300); }, 300);
}
setInterval(_waitForBridgeThenCheckPending, 5*60*1000);
setTimeout(_waitForBridgeThenCheckPending, 3000);
window.fa15Reminders={check:checkPending};
})();
