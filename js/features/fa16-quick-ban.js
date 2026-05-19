/* ADMIN FEATURE A16: Quick Ban from Match Results
   Result entry row pe direct ban button — no need to go to users tab. */
(function(){
'use strict';
window.fa16QuickBan=async function(uid,ign){
  if(!confirm('Ban '+( ign||uid)+'?')) return;
  var reason=prompt('Reason:','Suspicious activity');
  if(!reason) return;
  await rtdb.ref('users/'+uid).update({banned:true,banReason:reason,bannedAt:Date.now()});
  // Notify user
  var nk=rtdb.ref('users/'+uid+'/notifications').push().key;
  await rtdb.ref('users/'+uid+'/notifications/'+nk).set({title:'🚫 Account Banned',message:'Reason: '+reason,type:'system',timestamp:Date.now(),read:false});
  showToast('🚫 '+( ign||uid)+' banned!');
};
})();
