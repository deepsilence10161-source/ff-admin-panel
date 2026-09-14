/* ADMIN FEATURE A12: Smart Bulk Notification Sender
   Ek click mein custom message sab/selected users ko. With type tagging. */
(function(){
'use strict';
window.fa12BulkNotify=function(){
  var h='<div>'
    +'<div class="form-group"><label>Target</label><select id="bn_target" class="form-input"><option value="all">All Users</option><option value="verified">Verified Only</option><option value="active">Active (7 days)</option></select></div>'
    +'<div class="form-group"><label>Title</label><input id="bn_title" class="form-input" placeholder="e.g. New Match Live!" maxlength="60"></div>'
    +'<div class="form-group"><label>Message</label><textarea id="bn_msg" class="form-input" rows="3" placeholder="Match details, link..." maxlength="200"></textarea></div>'
    +'<div class="form-group"><label>Type</label><select id="bn_type" class="form-input"><option value="system">📢 System</option><option value="result">🏆 Result</option><option value="match">🎮 Match</option><option value="referral">🎁 Referral</option></select></div>'
    +'<button onclick="fa12Send()" style="width:100%;padding:12px;border-radius:12px;background:var(--primary,#00ff9c);color:#000;font-weight:800;border:none;cursor:pointer">📤 Send Notification</button>'
    +'</div>';
  showAdminModal('📢 Bulk Notify',h);
};

window.fa12Send=async function(){
  var target=document.getElementById('bn_target').value;
  var title=document.getElementById('bn_title').value.trim();
  var msg=document.getElementById('bn_msg').value.trim();
  var type=document.getElementById('bn_type').value;
  if(!title||!msg){ showToast('Title & message required',true); return; }

  var now=Date.now();
  var s=await rtdb.ref('users').once('value');
  var batch={};
  s.forEach(function(c){
    var d=c.val()||{};
    if(target==='verified'&&d.profileStatus!=='verified') return;
    if(target==='active'&&(Date.now()-Number(d.lastSeen||d.lastLogin||0))>7*86400000) return;
    var nk=rtdb.ref('users/'+c.key+'/notifications').push().key;
    batch['users/'+c.key+'/notifications/'+nk]={title:title,message:msg,type:type,timestamp:now,read:false};
  });
  await rtdb.ref().update(batch);
  showToast('✅ Notifications sent to '+(Object.keys(batch).length)+' users!');
  closeAdminModal();
};
})();
