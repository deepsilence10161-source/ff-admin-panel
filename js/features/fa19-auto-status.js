/* ADMIN FEATURE A19: Auto Match Status Update
   Keep the database vocabulary aligned with admin-inline.js and the user
   panel: upcoming → live → completed. The old "ongoing" value made one
   scheduler disagree with the rest of the app. */
(function(){
'use strict';
function checkStatuses(){
  var now=Date.now();
  rtdb.ref('matches').once('value',function(s){
    var updates={};
    s.forEach(function(c){
      var d=c.val(); if(!d||!d.matchTime) return;
      var mt=Number(d.matchTime);
      /* Match lifecycle is one hour everywhere else in the admin panel. */
      var endTime=mt+(d.duration||60)*60000;
      if(d.status==='upcoming'&&now>=mt&&now<endTime){
        updates['matches/'+c.key+'/status']='live';
        updates['matches/'+c.key+'/startedAt']=now;
      }
      if((d.status==='live'||d.status==='ongoing')&&now>=endTime){
        updates['matches/'+c.key+'/status']='completed';
        updates['matches/'+c.key+'/completedAt']=now;
      }
    });
    if(Object.keys(updates).length>0){
      rtdb.ref().update(updates);
      console.log('[fa19] Auto-updated statuses:', Object.keys(updates));
    }
  });
}
// ✅ FIX (live-testing): this READS AND WRITES `matches` (Supabase-only,
// auto-transitions match status/timestamps) starting just 5s after script
// load with no bridge check at all — if window.rtdb isn't the Supabase
// bridge yet, this both throws permission_denied on raw Firebase AND, if
// it ever got a stale/partial raw-Firebase snapshot, could write bogus
// status updates. Wait for the bridge before the first run and every
// subsequent one.
function _waitForBridgeThenCheck(waited){
  waited = waited || 0;
  if (window.rtdb && window.rtdb._isSupaBridge) { checkStatuses(); return; }
  if (waited >= 20000) { console.warn('[fa19] Supabase bridge never became ready — auto-status check skipped this cycle.'); return; }
  setTimeout(function(){ _waitForBridgeThenCheck(waited + 300); }, 300);
}
// Run every 2 minutes
setInterval(_waitForBridgeThenCheck, 2*60*1000);
setTimeout(_waitForBridgeThenCheck, 5000);
window.fa19AutoStatus={check:checkStatuses};
})();
