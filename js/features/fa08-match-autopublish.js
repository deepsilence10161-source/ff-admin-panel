/* ADMIN FEATURE A08: Auto-Publish Room ID at Match Time
   Admin ne room ID set kiya → system automatically publishes at matchTime to all joined users. */
(function(){
'use strict';
var _scheduled={};

window.fa08ScheduleRoom=async function(matchId,roomId,roomPass){
  var s=await rtdb.ref('matches/'+matchId).once('value');
  var t=s.val(); if(!t||!t.matchTime){ showToast('Match time not set',true); return; }
  var delay=Number(t.matchTime)-Date.now();
  if(delay<0){ await fa08PublishNow(matchId,roomId,roomPass); return; }
  _scheduled[matchId]={roomId:roomId,roomPass:roomPass};
  setTimeout(async function(){ await fa08PublishNow(matchId,roomId,roomPass); },delay);
  showToast('✅ Room ID auto-publish scheduled for match time!');
};

window.fa08PublishNow=async function(matchId,roomId,roomPass){
  try{
    await rtdb.ref('matches/'+matchId).update({roomId:roomId,roomPass:roomPass,roomReleased:true,roomReleasedAt:Date.now()});
    // Notify all joined players
    var js=await rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value');
    var batch={};
    js.forEach(function(c){
      var uid=(c.val()||{}).userId; if(!uid) return;
      var nk=rtdb.ref('users/'+uid+'/notifications').push().key;
      batch['users/'+uid+'/notifications/'+nk]={title:'🔑 Room ID Released!',message:t.name+' ka Room: '+roomId+(roomPass?' | Pass: '+roomPass:''),type:'room',timestamp:Date.now(),read:false};
    });
    await rtdb.ref().update(batch);
    showToast('✅ Room ID published & players notified!');
    delete _scheduled[matchId];
  }catch(e){showToast('Error: '+e.message,true);}
};
})();
