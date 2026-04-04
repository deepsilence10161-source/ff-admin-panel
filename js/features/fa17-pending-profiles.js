/* ADMIN FEATURE A17: Pending Profile Approvals Quick View
   Dashboard pe badge dikhe + one-click approve/reject. */
(function(){
'use strict';
function checkPending(){
  rtdb.ref('profileRequests').orderByChild('status').equalTo('pending').once('value',function(s){
    var count=0; s.forEach(function(){ count++; });
    var badge=document.getElementById('pendingProfileBadge');
    if(badge){ badge.style.display=count>0?'flex':'none'; badge.textContent=count>9?'9+':count; }
  });
}

window.fa17PendingProfiles=async function(){
  var s=await rtdb.ref('profileRequests').orderByChild('status').equalTo('pending').once('value');
  var list=[];
  s.forEach(function(c){ var d=c.val(); d._k=c.key; list.push(d); });
  var h='<div>';
  if(!list.length){ h+='<div style="text-align:center;padding:20px;color:#00ff9c">✅ No pending profiles!</div>'; }
  list.forEach(function(p){
    h+='<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;margin-bottom:8px">'
      +'<div style="font-weight:700;margin-bottom:2px">'+(p.ign||'User')+'</div>'
      +'<div style="font-size:12px;color:#aaa;margin-bottom:8px">FF UID: '+(p.ffUid||'-')+' · Phone: '+(p.phone||'-')+'</div>'
      +'<div style="display:flex;gap:8px">'
      +'<button onclick="fa17Act(\''+p._k+'\',\''+p.userId+'\',\'approve\')" style="flex:1;padding:8px;border-radius:8px;background:#00ff9c;color:#000;font-weight:700;border:none;cursor:pointer;font-size:12px">✅ Approve</button>'
      +'<button onclick="fa17Act(\''+p._k+'\',\''+p.userId+'\',\'reject\')" style="flex:1;padding:8px;border-radius:8px;background:#ff4444;color:#fff;font-weight:700;border:none;cursor:pointer;font-size:12px">❌ Reject</button>'
      +'</div></div>';
  });
  h+='</div>';
  showAdminModal('👤 Pending Profiles ('+list.length+')',h);
};

window.fa17Act=async function(key,uid,action){
  await rtdb.ref('profileRequests/'+key).update({status:action,reviewedAt:Date.now()});
  if(action==='approve'){
    await rtdb.ref('users/'+uid).update({profileStatus:'verified',verifiedAt:Date.now()});
    var nk=rtdb.ref('users/'+uid+'/notifications').push().key;
    await rtdb.ref('users/'+uid+'/notifications/'+nk).set({title:'✅ Profile Verified!',message:'Tumhara profile verify ho gaya. Ab sab matches join kar sakte ho!',type:'system',timestamp:Date.now(),read:false});
  }
  showToast(action==='approve'?'✅ Approved!':'❌ Rejected');
  fa17PendingProfiles(); checkPending();
};

setInterval(checkPending, 3*60*1000);
setTimeout(checkPending, 2000);
window.fa17Pending={check:checkPending};
})();
