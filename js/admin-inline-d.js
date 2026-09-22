/* ── admin-inline.js · Part D: OPERATIONS (join requests, partners, chat, notif, settings, sections, disputes, templates, verify, result-correction, match-result, match-history) ── */
function setupJoinRequestsListener(){
  rtdb.ref(DB_JOIN).on('value',function(s){
    allJoinRequests={};
    s.forEach(function(c){allJoinRequests[c.key]=c.val();});
    /* Keep the Joined Players table fresh if it's currently visible */
    if(document.getElementById('joinedPlayersTable')&&typeof loadJoinedPlayers==='function'){
      try{loadJoinedPlayers();}catch(e){}
    }
  });
}
/* ✅ REMOVED (2026-08-19): normalizeWalletType() and renderWalletRequests()
   deleted along with the rest of the Wallet Requests tab. */
function viewScreenshot(src){document.getElementById('screenshotFullImg').src=src;document.getElementById('screenshotModal').classList.add('show');}
/* ✅ REMOVED (2026-08-19): approveAddMoney(), openWithdrawalModal(),
   previewWithdrawProof(), and confirmWithdrawal() deleted along with
   the rest of the Wallet Requests tab — see index.html's sidebar
   nav-item removal comment for the full explanation.

   ⚠️ IMPORTANT NOTE FOR JUNAID: confirmWithdrawal() (deleted here) was
   the ONLY place in the entire codebase that actually READ the
   Settings page's TDS toggle (appSettings/tdsConfig) and applied a
   real deduction — calculated tdsDeducted, recorded a tdsRecords
   entry, and paid out the net amount. Neither of the two withdrawal
   paths that are actually live today (resolve_sd_request for Green
   Diamond withdrawals, resolve_sponsored_withdrawal for Sponsored
   Prize withdrawals — both live in Supabase) apply any TDS deduction
   at all right now, and never have since those paths went live —
   this function was already unreachable dead code with respect to
   real withdrawal data before this deletion (it only ever worked off
   allWalletRequests, which nothing has populated with real pending
   withdrawals since diamond-system.js moved to writing sd_requests
   directly). This means TDS is NOT currently being deducted or
   tracked on any real withdrawal, which is a genuine compliance gap
   for a real-money platform (Section 194BA). This was NOT something
   this cleanup session was asked to fix, and deciding how TDS should
   apply to each currency/withdrawal type is a real business/legal
   decision, not something to guess at silently — flagging clearly
   instead of either deleting the only reference calculation with no
   trace, or unilaterally wiring tax logic into a live RPC. The exact
   calculation (30% default rate, configurable via appSettings/tdsConfig,
   floor-rounded) is preserved in this session's own written summary
   and in git history if this file was ever committed before this
   change. */
/* =============================================
   REJECT MODAL
   ============================================= */
function openRejectModal(tp,rid){pendingRejectData={type:tp,requestId:rid};document.getElementById('rejectReason').value='';document.getElementById('rejectModal').classList.add('show');}
async function submitReject(){
  if(!pendingRejectData)return;var rsn=document.getElementById('rejectReason').value.trim();if(!rsn)return showToast('Reason required',true);
  /* Disable reject button to prevent double clicks */
  var rejectBtns=document.querySelectorAll('#rejectModal .btn-danger');
  rejectBtns.forEach(function(b){b.disabled=true;b.style.opacity='0.5';});
  var type=pendingRejectData.type,requestId=pendingRejectData.requestId;
  try{
    if(type==='profile'){
      /* ✅ FIX (live-testing — same root cause as approveProfile/rejectProfile):
         this direct RPC call had NO auth-ready check at all. If window._supa
         was still the anon client (before syncFirebaseToken authenticates
         it), admin_reject_profile's is_caller_admin() check would read a
         null auth.jwt() and return not_authorized every time. */
      if(!window._supa||!window._supaAuthed) throw new Error('Not ready — try again in a moment');
      var rpcRes=await window._supa.rpc('admin_reject_profile',{p_request_id:requestId,p_reason:rsn});if(rpcRes.error||!rpcRes.data||!rpcRes.data.success)throw new Error((rpcRes.error&&rpcRes.error.message)||(rpcRes.data&&rpcRes.data.error)||'Reject failed');}
    else if(type==='profileUpdate'){var s2=await rtdb.ref(DB_PROFILE_UPDATE+'/'+requestId).once('value');var r2=s2.val(),uid2=r2?getUid(r2):null;await rtdb.ref(DB_PROFILE_UPDATE+'/'+requestId).update({status:'rejected',rejectionReason:rsn,processedAt:Date.now()});if(uid2){await rtdb.ref(DB_USERS+'/'+uid2).update({profileUpdatePending:false});await rtdb.ref(DB_USERS+'/'+uid2+'/notifications').push({title:'Update Rejected ❌',message:'Reason: '+rsn,timestamp:Date.now(),read:false});}}
    /* ✅ REMOVED (2026-08-19): the type==='wallet' branch here (Wallet
       Requests tab's own reject handler) deleted along with the rest of
       the tab — openRejectModal('wallet', ...) is never called anymore.
       Sky Diamond purchase/withdrawal rejects now go through
       rejectSkyDiaReq() (Supabase resolve_sd_request RPC, already
       correctly refunds on a rejected withdrawal); Premium rejects
       through rejectPremiumReq(); Sponsored Prize rejects through
       window.rejectSponsoredWd() in admin-supabase-sponsored.js. */
    /* ✅ REMOVED (2026-08-21): type==='team' reject branch — Team Requests removed, nothing calls openRejectModal('team', ...) anymore. */
    closeModal('rejectModal');showToast('Rejected');
  }catch(e){showToast('Error: '+e.message,true);}
}

/* =============================================
   TEAMS
   ============================================= */
/* ✅ REMOVED (2026-08-21): loadTeamRequests / approveTeam deleted along
   with the Team Requests section — teammates are now added directly by
   users via the squad flow with no admin approval step. Kept
   setUserPartner below since it's a separate, still-used admin tool for
   manually pairing partners outside the request flow. */

/* ===== SET PARTNER FUNCTION (TWO-WAY SYNC) ===== */
/* When admin sets partner for a user, automatically set the reverse relationship */
async function setUserPartner(userA, userB){
  if(!userA||!userB){
    console.error('setUserPartner: Both UIDs required');
    return false;
  }
  
  try{
    /* Two-way sync: A → B and B → A */
    await rtdb.ref(DB_USERS+'/'+userA+'/partnerUid').set(userB);
    await rtdb.ref(DB_USERS+'/'+userB+'/partnerUid').set(userA);
    
    /* Also add to duoTeam arrays */
    var aTeam=await rtdb.ref(DB_USERS+'/'+userA+'/duoTeam').once('value');
    var aArr=aTeam.val()||[];
    if(aArr.indexOf(userB)<0){
      aArr.push(userB);
      await rtdb.ref(DB_USERS+'/'+userA+'/duoTeam').set(aArr);
    }
    
    var bTeam=await rtdb.ref(DB_USERS+'/'+userB+'/duoTeam').once('value');
    var bArr=bTeam.val()||[];
    if(bArr.indexOf(userA)<0){
      bArr.push(userA);
      await rtdb.ref(DB_USERS+'/'+userB+'/duoTeam').set(bArr);
    }
    
    console.log('✅ Two-way partner set: '+userA+' ↔ '+userB);
    return true;
  }catch(e){
    console.error('setUserPartner error:',e);
    return false;
  }
}

/* Remove partner relationship (two-way) */
async function removeUserPartner(userA, userB){
  if(!userA||!userB){
    console.error('removeUserPartner: Both UIDs required');
    return false;
  }
  
  try{
    /* Remove partnerUid from both */
    await rtdb.ref(DB_USERS+'/'+userA+'/partnerUid').remove();
    await rtdb.ref(DB_USERS+'/'+userB+'/partnerUid').remove();
    
    /* Remove from duoTeam arrays */
    var aTeam=await rtdb.ref(DB_USERS+'/'+userA+'/duoTeam').once('value');
    var aArr=aTeam.val()||[];
    var aIdx=aArr.indexOf(userB);
    if(aIdx>=0){
      aArr.splice(aIdx,1);
      await rtdb.ref(DB_USERS+'/'+userA+'/duoTeam').set(aArr);
    }
    
    var bTeam=await rtdb.ref(DB_USERS+'/'+userB+'/duoTeam').once('value');
    var bArr=bTeam.val()||[];
    var bIdx=bArr.indexOf(userA);
    if(bIdx>=0){
      bArr.splice(bIdx,1);
      await rtdb.ref(DB_USERS+'/'+userB+'/duoTeam').set(bArr);
    }
    
    console.log('✅ Partner removed: '+userA+' ✕ '+userB);
    return true;
  }catch(e){
    console.error('removeUserPartner error:',e);
    return false;
  }
}

/* =============================================
   SUPPORT CHAT — uses senderId:'admin' (not sender:'admin')
   Reads from supportChats/{uid}/ OR support/{uid}/ (checks both paths)
   Admin checks BOTH senderId and sender for backward compat
   ============================================= */
var allChatUsers={};
function isAdminMsg(mv){return mv.senderId==='admin'||mv.sender==='admin';}

/* Try to detect which chat path is being used */
var CHAT_PATH_PRIMARY='support';        /* Primary path — synced with User Panel */
var CHAT_PATH_SECONDARY='chats';        /* Secondary/fallback path */

/* loadSupportChats — Listens to supportChats/{userId} AND support/{userId} paths
   Each user has their own chat node: supportChats/uid123/messageId OR support/uid123/messageId
   Messages have senderId:'admin' or senderId:userId
   
   This function checks BOTH paths for compatibility with different User Panel versions
*/
var _supportScanTimer = null;
/* FIX (2026-09-20): Inbox hamesha khaali tha — root reads (support/, supportChats/)
   RTDB rules mein PERMISSION_DENIED hain, par per-user read support/{uid} ALLOWED hai.
   Ab: Supabase users se uid-list → har uid ka support/{uid} node padho (15-parallel
   batches) → list render. Har 20s me auto-refresh. Rules badle bina bhi chalta hai. */
async function _scanSupportInboxes(){
  try{
    var supa = window._supa; if(!supa) return;
    var res = await supa.from('users').select('id,ign').order('created_at',{ascending:false}).limit(300);
    if(res.error){ console.warn('[SupportScan] users fetch fail:', res.error.message); return; }
    var ulist = res.data || [];
    var found = {};
    for(var i=0;i<ulist.length;i+=15){
      var batch = ulist.slice(i,i+15);
      await Promise.all(batch.map(async function(u){
        try{
          var s = await rtdb.ref('support/'+u.id).once('value');
          if(!s.exists()) return;
          var info = s.child('info').val() || {};
          var msgs = s.child('messages');
          var last='', lastT=0, unread=0;
          if(msgs.exists()){
            msgs.forEach(function(ms){
              var m = ms.val() || {};
              if(typeof m !== 'object' || (!m.text && !m.message)) return;
              last = m.message || m.text || '';
              var mt = m.createdAt || m.timestamp || 0;
              if(mt > lastT) lastT = mt;
              if(!isAdminMsg(m) && !m.read) unread++;
            });
          }
          if(!last && info.lastMessage){ last = info.lastMessage; lastT = info.lastMessageTime || 0; }
          if(!last) return;
          found[u.id] = { userName: info.userIGN || info.userName || u.ign || 'User', lastMsg: last, unread: unread, lastTime: lastT, chatPath: 'support' };
        }catch(e){}
      }));
    }
    allChatUsers = found;
    /* render chat list (same markup as before) */
    var ls = document.getElementById('chatUserList'); if(!ls) return;
    var users = Object.keys(found).map(function(uid){ return Object.assign({uid:uid}, found[uid]); });
    if(!users.length){
      ls.innerHTML = '<div class="chat-empty" style="padding:30px 0"><i class="fas fa-comments"></i><span class="text-xs">No conversations</span></div>';
      return;
    }
    users.sort(function(a,b){ return b.lastTime - a.lastTime; });
    var h='';
    users.forEach(function(u){
      var ini=(u.userName||u.uid).charAt(0).toUpperCase(), ts=u.lastTime?formatChatTime(u.lastTime):'';
      h += '<div class="chat-user-item '+(activeChatUid===u.uid?'active':'')+'" onclick="openChat(\''+u.uid+'\')"><div class="chat-avatar">'+ini+'</div><div class="chat-user-info"><div class="chat-user-name"><span>'+(u.userName||u.uid.substring(0,12))+'</span><span class="chat-time">'+ts+'</span></div><div class="chat-user-preview">'+u.lastMsg+'</div></div>'+(u.unread>0?'<div class="chat-unread-dot">'+u.unread+'</div>':'')+'</div>';
    });
    ls.innerHTML = h;
  }catch(e){ console.warn('[SupportScan] error:', e && e.message); }
}
function loadSupportChats(){
  console.log('[SupportScan] per-uid inbox scanner active (support/{uid} reads — rules-safe)');
  _scanSupportInboxes();
  if(_supportScanTimer) clearInterval(_supportScanTimer);
  _supportScanTimer = setInterval(_scanSupportInboxes, 20000);
}
function formatChatTime(ts){var d=new Date(ts),n=new Date();if(d.toDateString()===n.toDateString())return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toLocaleDateString([],{month:'short',day:'numeric'});}
function filterChatUsers(q){q=q.toLowerCase();document.querySelectorAll('.chat-user-item').forEach(function(el){var nm=el.querySelector('.chat-user-name span');var t=nm?nm.textContent.toLowerCase():'';el.style.display=t.indexOf(q)>=0?'':'none';});}

function openChat(uid){
  activeChatUid=uid;
  var cd=allChatUsers[uid]||{};
  var un=cd.userName||getUserName(uid);
  /* Determine which chat path this user's messages are stored in */
  var userChatPath=cd.chatPath||CHAT_PATH_PRIMARY;
  console.log('Opening chat for '+uid+' using path: '+userChatPath+'/');
  
  var ma=document.getElementById('chatMainArea');
  ma.innerHTML='<div class="chat-main-header"><div class="chat-avatar" style="width:30px;height:30px;font-size:12px">'+(un||uid).charAt(0).toUpperCase()+'</div><div class="chat-header-info"><div class="chat-header-name">'+un+'</div><div class="chat-header-uid">'+uid+'</div></div><button class="btn btn-ghost btn-xs" onclick="openUserModal(\''+uid+'\')"><i class="fas fa-user"></i> Profile</button></div><div class="chat-messages" id="chatMessages"></div><div class="chat-input-bar"><input type="text" id="chatInput" class="form-input" placeholder="Type reply..." style="padding:8px 12px" onkeydown="if(event.key===\'Enter\')sendAdminReply()"><button class="btn btn-primary" onclick="sendAdminReply()" style="padding:8px 14px"><i class="fas fa-paper-plane"></i></button></div>';
  document.querySelectorAll('.chat-user-item').forEach(function(el){el.classList.remove('active')});
  
  /* Mark unread as read — check both paths */
  function markAsRead(path){
    rtdb.ref(path+'/'+uid).once('value').then(function(s){
      s.forEach(function(m){
        if(!isAdminMsg(m.val())&&!m.val().read){
          rtdb.ref(path+'/'+uid+'/'+m.key).update({read:true});
        }
      });
    });
  }
  markAsRead(CHAT_PATH_PRIMARY);
  /* FIX: CHAT_PATH_SECONDARY (supportChats) reads denied + flat structure — skip to avoid console noise */
  
  /* FIX Bug#9: Properly detach previous Firebase listener.
     ORIGINAL BUG: chatListener was set to the return value of ref.on()
     which is the callback function itself. Calling chatListener() just
     re-invokes the callback — it does NOT unsubscribe. Listeners accumulate.
     FIX: chatListener is now always set to a proper cleanup closure. */
  if(typeof chatListener === 'function') chatListener();
  
  /* FIX (2026-09-20): supportChats/{uid} reads PERMISSION_DENIED hain — pehle Promise.all
   dono paths par tha, ek denied read pura render abort kar deti thi → thread hamesha khaali.
   Ab sirf support/{uid}/messages (wahi path jahan user panel likhta hai), proper error
   handling + correct sort key (createdAt||timestamp). */
  function renderMessages(){
    var me=document.getElementById('chatMessages');if(!me)return;
    function fetchAndRender(){
      rtdb.ref('support/'+uid+'/messages').orderByChild('createdAt').limitToLast(200).once('value')
        .then(function(snap){
          var allMessages=[];
          if(snap.exists()) snap.forEach(function(ms){ allMessages.push({key:ms.key,...ms.val()}); });
          if(allMessages.length===0){
            me.innerHTML='<div class="chat-empty"><i class="fas fa-comment-dots"></i><span class="text-xs">No messages</span></div>';
            return;
          }
          allMessages.sort(function(a,b){ return (a.createdAt||a.timestamp||0)-(b.createdAt||b.timestamp||0); });
          me.innerHTML='';
          var ld='';
          allMessages.forEach(function(m){
            var ia=isAdminMsg(m),ts=(m.createdAt||m.timestamp)?new Date(m.createdAt||m.timestamp):null,ds=ts?ts.toLocaleDateString():'';
            if(ds&&ds!==ld){ld=ds;me.innerHTML+='<div style="text-align:center;padding:6px;font-size:9px;color:var(--text-muted)">'+eh(ds)+'</div>';}
            var tm=ts?ts.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
            var msgText=eh(m.message||m.text||''); /* SECURITY: escape user-typed message */
            me.innerHTML+='<div class="chat-bubble '+(ia?'admin':'user')+'">'+msgText+'<div class="time">'+eh(tm)+(ia?' <i class="fas fa-check-double" style="color:var(--primary)"></i>':'')+'</div></div>';
          });
          me.scrollTop=me.scrollHeight;
        })
        .catch(function(e){
          console.warn('[openChat] messages read fail:', e && (e.code||e.message));
          me.innerHTML='<div class="chat-empty"><i class="fas fa-exclamation-triangle"></i><span class="text-xs">Chat load nahi hua — dobara koshish karo</span></div>';
        });
    }
    fetchAndRender();
  }
  
  /* FIX Bug#9: Store both ref and callback so we can properly detach.
     ref.on() returns the callback in Firebase SDK v8.
     We CANNOT unsubscribe by calling callback() — must call ref.off(eventType, callback).
     Solution: replace chatListener with a proper cleanup closure. */
  var _chatRef=rtdb.ref('support/'+uid+'/messages');
  var _chatCb=function(){ renderMessages(); };
  _chatRef.on('value',_chatCb);
  /* chatListener is now a proper cleanup function, not the raw callback */
  chatListener=function(){
    _chatRef.off('value',_chatCb);
    console.log('[Bug#9 Fix] Chat listener properly detached for uid:',uid);
  };
}

/* sendAdminReply — saves with senderId:'admin'
   Saves to the same path where the user's chat exists
*/
async function sendAdminReply(){
  if(!activeChatUid)return showToast('Select user',true);
  var inp=document.getElementById('chatInput'),msg=inp.value.trim();if(!msg)return;
  
  /* Determine which path to use for this user */
  var cd=allChatUsers[activeChatUid]||{};
  var chatPath=cd.chatPath||CHAT_PATH_PRIMARY;
  
  console.log('Sending reply to '+chatPath+'/'+activeChatUid);
  
  try{
    /* FIX: Save to support/{uid}/messages — EXACTLY where user reads from */
    var msgData = {
      message: msg,
      text: msg,
      senderId: 'admin',
      senderRole: 'admin',
      sender: 'admin',
      timestamp: Date.now(),
      createdAt: Date.now(),
      read: true,
      adminUid: _adminUid()
    };
    /* Primary: support/{uid}/messages — user reads this path */
    await rtdb.ref('support/'+activeChatUid+'/messages').push(msgData);
    /* Update support/{uid}/info for admin list */
    await rtdb.ref('support/'+activeChatUid+'/info').update({
      lastMessage: msg,
      lastMessageTime: Date.now(),
      lastReplyByAdmin: Date.now(),
      unreadByAdmin: false
    });
    
    /* Send notification to user */
    await rtdb.ref(DB_USERS+'/'+activeChatUid+'/notifications').push({
      title:'💬 Support Reply',
      message:msg,
      timestamp:Date.now(),
      read:false,
      type:'support_reply'
    });
    
    inp.value='';
    console.log('Chat reply sent to '+chatPath+'/'+activeChatUid+' with senderId:admin');
  }catch(e){
    console.error('sendAdminReply error:',e);
    showToast('Error: '+e.message,true);
  }
}

/* =============================================
   SUPPORT TICKETS — Reads from supportRequests/
   ============================================= */
/* ✅ REDESIGN (2026-08-21): Support Tickets UI was a flat list of
   isolated cards — one card per ticket, even when the same user sent
   multiple messages, so a back-and-forth with one user looked like a
   pile of disconnected boxes instead of a conversation. schema-wise each
   row is still one message + one reply (support_tickets has no
   multi-message thread table), so this groups rows by user_id client-side
   and renders them as WhatsApp-style chat bubbles — user message on the
   left, admin reply on the right — inside a single scrollable thread per
   user. Reply also now uses an inline textarea instead of a native
   prompt() popup. */
/* ✅ REBUILD (2026-08-22): WhatsApp-style support chat.
   Old version rendered every user's ENTIRE thread inline, all stacked
   on top of each other on the same screen — unreadable with more than
   a couple of tickets. This is now a proper 2-screen flow:
     1) List screen — one row per user (name + last message preview),
        exactly like a WhatsApp chat list.
     2) Detail screen — tapping a row opens ONLY that user's full
        thread with a working back button that returns to the list
        without losing the current filter.
   Both screens live in the same #supportTicketsList container and
   swap via innerHTML, so no extra HTML scaffolding was needed. */
var _supportTicketsCache = []; // last loaded+grouped ticket set, so opening a thread doesn't re-fetch
var _supportTicketsFilter = 'open';

async function loadSupportTickets(filter){
  filter = filter || _supportTicketsFilter || 'open';
  _supportTicketsFilter = filter;
  var el=document.getElementById('supportTicketsList');
  if(!el)return;
  el.innerHTML='<p class="text-muted text-xs text-center" style="padding:12px"><i class="fas fa-spinner fa-spin"></i> Loading...</p>';
  try{
    var snap=await rtdb.ref('supportRequests').orderByChild('createdAt').once('value');
    var tickets=[];
    snap.forEach(function(c){var t=c.val();t._key=c.key;tickets.push(t);});
    tickets.sort(function(a,b){return(a.createdAt||0)-(b.createdAt||0);}); /* oldest→newest within a thread */

    var openCount=0;
    snap.forEach(function(c){if((c.val().status||'open')==='open')openCount++;});
    var badge=document.getElementById('ticketBadge');
    if(badge)badge.textContent=openCount||'';

    var visible=filter==='all'?tickets:tickets.filter(function(t){return(t.status||'open')===filter;});

    /* Group by user — same person's messages become one thread */
    var byUser={};
    var order=[];
    visible.forEach(function(t){
      var uid=t.userId||'unknown';
      if(!byUser[uid]){byUser[uid]=[];order.push(uid);}
      byUser[uid].push(t);
    });
    /* Most-recently-active thread first, like a real chat list */
    order.sort(function(a,b){
      var la=byUser[a][byUser[a].length-1], lb=byUser[b][byUser[b].length-1];
      return (lb.createdAt||0)-(la.createdAt||0);
    });

    _supportTicketsCache = order.map(function(uid){ return { uid: uid, msgs: byUser[uid] }; });

    if(order.length===0){el.innerHTML='<p class="text-muted text-xs text-center" style="padding:12px">No tickets found.</p>';return;}

    _renderSupportTicketsList();
  }catch(e){el.innerHTML='<p class="text-danger text-xs text-center" style="padding:12px">Error: '+e.message+'</p>';}
}

function _renderSupportTicketsList(){
  var el=document.getElementById('supportTicketsList');
  if(!el)return;
  var html='<div style="display:flex;flex-direction:column">';
  _supportTicketsCache.forEach(function(thread,idx){
    var msgs=thread.msgs;
    var last=msgs[msgs.length-1];
    var hasOpen=msgs.some(function(t){return(t.status||'open')!=='closed';});
    var userLabel=last.userName||last.userId||'User';
    var preview=(last.adminReply||last.message||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if(preview.length>50)preview=preview.substring(0,50)+'…';
    var dt=last.createdAt?new Date(last.createdAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';

    /* Single tappable row — WhatsApp chat-list style */
    html+='<div onclick="_openSupportThread('+idx+')" style="display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer" onmouseover="this.style.background=\'rgba(255,255,255,.03)\'" onmouseout="this.style.background=\'\'">';
    html+='<div style="width:38px;height:38px;border-radius:50%;background:rgba(0,255,156,.12);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--success);flex-shrink:0">'+userLabel.charAt(0).toUpperCase()+'</div>';
    html+='<div style="flex:1;min-width:0">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">';
    html+='<span style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+userLabel+'</span>';
    html+='<span style="font-size:10px;color:var(--text-muted);flex-shrink:0">'+dt+'</span>';
    html+='</div>';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:2px">';
    html+='<span style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+preview+'</span>';
    html+='<span class="badge '+(hasOpen?'red':'green')+'" style="flex-shrink:0">'+(hasOpen?'open':'closed')+'</span>';
    html+='</div></div></div>';
  });
  html+='</div>';
  el.innerHTML=html;
}

function _openSupportThread(idx){
  var thread=_supportTicketsCache[idx];
  if(!thread)return;
  var el=document.getElementById('supportTicketsList');
  if(!el)return;
  var msgs=thread.msgs;
  var last=msgs[msgs.length-1];
  var hasOpen=msgs.some(function(t){return(t.status||'open')!=='closed';});
  var userLabel=last.userName||last.userId||'User';

  var html='<div style="display:flex;flex-direction:column">';

  /* Header with a REAL back button that returns to the list */
  html+='<div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:8px">';
  html+='<button onclick="_renderSupportTicketsList()" style="background:none;border:none;color:var(--txt,#fff);font-size:16px;cursor:pointer;padding:4px 8px"><i class="fas fa-arrow-left"></i></button>';
  html+='<div style="flex:1"><div style="font-size:13px;font-weight:800">'+userLabel+'</div><div class="text-xxs font-mono text-muted">'+(last.userId||'').substring(0,14)+'</div></div>';
  html+='<span class="badge '+(hasOpen?'red':'green')+'">'+(hasOpen?'open':'closed')+'</span>';
  html+='</div>';

  /* Full thread — newest at the bottom like a real chat */
  html+='<div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;padding:4px">';
  msgs.forEach(function(t){
    var safeMsg=(t.message||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    var dt=t.createdAt?new Date(t.createdAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
    html+='<div style="align-self:flex-start;max-width:80%;background:rgba(255,255,255,.06);border-radius:12px 12px 12px 2px;padding:8px 11px">';
    html+='<div style="font-size:12px;color:#eee;white-space:pre-wrap;word-break:break-word">'+safeMsg+'</div>';
    html+='<div style="font-size:9px;color:var(--text-muted);margin-top:3px;text-align:right">'+dt+'</div>';
    html+='</div>';
    if(t.adminReply){
      var safeReply=(t.adminReply||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var rdt=t.repliedAt?new Date(t.repliedAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
      html+='<div style="align-self:flex-end;max-width:80%;background:rgba(0,255,156,.14);border-radius:12px 12px 2px 12px;padding:8px 11px">';
      html+='<div style="font-size:12px;color:#eafff2;white-space:pre-wrap;word-break:break-word">'+safeReply+'</div>';
      html+='<div style="font-size:9px;color:var(--text-muted);margin-top:3px;text-align:right">'+rdt+' • Admin</div>';
      html+='</div>';
    }
  });
  html+='</div>';

  /* Reply composer */
  html+='<div style="padding:10px 4px 4px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:6px;align-items:flex-end">';
  html+='<textarea id="ticketReplyBox_'+last._key+'" placeholder="Reply likho..." style="flex:1;min-height:36px;max-height:90px;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:12px;resize:vertical"></textarea>';
  html+='<button class="btn btn-primary btn-xs" onclick="replyTicket(null,\''+last._key+'\',\''+(last.userId||'')+'\','+idx+')"><i class="fas fa-paper-plane"></i></button>';
  html+=hasOpen?'<button class="btn btn-ghost btn-xs" onclick="closeTicket({dataset:{key:\''+last._key+'\'}},false,'+idx+')" style="color:var(--success)"><i class="fas fa-check"></i></button>'
                :'<button class="btn btn-ghost btn-xs" onclick="closeTicket({dataset:{key:\''+last._key+'\'}},true,'+idx+')" style="color:var(--text-muted)"><i class="fas fa-redo"></i></button>';
  html+='</div>';

  html+='</div>';
  el.innerHTML=html;
}


async function replyTicket(btnEl,ticketId,userId,threadIdx){
  var key=ticketId||(btnEl&&btnEl.dataset?btnEl.dataset.key:'');
  var uid=userId||(btnEl&&btnEl.dataset?btnEl.dataset.user:'');
  if(!key)return;
  var box=document.getElementById('ticketReplyBox_'+key);
  var msg=box?box.value:'';
  if(!msg||!msg.trim()){showToast('Reply likho pehle!',true);return;}
  try{
    await rtdb.ref('supportRequests/'+key).update({adminReply:msg.trim(),status:'replied',repliedAt:Date.now()});
    if(uid)await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'Support Reply',message:msg.trim(),timestamp:Date.now(),read:false});
    await rtdb.ref('activityLogs').push({type:'ticket_replied',ticketId:key,admin:_adminUid(),timestamp:Date.now()});
    showToast('Reply sent!');
    /* Reload data but stay inside the SAME thread rather than kicking
       the admin back to the list after every reply. */
    await loadSupportTickets(_supportTicketsFilter);
    if(typeof threadIdx==='number'){
      /* Re-find this user's thread by uid in case ordering shifted */
      var newIdx=_supportTicketsCache.findIndex(function(t){return t.uid===uid;});
      _openSupportThread(newIdx>=0?newIdx:threadIdx);
    }
  }catch(e){showToast('Error: '+e.message,true);}
}


async function closeTicket(btnEl,reopen,threadIdx){
  var key=btnEl&&btnEl.dataset?btnEl.dataset.key:'';
  if(!key)return;
  var newStatus=reopen?'open':'closed';
  try{
    await rtdb.ref('supportRequests/'+key).update({status:newStatus,closedAt:Date.now()});
    showToast(reopen?'Ticket reopened!':'Ticket closed!');
    /* Closing/reopening a ticket can move it out of the current filter
       (e.g. "open" filter + close button pressed), so after reload we
       fall back to the list view rather than trying to reopen a thread
       that may no longer be in the visible set. */
    await loadSupportTickets(_supportTicketsFilter);
    _renderSupportTicketsList();
  }catch(e){showToast('Error: '+e.message,true);}
}


async function sendGlobalNotification(){
  var t=document.getElementById('globalNotifTitle').value.trim(),m=document.getElementById('globalNotifMsg').value.trim();
  if(!t||!m)return showToast('Title & message required',true);
  var btn=document.getElementById('sendGlobalBtn');
  setLoading(btn,true);
  try{
    /* ✅ FIX (2026-08-21): this used to ALSO loop over every single user
       and .push() an individual notification row per user directly to
       Firebase/bridge (line removed below) — but notifications.target_all
       already exists specifically so ONE row serves every user (read via
       "user_id IS NULL OR user_id = me" on the client), and that write
       requires the admin-checked RPC now anyway (BUG #26-followup). The
       per-user loop was redundant duplicate work at best, and at worst
       could itself throw/hang for large user counts with nothing to show
       for it. Now sends exactly once via the RPC and reports the REAL
       result instead of an unconditional "Sent to N users" toast that
       fired even when the RPC silently failed. */
    if(!window._adminNotifyAll){setLoading(btn,false);return showToast('Notification system not ready',true);}
    var result=await window._adminNotifyAll(t,m,'global_broadcast');
    setLoading(btn,false);
    if(result && result.success===false){
      showToast('❌ Broadcast failed: '+(result.error||'unknown error'),true);
      return;
    }
    document.getElementById('globalNotifTitle').value='';document.getElementById('globalNotifMsg').value='';
    showToast('✅ Broadcast sent to all users');
  }catch(e){setLoading(btn,false);showToast('Error: '+e.message,true);}
}

/* Custom Notification to Specific User */
async function lookupCustomNotifUser(){
  var uid=document.getElementById('customNotifUid').value.trim();
  if(!uid)return showToast('Enter UID',true);
  try{
    var s=await rtdb.ref(DB_USERS+'/'+uid).once('value');
    if(!s.exists())return showToast('User not found!',true);
    var u=s.val();
    document.getElementById('customNotifUserName').textContent=u.ign||'Unknown';
    document.getElementById('customNotifUserStatus').textContent=u.isBanned?'Banned':'Active';
    document.getElementById('customNotifUserStatus').className='badge '+(u.isBanned?'red':'green');
    document.getElementById('customNotifUserInfo').style.display='block';
    showToast('User found: '+(u.ign||'Unknown'));
  }catch(e){showToast('Error: '+e.message,true);}
}

async function sendCustomNotification(){
  var uid=document.getElementById('customNotifUid').value.trim();
  var title=document.getElementById('customNotifTitle').value.trim();
  var msg=document.getElementById('customNotifMsg').value.trim();
  if(!uid)return showToast('Enter User UID',true);
  if(!title)return showToast('Enter Title',true);
  if(!msg)return showToast('Enter Message',true);
  var btn=document.getElementById('sendCustomNotifBtn');
  setLoading(btn,true);
  try{
    var us=await rtdb.ref(DB_USERS+'/'+uid).once('value');
    if(!us.exists()){setLoading(btn,false);return showToast('User not found!',true);}
    await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({
      title:title,
      message:msg,
      timestamp:Date.now(),
      read:false,
      type:'custom_admin',
      sentBy:_adminUid()
    });
    /* Also log to global notifications */
    await rtdb.ref('notifications').push({
      uid:uid,
      userName:us.val().ign||'Unknown',
      title:'Custom: '+title,
      message:msg,
      type:'custom_admin',
      createdAt:Date.now(),
      adminUid:_adminUid()
    });
    /* FIX Bug#3 / BUG #26-followup (2026-07): route through _adminNotifyUser
       (RPC-backed, admin-checked) instead of a direct insert. */
    if(window._adminNotifyUser){
      window._adminNotifyUser(uid,{type:'custom_admin',title:title,message:msg});
    }
    document.getElementById('customNotifTitle').value='';
    document.getElementById('customNotifMsg').value='';
    setLoading(btn,false);
    showToast('✅ Notification sent to '+(us.val().ign||uid));
  }catch(e){setLoading(btn,false);showToast('Error: '+e.message,true);}
}
async function sendMatchNotification(){
  var mid=document.getElementById('notifTournamentSelect').value,t=document.getElementById('matchNotifTitle').value.trim(),m=document.getElementById('matchNotifMsg').value.trim();
  if(!mid||!t||!m)return showToast('All fields required',true);
  var btn=document.getElementById('sendMatchBtn');
  setLoading(btn,true);
  try{
    var s=await rtdb.ref(DB_JOIN).once('value');var p=[];var c=0;
    s.forEach(function(x){var j=x.val(),tid=j.tournamentId||j.matchId;if(tid===mid&&j.status==='approved'){var uid=getUid(j);if(uid){c++;p.push(rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:t,message:m,timestamp:Date.now(),read:false,type:'match'}));}}});
    await Promise.all(p);
    /* FIX Bug#3 / BUG #26-followup (2026-07): loop through _adminNotifyUser
       (RPC-backed, admin-checked) instead of one bulk direct insert — the RPC
       only accepts one recipient per call, but match-notification broadcasts
       aren't high-frequency enough for this to matter in practice. */
    if(window._adminNotifyUser&&t&&m&&mid){
      s.forEach(function(x){
        var j=x.val(),tid=j.tournamentId||j.matchId;
        if(tid===mid&&j.status==='approved'){
          var nuid=getUid(j);
          if(nuid) window._adminNotifyUser(nuid,{type:'match_notification',title:t,message:m,matchId:mid});
        }
      });
    }
    document.getElementById('matchNotifTitle').value='';document.getElementById('matchNotifMsg').value='';
    setLoading(btn,false);
    showToast('✅ Sent to '+c+' players');
  }catch(e){setLoading(btn,false);showToast('Error: '+e.message,true);}
}
async function sendScheduledReminders(){try{var s=await rtdb.ref(DB_MATCHES).once('value');s.forEach(function(c){var t=c.val();if(t.status==='upcoming'&&!t.reminderSent&&t.matchTime){var diff=t.matchTime-Date.now();if(diff>0&&diff<=30*60*1000){rtdb.ref(DB_JOIN).once('value').then(function(js){js.forEach(function(jc){var j=jc.val(),tid=j.tournamentId||j.matchId;if(tid===c.key&&j.status==='approved'){var uid=getUid(j);if(uid)rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'⏰ Starting Soon!',message:t.name+' in 30 min!',timestamp:Date.now(),read:false});}});});rtdb.ref(DB_MATCHES+'/'+c.key).update({reminderSent:true});}}});}catch(e){}}

/* =============================================
   SETTINGS
   ============================================= */
async function loadSettings(){try{var arr=await Promise.all([rtdb.ref('appSettings/payment').once('value'),rtdb.ref('appConfig').once('value'),rtdb.ref('appSettings/globalMessage').once('value'),rtdb.ref('appSettings/spectateLink').once('value'),rtdb.ref('appSettings/referralReward').once('value')]);var py=arr[0].val()||{},cf=arr[1].val()||{};var rr=arr[4]?arr[4].val():null;if(document.getElementById('settReferralReward'))document.getElementById('settReferralReward').value=rr||50;if(document.getElementById('settUpiId'))document.getElementById('settUpiId').value=py.upiId||'';if(document.getElementById('settPayeeName'))document.getElementById('settPayeeName').value=py.payeeName||'';if(document.getElementById('settMinWithdraw'))document.getElementById('settMinWithdraw').value=py.minWithdraw||'';if(document.getElementById('settReferralReward'))document.getElementById('settReferralReward').value=cf.referralReward||'';if(document.getElementById('settGlobalMsg'))document.getElementById('settGlobalMsg').value=arr[2].val()||'';if(document.getElementById('settSpectateLink'))document.getElementById('settSpectateLink').value=arr[3].val()||'';}catch(e){console.error(e);}}
/* ✅ MIGRATED (2026-08-18): Maintenance Mode moved from Firebase RTDB
   (appSettings/maintenance) to Supabase app_settings — same pattern
   as preview_mode. Removes the dependency on Firebase Console rules
   deployment, which could never be confirmed/fixed from code (see
   DEVELOPER_GUIDE.md Section 34.11). Uses app_settings' existing RLS:
   anyone can read, only real admins (checked server-side) can write. */

/* ── R29 FIX: shared self-healing app_settings realtime ──
   Pehle preview_mode ka realtime channel tha hi nahi (admin ko toggle
   dekhne ke liye firse section kholna padta tha), aur maintenance ka
   channel har syncFirebaseToken() (login + ~hourly) par ORPHAN ho jaata
   tha — matlab "रिफ्रेश करने पर ही नया state दिखता था". Ab:
   - ek hi channel dono keys (maintenance + preview_mode) sambhalta hai
   - payload row.value ko seedha idempotent _refresh*UI() ko deta hai
   - guard (`_astChannelState==='joined'`) duplicate-channel rokte hain.
   (User-panel 2026-09-17 me hi realtime ho chuka hai; ye admin-side
   counterpart hai.) */
window._refreshMaintUI = function(cfg) {
  var on = !!(cfg && cfg.active === true);
  var tog = document.getElementById('maintToggle');
  if (tog) tog.checked = on;
  var b = document.getElementById('maintBanner');
  if (b) { if (on) b.classList.add('show'); else b.classList.remove('show'); }
};
window._refreshPreviewUI = function(cfg, force) {
  cfg = cfg || {};
  var on = cfg.active === true;
  var tog = document.getElementById('previewToggle');
  if (tog) tog.checked = on;
  var ab = document.getElementById('previewActiveBanner');
  var ob = document.getElementById('previewOffBanner');
  if (ab) ab.style.display = on ? 'block' : 'none';
  if (ob) ob.style.display = on ? 'none' : 'block';
  var msgEl = document.getElementById('previewMessage');
  var dtEl  = document.getElementById('previewLaunchDate');
  if (msgEl && cfg.message && (force || !msgEl.value)) msgEl.value = cfg.message;
  if (dtEl  && cfg.launchDate && (force || !dtEl.value)) dtEl.value = cfg.launchDate;
};
window._ensureAppSettingsRealtime = function() {
  if (!window._supa) return;
  if (window._astChannel && window._astChannelState === 'joined') return;
  try {
    window._astChannel = window._supa.channel('app-settings-live-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, function(payload) {
        var row = payload.new || {};
        var key = row.key;
        if (!key) return;
        if (key === 'maintenance')       window._refreshMaintUI(row.value);
        else if (key === 'preview_mode') window._refreshPreviewUI(row.value);
      })
      .subscribe(function(st) {
        window._astChannelState = st;
        if (st === 'SUBSCRIBED') console.log('[Settings RT] admin app_settings realtime live ✅');
      });
  } catch(e) {
    console.warn('[Settings RT] subscribe error:', e && e.message);
  }
};
/* token-refresh / re-auth par re-bind (orpohan नहीं) */
['supabase:authenticated', 'supabase:ready'].forEach(function(ev) {
  document.addEventListener(ev, function() {
    window._astChannel = null; window._astChannelState = null;
    setTimeout(function() { window._ensureAppSettingsRealtime(); }, 400);
  });
});

function loadMaintenanceState(){
  if(!window._supa) { setTimeout(loadMaintenanceState, 500); return; }
  window._supa.from('app_settings').select('value').eq('key','maintenance').maybeSingle()
    .then(function(res){
      window._refreshMaintUI(res.data && res.data.value);
    });
  /* R29: shared self-healing realtime (maintenance + preview dono) */
  window._ensureAppSettingsRealtime();
}
async function saveSettings(){try{
  var rr=document.getElementById('settReferralReward');
  var upiEl=document.getElementById('settUpiId'),payeeEl=document.getElementById('settPayeeName'),minWEl=document.getElementById('settMinWithdraw');
  var payUpdate={};
  if(upiEl)payUpdate.upiId=upiEl.value.trim();
  if(payeeEl)payUpdate.payeeName=payeeEl.value.trim()||'Mini eSports';
  if(minWEl)payUpdate.minWithdraw=Number(minWEl.value)||50;
  if(Object.keys(payUpdate).length)await rtdb.ref('appSettings/payment').update(payUpdate);
  if(rr) await rtdb.ref('appSettings/referralReward').set(Number(rr.value)||50);
  showToast('Settings saved!');
}catch(e){showToast('Error: '+e.message,true);}}
async function saveGameSettings(){try{var el=document.getElementById('settReferralReward');if(el){await rtdb.ref('appConfig').update({referralReward:Number(el.value)||50});showToast('Saved!');}}catch(e){showToast('Error: '+e.message,true);}}
async function toggleMaintenance(){
  var on=document.getElementById('maintToggle').checked;
  if(!window._supa){ showToast('Supabase not connected', true); return; }
  try{
    var res = await window._supa.from('app_settings')
      .update({ value: { active: on, message: '' }, updated_at: new Date().toISOString() })
      .eq('key','maintenance')
      .select('value')
      .maybeSingle();
    if(res.error){ showToast('Error: '+res.error.message, true); return; }
    /* Read-back verification: confirm the value that came back actually
       matches what we just tried to set, rather than assuming success
       just because no exception was thrown. */
    var confirmed = !!(res.data && res.data.value && res.data.value.active === on);
    if(!confirmed){
      showToast('⚠️ Save hua par confirm nahi ho paya — dobara try karo', true);
      return;
    }
    showToast('Maintenance '+(on?'ON':'OFF'));
  }catch(e){
    showToast('Error: '+e.message,true);
  }
}

/* ════════════════════════════════════════════════
   TDS SYSTEM — Admin Functions
   ════════════════════════════════════════════════ */
function loadTDSState() {
  rtdb.ref('appSettings/tdsConfig').on('value', function(s) {
    var cfg = s.val() || {};
    var on = cfg.active === true;
    var tog = document.getElementById('tdsToggle');
    if (tog) tog.checked = on;
    var banner = document.getElementById('tdsBanner');
    var offBanner = document.getElementById('tdsOffBanner');
    if (banner) banner.style.display = on ? 'block' : 'none';
    if (offBanner) offBanner.style.display = on ? 'none' : 'block';
  });
  /* TDS stats load karo */
  rtdb.ref('tdsHeld').once('value', function(s) {
    var total = 0; var users = {};
    if (s.exists()) s.forEach(function(c) {
      var d = c.val();
      total += Number(d.amount) || 0;
      if (d.uid) users[d.uid] = true;
    });
    var el = document.getElementById('tdsTotalHeld');
    var el2 = document.getElementById('tdsTotalUsers');
    if (el) el.textContent = '₹' + total;
    if (el2) el2.textContent = Object.keys(users).length;
  });
}

async function toggleTDS() {
  var on = document.getElementById('tdsToggle').checked;
  try {
    await rtdb.ref('appSettings/tdsConfig').update({
      active: on,
      updatedAt: Date.now(),
      updatedBy: auth.currentUser ? _adminEmail() : 'admin'
    });
    var banner = document.getElementById('tdsBanner');
    var offBanner = document.getElementById('tdsOffBanner');
    if (banner) banner.style.display = on ? 'block' : 'none';
    if (offBanner) offBanner.style.display = on ? 'none' : 'block';
    /* Activity log */
    await rtdb.ref('activityLogs').push({
      type: 'tds_toggle', action: on ? 'TDS_ENABLED' : 'TDS_DISABLED',
      admin: auth.currentUser ? _adminEmail() : 'admin',
      timestamp: Date.now()
    });
    showToast((on ? '⚠️ TDS ACTIVE — 30% Withdrawal pe katega' : '✅ TDS OFF — Poora amount milega'));
  } catch(e) {
    showToast('Error: ' + e.message, true);
    /* Revert toggle */
    document.getElementById('tdsToggle').checked = !on;
  }
}

function viewTDSRecords() {
  rtdb.ref('tdsRecords').orderByChild('timestamp').limitToLast(50).once('value', function(s) {
    var records = [];
    if (s.exists()) s.forEach(function(c) { records.push(c.val()); });
    records.reverse();

    var h = '<div style="overflow-x:auto">';
    if (records.length === 0) {
      h += '<div style="text-align:center;padding:20px;color:#888">Abhi koi TDS record nahi</div>';
    } else {
      h += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
      h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.1)">';
      ['IGN','WD Amount','TDS Cut','User Gets','Net Win','FY','Date'].forEach(function(col) {
        h += '<th style="padding:6px 8px;text-align:left;color:#888;font-weight:700">' + col + '</th>';
      });
      h += '</tr></thead><tbody>';
      records.forEach(function(r) {
        var dt = new Date(r.timestamp).toLocaleDateString('en-IN');
        h += '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">';
        h += '<td style="padding:7px 8px;font-weight:700">' + (r.ign || r.uid || '-') + '</td>';
        h += '<td style="padding:7px 8px;color:#00ff9c">₹' + (r.withdrawalAmount || 0) + '</td>';
        h += '<td style="padding:7px 8px;color:#ff6b6b">₹' + (r.tdsDeducted || 0) + '</td>';
        h += '<td style="padding:7px 8px;color:#ffd700;font-weight:800">₹' + (r.amountPaid || 0) + '</td>';
        h += '<td style="padding:7px 8px;color:#b964ff">₹' + (r.netWinnings || 0) + '</td>';
        h += '<td style="padding:7px 8px;color:#888">' + (r.financialYear || '-') + '</td>';
        h += '<td style="padding:7px 8px;color:#666">' + dt + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
      /* Summary */
      var totalTDS = records.reduce(function(sum, r) { return sum + (Number(r.tdsDeducted) || 0); }, 0);
      h += '<div style="margin-top:12px;background:rgba(255,170,0,.08);border-radius:10px;padding:10px;font-size:13px">';
      h += '<div style="display:flex;justify-content:space-between"><span style="color:#aaa">Total TDS Collected:</span><span style="color:#ffaa00;font-weight:900">₹' + totalTDS + '</span></div>';
      h += '<div style="font-size:11px;color:#666;margin-top:4px">Yeh amount government ko deposit karna hoga. Form 26AS mein reflect hoga.</div>';
      h += '</div>';
    }
    h += '</div>';
    showModal('💰 TDS Records', h);
  });
}

/* ── loadSettings mein TDS state bhi load karo ── */
var _origLoadSettings = window.loadSettings;
window.loadSettings = async function() {
  if (_origLoadSettings) await _origLoadSettings.apply(this, arguments);
  loadTDSState();
  loadPreviewState();
};

/* ════════════════════════════════════════════════
   PREVIEW MODE — Admin Functions
   ✅ MIGRATED (2026-08): Firebase appSettings/previewMode →
   Supabase app_settings table (key='preview_mode'). Same for
   earlyAccessUsers → early_access_users table.
   ════════════════════════════════════════════════ */
function loadPreviewState() {
  if (!window._supa) { setTimeout(loadPreviewState, 500); return; }
  window._supa.from('app_settings').select('value').eq('key', 'preview_mode').single()
    .then(function(r) {
      /* R29 FIX: UI-refresh idempotent helper se (realtime chalta hua bhi
         wahi helper use karta hai — single source of truth). */
      window._refreshPreviewUI((r.data && r.data.value) || {}, true);
    });
  /* Early user counts */
  window._supa.from('early_access_users').select('joined_at')
    .then(function(r) {
      var rows = r.data || [];
      var total = rows.length, today = 0;
      var todayStart = new Date(); todayStart.setHours(0,0,0,0);
      rows.forEach(function(row) {
        if (row.joined_at && new Date(row.joined_at).getTime() >= todayStart.getTime()) today++;
      });
      var te = document.getElementById('earlyTotalCount');
      var td = document.getElementById('earlyTodayCount');
      if (te) te.textContent = total;
      if (td) td.textContent = today;
    });
  /* R29 FIX: preview_mode ka realtime channel ab shared helper se
     (maintenance wale ke saath ek hi channel). */
  window._ensureAppSettingsRealtime();
}

async function togglePreviewMode() {
  var on = document.getElementById('previewToggle').checked;
  var msg = (document.getElementById('previewMessage')||{}).value || '';
  var dt  = (document.getElementById('previewLaunchDate')||{}).value || '';
  try {
    var r = await window._supa.from('app_settings').upsert({
      key: 'preview_mode',
      value: {
        active: on,
        message: msg || "We're putting the finishing touches on something amazing. Stay tuned!",
        launchDate: dt,
        updatedAt: Date.now(),
        updatedBy: auth.currentUser ? _adminEmail() : 'admin'
      },
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });
    if (r.error) throw new Error(r.error.message);
    var ab = document.getElementById('previewActiveBanner');
    var ob = document.getElementById('previewOffBanner');
    if (ab) ab.style.display = on ? 'block' : 'none';
    if (ob) ob.style.display = on ? 'none' : 'block';
    var r2 = await window._supa.from('admin_activity_log').insert({
      admin_uid: auth.currentUser ? (auth.currentUser.uid || _adminEmail()) : 'admin',
      action_type: on ? 'PREVIEW_ENABLED' : 'PREVIEW_DISABLED',
      note: 'Preview mode toggled by ' + (auth.currentUser ? _adminEmail() : 'admin')
    });
    if (r2.error) console.warn('[togglePreviewMode] activity log:', r2.error.message);
    showToast(on ? '🚀 Preview Mode ON — Users "Coming Soon" dekhenge' : '✅ Preview Mode OFF — App live hai');
  } catch(e) {
    showToast('Error: ' + e.message, true);
    document.getElementById('previewToggle').checked = !on;
  }
}

async function savePreviewSettings() {
  var on  = (document.getElementById('previewToggle')||{}).checked || false;
  var msg = (document.getElementById('previewMessage')||{}).value || '';
  var dt  = (document.getElementById('previewLaunchDate')||{}).value || '';
  try {
    var r = await window._supa.from('app_settings').upsert({
      key: 'preview_mode',
      value: {
        active: on,
        message: msg || "We're putting the finishing touches on something amazing. Stay tuned!",
        launchDate: dt,
        updatedAt: Date.now()
      },
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });
    if (r.error) throw new Error(r.error.message);
    showToast('✅ Preview settings saved!');
  } catch(e) {
    showToast('Error: ' + e.message, true);
  }
}

function viewEarlyUsers() {
  window._supa.from('early_access_users').select('*').order('joined_at', { ascending: false }).limit(100)
    .then(function(r) {
      var users = r.data || [];

      var h = '<div style="margin-bottom:12px;font-size:12px;color:#888">' + users.length + ' early access users registered</div>';
      if (users.length === 0) {
        h += '<div style="text-align:center;padding:20px;color:#555">Abhi koi user nahi</div>';
      } else {
        h += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
        h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.1)">';
        ['Name','Platform','Joined'].forEach(function(c) {
          h += '<th style="padding:6px 8px;text-align:left;color:#888;font-weight:700">' + c + '</th>';
        });
        h += '</tr></thead><tbody>';
        users.forEach(function(u) {
          var dtv = u.joined_at ? new Date(u.joined_at) : new Date();
          var dt = dtv.toLocaleDateString('en-IN');
          var tm = dtv.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'});
          h += '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">';
          h += '<td style="padding:8px;font-weight:700;color:#fff">' + (u.name||'—') + '</td>';
          h += '<td style="padding:8px"><span style="background:rgba(0,212,255,.1);color:#00d4ff;padding:2px 8px;border-radius:10px;font-size:10px">' + (u.platform||'web') + '</span></td>';
          h += '<td style="padding:8px;color:#666">' + dt + ' ' + tm + '</td>';
          h += '</tr>';
        });
        h += '</tbody></table></div>';
      }
      showModal('🚀 Early Access Users', h);
    });
}
/* Saves the Settings-tab "Sticky Banner Text" to all 3 consuming
   destinations: appSettings/banner (dynamic banner box, features-user.js
   loadDynamicBanner), appSettings/ticker (scrolling ticker strip,
   features-user.js updateTicker), and appSettings/globalMessage (used
   only to repopulate this textarea on next Settings page load — see
   loadSettings above). All three are legitimately read elsewhere; this
   is intentional fan-out to one admin field, not a duplicate/dead write. */
async function saveGlobalMessage(){try{var gMsg=document.getElementById('settGlobalMsg').value.trim();await rtdb.ref('appSettings/banner').set(gMsg||null);await rtdb.ref('appSettings/globalMessage').set(gMsg||null);await rtdb.ref('appSettings/ticker').set(gMsg||null);showToast('Saved!');}catch(e){showToast('Error: '+e.message,true);}}
async function clearGlobalMessage(){try{await rtdb.ref('appSettings/banner').set(null);await rtdb.ref('appSettings/globalMessage').set(null);await rtdb.ref('appSettings/ticker').set(null);document.getElementById('settGlobalMsg').value='';showToast('Cleared!');}catch(e){showToast('Error: '+e.message,true);}}
async function saveSpectateLink(){try{await rtdb.ref('appSettings/spectateLink').set(document.getElementById('settSpectateLink').value.trim());showToast('Saved!');}catch(e){showToast('Error: '+e.message,true);}}

/* ─── AD REWARDS SETTINGS ─── */
/* ✅ REMOVED (2026-08-21): saveAdRewards deleted along with the dead
   "Ad Rewards Settings" card — see removal note in index.html. */
/* ✅ REMOVED (2026-08-21): saveAdRewards / loadAdRewards deleted along
   with the dead "Ad Rewards Settings" card — see removal note in
   index.html. Real ad-watch coin settings live in App Settings → Coin
   Earn Settings (fa-app-settings.js, app_settings key='live_config'). */

/* =============================================
   VOUCHERS
   ============================================= */
async function loadVouchers(){try{var s=await rtdb.ref(DB_VOUCHERS).once('value');var t=document.getElementById('vouchersTable');t.innerHTML='';s.forEach(function(c){var v=c.val();t.innerHTML+='<tr><td class="font-bold text-primary">'+v.code+'</td><td>₹'+v.value+'</td><td>'+(v.usedCount||0)+'</td><td>'+v.maxUses+'</td><td><button class="btn btn-danger btn-xs" onclick="deleteVoucher(\''+c.key+'\')"><i class="fas fa-trash"></i></button></td></tr>';});}catch(e){}}
async function createVoucher(){var cd=document.getElementById('voucherCode').value.trim().toUpperCase(),vl=Number(document.getElementById('voucherValue').value)||0,mx=Number(document.getElementById('voucherMaxUses').value)||100;if(!cd||!vl)return showToast('Code & value required',true);try{await rtdb.ref(DB_VOUCHERS).push({code:cd,value:vl,maxUses:mx,usedCount:0,createdAt:Date.now()});document.getElementById('voucherCode').value='';document.getElementById('voucherValue').value='';document.getElementById('voucherMaxUses').value='';showToast('Created!');loadVouchers();}catch(e){showToast('Error: '+e.message,true);}}
async function deleteVoucher(id){if(!confirm('Delete?'))return;try{await rtdb.ref(DB_VOUCHERS+'/'+id).remove();showToast('Deleted');loadVouchers();}catch(e){showToast('Error: '+e.message,true);}}

/* =============================================
   UI NAVIGATION WITH BACK BUTTON SUPPORT
   ============================================= */
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sidebarOverlay').classList.toggle('show');}
var sIcons={bracketAdmin:'fa-sitemap',clanWarAdmin:'fa-shield-alt',cityChampAdmin:'fa-city',mentorAdmin:'fa-graduation-cap',cleanBadgeAdmin:'fa-check-circle',quicktools:'fa-tools',disputes:'fa-exclamation-triangle',dashboard:'fa-chart-line',profileVerification:'fa-user-check',profileUpdates:'fa-user-edit',users:'fa-users',tournaments:'fa-trophy',joinedPlayers:'fa-clipboard-check',matchResult:'fa-trophy',results:'fa-bullseye',wallets:'fa-wallet',teams:'fa-user-friends',support:'fa-comments',notifications:'fa-bell',settings:'fa-cog',roster:'fa-shield-alt',analytics:'fa-chart-bar',lookup:'fa-search',activity:'fa-history'};
var sTitles={bracketAdmin:'Brackets',clanWarAdmin:'Clan Wars',cityChampAdmin:'City Championship',mentorAdmin:'Mentor Management',cleanBadgeAdmin:'Clean Badges',quicktools:'Quick Tools',disputes:'Disputes',dashboard:'Dashboard',sponsoredTournaments:'Sponsored Prizes',appSettings:'App Settings',profileVerification:'New Verifications',profileUpdates:'Profile Updates',users:'Users',tournaments:'Matches',joinedPlayers:'Joined Players',matchResult:'Match Result',results:'Match Results',wallets:'Wallet Requests',teams:'Team Requests',support:'Support Chat',notifications:'Notifications',settings:'Settings',roster:'Live Roster',analytics:'Analytics',lookup:'Player Lookup',activity:'Activity Log'};

/* Track current section for back button */
var currentSection='dashboard';
var navigationHistory=[];

function showSection(sec,el,skipHistory){
  /* Close any open modals first */
  document.querySelectorAll('.modal-overlay.show').forEach(function(m){m.classList.remove('show');});
  
  document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active')});
  /* ✅ FIX (live-testing — confirmed root cause of "Creator Program /
     Growth Analytics do nothing, repeatably, no matter how many times
     clicked"): document.getElementById('section-'+sec) returned null
     whenever the dynamically-injected section div (created by
     fa-growth-admin.js's initGrowthAdmin(), which itself waits on the
     Supabase bridge) genuinely never got created — e.g. if the bridge
     wait gave up after its own timeout, or initGrowthAdmin() threw
     partway through building the section for any reason. Since this
     line crashed with zero guard and no try/catch anywhere in
     showSection(), EVERY subsequent line (nav-item highlighting,
     section-specific data loading, sidebar close) silently never ran —
     for every section, not just the broken one, since showSection()
     itself is one function. This explains it being permanent (not a
     one-time race) and consistent across repeated clicks: the div
     either exists or it doesn't, clicking again doesn't create it. Now
     degrades gracefully with a visible error instead of a silent dead
     end, and still completes the rest of showSection() for whatever
     sections DO exist. */
  var _targetSection = document.getElementById('section-'+sec);
  if (!_targetSection) {
    console.error('[showSection] No element with id="section-'+sec+'" exists in the DOM — this section was never created/injected. Nothing to show.');
    if (window.showToast) window.showToast('⚠️ "'+sec+'" section failed to load (missing panel) — try refreshing the page', true);
    else alert('"'+sec+'" section failed to load (missing panel) — try refreshing the page');
    return;
  }
  _targetSection.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active')});
  if(el)el.classList.add('active');
  else{
    /* Find and activate the correct nav item if el not provided */
    var navItems=document.querySelectorAll('.nav-item');
    navItems.forEach(function(n){
      var onclick=n.getAttribute('onclick')||'';
      if(onclick.indexOf("'"+sec+"'")>=0)n.classList.add('active');
    });
  }
  document.getElementById('topbarTitle').innerHTML='<i class="fas '+(sIcons[sec]||'fa-circle')+'" style="color:var(--primary);margin-right:6px"></i>'+(sTitles[sec]||sec);
  document.getElementById('sidebar').classList.remove('open');document.getElementById('sidebarOverlay').classList.remove('show');
  
  /* ===== BACK BUTTON HISTORY MANAGEMENT ===== */
  /* Only push to history if not triggered by popstate (back button) */
  if(!skipHistory){
    /* Push state to browser history for back button support */
    history.pushState({section:sec},'',window.location.pathname+'#'+sec);
    console.log('History pushed: #'+sec);
  }
  currentSection=sec;
  
  /* Section-specific data loading */
  if(sec==='dashboard'){refreshDashboard();if(window.initAdminDashboard)setTimeout(initAdminDashboard,500);}
  if(sec==='tournaments')loadTournaments();
  if(sec==='joinedPlayers')refreshJoinedPlayers();
  if(sec==='matchResult')loadMatchResultSection();
  if(sec==='results')loadTournaments();
  /* ✅ REMOVED (2026-08-21): 'teams' section switch — Team Requests removed. */
  if(sec==='support'){loadSupportChats();loadSupportTickets('open');}
  /* ✅ REMOVED (2026-08-19): Wallet Requests tab dispatch removed —
     renderWalletRequests() no longer exists. 'wallets' can no longer be
     reached via the sidebar (nav item deleted), but keeping this as a
     safe no-op in case an old bookmark/browser-history URL still
     references it, rather than letting showSection() throw. */
  if(sec==='users')renderUsers();
  if(sec==='settings'){loadSettings();loadVouchers();} if(sec==='skyDiamondRequests'){loadSkyDiamondReqSection();} if(sec==='premiumRequests'){loadPremiumReqSection();} if(sec==='seasonPass'){loadSeasonPassSection();}
  if(sec==='analytics'){if(window.loadAnalytics)loadAnalytics();}
  if(sec==='activity'){if(window.loadActivityLog)loadActivityLog();}
  if(sec==='match-history'){if(window.loadMatchHistorySection)loadMatchHistorySection();}
  if(sec==='quicktools'){} // Quick Tools section
  if(sec==='disputes'){loadDisputes();}
}

/* ===== BACK BUTTON HANDLER ===== */
/* This prevents the app from closing when back button is pressed */
window.onpopstate=function(event){
  console.log('Back button pressed, event.state:',event.state);
  
  /* Close any open modals first */
  var openModals=document.querySelectorAll('.modal-overlay.show');
  if(openModals.length>0){
    openModals.forEach(function(m){m.classList.remove('show');});
    /* Push current state back to prevent further back navigation */
    history.pushState({section:currentSection},'',window.location.pathname+'#'+currentSection);
    console.log('Modal closed, state restored');
    return;
  }
  
  /* Navigate to the section from history state */
  if(event.state&&event.state.section){
    showSection(event.state.section,null,true); /* true = skip pushing to history again */
    console.log('Navigated back to: '+event.state.section);
  }else{
    /* Check URL hash for section */
    var hash=window.location.hash.replace('#','');
    if(hash&&sTitles[hash]){
      showSection(hash,null,true);
    }else{
      /* Default to dashboard if no valid state */
      showSection('dashboard',null,true);
    }
    console.log('Navigated to default/hash section');
  }
};

/* Initialize history state on page load */
function initHistoryState(){
  /* Check URL hash first */
  var hash=window.location.hash.replace('#','');
  if(hash&&sTitles[hash]){
    /* Navigate to hash section without pushing new history */
    showSection(hash,null,true);
    history.replaceState({section:hash},'',window.location.pathname+'#'+hash);
  }else{
    /* Set initial state for dashboard */
    history.replaceState({section:'dashboard'},'',window.location.pathname+'#dashboard');
  }
  console.log('History initialized');
}
function closeModal(id){
  document.getElementById(id).classList.remove('show');
  /* Restore history state after modal close to prevent back button issues */
  history.replaceState({section:currentSection},'',window.location.pathname+'#'+currentSection);
}
document.addEventListener('click',function(e){if(!e.target.closest('.global-search'))document.getElementById('globalSearchResults').classList.remove('show');});

/* ═══ GENERIC MODAL ═══ */
window.showModal = function(title, html) {
  document.getElementById('genericModalTitle').innerHTML = title || '';
  document.getElementById('genericModalBody').innerHTML = html || '';
  document.getElementById('genericModal').classList.add('show');
};
/* ✅ Bug 15 Fix: Unified modal aliases — all feature files use same function */
window.openModal       = window.showModal;
window.openAdminModal  = window.showModal;
window.showAdminModal  = window.showModal;
window.closeGenericModal = function() {
  document.getElementById('genericModal').classList.remove('show');
  document.getElementById('genericModalBody').innerHTML = '';
};
/* features-admin.js calls closeModal() with no args - patch it */
var _origCloseModal = window.closeModal;
window.closeModal = function(id) {
  if (id) {
    if (_origCloseModal) _origCloseModal(id);
    else { var el = document.getElementById(id); if(el) el.classList.remove('show'); }
  } else {
    closeGenericModal();
  }
};

/* ═══ SECTION LOADERS - Load data when section opens ═══ */
var _origShowSection = window.showSection;
window.showSection = function(sec, el, skipHistory) {
  if (_origShowSection) _origShowSection(sec, el, skipHistory);
  /* Trigger section-specific data loads */
  setTimeout(function() {
    if (sec === 'lookup' && document.getElementById('playerSearchInput')) 
      document.getElementById('playerSearchInput').focus();
  }, 100);
};


/* ═══ DISPUTES SECTION ═══ */
