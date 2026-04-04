/* ADMIN FEATURE A13: One-Click Match Clone
   Existing match ka data copy karke naya match banao — time change karo sirf. */
(function(){
'use strict';
window.fa13CloneMatch=async function(matchId){
  try{
    var s=await rtdb.ref('matches/'+matchId).once('value');
    var orig=s.val(); if(!orig){ showToast('Match nahi mila',true); return; }
    var h='<div>'
      +'<div style="background:rgba(0,255,156,.06);border-radius:10px;padding:10px;margin-bottom:12px;font-size:13px"><strong>'+orig.name+'</strong><br><span style="color:#aaa;font-size:11px">'+orig.mode+' · ₹'+( orig.prizePool||0)+' pool · ₹'+(orig.entryFee||0)+' entry</span></div>'
      +'<div class="form-group"><label>New Match Name</label><input id="clone_name" class="form-input" value="'+orig.name+' (Copy)" maxlength="60"></div>'
      +'<div class="form-group"><label>New Match Date & Time</label><input type="datetime-local" id="clone_time" class="form-input"></div>'
      +'<button onclick="fa13DoClone(\''+matchId+'\')" style="width:100%;padding:12px;border-radius:12px;background:var(--primary,#00ff9c);color:#000;font-weight:800;border:none;cursor:pointer">📋 Clone Match</button>'
      +'</div>';
    showAdminModal('📋 Clone: '+orig.name,h);
  }catch(e){showToast('Error: '+e.message,true);}
};

window.fa13DoClone=async function(matchId){
  try{
    var s=await rtdb.ref('matches/'+matchId).once('value');
    var orig=Object.assign({},s.val());
    var name=document.getElementById('clone_name').value.trim();
    var dt=document.getElementById('clone_time').value;
    if(!name||!dt){ showToast('Name & time required',true); return; }
    orig.name=name;
    orig.matchTime=new Date(dt).getTime();
    orig.status='upcoming';
    orig.roomId=''; orig.roomPass=''; orig.roomReleased=false;
    orig.createdAt=Date.now();
    delete orig.result;
    var nr=rtdb.ref('matches').push();
    await nr.set(orig);
    showToast('✅ Match cloned!'); closeAdminModal();
  }catch(e){showToast('Error: '+e.message,true);}
};
})();
