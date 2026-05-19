/* ADMIN FEATURE A19: Auto Match Status Update
   Match time aane par status "upcoming" → "ongoing" automatic.
   Match time + 30min baad "ongoing" → "completed" automatic. */
(function(){
'use strict';
function checkStatuses(){
  var now=Date.now();
  rtdb.ref('matches').once('value',function(s){
    var updates={};
    s.forEach(function(c){
      var d=c.val(); if(!d||!d.matchTime) return;
      var mt=Number(d.matchTime);
      var endTime=mt+(d.duration||30)*60000;
      if(d.status==='upcoming'&&now>=mt&&now<endTime){
        updates['matches/'+c.key+'/status']='ongoing';
        updates['matches/'+c.key+'/startedAt']=now;
      }
      if(d.status==='ongoing'&&now>=endTime){
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
// Run every 2 minutes
setInterval(checkStatuses, 2*60*1000);
setTimeout(checkStatuses, 5000);
window.fa19AutoStatus={check:checkStatuses};
})();
