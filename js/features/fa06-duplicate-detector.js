/* ADMIN FEATURE A06: Duplicate Join Detector
   Ek hi FF UID ya phone se multiple accounts detect kare. Alert admin. */
(function(){
'use strict';
window.fa06DuplicateDetect=async function(){
  try{
    var s=await rtdb.ref('users').once('value');
    var ffMap={},phMap={},dupes=[];
    s.forEach(function(c){
      var d=c.val()||{};
      if(d.ffUid){
        if(ffMap[d.ffUid]){ dupes.push({type:'FF UID',val:d.ffUid,uids:[ffMap[d.ffUid],c.key]}); }
        else ffMap[d.ffUid]=c.key;
      }
      if(d.phone){
        if(phMap[d.phone]){ dupes.push({type:'Phone',val:d.phone,uids:[phMap[d.phone],c.key]}); }
        else phMap[d.phone]=c.key;
      }
    });
    var h='<div>';
    if(!dupes.length){ h+='<div style="text-align:center;padding:20px;color:#00ff9c">✅ No duplicates found!</div>'; }
    else dupes.forEach(function(d){
      h+='<div style="background:rgba(255,60,60,.1);border:1px solid rgba(255,60,60,.3);border-radius:10px;padding:10px;margin-bottom:8px">'
        +'<strong style="color:#ff4444">⚠️ Duplicate '+d.type+'</strong><br>'
        +'<span style="font-size:12px;color:#aaa">'+d.val+'</span><br>'
        +'<span style="font-size:11px;color:#ccc">UIDs: '+d.uids.join(' | ')+'</span><br>'
        +'<button onclick="fa06BanUid(\''+d.uids[1]+'\')" style="margin-top:6px;padding:4px 10px;background:#ff4444;border:none;border-radius:6px;color:#fff;font-size:11px;cursor:pointer">Ban Second Account</button>'
        +'</div>';
    });
    h+='</div>';
    showAdminModal('🔍 Duplicate Accounts ('+dupes.length+')',h);
  }catch(e){showToast('Error: '+e.message,true);}
};
window.fa06BanUid=async function(uid){
  await rtdb.ref('users/'+uid).update({banned:true,banReason:'Duplicate account detected',bannedAt:Date.now()});
  showToast('✅ Account banned'); closeAdminModal();
};
})();
