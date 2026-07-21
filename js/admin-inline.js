
/* ── Admin Live Config Loader ── */
window._adminCfg = {};

/* ═══════════════════════════════════════════════════════════════════
   NOTIFICATION BRIDGE — Bug Report Critical #1
   Admin writes to BOTH Firebase (push triggers) AND Supabase
   (user panel reads notifications from Supabase notifications table).
   Use window._adminNotifyUser(uid, payload) everywhere instead of
   rtdb.ref(...)/notifications.push() directly.
═══════════════════════════════════════════════════════════════════ */
window._adminNotifyUser = function(uid, payload) {
  if (!uid) return Promise.resolve();
  var rtdb = window.rtdb || window.db;
  var supa = window._supa;
  var fbPayload = Object.assign({ timestamp: Date.now(), read: false }, payload);
  var promises = [];
  // Firebase — keeps real-time push + OneSignal triggers working
  if (rtdb) {
    promises.push(
      rtdb.ref('users/' + uid + '/notifications').push(fbPayload)
        .catch(function(e){ console.warn('[NotifBridge] Firebase fail:', e.message); })
    );
  }
  // Supabase — user panel reads notifications from here (Bug Critical #1 fix)
  if (supa) {
    promises.push(
      supa.from('notifications').insert({
        user_id:  uid,
        type:     payload.type     || 'admin_alert',
        title:    payload.title    || '',
        body:     payload.message  || payload.body || '',
        ref_id:   payload.matchId  || payload.ref_id || null,
        is_read:  false
      }).catch(function(e){ console.warn('[NotifBridge] Supabase fail:', e.message); })
    );
  }
  return Promise.all(promises);
};

/* ═══════════════════════════════════════════════════════════════════
   GLOBAL NOTIFICATION (all users) — Bug Critical #1 + Medium #12
   Writes to Firebase global path AND Supabase with user_id = 'ALL'
═══════════════════════════════════════════════════════════════════ */
window._adminNotifyAll = function(title, body, type) {
  var rtdb = window.rtdb || window.db;
  var supa = window._supa;
  if (rtdb) {
    rtdb.ref('notifications').push({
      targetUserId: 'all', title: title, body: body, type: type || 'admin_alert',
      timestamp: Date.now()
    });
  }
  // Supabase global row (user panel can filter target_user_id = 'all')
  if (supa) {
    supa.from('notifications').insert({
      user_id: null, target_all: true,
      type: type || 'admin_alert', title: title, body: body, is_read: false
    }).catch(function(e){ console.warn('[NotifBridge] All-notify Supabase fail:', e.message); });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   MATCH RESULT SUPABASE CREDIT — Bug Critical #5
   Called after Firebase result publish to atomically credit prizes,
   record wallet_transactions, and mark match completed in Supabase.
═══════════════════════════════════════════════════════════════════ */
window._supaPublishResult = function(matchId, resultsArr, prizeType) {
  var supa = window._supa;
  if (!supa || !matchId || !resultsArr || !resultsArr.length) return;
  var currency = prizeType === 'greenDiamond' ? 'green_diamonds'
               : prizeType === 'skyDiamond'   ? 'sky_diamonds'
               : 'coins';
  // Mark match as completed in Supabase
  supa.from('matches').update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('firebase_id', matchId)
    .catch(function(e){ console.warn('[SupaResult] match update:', e.message); });
  // Credit each winner + log wallet_transaction
  resultsArr.forEach(function(r) {
    if (!r.uid || !r.prize || r.prize <= 0) return;
    supa.rpc('increment_balance', { p_uid: r.uid, p_col: currency, p_amount: r.prize })
      .catch(function(e){ console.warn('[SupaResult] increment_balance fail', r.uid, e.message); });
    supa.from('wallet_transactions').insert({
      user_id: r.uid, txn_type: 'match_win', currency: currency, amount: r.prize,
      ref_id: matchId, description: 'Match result — Rank #' + r.rank + ' prize'
    }).catch(function(){});
    // Update join_request with prize
    supa.from('join_requests').update({ status: 'completed', placement: r.rank, prize_earned: r.prize })
      .eq('user_id', r.uid).eq('match_id', matchId)
      .catch(function(){});
  });
  // Mark non-winners' join_requests as completed (no prize)
  supa.from('join_requests').update({ status: 'completed', prize_earned: 0 })
    .eq('match_id', matchId).is('prize_earned', null)
    .catch(function(){});
};
(function() {
  function loadAdminCfg() {
    var db = window.rtdb || window.db;
    if (!db) { setTimeout(loadAdminCfg, 1000); return; }
    db.ref('appSettings/liveConfig').on('value', function(snap) {
      if (snap.exists()) window._adminCfg = snap.val() || {};
    });
  }
  setTimeout(loadAdminCfg, 2000);
})();

/* ── Admin Panel Inline Logic ── */
/* =============================================
   FIREBASE CONFIG
   ============================================= */
const firebaseConfig={apiKey:"AIzaSyA-v9AYigDrg96D_fos0vOW3wU2GY2UYec",authDomain:"fft-app-1e283.firebaseapp.com",databaseURL:"https://fft-app-1e283-default-rtdb.firebaseio.com",projectId:"fft-app-1e283",storageBucket:"fft-app-1e283.appspot.com",messagingSenderId:"247829466483",appId:"1:247829466483:web:6961488f1d3c4e3fff4906"};

/* ✅ Wrap in try/catch — firebase SDK loads from CDN; if CDN blocked (e.g. slow network)
   the app must not crash. Supabase handles all primary features. */
var auth, rtdb, _adminApp;
try {
  _adminApp = firebase.initializeApp(firebaseConfig, "adminPanel");
  auth      = _adminApp.auth();
  rtdb      = _adminApp.database();
} catch(e) {
  console.warn('[Admin] Firebase CDN not loaded yet — Supabase-only mode active.', e.message);
  /* Stubs so any firebase-unguarded code doesn't crash */
  rtdb = {
    ref: function() {
      return {
        once:function(){return Promise.resolve({exists:function(){return false;},forEach:function(){},val:function(){return null;}});},
        set:function(){return Promise.resolve();}, update:function(){return Promise.resolve();},
        remove:function(){return Promise.resolve();}, push:function(){return {key:'_offline_'+Date.now()};},
        on:function(){}, off:function(){}, transaction:function(fn){ fn(null); return Promise.resolve(); },
        orderByChild:function(){return this;}, equalTo:function(){return this;},
        limitToLast:function(){return this;}, limitToFirst:function(){return this;},
        startAt:function(){return this;}, endAt:function(){return this;}, startAfter:function(){return this;}
      };
    }
  };
  auth = { currentUser: null, onAuthStateChanged: function(cb){ cb(null); }, onIdTokenChanged: function(){}, signOut: function(){return Promise.resolve();} };
}
/* db = Supabase is used via window._supa; window.db stays undefined until
   v25 patch proxies it. Legacy code that calls db.ref() is intercepted by
   supabase-rtdb-bridge.js which routes everything to Supabase. */
var db = { ref: function(p){ return (window.rtdb && window.rtdb.ref) ? window.rtdb.ref(p) : null; }, _isBridgeShim: true };

/* =============================================
   DATABASE NODE CONSTANTS — SINGLE SOURCE OF TRUTH
   matches/ = where all tournament data lives (synced with User Panel)
   supportChats/{uid}/ = chat messages with senderId field
   ============================================= */
const DB_MATCHES='matches';         // was 'tournaments' — now synced with user panel
const DB_JOIN='joinRequests';
const DB_USERS='users';
const DB_WALLET='walletRequests';
const DB_PROFILE='profileRequests';
const DB_PROFILE_UPDATE='profileUpdates';
const DB_TEAM='teamRequests';
const DB_CHAT='supportChats';
const DB_VOUCHERS='vouchers';

/* =============================================
   GLOBAL VARIABLES
   ============================================= */
let currentFilter='all',pendingRejectData=null,pendingWithdrawData=null,withdrawProofBase64=null,resultScreenshotBase64=null;
let usersSnapshot=null,usersCache={},activeChatUid=null,chatListener=null,currentTournamentData=null;
var allWalletRequests={},allTournaments={},allJoinRequests={};

/* =============================================
   HELPERS
   ============================================= */
function idTag(name,uid){
  const n=name||'Unknown',u=uid||'N/A';
  return '<div class="id-tag"><span class="id-name" title="'+n+'">'+n+'</span><span class="id-sep">|</span><span class="id-uid" title="'+u+'">'+(u.length>20?u.substring(0,20)+'…':u)+'</span></div>';
}
function slotBar(f,m){const p=m>0?Math.min((f/m)*100,100):0;const c=p>=100?'full':p>=75?'warn':'';return '<div class="slot-bar"><div class="slot-track"><div class="slot-fill '+c+'" style="width:'+p+'%"></div></div><span class="slot-text">'+f+'/'+m+'</span></div>';}

function showToast(msg,isErr){
  isErr=isErr||false;
  const c=document.getElementById('toastContainer');if(!c)return;
  const t=document.createElement('div');
  t.className='toast '+(isErr?'error':'success');
  /* FIX Bug#80: Use DOM construction — never innerHTML with user data (XSS) */
  const icon=document.createElement('div');icon.className='toast-icon';
  icon.innerHTML='<i class="fas '+(isErr?'fa-times':'fa-check')+'"></i>';
  const msgEl=document.createElement('div');msgEl.className='toast-msg';
  msgEl.textContent=String(msg||'');  /* textContent prevents XSS */
  const closeBtn=document.createElement('button');closeBtn.className='toast-close';
  closeBtn.innerHTML='<i class="fas fa-times"></i>';
  closeBtn.onclick=function(){this.parentElement&&this.parentElement.remove();};
  t.appendChild(icon);t.appendChild(msgEl);t.appendChild(closeBtn);
  c.appendChild(t);
  requestAnimationFrame(function(){t.classList.add('show')});
  setTimeout(function(){t.classList.remove('show');setTimeout(function(){if(t.parentNode)t.remove();},350)},3200);
  console.log((isErr?'ERR':'OK')+':',String(msg||''));
}

function getUid(obj){return obj.uid||obj.userId||obj.oderId||null;}

/* =============================================
   LOADING STATE FOR BUTTONS
   ============================================= */
function setLoading(btn,loading){
  if(!btn)return;
  if(loading){
    btn.classList.add('loading');
    btn.disabled=true;
    if(!btn.dataset.origHtml)btn.dataset.origHtml=btn.innerHTML;
    btn.innerHTML='<span class="btn-text">'+btn.dataset.origHtml+'</span>';
  }else{
    btn.classList.remove('loading');
    btn.disabled=false;
    if(btn.dataset.origHtml)btn.innerHTML=btn.dataset.origHtml;
  }
}

/* =============================================
   DUPLICATE DUO JOIN CHECK
   Checks if a user or their partner already joined a match
   ============================================= */
async function checkDuplicateDuoJoin(uid,matchId){
  try{
    var partnerSnap=await rtdb.ref(DB_USERS+'/'+uid+'/partnerUid').once('value');
    var partnerUid=partnerSnap.val();
    var joinSnap=await rtdb.ref(DB_JOIN).once('value');
    var found=false;
    joinSnap.forEach(function(c){
      var j=c.val();
      var tid=j.tournamentId||j.matchId;
      var jUid=getUid(j);
      var isJoined=(j.status==='approved'||j.status==='joined'||j.status==='confirmed'||!j.status);
      if(tid===matchId&&isJoined){
        if(jUid===uid){found='self';return;}
        if(partnerUid&&jUid===partnerUid){found='partner';return;}
      }
    });
    return found;
  }catch(e){console.error('checkDuplicateDuoJoin error:',e);return false;}
}

/* =============================================
   REFERRAL FRAUD CHECK
   Ensures referral code can only be used ONCE per user
   ============================================= */
async function checkReferralUsed(uid){
  try{
    var snap=await rtdb.ref(DB_USERS+'/'+uid+'/isReferralUsed').once('value');
    return snap.val()===true;
  }catch(e){return false;}
}
async function markReferralUsed(uid){
  try{await rtdb.ref(DB_USERS+'/'+uid+'/isReferralUsed').set(true);}catch(e){}
}

/* =============================================
   AUTH
   ============================================= */
auth.onAuthStateChanged(async function(u){
  console.log('Auth:',u?u.email:'null');
  if(u){
    try{
      /* ✅ FIX (Audit C1): Pehle Supabase ko kabhi pata nahi chalta tha ki
         konsa Firebase user login hai — _supa hamesha anon key se anonymous
         request bhejta tha, isliye auth.uid() Postgres mein NULL rehta tha
         aur har admin-only RLS policy (matches, join_requests, sd_requests,
         users ban, etc.) "permission denied" deti thi.
         Ab login hote hi sabse pehle Supabase client ko Firebase JWT ke
         saath authenticate karte hain — uske baad hi koi Supabase call jaaye. */
      if(window.syncFirebaseToken){
        await window.syncFirebaseToken(u);
      }

      /* Check admin status: Supabase → RTDB fallback → email whitelist */
      var isAdmin=false;

      /* 1. Supabase admins table (primary — Firestore removed) */
      try{
        var supa=window._supa;
        if(supa){
          var supaAdmin=await supa.from('admins').select('uid').eq('uid',u.uid).maybeSingle();
          if(supaAdmin&&supaAdmin.data)isAdmin=true;
        }
      }catch(supaErr){console.log('Supabase admin check failed:',supaErr.message);}

      /* 2. RTDB 'admins/{uid}' (bridge routes to Supabase admins table) */
      if(!isAdmin){
        try{
          var rtSnap=await rtdb.ref('admins/'+u.uid).once('value');
          if(rtSnap.exists())isAdmin=true;
        }catch(rtErr){console.log('RTDB admin check failed:',rtErr.message);}
      }

      /* 3. Email whitelist as final fallback */
      if(!isAdmin&&(u.email==='admin@fft.com'||u.email==='admin@fftapp.com')){
        isAdmin=true;
        console.log('Admin verified by email whitelist');
      }
      if(isAdmin){
        document.getElementById('loginScreen').style.display='none';
        document.getElementById('loadingScreen').style.display='flex';
        document.getElementById('adminEmail').textContent=u.email;
        /* ✅ BUG FIX (2026-07): outer safety-net — even with the per-loader
           timeouts inside initializeAdminPanel(), race it against a hard
           15s ceiling here too, so the "INITIALIZING" spinner can NEVER
           spin forever no matter what breaks inside. */
        await Promise.race([
          initializeAdminPanel(),
          new Promise(function(resolve){
            setTimeout(function(){
              console.error('[Auth] initializeAdminPanel() exceeded 15s — forcing panel open anyway.');
              resolve();
            }, 15000);
          })
        ]);
        document.getElementById('loadingScreen').style.display='none';
        document.getElementById('mainApp').style.display='block';
        setTimeout(function(){document.getElementById('mainApp').classList.add('show')},50);
      }else{showLoginError('Access denied: Not an admin account.');auth.signOut();}
    }catch(e){showLoginError('Login error: '+e.message);auth.signOut();}
  }else{
    document.getElementById('loginScreen').style.display='flex';
    document.getElementById('loadingScreen').style.display='none';
    document.getElementById('mainApp').style.display='none';
    document.getElementById('mainApp').classList.remove('show');
  }
});

/* ✅ FIX (Audit C1): Firebase ID token ~1hr mein expire hota hai aur SDK use
   automatically refresh karta hai — onIdTokenChanged har refresh pe fire
   hota hai (onAuthStateChanged sirf login/logout pe). Har refresh ke baad
   Supabase client ko bhi naye token ke saath re-sync karna zaroori hai,
   warna 1 ghante baad sab Supabase calls phir se "permission denied" dene
   lagengi kyunki purana token expire ho chuka hoga. */
if (typeof auth.onIdTokenChanged === 'function') {
  auth.onIdTokenChanged(async function (u) {
    if (u && window.syncFirebaseToken) {
      await window.syncFirebaseToken(u);
    }
  });
}
function handleLogin(e){e.preventDefault();const em=document.getElementById('loginEmail').value,pw=document.getElementById('loginPassword').value,btn=document.getElementById('loginBtn');btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Authenticating...';hideLoginError();auth.signInWithEmailAndPassword(em,pw).catch(function(er){showLoginError(er.message);btn.disabled=false;btn.innerHTML='<i class="fas fa-shield-halved"></i> Access Admin Panel';});}
function showLoginError(m){document.getElementById('loginErrorMsg').textContent=m;document.getElementById('loginError').classList.add('show');}
function hideLoginError(){document.getElementById('loginError').classList.remove('show');}
function logoutAdmin(){if(confirm('Logout?'))auth.signOut();}

/* =============================================
   INIT
   ============================================= */
async function initializeAdminPanel(){
  /* ✅ Audit Fix (v32.8.3): wait for the Supabase bridge to actually be
     installed (window.rtdb._isSupaBridge === true) before touching any
     match/wallet/join-request listener. Without this, a fast-resolving
     (cached-session) auth callback could reach this point while
     window.rtdb was still raw Firebase, permanently binding realtime
     listeners to the wrong database for the whole session. Bounded to
     ~4s (40 x 100ms) so a genuinely broken/missing bridge script fails
     loud in the console instead of hanging the panel forever. */
  var _bridgeWait = 0;
  while (!(window.rtdb && window.rtdb._isSupaBridge) && _bridgeWait < 40) {
    await new Promise(function(r){ setTimeout(r, 100); });
    _bridgeWait++;
  }
  if (!(window.rtdb && window.rtdb._isSupaBridge)) {
    console.error('[initializeAdminPanel] Supabase bridge never installed — matches/wallet/join-requests would read raw Firebase. Check js/supabase-rtdb-bridge.js load order and window._supa initialization.');
  }
  console.log('Init — using DB node: '+DB_MATCHES+'/ for matches');
  setupProfileListener();
  setupProfileUpdateListener();
  setupUsersListener();
  setupWalletListener();
  setupJoinRequestsListener();
  setupRealtimeListeners();
  loadMaintenanceState();
  setTimeout(function(){
    if(window.initLiveDashboard)initLiveDashboard();
    if(window.initWithdrawalQueue)initWithdrawalQueue();
  },1000);
  /* ✅ BUG FIX (2026-07): the loading spinner ("INITIALIZING") could spin
     forever. Promise.all() hangs the WHOLE init if even ONE of these
     seven loaders (refreshDashboard/loadTournaments/loadTeamRequests/
     loadSupportChats/loadSupportTickets/loadSettings/loadVouchers) throws
     or never resolves (slow/broken network call, a Supabase read that
     hangs before the auth token finished syncing, etc). Because
     initializeAdminPanel() is awaited BEFORE loadingScreen is hidden
     (see auth.onAuthStateChanged above), one stuck loader = admin stuck
     on the spinner forever with no error shown.
     FIX: run each loader independently with a bounded 8s timeout and
     swallow individual failures — one broken section logs a console
     error but never blocks the rest of the panel (loading screen ALWAYS
     gets hidden). */
  function _withTimeout(promiseFactory, label, ms) {
    return new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function() {
        if (done) return;
        done = true;
        console.error('[initializeAdminPanel] "'+label+'" timed out after '+(ms||8000)+'ms — continuing without it.');
        resolve();
      }, ms || 8000);
      Promise.resolve().then(promiseFactory).then(function() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      }).catch(function(e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        console.error('[initializeAdminPanel] "'+label+'" failed:', e && e.message ? e.message : e);
        resolve();
      });
    });
  }
  await Promise.all([
    _withTimeout(function(){return refreshDashboard();}, 'refreshDashboard'),
    _withTimeout(function(){return loadTournaments();}, 'loadTournaments'),
    _withTimeout(function(){return loadTeamRequests();}, 'loadTeamRequests'),
    _withTimeout(function(){return loadSupportChats();}, 'loadSupportChats'),
    _withTimeout(function(){return loadSupportTickets('open');}, 'loadSupportTickets'),
    _withTimeout(function(){return loadSettings();}, 'loadSettings'),
    _withTimeout(function(){return loadVouchers();}, 'loadVouchers')
  ]);
  setInterval(syncTournamentStatuses,30000);
  setInterval(sendScheduledReminders,300000);
  
  /* Initialize back button history management */
  initHistoryState();
  
  console.log('Ready — all listeners active, history initialized');
}

/* =============================================
   GLOBAL SEARCH
   ============================================= */
/* FIX Bug#42: Debounce global search to prevent query-on-every-keystroke.
   FIX Bug#1: Escape user data before inserting into HTML (XSS prevention). */
var _globalSearchTimer=null;
function handleGlobalSearch(q){
  var res=document.getElementById('globalSearchResults');
  if(!q||q.length<2){if(res)res.classList.remove('show');return;}
  clearTimeout(_globalSearchTimer);
  _globalSearchTimer=setTimeout(function(){
    _execGlobalSearch(q,res);
  },300); /* 300ms debounce */
}
function _execGlobalSearch(q,res){
  if(!usersSnapshot){if(res)res.classList.remove('show');return;}
  var eh=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  q=q.toLowerCase();var html='',c=0;
  usersSnapshot.forEach(function(ch){
    if(c>=8)return;
    var u=ch.val(),uid=ch.key,ign=u.ign||'N/A',ffUid=u.ffUid||'';
    if(ign.toLowerCase().indexOf(q)>=0||uid.toLowerCase().indexOf(q)>=0||ffUid.toLowerCase().indexOf(q)>=0){
      c++;var init=(ign||'U').charAt(0).toUpperCase();var isBanned=u.isBanned||u.blocked;
      /* Bug#1 Fix: use eh() to escape user-supplied IGN and UID before inserting into HTML */
      html += '<div class="search-result-item" ' + 'onmousedown="openUserModal(\x27' + eh(uid) + '\x27);document.getElementById(\x27globalSearchResults\x27).classList.remove(\x27show\x27);document.getElementById(\x27globalSearchInput\x27).value=\x27\x27;">' + '<div class="sr-avatar">' + eh(init) + '</div>' + '<div class="sr-info"><div class="sr-name">' + eh(ign) + (isBanned ? ' <span class="badge red">Banned</span>' : '') + '</div><div class="sr-uid">' + eh(uid.substring(0,18)) + '</div></div></div>';
    }
  });
  if(c===0)html='<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:11px">No users found</div>';
  res.innerHTML=html;res.classList.add('show');
}

/* =============================================
   REALTIME BADGE LISTENERS
   ============================================= */
function setupRealtimeListeners(){
  rtdb.ref(DB_PROFILE).on('value',function(s){var c=0;s.forEach(function(x){if(!x.val().status||x.val().status==='pending')c++;});updateBadge('profileBadge',c);});
  rtdb.ref(DB_WALLET).on('value',function(s){var c=0;s.forEach(function(x){if(x.val().status==='pending')c++;});updateBadge('walletBadge',c);});
  rtdb.ref(DB_TEAM).on('value',function(s){var c=0;s.forEach(function(x){if(x.val().status==='pending')c++;});updateBadge('teamBadge',c);});

  /* CHAT BADGE — uses senderId (not sender) to detect non-admin messages
     Checks BOTH supportChats/ and support/ paths
  */
  function updateChatBadge(){
    var totalUnread=0;
    
    Promise.all([
      rtdb.ref(CHAT_PATH_PRIMARY).once('value'),
      rtdb.ref(CHAT_PATH_SECONDARY).once('value')
    ]).then(function(results){
      results.forEach(function(s){
        if(s.exists()){
          s.forEach(function(u){
            u.forEach(function(m){
              var mv=m.val();
              /* Check BOTH senderId and sender for backward compat */
              var isAdmin=(mv.senderId==='admin'||mv.sender==='admin');
              if(!isAdmin&&!mv.read)totalUnread++;
            });
          });
        }
      });
      
      updateBadge('supportBadge',totalUnread);
      var el=document.getElementById('supportNavItem');
      if(totalUnread>0)el.classList.add('has-unread');else el.classList.remove('has-unread');
    });
  }
  
  /* Listen to both chat paths for badge updates */
  rtdb.ref(CHAT_PATH_PRIMARY).on('value',function(){updateChatBadge();});
  rtdb.ref(CHAT_PATH_SECONDARY).on('value',function(){updateChatBadge();});

  rtdb.ref(DB_PROFILE_UPDATE).on('value',function(s){var c=0;s.forEach(function(x){if(!x.val().status||x.val().status==='pending')c++;});updateBadge('profileUpdateBadge',c);});
  rtdb.ref('disputes').on('value',function(s){var c=0;s.forEach(function(x){if(!x.val().status||x.val().status==='pending')c++;});updateBadge('disputesBadge',c);});
}
function updateBadge(id,c){var e=document.getElementById(id);if(!e)return;if(c>0){e.textContent=c;e.style.display='flex';}else e.style.display='none';}

/* =============================================
   PROFILE VERIFICATION
   ============================================= */
function setupProfileListener(){rtdb.ref(DB_PROFILE).on('value',function(s){renderProfileRequests(s)});}
function renderProfileRequests(snap){
  var tb=document.getElementById('profileRequestsTable');tb.innerHTML='';var c=0;var rows=[];
  snap.forEach(function(ch){
    var d=ch.val(),id=ch.key,p=!d.status||d.status==='pending';
    var isBanned = !!(usersCache[d.uid||d.userId] && (usersCache[d.uid||d.userId].isBanned||usersCache[d.uid||d.userId].blocked));
    if(p)c++;rows.push({id:id,d:d,pending:p,isBanned:isBanned});
  });
  rows.sort(function(a,b){return a.pending===b.pending?0:a.pending?-1:1});
  rows.forEach(function(r){
    var d=r.d,id=r.id,pending=r.pending;
    var uid=getUid(d)||'N/A';
    /* ═══ SOURCE OF TRUTH: profileRequests/ node ═══
       Check ALL possible field names the User Panel might use */
    var proposedIgn=d.requestedIgn||d.ign||d.username||d.newIgn||d.newUsername||d.playerName||d.gameName||'N/A';
    var proposedFfUid=d.requestedUid||d.requestedFfUid||d.ffUid||d.gameUid||d.newFfUid||d.newUid||d.gameId||d.freeFireUid||'N/A';
    var proposedPhone=d.phone||d.newPhone||d.mobileNumber||d.mobile||'';
    var date=d.createdAt?new Date(d.createdAt).toLocaleDateString():'N/A';
    var status=d.status||'pending';
    var sb=status==='approved'?'green':status==='rejected'?'red':'yellow';
    
    /* Smart display name: request data FIRST (new unverified users), then cache */
    var currentUser=usersCache[uid]||{};
    var isBanned = r.isBanned;
    var displayName=d.displayName||d.userName||d.name||d.requestedIgn||currentUser.displayName||currentUser.name||d.ign||d.username||'Unknown';
    if(isBanned) displayName = '🚫 ' + displayName;
    
    /* Debug: Log what we found in the request */
    if(pending)console.log('Profile Request '+id+': uid='+uid+', ign='+proposedIgn+', ffUid='+proposedFfUid+', raw keys='+Object.keys(d).join(','));
    
    var acts=pending?'<button class="btn btn-primary btn-xs" onclick="approveProfile(\''+id+'\')" title="Approve — writes IGN & FF UID to users/{uid}"><i class="fas fa-check"></i> Approve</button> <button class="btn btn-danger btn-xs" onclick="openRejectModal(\'profile\',\''+id+'\')"><i class="fas fa-times"></i> Reject</button>':'<span class="text-xxs text-muted">'+status+'</span>';
    
    /* Bug#1 Fix: escape all user-supplied data before inserting into HTML */
    var _eh=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
    tb.innerHTML+='<tr>'+
      /* Col 1: User Name */
      '<td style="white-space:nowrap"><div style="font-size:13px;font-weight:800">'+_eh(displayName)+'</div><div class="font-mono text-xxs" style="color:var(--info);cursor:pointer;margin-top:2px" onclick="navigator.clipboard&&navigator.clipboard.writeText(\''+_eh(uid)+'\').then(function(){showToast(\'UID copied!\')})">'+_eh(uid.substring(0,14))+'... <i class="fas fa-copy" style="font-size:8px"></i></div><div class="font-mono text-xxs" style="color:var(--primary);margin-top:1px">FF: '+_eh(currentUser.ffUid||d.ffUid||'—')+'</div></td>'+
      /* Col 3: Requested IGN — the IGN user wants */
      '<td><div class="proposed-val"><i class="fas fa-gamepad"></i> '+_eh(proposedIgn)+'</div><div class="text-xxs text-muted mt-1">Will be set as IGN</div></td>'+
      /* Col 4: Requested FF UID — the FF UID user wants */
      '<td><div class="proposed-val"><i class="fas fa-fingerprint"></i> '+_eh(proposedFfUid)+'</div><div class="text-xxs text-muted mt-1">Will be set as FF UID</div></td>'+
      /* Col 5: Phone */
      '<td class="text-xxs font-mono">'+(_eh(proposedPhone)||'<span class="text-muted">—</span>')+'</td>'+
      /* Col 6: Date */
      '<td class="text-xxs">'+date+'</td>'+
      /* Col 7: Status */
      '<td><span class="badge '+sb+'">'+status+'</span></td>'+
      /* Col 8: Actions */
      '<td>'+acts+'</td>'+
    '</tr>';
  });
  document.getElementById('profileCount').textContent=c;
  if(rows.length===0){
    tb.innerHTML='<tr><td colspan="8" class="text-muted text-xs" style="text-align:center;padding:20px"><i class="fas fa-user-check" style="font-size:20px;opacity:0.3;display:block;margin-bottom:6px"></i>No new verification requests</td></tr>';
  }
}

async function approveProfile(rid){
  console.log('═══════════════════════════════');
  console.log('APPROVE PROFILE REQUEST: '+rid);
  /* Disable the button that was clicked to prevent double-clicks */
  if(event&&event.target){var clickedBtn=event.target.closest('.btn');if(clickedBtn){clickedBtn.disabled=true;clickedBtn.style.opacity='0.5';clickedBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';}}
  try{
    /* STEP 1: Read the profile request */
    var rs=await rtdb.ref(DB_PROFILE+'/'+rid).once('value');
    if(!rs.exists()){showToast('Request not found!',true);return;}
    var r=rs.val();
    var uid=getUid(r);
    if(!uid){showToast('UID missing in request! Cannot approve.',true);return;}
    
    /* STEP 2: Read pending profile data (if any) */
    var ps=await rtdb.ref(DB_USERS+'/'+uid+'/pendingProfile').once('value');
    var p=ps.val()||{};
    
    /* STEP 3: Get current user data for comparison */
    var currentSnap=await rtdb.ref(DB_USERS+'/'+uid).once('value');
    var currentUser=currentSnap.val()||{};
    
    /* STEP 4: Determine proposed values — check ALL possible field names
       Source: profileRequests/ node FIRST, then pendingProfile, then current user */
    var proposedIgn=r.requestedIgn||r.ign||r.username||r.newIgn||r.newUsername||r.playerName||r.gameName||p.ign||p.username||p.requestedIgn||'';
    /* Bug#101 Fix: Guard against empty proposedIgn — would set empty string as IGN in user node */
    if(!proposedIgn||!proposedIgn.trim()){
      showToast('❌ No IGN found in this profile request — cannot approve. Reject and ask user to resubmit.',true);
      return;
    }
    proposedIgn=proposedIgn.trim();
    var proposedFfUid=r.requestedUid||r.requestedFfUid||r.ffUid||r.gameUid||r.newFfUid||r.newUid||r.gameId||r.freeFireUid||p.ffUid||p.gameUid||p.requestedFfUid||'';
    var proposedPhone=r.phone||r.newPhone||r.mobileNumber||r.mobile||p.phone||'';
    var proposedAvatar=r.avatar||r.newAvatar||r.profileImage||r.photo||p.avatar||'';
    
    console.log('Request raw data keys: '+Object.keys(r).join(', '));
    
    console.log('Current User Data:');
    console.log('  IGN: '+(currentUser.ign||'NOT SET'));
    console.log('  FF UID: '+(currentUser.ffUid||'NOT SET'));
    console.log('  Phone: '+(currentUser.phone||'NOT SET'));
    console.log('Proposed (from request):');
    console.log('  IGN: '+(proposedIgn||'NOT PROVIDED'));
    console.log('  FF UID: '+(proposedFfUid||'NOT PROVIDED'));
    console.log('  Phone: '+(proposedPhone||'NOT PROVIDED'));
    
    /* ✅ Bug 6 Fix: Block identity change if user already has an approved profile */
    var alreadyVerified = currentUser.profileVerified === true || currentUser.profile_status === 'APPROVED';
    var isUpdateRequest = (r.type === 'update' || r._savePath === 'profileUpdates');
    if (alreadyVerified && !isUpdateRequest) {
      /* This is a NEW verification request for an already-verified user — suspicious */
      showToast('⚠️ User already has a verified profile! Use "Profile Updates" section to change IGN/FF UID.', true);
      /* Redirect to profile updates section */
      if (window.showSection) showSection('profileUpdates');
      return;
    }
    /* If already verified AND it's a proper update request, allow BUT log it prominently */
    if (alreadyVerified && isUpdateRequest) {
      console.warn('[approveProfile] ⚠️ Modifying ALREADY VERIFIED profile for uid:', uid, '— Previous:', currentUser.ign, '/', currentUser.ffUid);
    }

    /* STEP 5: Validate uniqueness — IGN must be unique */
    if(proposedIgn){
      var allUsers=await rtdb.ref(DB_USERS).once('value');
      var ignDup=false;
      allUsers.forEach(function(u){
        if(u.key!==uid&&u.val().ign&&u.val().ign.toLowerCase()===proposedIgn.toLowerCase()){
          ignDup=true;
          console.log('❌ IGN DUPLICATE found: "'+proposedIgn+'" already used by '+u.key);
        }
      });
      if(ignDup){showToast('❌ IGN "'+proposedIgn+'" is already taken by another user!',true);return;}
      console.log('✅ IGN "'+proposedIgn+'" is unique');
    }
    
    /* STEP 6: Validate uniqueness — Phone must be unique */
    if(proposedPhone){
      var allUsers2=await rtdb.ref(DB_USERS).once('value');
      /* FIX Bug#92: Normalize phone before comparison — +91-12345 and 12345 are the same number */
      var _normalizePhone=function(p){return p?String(p).replace(/\D/g,''):''};
      var _normProposedPhone=_normalizePhone(proposedPhone);
      var phoneDup=false;
      allUsers2.forEach(function(u){
        if(u.key!==uid&&u.val().phone&&_normalizePhone(u.val().phone)===_normProposedPhone&&_normProposedPhone.length>=6)phoneDup=true;
      });
      if(phoneDup){showToast('❌ Phone "'+proposedPhone+'" already used by another user!',true);return;}
      console.log('✅ Phone is unique');
    }
    
    /* STEP 7: Validate FF UID — must be unique in ffUIDIndex */
    if(proposedFfUid){
      var fi=await rtdb.ref('ffUIDIndex/'+proposedFfUid).once('value');
      if(fi.exists()&&fi.val()!==uid){
        showToast('❌ FF UID "'+proposedFfUid+'" is already linked to another user!',true);
        return;
      }
      console.log('✅ FF UID is unique or belongs to same user');
    }
    
    /* STEP 8: Build the update object — ONLY include fields that have values */
    var userData={
      approved:true,
      accessMode:'FULL',
      profileVerified:true,
      profileStatus:'verified',
      profile_status:'APPROVED',
      profileUpdatePending:false,
      status:'active',
      pendingProfile:null,
      /* ✅ Bug 12 Fix: Clear all pending fields so user panel shows correct approved data */
      pendingIgn: null,
      pendingUid: null,
      profileRequired: false,
      profileRequestCount: (currentUser.profileRequestCount||0)
    };
    
    /* CRITICAL: Update IGN and FF UID in user node */
    if(proposedIgn){
      userData.ign=proposedIgn;
      console.log('📝 Will set users/'+uid+'/ign = "'+proposedIgn+'"');
    }
    if(proposedFfUid){
      userData.ffUid=proposedFfUid;
      console.log('📝 Will set users/'+uid+'/ffUid = "'+proposedFfUid+'"');
    }
    if(proposedAvatar){
      userData.avatar=proposedAvatar;
      console.log('📝 Will set users/'+uid+'/avatar');
    }
    if(proposedPhone){
      userData.phone=proposedPhone;
      console.log('📝 Will set users/'+uid+'/phone = "'+proposedPhone+'"');
    }
    
    /* STEP 9: WRITE to users/{uid} — Firebase update */
    await rtdb.ref(DB_USERS+'/'+uid).update(userData);
    console.log('✅ User node updated at users/'+uid);

    /* Issue #19 Fix: Sync approved profile data to Supabase users table.
       User panel reads profile from Supabase — without this IGN/FF UID changes
       would not appear for the user until a manual Supabase sync ran. */
    if (window._supa) {
      var supaUpdate = { profile_status: 'approved' };
      if (proposedIgn)    supaUpdate.ign           = proposedIgn;
      if (proposedFfUid)  supaUpdate.ff_uid         = proposedFfUid;
      if (proposedPhone)  supaUpdate.phone          = proposedPhone;
      if (proposedAvatar) supaUpdate.avatar_url     = proposedAvatar;
      await window._supa.from('users').update(supaUpdate).eq('id', uid)
        .catch(function(e){ console.warn('[approveProfile] Supabase sync failed:', e.message); });
      console.log('✅ Supabase users table synced for', uid);
    }
    
    /* STEP 10: Update FF UID index */
    if(proposedFfUid){
      /* Remove old FF UID from index if it changed */
      if(currentUser.ffUid&&currentUser.ffUid!==proposedFfUid){
        await rtdb.ref('ffUIDIndex/'+currentUser.ffUid).remove();
        console.log('🗑️ Removed old ffUIDIndex/'+currentUser.ffUid);
      }
      await rtdb.ref('ffUIDIndex/'+proposedFfUid).set(uid);
      console.log('✅ Updated ffUIDIndex/'+proposedFfUid+' = '+uid);
    }
    
    /* STEP 11: Update the request status (NEVER delete, always update) */
    await rtdb.ref(DB_PROFILE+'/'+rid).update({
      status:'approved',
      processedAt:Date.now(),
      processedBy:auth.currentUser.uid,
      approvedIgn:proposedIgn,
      approvedFfUid:proposedFfUid
    });
    console.log('✅ Request status updated to approved');
    
    /* Bug 14 Fix: Auto-refresh profile requests table after approval so admin
       doesn't see stale pending entries. Call both Firebase listener reset and
       explicit re-render to guarantee fresh data. */
    setTimeout(function() {
      rtdb.ref(DB_PROFILE).once('value', function(freshSnap) {
        renderProfileRequests(freshSnap);
        console.log('[approveProfile] Table refreshed ✅');
      });
    }, 800); // slight delay to let Firebase write settle

    /* STEP 12: Send notification to user — Bug Critical #1 Fix: dual-write to Firebase + Supabase */
    await window._adminNotifyUser(uid, {
      title:'Profile Approved! ✅',
      message:'Your profile has been verified. IGN: '+(proposedIgn||'unchanged')+', FF UID: '+(proposedFfUid||'unchanged'),
      type:'profile_approved'
    });
    
    /* STEP 13a: Supabase sync + clear pending fields */
    if(window._supa && proposedIgn){
      window._supa.from("users").update({ign:proposedIgn,ff_uid:proposedFfUid||null,phone:proposedPhone||null,profile_status:"approved",profile_verified:true,pending_ign:null,pending_uid:null,profile_required:false,updated_at:new Date().toISOString()}).eq("id",uid).catch(function(e){console.warn("[ApproveProfile] Supabase sync:",e.message);});
    }
    /* STEP 13b: Log the action */
    await rtdb.ref('activityLogs').push({
      type:'profile_approved',
      uid:uid,
      requestId:rid,
      proposedIgn:proposedIgn,
      proposedFfUid:proposedFfUid,
      previousIgn:currentUser.ign||null,
      previousFfUid:currentUser.ffUid||null,
      admin:auth.currentUser.uid,
      timestamp:Date.now()
    });
    
    console.log('═══════════════════════════════');
    console.log('✅ PROFILE APPROVED SUCCESSFULLY');
    console.log('  User: '+uid);
    console.log('  IGN: '+(currentUser.ign||'none')+' → '+(proposedIgn||'unchanged'));
    console.log('  FF UID: '+(currentUser.ffUid||'none')+' → '+(proposedFfUid||'unchanged'));
    console.log('═══════════════════════════════');
    
    showToast('✅ Profile approved! IGN: '+(proposedIgn||'N/A')+', FF: '+(proposedFfUid||'N/A'));
  }catch(e){
    console.error('approveProfile error:',e);
    showToast('Error: '+e.message,true);
  }
}

/* =============================================
   PROFILE UPDATES
   ============================================= */
function setupProfileUpdateListener(){rtdb.ref(DB_PROFILE_UPDATE).on('value',function(s){renderProfileUpdates(s)});}
function renderProfileUpdates(snap){
  var tb=document.getElementById('profileUpdateTable');tb.innerHTML='';var c=0;var rows=[];
  snap.forEach(function(ch){var d=ch.val(),id=ch.key,ip=!d.status||d.status==='pending';if(ip)c++;rows.push({id:id,d:d,pending:ip});});
  rows.sort(function(a,b){return a.pending===b.pending?0:a.pending?-1:1});
  rows.forEach(function(r){
    var d=r.d,id=r.id,ip=r.pending;
    var uid=getUid(d)||'N/A';
    /* ═══ SOURCE OF TRUTH: profileUpdateRequests/ node ═══ */
    var newIgn=d.requestedIgn||d.newIgn||d.ign||d.newUsername||d.username||d.playerName||'';
    var newFfUid=d.requestedUid||d.requestedFfUid||d.newFfUid||d.ffUid||d.newUid||d.gameUid||d.gameId||'';
    var date=d.createdAt?new Date(d.createdAt).toLocaleDateString():'N/A';
    var st=d.status||'pending';
    var sb=st==='approved'?'green':st==='rejected'?'red':'yellow';
    
    /* Get current user data from cache for comparison */
    var currentUser=usersCache[uid]||{};
    /* FIX: also check request's own stored current values, and common field names */
    var currentIgn=currentUser.ign||currentUser.username||currentUser.displayName||d.currentIgn||d.oldIgn||'—';
    var currentFfUid=currentUser.ffUid||currentUser.gameUid||currentUser.ffUID||d.currentFfUid||d.oldFfUid||'—';
    var displayName=d.displayName||d.userName||d.name||d.requestedIgn||currentUser.ign||currentUser.displayName||currentUser.name||d.newIgn||d.ign||'Unknown';
    
    /* Debug: Log what we found */
    if(ip)console.log('Profile Update '+id+': uid='+uid+', newIgn='+newIgn+', newFfUid='+newFfUid+', raw keys='+Object.keys(d).join(','));
    
    /* Check what changed */
    var ignChanged=(newIgn&&newIgn!==currentIgn);
    var ffChanged=(newFfUid&&newFfUid!==currentFfUid);
    
    var acts=ip?'<button class="btn btn-primary btn-xs" onclick="approveProfileUpdate(\''+id+'\')" title="Approve — overwrites current IGN/FF UID"><i class="fas fa-check"></i> Approve</button> <button class="btn btn-danger btn-xs" onclick="openRejectModal(\'profileUpdate\',\''+id+'\')"><i class="fas fa-times"></i> Reject</button>':'<span class="text-xxs text-muted">'+st+(d.rejectionReason?'<div title="'+d.rejectionReason+'" style="cursor:pointer;color:#f66;font-size:9px;margin-top:2px"><i class="fas fa-comment-alt"></i> '+d.rejectionReason.substring(0,20)+(d.rejectionReason.length>20?'...':'')+'</div>':'')+'</span>';
    var requestCountBadge = (d.requestCount && d.requestCount > 1) ? '<span style="background:#b964ff22;color:#b964ff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:4px">#'+d.requestCount+' request</span>' : '';
    
    tb.innerHTML+='<tr>'+
      /* Col 1: User Name */
      '<td><strong class="text-sm">'+displayName+'</strong>'+requestCountBadge+'<div class="text-xxs text-muted mt-1"><i class="fas fa-user-shield" style="font-size:8px;color:var(--primary)"></i> Verified User</div></td>'+
      /* Col 2: User UID — FULL, always visible */
      '<td><div class="font-mono text-xxs" style="color:var(--info);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;cursor:pointer" title="Click to copy" onclick="navigator.clipboard&&navigator.clipboard.writeText(\''+uid+'\').then(function(){showToast(\'UID copied!\')})">'+uid+'</div><div class="text-xxs text-muted mt-1"><i class="fas fa-copy" style="font-size:8px;opacity:.5;margin-left:3px"></i></div></td>'+
      /* Col 3: Current IGN */
      '<td><span class="text-xs font-bold">'+currentIgn+'</span></td>'+
      /* Col 4: Current FF UID */
      '<td class="font-mono text-xxs">'+currentFfUid+'</td>'+
      /* Col 5: → New IGN */
      '<td>'+(newIgn?'<div class="proposed-val'+(ignChanged?' warning':'')+'"><i class="fas '+(ignChanged?'fa-arrow-right':'fa-equals')+'"></i> '+newIgn+'</div>'+(ignChanged?'<div class="text-xxs text-muted mt-1"><s>'+currentIgn+'</s> → <b class="text-primary">'+newIgn+'</b></div>':'<div class="text-xxs text-muted">No change</div>'):'<span class="text-muted text-xxs">—</span>')+'</td>'+
      /* Col 6: → New FF UID */
      '<td>'+(newFfUid?'<div class="proposed-val'+(ffChanged?' warning':'')+'"><i class="fas '+(ffChanged?'fa-arrow-right':'fa-equals')+'"></i> '+newFfUid+'</div>'+(ffChanged?'<div class="text-xxs text-muted mt-1"><s>'+currentFfUid+'</s> → <b class="text-primary">'+newFfUid+'</b></div>':'<div class="text-xxs text-muted">No change</div>'):'<span class="text-muted text-xxs">—</span>')+'</td>'+
      /* Col 7: Date */
      '<td class="text-xxs">'+date+'</td>'+
      /* Col 8: Status */
      '<td><span class="badge '+sb+'">'+st+'</span></td>'+
      /* Col 9: Actions */
      '<td>'+acts+'</td>'+
    '</tr>';
  });
  document.getElementById('profileUpdateCount').textContent=c;
  if(rows.length===0){
    tb.innerHTML='<tr><td colspan="9" class="text-muted text-xs" style="text-align:center;padding:20px"><i class="fas fa-user-edit" style="font-size:20px;opacity:0.3;display:block;margin-bottom:6px"></i>No profile update requests</td></tr>';
  }
}
async function approveProfileUpdate(rid){
  console.log('═══════════════════════════════');
  console.log('APPROVE PROFILE UPDATE: '+rid);
  /* Disable button to prevent double-clicks */
  if(event&&event.target){var clickedBtn=event.target.closest('.btn');if(clickedBtn){clickedBtn.disabled=true;clickedBtn.style.opacity='0.5';clickedBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';}}
  try{
    var rs=await rtdb.ref(DB_PROFILE_UPDATE+'/'+rid).once('value');
    if(!rs.exists()){showToast('Request not found!',true);return;}
    var r=rs.val();
    var uid=getUid(r);
    if(!uid){showToast('UID missing in request!',true);return;}
    
    /* Get proposed values — check ALL possible field names from request */
    var newIgn=r.requestedIgn||r.newIgn||r.ign||r.newUsername||r.username||r.playerName||r.gameName||'';
    var newFfUid=r.requestedUid||r.requestedFfUid||r.newFfUid||r.ffUid||r.newUid||r.gameUid||r.gameId||r.freeFireUid||'';
    var newAvatar=r.newAvatar||r.avatar||r.profileImage||r.photo||'';
    var newPhone=r.newPhone||r.phone||r.mobileNumber||r.mobile||'';
    
    console.log('Profile Update request raw keys: '+Object.keys(r).join(', '));
    
    /* Get current user data */
    var currentSnap=await rtdb.ref(DB_USERS+'/'+uid).once('value');
    var currentUser=currentSnap.val()||{};
    
    console.log('Current: IGN="'+(currentUser.ign||'')+'", FF="'+(currentUser.ffUid||'')+'"');
    console.log('New: IGN="'+newIgn+'", FF="'+newFfUid+'"');
    
    /* Validate IGN uniqueness */
    if(newIgn){
      var allUsers=await rtdb.ref(DB_USERS).once('value');
      var dup=false;
      allUsers.forEach(function(u){
        if(u.key!==uid&&u.val().ign&&u.val().ign.toLowerCase()===newIgn.toLowerCase())dup=true;
      });
      if(dup){showToast('❌ IGN "'+newIgn+'" already taken!',true);return;}
    }
    
    /* Build update object */
    var upd={profileUpdatePending:false};
    
    /* CRITICAL: Update IGN in user node */
    if(newIgn){
      upd.ign=newIgn;
      console.log('📝 Setting users/'+uid+'/ign = "'+newIgn+'" (was "'+currentUser.ign+'")');
    }
    
    /* CRITICAL: Update FF UID in user node + ffUIDIndex */
    if(newFfUid){
      /* Bug#14 Fix: Remove old FF UID from index even when newFfUid differs.
         Also handle case where currentUser.ffUid was undefined (new user getting FF UID).
         Validates FF UID uniqueness before updating. */
      var oldFf=currentUser.ffUid||null;
      if(oldFf&&oldFf!==newFfUid){
        await rtdb.ref('ffUIDIndex/'+oldFf).remove();
        console.log('🗑️ Removed old ffUIDIndex/'+oldFf);
      }
      /* Verify new FF UID not taken by another user */
      var _ffCheck=await rtdb.ref('ffUIDIndex/'+newFfUid).once('value');
      if(_ffCheck.exists()&&_ffCheck.val()!==uid){
        showToast('❌ FF UID already taken by another user!',true);
        return;
      }
      upd.ffUid=newFfUid;
      await rtdb.ref('ffUIDIndex/'+newFfUid).set(uid);
      console.log('📝 Setting users/'+uid+'/ffUid = "'+newFfUid+'" + ffUIDIndex');
    }
    
    if(newAvatar){upd.avatar=newAvatar;console.log('📝 Updating avatar');}
    if(newPhone){upd.phone=newPhone;console.log('📝 Setting phone = "'+newPhone+'"');}
    
    /* WRITE to user node FIRST */
    await rtdb.ref(DB_USERS+'/'+uid).update(upd);
    console.log('✅ User node updated');
    
    /* Then update request status (NEVER delete) */
    await rtdb.ref(DB_PROFILE_UPDATE+'/'+rid).update({
      status:'approved',
      processedAt:Date.now(),
      processedBy:auth.currentUser.uid,
      approvedIgn:newIgn,
      approvedFfUid:newFfUid
    });
    
    /* Notify user */
    var changeMsg=[];
    if(newIgn)changeMsg.push('IGN → '+newIgn);
    if(newFfUid)changeMsg.push('FF UID → '+newFfUid);
    
    /* Notify user — Bug Critical #1 Fix */
    await window._adminNotifyUser(uid, {
      title:'Profile Updated! ✅',
      message:'Your profile update was approved. '+(changeMsg.length>0?changeMsg.join(', '):''),
      type:'profile_update_approved'
    });
    
    /* Log action */
    await rtdb.ref('activityLogs').push({
      type:'profile_update_approved',
      uid:uid,
      requestId:rid,
      changes:{newIgn:newIgn,newFfUid:newFfUid,oldIgn:currentUser.ign||null,oldFfUid:currentUser.ffUid||null},
      admin:auth.currentUser.uid,
      timestamp:Date.now()
    });
    
    /* FIX Bug#2: Sync approved profile changes to Supabase
       The Firebase child_changed watcher syncs ign but NOT ff_uid.
       We must explicitly sync both here to keep databases consistent. */
    if(window._supa){
      var supaUpd={updated_at:new Date().toISOString()};
      if(newIgn) supaUpd.ign=newIgn;
      if(newFfUid) supaUpd.ff_uid=newFfUid;
      if(newPhone) supaUpd.phone=newPhone;
      if(newAvatar) supaUpd.avatar_url=newAvatar;
      window._supa.from('users').update(supaUpd).eq('id',uid)
        .catch(function(e){console.warn('[Bug#2 Fix] approveProfileUpdate Supabase sync failed:',e.message);});
      /* Also log wallet_transactions entry for audit trail */
      window._supa.from('admin_activity_log').insert({
        admin_uid:auth.currentUser.uid,
        action:'profile_update_approved',
        target_uid:uid,
        details:JSON.stringify({newIgn:newIgn,newFfUid:newFfUid,requestId:rid}),
        created_at:new Date().toISOString()
      }).catch(function(){});
      console.log('[Bug#2 Fix] approveProfileUpdate Supabase synced:',uid,supaUpd);
    }
    
    console.log('✅ Profile update approved!');
    console.log('═══════════════════════════════');
    showToast('✅ Profile update approved! '+(changeMsg.join(', ')||''));
  }catch(e){
    console.error('approveProfileUpdate error:',e);
    showToast('Error: '+e.message,true);
  }
}

/* =============================================
   USERS
   ============================================= */
function setupUsersListener(){rtdb.ref(DB_USERS).on('value',function(s){usersSnapshot=s;usersCache={};s.forEach(function(c){usersCache[c.key]=c.val();});renderUsers();});}
/* getUserName — Smart fallback: ign → displayName → name → email prefix → UID truncated */
function getUserName(uid){
  if(!uid)return 'Unknown';
  var u=usersCache[uid];
  if(!u)return uid.substring(0,10);
  return u.ign||u.displayName||u.name||u.userName||(u.email?u.email.split('@')[0]:null)||uid.substring(0,10);
}
/* getUserInfo — Get full user identity info for display */
function getUserInfo(uid){
  var u=usersCache[uid]||{};
  return {
    name:u.ign||u.displayName||u.name||u.userName||'Unknown',
    ffUid:u.ffUid||'N/A',
    phone:u.phone||'',
    email:u.email||'',
    level:u.level||1,
    verified:u.profileVerified||false,
    banned:u.isBanned||u.blocked||false
  };
}
function renderUsers(){
  if(!usersSnapshot)return;var tb=document.getElementById('usersTable'),q=(document.getElementById('searchUser').value||'').toLowerCase().trim();tb.innerHTML='';var c=0;
  usersSnapshot.forEach(function(ch){
    var u=ch.val(),uid=ch.key,ign=u.ign||'N/A',ff=u.ffUid||'N/A';
    if(q&&ign.toLowerCase().indexOf(q)<0&&ff.toLowerCase().indexOf(q)<0&&uid.toLowerCase().indexOf(q)<0)return;c++;
    var db_=u.wallet?u.wallet.depositBalance||0:u.realMoney?u.realMoney.deposited||0:0;
    var wb=u.wallet?u.wallet.winningBalance||0:u.realMoney?u.realMoney.winnings||0:0;
    var bal=db_+wb,mt=u.stats?u.stats.matches||0:0,lv=u.level||1,bn=u.isBanned||u.blocked;
    var st=bn?'<span class="badge red">Banned</span>':u.approved?'<span class="badge green">Active</span>':'<span class="badge yellow">Pending</span>';
    var ph=u.phone||'-',em=u.email||'-',vf=u.profileVerified?'<span class="badge green">✓</span>':'<span class="badge yellow">—</span>';
    /* Bug#1 Fix: escape user-supplied IGN, ffUid, phone, email before HTML injection */
    var _e=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
    var row='<tr>';
    row+='<td style="min-width:110px"><span style="font-weight:700;color:var(--primary)">'+_e(ign)+'</span><div onclick="navigator.clipboard.writeText(\''+_e(uid)+'\').then(function(){showToast(\'Firebase UID copied!\')})" style="font-size:9px;color:var(--text-muted);font-family:monospace;cursor:pointer" title="Click to copy full UID">'+_e(uid.substring(0,10))+'…📋</div></td>';
    row+='<td><span style="font-family:monospace;font-size:11px;color:var(--info);background:rgba(0,212,255,.08);padding:2px 6px;border-radius:5px">'+_e(ff)+'</span></td>';
    row+='<td style="font-size:11px;color:var(--text-dim)">'+_e(ph)+'</td>';
    row+='<td style="font-size:10px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+_e(em)+'</td>';
    row+='<td><span style="color:var(--primary);font-weight:700">₹'+bal+'</span><div style="font-size:9px;color:var(--text-muted)">D:₹'+db_+' W:₹'+wb+'</div></td>';
    row+='<td>'+mt+'</td>';
    row+='<td><span class="badge cyan">Lv'+lv+'</span></td>';
    row+='<td>'+vf+'</td>';
    row+='<td style="white-space:nowrap">';
    row+='<button class="btn btn-ghost btn-xs" onclick="openUserModal(\''+uid+'\')" title="View"><i class="fas fa-eye"></i></button> ';
    row+=bn?'<button class="btn btn-primary btn-xs" onclick="unbanUser(\''+uid+'\')" title="Unban"><i class="fas fa-unlock"></i></button>':'<button class="btn btn-warning btn-xs" onclick="banUser(\''+uid+'\')" title="Ban"><i class="fas fa-ban"></i></button>';
    row+=' <button class="btn btn-danger btn-xs" onclick="deleteUser(\''+uid+'\')" title="Delete"><i class="fas fa-trash"></i></button>';
    row+=' <button class="btn btn-ghost btn-xs" style="color:#ffd700" onclick="window.showUserNote&&showUserNote(\''+uid+'\',\''+ign+'\')" title="Note"><i class="fas fa-sticky-note"></i></button>';
    row+='</td></tr>';
    tb.innerHTML+=row;
  });
  document.getElementById('userCount').textContent=c;
}

async function openUserModal(uid){
  var sn=await rtdb.ref(DB_USERS+'/'+uid).once('value');if(!sn.exists())return showToast('Not found',true);var u=sn.val();
  document.getElementById('userModalName').textContent=(u.ign||'Unknown');var bd=document.getElementById('userModalBody');
  var db_=u.wallet?u.wallet.depositBalance||0:u.realMoney?u.realMoney.deposited||0:0;
  var wb=u.wallet?u.wallet.winningBalance||0:u.realMoney?u.realMoney.winnings||0:0;
  var lv=u.level||1,xp=u.exp||0,mx=lv*100,pct=Math.min((xp/mx)*100,100),ref=u.referralCount||u.referrals||0;
  var mh='<p class="text-muted text-xs">No match history</p>';
  var ms=await rtdb.ref('userMatches/'+uid+'/matches').limitToLast(10).once('value');
  if(ms.exists()){mh='<div class="table-wrapper" style="max-height:180px"><table><thead><tr><th>Match</th><th>Rank</th><th>Kills</th><th>Reward</th></tr></thead><tbody>';ms.forEach(function(m){var d=m.val(),tn=allTournaments[m.key]?allTournaments[m.key].name:m.key.substring(0,10);mh+='<tr><td class="text-xs">'+tn+'</td><td>#'+(d.rank||'—')+'</td><td>'+(d.kills||0)+'</td><td class="text-primary">₹'+(d.reward||0)+'</td></tr>';});mh+='</tbody></table></div>';}
  bd.innerHTML='<div class="flex items-center gap-3 mb-3"><div class="chat-avatar" style="width:44px;height:44px;font-size:16px">'+(u.ign||'U').charAt(0).toUpperCase()+'</div><div><div class="font-bold" style="font-size:14px">'+(u.ign||'N/A')+'</div><div class="text-xxs text-muted font-mono">'+uid+'</div><div class="text-xxs text-dim">FF: '+(u.ffUid||'N/A')+' | Ph: '+(u.phone||'N/A')+'</div></div></div><div class="detail-tabs"><div class="detail-tab active" onclick="switchTab(this,\'to_'+uid+'\')">Overview</div><div class="detail-tab" onclick="switchTab(this,\'th_'+uid+'\')">History</div><div class="detail-tab" onclick="switchTab(this,\'tl_'+uid+'\')">Level</div></div><div class="detail-panel active" id="to_'+uid+'"><div class="user-stat-row"><div class="stat-label"><i class="fas fa-gem" style="color:#00d4ff"></i> Sky Diamond</div><div class="stat-val" style="color:#00d4ff">💎\'+(u.skyDiamonds||db_)+\'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-circle" style="color:#00ff64"></i> Green Diamond</div><div class="stat-val" style="color:#00ff64"><img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block">\'+(u.greenDiamonds||0)+\'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-coins" style="color:#ffd700"></i> Coins</div><div class="stat-val" style="color:#ffd700">🪙\'+(u.coins||0)+\'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-gamepad"></i> Matches</div><div class="stat-val">'+(u.stats?u.stats.matches||0:0)+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-crown"></i> Wins</div><div class="stat-val">'+(u.stats?u.stats.wins||0:0)+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-crosshairs"></i> Kills</div><div class="stat-val">'+(u.totalKills||(u.stats?u.stats.kills||0:0))+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-coins"></i> Earnings</div><div class="stat-val text-primary">₹'+(u.totalWinnings||(u.stats?u.stats.earnings||0:0))+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-users"></i> Referrals</div><div class="stat-val">'+ref+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-shield-halved"></i> Profile</div><div class="stat-val">'+(u.profileVerified?'<span class="badge green">Verified</span>':'<span class="badge yellow">Unverified</span>')+'</div></div></div><div class="detail-panel" id="th_'+uid+'">'+mh+'</div><div class="detail-panel" id="tl_'+uid+'"><div class="user-stat-row"><div class="stat-label"><i class="fas fa-star"></i> Level</div><div class="stat-val"><span class="badge cyan">Lv '+lv+'</span></div></div><div class="mb-3"><div class="flex justify-between text-xxs mb-1"><span class="text-dim">EXP</span><span class="text-primary">'+xp+'/'+mx+'</span></div><div class="exp-bar"><div class="exp-fill" style="width:'+pct+'%"></div></div></div><div class="grid-2 mt-3"><div class="form-group"><label>Level</label><input type="number" id="eL_'+uid+'" class="form-input" value="'+lv+'" min="1"></div><div class="form-group"><label>EXP</label><input type="number" id="eX_'+uid+'" class="form-input" value="'+xp+'" min="0"></div></div><button class="btn btn-primary btn-sm" onclick="saveUserLevel(\''+uid+'\')"><i class="fas fa-save"></i> Save</button></div>';
  var ft=document.getElementById('userModalFooter'),bn=u.isBanned||u.blocked;
  ft.innerHTML=(bn?'<button class="btn btn-primary btn-sm" onclick="unbanUser(\''+uid+'\');closeModal(\'userModal\')"><i class="fas fa-unlock"></i> Unban</button>':'<button class="btn btn-warning btn-sm" onclick="banUser(\''+uid+'\');closeModal(\'userModal\')"><i class="fas fa-ban"></i> Ban</button>')+' <button class="btn btn-danger btn-sm" onclick="deleteUser(\''+uid+'\');closeModal(\'userModal\')"><i class="fas fa-trash"></i> Delete</button> <button class="btn btn-ghost btn-sm" onclick="closeModal(\'userModal\')">Close</button>';
  document.getElementById('userModal').classList.add('show');
}
function switchTab(el,pid){el.parentElement.querySelectorAll('.detail-tab').forEach(function(t){t.classList.remove('active')});el.classList.add('active');el.closest('.modal-body').querySelectorAll('.detail-panel').forEach(function(p){p.classList.remove('active')});document.getElementById(pid).classList.add('active');}
async function saveUserLevel(uid){var lv=Number(document.getElementById('eL_'+uid).value)||1,xp=Number(document.getElementById('eX_'+uid).value)||0;try{await rtdb.ref(DB_USERS+'/'+uid).update({level:lv,exp:xp});showToast('Level updated!');}catch(e){showToast('Error: '+e.message,true);}}
async function banUser(uid){
  var r=prompt('Ban reason (required):');if(!r||!r.trim())return;
  /* Bug#8 Fix: re-verify admin session before critical action */
  try{if(auth&&auth.currentUser)await auth.currentUser.getIdToken(true);}catch(te){return showToast('Session expired — please re-login',true);}
  if(!confirm('Ban user '+uid.substring(0,10)+'…? Reason: '+r))return;
  try{
    await rtdb.ref(DB_USERS+'/'+uid).update({isBanned:true,blocked:true,status:'banned',banReason:r,bannedAt:Date.now()});
    await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'Account Banned ⛔',message:'Reason: '+r,timestamp:Date.now(),read:false});
    /* Bug#8+10 Fix: Supabase sync */
    if(window._supa){window._supa.from('users').update({is_banned:true,updated_at:new Date().toISOString()}).eq('id',uid).catch(function(e){console.warn('[Bug#8] banUser Supabase:',e.message);});}
    /* Refresh cache */
    if(window.usersCache&&window.usersCache[uid])window.usersCache[uid].isBanned=true;
    showToast('User banned');
  }catch(e){showToast('Error: '+e.message,true);}
}
async function unbanUser(uid){
  if(!confirm('Unban?'))return;
  try{
    await rtdb.ref(DB_USERS+'/'+uid).update({isBanned:false,blocked:false,status:'active',banReason:null,bannedAt:null});
    /* FIX Bug#10: Sync unban to Supabase */
    if(window._supa){
      window._supa.from('users').update({is_banned:false,updated_at:new Date().toISOString()}).eq('id',uid)
        .catch(function(e){console.warn('[Bug#10 Fix] unbanUser Supabase sync:',e.message);});
    }
    /* Refresh cache */
    if(window.usersCache&&window.usersCache[uid]) window.usersCache[uid].isBanned=false;
    showToast('User unbanned');
  }catch(e){showToast('Error: '+e.message,true);}
}
async function deleteUser(uid){
  if(!confirm('DELETE permanently? This cannot be undone.'))return;
  try{
    var s=await rtdb.ref(DB_USERS+'/'+uid).once('value');
    var ff=s.val()?s.val().ffUid:null;
    /* Firebase cleanup */
    await rtdb.ref(DB_USERS+'/'+uid).remove();
    await rtdb.ref('userMatches/'+uid).remove();
    await rtdb.ref('joinedMatches/'+uid).remove();
    await rtdb.ref('userWallet/'+uid).remove();
    if(ff) await rtdb.ref('ffUIDIndex/'+ff).remove();
    /* FIX Bug#10: Soft-delete in Supabase — hard delete breaks FK constraints.
       Mark deleted so user cannot re-appear in stats/leaderboard. */
    if(window._supa){
      window._supa.from('users').update({
        is_banned:true,is_deleted:true,
        deleted_at:new Date().toISOString(),ign:'[deleted]',ff_uid:null,phone:null
      }).eq('id',uid)
        .catch(function(e){console.warn('[Bug#10 Fix] deleteUser Supabase cleanup:',e.message);});
      /* Remove from leaderboard */
      window._supa.from('leaderboard').delete().eq('user_id',uid).catch(function(){});
    }
    /* Remove from local cache */
    if(window.usersCache) delete window.usersCache[uid];
    showToast('User deleted');
  }catch(e){showToast('Error: '+e.message,true);}
}

/* =============================================
   MANUAL WALLET
   ============================================= */
function openManualWalletModal(){document.getElementById('manualUid').value='';document.getElementById('manualAmount').value='';document.getElementById('manualReason').value='';document.getElementById('manualUserInfo').style.display='none';document.getElementById('manualWalletModal').classList.add('show');}
async function lookupManualUser(){
  var uid=document.getElementById('manualUid').value.trim();
  if(!uid)return showToast('Enter UID',true);
  try{
    var s=await rtdb.ref(DB_USERS+'/'+uid).once('value');
    if(!s.exists())return showToast('Not found',true);
    var u=s.val();
    document.getElementById('manualUserName').textContent=u.ign||'Unknown';
    document.getElementById('manualUserStatus').textContent=u.isBanned?'Banned':'Active';
    document.getElementById('manualUserStatus').className='badge '+(u.isBanned?'red':'green');
    document.getElementById('manualUserDep').textContent=(u.skyDiamonds||u.realMoney&&u.realMoney.deposited||0);
    document.getElementById('manualUserWin').textContent=(u.greenDiamonds||0);
    if(document.getElementById('manualUserCoins')) document.getElementById('manualUserCoins').textContent=(u.coins||0);
    document.getElementById('manualUserInfo').style.display='block';
  }catch(e){showToast('Error: '+e.message,true);}
}
/* Bug 2 Fix: Admin manual credit — force positive, cap at 999999, use Supabase RPC */
async function processManualWallet(){
  var uid=document.getElementById('manualUid').value.trim(),
      act=document.getElementById('manualAction').value,
      wt=document.getElementById('manualWalletType').value,
      amt=Number(document.getElementById('manualAmount').value)||0,
      rsn=document.getElementById('manualReason').value.trim()||'Admin adjustment';
  if(!uid)return showToast('Enter UID',true);
  if(amt<=0)return showToast('Amount must be greater than 0',true);
  if(amt>999999)return showToast('Amount too large (max 999,999)',true);
  var s=await rtdb.ref(DB_USERS+'/'+uid).once('value');
  if(!s.exists())return showToast('User not found',true);
  var modalBtns=document.querySelectorAll('#manualWalletModal .btn-primary');
  modalBtns.forEach(function(b){setLoading(b,true);});
  var supaCol=wt==='sky'?'sky_diamonds':wt==='green'?'green_diamonds':'coins';
  var currPath=wt==='sky'?'skyDiamonds':wt==='green'?'greenDiamonds':'coins';
  try{
    /* Bug#7 Fix: Firebase is source of truth — write Firebase FIRST, then sync Supabase.
       This prevents Supabase-updated/Firebase-not state on partial failure.
       If Supabase RPC doesn't exist, fall back to direct update. */
    var _fbResult;
    if(act==='credit'){
      _fbResult=await rtdb.ref(DB_USERS+'/'+uid+'/'+currPath).transaction(function(v){return(v||0)+amt});
      if(_fbResult.committed){
        if(window._supa){
          var _supaOk=await window._supa.rpc('increment_balance',{p_uid:uid,p_col:supaCol,p_amount:amt}).catch(function(){return {error:{message:'rpc_missing'}};});
          if(_supaOk&&_supaOk.error&&_supaOk.error.message&&_supaOk.error.message.includes('rpc_missing')){
            /* RPC not set up — fallback to direct read+update */
            var _cur=await window._supa.from('users').select(supaCol).eq('id',uid).single().catch(function(){return {data:null};});
            if(_cur.data) window._supa.from('users').update({[supaCol]:(_cur.data[supaCol]||0)+amt}).eq('id',uid).catch(function(){});
          }
        }
      }
    }else{
      /* For debit: check Firebase balance BEFORE decrementing (prevent negative) */
      var _curBal=await rtdb.ref(DB_USERS+'/'+uid+'/'+currPath).once('value');
      var _curBalVal=Number(_curBal.val())||0;
      if(_curBalVal<amt)throw new Error('Insufficient '+wt+' balance (current: '+_curBalVal+')');
      _fbResult=await rtdb.ref(DB_USERS+'/'+uid+'/'+currPath).transaction(function(v){return Math.max((v||0)-amt,0)});
      if(_fbResult.committed){
        if(window._supa){
          var _supaOk2=await window._supa.rpc('decrement_balance',{p_uid:uid,p_col:supaCol,p_amount:amt}).catch(function(){return {error:{message:'rpc_missing'}};});
          if(_supaOk2&&_supaOk2.error&&_supaOk2.error.message&&_supaOk2.error.message.includes('rpc_missing')){
            var _cur2=await window._supa.from('users').select(supaCol).eq('id',uid).single().catch(function(){return {data:null};});
            if(_cur2.data) window._supa.from('users').update({[supaCol]:Math.max((_cur2.data[supaCol]||0)-amt,0)}).eq('id',uid).catch(function(){});
          }
        }
      }
    }
    await rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:act==='credit'?'admin_credit':'admin_debit',currency:wt,amount:act==='credit'?amt:-amt,description:rsn,timestamp:Date.now()});
    if(window._supa){window._supa.from('wallet_transactions').insert({user_id:uid,currency:supaCol,txn_type:act==='credit'?'admin_credit':'admin_debit',amount:act==='credit'?amt:-amt,description:rsn}).catch(function(){});}
    await window._adminNotifyUser(uid,{title:act==='credit'?'💰 Wallet Credited!':'Wallet Adjusted',message:amt+' '+(act==='credit'?'add kiye gaye':'remove kiye gaye')+'. Reason: '+rsn,type:act==='credit'?'wallet_credit':'wallet_debit'});
    var modalBtns2=document.querySelectorAll('#manualWalletModal .btn-primary');
    modalBtns2.forEach(function(b){setLoading(b,false);});
    closeModal('manualWalletModal');
    showToast('✅ '+amt+' '+(act==='credit'?'credited':'debited'));
  }catch(e){
    var modalBtns3=document.querySelectorAll('#manualWalletModal .btn-primary');
    modalBtns3.forEach(function(b){setLoading(b,false);});
    showToast('Error: '+e.message,true);
  }
}

/* =============================================
   DASHBOARD — reads from matches/ node
   ============================================= */
async function refreshDashboard(){
  try{
    var arr=await Promise.all([rtdb.ref(DB_USERS).once('value'),rtdb.ref(DB_MATCHES).once('value'),rtdb.ref(DB_WALLET).once('value'),rtdb.ref(DB_PROFILE).once('value')]);
    var uS=arr[0],tS=arr[1],wS=arr[2],pS=arr[3];
    document.getElementById('statUsers').textContent=uS.numChildren();
    document.getElementById('statTournaments').textContent=tS.numChildren();
    var wp=0,wd=0;wS.forEach(function(c){if(c.val().status==='pending'){wp++;if(normalizeWalletType(c.val().type)==='withdraw')wd++;}});
    document.getElementById('statWalletReq').textContent=wp;document.getElementById('statPendingWithdraw').textContent=wd;
    var pp=0;pS.forEach(function(c){if(!c.val().status||c.val().status==='pending')pp++;});document.getElementById('statPendingProfiles').textContent=pp;
    var am=0;tS.forEach(function(c){if(c.val().status==='live')am++;});document.getElementById('statActiveMatches').textContent=am;
    /* Platform profit stats — calculate directly from walletRequests (same source as Analytics) */
    try {
      var walletSnap = await rtdb.ref(DB_WALLET).once('value');
      var totalDeposits = 0, totalPayouts = 0;
      walletSnap.forEach(function(c) {
        var w = c.val(); if(!w) return;
        var tp = normalizeWalletType(w.type);
        if(tp === 'deposit' && w.status === 'approved') totalDeposits += Number(w.amount)||0;
        if(tp === 'withdraw' && w.status === 'approved') totalPayouts += Number(w.amount)||0;
      });
      var netProfit = totalDeposits - totalPayouts;
      var profEl = document.getElementById('dashPlatformProfit');
      var collEl = document.getElementById('dashTotalCollected');
      if(profEl) profEl.textContent = '₹' + netProfit;
      if(collEl) collEl.textContent = '₹' + totalDeposits;
      var coinReqs = await rtdb.ref('coinRequests').orderByChild('status').equalTo('pending').once('value');
      var crEl = document.getElementById('dashCoinRequests');
      if(crEl) crEl.textContent = coinReqs.numChildren();
      /* Paid matches count */
      var tmEl = document.getElementById('dashTotalMatches');
      if(tmEl) { var paidCount=0; tS.forEach(function(c){if(Number(c.val().entryFee)>0)paidCount++;}); tmEl.textContent = paidCount; }
    } catch(e) { /* silent */ }
    var rE=document.getElementById('recentProfiles');var rh='',rc=0;
    pS.forEach(function(c){var d=c.val();if((!d.status||d.status==='pending')&&rc<5){rc++;rh+='<div class="feed-item"><div class="flex items-center gap-2"><span class="badge primary" style="font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(d.ign||d.username||'Unknown')+'</span><span class="badge yellow">Pending</span></div><div class="time">'+(d.createdAt?new Date(d.createdAt).toLocaleString():'N/A')+'</div></div>';}});
    rE.innerHTML=rh||'<p class="text-muted text-xs" style="padding:6px">No pending</p>';
    var aE=document.getElementById('activeTournaments');var ah='';
    var liveCount=0,upcomingCount=0,completedCount=0;
    tS.forEach(function(c){
      var d=c.val();
      /* Use the calculated status function for consistency */
      var smartStatus=getAdminMatchStatus(d);
      
      /* Count by calculated status */
      if(smartStatus==='live')liveCount++;
      else if(smartStatus==='upcoming')upcomingCount++;
      else if(smartStatus==='completed'||smartStatus==='resultPublished')completedCount++;
      
      /* Show upcoming and live matches in feed */
      if(smartStatus==='upcoming'||smartStatus==='live'){
        var badgeColor=getStatusBadgeColor(smartStatus);
        /* Calculate time remaining or elapsed */
        var mt=Number(d.matchTime)||0;
        var timeInfo='';
        if(mt){
          var diff=mt-Date.now();
          if(diff>0){
            var mins=Math.floor(diff/60000);
            timeInfo=mins>60?(Math.floor(mins/60)+'h '+mins%60+'m'):(mins+'m remaining');
          }else{
            var elapsed=Math.floor(-diff/60000);
            timeInfo=elapsed>60?(Math.floor(elapsed/60)+'h '+elapsed%60+'m ago'):(elapsed+'m ago');
          }
        }
        ah+='<div class="feed-item"><div class="flex items-center gap-2"><strong class="text-xs">'+d.name+'</strong><span class="badge '+badgeColor+'">'+smartStatus.toUpperCase()+'</span></div><div class="time">'+(d.matchTime?new Date(d.matchTime).toLocaleString():'N/A')+' • <span class="text-primary">'+timeInfo+'</span></div></div>';
      }
    });
    aE.innerHTML=ah||'<p class="text-muted text-xs" style="padding:6px">No active matches</p>';
    
    /* Update active matches stat to show live count */
    document.getElementById('statActiveMatches').textContent=liveCount;
    console.log('Dashboard Stats — Calculated from matchTime:','Upcoming:',upcomingCount,'Live:',liveCount,'Completed:',completedCount);
  }catch(e){console.error('Dash:',e);}
}
/* =============================================
   MATCH STATUS LOGIC — CALCULATED, NOT SAVED
   Status is calculated based on matchTime, NOT from database
   This ensures consistent status across Admin and User panels
   
   Logic:
   - If now < matchTime → "Upcoming"
   - If now >= matchTime && now < matchTime + 1 hour → "Live"  
   - If now >= matchTime + 1 hour → "Completed"
   
   Special cases:
   - 'resultPublished' status is preserved (admin manually published results)
   - 'cancelled' status is preserved (admin cancelled the match)
   ============================================= */

/* ╔══════════════════════════════════════════════════════════╗
   ║  MATCH STATUS ENGINE (CALCULATED, NOT SAVED)           ║
   ║  ══════════════════════════════════════════════════════ ║
   ║  Status is CALCULATED from matchTime, NOT read from DB ║
   ║  This ensures Admin & User panels always show same     ║
   ║  status regardless of what's stored in database.       ║
   ║                                                        ║
   ║  TIMELINE:                                             ║
   ║  ──────────┬──────────────────┬──────────────          ║
   ║  Upcoming  │      Live        │  Completed             ║
   ║  ──────────┼──────────────────┼──────────────          ║
   ║         matchTime      matchTime+1hour                 ║
   ║                                                        ║
   ║  TERMINAL STATES (admin-set, never auto-changed):      ║
   ║  • resultPublished — admin clicked "Publish Results"   ║
   ║  • cancelled — admin clicked "Cancel & Refund"         ║
   ╚══════════════════════════════════════════════════════════╝ */

/* getMatchStatus — Core time-based calculation
   SYNCED with User Panel — both use identical logic
   Duration: 1 hour (3,600,000 ms)
   
   Returns: 'Upcoming' | 'Live' | 'Completed' (title case)
*/
function getMatchStatus(matchTime){
  var now=Date.now();
  var startTime=Number(matchTime)||0;
  
  if(!startTime)return 'Upcoming';
  
  var endTime=startTime+(60*60*1000); /* 1 hour match duration */
  
  if(now<startTime)return 'Upcoming';
  if(now>=startTime&&now<endTime)return 'Live';
  return 'Completed';
}

/* getAdminMatchStatus — Enhanced wrapper with terminal state handling
   - Uses getMatchStatus() internally for time calculation
   - Respects 'resultPublished' and 'cancelled' as immutable states
   - Returns lowercase for badge CSS class compatibility
   
   Returns: 'upcoming' | 'live' | 'completed' | 'resultPublished' | 'cancelled'
*/
function getAdminMatchStatus(m){
  if(!m)return 'upcoming';
  
  /* Terminal states — admin-set, NEVER overridden by time calculation */
  if(m.status==='resultPublished')return 'resultPublished';
  if(m.status==='cancelled')return 'cancelled';
  
  /* All other states — calculate from matchTime */
  var mt=Number(m.matchTime)||0;
  if(!mt)return 'upcoming';
  
  return getMatchStatus(mt).toLowerCase();
}

/* getStatusBadgeColor — Badge color based on calculated status */
function getStatusBadgeColor(status){
  switch(status){
    case 'live': return 'red';
    case 'upcoming': return 'yellow';
    case 'completed': return 'blue';
    case 'resultPublished': return 'green';
    case 'cancelled': return 'gray';
    default: return 'blue';
  }
}

/* Legacy function for backward compatibility */
function getStatus(t){if(!t)return 'upcoming';return Date.now()>=t?'live':'upcoming';}

/* =============================================
   TOURNAMENTS — ALL data goes to matches/ node
   ============================================= */
async function loadTournaments(){
  try{
    var arr=await Promise.all([rtdb.ref(DB_MATCHES).once('value'),rtdb.ref(DB_JOIN).once('value')]);
    var tS=arr[0],jS=arr[1];allTournaments={};allJoinRequests={};var jc={};
    
    /* Count joined players from joinRequests node */
    jS.forEach(function(c){
      var j=c.val();
      allJoinRequests[c.key]=j;
      /* Accept multiple status variants for counting: approved, joined, confirmed, or no status (direct join) */
      var isJoined=(j.status==='approved'||j.status==='joined'||j.status==='confirmed'||!j.status);
      if(isJoined){
        var tid=j.tournamentId||j.matchId;
        jc[tid]=(jc[tid]||0)+1;
      }
    });
    
    /* Also check matches/{id}/joined node for direct joins */
    tS.forEach(function(c){
      var d=c.val(),id=c.key;
      /* If match has a 'joined' sub-node, count those too */
      if(d.joined&&typeof d.joined==='object'){
        var joinedCount=Object.keys(d.joined).length;
        jc[id]=Math.max(jc[id]||0,joinedCount);
        console.log('Match '+id+' has '+joinedCount+' players in matches/'+id+'/joined');
      }
    });
    var tb=document.getElementById('tournamentsTable');if(tb)tb.innerHTML='';var cnt=0;
    var rS=document.getElementById('resultTournamentSelect'),nS=document.getElementById('notifTournamentSelect'),jF=document.getElementById('joinedTournamentFilter');
    if(rS)rS.innerHTML='<option value="">-- Select --</option>';
    var mhSel=document.getElementById('mhMatchSelect');
    if(mhSel)mhSel.innerHTML='<option value="">-- Select Match --</option>';
    if(nS)nS.innerHTML='<option value="">-- Select --</option>';
    if(jF)jF.innerHTML='<option value="all">All</option>';
    tS.forEach(function(c){
      var d=c.val(),id=c.key;
      allTournaments[id]=d;
      
      /* Calculate filled slots — use Math.max of all sources for accuracy */
      d.filledSlots=Math.max(d.joinedSlots||0, jc[id]||0, d.filledSlots||0);
      
      /* Apply filter — now supports status filters too */
      if(currentFilter!=='all'){
        if(currentFilter==='special'&&!d.isSpecial)return;
        if(currentFilter==='paid'&&d.entryType!=='paid')return;
        if(currentFilter==='coin'&&d.entryType!=='coin')return;
        if(currentFilter==='ad'&&d.entryType!=='ad')return;
        /* Status filters using smart status */
        var smartSt=getAdminMatchStatus(d);
        if(currentFilter==='upcoming'&&smartSt!=='upcoming')return;
        if(currentFilter==='live'&&smartSt!=='live')return;
        if(currentFilter==='completed'&&smartSt!=='completed'&&smartSt!=='resultPublished')return;
      }
      cnt++;
      
      /* Get status — use smart time-based calculation for UI display */
      var st=getAdminMatchStatus(d);
      var sb=getStatusBadgeColor(st);
      var tm=d.matchTime?new Date(d.matchTime).toLocaleString():'N/A';
      
      /* Game mode — normalize and display correctly */
      var gameMode=(d.gameMode||d.matchType||'solo').toLowerCase().trim();
      /* Fix: Ensure proper capitalization for display */
      var gameModeDisplay=gameMode.charAt(0).toUpperCase()+gameMode.slice(1);
      var modeBadgeColor=gameMode==='squad'?'purple':gameMode==='duo'?'cyan':'blue';
      
      /* Cancel button — only show for active matches */
      var cb='';
      if(st!=='cancelled'&&st!=='resultPublished'){
        cb='<button class="btn btn-danger btn-xs" onclick="cancelTournament(\''+id+'\')" title="Cancel & Refund"><i class="fas fa-ban"></i></button>';
      }
      
      /* Build row */
      if(tb) tb.innerHTML+='<tr>'+
        '<td class="font-bold text-xs">'+(d.isSpecial?'⭐ ':'')+d.name+'</td>'+
        '<td><span class="badge '+modeBadgeColor+'">'+gameModeDisplay+'</span></td>'+
        '<td><span class="badge '+(d.entryType==='paid'?'green':d.entryType==='ad'?'yellow':'purple')+'">'+d.entryType+'</span>'+(d.entryType==='ad'?' 📺 '+(d.adsRequired||2)+' ads':' ₹'+(d.entryFee||0))+(d.minRank?'<br><span style="font-size:10px;color:#ffd700">🏅'+d.minRank+'+</span>':'')+'</td>'+
        '<td class="text-primary font-bold">'+(d.perKillPrize?'₹'+d.perKillPrize+'/Kill':'—')+'</td>'+
        '<td>'+slotBar(d.filledSlots,d.maxSlots||0)+'</td>'+
        '<td class="text-xxs">'+(d.map||'N/A')+'</td>'+
        '<td class="text-xxs">'+tm+'</td>'+
        '<td><span class="badge '+sb+'">'+st+'</span></td>'+
        '<td class="flex gap-1 items-center">'+
          '<button class="btn btn-ghost btn-xs" onclick="editTournament(\''+id+'\')"><i class="fas fa-edit"></i></button>'+
          '<button class="btn btn-ghost btn-xs" style="color:var(--info)" onclick="window.showRoomManager&&showRoomManager(\''+id+'\',\''+d.name+'\')" title="Room ID"><i class="fas fa-key"></i></button>'+
          '<button class="btn btn-ghost btn-xs" style="color:var(--purple)" onclick="window.broadcastToMatch&&broadcastToMatch(\''+id+'\',\''+d.name+'\')" title="Broadcast"><i class="fas fa-broadcast-tower"></i></button>'+
          '<button class="btn btn-ghost btn-xs" style="color:var(--warning)" onclick="window.showMatchAnalytics&&showMatchAnalytics(\''+id+'\',\''+d.name+'\')" title="Analytics"><i class="fas fa-chart-bar"></i></button>'+
          cb+
          '<button class="btn btn-ghost btn-xs" onclick="deleteTournament(\''+id+'\')" style="color:var(--danger)"><i class="fas fa-trash"></i></button>'+
        '</td>'+
      '</tr>';
      
      /* Add to dropdowns — filtered by status */
      /* Match Result: only unpublished/active matches */
      if(st !== 'resultPublished' && st !== 'cancelled') {
        rS.innerHTML+='<option value="'+id+'">'+d.name+'</option>';
      }
      /* Match History: only published matches */
      var mhSel = document.getElementById('mhMatchSelect');
      if(mhSel && st === 'resultPublished') {
        mhSel.innerHTML+='<option value="'+id+'">'+d.name+' ✅</option>';
      }
      nS.innerHTML+='<option value="'+id+'">'+d.name+'</option>';
    });
    /* Show empty message if no matches */
    if(cnt===0){
      tb.innerHTML='<tr><td colspan="9" class="text-muted text-xs" style="text-align:center;padding:20px"><i class="fas fa-trophy" style="font-size:24px;opacity:0.3;display:block;margin-bottom:8px"></i>No matches found. Click "Create" to add a new match.</td></tr>';
    }
    
    var tcEl=document.getElementById('tournamentCount');if(tcEl)tcEl.textContent=cnt;
    console.log('Loaded',cnt,'matches from',DB_MATCHES+'/');
    
    /* Populate joined tournament filter */
    populateJoinedFilter();
    loadJoinedPlayers();
  }catch(e){
    console.error('loadTournaments Error:',e);
    var _tbl=document.getElementById('tournamentsTable');if(_tbl)document.getElementById('tournamentsTable').innerHTML='<tr><td colspan="9" class="text-danger text-xs" style="text-align:center;padding:20px">Error loading matches. Check console.</td></tr>';
  }
}

/* Populate the Joined Players tournament filter dropdown */
function populateJoinedFilter(){
  var jF=document.getElementById('joinedTournamentFilter');
  if(!jF)return;
  var currentVal=jF.value;
  jF.innerHTML='<option value="all">All Matches</option>';
  Object.keys(allTournaments).forEach(function(id){
    var t=allTournaments[id];
    jF.innerHTML+='<option value="'+id+'">'+t.name+'</option>';
  });
  jF.value=currentVal||'all';
}
function filterTournaments(f,btn){currentFilter=f;document.querySelectorAll('.filter-tab').forEach(function(t){t.classList.remove('active')});if(btn)btn.classList.add('active');loadTournaments();}
function openTournamentModal(){
  ['tournamentId','tName','tEntryFee','tMaxSlots','tFirstPrize','tSecondPrize','tThirdPrize','tPerKill','tMatchTime','tRoomId','tRoomPass'].forEach(function(i){var e=document.getElementById(i);if(e)e.value=''});
  document.getElementById('tGameMode').value='solo';
  document.getElementById('tMap').value='Bermuda';
  document.getElementById('tEntryType').value='paid';
  document.getElementById('tIsSpecial').checked=false;
  var scEl2 = document.getElementById('tSpecialCategory'); if (scEl2) scEl2.value = 'none';
  document.getElementById('currentStatusHint').style.display='none';
  /* Reset the original match time tracker — new match has no original time */
  _editOriginalMatchTime=0;
  onEntryTypeChange();
  document.getElementById('tournamentModal').classList.add('show');
  console.log('📅 New Match modal opened — _editOriginalMatchTime reset to 0');
  /* Load saved templates */
  setTimeout(loadTemplates, 100);
}
function onEntryTypeChange(){
  var t=document.getElementById('tEntryType').value;
  var h=document.getElementById('entryTypeHint');
  var adReqWrap=document.getElementById('adsRequiredWrap');
  var entryFeeWrap=document.getElementById('entryFeeWrap');
  var prizeTypeEl=document.getElementById('tPrizeType');
  var entryFeeLabel=document.getElementById('entryFeeLabel');
  var p1lbl=document.getElementById('prize1Label');
  var p2lbl=document.getElementById('prize2Label');
  var p3lbl=document.getElementById('prize3Label');

  // Show/hide entry fee for ad type
  if(entryFeeWrap) entryFeeWrap.style.display = t==='ad' ? 'none' : '';

  // Show ads required only for ad type
  if(adReqWrap) adReqWrap.style.display = t==='ad' ? 'block' : 'none';

  /* ✅ FIX: Auto-set default prize type based on entry type
     Priority: 1) Admin ki pichli saved preference  2) Sensible default
     Admin chahe to dropdown se baad mein change kar sakta hai */
  var _PRIZE_STORAGE_KEY = 'admin_prize_pref_' + t;
  var _savedPrize = null;
  try { _savedPrize = localStorage.getItem(_PRIZE_STORAGE_KEY); } catch(e) {}

  /* Sensible defaults (fixed — coin match pehle skyDiamond tha, galat tha) */
  var _defaultPrize = t==='paid' ? 'greenDiamond' : t==='coin' ? 'coin' : 'coin';
  var _chosenPrize  = _savedPrize || _defaultPrize;

  if(t==='paid'){
    h.className='info-box green';
    if(entryFeeLabel) entryFeeLabel.textContent='💠 Entry Fee (Sky Diamond) *';
    h.innerHTML='<i class="fas fa-info-circle"></i> <b>Paid Match</b> — Entry: 💠 Sky Diamond | Default prize: <img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block"> GD <span style="color:#888;font-size:11px">(neeche se change kar sakte ho)</span>';
  } else if(t==='coin'){
    h.className='info-box purple';
    if(entryFeeLabel) entryFeeLabel.textContent='🪙 Entry Fee (Coins) *';
    h.innerHTML='<i class="fas fa-info-circle"></i> <b>Coin Match</b> — Entry: 🪙 Coins | Default prize: 🪙 Coins <span style="color:#888;font-size:11px">(neeche se change kar sakte ho)</span>';
  } else {
    h.className='info-box yellow';
    if(entryFeeLabel) entryFeeLabel.textContent='Entry Fee';
    h.innerHTML='<i class="fas fa-info-circle"></i> <b>Ad Match</b> — Entry: 📺 Watch Ads | Default prize: 🪙 Coins <span style="color:#888;font-size:11px">(neeche se change kar sakte ho)</span>';
  }

  /* Apply chosen prize type to dropdown */
  if(prizeTypeEl) prizeTypeEl.value = _chosenPrize;

  /* Update prize labels based on chosen prize type */
  _updatePrizeLabels(_chosenPrize, p1lbl, p2lbl, p3lbl);
  // Show creator field only for paid Sky Diamond matches
  var _cfg=document.getElementById('creatorFieldGroup');
  if(_cfg) _cfg.style.display=(t==='paid'?'':'none');
}
/* ✅ Helper: update prize column labels when prize type changes */
function _updatePrizeLabels(pt, p1lbl, p2lbl, p3lbl){
  var sym = pt==='greenDiamond' ? '<img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block"> GD'
           : pt==='skyDiamond'  ? '💠 SD'
           : '🪙 Coins';
  if(p1lbl) p1lbl.textContent='1st Prize (' + sym.replace(/<[^>]+>/g,'').trim() + ')';
  if(p2lbl) p2lbl.textContent='2nd Prize (' + sym.replace(/<[^>]+>/g,'').trim() + ')';
  if(p3lbl) p3lbl.textContent='3rd Prize (' + sym.replace(/<[^>]+>/g,'').trim() + ')';
}

/* ✅ Called when admin manually changes prize type dropdown */
function onPrizeTypeChange(){
  var et = (document.getElementById('tEntryType')||{}).value || 'paid';
  var pt = (document.getElementById('tPrizeType')||{}).value  || 'greenDiamond';
  var p1lbl = document.getElementById('prize1Label');
  var p2lbl = document.getElementById('prize2Label');
  var p3lbl = document.getElementById('prize3Label');

  /* Save admin's preference for this entry type */
  try { localStorage.setItem('admin_prize_pref_' + et, pt); } catch(e) {}

  /* Update labels */
  _updatePrizeLabels(pt, p1lbl, p2lbl, p3lbl);

  /* Update hint text */
  var h = document.getElementById('entryTypeHint');
  if(h){
    var prizeLabel = pt==='greenDiamond' ? 'Green Diamond 💎' : pt==='skyDiamond' ? 'Sky Diamond 💠' : 'Coins 🪙';
    var entryLabel = et==='paid' ? 'Sky Diamond 💠' : et==='coin' ? 'Coins 🪙' : 'Ads 📺';
    h.innerHTML = '<i class="fas fa-info-circle"></i> Entry: ' + entryLabel + ' | Prize: <b>' + prizeLabel + '</b>';
  }
}
function resolveCreatorCode(){
  var code=((document.getElementById('tCreatorCode')||{}).value||'').toUpperCase().trim();
  var status=document.getElementById('creatorCodeStatus');
  if(!status) return;
  if(!code||code.length<3){status.textContent='';window._resolvedCreatorUid=null;return;}
  (window.rtdb||window.db).ref('creatorCodes/'+code).once('value',function(s){
    if(s.val()){
      window._resolvedCreatorUid=s.val();
      (window.rtdb||window.db).ref('users/'+s.val()+'/ign').once('value',function(u){
        status.innerHTML='<span style="color:#00ff9c;font-weight:700">✅ Creator found: '+(u.val()||'Creator')+'</span>';
      });
    } else {
      window._resolvedCreatorUid=null;
      status.innerHTML='<span style="color:#ff6b6b">❌ Creator code not found</span>';
    }
  });
}
/* _editOriginalMatchTime — stores the EXACT database matchTime (ms) when edit modal opens
   Used by saveTournament() to compare: did admin actually change the time?
   This prevents status recalculation when only Room ID/other fields change.
*/
var _editOriginalMatchTime=0;

function editTournament(id){
  var d=allTournaments[id];if(!d)return;
  document.getElementById('tournamentId').value=id;
  document.getElementById('tName').value=d.name||'';
  document.getElementById('tGameMode').value=(d.gameMode||d.matchType||'solo').toLowerCase().trim();
  document.getElementById('tMap').value=d.map||'Bermuda';
  document.getElementById('tEntryType').value=d.entryType||'paid';
  if(document.getElementById('tCreatorCode')) document.getElementById('tCreatorCode').value=d.creatorCode||'';
  window._resolvedCreatorUid = d.creatorUid || null;
  if(d.creatorCode && d.creatorCode.length > 0) {
    var cfg = document.getElementById('creatorFieldGroup');
    if(cfg) cfg.style.display = '';
    var cs = document.getElementById('creatorCodeStatus');
    if(cs && d.creatorCode) cs.innerHTML = '<span style="color:#00d4ff;font-weight:700">🔵 Creator: '+d.creatorCode+'</span>';
  }
  document.getElementById('tEntryFee').value=d.entryFee||'';
  if(document.getElementById('tPrizeType')) {
    /* ✅ FIX: coin match default was skyDiamond (wrong). Now coin → coin */
    var _editPrize = d.prizeType || (d.entryType==='paid'?'greenDiamond' : 'coin');
    document.getElementById('tPrizeType').value = _editPrize;
    _updatePrizeLabels(_editPrize,
      document.getElementById('prize1Label'),
      document.getElementById('prize2Label'),
      document.getElementById('prize3Label')
    );
  }
  if(document.getElementById('tMinRank')) document.getElementById('tMinRank').value=d.minRank||'';
  if(document.getElementById('tAdsRequired')) document.getElementById('tAdsRequired').value=d.adsRequired||2;
  if(window.onEntryTypeChange) onEntryTypeChange();
  // prizePool auto-calced from prizes
  if(document.getElementById('tPerKill')) document.getElementById('tPerKill').value=d.perKillPrize||'';
  
  document.getElementById('tMaxSlots').value=d.maxSlots||'';
  document.getElementById('tFirstPrize').value=d.firstPrize||'';
  document.getElementById('tSecondPrize').value=d.secondPrize||'';
  document.getElementById('tThirdPrize').value=d.thirdPrize||'';
  
  /* ╔══════════════════════════════════════════════════════════╗
     ║  MATCH TIME FIX — Load EXACT database time as LOCAL     ║
     ║  ══════════════════════════════════════════════════════  ║
     ║  BUG: .toISOString() converts to UTC, but datetime-    ║
     ║  local input expects LOCAL time → time shifts by        ║
     ║  timezone offset → saving "unchanged" time actually     ║
     ║  saves a DIFFERENT time → status recalculates wrongly   ║
     ║                                                         ║
     ║  FIX: Convert timestamp to LOCAL datetime string using  ║
     ║  getFullYear/getMonth/getDate/getHours/getMinutes       ║
     ║  Store original timestamp for precise comparison later  ║
     ╚══════════════════════════════════════════════════════════╝ */
  _editOriginalMatchTime=Number(d.matchTime)||0;
  
  if(d.matchTime){
    var dt=new Date(d.matchTime);
    /* Build LOCAL datetime string: YYYY-MM-DDTHH:MM */
    var yyyy=dt.getFullYear();
    var mm=String(dt.getMonth()+1).padStart(2,'0');
    var dd=String(dt.getDate()).padStart(2,'0');
    var hh=String(dt.getHours()).padStart(2,'0');
    var mi=String(dt.getMinutes()).padStart(2,'0');
    var localStr=yyyy+'-'+mm+'-'+dd+'T'+hh+':'+mi;
    document.getElementById('tMatchTime').value=localStr;
    console.log('📅 Edit Match — Loaded matchTime from DB:');
    console.log('   Database timestamp: '+d.matchTime+' ('+new Date(d.matchTime).toString()+')');
    console.log('   Input field set to: '+localStr+' (LOCAL time, NOT UTC)');
    console.log('   _editOriginalMatchTime saved: '+_editOriginalMatchTime);
  }else{
    document.getElementById('tMatchTime').value='';
    _editOriginalMatchTime=0;
    console.log('📅 Edit Match — No matchTime in database');
  }
  
  document.getElementById('tRoomId').value=d.roomId||'';
  document.getElementById('tRoomPass').value=d.roomPassword||'';
  var rrm = document.getElementById('tRoomReleaseMin');
  if (rrm) rrm.value = d.roomReleaseMinutes || 5;
  // Set special category dropdown
  var sc = d.specialCategory || (d.isSundaySpecial ? 'sunday_special' : d.isMonthlySpecial ? 'monthly_special' : 'none');
  var scEl = document.getElementById('tSpecialCategory');
  if (scEl) scEl.value = sc;
  document.getElementById('tIsSpecial').checked = sc !== 'none';
  
  /* Show current status indicator — uses CALCULATED status, not database */
  var calculatedSt=getAdminMatchStatus(d);
  var dbStatus=d.status||'upcoming';
  var stHint=document.getElementById('currentStatusHint');
  var stText=document.getElementById('currentStatusText');
  if(stHint){stHint.style.display='flex';
  stHint.className='info-box '+getStatusBadgeColor(calculatedSt);}
  
  /* Build detailed status explanation */
  var statusExplain='';
  if(calculatedSt==='upcoming'){
    statusExplain='Match has not started yet. Will become LIVE when match time arrives.';
  }else if(calculatedSt==='live'){
    statusExplain='Match is currently LIVE. Will become COMPLETED 1 hour after start.';
  }else if(calculatedSt==='completed'){
    statusExplain='Match ended. Click "Publish Results" to finalize.';
  }else if(calculatedSt==='resultPublished'){
    statusExplain='Results already published. Cannot change status.';
  }else if(calculatedSt==='cancelled'){
    statusExplain='Match was cancelled. Players were refunded.';
  }
  
  if(stText){stText.innerHTML='<strong>Calculated Status: '+calculatedSt.toUpperCase()+'</strong> <span style="font-size:9px;}opacity:0.6">(DB: '+dbStatus+')</span><br><span style="font-size:10px;opacity:0.8">'+statusExplain+'</span><br><span style="font-size:9px;color:var(--text-muted)">📌 <b>RULE:</b> Editing Room ID/Password/Per Kill does NOT change status. Status ONLY recalculates if you change Match Time. Otherwise it stays as "'+dbStatus+'".</span>';
  }
  onEntryTypeChange();
  document.getElementById('tournamentModal').classList.add('show');
}

/* saveTournament — writes to matches/ 
   ╔══════════════════════════════════════════════╗
   ║  SMART STATUS LOGIC (FINAL v5)              ║
   ║  ─────────────────────────────────────────── ║
   ║  • Status recalculates ONLY if matchTime     ║
   ║    actually CHANGES (old != new)              ║
   ║  • Room ID / Per Kill / other field edits     ║
   ║    do NOT touch status at all                 ║
   ║  • Terminal states (resultPublished/cancelled)║
   ║    are NEVER overwritten                      ║
   ║  • Room ID change auto-sends notification     ║
   ║    to joined players only                     ║
   ╚══════════════════════════════════════════════╝
   
   gameMode/matchType saved as 'solo', 'duo', or 'squad' (lowercase)
*/
async function saveTournament(){
  var saveBtn=document.getElementById('saveTournamentBtn');
  setLoading(saveBtn,true);
  
  var id=document.getElementById('tournamentId').value;
  var nm=document.getElementById('tName').value.trim();
  
  /* FIX: Ensure gameMode is saved correctly as 'solo', 'duo', or 'squad' */
  var gmRaw=document.getElementById('tGameMode').value;
  var gm=gmRaw.toLowerCase().trim();
  if(gm!=='solo'&&gm!=='duo'&&gm!=='squad'){
    gm='solo';
    console.warn('Invalid gameMode "'+gmRaw+'", defaulting to solo');
  }
  // Special category from dropdown
  var specialCat = (document.getElementById('tSpecialCategory') ? document.getElementById('tSpecialCategory').value : 'none');
  var matchType = specialCat !== 'none' ? specialCat : 'normal';
  var sp = specialCat !== 'none';
  console.log('Saving gameMode as: "'+gm+'" (raw input: "'+gmRaw+'")');
  
  var mp=document.getElementById('tMap').value;
  var et=document.getElementById('tEntryType').value;
  var ef=et==='ad'?0:(Number(document.getElementById('tEntryFee').value)||0);
  var adsRequired=et==='ad'?(Number((document.getElementById('tAdsRequired')||{}).value)||2):0;
  var prizeType=(document.getElementById('tPrizeType')||{}).value||(et==='paid'?'greenDiamond':'coin'); /* ✅ coin match → coin prize (not skyDiamond) */
  var minRank=(document.getElementById('tMinRank')||{}).value||'';
  var pk=Number(document.getElementById('tPerKill').value)||0; // per kill prize
  var ms=Number(document.getElementById('tMaxSlots').value)||12;
  var f1=Number(document.getElementById('tFirstPrize').value)||0;
  var f2=Number(document.getElementById('tSecondPrize').value)||0;
  var f3=Number(document.getElementById('tThirdPrize').value)||0;
  var pp=f1+f2+f3; // auto-calc from prizes — must be after f1,f2,f3
  var mts=document.getElementById('tMatchTime').value;
  var ri=document.getElementById('tRoomId').value.trim();
  var rp=document.getElementById('tRoomPass').value.trim();
  var roomReleaseMin = Number((document.getElementById('tRoomReleaseMin')||{}).value)||5;
  var matchSubType = (document.getElementById('tMatchSubType')||{}).value || 'battle_royale';
  var tournamentFormat = (document.getElementById('tTournamentFormat')||{}).value || 'normal';
  // sp already set above from specialCat
  
  /* ===== STRICT VALIDATION ===== */
  if(!nm){
    showToast('❌ Please fill: Match Name',true);
    document.getElementById('tName').focus();
    setLoading(saveBtn,false);return;
  }
  if(!mts){
    showToast('❌ Please fill: Match Time',true);
    document.getElementById('tMatchTime').focus();
    setLoading(saveBtn,false);return;
  }
  if(et!=='paid'&&et!=='coin'&&et!=='ad'){
    showToast('❌ Please select a valid Entry Type',true);
    setLoading(saveBtn,false);return;
  }
  if(et==='paid'&&ef<=0){
    showToast('❌ Entry Fee must be > 0 for paid matches',true);
    document.getElementById('tEntryFee').focus();
    setLoading(saveBtn,false);return;
  }
  if(et==='coin'&&ef<=0){
    showToast('❌ Entry Fee (coins) must be > 0 for coin matches',true);
    document.getElementById('tEntryFee').focus();
    setLoading(saveBtn,false);return;
  }
  /* Room ID/Password no longer required at creation — admin adds via Room Manager */
  if(ms<=0){
    showToast('❌ Please fill: Max Slots (must be > 0)',true);
    document.getElementById('tMaxSlots').focus();
    setLoading(saveBtn,false);return;
  }

  if(f1<0||f2<0||f3<0){
    showToast('❌ Rank prizes cannot be negative',true);
    setLoading(saveBtn,false);return;
  }
  /* FIX Bug#46: Also validate per-kill prize cannot be negative */
  var pkEl=document.getElementById('tPerKill');
  var pkVal=pkEl?Number(pkEl.value)||0:0;
  if(pkVal<0){
    showToast('❌ Per-Kill prize cannot be negative',true);
    if(pkEl)pkEl.focus();
    setLoading(saveBtn,false);return;
  }
  /* FIX Bug#108: Prevent scheduling matches for past dates */
  if(mts){
    var scheduledMs=new Date(mts).getTime();
    if(scheduledMs<Date.now()-60000){ /* 1 minute tolerance */
      showToast('❌ Match time cannot be in the past!',true);
      setLoading(saveBtn,false);return;
    }
  }
  
  console.log('Match validation PASSED — all required fields present');
  console.log('GameMode to save: '+gm+', EntryType: '+et);
  
  var mt=new Date(mts).getTime();
  
  try{
    if(id){
      /* ═══════════════════════════════════════
         EDITING EXISTING MATCH
         ═══════════════════════════════════════ */
      var existingMatch=allTournaments[id]||{};
      /* Use _editOriginalMatchTime for PRECISE comparison
         This is the exact timestamp that was loaded into the input field.
         If admin didn't touch the time field, the parsed value from the
         LOCAL datetime string will match this exactly (no UTC shift).
      */
      var oldMatchTime=_editOriginalMatchTime||Number(existingMatch.matchTime)||0;
      var oldRoomId=existingMatch.roomId||'';
      var oldRoomPass=existingMatch.roomPassword||'';
      var currentDbStatus=existingMatch.status||'upcoming';
      
      /* ── Build update data ── 
         CRITICAL: status field is NOT included here.
         It is only added below IF matchTime actually changed.
      */
      var updateData={
        name:nm,
        gameMode:gm,
        matchType:matchType!=='normal'?matchType:gm,
        specialType:matchType!=='normal'?matchType:null,
        isSundaySpecial:matchType==='sunday_special',
        isMonthlySpecial:matchType==='monthly_special',
        mode:gm,
        map:mp,
        entryType:et,
        entryFee:ef,
        adsRequired:adsRequired||null,
        prizeType:prizeType||null,
        minRank:minRank||null,
        perKillPrize:pk,
        
        maxSlots:ms,
        firstPrize:f1, prize1st:f1,
        secondPrize:f2, prize2nd:f2,
        thirdPrize:f3, prize3rd:f3,
        matchTime:mt,
        roomId:ri,
        roomPassword:rp,
        roomStatus: (ri && rp) ? 'released' : 'pending',
        roomReleaseMinutes: roomReleaseMin,
        isSpecial:sp,
        specialCategory:specialCat,
        matchSubType:matchSubType,
        tournamentFormat:tournamentFormat,
        creatorUid:(window._resolvedCreatorUid||null),
        creatorCode:((document.getElementById('tCreatorCode')||{}).value||'').toUpperCase().trim()||null,
        updatedAt:Date.now()
        /* ⛔ NO status field here — added conditionally below */
      };
      
      /* ── SMART STATUS DECISION ──
         Only recalculate status if matchTime ACTUALLY changed.
         If admin only changed Room ID, Per Kill, Prize, etc → status stays as-is.
      */
      /* ── PRECISE TIME COMPARISON ──
         Compare new parsed time with the EXACT original time that was loaded.
         Using _editOriginalMatchTime ensures no UTC/Local conversion drift.
         
         Allow 60-second tolerance for rounding (datetime-local drops seconds)
      */
      var timeDiff=Math.abs(mt-oldMatchTime);
      var matchTimeChanged=(timeDiff>60000); /* Changed if difference > 1 minute */
      /* Bug#13 Fix: Guard against undefined oldRoomId causing false-positive notifications.
         oldRoomId could be undefined if the match record lacks roomId field (new match).
         Only trigger if BOTH old value exists AND new value is genuinely different. */
      var roomIdChanged=(!!oldRoomId&&ri!==oldRoomId&&ri!=='')||(!!ri&&!oldRoomId);
      var roomPassChanged=(!!oldRoomPass&&rp!==oldRoomPass&&rp!=='')||(!!rp&&!oldRoomPass);
      
      console.log('───── TIME COMPARISON ─────');
      console.log('Old matchTime (DB):    '+oldMatchTime+' → '+new Date(oldMatchTime).toString());
      console.log('New matchTime (input): '+mt+' → '+new Date(mt).toString());
      console.log('Difference:            '+timeDiff+'ms ('+(timeDiff/1000)+'s)');
      console.log('Time actually changed: '+matchTimeChanged+' (threshold: 60s)');
      console.log('───────────────────────────');
      
      if(matchTimeChanged){
        /* matchTime changed → recalculate status from the NEW time */
        var isTerminal=(currentDbStatus==='resultPublished'||currentDbStatus==='cancelled');
        
        if(!isTerminal){
          /* Use getMatchStatus for proper calculation with 1hr duration */
          var calculatedStatus=getMatchStatus(mt).toLowerCase();
          updateData.status=calculatedStatus;
          console.log('⏰ Match Time CHANGED: '+new Date(oldMatchTime).toLocaleString()+' → '+new Date(mt).toLocaleString());
          console.log('📌 Status recalculated to: '+calculatedStatus+' (was: '+currentDbStatus+')');
        }else{
          console.log('⚠️ Match Time changed but status is TERMINAL ('+currentDbStatus+'), NOT updating status');
        }
      }else{
        /* matchTime NOT changed → do NOT touch status at all */
        console.log('⏰ Match Time UNCHANGED (within 60s tolerance) — status will remain: '+currentDbStatus);
        console.log('   (Room ID, Per Kill, or other fields may have changed — status NOT affected)');
        /* Also use the original matchTime to avoid saving a drifted value */
        updateData.matchTime=oldMatchTime;
        console.log('   matchTime in update set to original: '+oldMatchTime);
      }
      
      console.log('═══════════════════════════════');
      console.log('EDIT MATCH: '+nm+' ('+id+')');
      console.log('Fields updated: '+Object.keys(updateData).join(', '));
      console.log('Status in update: '+(updateData.status?'YES → '+updateData.status:'NO → unchanged ('+currentDbStatus+')'));
      console.log('Room ID changed: '+roomIdChanged+', Match Time changed: '+matchTimeChanged);
      console.log('═══════════════════════════════');
      
      /* ── Save to database using .update() (never .set()) ── */
      await rtdb.ref(DB_MATCHES+'/'+id).update(updateData);
      console.log('✅ Match updated in database!');

      /* ✅ Audit Fix: mirror the edit to Supabase matches table too.
         User Panel reads matches from Supabase — without this, admin edits
         (room ID, prizes, time, status, etc.) never reached the app.
         Column names verified against COMPLETE_SCHEMA.sql — 'name' is a
         GENERATED column (derived from 'title'), so it must not be written. */
      if(window._supa){
        var _supaMatchUpd={
          title:nm,mode:gm,map:mp,entry_type:et,entry_fee:ef,
          prize_type:prizeType||null,per_kill_prize:pk,max_slots:ms,
          first_prize:f1,second_prize:f2,third_prize:f3,
          scheduled_at:new Date(updateData.matchTime||mt).toISOString(),
          room_id:ri||null,room_password:rp||null,
          match_sub_type:matchSubType,
          is_special:sp,special_category:specialCat
        };
        if(updateData.status)_supaMatchUpd.status=updateData.status;
        window._supa.from('matches').update(_supaMatchUpd).eq('id',id)
          .catch(function(e){console.warn('[saveTournament] Supabase sync failed:',e.message);});
      }
      
      /* ── AUTO ROOM NOTIFICATION ──
         When Room ID is added or changed, auto-notify all joined players.
         This replaces the old "Update Room Only" button functionality.
      */
      if((roomIdChanged||roomPassChanged)&&ri&&rp){
        console.log('🔔 Room details changed → auto-notifying joined players...');
        
        /* Create global notification entry */
        await rtdb.ref('notifications').push({
          matchId:id,
          matchName:nm,
          title:'🎮 Room Details Released!',
          message:'Room ID: '+ri+' | Pass: '+rp,
          type:'room_released',
          targetUserId:'all',
          createdAt:Date.now()
        });
        
        /* Send private notification to ONLY joined players of this match */
        var jS=await rtdb.ref(DB_JOIN).once('value');
        var notifyCount=0;
        var promises=[];
        
        jS.forEach(function(ch){
          var j=ch.val();
          var tid=j.tournamentId||j.matchId;
          var isJoined=(j.status==='approved'||j.status==='joined'||j.status==='confirmed'||!j.status);
          if(tid===id&&isJoined){
            var uid=getUid(j);
            if(uid){
              notifyCount++;
              promises.push(rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({
                title:'🎮 Room Details!',
                message:'Match: '+nm+'\nRoom ID: '+ri+'\nPassword: '+rp,
                matchId:id,
                roomId:ri,
                roomPassword:rp,
                timestamp:Date.now(),
                read:false,
                type:'room_released'
              }));
              promises.push(rtdb.ref('userMatches/'+uid+'/matches/'+id).update({
                roomId:ri,
                roomPassword:rp,
                roomReleasedAt:Date.now()
              }));
            }
          }
        });
        
        /* Also check matches/{id}/joined for direct joins */
        var matchSnap=await rtdb.ref(DB_MATCHES+'/'+id+'/joined').once('value');
        if(matchSnap.exists()){
          matchSnap.forEach(function(playerSnap){
            var puid=playerSnap.key;
            /* Avoid duplicates */
            var alreadyNotified=false;
            promises.forEach(function(p){/* skip check, duplicates are harmless */});
            notifyCount++;
            promises.push(rtdb.ref(DB_USERS+'/'+puid+'/notifications').push({
              title:'🎮 Room Details!',
              message:'Match: '+nm+'\nRoom ID: '+ri+'\nPassword: '+rp,
              matchId:id,
              roomId:ri,
              roomPassword:rp,
              timestamp:Date.now(),
              read:false,
              type:'room_released'
            }));
          });
        }
        
        await Promise.all(promises);
        console.log('✅ Room notification sent to '+notifyCount+' players');
        showToast('✅ Match updated! Room details sent to '+notifyCount+' players.');
      }else{
        showToast('✅ Match updated successfully!');
      }
      
    }else{
      /* ═══════════════════════════════════════
         CREATING NEW MATCH
         ═══════════════════════════════════════ */
      /* For new matches, calculate initial status from matchTime */
      var initialStatus=getMatchStatus(mt).toLowerCase();
      
      var createData={
        name:nm,
        gameMode:gm,
        matchType:matchType!=='normal'?matchType:gm,
        specialType:matchType!=='normal'?matchType:null,
        isSundaySpecial:matchType==='sunday_special',
        isMonthlySpecial:matchType==='monthly_special',
        mode:gm,
        map:mp,
        entryType:et,
        entryFee:ef,
        adsRequired:adsRequired||null,
        prizeType:prizeType||null,
        minRank:minRank||null,
        perKillPrize:pk,
        
        maxSlots:ms,
        firstPrize:f1, prize1st:f1,
        secondPrize:f2, prize2nd:f2,
        thirdPrize:f3, prize3rd:f3,
        matchTime:mt,
        roomId:ri,
        roomPassword:rp,
        roomStatus: (ri && rp) ? 'released' : 'pending',
        isSpecial:sp,
        specialCategory:specialCat,
        matchSubType:matchSubType,
        tournamentFormat:tournamentFormat,
        roomReleaseMinutes: roomReleaseMin,
        status:initialStatus,
        filledSlots:0,
        createdAt:Date.now()
      };
      
      console.log('═══════════════════════════════');
      console.log('CREATE NEW MATCH: '+nm);
      console.log('GameMode: '+gm+', EntryType: '+et);
      console.log('Initial Status: '+initialStatus+' (calculated from matchTime)');
      console.log('═══════════════════════════════');
      
      var nr=await rtdb.ref(DB_MATCHES).push(createData);
      
      console.log('✅ Match created: '+nr.key);
      showToast('✅ Match created! Status: '+initialStatus);
    }
    
    closeModal('tournamentModal');
    setLoading(saveBtn,false);
    loadTournaments();
  }catch(e){
    console.error('saveTournament error:',e);
    setLoading(saveBtn,false);
    showToast('Error: '+e.message,true);
  }
}

/* sendRoomNotificationToMatch — Utility function to send room notification to all joined players
   Called internally when Room ID is updated via saveTournament()
   Can also be called directly if needed
*/
async function sendRoomNotificationToMatch(matchId, roomId, roomPassword, matchName){
  if(!matchId||!roomId||!roomPassword){
    console.error('sendRoomNotificationToMatch: matchId, roomId, roomPassword required');
    return 0;
  }
  
  try{
    /* Create global notification entry in notifications/ node */
    var globalNotifRef=rtdb.ref('notifications').push();
    await globalNotifRef.set({
      matchId:matchId,
      matchName:matchName||'Match',
      title:'🎮 Room Details Released!',
      message:'Room ID: '+roomId+' | Pass: '+roomPassword,
      type:'room_released',
      createdAt:Date.now()
    });
    console.log('Created notification entry in notifications/');
    
    /* Send private notification to ONLY joined players of this specific match */
    var jS=await rtdb.ref(DB_JOIN).once('value');
    var notifyCount=0;
    var promises=[];
    
    jS.forEach(function(ch){
      var j=ch.val();
      var tid=j.tournamentId||j.matchId;
      var isJoined=(j.status==='approved'||j.status==='joined'||j.status==='confirmed'||!j.status);
      if(tid===matchId&&isJoined){
        var uid=getUid(j);
        if(uid){
          notifyCount++;
          promises.push(rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({
            title:'🎮 Room Details!',
            message:'Match: '+(matchName||'Match')+'\nRoom ID: '+roomId+'\nPassword: '+roomPassword,
            matchId:matchId,
            roomId:roomId,
            roomPassword:roomPassword,
            timestamp:Date.now(),
            read:false,
            type:'room_released'
          }));
          promises.push(rtdb.ref('userMatches/'+uid+'/matches/'+matchId).update({
            roomId:roomId,
            roomPassword:roomPassword,
            roomReleasedAt:Date.now()
          }));
        }
      }
    });
    
    await Promise.all(promises);
    console.log('Room notification sent to '+notifyCount+' joined players of match: '+matchId);
    return notifyCount;
  }catch(e){
    console.error('sendRoomNotificationToMatch error:',e);
    return 0;
  }
}

/* cancelTournament — auto-refund ALL joined players
   Checks BOTH joinRequests/ AND matches/{id}/joined/ for players
   Refunds to deposit balance (paid) or coins (coin matches)
*/
async function cancelTournament(id){
  if(!confirm('Cancel & refund ALL joined players?\n\nThis will:\n• Set status to "cancelled"\n• Refund entry fee to ALL joined players\n• Send notification to each player'))return;
  try{
    var t=allTournaments[id];
    var entryFee=t?Number(t.entryFee)||0:0;
    var matchName=t?t.name:'Match';
    var isC=t&&t.entryType==='coin';
    var pr=[];
    var rc=0;
    var refundedUids={};  /* Track to avoid double refunds */
    
    /* ── Check joinRequests/ node ── */
    var jS=await rtdb.ref(DB_JOIN).once('value');
    jS.forEach(function(c){
      var j=c.val(),tid=j.tournamentId||j.matchId;
      var isJoined=(j.status==='approved'||j.status==='joined'||j.status==='confirmed'||!j.status);
      if(tid===id&&isJoined){
        var uid=getUid(j);
        var fee=Number(j.entryFee)||entryFee;
        /* ✅ Bug 8 Fix: isC from joinRequest's own entryType (not just match entryType) */
        var jIsC = j.entryType === 'coin' || j.entryType === 'coins' || isC;
        var supaCol = jIsC ? 'coins' : 'sky_diamonds';
        if(uid&&fee&&!refundedUids[uid]){
          rc++;
          refundedUids[uid]=true;
          /* Firebase RTDB update (admin-supabase-sync.js will also sync) */
          var rp1=jIsC?'coins':'realMoney/deposited',rp2=jIsC?null:'wallet/depositBalance';
          pr.push(rtdb.ref(DB_USERS+'/'+uid+'/'+rp1).transaction(function(v){return(v||0)+fee}));
          if(rp2)pr.push(rtdb.ref(DB_USERS+'/'+uid+'/'+rp2).transaction(function(v){return(v||0)+fee}));
          pr.push(rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:'refund',amount:fee,description:'Cancelled: '+matchName,timestamp:Date.now()}));
          pr.push(rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'Match Cancelled 🚫',message:matchName+' cancelled. '+(jIsC?fee+' coins':'💎'+fee)+' refunded.',timestamp:Date.now(),read:false}));
          /* ✅ Supabase sync — correct column per currency */
          if(window._supa){
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:supaCol,p_amount:fee}).catch(function(){});
            window._supa.from('wallet_transactions').insert({user_id:uid,currency:supaCol,txn_type:'credit',amount:fee,reason:'match_refund',ref_id:id}).catch(function(){});
            window._supa.from('join_requests').update({status:'refunded'}).eq('id',c.key).catch(function(){});
          }
        }
        pr.push(rtdb.ref(DB_JOIN+'/'+c.key).update({status:'refunded'}));
      }
    });
    
    /* ── Also check matches/{id}/joined/ node for direct joins ── */
    var mJoined=await rtdb.ref(DB_MATCHES+'/'+id+'/joined').once('value');
    if(mJoined.exists()){
      mJoined.forEach(function(ps){
        var puid=ps.key;
        var pdata=ps.val();
        var fee=Number(pdata.entryFee)||entryFee;
        var pIsC = pdata.entryType === 'coin' || pdata.entryType === 'coins' || isC;
        var pSupaCol = pIsC ? 'coins' : 'sky_diamonds';
        if(!refundedUids[puid]&&fee){
          rc++;
          refundedUids[puid]=true;
          var rp1=pIsC?'coins':'realMoney/deposited',rp2=pIsC?null:'wallet/depositBalance';
          pr.push(rtdb.ref(DB_USERS+'/'+puid+'/'+rp1).transaction(function(v){return(v||0)+fee}));
          if(rp2)pr.push(rtdb.ref(DB_USERS+'/'+puid+'/'+rp2).transaction(function(v){return(v||0)+fee}));
          pr.push(rtdb.ref(DB_USERS+'/'+puid+'/transactions').push({type:'refund',amount:fee,description:'Cancelled: '+matchName,timestamp:Date.now()}));
          pr.push(rtdb.ref(DB_USERS+'/'+puid+'/notifications').push({title:'Match Cancelled 🚫',message:matchName+' cancelled. '+(pIsC?fee+' coins':'💎'+fee)+' refunded.',timestamp:Date.now(),read:false}));
          if(window._supa){
            window._supa.rpc('increment_balance',{p_uid:puid,p_col:pSupaCol,p_amount:fee}).catch(function(){});
            window._supa.from('wallet_transactions').insert({user_id:puid,currency:pSupaCol,txn_type:'credit',amount:fee,reason:'match_refund',ref_id:id}).catch(function(){});
          }
        }
      });
    }
    
    /* ── Set match status to cancelled ── */
    pr.push(rtdb.ref(DB_MATCHES+'/'+id).update({status:'cancelled',cancelledAt:Date.now(),cancelledBy:auth.currentUser.uid}));
    
    await Promise.all(pr);
    console.log('✅ Match cancelled: '+matchName+' — '+rc+' players refunded');
    showToast('✅ Cancelled — '+rc+' players refunded');
    loadTournaments();
  }catch(e){
    console.error('cancelTournament error:',e);
    showToast('Error: '+e.message,true);
  }
}
async function deleteTournament(id){
  /* Base implementation — security-patches.js overrides this with refund logic */
  if(!confirm('⚠️ Match delete karna hai? Joined players ko refund check kiya jayega.'))return;
  try{
    var DB_J=window.DB_JOIN||'joinRequests';
    /* Cancel all join requests first */
    var snap=await rtdb.ref(DB_J).orderByChild('matchId').equalTo(id).once('value');
    if(snap.exists()){
      var updates={};
      snap.forEach(function(c){updates[DB_J+'/'+c.key+'/status']='cancelled';});
      await rtdb.ref().update(updates);
    }
    await rtdb.ref(DB_MATCHES+'/'+id).remove();
    showToast('Deleted');loadTournaments();
  }catch(e){showToast('Error: '+e.message,true);}
}
/* syncTournamentStatuses — Auto-update DATABASE status based on time
   Uses the same 1-hour duration logic as getMatchStatus()
   
   ╔══════════════════════════════════════════════╗
   ║  AUTO-STATUS SYNC (runs every 30 seconds)   ║
   ║  ─────────────────────────────────────────── ║
   ║  upcoming → live:  now >= matchTime          ║
   ║  live → completed: now >= matchTime + 1 hour ║
   ║  ─────────────────────────────────────────── ║
   ║  NEVER auto-updates:                         ║
   ║  • resultPublished (admin published results) ║
   ║  • cancelled (admin cancelled match)         ║
   ╚══════════════════════════════════════════════╝
*/
async function syncTournamentStatuses(){
  try{
    var s=await rtdb.ref(DB_MATCHES).once('value');
    var now=Date.now();
    var updateCount=0;
    var logLines=[];
    
    s.forEach(function(c){
      var d=c.val(),id=c.key;
      var mt=Number(d.matchTime)||0;
      if(!mt)return;
      
      /* ⛔ Skip terminal states — these are admin-controlled, NEVER auto-change */
      if(d.status==='resultPublished'||d.status==='cancelled')return;
      
      /* Calculate what the status SHOULD be based on time using getMatchStatus */
      var calculatedStatus=getMatchStatus(mt).toLowerCase();
      var currentDbStatus=(d.status||'upcoming').toLowerCase();
      
      /* Only update database if the calculated status differs from current */
      if(calculatedStatus!==currentDbStatus){
        updateCount++;
        rtdb.ref(DB_MATCHES+'/'+id).update({status:calculatedStatus});
        logLines.push('  → '+d.name+': '+currentDbStatus+' → '+calculatedStatus);
      }
    });
    
    if(updateCount>0){
      console.log('⏱️ syncTournamentStatuses: Updated '+updateCount+' matches:');
      logLines.forEach(function(l){console.log(l);});
      /* Refresh UI after status changes */
      loadTournaments();
    }
  }catch(e){
    console.error('syncTournamentStatuses error:',e);
  }
}

/* =============================================
   JOINED PLAYERS — FIXED: Properly fetches from joinRequests/
   Shows Player IGN, UID, FF UID, Teammates with IGN+UID
   ============================================= */
async function refreshJoinedPlayers(){
  showToast('Refreshing joined players...');
  try{
    /* Reload join requests from Firebase joinRequests node */
    var jS=await rtdb.ref(DB_JOIN).once('value');
    allJoinRequests={};
    jS.forEach(function(c){
      allJoinRequests[c.key]=c.val();
    });
    
    /* Also check matches/{matchId}/joined for direct joins */
    var mS=await rtdb.ref(DB_MATCHES).once('value');
    mS.forEach(function(mc){
      var m=mc.val(),mid=mc.key;
      if(m.joined&&typeof m.joined==='object'){
        Object.keys(m.joined).forEach(function(uid){
          var jData=m.joined[uid];
          /* Create a synthetic join request entry */
          var syntheticKey='joined_'+mid+'_'+uid;
          if(!allJoinRequests[syntheticKey]){
            allJoinRequests[syntheticKey]={
              matchId:mid,
              tournamentId:mid,
              uid:uid,
              oderId:uid,
              playerName:jData.playerName||jData.ign||getUserName(uid),
              ign:jData.ign||jData.playerName,
              ffUid:jData.ffUid||jData.gameUid||'',
              entryFee:jData.entryFee||m.entryFee||0,
              status:'approved',
              joinedAt:jData.joinedAt||jData.timestamp||Date.now(),
              teammates:jData.teammates||[],
              source:'matches_joined_node'
            };
            console.log('Found direct join: '+uid+' in matches/'+mid+'/joined');
          }
        });
      }
    });
    
    loadJoinedPlayers();
    showToast('Joined players refreshed!');
  }catch(e){
    console.error('refreshJoinedPlayers error:',e);
    showToast('Error: '+e.message,true);
  }
}

async function loadJoinedPlayers(){
  var f=document.getElementById('joinedTournamentFilter').value;
  var tb=document.getElementById('joinedPlayersTable');
  tb.innerHTML='<tr><td colspan="8" class="text-muted text-xs" style="text-align:center;padding:14px"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';
  var c=0;
  var keys=Object.keys(allJoinRequests);

  if(keys.length===0){
    tb.innerHTML='<tr><td colspan="8" class="text-muted text-xs" style="text-align:center;padding:20px">No players joined yet.</td></tr>';
    document.getElementById('joinedCount').textContent=0;
    return;
  }

  var rowsData=[];
  keys.forEach(function(k){
    var j=allJoinRequests[k];
    var isJoined=(j.status==='approved'||j.status==='joined'||j.status==='confirmed'||!j.status);
    if(!isJoined)return;
    var tid=j.tournamentId||j.matchId;
    if(f!=='all'&&tid!==f)return;
    c++;
    var match=allTournaments[tid];
    var tn=match?match.name:'Unknown Match';
    var gameMode=match?(match.gameMode||match.matchType||'solo').toLowerCase():'solo';
    var mode=gameMode.toUpperCase();
    var modeBadgeColor=gameMode==='squad'?'purple':gameMode==='duo'?'cyan':'blue';
    var dt=(j.joinedAt||j.createdAt)?new Date(j.joinedAt||j.createdAt).toLocaleString('en-IN'):'N/A';
    var uid=getUid(j)||j.oderId||'';
    var nm=j.playerName||j.ign||j.userName||getUserName(uid)||'Player';
    var ffUid=j.ffUid||j.userFFUID||j.gameUid||j.playerFfUid||'N/A';
    var reqKey=k;
    rowsData.push({uid:uid,nm:nm,ffUid:ffUid,tn:tn,mode:mode,modeBadgeColor:modeBadgeColor,gameMode:gameMode,dt:dt,j:j,entryFee:j.entryFee||0,tid:tid,reqKey:reqKey,phone:'',verified:j.adminVerified||false});
  });

  /* Batch fetch phone numbers from users table */
  var allUids=[...new Set(rowsData.map(function(r){return r.uid;}).filter(Boolean))];
  if(allUids.length>0){
    try{
      await Promise.all(allUids.map(function(uid){
        return rtdb.ref(DB_USERS+'/'+uid+'/phone').once('value').then(function(s){
          var ph=s.val()||'';
          rowsData.forEach(function(r){if(r.uid===uid)r.phone=ph;});
        });
      }));
    }catch(e){console.log('phone fetch error:',e);}
  }

  /* Batch fetch FF UIDs if missing */
  var missingFf=rowsData.filter(function(r){return !r.ffUid||r.ffUid==='N/A';}).map(function(r){return r.uid;});
  if(missingFf.length>0){
    try{
      await Promise.all(missingFf.map(function(uid){
        return rtdb.ref(DB_USERS+'/'+uid+'/ffUid').once('value').then(function(s){
          var ff=s.val()||'N/A';
          rowsData.forEach(function(r){if(r.uid===uid)r.ffUid=ff;});
        });
      }));
    }catch(e){}
  }

  tb.innerHTML='';
  var rendered={};
  var isFiltered=(f!=='all');

  /* Helper: Slot badge */
  function _slotBadge(slot) {
    /* Bug#31 Fix: Show "Solo" instead of "—" for players with no slot number */
    if (!slot) return '<span style="font-size:10px;color:rgba(255,255,255,.3);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:2px 8px">Solo</span>';
    /* Bug#1 Fix: escape slot value before inserting into HTML */
    var _safeSlot=String(slot).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return '<span style="background:linear-gradient(135deg,rgba(0,212,255,.2),rgba(185,100,255,.2));border:1.5px solid rgba(0,212,255,.5);color:#00d4ff;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800;font-family:monospace;display:inline-block">' + _safeSlot + '</span>';
  }

  /* Helper: In Room badge */
  function _inRoomBadge(inRoom, inRoomAt) {
    if (inRoom) {
      var t = inRoomAt ? new Date(inRoomAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';
      return '<div style="display:inline-flex;flex-direction:column;align-items:center;gap:2px">' +
        '<span style="background:rgba(0,255,156,.15);border:1.5px solid #00ff9c;color:#00ff9c;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;white-space:nowrap"><i class="fas fa-gamepad" style="margin-right:3px"></i>In Room</span>' +
        (t ? '<span style="font-size:8px;color:rgba(0,255,156,.6)">' + t + '</span>' : '') +
      '</div>';
    }
    return '<span style="background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.3);border-radius:20px;padding:3px 10px;font-size:10px;font-weight:600;white-space:nowrap">Pending</span>';
  }

  /* Helper: verify checkbox */
  function _verifyChk(reqKey,verified){
    var chkId='vchk_'+reqKey;
    return '<td style="text-align:center;vertical-align:middle">'+
      '<div class="verify-chk-wrap" id="vwrap_'+reqKey+'" onclick="toggleVerify(\''+reqKey+'\',this)" title="Click to verify player in room" style="'+
        'width:36px;height:36px;border-radius:8px;border:2px solid '+(verified?'#00ff9c':'rgba(255,255,255,.2)')+';'+
        'background:'+(verified?'rgba(0,255,156,.12)':'rgba(255,255,255,.04)')+';'+
        'display:flex;align-items:center;justify-content:center;cursor:pointer;margin:auto;transition:all .2s">'+
        '<i class="fas fa-check" style="font-size:16px;color:'+(verified?'#00ff9c':'rgba(255,255,255,.2)')+'"></i>'+
      '</div></td>';
  }

  /* Helper: solo row */
  function _renderSoloRow(r){
    var j=r.j;
    var sb=j.resultStatus==='completed'?'<span class="badge blue">Done</span>':'<span class="badge green">Joined</span>';
    return '<tr data-uid="'+r.uid+'" data-mid="'+r.tid+'">'+
      /* Col 1: Player Name */
      '<td style="min-width:140px">'+
        '<span class="badge primary" style="font-size:11px;font-weight:700;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block" title="'+r.nm+'">'+r.nm+'</span>'+
      '</td>'+
      /* Col 2: Slot */
      '<td style="text-align:center;min-width:70px">'+_slotBadge(r.j.slotNumber)+'</td>'+
      /* Col 3: FF UID */
      '<td style="min-width:110px">'+
        '<span class="font-mono" style="font-size:11px;color:var(--info);background:rgba(0,212,255,.1);padding:2px 7px;border-radius:4px;display:inline-block">'+(r.ffUid&&r.ffUid!=='N/A'?r.ffUid:'—')+'</span>'+
      '</td>'+
      /* Col 3: Phone */
      '<td style="min-width:100px">'+
        '<span style="font-size:11px;color:var(--text-muted);font-family:monospace">'+(r.phone||'—')+'</span>'+
      '</td>'+
      /* Col 4: Match */
      '<td style="min-width:120px"><span class="text-xs">'+r.tn+'</span></td>'+
      /* Col 5: Mode */
      '<td><span class="badge '+r.modeBadgeColor+'">'+r.mode+'</span></td>'+
      /* Col 6: Entry */
      '<td><span style="font-weight:700">₹'+r.entryFee+'</span></td>'+
      /* Col 7: Joined At */
      '<td class="text-xxs" style="min-width:130px">'+r.dt+'</td>'+
      /* Col 8: Status */
      '<td>'+sb+'</td>'+
      /* Col 9: In Room */
      '<td style="text-align:center">'+_inRoomBadge(r.j.inRoom, r.j.inRoomAt)+'</td>'+
      /* Col 10: Verify */
      _verifyChk(r.reqKey,r.verified)+
    '</tr>';
  }

  /* Helper: team member mini-row inside glow box */
  function _teamMemberRow(m,isCap){
    var roleBadge=isCap
      ?'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(0,212,255,.15);color:#00d4ff;font-weight:700">&#128081; Cap</span>'
      :'<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(255,215,0,.12);color:#ffd700;font-weight:700">Member</span>';
    var ffStr=(m.ffUid&&m.ffUid!=='N/A')?m.ffUid:'—';
    var phStr=m.phone||'—';
    var sb=m.j.resultStatus==='completed'?'<span class="badge blue" style="font-size:9px">Done</span>':'<span class="badge green" style="font-size:9px">Joined</span>';
    return '<div style="display:grid;grid-template-columns:130px 65px 120px 100px 110px 55px 45px 130px 65px 80px 44px;align-items:center;gap:6px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:4px">'+
      /* Col 1: Name + role */
      '<div style="min-width:0">'+
        '<div style="display:flex;flex-direction:column;gap:3px">'+
          '<span class="badge primary" style="font-size:11px;font-weight:700;max-width:125px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+m.nm+'">'+m.nm+'</span>'+
          roleBadge+
        '</div>'+
      '</div>'+
      /* Col 2: Slot */
      '<div style="display:flex;justify-content:center">'+_slotBadge(m.j.slotNumber)+'</div>'+
      /* Col 3: FF UID */
      '<div>'+
        '<span class="font-mono" style="font-size:10px;color:var(--info);background:rgba(0,212,255,.1);padding:2px 6px;border-radius:4px;display:inline-block">'+ffStr+'</span>'+
      '</div>'+
      /* Col 3: Phone */
      '<div>'+
        '<span style="font-size:10px;color:var(--text-muted);font-family:monospace">'+phStr+'</span>'+
      '</div>'+
      /* Col 4: Match */
      '<div>'+
        '<span class="text-xs" style="color:var(--text-muted)">'+m.tn+'</span>'+
      '</div>'+
      /* Col 5: Mode */
      '<div>'+
        '<span class="badge '+m.modeBadgeColor+'" style="font-size:9px">'+m.mode+'</span>'+
      '</div>'+
      /* Col 6: Entry */
      '<div>'+
        '<span style="font-size:11px;font-weight:700">₹'+m.entryFee+'</span>'+
      '</div>'+
      /* Col 7: Joined At */
      '<div>'+
        '<span class="text-xxs" style="color:var(--text-muted)">'+m.dt+'</span>'+
      '</div>'+
      /* Col 8: Status */
      '<div>'+sb+'</div>'+
      /* Col 9: In Room */
      '<div style="display:flex;justify-content:center">'+_inRoomBadge(m.j.inRoom, m.j.inRoomAt)+'</div>'+
      /* Col 10: Verify */
      '<div style="display:flex;justify-content:center">'+
        '<div data-rk="'+m.reqKey+'" onclick="toggleVerify(this.dataset.rk,this)" class="tm-vchk" style="width:36px;height:36px;border-radius:8px;border:2px solid '+(m.verified?'#00ff9c':'rgba(255,255,255,.2)')+';background:'+(m.verified?'rgba(0,255,156,.12)':'rgba(255,255,255,.04)')+';display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s">'+
          '<i class="fas fa-check" style="font-size:15px;color:'+(m.verified?'#00ff9c':'rgba(255,255,255,.2)')+'"></i>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  /* Render all rows */
  rowsData.forEach(function(r){
    var mid=r.tid;
    var mode=r.gameMode;
    var rkey=r.uid+mid;
    if(rendered[rkey])return;

    if(mode==='solo'){
      rendered[rkey]=true;
      tb.innerHTML+=_renderSoloRow(r);
      return;
    }

    // Duo/Squad: find teammates in same match
    var teamMates=[];
    rowsData.forEach(function(other){
      if(other===r)return;
      var omid=other.tid;
      if(omid!==mid)return;
      // Group: same captain (either both have same captainUid, or one is captain of the other)
      var rCap = r.j.captainUid;
      var oCap = other.j.captainUid;
      var isMate = false;
      if (rCap && oCap && rCap === oCap) isMate = true;          // same captain
      else if (rCap === other.uid) isMate = true;                  // r's captain is the other
      else if (oCap === r.uid) isMate = true;                      // other's captain is r
      if(isMate)teamMates.push(other);
    });

    var allTeam=[r].concat(teamMates);
    allTeam.forEach(function(m){rendered[m.uid+mid]=true;});

    var teamColor=mode==='squad'?'#b964ff':'#00d4ff';
    var glowShadow=mode==='squad'?'0 0 12px rgba(185,100,255,.25)':'0 0 12px rgba(0,212,255,.25)';
    var teamSb=r.j.resultStatus==='completed'?'<span class="badge blue">Done</span>':'<span class="badge green">Joined</span>';

    var memberRows=allTeam.map(function(m,i){
      var isCap=(i===0&&!m.j.isTeamMember)||m.j.captainUid===undefined;
      return _teamMemberRow(m,isCap);
    }).join('');

    tb.innerHTML+='<tr>'+
      '<td colspan="11" style="padding:6px 10px">'+
        '<div style="border:1px solid '+teamColor+'55;border-radius:10px;padding:10px;background:'+teamColor+'06;box-shadow:'+glowShadow+'">'+
          '<div style="font-size:10px;color:'+teamColor+';font-weight:700;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">'+
            '<span><i class="fas fa-users" style="margin-right:5px"></i>'+mode.toUpperCase()+' Team · '+r.tn+'</span>'+
            '<span style="display:flex;gap:6px;align-items:center">'+
              '<span class="badge '+r.modeBadgeColor+'">'+r.mode+'</span>'+
              teamSb+
              '<span class="text-xxs text-muted">'+r.dt+'</span>'+
              '<span class="text-xxs" style="background:rgba(255,255,255,.06);padding:1px 8px;border-radius:8px">₹'+r.entryFee+'</span>'+
            '</span>'+
          '</div>'+
          '<div style="display:grid;grid-template-columns:130px 65px 120px 100px 110px 55px 45px 130px 65px 80px 44px;gap:6px;padding:4px 10px 8px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:6px">'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">PLAYER</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35);text-align:center">SLOT</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">FF UID</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">PHONE</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">MATCH</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">MODE</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">ENTRY</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">JOINED AT</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35)">STATUS</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35);text-align:center">IN ROOM</div>'+
            '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35);text-align:center">VERIFY</div>'+
          '</div>'+
          memberRows+
        '</div>'+
      '</td>'+
    '</tr>';
  });

  if(tb.innerHTML===''){
    tb.innerHTML='<tr><td colspan="8" class="text-muted text-xs" style="text-align:center;padding:20px">No players found.</td></tr>';
  }
  document.getElementById('joinedCount').textContent=c;
}


var resultScreenshots = [];

function addResultScreenshots(inp) {
  var files = inp.files; if (!files || !files.length) return;
  var grid = document.getElementById('screenshotPreviewGrid');
  var count = document.getElementById('screenshotCount');
  Array.from(files).forEach(function(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      resultScreenshots.push(e.target.result);
      if (!resultScreenshotBase64) resultScreenshotBase64 = e.target.result;
      if (grid) {
        var idx2 = resultScreenshots.length - 1;
        var div2 = document.createElement('div');
        div2.style.cssText = 'position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.1)';
        div2.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover">'
          + '<button onclick="removeScreenshot(' + idx2 + ')" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:#ff4444;color:#fff;border:none;font-size:10px;cursor:pointer;line-height:1">×</button>';
        grid.appendChild(div2);
      }
      if (count) count.textContent = resultScreenshots.length + ' selected';
    };
    reader.readAsDataURL(file);
  });
  inp.value = '';
}

function removeScreenshot(idx3) {
  resultScreenshots.splice(idx3, 1);
  if (resultScreenshots.length === 0) resultScreenshotBase64 = '';
  else resultScreenshotBase64 = resultScreenshots[0];
  var grid = document.getElementById('screenshotPreviewGrid');
  var count = document.getElementById('screenshotCount');
  if (grid) { var divs = Array.from(grid.children); if (divs[idx3]) grid.removeChild(divs[idx3]); }
  if (count) count.textContent = resultScreenshots.length + ' selected';
}

function previewResultScreenshot(inp){
  addResultScreenshots(inp);
}

async function loadParticipants(){
  var mid=document.getElementById('resultTournamentSelect').value,ct=document.getElementById('resultsContainer'),ls=document.getElementById('participantsList');
  if(!mid){ct.style.display='none';return;}
  ct.style.display='block';
  ls.innerHTML='<tr><td colspan="11" class="text-muted text-xs" style="padding:12px;text-align:center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';
  try{
    /* Always fetch fresh from Firebase — allTournaments cache might miss perKillPrize */
    var _freshSnap = await rtdb.ref('matches/'+mid).once('value');
    if (_freshSnap.exists()) {
      currentTournamentData = _freshSnap.val();
      currentTournamentData._id = mid;
      /* Also update allTournaments cache */
      allTournaments[mid] = currentTournamentData;
    } else {
      currentTournamentData = allTournaments[mid] || {};
    }
    var t=currentTournamentData;
    ls.setAttribute('data-pk', Number(t.perKillPrize)||0);
    ls.setAttribute('data-f1', Number(t.firstPrize)||0);
    ls.setAttribute('data-f2', Number(t.secondPrize)||0);
    ls.setAttribute('data-f3', Number(t.thirdPrize)||0);
    /* Set _MRD right here — this is the latest fresh data */
    window._MRD = {f1:Number(t.firstPrize)||0, f2:Number(t.secondPrize)||0, f3:Number(t.thirdPrize)||0, pk:Number(t.perKillPrize)||0};
    /* Show per kill info too */
    var _pk=Number(t.perKillPrize)||0, _f1=Number(t.firstPrize)||0, _f2=Number(t.secondPrize)||0, _f3=Number(t.thirdPrize)||0;
    var pkInfo = _pk ? ' | <span style="color:#ff9c00">💀 Per Kill: ₹'+_pk+'</span>' : '';
    document.getElementById('resultTournamentInfo').innerHTML='<div class="flex justify-between mb-1"><span class="text-dim">1st/2nd/3rd:</span><strong>₹'+_f1+' / ₹'+_f2+' / ₹'+_f3+'</strong>'+pkInfo+'</div>';
    
    // Load existing results (if already published) to pre-fill rank/kills
    var existingResults = {};
    var _resSnap = await rtdb.ref('results').orderByChild('matchId').equalTo(mid).once('value');
    if (_resSnap.exists()) {
      _resSnap.forEach(function(c){ var d=c.val(); if(d && d.userId) existingResults[d.userId] = d; });
    }
    
    var jS=await rtdb.ref(DB_JOIN).once('value');var html='',pc=0;
    jS.forEach(function(c){
      var j=c.val(),tid=j.tournamentId||j.matchId;
      if(tid===mid&&(j.status==='approved'||j.status==='joined'||j.status==='confirmed'||!j.status)){pc++;
        var uid=getUid(j);
        var nm=j.playerName||j.ign||j.userName||getUserName(uid)||'Unknown';
        var ff=j.ffUid||j.userFFUID||j.gameUid||j.playerFfUid||'-';
        var slot=j.slotNumber||j.slot||'-';
        var phone=j.phone||j.userPhone||'-';
        var mode=(j.mode||t&&t.mode||'solo').toUpperCase();
        var entry=j.entryFee||t&&t.entryFee||0;
        var joinedAt=j.createdAt||j.timestamp||j.joinedAt||0;
        var joinedStr=joinedAt ? new Date(joinedAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}) : '-';
        var jFeeType = j.feeType || 'captain_pays';
        var jCaptainUid = j.captainUid || '';
        var jIsTeamMember = j.isTeamMember ? '1' : '0';
        
        // Pre-fill rank/kills if result already exists
        var er = existingResults[uid] || {};
        var preRank = er.rank || 0;
        var preKills = er.kills || 0;
        var preRp = er.winnings || 0;
        
        // Show badge if this player's winnings go to captain (captain_pays + isTeamMember)
        var feeNote = (jFeeType==='captain_pays' && jIsTeamMember==='1') 
          ? '<span style="font-size:9px;background:rgba(0,212,255,.12);color:#00d4ff;padding:1px 5px;border-radius:4px;margin-left:4px">Cap Paid</span>'
          : (jFeeType==='each_pays' ? '<span style="font-size:9px;background:rgba(0,255,156,.1);color:#00ff9c;padding:1px 5px;border-radius:4px;margin-left:4px">Self Paid</span>' : '');
        
        html += '<tr data-uid="'+uid+'" data-reqid="'+c.key+'" data-name="'+nm.toLowerCase()+'" data-feetype="'+jFeeType+'" data-captainuid="'+jCaptainUid+'" data-isteam="'+jIsTeamMember+'">'
          +'<td style="color:#666;font-size:11px;padding:5px 4px">'+pc+'</td>'
          +'<td style="padding:5px 4px"><div style="font-size:12px;font-weight:700;color:var(--primary)">'+nm+feeNote+'</div></td>'
          +'<td style="padding:5px 4px;color:#00d4ff;font-family:monospace;font-size:10px">'+ff+'</td>'
          +'<td style="padding:5px 4px;color:#aaa;font-size:11px">'+slot+'</td>'
          +'<td style="padding:5px 4px;color:#aaa;font-size:11px">'+phone+'</td>'
          +'<td style="padding:5px 4px;color:#aaa;font-size:10px;font-weight:700">'+mode+'</td>'
          +'<td style="padding:5px 4px;color:#ffd700;font-size:11px">&#8377;'+entry+'</td>'
          +'<td style="padding:5px 4px;color:#aaa;font-size:10px">'+joinedStr+'</td>'
          +'<td style="padding:5px 4px"><input type="number" class="rank-input" placeholder="0" min="0" value="'+preRank+'" style="width:44px;padding:4px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);color:var(--text);font-size:12px;text-align:center;font-weight:700" oninput="calcPrize(this)"></td>'
          +'<td style="padding:5px 4px"><input type="number" class="kills-input" placeholder="0" min="0" value="'+preKills+'" style="width:44px;padding:4px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);color:var(--text);font-size:12px;text-align:center;font-weight:700" oninput="calcPrize(this)"></td>'
          +'<td class="prize-cell" style="padding:5px 4px;font-weight:800;color:'+(preRp>0?'var(--primary)':'#aaa')+';font-size:11px">&#8377;'+preRp+'</td>'
          +'</tr>';
      }
    });
    ls.innerHTML=html||'<tr><td colspan="11" class="text-muted text-xs" style="padding:16px;text-align:center">No participants found for this match</td></tr>';
    /* Auto-recalculate prize preview for all pre-filled rows */
    setTimeout(function(){
      ls.querySelectorAll('tr').forEach(function(row){
        var ki=row.querySelector('.kills-input');
        if(ki) calcPrize(ki);
      });
    }, 50);
  }catch(e){
    ls.innerHTML='<tr><td colspan="11" class="text-danger text-xs" style="padding:12px;text-align:center">Error: '+e.message+'</td></tr>';
    console.error('loadParticipants error:', e);
  }
}
function calcPrize(inp){
  var row = inp.closest('tr');
  var k = Number(row.querySelector('.kills-input').value)||0;
  var r = Number(row.querySelector('.rank-input').value)||0;
  /* Read prize data from tbody data attributes — bulletproof, no global dependency */
  var tb = document.getElementById('participantsList');
  var f1 = tb ? Number(tb.dataset.f1)||0 : 0;
  var f2 = tb ? Number(tb.dataset.f2)||0 : 0;
  var f3 = tb ? Number(tb.dataset.f3)||0 : 0;
  var pk = tb ? Number(tb.dataset.pk)||0 : 0;
  /* Fallback chain */
  if(!f1 && !f2 && !f3){
    f1=window._cF1||0; f2=window._cF2||0; f3=window._cF3||0; pk=window._cPK||0;
  }
  if(!f1 && !f2 && !f3 && window.currentTournamentData){
    var _t=window.currentTournamentData;
    f1=Number(_t.firstPrize)||0; f2=Number(_t.secondPrize)||0; f3=Number(_t.thirdPrize)||0; pk=Number(_t.perKillPrize)||0;
  }

  /* AUTO-FILL TEAM rank */
  var isRankInput = inp.classList.contains('rank-input');
  if(isRankInput && r > 0){
    var captUid = row.dataset.captainuid || '';
    var isTeam = row.dataset.isteam === '1';
    var thisUid = row.dataset.uid || '';
    var allRows = document.querySelectorAll('#participantsList tr');
    allRows.forEach(function(oRow){
      if(oRow===row) return;
      var oCap=oRow.dataset.captainuid||'', oUid=oRow.dataset.uid||'';
      var same = (captUid&&oCap===captUid)||(captUid&&oUid===captUid)||(!isTeam&&oCap===thisUid);
      if(!same) return;
      var oRI=oRow.querySelector('.rank-input');
      if(oRI&&(!oRI.value||oRI.value=='0')){oRI.value=r;calcPrize(oRI);}
    });
    /* Duplicate rank check */
    if(r>=1&&r<=3){
      var dup=false;
      allRows.forEach(function(oRow){
        if(oRow===row||oRow.dataset.isteam==='1') return;
        var oUid2=oRow.dataset.uid||'', oCap2=oRow.dataset.captainuid||'';
        if(oUid2===captUid||(captUid&&oCap2===captUid)||(!isTeam&&oCap2===thisUid)) return;
        var oRI2=oRow.querySelector('.rank-input');
        if(oRI2&&Number(oRI2.value)===r) dup=true;
      });
      var cell=row.querySelector('.prize-cell');
      if(dup){cell.innerHTML='<span style="color:#ff4444;font-size:10px;font-weight:800">⚠️ Dup #'+r+'!</span>';row.style.background='rgba(255,0,0,.06)';return;}
      else row.style.background='';
    }
  }

  var rp = r===1?f1:r===2?f2:r===3?f3:0;
  var kp = k*pk;
  var isTM = row.dataset.isteam==='1';
  var ft = row.dataset.feetype||'each_pays';
  var tw = (isTM&&ft==='captain_pays') ? 0 : (rp+kp);
  var cell = row.querySelector('.prize-cell');
  if(isTM&&ft==='captain_pays'){
    cell.style.color='#555';
    cell.innerHTML='<span style="font-size:9px;color:#555">→ Cap</span>';
  } else {
    cell.style.color = tw>0?'var(--primary)':'#aaa';
    var bd = (rp||kp)?'<br><span style="font-size:9px;color:#888">'+(rp?'R:₹'+rp:'')+(rp&&kp?'+':'')+(kp?k+'k×₹'+pk:'')+'</span>':'';
    cell.innerHTML='<span style="font-weight:800">₹'+tw+'</span>'+bd;
  }
}

function filterParticipants(s){s=s.toLowerCase();document.querySelectorAll('#participantsList tr').forEach(function(r){r.style.display=(r.dataset.name||'').indexOf(s)>=0?'':'none';});}

/* Bug 17 Fix: Processing flag — prevents double submission */
var _publishResultsInProgress = false;

async function publishResults(){
  if(_publishResultsInProgress){ showToast('Publishing already in progress...', true); return; }
  _publishResultsInProgress = true;
  var _pubBtn = document.getElementById('publishResultsBtn');
  if(_pubBtn){ _pubBtn.disabled = true; _pubBtn.style.opacity = '0.6'; }

  var mid=document.getElementById('resultTournamentSelect').value;
  if(!mid){ _publishResultsInProgress=false; if(_pubBtn){_pubBtn.disabled=false;_pubBtn.style.opacity='';} return showToast('Select match',true); }
  var t=currentTournamentData;
  
  // DOUBLE PAYMENT GUARD — check Supabase result_published_at (source of truth)
  var alreadyPublished = false;
  try {
    if (window._supa) {
      var _pubChk = await window._supa.from('matches').select('result_published_at').eq('id', mid).single();
      alreadyPublished = !!(_pubChk.data && _pubChk.data.result_published_at);
    }
    if (!alreadyPublished) {
      /* Fallback: check Firebase status too */
      var _existSnap = await rtdb.ref(DB_MATCHES + '/' + mid + '/status').once('value');
      alreadyPublished = (_existSnap.val() === 'resultPublished');
    }
  } catch(e) { alreadyPublished = false; }
  
  if(alreadyPublished){
    if(!confirm('⚠️ Results already published!\n\nKya aap results CORRECT karna chahte ho?\n\n• Zyada paise mile the → extra wapas katenge\n• Kam paise mile the → baaki add honge\n• Users ko notification milegi reason ke saath')) return;
  } else {
    if(!confirm('Publish & distribute prizes?')) return;
  }
  
  var rows=document.querySelectorAll('#participantsList tr[data-uid]');
  if(!rows.length) return showToast('No participants',true);
  
  /* ✅ Bug 8 Fix: DUPLICATE RANK CHECK — ALL ranks, ALL modes */
  var rankMap = {};
  var dupError = false;
  var matchMode = (currentTournamentData && currentTournamentData.mode || currentTournamentData && currentTournamentData.type || 'solo').toLowerCase();
  var isSoloMode = matchMode === 'solo';
  rows.forEach(function(row){
    if(row.dataset.isteam === '1') return; // skip team members for rank check (team leaders only)
    var ri = row.querySelector('.rank-input');
    var rank = ri ? Number(ri.value) : 0;
    if(rank >= 1){
      if(rankMap[rank]){
        var dupName = row.querySelector('td') ? row.querySelector('td').textContent : ('UID:' + row.dataset.uid);
        showToast('❌ Duplicate Rank #' + rank + ' — do players ko ek rank nahi de sakte! Fix karo.', true);
        row.style.background = 'rgba(255,0,0,.12)';
        /* Also highlight the first duplicate row */
        rows.forEach(function(r2){ if(r2.dataset.uid === rankMap[rank]) r2.style.background = 'rgba(255,0,0,.12)'; });
        dupError = true;
      } else {
        rankMap[rank] = row.dataset.uid;
      }
    }
  });
  /* For solo mode: verify ranks are sequential (1,2,3...) with no gaps if prize positions filled */
  if(isSoloMode && !dupError){
    var allRanks = Object.keys(rankMap).map(Number).filter(function(r){ return r >= 1; }).sort(function(a,b){return a-b;});
    /* Just check no duplicates — gaps allowed (not all players need to be ranked) */
  }
  if(dupError) return;
  
  var pubBtn=document.getElementById('publishResultsBtn');
  setLoading(pubBtn,true);
  
  try{
    // Load existing results if correction mode
    var existingResults={};
    if(alreadyPublished){
      var _eRes=await rtdb.ref('results').orderByChild('matchId').equalTo(mid).once('value');
      if(_eRes.exists()) _eRes.forEach(function(c){ var d=c.val(); if(d&&d.userId) existingResults[d.userId]=d; });
    }
    
    // Upload result screenshots via ImgBB (Firebase Storage removed — not configured)
    var uploadedUrls=[];
    if(resultScreenshots.length>0 && typeof window.uploadToImgBB==='function'){
      for(var si=0;si<resultScreenshots.length;si++){
        try{
          var _imgName='result_'+mid+'_'+Date.now()+'_'+si;
          var sUrl=await new Promise(function(resolve){
            window.uploadToImgBB(resultScreenshots[si],_imgName,function(err,url){resolve(err?null:url);});
          });
          if(sUrl) uploadedUrls.push(sUrl);
        }catch(se){ console.warn('Screenshot upload failed:',se); }
      }
    }
    if(uploadedUrls.length>0){
      await rtdb.ref(DB_MATCHES+'/'+mid+'/resultScreenshot').set(uploadedUrls[0]);
    /* ✅ FIX 9: Also save screenshot to Supabase matches.result_screenshot */
    if (window._supa) {
      window._supa.from('matches').update({ result_screenshot: uploadedUrls[0] }).eq('id', mid).catch(function(){});
    }
      await rtdb.ref(DB_MATCHES+'/'+mid+'/resultScreenshots').set(uploadedUrls);
    }
    
    var totalPlayers=rows.length;
    window._captainExtraWin = {}; // reset captain extra winnings tracker
    var _failedUids = []; /* Track failed players for retry/report */
    
    for(var i=0;i<rows.length;i++){
      var row=rows[i];
      var uid=row.dataset.uid;
      var rid=row.dataset.reqid;
      /* ── Per-player individual try/catch: one failure NEVER stops others ── */
      try {
      var rank=Number(row.querySelector('.rank-input').value)||0;
      var kills=Number(row.querySelector('.kills-input').value)||0;
      var rowFeeType = row.dataset.feetype || 'captain_pays';
      var rowIsTeam = row.dataset.isteam === '1';
      var rowCaptainUid = row.dataset.captainuid || '';
      
      var rp=0;
      /* Use _MPD (set at load time from fresh Firebase fetch) for prize values */
      var _pd = window._MRD || {};
      var _f1 = _pd.f1 || (t?Number(t.firstPrize)||0:0);
      var _f2 = _pd.f2 || (t?Number(t.secondPrize)||0:0);
      var _f3 = _pd.f3 || (t?Number(t.thirdPrize)||0:0);
      var perKill = _pd.pk || (t?Number(t.perKillPrize)||0:0);
      if(rank===1) rp=_f1;
      else if(rank===2) rp=_f2;
      else if(rank===3) rp=_f3;
      var killPrize = kills * perKill;
      var tw = rp + killPrize; // rank prize + kill prize
      
      /* captain_pays + isTeamMember: this player's winnings go to captain instead */
      /* We still record rank/kills for the team member but tw=0 for them */
      /* Captain's tw will be accumulated from all team members' prizes */
      if (rowFeeType === 'captain_pays' && rowIsTeam) {
        /* Store this team member's prize to be given to captain later */
        if (!window._captainExtraWin) window._captainExtraWin = {};
        if (!window._captainExtraWin[rowCaptainUid]) window._captainExtraWin[rowCaptainUid] = 0;
        window._captainExtraWin[rowCaptainUid] += tw;
        tw = 0; // team member gets nothing
      } else if (rowFeeType === 'captain_pays' && !rowIsTeam) {
        /* Captain row: add team members' prizes to captain's total (collected above) */
        var extra = (window._captainExtraWin && window._captainExtraWin[uid]) || 0;
        tw += extra;
      }
      
      if(alreadyPublished){
        // CORRECTION MODE: calculate delta
        var oldResult=existingResults[uid]||{};
        var oldTw=oldResult.winnings||oldResult.totalWinning||0;
        var delta=tw-oldTw;
        
        // Update result records
        await rtdb.ref(DB_MATCHES+'/'+mid+'/results/'+uid).update({rank:rank,kills:kills,killPrize:killPrize,rankPrize:rp,totalWinning:tw,correctedAt:Date.now()});
        await rtdb.ref(DB_JOIN+'/'+rid).update({kills:kills,rank:rank,killPrize:killPrize,rankPrize:rp,reward:tw,resultStatus:'completed'});
        
        // Apply delta to user wallet
        if(delta!==0){
          await rtdb.ref(DB_USERS+'/'+uid+'/realMoney/winnings').transaction(function(v){return Math.max(0,(v||0)+delta);});
          await rtdb.ref(DB_USERS+'/'+uid+'/wallet/winningBalance').transaction(function(v){return Math.max(0,(v||0)+delta);});
          await rtdb.ref(DB_USERS+'/'+uid+'/stats/earnings').transaction(function(v){return Math.max(0,(v||0)+delta);});
          await rtdb.ref(DB_USERS+'/'+uid+'/totalWinnings').transaction(function(v){return Math.max(0,(v||0)+delta);});
          
          // Transaction record with reason
          var deltaReason=delta>0
            ? '+'+'₹'+delta+' added — '+( t?t.name:'Match')+' result correction (Rank #'+rank+')'
            : '₹'+Math.abs(delta)+' adjusted — '+(t?t.name:'Match')+' result correction (Rank #'+rank+')';
          await rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:delta>0?'correction_credit':'correction_debit',amount:Math.abs(delta),description:deltaReason,timestamp:Date.now()});
          
          // Notification with reason
          var notifMsg=delta>0
            ? '✅ Result correction: ₹'+delta+' add kiya gaya. Match: '+(t?t.name:'')+', Rank #'+rank+'. Reason: Pehle record mein galti thi.'
            : '⚠️ Result correction: ₹'+Math.abs(delta)+' adjust kiya gaya. Match: '+(t?t.name:'')+', Rank #'+rank+'. Reason: Pehle zyada prize distribute hua tha.';
          await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'🔧 Result Correction',message:notifMsg,timestamp:Date.now(),read:false,type:'correction',uid:uid});
        }
        
        // Update kills stats delta
        var oldKills=oldResult.kills||0;
        var killDelta=kills-oldKills;
        if(killDelta!==0){
          await rtdb.ref(DB_USERS+'/'+uid+'/totalKills').transaction(function(v){return Math.max(0,(v||0)+killDelta);});
          await rtdb.ref(DB_USERS+'/'+uid+'/stats/kills').transaction(function(v){return Math.max(0,(v||0)+killDelta);});
        }
        
      } else {
        // FIRST PUBLISH (normal flow)
        await rtdb.ref(DB_MATCHES+'/'+mid+'/results/'+uid).set({rank:rank,kills:kills,killPrize:killPrize,rankPrize:rp,totalWinning:tw,timestamp:Date.now()});
        var resultPushRef=rtdb.ref('results').push();
        await resultPushRef.set({userId:uid,matchId:mid,matchName:t?t.name:'',rank:rank,kills:kills,killPrize:killPrize,rankPrize:rp,winnings:tw,won:rank===1,entryFee:t?t.entryFee||0:0,totalPlayers:totalPlayers,timestamp:Date.now(),createdAt:Date.now(),synced:false,cashbackGiven:false});
        await rtdb.ref(DB_JOIN+'/'+rid).update({kills:kills,rank:rank,killPrize:killPrize,rankPrize:rp,reward:tw,resultStatus:'completed'});
        await rtdb.ref('userMatches/'+uid+'/matches/'+mid).update({kills:kills,rank:rank,killPrize:killPrize,rankPrize:rp,reward:tw,resultStatus:'completed'});
        await rtdb.ref(DB_USERS+'/'+uid+'/totalKills').transaction(function(v){return(v||0)+kills;});
        await rtdb.ref(DB_USERS+'/'+uid+'/stats/kills').transaction(function(v){return(v||0)+kills;});
        if(tw>0){
          // Credit prize to correct currency based on prizeType
          /* ✅ Prize type: paid/SD entry → Green Diamond prize (non-withdrawable) | coin entry → coin prize */
          var _prizeType = t ? (t.prizeType || (
            (t.entryType==='paid' || t.entryType==='sky_diamond' || t.entryType==='skyDiamond') ? 'greenDiamond' :
            t.entryType==='coin' ? 'coin' : 'coin'
          )) : 'coin';
          var _pricePath = _prizeType==='greenDiamond' ? '/greenDiamonds' : _prizeType==='skyDiamond' ? '/skyDiamonds' : '/coins';
          var _prizeSymbol = _prizeType==='greenDiamond' ? '<img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block">' : _prizeType==='skyDiamond' ? '💎' : '🪙';
          await rtdb.ref(DB_USERS+'/'+uid+_pricePath).transaction(function(v){return(v||0)+tw;});
          await rtdb.ref(DB_USERS+'/'+uid+'/stats/earnings').transaction(function(v){return(v||0)+tw;});
          await rtdb.ref(DB_USERS+'/'+uid+'/totalWinnings').transaction(function(v){return(v||0)+tw;});
          if(rank===1){
            await rtdb.ref(DB_USERS+'/'+uid+'/stats/wins').transaction(function(v){return(v||0)+1;});
            await rtdb.ref(DB_USERS+'/'+uid+'/stats/winStreak').transaction(function(v){return(v||0)+1;});
          } else {
            await rtdb.ref(DB_USERS+'/'+uid+'/stats/winStreak').set(0);
          }
          var breakdownMsg = (rp>0?'Rank #'+rank+' = '+_prizeSymbol+rp:'') + (killPrize>0?(rp>0?' + ':'')+kills+' kills × '+_prizeSymbol+perKill+' = '+_prizeSymbol+killPrize:'');
          await rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:'winning',currency:_prizeType,amount:tw,description:(t?t.name:'Match')+' — '+breakdownMsg,timestamp:Date.now()});
          var winMsg='🏆 '+_prizeSymbol+tw+' jeeta! '+(t?t.name:'')+' — '+(rank?'Rank #'+rank+': '+_prizeSymbol+rp+', ':'')+(kills+' Kills: '+_prizeSymbol+killPrize)+'. Wallet mein add ho gaye.';
          /* Bug Critical #1 Fix: dual-write notification to Firebase + Supabase */
          await window._adminNotifyUser(uid,{title:'🏆 Match Result!',message:winMsg,type:'result',matchId:mid});
          /* Bug Critical #5 Fix: Credit prize in Supabase wallet_transactions */
          if(window._supa && tw > 0){
            var _supaCurrency = _prizeType==='greenDiamond'?'green_diamonds':_prizeType==='skyDiamond'?'sky_diamonds':'coins';
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:_supaCurrency,p_amount:tw}).catch(function(){});
            window._supa.from('wallet_transactions').insert({user_id:uid,txn_type:'match_win',currency:_supaCurrency,amount:tw,ref_id:mid,description:(t?t.name:'Match')+' — Rank #'+rank+' prize'}).catch(function(){});
            window._supa.from('join_requests').update({status:'completed',placement:rank,prize_earned:tw,kills:kills}).eq('user_id',uid).eq('match_id',mid).catch(function(){});
            /* ✅ BUG 2 FIX: Update rank_points + stats in Supabase (leaderboard uses these) */
            var _rankPts = rank===1?25 : rank===2?15 : rank===3?10 : rank<=10?5 : 1;
            var _killRankPts = Math.min(kills, 3); /* cap kill bonus at 3 pts */
            var _totalRankPts = _rankPts + _killRankPts;
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'rank_points',p_amount:_totalRankPts}).catch(function(){});
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'total_kills',p_amount:kills}).catch(function(){});
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'total_matches',p_amount:1}).catch(function(){});
            if(rank===1){ window._supa.rpc('increment_balance',{p_uid:uid,p_col:'total_wins',p_amount:1}).catch(function(){}); }
            /* ✅ BUG 3 FIX: Win streak in Supabase */
            if(rank===1){
              window._supa.from('users').select('win_streak').eq('id',uid).single()
                .then(function(r){ var cur=(r.data&&r.data.win_streak)||0; window._supa.from('users').update({win_streak:cur+1}).eq('id',uid).catch(function(){}); }).catch(function(){});
            } else {
              window._supa.from('users').update({win_streak:0}).eq('id',uid).catch(function(){});
            }
            /* ✅ Insert match_results row for Supabase analytics */
            window._supa.from('match_results').upsert({match_id:mid,user_id:uid,placement:rank,kills:kills,prize:tw},{onConflict:'match_id,user_id'}).catch(function(){});
          }
        } else {
          await rtdb.ref(DB_USERS+'/'+uid+'/stats/winStreak').set(0);
          var noWinMsg='📋 '+(t?t.name:'')+' ka result publish ho gaya! Tumhara rank: '+(rank?'#'+rank:'Unranked')+', Kills: '+kills+'. Better luck next time! 💪';
          /* Bug Critical #1 Fix: dual-write notification */
          await window._adminNotifyUser(uid,{title:'📋 Result Published — Dekho!',message:noWinMsg,type:'result',matchId:mid});
          /* ✅ Mark join_request completed + update stats for non-winners */
          if(window._supa){
            window._supa.from('join_requests').update({status:'completed',placement:rank,prize_earned:0,kills:kills}).eq('user_id',uid).eq('match_id',mid).catch(function(){});
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'rank_points',p_amount:1}).catch(function(){}); /* participation point */
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'total_kills',p_amount:kills}).catch(function(){});
            window._supa.rpc('increment_balance',{p_uid:uid,p_col:'total_matches',p_amount:1}).catch(function(){});
            window._supa.from('users').update({win_streak:0}).eq('id',uid).catch(function(){});
            window._supa.from('match_results').upsert({match_id:mid,user_id:uid,placement:rank,kills:kills,prize:0},{onConflict:'match_id,user_id'}).catch(function(){});
          }
        }
        // Cashback removed — no real money refund
        // Platform profit tracking
        var entryF=t?t.entryFee||0:0;
        await rtdb.ref('platformEarnings').push({matchId:mid,entryFee:entryF,prizeGiven:tw,profit:entryF-tw,userId:uid,timestamp:Date.now()});
        // lastResult for recap
        await rtdb.ref(DB_USERS+'/'+uid+'/lastResult').set({rank:rank,kills:kills,winnings:tw,matchName:t?t.name:'',matchId:mid,timestamp:Date.now()});
      }
      } catch(_playerErr) {
        /* One player failed — log it but CONTINUE with next player */
        console.error('[publishResults] Player ' + uid + ' failed:', _playerErr && _playerErr.message);
        _failedUids.push(uid);
        /* Mark this row red so admin can see which player failed */
        try { rows[i].style.background = 'rgba(255,60,60,0.15)'; } catch(e) {}
        /* Continue loop — don't break */
        continue;
      }
    }
    /* Report failures if any */
    if (_failedUids.length > 0) {
      showToast('⚠️ ' + _failedUids.length + ' player(s) mein error — red rows check karo, dubara publish karo', true);
    }
    
    // Update match status
    if(!alreadyPublished){
      await rtdb.ref(DB_MATCHES+'/'+mid).update({status:'resultPublished',resultPublishedAt:Date.now()});
      /* ✅ FIX 10: Set result_published_at in Supabase — prevents double-publish on reload */
      if(window._supa) window._supa.from('matches').update({
        status: 'completed',
        result_published_at: new Date().toISOString()
      }).eq('id', mid).catch(function(){});
    /* Update season stats for all players */
    rows.forEach(function(row){
      var rUid=row.dataset.uid; if(!rUid) return;
      var rKills=Number(row.querySelector('.kills-input').value)||0;
      var rRank=Number(row.querySelector('.rank-input').value)||0;
      var now=new Date(); var monthKey=now.getFullYear()+'_'+String(now.getMonth()+1).padStart(2,'0');
      var sRef=rtdb.ref('seasonStats/'+monthKey+'/'+rUid);
      sRef.transaction(function(cur){
        cur=cur||{ign:'',stats:{wins:0,kills:0,matches:0}};
        if(!cur.stats) cur.stats={wins:0,kills:0,matches:0};
        cur.stats.kills=(cur.stats.kills||0)+rKills;
        cur.stats.matches=(cur.stats.matches||0)+1;
        if(rRank===1) cur.stats.wins=(cur.stats.wins||0)+1;
        return cur;
      });
    });
    } else {
      await rtdb.ref(DB_MATCHES+'/'+mid).update({resultCorrectedAt:Date.now()});
    }
    
    resultScreenshots=[];
    var ssP=document.getElementById('ssPreview');if(ssP)ssP.innerHTML='';
    var ssC=document.getElementById('screenshotCount');if(ssC)ssC.textContent='0 selected';
    
    setLoading(pubBtn,false);
    showToast(alreadyPublished?'✅ Result correction done! Users notified.':'✅ Results published! Prizes distributed.');
    loadParticipants();
    _publishResultsInProgress = false;
    if(_pubBtn){ _pubBtn.disabled = false; _pubBtn.style.opacity = ''; }
  }catch(err){
    setLoading(pubBtn,false);
    _publishResultsInProgress = false;
    if(_pubBtn){ _pubBtn.disabled = false; _pubBtn.style.opacity = ''; }
    showToast('Error: '+err.message,true);
    console.error('publishResults error:',err);
  }
}
function setupWalletListener(){rtdb.ref(DB_WALLET).on('value',function(s){allWalletRequests={};s.forEach(function(c){allWalletRequests[c.key]=c.val();});renderWalletRequests();});}
/* ✅ Audit Fix: allJoinRequests was only refreshed inside loadTournaments()/refreshJoinedPlayers()
   (both one-time .once('value') reads). New joins made after the admin opened the panel never
   appeared until an explicit manual reload. A live listener keeps it continuously in sync,
   same pattern as setupWalletListener/setupUsersListener above. */
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
function normalizeWalletType(t){if(!t)return 'add';t=t.toLowerCase();if(t==='deposit'||t==='add'||t==='add_money'||t==='addmoney')return 'add';if(t==='withdraw'||t==='withdrawal')return 'withdraw';return t;}
function renderWalletRequests(){
  var f=document.getElementById('walletFilter')?document.getElementById('walletFilter').value:'all';var tb=document.getElementById('walletRequestsTable');tb.innerHTML='';var c=0;
  Object.keys(allWalletRequests).forEach(function(id){
    var w=allWalletRequests[id];var tp=normalizeWalletType(w.type);if(f!=='all'&&tp!==f)return;c++;
    var uid=getUid(w)||'N/A',un=w.userName||w.displayName||getUserName(uid);
    var tb_=tp==='add'?'<span class="badge" style="background:rgba(0,212,255,.15);color:#00d4ff"><i class="fas fa-gem"></i> Sky Diamond Buy</span>':tp==='diamond_purchase'?'<span class="badge" style="background:rgba(0,212,255,.15);color:#00d4ff"><i class="fas fa-gem"></i> Diamond Purchase</span>':'<span class="badge purple"><i class="fas fa-arrow-up"></i> Withdraw</span>';
    var sb=w.status==='approved'?'green':w.status==='rejected'?'red':'yellow';
    var _ssrc=w.screenshotUrl||w.screenshotBase64||w.screenshot||w.proofImage||''; var ss=_ssrc?'<img src="'+_ssrc+'" style="width:36px;height:36px;border-radius:6px;cursor:pointer;object-fit:cover;border:1px solid var(--border)" onclick="viewScreenshot(this.src)">':'<span class="text-muted text-xxs">No photo</span>';
    var utr=w.utrNumber||w.utr||w.transactionId||w.referenceId||'',upi=w.upiId||w.upi||'';
    var dh='';
    if(tp==='add'&&utr)dh='<span class="wallet-utr">UTR: '+utr+'</span>';
    else if(tp==='withdraw'&&upi)dh='<div class="text-xxs"><span class="text-dim">UPI:</span> <strong class="text-warning">'+upi+'</strong></div>';
    else dh='<span class="text-muted text-xxs">'+(utr||upi||'—')+'</span>';
    var acts='';
    if(w.status==='pending'){
      if(tp==='add')acts='<button class="btn btn-primary btn-xs" onclick="approveAddMoney(\''+id+'\')"><i class="fas fa-check"></i></button> <button class="btn btn-danger btn-xs" onclick="openRejectModal(\'wallet\',\''+id+'\')"><i class="fas fa-times"></i></button>';
      else acts='<button class="btn btn-primary btn-xs" onclick="openWithdrawalModal(\''+id+'\')"><i class="fas fa-money-bill-wave"></i></button> <button class="btn btn-danger btn-xs" onclick="openRejectModal(\'wallet\',\''+id+'\')"><i class="fas fa-times"></i></button>';
    }
    var ffUid_w = w.ffUid||w.gameUid||(usersCache[uid]&&usersCache[uid].ffUid)||'—';
    var ign_w = w.userName||w.displayName||getUserName(uid)||(usersCache[uid]&&usersCache[uid].ign)||'—';
    tb.innerHTML+='<tr>'
      +'<td><span style="font-weight:700;color:var(--primary);font-size:11px">'+ign_w+'</span><div style="font-size:9px;color:#666;font-family:monospace">'+uid.substring(0,8)+'…</div></td>'
      +'<td><span style="font-family:monospace;font-size:10px;color:var(--info);background:rgba(0,212,255,.08);padding:2px 6px;border-radius:5px">'+ffUid_w+'</span></td>'
      +'<td>'+tb_+'</td>'
      +'<td class="font-bold" style="color:#00d4ff">'+(tp==='add'||tp==='diamond_purchase'?'💎':'₹')+(w.diamonds||w.amount||0)+'</td>'
      +'<td>'+dh+'</td>'
      +'<td>'+(w.creatorCode?'<span style="font-size:11px;font-weight:800;color:#00d4ff;background:rgba(0,212,255,.1);padding:2px 8px;border-radius:8px">🔵 '+w.creatorCode+'</span>':'<span style="color:#444;font-size:10px">—</span>')+'</td>'
      +'<td>'+ss+'</td>'
      +'<td><span class="badge '+sb+'">'+(w.status||'pending')+'</span></td>'
      +'<td>'+acts+'</td>'
      +'</tr>';
  });
  document.getElementById('walletCount').textContent=c;
}
function viewScreenshot(src){document.getElementById('screenshotFullImg').src=src;document.getElementById('screenshotModal').classList.add('show');}
async function approveAddMoney(rid){
  /* Disable button immediately to prevent double-clicks */
  event.target.closest('.btn').disabled=true;
  event.target.closest('.btn').style.opacity='0.5';
  try{
    var w=allWalletRequests[rid];
    if(!w)return showToast('Not found',true);
    var uid=getUid(w);
    if(!uid)return showToast('UID missing',true);
    var amt=Number(w.amount)||0;
    var userName=w.userName||w.displayName||getUserName(uid)||'User';
    
    /* BUG #26 FIX (2026-07): this function used to write BOTH skyDiamonds AND
       realMoney/deposited directly — but the Supabase bridge's NESTED_FIELD_MAP
       routes both of those to the SAME sky_diamonds column, so that was already
       a 2x credit. admin-supabase-sync.js's _wrapApproveAddMoney() then ALSO
       calls increment_balance(uid,'sky_diamonds',amt) on top of whatever this
       function does — making it 3x. The actual credit now happens EXACTLY ONCE,
       via that wrapper's increment_balance call (confirmed always fires — see
       admin-supabase-sync.js). This function no longer touches the balance at
       all; it only handles the request-status update, notifications, and audit
       log below. Do not re-add a balance write here without removing the
       wrapper's call, or the double/triple-credit bug returns. */
    
    /* Update wallet request status */
    await rtdb.ref(DB_WALLET+'/'+rid).update({status:'approved',processedAt:Date.now(),processedBy:auth.currentUser.uid});
    
    /* Add transaction record */
    await rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:'deposit',amount:amt,description:'Deposit approved — 💎'+amt+' Diamonds added',timestamp:Date.now()});
    
    /* Send notification to user — CRITICAL: User must know their deposit was approved */
    await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({
      title:'💎 Sky Diamonds Added!',
      message:'Aapka payment verify hua! 💎 '+amt+' Sky Diamonds wallet mein add ho gaye. Ab paid matches join kar sakte ho!',
      amount:amt,
      diamonds:amt,
      type:'wallet_approved',
      timestamp:Date.now(),
      read:false
    });
    
    /* Also create entry in global notifications node for tracking */
    await rtdb.ref('notifications').push({
      uid:uid,
      userName:userName,
      title:'Wallet Update: Approved',
      message:'Deposit of ₹'+amt+' approved for '+userName,
      type:'deposit_approved',
      amount:amt,
      createdAt:Date.now(),
      adminUid:auth.currentUser.uid
    });
    
    /* Log activity */
    await rtdb.ref('activityLogs').push({type:'wallet_approved',uid:uid,amount:amt,walletType:'deposit',admin:auth.currentUser.uid,timestamp:Date.now()});
    /* Wallet audit trail — for fa54 security monitoring */
    await rtdb.ref('walletAuditLog').push({uid:uid,action:'MANUAL_APPROVED',amount:amt,note:'UTR: '+(w.utrNumber||w.utr||w.transactionId||'none')+' | Admin: '+auth.currentUser.email,timestamp:Date.now(),adminUid:auth.currentUser.uid});
    showToast('✅ Payment approved — ₹'+amt+' added to '+userName);
  }catch(e){
    console.error('approveAddMoney error:',e);
    showToast('Error: '+e.message,true);
  }
}
function openWithdrawalModal(rid){var w=allWalletRequests[rid];if(!w)return;pendingWithdrawData={requestId:rid};withdrawProofBase64=null;document.getElementById('withdrawProofPreview').style.display='none';document.getElementById('confirmWithdrawBtn').disabled=true;document.getElementById('withdrawAdminMsg').value='';var uid=getUid(w)||'N/A',upi=w.upiId||w.upi||'N/A',amt=w.amount||0,un=w.userName||w.displayName||getUserName(uid);document.getElementById('withdrawUserName').textContent=un;document.getElementById('withdrawUserUid').textContent=uid;document.getElementById('withdrawUpiId').textContent=upi;document.getElementById('withdrawAmount').textContent='₹'+amt;document.getElementById('withdrawPayLink').href='upi://pay?pa='+encodeURIComponent(upi)+'&pn='+encodeURIComponent(un)+'&am='+amt+'&cu=INR';document.getElementById('withdrawalModal').classList.add('show');}
function previewWithdrawProof(inp){if(!inp.files[0])return;var rd=new FileReader();rd.onload=function(e){var img=new Image();img.onload=function(){var cv=document.createElement('canvas');var w=img.width,h=img.height;if(w>800){h=(800/w)*h;w=800;}cv.width=w;cv.height=h;cv.getContext('2d').drawImage(img,0,0,w,h);var q=0.8,d=cv.toDataURL('image/jpeg',q);while(d.length>500*1024&&q>0.1){q-=0.1;d=cv.toDataURL('image/jpeg',q);}withdrawProofBase64=d;document.getElementById('withdrawProofPreview').src=d;document.getElementById('withdrawProofPreview').style.display='block';document.getElementById('confirmWithdrawBtn').disabled=false;
/* Upload to ImgBB in background */
if(window.uploadToImgBB){uploadToImgBB(d,'admin_proof_'+Date.now(),function(err,url){if(!err&&url){withdrawProofBase64=url;console.log('[Admin] Proof uploaded to ImgBB:',url);}});}
};img.src=e.target.result;};rd.readAsDataURL(inp.files[0]);}
async function confirmWithdrawal(){
  if(!pendingWithdrawData||!withdrawProofBase64)return showToast('Upload proof',true);
  var btn=document.getElementById('confirmWithdrawBtn');
  setLoading(btn,true);
  var rid=pendingWithdrawData.requestId,w=allWalletRequests[rid],uid=getUid(w);
  if(!uid){setLoading(btn,false);return showToast('UID missing',true);}
  var amt=Number(w.amount)||0,msg=document.getElementById('withdrawAdminMsg').value;
  var userName=w.userName||w.displayName||getUserName(uid)||'User';
  var upiId=w.upiId||w.upi||'N/A';
  var txnId='TXN'+Date.now();
  
  /* FIX Bug#4: Apply TDS deduction when TDS is active.
     ORIGINAL BUG: TDS toggle was purely cosmetic — no actual deduction happened.
     FIX: Read tdsConfig, calculate deduction, record it, adjust final payout. */
  var tdsActive=false,tdsRate=0.30,tdsDeducted=0,netAmt=amt;
  try{
    var tdsCfg=await rtdb.ref('appSettings/tdsConfig').once('value');
    var tcv=tdsCfg.val()||{};
    tdsActive=tcv.active===true;
    tdsRate=Number(tcv.rate||tcv.tdsRate||30)/100;
  }catch(te){console.warn('[Bug#4 Fix] TDS config read failed:',te.message);}
  
  if(tdsActive&&amt>0){
    tdsDeducted=Math.floor(amt*tdsRate);
    netAmt=amt-tdsDeducted;
    var fy=(function(){var n=new Date(),yr=n.getFullYear(),mo=n.getMonth()+1;return mo>=4?yr+'-'+(yr+1):(yr-1)+'-'+yr;})();
    setLoading(btn,false);
    var proceed=confirm('⚠️ TDS ACTIVE\n\nWithdrawal: ₹'+amt+'\nTDS ('+Math.round(tdsRate*100)+'%): -₹'+tdsDeducted+'\nAmount to pay user: ₹'+netAmt+'\n\nFY: '+fy+'\nProceed?');
    if(!proceed)return;
    setLoading(btn,true);
    /* Record TDS in Firebase for compliance */
    await rtdb.ref('tdsRecords').push({
      uid:uid,ign:getUserName(uid),withdrawalRequestId:rid,
      withdrawalAmount:amt,tdsDeducted:tdsDeducted,
      tdsRate:Math.round(tdsRate*100),amountPaid:netAmt,
      financialYear:fy,timestamp:Date.now()
    });
    await rtdb.ref('tdsHeld').push({uid:uid,amount:tdsDeducted,withdrawalId:rid,timestamp:Date.now()});
    await rtdb.ref(DB_WALLET+'/'+rid).update({tdsDeducted:tdsDeducted,tdsRate:Math.round(tdsRate*100),originalAmount:amt,amountAfterTDS:netAmt});
    /* Supabase TDS log */
    if(window._supa){
      window._supa.from('wallet_transactions').insert({
        user_id:uid,txn_type:'debit',amount:tdsDeducted,currency:'inr',
        reason:'TDS deduction ('+Math.round(tdsRate*100)+'%) on withdrawal ₹'+amt,
        ref_id:rid,created_at:new Date().toISOString()
      }).catch(function(){});
    }
    console.log('[Bug#4 Fix] TDS applied: ₹'+tdsDeducted+' deducted from ₹'+amt+' withdrawal for',uid);
  }
  
  try{
    /* STEP 1: Update wallet request status FIRST */
    await rtdb.ref(DB_WALLET+'/'+rid).update({
      status:'approved',
      proofImage:withdrawProofBase64,
      adminMessage:msg,
      transactionId:txnId,
      processedAt:Date.now(),
      processedBy:auth.currentUser.uid
    });
    
    /* STEP 2: Deduct from user balances */
    await rtdb.ref(DB_USERS+'/'+uid+'/realMoney/winnings').transaction(function(v){return Math.max((v||0)-amt,0)});
    await rtdb.ref(DB_USERS+'/'+uid+'/wallet/winningBalance').transaction(function(v){return Math.max((v||0)-amt,0)});
    
    /* STEP 3: Add transaction record */
    await rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({
      type:'withdrawal',
      amount:-amt,
      description:'Withdrawal processed - TXN: '+txnId,
      timestamp:Date.now()
    });
    
    /* STEP 4: Send notification to user — CRITICAL: User must know their withdrawal was processed */
    await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({
      title:'💸 Withdrawal Approved!',
      message:'₹'+netAmt+' (of ₹'+amt+(tdsDeducted>0?' — TDS ₹'+tdsDeducted+' deducted':'')+') has been sent to your UPI: '+upiId+'. '+(msg?'Note: '+msg:''),
      amount:netAmt,originalAmount:amt,tdsDeducted:tdsDeducted,
      transactionId:txnId,
      proofImage:withdrawProofBase64,
      type:'withdrawal_approved',
      timestamp:Date.now(),
      read:false
    });
    
    /* Also create entry in global notifications node for tracking */
    await rtdb.ref('notifications').push({
      uid:uid,
      userName:userName,
      title:'Wallet Update: Withdrawal Approved',
      message:'Withdrawal of ₹'+amt+' processed for '+userName+' to UPI: '+upiId,
      type:'withdrawal_approved',
      amount:amt,
      transactionId:txnId,
      createdAt:Date.now(),
      adminUid:auth.currentUser.uid
    });
    
    console.log('Withdrawal approved — ₹'+amt+' for UID: '+uid+' to UPI: '+upiId);
    /* Log activity */
    try{await rtdb.ref('activityLogs').push({type:'withdrawal_approved',uid:uid,amount:amt,admin:auth.currentUser.uid,timestamp:Date.now()});}catch(le){}
    try{await rtdb.ref('walletAuditLog').push({uid:uid,action:'WITHDRAWAL_APPROVED',amount:amt,note:'UPI: '+upiId+' | TxnID: '+txnId+' | Admin: '+auth.currentUser.email,timestamp:Date.now(),adminUid:auth.currentUser.uid});}catch(le){}
    setLoading(btn,false);
    closeModal('withdrawalModal');
    showToast('✅ ₹'+amt+' withdrawal processed for '+userName);
  }catch(e){
    console.error('confirmWithdrawal error:',e);
    setLoading(btn,false);
    showToast('Error: '+e.message,true);
  }
}

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
    if(type==='profile'){var s=await rtdb.ref(DB_PROFILE+'/'+requestId).once('value');var r=s.val(),uid=r?getUid(r):null;await rtdb.ref(DB_PROFILE+'/'+requestId).update({status:'rejected',rejectionReason:rsn,processedAt:Date.now(),processedBy:auth.currentUser.uid});if(uid)await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'Profile Rejected ❌',message:'Reason: '+rsn,timestamp:Date.now(),read:false});}
    else if(type==='profileUpdate'){var s2=await rtdb.ref(DB_PROFILE_UPDATE+'/'+requestId).once('value');var r2=s2.val(),uid2=r2?getUid(r2):null;await rtdb.ref(DB_PROFILE_UPDATE+'/'+requestId).update({status:'rejected',rejectionReason:rsn,processedAt:Date.now()});if(uid2){await rtdb.ref(DB_USERS+'/'+uid2).update({profileUpdatePending:false});await rtdb.ref(DB_USERS+'/'+uid2+'/notifications').push({title:'Update Rejected ❌',message:'Reason: '+rsn,timestamp:Date.now(),read:false});}}
    else if(type==='wallet'){
      var w=allWalletRequests[requestId],uid3=w?getUid(w):null,wt=normalizeWalletType(w?w.type:null);
      var amt=Number(w?w.amount:0)||0;
      var userName=w?(w.userName||w.displayName||getUserName(uid3)||'User'):'User';
      
      /* Update wallet request status */
      await rtdb.ref(DB_WALLET+'/'+requestId).update({status:'rejected',rejectionReason:rsn,processedAt:Date.now(),processedBy:auth.currentUser.uid});
      
      /* If withdrawal rejected, refund the amount back to user */
      if(wt==='withdraw'&&uid3){
        await rtdb.ref(DB_USERS+'/'+uid3+'/realMoney/winnings').transaction(function(v){return(v||0)+amt});
        await rtdb.ref(DB_USERS+'/'+uid3+'/wallet/winningBalance').transaction(function(v){return(v||0)+amt});
        await rtdb.ref(DB_USERS+'/'+uid3+'/transactions').push({type:'refund',amount:amt,description:'Withdrawal rejected: '+rsn,timestamp:Date.now()});
      }
      
      /* Send notification to user — CRITICAL: User must know their request was rejected */
      if(uid3){
        var notifTitle=wt==='withdraw'?'❌ Withdrawal Rejected':'❌ Deposit Rejected';
        var notifMsg=wt==='withdraw'?
          'Your withdrawal request of ₹'+amt+' was rejected. Amount refunded. Reason: '+rsn:
          'Your deposit request of ₹'+amt+' was rejected. Reason: '+rsn;
        
        await rtdb.ref(DB_USERS+'/'+uid3+'/notifications').push({
          title:notifTitle,
          message:notifMsg,
          amount:amt,
          reason:rsn,
          type:'wallet_rejected',
          timestamp:Date.now(),
          read:false
        });
        
        /* Also log to global notifications for tracking */
        await rtdb.ref('notifications').push({
          uid:uid3,
          userName:userName,
          title:'Wallet Update: Rejected',
          message:(wt==='withdraw'?'Withdrawal':'Deposit')+' of ₹'+amt+' rejected for '+userName+'. Reason: '+rsn,
          type:'wallet_rejected',
          amount:amt,
          reason:rsn,
          createdAt:Date.now(),
          adminUid:auth.currentUser.uid
        });
        
        console.log('Wallet request rejected — ₹'+amt+' for UID: '+uid3+', Reason: '+rsn);
      }
    }
    else if(type==='team'){var s3=await rtdb.ref(DB_TEAM+'/'+requestId).once('value');var r3=s3.val();await rtdb.ref(DB_TEAM+'/'+requestId).update({status:'rejected',rejectionReason:rsn,processedAt:Date.now()});var uid4=r3?r3.ownerUid||r3.uid:null;if(uid4)await rtdb.ref(DB_USERS+'/'+uid4+'/notifications').push({title:'Team Rejected ❌',message:'Reason: '+rsn,timestamp:Date.now(),read:false});}
    closeModal('rejectModal');showToast('Rejected');
  }catch(e){showToast('Error: '+e.message,true);}
}

/* =============================================
   TEAMS
   ============================================= */
async function loadTeamRequests(){
  try{var snap=await rtdb.ref(DB_TEAM).once('value');var tb=document.getElementById('teamRequestsTable');tb.innerHTML='';var c=0;
  snap.forEach(function(ch){var d=ch.val(),id=ch.key,ip=d.status==='pending';if(ip)c++;var sb=d.status==='approved'?'green':d.status==='rejected'?'red':'yellow';
  var acts=ip?'<button class="btn btn-primary btn-xs" onclick="approveTeam(\''+id+'\')"><i class="fas fa-check"></i></button> <button class="btn btn-danger btn-xs" onclick="openRejectModal(\'team\',\''+id+'\')"><i class="fas fa-times"></i></button>':'';
  var ownerUid=d.ownerUid||d.uid||'';var memberUid=d.memberUid||'';
  tb.innerHTML+='<tr><td>'+'<div style="display:flex;flex-direction:column;gap:3px">'+'<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">'+'<span class="badge primary" style="font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(d.ownerName||'Owner')+'</span>'+'<span class="text-xxs font-mono" style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px">'+ownerUid.substring(0,8)+'…</span>'+'</div>'+'<div style="display:flex;align-items:center;gap:4px">'+'<span style="font-size:9px;color:var(--text-muted);font-weight:600">FF:</span>'+'<span class="font-mono" style="font-size:10px;color:var(--info);background:rgba(0,212,255,.1);padding:1px 6px;border-radius:4px">'+(d.ownerFfUid||d.ffUid||(usersCache[ownerUid]&&usersCache[ownerUid].ffUid)||'N/A')+'</span>'+'</div></div></td><td><span class="badge blue">'+(d.teamType||d.type||'N/A')+'</span></td><td>'+'<div style="display:flex;flex-direction:column;gap:3px">'+'<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">'+'<span class="badge primary" style="font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(d.memberName||'Member')+'</span>'+'<span class="text-xxs font-mono" style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px">'+memberUid.substring(0,8)+'…</span>'+'</div>'+'<div style="display:flex;align-items:center;gap:4px">'+'<span style="font-size:9px;color:var(--text-muted);font-weight:600">FF:</span>'+'<span class="font-mono" style="font-size:10px;color:var(--info);background:rgba(0,212,255,.1);padding:1px 6px;border-radius:4px">'+(d.memberFfUid||(usersCache[memberUid]&&usersCache[memberUid].ffUid)||'N/A')+'</span>'+'</div></div></td><td><span class="badge '+sb+'">'+d.status+'</span></td><td>'+acts+'</td></tr>';});
  document.getElementById('teamCount').textContent=c;}catch(e){console.error(e);}
}
async function approveTeam(rid){
  try{
    var s=await rtdb.ref(DB_TEAM+'/'+rid).once('value');
    if(!s.exists())return showToast('Team request not found',true);
    var r=s.val();
    var ou=r.ownerUid||r.uid;
    var mu=r.memberUid;
    var tt=(r.teamType||r.type||'duo').toLowerCase();
    var fld=tt==='squad'?'squadTeam':'duoTeam';
    
    if(!ou||!mu)return showToast('Owner or Member UID missing',true);
    
    console.log('═══════════════════════════════');
    console.log('APPROVE TEAM: '+tt.toUpperCase());
    console.log('Owner: '+(r.ownerName||ou));
    console.log('Member: '+(r.memberName||mu));
    console.log('═══════════════════════════════');
    
    /* ===== TWO-WAY PARTNER SYNC ===== */
    
    /* Step 1: Add member to owner's team array */
    var os=await rtdb.ref(DB_USERS+'/'+ou+'/'+fld).once('value');
    var ot=os.val()||[];
    if(ot.indexOf(mu)<0)ot.push(mu);
    await rtdb.ref(DB_USERS+'/'+ou+'/'+fld).set(ot);
    console.log('Step 1: Added '+mu+' to '+ou+'/'+fld);
    
    /* Step 2: Add owner to member's team array (TWO-WAY) */
    var ms2=await rtdb.ref(DB_USERS+'/'+mu+'/'+fld).once('value');
    var mt2=ms2.val()||[];
    if(mt2.indexOf(ou)<0)mt2.push(ou);
    await rtdb.ref(DB_USERS+'/'+mu+'/'+fld).set(mt2);
    console.log('Step 2: Added '+ou+' to '+mu+'/'+fld);
    
    /* Step 3: Set partnerUid for BOTH users (TWO-WAY SYNC) */
    if(tt==='duo'){
      await rtdb.ref(DB_USERS+'/'+ou+'/partnerUid').set(mu);
      await rtdb.ref(DB_USERS+'/'+mu+'/partnerUid').set(ou);
      console.log('Step 3: partnerUid sync: '+ou+' ↔ '+mu);
    }
    
    /* Step 4: Notify BOTH users */
    await rtdb.ref(DB_USERS+'/'+ou+'/notifications').push({
      title:'Team Approved! ✅',
      message:tt.charAt(0).toUpperCase()+tt.slice(1)+' team approved with '+(r.memberName||'member')+'.',
      timestamp:Date.now(),
      read:false
    });
    await rtdb.ref(DB_USERS+'/'+mu+'/notifications').push({
      title:'Team Joined! ✅',
      message:'Added to '+tt+' team with '+(r.ownerName||'owner')+'.',
      timestamp:Date.now(),
      read:false
    });
    console.log('Step 4: Notifications sent to both users');
    
    /* Step 5: Update request status */
    await rtdb.ref(DB_TEAM+'/'+rid).update({status:'approved',processedAt:Date.now(),processedBy:auth.currentUser.uid});
    
    console.log('✅ Team approved with complete two-way sync!');
    showToast('✅ Team approved! Partner sync: '+ou.substring(0,8)+' ↔ '+mu.substring(0,8));
    loadTeamRequests();
  }catch(e){
    console.error('approveTeam error:',e);
    showToast('Error: '+e.message,true);
  }
}

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
async function loadSupportChats(){
  console.log('Setting up chat listeners on: '+CHAT_PATH_PRIMARY+'/ and '+CHAT_PATH_SECONDARY+'/');
  
  /* Helper function to process chat snapshot */
  function processChatSnapshot(snap, pathName){
    console.log('Chat snapshot from '+pathName+'/, exists:',snap.exists());
    if(!snap.exists())return;
    
    snap.forEach(function(us){
      var uid=us.key;var lm='',ur=0,lt=0,un='';
      /* FIX: support path uses /messages sub-node; chats path is flat */
      var msgNode = us.child('messages');
      var infoNode = us.child('info');
      /* Read user info from /info node */
      if(infoNode.exists()){var info=infoNode.val();un=info.userIGN||info.userName||info.displayName||'';}
      /* Read messages from /messages sub-node (support path) or directly (chats path) */
      var msgSnap = (pathName==='support' && msgNode.exists()) ? msgNode : us;
      msgSnap.forEach(function(ms){
        var m=ms.val();
        if(typeof m !== 'object' || !m) return; /* skip non-message nodes like info */
        if(!m.text && !m.message) return;
        lm=m.message||m.text||'';
        var mt=m.createdAt||m.timestamp||0;
        if(mt>lt)lt=mt;
        if(!isAdminMsg(m)&&!m.read)ur++;
        if(!un&&!isAdminMsg(m)&&(m.senderName||m.userName))un=m.senderName||m.userName;
      });
      if(!un)un=getUserName(uid);
      
      if(!allChatUsers[uid]||allChatUsers[uid].lastTime<lt){
        allChatUsers[uid]={userName:un,lastMsg:lm,unread:ur,lastTime:lt,chatPath:pathName};
      }else if(allChatUsers[uid]){
        allChatUsers[uid].unread+=ur;
      }
    });
  }
  
  /* Helper function to render chat user list */
  function renderChatList(){
    var ls=document.getElementById('chatUserList');ls.innerHTML='';
    var users=Object.keys(allChatUsers).map(function(uid){
      return {uid:uid,...allChatUsers[uid]};
    });
    
    if(users.length===0){
      ls.innerHTML='<div class="chat-empty" style="padding:30px 0"><i class="fas fa-comments"></i><span class="text-xs">No conversations</span></div>';
      return;
    }
    
    users.sort(function(a,b){return b.lastTime-a.lastTime});
    users.forEach(function(u){
      var ini=(u.userName||u.uid).charAt(0).toUpperCase(),ts=u.lastTime?formatChatTime(u.lastTime):'';
      ls.innerHTML+='<div class="chat-user-item '+(activeChatUid===u.uid?'active':'')+'" onclick="openChat(\''+u.uid+'\')"><div class="chat-avatar">'+ini+'</div><div class="chat-user-info"><div class="chat-user-name"><span>'+(u.userName||u.uid.substring(0,12))+'</span><span class="chat-time">'+ts+'</span></div><div class="chat-user-preview">'+u.lastMsg+'</div></div>'+(u.unread>0?'<div class="chat-unread-dot">'+u.unread+'</div>':'')+'</div>';
    });
  }
  
  /* Listen to PRIMARY path: supportChats/ */
  rtdb.ref(CHAT_PATH_PRIMARY).on('value',function(snap){
    allChatUsers={};  /* Reset on each update */
    processChatSnapshot(snap, CHAT_PATH_PRIMARY);
    
    /* Also check SECONDARY path: support/ */
    rtdb.ref(CHAT_PATH_SECONDARY).once('value',function(snap2){
      processChatSnapshot(snap2, CHAT_PATH_SECONDARY);
      renderChatList();
    });
  });
  
  /* Also listen to SECONDARY path: support/ for real-time updates */
  rtdb.ref(CHAT_PATH_SECONDARY).on('value',function(snap){
    console.log('Secondary chat path ('+CHAT_PATH_SECONDARY+'/) updated');
    /* Refresh the primary listener which will merge both */
    rtdb.ref(CHAT_PATH_PRIMARY).once('value',function(snap2){
      allChatUsers={};
      processChatSnapshot(snap2, CHAT_PATH_PRIMARY);
      processChatSnapshot(snap, CHAT_PATH_SECONDARY);
      renderChatList();
    });
  });
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
  markAsRead(CHAT_PATH_SECONDARY);
  
  /* FIX Bug#9: Properly detach previous Firebase listener.
     ORIGINAL BUG: chatListener was set to the return value of ref.on()
     which is the callback function itself. Calling chatListener() just
     re-invokes the callback — it does NOT unsubscribe. Listeners accumulate.
     FIX: chatListener is now always set to a proper cleanup closure. */
  if(typeof chatListener === 'function') chatListener();
  
  /* Listen to BOTH paths and merge messages */
  function renderMessages(){
    var me=document.getElementById('chatMessages');if(!me)return;
    var allMessages=[];
    
    function fetchAndRender(){
      /* FIX: Read from support/{uid}/messages — same path user writes to */
      Promise.all([
        rtdb.ref('support/'+uid+'/messages').orderByChild('createdAt').once('value'),
        rtdb.ref(CHAT_PATH_SECONDARY+'/'+uid).once('value')
      ]).then(function(results){
        allMessages=[];
        /* Primary: support/{uid}/messages */
        if(results[0].exists()){
          results[0].forEach(function(ms){
            allMessages.push({key:ms.key,...ms.val()});
          });
        }
        /* Secondary: chats/{uid} — fallback for old messages */
        if(results[1].exists()){
          results[1].forEach(function(ms){
            var m={key:ms.key,...ms.val()};
            if(!allMessages.find(function(x){return x.text===m.text&&Math.abs((x.createdAt||x.timestamp||0)-(m.createdAt||m.timestamp||0))<2000})){
              allMessages.push(m);
            }
          });
        }
        
        if(allMessages.length===0){
          me.innerHTML='<div class="chat-empty"><i class="fas fa-comment-dots"></i><span class="text-xs">No messages</span></div>';
          return;
        }
        
        /* Sort by timestamp */
        allMessages.sort(function(a,b){return (a.timestamp||0)-(b.timestamp||0)});
        
        me.innerHTML='';
        var ld='';
        allMessages.forEach(function(m){
          var ia=isAdminMsg(m),ts=m.timestamp?new Date(m.timestamp):null,ds=ts?ts.toLocaleDateString():'';
          if(ds&&ds!==ld){ld=ds;me.innerHTML+='<div style="text-align:center;padding:6px;font-size:9px;color:var(--text-muted)">'+eh(ds)+'</div>';}
          var tm=ts?ts.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
          var msgText=eh(m.message||m.text||''); /* SECURITY: escape user-typed message */
          me.innerHTML+='<div class="chat-bubble '+(ia?'admin':'user')+'">'+msgText+'<div class="time">'+eh(tm)+(ia?' <i class="fas fa-check-double" style="color:var(--primary)"></i>':'')+'</div></div>';
        });
        me.scrollTop=me.scrollHeight;
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
      adminUid: auth.currentUser.uid
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
async function loadSupportTickets(filter){
  filter=filter||'open';
  var el=document.getElementById('supportTicketsList');
  if(!el)return;
  el.innerHTML='<p class="text-muted text-xs text-center" style="padding:12px"><i class="fas fa-spinner fa-spin"></i> Loading...</p>';
  try{
    var snap=await rtdb.ref('supportRequests').orderByChild('createdAt').once('value');
    var tickets=[];
    snap.forEach(function(c){var t=c.val();t._key=c.key;tickets.push(t);});
    tickets.sort(function(a,b){return(b.createdAt||0)-(a.createdAt||0);});
    if(filter!=='all')tickets=tickets.filter(function(t){return(t.status||'open')===filter;});
    var openCount=0;
    snap.forEach(function(c){if((c.val().status||'open')==='open')openCount++;});
    var badge=document.getElementById('ticketBadge');
    if(badge)badge.textContent=openCount||'';
    if(tickets.length===0){el.innerHTML='<p class="text-muted text-xs text-center" style="padding:12px">No tickets found.</p>';return;}
    var html='';
    tickets.forEach(function(t){
      var st=t.status||'open';
      var safeUser=t.userId||'';
      var safeKey=t._key||'';
      var safeMsg=(t.message||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').substring(0,120);
      var safeReply=(t.adminReply||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var dt=t.createdAt?new Date(t.createdAt).toLocaleString():'';
      var stColor=st==='open'?'red':st==='replied'?'blue':'green';
      html+='<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px;margin-bottom:8px;border-left:3px solid var(--'+stColor+')">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
          '<div style="font-size:11px;font-weight:700">'+(t.userName||t.userId||'User')+'</div>'+
          '<div style="display:flex;gap:4px;align-items:center">'+
            '<span class="badge '+stColor+'">'+st+'</span>'+
            '<span style="font-size:10px;color:var(--text-muted)">'+dt+'</span>'+
          '</div>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">'+safeMsg+'</div>'+
        (safeReply?'<div style="font-size:10px;color:var(--info);background:rgba(0,212,255,.08);padding:6px 8px;border-radius:6px;margin-bottom:6px"><i class="fas fa-reply"></i> Admin: '+safeReply+'</div>':'')+
        '<div style="display:flex;gap:6px;align-items:center">'+
          (st!=='closed'?
            '<button class="btn btn-primary btn-xs" onclick="replyTicket(this)" data-key="'+safeKey+'" data-user="'+safeUser+'"><i class="fas fa-reply"></i> Reply</button>'+
            '<button class="btn btn-ghost btn-xs" onclick="closeTicket(this,false)" data-key="'+safeKey+'" style="color:var(--success)"><i class="fas fa-check"></i> Close</button>':
            '<button class="btn btn-ghost btn-xs" onclick="closeTicket(this,true)" data-key="'+safeKey+'" style="color:var(--text-muted)"><i class="fas fa-redo"></i> Reopen</button>'
          )+
        '</div>'+
      '</div>';
    });
    el.innerHTML=html;
  }catch(e){el.innerHTML='<p class="text-danger text-xs text-center" style="padding:12px">Error: '+e.message+'</p>';}
}


async function replyTicket(btnEl,ticketId,userId){
  var key=ticketId||(btnEl&&btnEl.dataset?btnEl.dataset.key:'');
  var uid=userId||(btnEl&&btnEl.dataset?btnEl.dataset.user:'');
  if(!key)return;
  var msg=prompt('Enter reply:');
  if(!msg||!msg.trim())return;
  try{
    var snap=await rtdb.ref('supportRequests/'+key).once('value');
    var t=snap.val();
    await rtdb.ref('supportRequests/'+key).update({adminReply:msg.trim(),status:'replied',repliedAt:Date.now()});
    if(uid)await rtdb.ref(DB_USERS+'/'+uid+'/notifications').push({title:'Support Reply',message:msg.trim(),timestamp:Date.now(),read:false});
    await rtdb.ref('activityLogs').push({type:'ticket_replied',ticketId:key,admin:auth.currentUser.uid,timestamp:Date.now()});
    showToast('Reply sent!');
    loadSupportTickets(document.getElementById('ticketFilter')?document.getElementById('ticketFilter').value:'open');
  }catch(e){showToast('Error: '+e.message,true);}
}


async function closeTicket(btnEl,reopen){
  var key=btnEl&&btnEl.dataset?btnEl.dataset.key:'';
  if(!key)return;
  var newStatus=reopen?'open':'closed';
  try{
    await rtdb.ref('supportRequests/'+key).update({status:newStatus,closedAt:Date.now()});
    showToast(reopen?'Ticket reopened!':'Ticket closed!');
    loadSupportTickets(document.getElementById('ticketFilter')?document.getElementById('ticketFilter').value:'open');
  }catch(e){showToast('Error: '+e.message,true);}
}


async function sendGlobalNotification(){
  var t=document.getElementById('globalNotifTitle').value.trim(),m=document.getElementById('globalNotifMsg').value.trim();
  if(!t||!m)return showToast('Title & message required',true);
  var btn=document.getElementById('sendGlobalBtn');
  setLoading(btn,true);
  try{
    var s=await rtdb.ref(DB_USERS).once('value');var p=[];
    s.forEach(function(c){p.push(rtdb.ref(DB_USERS+'/'+c.key+'/notifications').push({title:t,message:m,timestamp:Date.now(),read:false,type:'global'}));});
    await Promise.all(p);
    /* FIX Bug#3 / BUG #26-followup (2026-07): route through _adminNotifyAll,
       which now calls the admin-checked admin_send_broadcast_notification RPC
       (notifications.target_all is no longer directly client-INSERT-able). */
    if(window._adminNotifyAll&&t&&m){
      window._adminNotifyAll(t,m,'global_broadcast');
    }
    document.getElementById('globalNotifTitle').value='';document.getElementById('globalNotifMsg').value='';
    setLoading(btn,false);
    showToast('✅ Sent to '+s.numChildren()+' users');
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
      sentBy:auth.currentUser.uid
    });
    /* Also log to global notifications */
    await rtdb.ref('notifications').push({
      uid:uid,
      userName:us.val().ign||'Unknown',
      title:'Custom: '+title,
      message:msg,
      type:'custom_admin',
      createdAt:Date.now(),
      adminUid:auth.currentUser.uid
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
function loadMaintenanceState(){rtdb.ref('appSettings/maintenance').on('value',function(s){var on=s.val()===true;document.getElementById('maintToggle').checked=on;var b=document.getElementById('maintBanner');if(on)b.classList.add('show');else b.classList.remove('show');});}
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
async function toggleMaintenance(){var on=document.getElementById('maintToggle').checked;try{await rtdb.ref('appSettings/maintenance').set(on);showToast('Maintenance '+(on?'ON':'OFF'));}catch(e){showToast('Error: '+e.message,true);}}

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
      updatedBy: auth.currentUser ? auth.currentUser.email : 'admin'
    });
    var banner = document.getElementById('tdsBanner');
    var offBanner = document.getElementById('tdsOffBanner');
    if (banner) banner.style.display = on ? 'block' : 'none';
    if (offBanner) offBanner.style.display = on ? 'none' : 'block';
    /* Activity log */
    await rtdb.ref('activityLogs').push({
      type: 'tds_toggle', action: on ? 'TDS_ENABLED' : 'TDS_DISABLED',
      admin: auth.currentUser ? auth.currentUser.email : 'admin',
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
   ════════════════════════════════════════════════ */
function loadPreviewState() {
  rtdb.ref('appSettings/previewMode').on('value', function(s) {
    var cfg = s.val() || {};
    var on = cfg.active === true;
    var tog = document.getElementById('previewToggle');
    if (tog) tog.checked = on;
    var ab = document.getElementById('previewActiveBanner');
    var ob = document.getElementById('previewOffBanner');
    if (ab) ab.style.display = on ? 'block' : 'none';
    if (ob) ob.style.display = on ? 'none' : 'block';
    /* Fill message & date */
    var msgEl = document.getElementById('previewMessage');
    var dtEl  = document.getElementById('previewLaunchDate');
    if (msgEl && cfg.message) msgEl.value = cfg.message;
    if (dtEl  && cfg.launchDate) dtEl.value = cfg.launchDate;
  });
  /* Early user counts */
  rtdb.ref('earlyAccessUsers').once('value', function(s) {
    var total = 0, today = 0;
    var todayStart = new Date(); todayStart.setHours(0,0,0,0);
    if (s.exists()) {
      s.forEach(function(c) {
        total++;
        var d = c.val();
        if ((d.joinedAt||0) >= todayStart.getTime()) today++;
      });
    }
    var te = document.getElementById('earlyTotalCount');
    var td = document.getElementById('earlyTodayCount');
    if (te) te.textContent = total;
    if (td) td.textContent = today;
  });
}

async function togglePreviewMode() {
  var on = document.getElementById('previewToggle').checked;
  var msg = (document.getElementById('previewMessage')||{}).value || '';
  var dt  = (document.getElementById('previewLaunchDate')||{}).value || '';
  try {
    await rtdb.ref('appSettings/previewMode').update({
      active: on,
      message: msg || "We\'re putting the finishing touches on something amazing. Stay tuned!",
      launchDate: dt,
      updatedAt: Date.now(),
      updatedBy: auth.currentUser ? auth.currentUser.email : 'admin'
    });
    var ab = document.getElementById('previewActiveBanner');
    var ob = document.getElementById('previewOffBanner');
    if (ab) ab.style.display = on ? 'block' : 'none';
    if (ob) ob.style.display = on ? 'none' : 'block';
    await rtdb.ref('activityLogs').push({
      type: 'preview_mode_toggle',
      action: on ? 'PREVIEW_ENABLED' : 'PREVIEW_DISABLED',
      admin: auth.currentUser ? auth.currentUser.email : 'admin',
      timestamp: Date.now()
    });
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
    await rtdb.ref('appSettings/previewMode').update({
      active: on,
      message: msg || "We\'re putting the finishing touches on something amazing. Stay tuned!",
      launchDate: dt,
      updatedAt: Date.now()
    });
    showToast('✅ Preview settings saved!');
  } catch(e) {
    showToast('Error: ' + e.message, true);
  }
}

function viewEarlyUsers() {
  rtdb.ref('earlyAccessUsers').orderByChild('joinedAt').limitToLast(100).once('value', function(s) {
    var users = [];
    if (s.exists()) s.forEach(function(c) { users.push(c.val()); });
    users.reverse();

    var h = '<div style="margin-bottom:12px;font-size:12px;color:#888">' + users.length + ' early access users registered</div>';
    if (users.length === 0) {
      h += '<div style="text-align:center;padding:20px;color:#555">Abhi koi user nahi</div>';
    } else {
      h += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
      h += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.1)">';
      ['Name','Email','Platform','Joined'].forEach(function(c) {
        h += '<th style="padding:6px 8px;text-align:left;color:#888;font-weight:700">' + c + '</th>';
      });
      h += '</tr></thead><tbody>';
      users.forEach(function(u) {
        var dt = new Date(u.joinedAt||0).toLocaleDateString('en-IN');
        var tm = new Date(u.joinedAt||0).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'});
        h += '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">';
        h += '<td style="padding:8px;font-weight:700;color:#fff">' + (u.name||'—') + '</td>';
        h += '<td style="padding:8px;color:#888">' + (u.email||'—') + '</td>';
        h += '<td style="padding:8px"><span style="background:rgba(0,212,255,.1);color:#00d4ff;padding:2px 8px;border-radius:10px;font-size:10px">' + (u.platform||'web') + '</span></td>';
        h += '<td style="padding:8px;color:#666">' + dt + ' ' + tm + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    }
    showModal('🚀 Early Access Users', h);
  });
}
async function saveGlobalMessage(){try{var gMsg=document.getElementById('settGlobalMsg').value.trim();await rtdb.ref('appSettings/banner').set(gMsg||null);await rtdb.ref('appSettings/globalMessage').set(gMsg||null);await rtdb.ref('appSettings/ticker').set(gMsg||null);showToast('Saved!');}catch(e){showToast('Error: '+e.message,true);}}
async function clearGlobalMessage(){try{await rtdb.ref('appSettings/banner').set(null);await rtdb.ref('appSettings/globalMessage').set(null);await rtdb.ref('appSettings/ticker').set(null);document.getElementById('settGlobalMsg').value='';showToast('Cleared!');}catch(e){showToast('Error: '+e.message,true);}}
async function saveSpectateLink(){try{await rtdb.ref('appSettings/spectateLink').set(document.getElementById('settSpectateLink').value.trim());showToast('Saved!');}catch(e){showToast('Error: '+e.message,true);}}

/* ─── AD REWARDS SETTINGS ─── */
async function saveAdRewards() {
  try {
    var data = {
      adsForDiamond:    Number(document.getElementById('adRewardAdsForDia').value)      || 3,
      diamondPerSession:Number(document.getElementById('adRewardDiaPerSession').value)  || 1,
      dailyAdLimit:     Number(document.getElementById('adRewardDailyAdLimit').value)   || 10,
      coinsPerAd:       Number(document.getElementById('adRewardCoinsPerAd').value)     || 5,
      dailyCoinAdLimit: Number(document.getElementById('adRewardCoinDailyLimit').value) || 20,
      updatedAt: Date.now()
    };
    await rtdb.ref('appSettings/adRewards').set(data);
    var msg = document.getElementById('adRewardSaveMsg');
    if (msg) { msg.style.display = 'inline'; setTimeout(function(){ msg.style.display='none'; }, 3000); }
    showToast('✅ Ad Reward Settings saved!');
  } catch(e) { showToast('Error: ' + e.message, true); }
}
async function loadAdRewards() {
  try {
    var snap = await rtdb.ref('appSettings/adRewards').once('value');
    var d = snap.val() || {};
    var set = function(id, val, def) { var el=document.getElementById(id); if(el) el.value = val||def; };
    set('adRewardAdsForDia',      d.adsForDiamond,    3);
    set('adRewardDiaPerSession',  d.diamondPerSession, 1);
    set('adRewardDailyAdLimit',   d.dailyAdLimit,     10);
    set('adRewardCoinsPerAd',     d.coinsPerAd,        5);
    set('adRewardCoinDailyLimit', d.dailyCoinAdLimit, 20);
  } catch(e) { console.error('loadAdRewards:', e); }
}

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
  document.getElementById('section-'+sec).classList.add('active');
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
  if(sec==='teams')loadTeamRequests();
  if(sec==='support'){loadSupportChats();loadSupportTickets('open');}
  if(sec==='wallets')renderWalletRequests();
  if(sec==='users')renderUsers();
  if(sec==='settings'){loadSettings();loadVouchers();loadAdRewards();} if(sec==='skyDiamondRequests'){loadSkyDiamondReqSection();} if(sec==='premiumRequests'){loadPremiumReqSection();} if(sec==='seasonPass'){loadSeasonPassSection();} if(sec==='attendance'){window._loadAttSection&&window._loadAttSection();}
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
function loadDisputes() {
  var tb = document.getElementById('disputesTable');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';
  rtdb.ref('disputes').orderByChild('createdAt').limitToLast(100).once('value', function(snap) {
    if (!snap.exists()) {
      tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#aaa">No disputes found</td></tr>';
      document.getElementById('disputeCount').textContent = 0;
      return;
    }
    var rows = [];
    snap.forEach(function(c) { rows.push({ id: c.key, d: c.val() }); });
    rows.reverse(); // newest first
    var pending = rows.filter(function(r) { return r.d.status === 'pending'; }).length;
    document.getElementById('disputeCount').textContent = rows.length;
    updateBadge('disputesBadge', pending);
    tb.innerHTML = '';
    rows.forEach(function(r) {
      var d = r.d, id = r.id;
      var ts = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'}) : '—';
      var typeLabels = { wrong_rank: 'Wrong Rank', missing_kills: 'Kills Wrong', not_credited: 'Prize Missing', other: 'Other' };
      var sb = d.status === 'resolved' ? 'green' : d.status === 'rejected' ? 'red' : 'yellow';
      var ssCell = d.screenshot
        ? '<a href="' + d.screenshot + '" target="_blank" style="color:var(--info);font-size:10px"><i class="fas fa-image"></i> View</a>'
        : '<span style="color:#666;font-size:10px">—</span>';
      var acts = d.status === 'pending'
        ? '<button class="btn btn-primary btn-xs" onclick="resolveDispute(\'' + id + '\',\'resolved\')" title="Resolve"><i class="fas fa-check"></i></button> '
          + '<button class="btn btn-danger btn-xs" onclick="resolveDispute(\'' + id + '\',\'rejected\')" title="Reject"><i class="fas fa-times"></i></button>'
        : '<span style="color:#666;font-size:10px">' + d.status + '</span>';
      tb.innerHTML += '<tr>'
        + '<td><strong class="text-primary" style="font-size:11px">' + (d.userName || '—') + '</strong></td>'
        + '<td style="font-size:10px;color:#aaa;font-family:monospace">' + ((d.matchId||'').substring(0,10) + '…') + '</td>'
        + '<td><span class="badge yellow" style="font-size:9px">' + (typeLabels[d.type] || d.type || '—') + '</span></td>'
        + '<td style="font-weight:700;text-align:center">' + (d.claimedRank ? '#' + d.claimedRank : '—') + '</td>'
        + '<td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (d.message||'') + '">' + (d.message||'—') + '</td>'
        + '<td>' + ssCell + '</td>'
        + '<td style="font-size:10px;white-space:nowrap">' + ts + '</td>'
        + '<td><span class="badge ' + sb + '">' + (d.status||'pending') + '</span></td>'
        + '<td>' + acts + '</td>'
        + '</tr>';
    });
  });
}

async function resolveDispute(id, status) {
  if (!confirm('Mark dispute as ' + status + '?')) return;
  try {
    await rtdb.ref('disputes/' + id).update({ status: status, resolvedAt: Date.now(), resolvedBy: 'admin' });
    showToast('✅ Dispute marked as ' + status);
    loadDisputes();
  } catch(e) { showToast('❌ ' + e.message, true); }
}

/* ═══ END DISPUTES ═══ */

/* ═══ FIX: renderProfileUpdates DB path ═══ */
/* profileUpdates data is in 'profileUpdateRequests' but listener uses it correctly */

/* =============================================
   COIN REQUESTS — Admin approve/reject
   ============================================= */
async function loadCoinRequests() {
  var list = document.getElementById('coinRequestsList');
  if (!list) return;
  list.innerHTML = '<p class="text-muted text-xs"><div class="sp-spinner"></div></p>';
  try {
    var snap = await rtdb.ref('coinRequests').orderByChild('status').equalTo('pending').once('value');
    var html = '';
    var count = 0;
    snap.forEach(function(c) {
      var r = c.val(), id = c.key;
      count++;
      html += '<div class="card mt-2" style="padding:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
          '<div>' +
            '<div style="font-weight:700;font-size:13px">' + (r.ign||'Unknown') + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">' + (r.note||'') + '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-size:20px;font-weight:900;color:var(--warning)">🪙 ' + r.coins + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted)">₹' + r.price + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-primary btn-sm" style="flex:1" data-req="' + id + '" data-uid="' + r.userId + '" data-coins="' + r.coins + '" onclick="var b=this;approveCoinRequest(b.dataset.req,b.dataset.uid,Number(b.dataset.coins))"><i class="fas fa-check"></i> Approve (+' + r.coins + ' coins)</button>' +
          '<button class="btn btn-danger btn-sm" data-req="' + id + '" onclick="rejectCoinRequest(this.dataset.req)"><i class="fas fa-times"></i></button>' +
        '</div>' +
      '</div>';
    });
    var badge = document.getElementById('coinReqBadge');
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'flex' : 'none'; }
    list.innerHTML = count > 0 ? html : '<p class="text-muted text-xs text-center" style="padding:20px">No pending coin requests</p>';
  } catch(e) { list.innerHTML = '<p class="text-muted text-xs">Error: ' + e.message + '</p>'; }
}

async function approveCoinRequest(reqId, userId, coins) {
  if (!confirm('Add ' + coins + ' coins to user ' + userId.substring(0,8) + '?')) return;
  try {
    await rtdb.ref(DB_USERS + '/' + userId + '/coins').transaction(function(v) { return (v||0) + coins; });
    await rtdb.ref('coinRequests/' + reqId).update({ status: 'approved', processedAt: Date.now(), processedBy: auth.currentUser.uid });
    await rtdb.ref(DB_USERS + '/' + userId + '/notifications').push({
      title: '🪙 Coins Added!',
      message: coins + ' coins aapke wallet mein add ho gaye!',
      timestamp: Date.now(), read: false, type: 'coin_purchase'
    });
    await rtdb.ref('platformStats/totalCoinRevenue').transaction(function(v) { return (v||0) + (coins||0); });
    /* FIX Bug#17: Sync coin approval to Supabase — user-app reads coins from Supabase */
    if(window._supa && userId && coins > 0){
      /* Increment coins balance via RPC */
      window._supa.rpc('increment_balance',{p_uid:userId,p_col:'coins',p_amount:Number(coins)})
        .then(function(res){
          if(res&&res.error){
            /* ✅ BUG FIX (2026-07-17): coins is no longer directly
               UPDATE-able at all (see COMPLETE_SCHEMA.sql's users GRANT
               block — it was a severe balance-tampering hole affecting
               every user, not admin-specific), so the old fallback below
               (a direct read-then-write) would always fail too, silently,
               leaving the admin with no idea the credit never happened.
               Surfacing the real error instead of attempting a doomed
               fallback. */
            console.error('[Bug#17 Fix] approveCoinRequest RPC failed:',res.error.message);
            if(window.showToast)showToast('❌ Coins credit fail hui: '+res.error.message+' — dobara try karo',true);
          }
        });
      /* Log wallet transaction for audit trail */
      window._supa.from('wallet_transactions').insert({
        user_id:userId,txn_type:'credit',amount:Number(coins),
        currency:'coins',reason:'Coin purchase approved by admin',
        ref_id:reqId,created_at:new Date().toISOString()
      }).catch(function(e){console.warn('[Bug#17 Fix] wallet_transaction insert:',e.message);});
      /* Supabase notification — BUG #26-followup FIX (2026-07): RPC-backed */
      if(window._adminNotifyUser){
        window._adminNotifyUser(userId,{type:'wallet_update',title:'🪙 Coins Added!',message:coins+' coins aapke wallet mein add ho gaye!'});
      }
    }
    showToast('✅ ' + coins + ' coins added!');
    loadCoinRequests();
    refreshDashboard();
  } catch(e) { showToast('Error: ' + e.message, true); }
}

async function rejectCoinRequest(reqId) {
  await rtdb.ref('coinRequests/' + reqId).update({ status: 'rejected', processedAt: Date.now() });
  showToast('Rejected.');
  loadCoinRequests();
}


/* =============================================
   MATCH TEMPLATES SYSTEM
   Admin tournament form me save/load/delete templates
   Firebase: matchTemplates/{templateId}
   ============================================= */

function loadTemplates() {
  var list = document.getElementById('templateList');
  if (!list) return;
  rtdb.ref('matchTemplates').once('value', function(s) {
    if (!s.exists()) {
      list.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">No templates — fill form aur "Save Template" dabao</span>';
      return;
    }
    var html = '';
    s.forEach(function(c) {
      var t = c.val(), id = c.key;
      html += '<div class="tpl-chip" data-tid="' + id + '">' +
        '<span class="tpl-name" onclick="applyTemplate(this.parentNode.dataset.tid)">' + (t.name||'') + ' <span style="font-size:9px;opacity:.6">' + (t.gameMode||'') + '</span></span>' +
        '<span class="tpl-del" onclick="deleteTemplate(this.parentNode.dataset.tid)">✕</span>' +
        '</div>';
    });
    list.innerHTML = html;
  });
}

function saveAsTemplate() {
  var nm = document.getElementById('tName') ? document.getElementById('tName').value.trim() : '';
  var tplName = nm || ('Template ' + new Date().toLocaleDateString('en-IN'));
  
  var tpl = {
    name: tplName,
    gameMode: (document.getElementById('tGameMode')||{}).value || 'solo',
    map: (document.getElementById('tMap')||{}).value || 'Bermuda',
    entryType: (document.getElementById('tEntryType')||{}).value || 'paid',
    entryFee: Number((document.getElementById('tEntryFee')||{}).value) || 0,
    perKillPrize: Number((document.getElementById('tPerKill')||{}).value) || 0,
    
    maxSlots: Number((document.getElementById('tMaxSlots')||{}).value) || 12,
    firstPrize: Number((document.getElementById('tFirstPrize')||{}).value) || 0,
    secondPrize: Number((document.getElementById('tSecondPrize')||{}).value) || 0,
    thirdPrize: Number((document.getElementById('tThirdPrize')||{}).value) || 0,
    isSpecial: document.getElementById('tIsSpecial') ? document.getElementById('tIsSpecial').checked : false,
    savedAt: Date.now()
  };

  rtdb.ref('matchTemplates').push(tpl).then(function() {
    showToast('✅ Template "' + tplName + '" saved!');
    loadTemplates();
  }).catch(function(e) { showToast('Error: ' + e.message, true); });
}

function applyTemplate(id) {
  rtdb.ref('matchTemplates/' + id).once('value', function(s) {
    if (!s.exists()) { showToast('Template not found', true); return; }
    var t = s.val();
    
    /* Fill all form fields */
    if (document.getElementById('tName')) document.getElementById('tName').value = t.name || '';
    if (document.getElementById('tGameMode')) document.getElementById('tGameMode').value = t.gameMode || 'solo';
    if (document.getElementById('tMap')) document.getElementById('tMap').value = t.map || 'Bermuda';
    if (document.getElementById('tEntryType')) { document.getElementById('tEntryType').value = t.entryType || 'paid'; if(window.onEntryTypeChange) onEntryTypeChange(); }
    if (document.getElementById('tEntryFee')) document.getElementById('tEntryFee').value = t.entryFee || 0;
    // prizePool auto-calc from prizes
    
    if (document.getElementById('tMaxSlots')) document.getElementById('tMaxSlots').value = t.maxSlots || 12;
    if (document.getElementById('tFirstPrize')) document.getElementById('tFirstPrize').value = t.firstPrize || 0;
    if (document.getElementById('tSecondPrize')) document.getElementById('tSecondPrize').value = t.secondPrize || 0;
    if (document.getElementById('tThirdPrize')) document.getElementById('tThirdPrize').value = t.thirdPrize || 0;
    if (document.getElementById('tIsSpecial') && t.isSpecial !== undefined) document.getElementById('tIsSpecial').checked = t.isSpecial;
    /* Clear time and room fields — these are always fresh */
    if (document.getElementById('tMatchTime')) document.getElementById('tMatchTime').value = '';
    if (document.getElementById('tRoomId')) document.getElementById('tRoomId').value = '';
    if (document.getElementById('tRoomPass')) document.getElementById('tRoomPass').value = '';
    
    showToast('✅ Template applied! Time aur Room ID add karo.');
  });
}

function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  rtdb.ref('matchTemplates/' + id).remove().then(function() {
    showToast('Template deleted');
    loadTemplates();
  });
}


/* =============================================
   VERIFY CHECKBOX — Admin marks player as verified in room
   Firebase: joinRequests/{reqKey}/adminVerified = true/false
   ============================================= */
async function toggleVerify(reqKey, el) {
  if (!reqKey) return;
  var wrap = el.classList.contains('verify-chk-wrap') ? el : el.closest('.verify-chk-wrap,.tm-vchk');
  if (!wrap) wrap = el;
  var icon = wrap.querySelector('i');
  var isVerified = wrap.style.borderColor.includes('00ff9c') || wrap.dataset.verified === 'true';
  var newState = !isVerified;
  
  /* Optimistic UI update */
  wrap.style.borderColor = newState ? '#00ff9c' : 'rgba(255,255,255,.2)';
  wrap.style.background = newState ? 'rgba(0,255,156,.12)' : 'rgba(255,255,255,.04)';
  if (icon) icon.style.color = newState ? '#00ff9c' : 'rgba(255,255,255,.2)';
  wrap.dataset.verified = newState ? 'true' : 'false';
  
  /* Save to Firebase */
  try {
    await rtdb.ref('joinRequests/' + reqKey).update({
      adminVerified: newState,
      verifiedAt: newState ? Date.now() : null,
      verifiedBy: auth.currentUser ? auth.currentUser.uid : 'admin'
    });
    /* FIX Bug#25: Sync verified status to Supabase — user-app reads join_requests.checked_in */
    if(window._supa){
      window._supa.from('join_requests').update({
        checked_in:newState,
        in_room:newState,
        checked_in_at:newState?new Date().toISOString():null
      }).eq('id',reqKey)
        .catch(function(e){console.warn('[Bug#25 Fix] toggleVerify Supabase sync:',e.message);});
    }
    showToast(newState ? '✅ Player verified!' : 'Verification removed');
  } catch(e) {
    showToast('Error: ' + e.message, true);
    /* Revert on error */
    wrap.style.borderColor = isVerified ? '#00ff9c' : 'rgba(255,255,255,.2)';
    wrap.style.background = isVerified ? 'rgba(0,255,156,.12)' : 'rgba(255,255,255,.04)';
    if (icon) icon.style.color = isVerified ? '#00ff9c' : 'rgba(255,255,255,.2)';
  }
}

/* ====== FIX MISSING TEAMMATE JOIN REQUESTS ====== */
/* Scans all joinRequests for duo/squad captains and creates missing teammate JRs */
async function fixMissingTeammateJRs() {
  if (!confirm('Yeh scan karega sab active duo/squad captain JRs aur missing teammate entries create karega. Continue?')) return;
  showToast('Scanning...', 'info');
  
  var snap = await rtdb.ref('joinRequests').once('value');
  var allJRs = snap.val() || {};
  
  // Group by matchId+captainUid to find who already has team JRs
  var captainJRs = {};
  var existingTeamJRs = {}; // key = matchId+userId
  
  Object.keys(allJRs).forEach(function(k) {
    var jr = allJRs[k];
    if (!jr || !jr.matchId) return;
    var st = (jr.status || '').toLowerCase();
    if (st === 'cancelled') return;
    
    if (!jr.isTeamMember && (jr.mode === 'duo' || jr.mode === 'squad')) {
      // Captain entry
      var key = jr.matchId + '_' + jr.userId;
      captainJRs[key] = { k: k, jr: jr };
    }
    if (jr.isTeamMember && jr.captainUid) {
      // Teammate entry already exists
      existingTeamJRs[jr.matchId + '_' + jr.userId] = true;
    }
  });
  
  var created = 0;
  var errors = 0;
  
  for (var capKey in captainJRs) {
    var entry = captainJRs[capKey];
    var jr = entry.jr;
    var teamMembers = jr.teamMembers || [];
    if (teamMembers.length <= 1) continue; // solo effectively
    
    // Find members who are NOT the captain
    var members = teamMembers.filter(function(m) { return m.uid !== (jr.userFFUID || '') && m.role !== 'captain'; });
    
    for (var mi = 0; mi < members.length; mi++) {
      var m = members[mi];
      var mFfUid = m.uid || m.ffUid || '';
      if (!mFfUid) continue;
      
      // Look up Firebase UID by FF UID
      try {
        var userSnap = await rtdb.ref('users').orderByChild('ffUid').equalTo(mFfUid).once('value');
        if (!userSnap.exists()) { errors++; continue; }
        var fbKey = null;
        userSnap.forEach(function(c) { fbKey = c.key; });
        if (!fbKey) { errors++; continue; }
        
        // Check if JR already exists for this player in this match
        var alreadyKey = jr.matchId + '_' + fbKey;
        if (existingTeamJRs[alreadyKey]) continue; // already exists
        
        // Check in allJRs
        var alreadyHas = Object.keys(allJRs).some(function(k2) {
          var j2 = allJRs[k2];
          return j2 && j2.matchId === jr.matchId && j2.userId === fbKey && (j2.status || '') !== 'cancelled';
        });
        if (alreadyHas) continue;
        
        // Create the missing teammate JR
        var pjid = rtdb.ref('joinRequests').push().key;
        var allSlots = jr.allSlots || null;
        var pSlot = allSlots ? (allSlots[mi + 1] || allSlots[0]) : null;
        
        await rtdb.ref('joinRequests/' + pjid).set({
          requestId: pjid,
          userId: fbKey,
          userName: m.name || '',
          userFFUID: mFfUid,
          displayName: m.name || '',
          matchId: jr.matchId,
          matchName: jr.matchName || '',
          entryFee: 0,
          entryType: jr.entryType || 'money',
          mode: jr.mode || 'duo',
          status: 'joined',
          slotsBooked: 0,
          teamMembers: jr.teamMembers,
          captainUid: jr.userId,
          captainName: jr.userName || '',
          slotNumber: pSlot || null,
          allSlots: allSlots,
          isTeamMember: true,
          fixedByAdmin: true,
          createdAt: Date.now()
        });
        
        // Notify the user
        var notifId = rtdb.ref('users/' + fbKey + '/notifications').push().key;
        await rtdb.ref('users/' + fbKey + '/notifications/' + notifId).set({
          type: 'team_joined',
          title: '🎮 Team Entry Fixed!',
          body: 'Admin ne tumhari "' + (jr.matchName||'match') + '" ki entry fix kar di. Tum team mein ho!',
          matchId: jr.matchId,
          read: false,
          createdAt: Date.now()
        });
        
        existingTeamJRs[alreadyKey] = true; // mark as done
        created++;
      } catch(e) {
        console.error('Fix JR error:', e);
        errors++;
      }
    }
  }
  
  showToast('✅ Fix complete! Created: ' + created + ' entries' + (errors > 0 ? ', Errors: ' + errors : ''), errors > 0 ? 'warning' : 'success');
  if (created > 0) refreshJoinedPlayers();
}

window.showResultPublisher = window.showResultPublisher || function(mid, matchName) {
  /* ✅ FIX (Audit M6): pehle yahan document.querySelector('.nav-item[onclick*="results"]')
     tha — koi bhi sidebar nav-item ke onclick mein literal "results" substring nahi
     hai (yeh section sidebar mein permanent slot ke bina, sirf match se "Publish Result"
     click karne par khulta hai by design), isliye yeh hamesha null hi return karta tha.
     showSection() null-safe hai (crash nahi hota), bas dead/misleading code tha — clean kar diya. */
  showSection('results', null);
  setTimeout(function() {
    var sel = document.getElementById('resultTournamentSelect');
    if (sel) { sel.value = mid; var ev = new Event('change'); sel.dispatchEvent(ev); }
  }, 400);
};

/* ===== CORRECT RESULT - FULL UI (inline override) ===== */
window.openResultCorrection = async function(matchId, userId, userName) {
  var rtdb = window.rtdb || window.db;
  if (!rtdb) return;
  var m = document.getElementById('genericModal'), mt = document.getElementById('genericModalTitle'), mb = document.getElementById('genericModalBody');
  if(!m || !mt || !mb) return;
  mt.innerHTML = '✏️ Correct Result';
  mb.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading player data...</div>';
  m.classList.add('show');
  try {
    var results = await Promise.all([
      rtdb.ref('matches/' + matchId).once('value'),
      rtdb.ref('results').orderByChild('userId').equalTo(userId).once('value'),
      rtdb.ref('users/' + userId).once('value'),
      rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value')
    ]);
    var match = results[0].val() || {};
    var resSnap = results[1], userSnap = results[2], jrSnap = results[3];
    var userData = userSnap.val() || {};
    var existRes = null, resKey = null;
    if(resSnap.exists()) resSnap.forEach(function(c){ var d=c.val(); if((d.matchId||d.tournamentId)===matchId){existRes=d;resKey=c.key;} });
    var jrData = null;
    if(jrSnap.exists()) jrSnap.forEach(function(c){ var d=c.val(); if(d.userId===userId) jrData=d; });
    var preRank = existRes ? (existRes.rank||0) : 0;
    var preKills = existRes ? (existRes.kills||0) : 0;
    var preTw = existRes ? (existRes.winnings||existRes.totalWinning||0) : 0;
    var preRp = existRes ? (existRes.rankPrize||0) : 0;
    var preKp = existRes ? (existRes.killPrize||0) : 0;
    var ffUid = userData.ffUid || '-';
    var slot = jrData ? (jrData.slotNumber||'-') : '-';
    var entryFee = jrData ? (jrData.entryFee||0) : (match.entryFee||0);
    var f1=match.firstPrize||0, f2=match.secondPrize||0, f3=match.thirdPrize||0;
    var pk=Number(match.perKillPrize)||0;
    window._rcMatchData = {f1:f1, f2:f2, f3:f3, pk:pk};
    var h = '<div style="padding:4px">';
    h += '<div style="background:rgba(0,212,255,.07);border:1px solid rgba(0,212,255,.18);border-radius:10px;padding:10px;margin-bottom:10px">';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">';
    h += '<div><div style="color:#888">👤 Player</div><strong style="color:#00d4ff">'+userName+'</strong></div>';
    h += '<div><div style="color:#888">🎮 FF UID</div><strong style="color:#00d4ff;font-family:monospace;font-size:10px">'+ffUid+'</strong></div>';
    h += '<div><div style="color:#888">🗂️ Match</div><strong style="color:#fff;font-size:10px">'+(match.name||matchId)+'</strong></div>';
    h += '<div><div style="color:#888">💰 Entry / Slot</div><strong style="color:#ffd700">₹'+entryFee+' / '+slot+'</strong></div>';
    h += '</div></div>';
    h += '<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.15);border-radius:8px;padding:8px;margin-bottom:10px;font-size:11px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">';
    h += '<span style="color:#ffd700;font-weight:700">🥇₹'+f1+'</span><span style="color:#c0c0c0;font-weight:700">🥈₹'+f2+'</span><span style="color:#cd7f32;font-weight:700">🥉₹'+f3+'</span>';
    if(pk) h += '<span style="color:#ff9c00;font-weight:700">💀₹'+pk+'/Kill</span>';
    h += '</div>';
    if(existRes){
      h += '<div style="background:rgba(255,100,0,.07);border:1px solid rgba(255,100,0,.2);border-radius:8px;padding:8px;margin-bottom:10px;font-size:11px">';
      h += '<div style="color:#ff9c00;font-weight:700;margin-bottom:4px">📋 Published Result:</div>';
      h += '<span style="margin-right:10px">Rank: <strong style="color:#fff">'+(preRank?'#'+preRank:'—')+'</strong></span>';
      h += '<span style="margin-right:10px">Kills: <strong style="color:#ff6b6b">'+preKills+'</strong></span>';
      h += '<span>Prize: <strong style="color:#00ff9c">₹'+preTw+'</strong>';
      if(preRp||preKp) h += ' <span style="color:#666;font-size:10px">(R:₹'+preRp+' K:₹'+preKp+')</span>';
      h += '</span></div>';
    }
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
    h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:5px">🎯 New Rank</label>';
    h += '<input type="number" id="rcRank" min="0" max="99" value="'+preRank+'" oninput="rcAutoCalc()" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid #333;color:#ffd700;font-size:18px;text-align:center;font-weight:800;box-sizing:border-box"></div>';
    h += '<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:5px">💀 New Kills</label>';
    h += '<input type="number" id="rcKills" min="0" value="'+preKills+'" oninput="rcAutoCalc()" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid #333;color:#ff6b6b;font-size:18px;text-align:center;font-weight:800;box-sizing:border-box"></div>';
    h += '</div>';
    h += '<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.18);border-radius:10px;padding:10px;margin-bottom:10px;text-align:center">';
    h += '<div style="font-size:11px;color:#aaa;margin-bottom:3px">Auto Calculated Prize</div>';
    h += '<div id="rcPrizeVal" style="font-size:24px;font-weight:800;color:#00ff9c">₹'+preTw+'</div>';
    h += '<div id="rcPrizeBreakdown" style="font-size:10px;color:#666;margin-top:2px"></div>';
    h += '</div>';
    h += '<div style="margin-bottom:12px"><label style="font-size:11px;color:#aaa;cursor:pointer;display:flex;align-items:center;gap:6px"><input type="checkbox" id="rcManualOverride" onchange="rcToggleManual()"> Manual prize override</label>';
    h += '<div id="rcManualWrap" style="display:none;margin-top:8px"><input type="number" id="rcPrize" min="0" placeholder="Override amount ₹" style="width:100%;padding:10px;border-radius:8px;background:#111;border:1px solid rgba(255,170,0,.3);color:#ffaa00;font-size:14px;text-align:center;box-sizing:border-box"></div></div>';
    h += '<button onclick="submitResultCorrection(\''+matchId+'\',\''+userId+'\',\''+encodeURIComponent(userName)+'\')" style="width:100%;padding:13px;border-radius:10px;background:linear-gradient(135deg,#ffaa00,#ff8800);color:#000;font-weight:800;border:none;cursor:pointer;font-size:14px"><i class="fas fa-save"></i> Save Correction</button>';
    h += '</div>';
    mb.innerHTML = h;
    setTimeout(function(){ if(window.rcAutoCalc) rcAutoCalc(); }, 50);
  } catch(e) {
    mb.innerHTML = '<div style="padding:20px;color:#f55">Error: '+e.message+'</div>';
  }
};

;

;

window.submitResultCorrection = async function(matchId, userId, userNameEncoded) {
  var userName=decodeURIComponent(userNameEncoded||'');
  var rank=Number((document.getElementById('rcRank')||{}).value)||0;
  var kills=Number((document.getElementById('rcKills')||{}).value)||0;
  var manualOn=document.getElementById('rcManualOverride')&&document.getElementById('rcManualOverride').checked;
  var manualAmt=Number((document.getElementById('rcPrize')||{}).value)||0;
  var d=window._rcMatchData||{};
  var rp=0; if(rank===1)rp=d.f1||0; else if(rank===2)rp=d.f2||0; else if(rank===3)rp=d.f3||0;
  var kp=kills*(d.pk||0), prize=manualOn?manualAmt:(rp+kp);
  if(!rank&&!kills&&!manualOn){if(window.showToast)showToast('❌ Rank ya Kills daalo',true);return;}
  try{
    var rtdb=window.rtdb||window.db;
    var resSnap=await rtdb.ref('results').orderByChild('userId').equalTo(userId).once('value');
    var resKey=null, oldPrize=0;
    if(resSnap.exists()) resSnap.forEach(function(c){var cv=c.val();if((cv.matchId||cv.tournamentId)===matchId){resKey=c.key;oldPrize=cv.winnings||cv.totalWinning||0;}});
    var upd={rank:rank,kills:kills,rankPrize:rp,killPrize:kp,winnings:prize,totalWinning:prize,correctedAt:Date.now(),correctedBy:'admin'};
    if(resKey) await rtdb.ref('results/'+resKey).update(upd);
    else await rtdb.ref('results').push(Object.assign({userId:userId,matchId:matchId,userName:userName,timestamp:Date.now()},upd));
    await rtdb.ref('matches/'+matchId+'/results/'+userId).update(upd);
    var delta=prize-oldPrize;
    if(delta!==0){
      await rtdb.ref('users/'+userId+'/realMoney/winnings').transaction(function(v){return Math.max(0,(v||0)+delta);});
      await rtdb.ref('users/'+userId+'/stats/earnings').transaction(function(v){return Math.max(0,(v||0)+delta);});
      await rtdb.ref('users/'+userId+'/totalWinnings').transaction(function(v){return Math.max(0,(v||0)+delta);});
      await rtdb.ref('users/'+userId+'/transactions').push({type:delta>0?'correction_credit':'correction_debit',amount:Math.abs(delta),description:'Result correction – Rank #'+rank+', '+kills+' kills',timestamp:Date.now()});
    }
    var jrQ=await rtdb.ref('joinRequests').orderByChild('matchId').equalTo(matchId).once('value');
    if(jrQ.exists()) jrQ.forEach(function(c){if(c.val().userId===userId) rtdb.ref('joinRequests/'+c.key).update({rank:rank,kills:kills,killPrize:kp,rankPrize:rp,reward:prize,resultStatus:'completed'});});
    var note='Result correction: Rank #'+rank+', '+kills+' kills → Prize ₹'+prize;
    if(rp||kp) note+=' (₹'+rp+' rank + ₹'+kp+' kills)';
    await rtdb.ref('users/'+userId+'/notifications').push({title:'🔧 Result Corrected',message:note,timestamp:Date.now(),read:false,type:'correction'});
    await rtdb.ref('adminActions').push({action:'result_correction',matchId:matchId,userId:userId,userName:userName,newRank:rank,newKills:kills,newPrize:prize,delta:delta,timestamp:Date.now()});
    if(window.showToast) showToast('✅ Corrected! Prize: ₹'+prize+(delta>0?' (+₹'+delta+')':delta<0?' (-₹'+Math.abs(delta)+')':''));
    document.getElementById('genericModal').classList.remove('show');
    if(window.loadMatchHistory) loadMatchHistory();
  }catch(e){if(window.showToast)showToast('❌ Error: '+e.message,true);}
};

/* ===== MATCH RESULT PRIZE DATA — set fresh when loadParticipants runs ===== */
window._MRD = {f1:0,f2:0,f3:0,pk:0};

/* Override loadParticipants to store fresh prize data in _MRD */
(function(){
  var _orig = window.loadParticipants;
  window.loadParticipants = async function() {
    var mid = (document.getElementById('resultTournamentSelect')||{}).value;
    if(mid && (window.rtdb||window.db)){
      try {
        var snap = await (window.rtdb||window.db).ref('matches/'+mid).once('value');
        if(snap.exists()){
          var d = snap.val();
          window.currentTournamentData = d; window.currentTournamentData._id = mid;
          if(window.allTournaments) window.allTournaments[mid] = d;
          window._MRD = {f1:Number(d.firstPrize)||0, f2:Number(d.secondPrize)||0, f3:Number(d.thirdPrize)||0, pk:Number(d.perKillPrize)||0};
        }
      } catch(e){}
    }
    var result = _orig ? _orig.apply(this, arguments) : null;
    return result;
  };
})();

/* calcPrize — reads from _MRD directly, same pattern as mhCalcPrize */
window.calcPrize = function(inp) {
  var row = inp.closest('tr'); if(!row) return;
  var r = Number((row.querySelector('.rank-input')||{}).value)||0;
  var k = Number((row.querySelector('.kills-input')||{}).value)||0;
  var d = window._MRD;
  /* Also sync from data attrs if _MRD not yet set */
  var tb = document.getElementById('participantsList');
  if((!d.f1&&!d.f2&&!d.f3&&!d.pk) && tb && (tb.dataset.f1||tb.dataset.pk)) {
    d = {f1:Number(tb.dataset.f1)||0, f2:Number(tb.dataset.f2)||0, f3:Number(tb.dataset.f3)||0, pk:Number(tb.dataset.pk)||0};
  }
  /* Final fallback to currentTournamentData */
  if(!d.f1&&!d.f2&&!d.f3&&!d.pk && window.currentTournamentData) {
    var t=window.currentTournamentData;
    d = {f1:Number(t.firstPrize)||0, f2:Number(t.secondPrize)||0, f3:Number(t.thirdPrize)||0, pk:Number(t.perKillPrize)||0};
  }

  /* AUTO-FILL TEAM rank */
  if(inp.classList.contains('rank-input') && r>0){
    var cap=row.dataset.captainuid||'', isT=row.dataset.isteam==='1', me=row.dataset.uid||'';
    document.querySelectorAll('#participantsList tr').forEach(function(or){
      if(or===row) return;
      var oc=or.dataset.captainuid||'', ou=or.dataset.uid||'';
      if((cap&&oc===cap)||(cap&&ou===cap)||(!isT&&oc===me)){var ri=or.querySelector('.rank-input');if(ri&&!Number(ri.value)){ri.value=r;window.calcPrize(ri);}}
    });
    /* Dup check */
    if(r>=1&&r<=3){
      var dup=false;
      document.querySelectorAll('#participantsList tr').forEach(function(or){
        if(or===row||or.dataset.isteam==='1') return;
        var ou2=or.dataset.uid||'',oc2=or.dataset.captainuid||'';
        if(ou2===cap||(cap&&oc2===cap)||(!isT&&oc2===me)) return;
        var ri2=or.querySelector('.rank-input'); if(ri2&&Number(ri2.value)===r) dup=true;
      });
      var pc=row.querySelector('.prize-cell');
      if(dup){pc.innerHTML='<span style="color:#ff4444;font-size:10px;font-weight:800">⚠️ Dup #'+r+'!</span>';row.style.background='rgba(255,0,0,.06)';return;}
      else row.style.background='';
    }
  }

  var rp=r===1?d.f1:r===2?d.f2:r===3?d.f3:0, kp=k*d.pk;
  var isTM=row.dataset.isteam==='1', ft=row.dataset.feetype||'each_pays';
  var tw=(isTM&&ft==='captain_pays')?0:(rp+kp);
  var cell=row.querySelector('.prize-cell');
  if(!cell) return;
  if(isTM&&ft==='captain_pays'){cell.style.color='#555';cell.innerHTML='<span style="font-size:9px;color:#555">→ Cap</span>';}
  else{cell.style.color=tw>0?'var(--primary)':'#aaa';var bd=(rp||kp)?'<br><span style="font-size:9px;color:#888">'+(rp?'R:₹'+rp:'')+(rp&&kp?'+':'')+(kp?k+'k×₹'+d.pk:'')+'</span>':'';cell.innerHTML='<span style="font-weight:800">₹'+tw+'</span>'+bd;}
  row.dataset.prize=tw; row.dataset.rank=r; row.dataset.kills=k;
};
window.adminCalcPrize = window.calcPrize;

/* ===== MATCH HISTORY — exact Match Result UI, published matches only ===== */
window._MHD = null; // current MH match data
window._MHR = {};   // existing results

window.loadMatchHistorySection = async function() {
  var sel = document.getElementById('mhMatchSelect');
  if(!sel || sel.options.length > 1) return; // already populated
  /* Use allTournaments if loaded, else fetch */
  var rtdb = window.rtdb||window.db;
  try {
    var snap = await rtdb.ref('matches').once('value');
    sel.innerHTML = '<option value="">-- Select Match --</option>';
    if(snap.exists()) snap.forEach(function(c){
      var d=c.val();
      if(d.status==='resultPublished'||d.resultPublished===true){
        var opt=document.createElement('option'); opt.value=c.key; opt.textContent=(d.name||c.key)+' ✅'; sel.appendChild(opt);
      }
    });
  } catch(e){}
};

window.loadMatchHistoryResult = async function() {
  var mid = (document.getElementById('mhMatchSelect')||{}).value;
  var container = document.getElementById('mhResultContainer');
  var tbody = document.getElementById('mhParticipantsList');
  var prizeInfo = document.getElementById('mhPrizeInfo');
  if(!mid){ if(container) container.style.display='none'; return; }
  if(container) container.style.display='block';
  if(tbody) tbody.innerHTML='<tr><td colspan="9" style="padding:16px;text-align:center;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading participants...</td></tr>';
  var rtdb = window.rtdb||window.db;
  try {
    var res = await Promise.all([
      rtdb.ref('matches/'+mid).once('value'),
      rtdb.ref('joinRequests').orderByChild('matchId').equalTo(mid).once('value'),
      rtdb.ref('results').orderByChild('matchId').equalTo(mid).once('value'),
      rtdb.ref('users').once('value')
    ]);
    var match = res[0].val()||{};
    var f1=Number(match.firstPrize)||0, f2=Number(match.secondPrize)||0, f3=Number(match.thirdPrize)||0, pk=Number(match.perKillPrize)||0;
    window._MHD = {mid:mid,f1:f1,f2:f2,f3:f3,pk:pk};
    /* Set data attrs on mh tbody */
    if(tbody){ tbody.dataset.f1=f1; tbody.dataset.f2=f2; tbody.dataset.f3=f3; tbody.dataset.pk=pk; }
    if(prizeInfo) prizeInfo.innerHTML='<i class="fas fa-calculator"></i> 🥇₹'+f1+' 🥈₹'+f2+' 🥉₹'+f3+(pk?' | 💀₹'+pk+'/Kill':'');
    /* Existing results */
    window._MHR = {};
    if(res[2].exists()) res[2].forEach(function(c){ var d=c.val(); if(d.userId) window._MHR[d.userId]={key:c.key,rank:d.rank||0,kills:d.kills||0,winnings:d.winnings||d.totalWinning||0,rankPrize:d.rankPrize||0,killPrize:d.killPrize||0}; });
    var usersMap={};
    if(res[3].exists()) res[3].forEach(function(c){ usersMap[c.key]=c.val(); });
    var html='', cnt=0;
    if(res[1].exists()) res[1].forEach(function(c){
      var j=c.val();
      /* Accept any status for published matches */
      if(!j || !j.userId) return;
      cnt++;
      var uid=j.userId;
      var u=usersMap[uid]||{};
      var nm=j.playerName||j.ign||j.userName||u.ign||'Unknown';
      var ff=j.ffUid||j.userFFUID||u.ffUid||'-';
      var slot=j.slotNumber||j.slot||'-';
      var mode=(j.mode||match.mode||'solo').toUpperCase();
      var entry=j.entryFee||match.entryFee||0;
      var ft=j.feeType||'solo', capUid=j.captainUid||'', isTM=j.isTeamMember?'1':'0';
      var er=window._MHR[uid]||{};
      var preR=er.rank||0, preK=er.kills||0;
      var preRp=preR===1?f1:preR===2?f2:preR===3?f3:0, preKp=preK*pk;
      var preTw=(isTM==='1'&&ft==='captain_pays')?0:(preRp+preKp);
      var prizeHtml;
      if(isTM==='1'&&ft==='captain_pays') prizeHtml='<span style="font-size:9px;color:#555">→ Cap</span>';
      else prizeHtml='<span style="font-weight:800;color:'+(preTw>0?'var(--primary)':'#aaa')+'">₹'+preTw+'</span>'+(preRp||preKp?'<br><span style="font-size:9px;color:#888">'+(preRp?'R:₹'+preRp:'')+(preRp&&preKp?'+':'')+(preKp?preK+'k×₹'+pk:'')+'</span>':'');
      var feeNote=(ft==='captain_pays'&&isTM==='1')?'<span style="font-size:9px;background:rgba(0,212,255,.12);color:#00d4ff;padding:1px 5px;border-radius:4px;margin-left:4px">Cap</span>':(ft==='each_pays'?'<span style="font-size:9px;background:rgba(0,255,156,.1);color:#00ff9c;padding:1px 5px;border-radius:4px;margin-left:4px">Self</span>':'');
      html+='<tr data-uid="'+uid+'" data-name="'+nm.toLowerCase()+'" data-feetype="'+ft+'" data-captainuid="'+capUid+'" data-isteam="'+isTM+'">';
      html+='<td style="color:#666;font-size:11px;padding:5px 4px">'+cnt+'</td>';
      html+='<td style="padding:5px 4px"><div style="font-size:12px;font-weight:700;color:'+(isTM==='1'?'#b9aaff':'var(--primary)')+'">'+nm+feeNote+'</div></td>';
      html+='<td style="padding:5px 4px;color:#00d4ff;font-family:monospace;font-size:10px">'+ff+'</td>';
      html+='<td style="padding:5px 4px;color:#aaa;font-size:11px">'+slot+'</td>';
      html+='<td style="padding:5px 4px;color:#aaa;font-size:10px;font-weight:700">'+mode+'</td>';
      html+='<td style="padding:5px 4px;color:#ffd700;font-size:11px">₹'+entry+'</td>';
      html+='<td style="padding:5px 4px;text-align:center"><input type="number" class="mh-rank" placeholder="0" min="0" value="'+preR+'" oninput="mhCalcPrize(this)" style="width:44px;padding:4px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);color:#ffd700;font-size:12px;text-align:center;font-weight:700"></td>';
      html+='<td style="padding:5px 4px;text-align:center"><input type="number" class="mh-kills" placeholder="0" min="0" value="'+preK+'" oninput="mhCalcPrize(this)" style="width:44px;padding:4px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);color:#ff6b6b;font-size:12px;text-align:center;font-weight:700"></td>';
      html+='<td class="mh-prize" style="padding:5px 4px;font-size:11px">'+prizeHtml+'</td>';
      html+='</tr>';
    });
    tbody.innerHTML = html||'<tr><td colspan="9" style="padding:16px;text-align:center;color:#aaa">No participants found — check joinRequests in Firebase</td></tr>';
  } catch(e) {
    if(tbody) tbody.innerHTML='<tr><td colspan="9" style="padding:16px;text-align:center;color:#f55">Error: '+e.message+'</td></tr>';
  }
};

window.mhCalcPrize = function(inp) {
  var row=inp.closest('tr');
  var k=Number((row.querySelector('.mh-kills')||{}).value)||0;
  var r=Number((row.querySelector('.mh-rank')||{}).value)||0;
  var d=window._MHD||{f1:0,f2:0,f3:0,pk:0};
  var rp=r===1?d.f1:r===2?d.f2:r===3?d.f3:0, kp=k*d.pk;
  var isTM=row.dataset.isteam==='1', ft=row.dataset.feetype||'solo';
  var tw=(isTM&&ft==='captain_pays')?0:(rp+kp);
  var cell=row.querySelector('.mh-prize');
  if(cell){ var bd=(rp||kp)?'<br><span style="font-size:9px;color:#888">'+(rp?'R:₹'+rp:'')+(rp&&kp?'+':'')+(kp?k+'k×₹'+d.pk:'')+'</span>':''; cell.innerHTML='<span style="font-weight:800;color:'+(tw>0?'var(--primary)':'#aaa')+'">₹'+tw+'</span>'+bd; }
};

window.mhFilterRows = function(s) {
  s=s.toLowerCase();
  document.querySelectorAll('#mhParticipantsList tr').forEach(function(r){ r.style.display=(r.dataset.name||'').indexOf(s)>=0?'':'none'; });
};

window.saveMhCorrections = async function() {
  var d=window._MHD; if(!d){if(window.showToast)showToast('Match select karo pehle',true);return;}
  var rows=document.querySelectorAll('#mhParticipantsList tr[data-uid]');
  if(!rows.length) return;
  var btn=document.getElementById('mhSaveBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Saving...';}
  var rtdb=window.rtdb||window.db, mid=d.mid, er=window._MHR||{};
  var promises=[];
  rows.forEach(function(row){
    var uid=row.dataset.uid;
    var rank=Number((row.querySelector('.mh-rank')||{}).value)||0;
    var kills=Number((row.querySelector('.mh-kills')||{}).value)||0;
    var rp=rank===1?d.f1:rank===2?d.f2:rank===3?d.f3:0, kp=kills*d.pk;
    var isTM=row.dataset.isteam==='1', ft=row.dataset.feetype||'solo';
    var prize=(isTM&&ft==='captain_pays')?0:(rp+kp);
    var oldPrize=er[uid]?er[uid].winnings:0, delta=prize-oldPrize;
    var upd={rank:rank,kills:kills,rankPrize:rp,killPrize:kp,winnings:prize,totalWinning:prize,correctedAt:Date.now(),correctedBy:'admin'};
    var resKey=er[uid]?er[uid].key:null;
    if(resKey) promises.push(rtdb.ref('results/'+resKey).update(upd));
    else if(rank||kills) promises.push(rtdb.ref('results').push(Object.assign({userId:uid,matchId:mid,timestamp:Date.now()},upd)));
    promises.push(rtdb.ref('matches/'+mid+'/results/'+uid).update(upd));
    if(delta!==0){
      promises.push(rtdb.ref('users/'+uid+'/realMoney/winnings').transaction(function(v){return Math.max(0,(v||0)+delta);}));
      promises.push(rtdb.ref('users/'+uid+'/wallet/winningBalance').transaction(function(v){return Math.max(0,(v||0)+delta);}));
      promises.push(rtdb.ref('users/'+uid+'/stats/earnings').transaction(function(v){return Math.max(0,(v||0)+delta);}));
      promises.push(rtdb.ref('users/'+uid+'/totalWinnings').transaction(function(v){return Math.max(0,(v||0)+delta);}));
      var deltaMsg = delta>0 ? '✅ ₹'+delta+' add kiya — result fix (Rank #'+rank+', '+kills+' kills)' : '⚠️ ₹'+Math.abs(delta)+' adjust kiya — result fix (pehle zyada tha)';
      promises.push(rtdb.ref('users/'+uid+'/transactions').push({type:delta>0?'correction_credit':'correction_debit',amount:Math.abs(delta),description:deltaMsg,timestamp:Date.now()}));
      promises.push(rtdb.ref('users/'+uid+'/notifications').push({title:'🔧 Result Updated',message:'Rank #'+rank+', '+kills+' kills → ₹'+prize+(delta>0?' (+₹'+delta+' credited)':' (-₹'+Math.abs(delta)+' adjusted)'),timestamp:Date.now(),read:false}));
    }
    promises.push(rtdb.ref('joinRequests').orderByChild('matchId').equalTo(mid).once('value').then(function(s){ if(s.exists()) s.forEach(function(c){if(c.val().userId===uid) rtdb.ref('joinRequests/'+c.key).update({rank:rank,kills:kills,reward:prize});}); }));
  });
  try {
    await Promise.all(promises);
    if(window.showToast) showToast('✅ Sab '+rows.length+' players ke results save ho gaye!');
    window._MHR={};
    await loadMatchHistoryResult();
  } catch(e){ if(window.showToast) showToast('❌ Error: '+e.message,true); }
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-save"></i> Save All Corrections';}
};

/* ═══════════════════════════════════════════════════
   MISSING UTILITY FUNCTIONS — exportCSV, Roster, Activity Log
   ═══════════════════════════════════════════════════ */

function _downloadCSV(filename, rows) {
  var csv = rows.map(function(r){ return r.map(function(c){ return '"'+(c+'').replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

window.exportCSV = function(type) {
  if (type === 'users') {
    var cache = window.usersCache || {};
    var rows = [['Firebase UID','IGN','FF UID','Phone','Deposit','Winnings','Coins','Matches','Kills','Banned','Verified']];
    Object.keys(cache).forEach(function(uid){
      var u = cache[uid] || {}; var rm = u.realMoney||{}; var w = u.wallet||{}; var st = u.stats||{};
      rows.push([uid, u.ign||'', u.ffUid||'', u.phone||'',
        Number(rm.deposited||w.depositBalance||0), Number(rm.winnings||w.winningBalance||0),
        u.coins||0, st.matches||0, st.kills||0,
        (u.isBanned||u.blocked)?'Yes':'No', u.profileVerified?'Yes':'No']);
    });
    if (rows.length < 2) { showToast('Users load nahi hue. Pehle Users section mein jao.', true); return; }
    _downloadCSV('ff_users_'+new Date().toISOString().slice(0,10)+'.csv', rows);
    showToast('✅ ' + (rows.length-1) + ' users exported!');
  } else if (type === 'matches') {
    var matches = window.allTournaments || {};
    var rows2 = [['Match ID','Name','Mode','Entry Fee','Prize Pool','Max Slots','Filled','Status','Match Time']];
    Object.keys(matches).forEach(function(mid){
      var m = matches[mid] || {};
      rows2.push([mid, m.name||'', m.gameMode||m.mode||'', m.entryFee||0, m.prizePool||0,
        m.maxSlots||0, m.filledSlots||m.joinedSlots||0, m.status||'',
        m.matchTime ? new Date(m.matchTime).toLocaleString('en-IN') : '']);
    });
    if (rows2.length < 2) { showToast('Matches load nahi hue.', true); return; }
    _downloadCSV('ff_matches_'+new Date().toISOString().slice(0,10)+'.csv', rows2);
    showToast('✅ ' + (rows2.length-1) + ' matches exported!');
  }
};

window._rosterData = [];
;
window._toggleRosterStatus = async function(key,idx){
  var r=window._rosterData[idx];if(!r)return;
  var ns=r.status==='kicked'?'present':'kicked'; r.status=ns;
  try{
    /* ✅ Supabase join_requests.roster_status */
    if(window._supa) await window._supa.from('join_requests').update({roster_status:ns}).eq('id',key);
    else if(typeof rtdb!=='undefined') await rtdb.ref('joinRequests/'+key).update({rosterStatus:ns});
    window.loadRoster();showToast((ns==='kicked'?'🚫 Kicked: ':'✅ Restored: ')+r.ign);
  }catch(e){showToast('Error: '+e.message,true);}
};
;
window.clearRosterStatus = async function(){
  var rows=window._rosterData||[];if(!rows.length){showToast('Pehle match select karo',true);return;}
  if(!confirm('Sab players ki roster status clear karni hai?'))return;
  /* ✅ Supabase join_requests — safe fallback */
  if(window._supa){
    await Promise.all(rows.map(function(r){ return window._supa.from('join_requests').update({roster_status:'present'}).eq('id',r.key).catch(function(){}); }));
  } else if(typeof rtdb!=='undefined'){
    await Promise.all(rows.map(function(r){return rtdb.ref('joinRequests/'+r.key).update({rosterStatus:'present'});}));
  }
  window._rosterData.forEach(function(r){r.status='present';});
  window.loadRoster();showToast('✅ All status cleared');
};

window._activityLogData = [];
window._activityLogFilter = 'all';
window.loadActivityLog = async function(){
  var el=document.getElementById('activityLogList');if(!el)return;
  el.innerHTML='<p class="text-muted text-xs" style="padding:20px;text-align:center"><i class="fas fa-spinner fa-spin"></i> Loading...</p>';
  try{
    var filter=window._activityLogFilter||'all';
    /* ✅ FIX: Supabase admin_activity_log + Firebase fallback (wrapped in try/catch) */
    window._activityLogData = [];
    try {
      if (window._supa) {
        var _actRes = await window._supa.from('admin_activity_log')
          .select('*').order('created_at',{ascending:false}).limit(100);
        (_actRes.data||[]).forEach(function(row) {
          window._activityLogData.push({
            _key:      row.id,
            type:      row.action_type || 'action',
            action:    row.note       || row.action_type || 'Activity',
            message:   row.note       || '',
            adminEmail:row.admin_uid  || 'admin',
            by:        row.admin_uid  || 'admin',
            timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now()
          });
        });
      }
      if (!window._activityLogData.length && typeof rtdb !== 'undefined') {
        var snap = await rtdb.ref('adminActivityLog').limitToLast(200).once('value');
        if (snap.exists()) snap.forEach(function(c){ window._activityLogData.unshift(Object.assign({_key:c.key},c.val())); });
      }
    } catch(e) { console.warn('[ActivityLog]', e.message); }
    var filtered=window._activityLogData.filter(function(log){return filter==='all'||(log.type||'').toLowerCase().includes(filter);});
    if(!filtered.length){el.innerHTML='<p class="text-muted text-xs" style="padding:20px;text-align:center">No activity logs found</p>';return;}
    var html='<div style="display:flex;flex-direction:column;gap:4px;padding:8px">';
    filtered.slice(0,100).forEach(function(log){
      var tc=log.type==='ban'?'#ff4444':log.type==='wallet'||log.type==='credit'||log.type==='debit'?'#ffd700':log.type==='result'?'#00ff9c':'#00d4ff';
      html+='<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;border:1px solid rgba(255,255,255,.06)">';
      html+='<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(0,0,0,.3);color:'+tc+';white-space:nowrap">'+(log.type||'action').toUpperCase()+'</span>';
      html+='<div style="flex:1"><div style="font-size:12px;font-weight:600">'+(log.action||log.message||'Activity')+'</div>';
      html+='<div style="font-size:10px;color:#aaa">'+(log.adminEmail||log.by||'admin')+' · '+new Date(log.timestamp||0).toLocaleString('en-IN')+'</div></div></div>';
    });
    html+='</div>';el.innerHTML=html;
  }catch(e){el.innerHTML='<p style="color:#ff4444;padding:12px">Error: '+e.message+'</p>';}
};
;
;

/* ════ SKY DIAMOND REQUESTS ════ */
window.showSkyDiamondRequests = function() {
  var modal = document.getElementById('adminGenericModal');
  var body  = document.getElementById('adminGenericModalBody');
  if (!modal || !body) return;
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#888"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  modal.style.display = 'flex';
  /* ✅ Supabase sd_requests (Firebase skyDiamondRequests was old path) */
  if (!window._supa) { body.innerHTML = '<div style="color:#ff4444;padding:20px">Supabase not ready</div>'; return; }
  window._supa.from('sd_requests').select('*').eq('status','pending')
    .order('created_at',{ascending:false}).limit(50)
    .then(function(res) {
      var rows = res.data || [];
      if (!rows.length) { body.innerHTML = '<div style="text-align:center;padding:30px;color:#888">No pending Sky Diamond requests</div>'; return; }
      var h = '<div style="padding:4px">';
      rows.forEach(function(r) {
        var id = r.id;
        h += '<div style="background:#1a1a2e;border:1px solid rgba(0,212,255,.2);border-radius:12px;padding:14px;margin-bottom:10px">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
        h += '<div><div style="font-weight:800;color:#fff">' + (r.ign||r.user_id||'User') + '</div>';
        h += '<div style="font-size:11px;color:#888">' + new Date(r.created_at).toLocaleString('en-IN') + '</div>';
        if (r.upi_ref) h += '<div style="font-size:11px;color:#aaa">UPI: ' + r.upi_ref + '</div>';
        h += '</div>';
        h += '<div style="font-size:20px;font-weight:900;color:#00d4ff">💎 ' + r.sd_amount + '</div></div>';
        h += '<div style="font-size:12px;color:#aaa;margin-bottom:8px">₹' + r.amount_inr + ' payment claimed</div>';
        if (r.screenshot_url) h += '<a href="' + r.screenshot_url + '" target="_blank" style="display:block;margin-bottom:10px;font-size:11px;color:#00d4ff">📸 Screenshot dekho</a>';
        h += '<div style="display:flex;gap:8px">';
        h += '<button onclick="approveSkyDiamond(\x27' + id + '\x27,\x27' + r.user_id + '\x27,' + r.sd_amount + ')" style="flex:1;padding:8px;border-radius:8px;background:rgba(0,212,255,.15);border:1px solid rgba(0,212,255,.3);color:#00d4ff;font-weight:700;cursor:pointer">✅ Approve</button>';
        h += '<button onclick="rejectSkyDiamond(\x27' + id + '\x27)" style="flex:1;padding:8px;border-radius:8px;background:rgba(255,50,50,.1);border:1px solid rgba(255,50,50,.2);color:#ff5555;font-weight:700;cursor:pointer">❌ Reject</button>';
        h += '</div></div>';
      });
      h += '</div>';
      body.innerHTML = h;
    }).catch(function(e) {
      body.innerHTML = '<div style="color:#ff4444;padding:20px">Error: ' + (e.message||'Load failed') + '</div>';
    });
};
window.approveSkyDiamond = function(reqId, uid, amount) {
  if (!uid || !amount) return;
  rtdb.ref('users/' + uid + '/skyDiamonds').transaction(function(v){ return (Number(v)||0) + amount; });
  rtdb.ref('skyDiamondRequests/' + reqId).update({ status:'approved', approvedAt: Date.now() });
  rtdb.ref('users/' + uid + '/notifications').push({ title:'💎 Sky Diamonds Added!', message: amount + ' Sky Diamonds aapke wallet mein add ho gaye!', type:'wallet_approved', read:false, createdAt:Date.now() });
  showToast('✅ ' + amount + ' Sky Diamonds credited!');
  showSkyDiamondRequests();
};
window.rejectSkyDiamond = async function(reqId) {
  /* ✅ BUG FIX (2026-07-17): same fix as rejectSkyDiaReq below — this
     duplicate has no live callers currently (confirmed dead code), but
     fixed anyway so it doesn't reintroduce the Firebase-only, no-refund
     bug if it's ever wired up later. */
  var supa = window._supa;
  if (supa) {
    var res = await supa.rpc('resolve_sd_request', { p_request_id: reqId, p_action: 'reject' });
    if (res.error || (res.data && res.data.ok === false)) {
      var msg = res.error ? res.error.message : (res.data && res.data.error);
      showToast('❌ Reject failed: ' + msg, true);
      return;
    }
  }
  rtdb.ref('skyDiamondRequests/' + reqId).update({ status:'rejected', rejectedAt: Date.now() }).catch(function(){});
  showToast('Request rejected.');
  showSkyDiamondRequests();
};

/* ════ PREMIUM REQUESTS ════ */
window.showPremiumRequests = function() {
  var modal = document.getElementById('adminGenericModal');
  var body  = document.getElementById('adminGenericModalBody');
  if (!modal || !body) return;
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#888">Loading...</div>';
  modal.style.display = 'flex';
  rtdb.ref('premiumRequests').orderByChild('status').equalTo('pending').once('value', function(s) {
    if (!s.exists()) { body.innerHTML = '<div style="text-align:center;padding:30px;color:#888">No pending Premium requests</div>'; return; }
    var h = '<div style="padding:4px">';
    s.forEach(function(c) {
      var r = c.val(); var id = c.key;
      h += '<div style="background:#1a1a2e;border:1px solid rgba(255,215,0,.2);border-radius:12px;padding:14px;margin-bottom:10px">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      h += '<div><div style="font-weight:800;color:#fff">' + (r.ign||r.uid||'User') + '</div><div style="font-size:11px;color:#888">' + new Date(r.createdAt).toLocaleString('en-IN') + '</div></div>';
      h += '<div style="text-align:right"><div style="font-size:14px;font-weight:900;color:#ffd700">👑 ' + r.tierName + '</div><div style="font-size:11px;color:#aaa">₹' + r.price + '/mo</div></div></div>';
      h += '<button onclick="approvePremium(\'' + id + '\',\'' + r.uid + '\',\'' + r.tierId + '\',' + r.gdBonus + ')" style="width:100%;padding:9px;border-radius:8px;background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.3);color:#ffd700;font-weight:700;cursor:pointer">✅ Approve (30 days)</button>';
      h += '</div>';
    });
    h += '</div>';
    body.innerHTML = h;
  });
};
window.approvePremium = function(reqId, uid, tierId, gdBonus) {
  if (!uid) return;
  var expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
  rtdb.ref('users/' + uid).update({ premiumTier: tierId, premiumExpiresAt: expiresAt });
  if (gdBonus > 0) rtdb.ref('users/' + uid + '/greenDiamonds').transaction(function(v){ return (Number(v)||0) + gdBonus; });
  rtdb.ref('premiumRequests/' + reqId).update({ status:'approved', approvedAt: Date.now() });
  rtdb.ref('users/' + uid + '/notifications').push({ title:'👑 Premium Activated!', message:'Aapka Premium plan 30 din ke liye activate ho gaya! ' + (gdBonus>0 ? gdBonus + ' <img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block"> Green Diamonds bonus bhi mile!' : ''), type:'wallet_approved', read:false, createdAt:Date.now() });
  showToast('✅ Premium activated for 30 days!');
  showPremiumRequests();
};


/* ══════════════════════════════════════════════════════
   NEW SECTION LOADERS — Sky Diamond + Premium Requests
   ══════════════════════════════════════════════════════ */

window.loadSkyDiamondReqSection = async function() {
  var list = document.getElementById('skyDiaReqList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#888"><div class="spinner" style="margin:0 auto 10px"></div>Loading...</div>';
  try {
    var snap = await rtdb.ref('walletRequests').orderByChild('status').equalTo('pending').once('value');
    var rows = [];
    if (snap.exists()) {
      snap.forEach(function(c) {
        var r = c.val();
        if (r.type === 'diamond_purchase' || r.type === 'add' || r.type === 'sky_diamond') {
          rows.push({ id: c.key, data: r });
        }
      });
    }
    var skySnap = await rtdb.ref('skyDiamondRequests').orderByChild('status').equalTo('pending').once('value');
    if (skySnap.exists()) {
      skySnap.forEach(function(c) {
        rows.push({ id: c.key, data: c.val(), isSky: true });
      });
    }
    document.getElementById('skyDiaCount').textContent = rows.length;
    var bd = document.getElementById('skyDiaBadge');
    if (bd) { bd.textContent = rows.length; bd.style.display = rows.length ? 'flex' : 'none'; }
    if (!rows.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#666"><i class="fas fa-gem" style="font-size:32px;margin-bottom:10px;display:block;color:#00d4ff33"></i>No pending Sky Diamond requests</div>';
      return;
    }
    var h = '<div class="table-wrapper"><table><thead><tr><th>User</th><th>FF UID</th><th>Diamonds</th><th>Price Paid</th><th>Screenshot</th><th>Time</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(item) {
      var r = item.data; var id = item.id;
      var uid = r.uid || r.userId || '';
      var ign = r.userName || r.ign || r.displayName || uid.substring(0,8) || '—';
      var ffuid = r.ffUid || r.gameUid || '—';
      var diamonds = r.diamonds || r.amount || 0;
      var price = r.price || r.amount || 0;
      var ss = r.screenshotBase64 || r.screenshot || '';
      var ssHtml = ss ? '<img src="'+ss+'" style="width:40px;height:40px;border-radius:6px;cursor:pointer;object-fit:cover;border:1px solid rgba(0,212,255,.3)" onclick="viewScreenshot(this.src)">' : '<span class="text-muted text-xxs">No photo</span>';
      var time = r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '—';
      h += '<tr>';
      h += '<td><span style="font-weight:700;color:var(--primary)">' + ign + '</span><div style="font-size:9px;color:#666;font-family:monospace">' + uid.substring(0,10) + '</div></td>';
      h += '<td><span style="font-family:monospace;font-size:10px;color:var(--info)">' + ffuid + '</span></td>';
      h += '<td><span style="font-size:15px;font-weight:900;color:#00d4ff">💎 ' + diamonds + '</span></td>';
      h += '<td><span style="font-weight:700;color:#00ff9c">₹' + price + '</span></td>';
      h += '<td>' + ssHtml + '</td>';
      h += '<td style="font-size:11px;color:#666">' + time + '</td>';
      h += '<td>';
      if (item.isSky) {
        h += '<button class="btn btn-primary btn-xs" onclick="approveSkyDiaReq(\'' + id + '\',\'' + uid + '\',' + diamonds + ',true)"><i class="fas fa-check"></i> Approve</button> ';
        h += '<button class="btn btn-danger btn-xs" onclick="rejectSkyDiaReq(\'' + id + '\',true)"><i class="fas fa-times"></i></button>';
      } else {
        h += '<button class="btn btn-primary btn-xs" onclick="approveSkyDiaReq(\'' + id + '\',\'' + uid + '\',' + diamonds + ',false)"><i class="fas fa-check"></i> Approve</button> ';
        h += '<button class="btn btn-danger btn-xs" onclick="openRejectModal(\'wallet\',\'' + id + '\')"><i class="fas fa-times"></i></button>';
      }
      h += '</td></tr>';
    });
    h += '</tbody></table></div>';
    list.innerHTML = h;
  } catch(e) {
    list.innerHTML = '<div style="color:var(--danger);padding:16px">Error: ' + e.message + '</div>';
  }
};

window.approveSkyDiaReq = async function(reqId, uid, diamonds, isSkyNode) {
  if (!uid || !diamonds) return showToast('Invalid data', true);
  try {
    /* BUG #26 FIX (2026-07): same triple-credit root cause as approveAddMoney —
       both writes below mapped to the same sky_diamonds column via the bridge,
       and admin-supabase-sync.js's _wrapApproveSkyDia() adds a THIRD credit via
       increment_balance() on top. The credit now happens exactly once, via that
       wrapper. See approveAddMoney's comment above for the full explanation. */
    // Update request status
    var node = isSkyNode ? 'skyDiamondRequests' : 'walletRequests';
    await rtdb.ref(node + '/' + reqId).update({ status: 'approved', approvedAt: Date.now(), approvedBy: auth.currentUser.uid });
    // Send notification
    await rtdb.ref('users/' + uid + '/notifications').push({
      title: '💎 Sky Diamonds Added!',
      message: '💎 ' + diamonds + ' Sky Diamonds aapke wallet mein add ho gaye! Ab paid matches join kar sakte ho.',
      type: 'wallet_approved', read: false, timestamp: Date.now()
    });
    // Transaction log
    await rtdb.ref('users/' + uid + '/transactions').push({ type: 'sky_diamond_credit', amount: diamonds, currency: 'sky', description: 'Sky Diamond purchase approved', timestamp: Date.now() });
    showToast('✅ 💎 ' + diamonds + ' Sky Diamonds credited!');
    loadSkyDiamondReqSection();
  } catch(e) { showToast('Error: ' + e.message, true); }
};

window.rejectSkyDiaReq = async function(reqId, isSkyNode) {
  /* ✅ BUG FIX (2026-07-17, CRITICAL): this was Firebase-RTDB-only — a
     plain status flag flip with zero Supabase sync and zero refund logic
     of any kind. For request_type='green_diamond_withdrawal' (routed
     through this same function via isSkyNode=false), that meant a
     rejected withdrawal NEVER refunded the user's already-deducted
     green_diamonds, in any code path, ever — this was the direct,
     confirmed mechanism behind that finding. resolve_sd_request handles
     both request types correctly: refunds on a rejected withdrawal,
     no balance change on a rejected purchase (which never took money from
     the user's in-app balance to begin with). */
  var supa = window._supa;
  if (supa) {
    var res = await supa.rpc('resolve_sd_request', { p_request_id: reqId, p_action: 'reject' });
    if (res.error || (res.data && res.data.ok === false)) {
      var msg = res.error ? res.error.message : (res.data && res.data.error);
      showToast('❌ Reject failed: ' + msg, true);
      return;
    }
  } else {
    console.error('[rejectSkyDiaReq] window._supa not available — cannot reject via RPC, refusing to silently fall back to the broken Firebase-only path');
    showToast('❌ Supabase not connected — reject cancelled', true);
    return;
  }
  /* Keep Firebase in sync too, for anything still reading the old node. */
  var node = isSkyNode ? 'skyDiamondRequests' : 'walletRequests';
  await rtdb.ref(node + '/' + reqId).update({ status: 'rejected', rejectedAt: Date.now() }).catch(function(){});
  showToast('Request rejected.');
  loadSkyDiamondReqSection();
};

window.loadPremiumReqSection = async function() {
  var list = document.getElementById('premiumReqList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#888"><div class="spinner" style="margin:0 auto 10px"></div>Loading...</div>';
  try {
    var snap = await rtdb.ref('premiumRequests').orderByChild('status').equalTo('pending').once('value');
    var rows = [];
    if (snap.exists()) snap.forEach(function(c){ rows.push({ id: c.key, data: c.val() }); });
    document.getElementById('premiumReqCount').textContent = rows.length;
    var bd = document.getElementById('premiumBadge');
    if (bd) { bd.textContent = rows.length; bd.style.display = rows.length ? 'flex' : 'none'; }
    if (!rows.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#666"><i class="fas fa-crown" style="font-size:32px;margin-bottom:10px;display:block;color:#ffd70033"></i>No pending Premium requests</div>';
      return;
    }
    var tierColors = { '1': '#ffd700', '2': '#00d4ff', '3': '#b964ff' };
    var tierNames  = { '1': 'Tier 1 — ₹49', '2': 'Tier 2 — ₹99', '3': 'Tier 3 — ₹199' };
    var h = '<div class="table-wrapper"><table><thead><tr><th>User</th><th>Plan</th><th>Price</th><th>Screenshot</th><th>Requested</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(item) {
      var r = item.data; var id = item.id;
      var uid = r.uid || '';
      var ign = r.userName || r.ign || uid.substring(0,8) || '—';
      var tier = String(r.tier || r.tierId || '1');
      var price = r.price || 49;
      var col = tierColors[tier] || '#ffd700';
      var ss = r.screenshotBase64 || '';
      var ssHtml = ss ? '<img src="'+ss+'" style="width:40px;height:40px;border-radius:6px;cursor:pointer;object-fit:cover;border:1px solid rgba(255,215,0,.3)" onclick="viewScreenshot(this.src)">' : '<span class="text-muted text-xxs">No photo</span>';
      var time = r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '—';
      h += '<tr>';
      h += '<td><span style="font-weight:700;color:var(--primary)">' + ign + '</span><div style="font-size:9px;color:#666;font-family:monospace">' + uid.substring(0,10) + '</div></td>';
      h += '<td><span style="padding:3px 10px;border-radius:8px;background:' + col + '22;border:1px solid ' + col + '55;color:' + col + ';font-weight:800;font-size:12px">👑 Premium ' + (tierNames[tier] || 'Tier '+tier) + '</span></td>';
      h += '<td><span style="font-weight:700;color:#00ff9c">₹' + price + '</span></td>';
      h += '<td>' + ssHtml + '</td>';
      h += '<td style="font-size:11px;color:#666">' + time + '</td>';
      h += '<td><button class="btn btn-primary btn-xs" style="background:linear-gradient(135deg,' + col + ',#ff8c00);border:none;color:#000" onclick="approvePremiumReq(\'' + id + '\',\'' + uid + '\',' + tier + ')"><i class="fas fa-crown"></i> Approve 30d</button> <button class="btn btn-danger btn-xs" onclick="rejectPremiumReq(\'' + id + '\')"><i class="fas fa-times"></i></button></td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    list.innerHTML = h;
  } catch(e) {
    list.innerHTML = '<div style="color:var(--danger);padding:16px">Error: ' + e.message + '</div>';
  }
};

window.approvePremiumReq = async function(reqId, uid, tier) {
  if (!uid) return;
  try {
    var tierNames  = { 1: 'Silver', 2: 'Gold', 3: 'Diamond' };
    var gdBonus    = { 1: 5, 2: 15, 3: 35 }[tier] || 0;
    /* BUG #4/#5/#29 FIX (2026-07): the old multi-key rtdb.ref(...).update({...}) call was
       silently dropped entirely by the Supabase bridge's converter (didn't recognize any of
       these slash-keys or camelCase field names), AND separately mapped to columns
       (premium_tier, premium_expires_at) that don't exist in the schema — premium never
       actually activated for anyone, ever, regardless of how many times admin approved a
       request. Also, premium_level/premium_expires are now locked from direct client writes
       (Category A security fix), so this must go through an admin-checked RPC regardless. */
    var r = await window._supa.rpc('approve_premium', { p_uid: uid, p_tier: tier, p_days: 30 });
    if (r.error || (r.data && r.data.success === false)) {
      var msg = (r.data && r.data.error) || (r.error && r.error.message) || 'Unknown error';
      showToast('❌ ' + msg, true);
      return;
    }
    /* Credit Green Diamonds monthly bonus — also fixed to use the real increment_balance RPC
       instead of a Firebase-only write the user panel's balance display never reads. */
    if (gdBonus > 0) {
      await window._supa.rpc('increment_balance', { p_uid: uid, p_col: 'green_diamonds', p_amount: gdBonus });
    }
    await rtdb.ref('premiumRequests/' + reqId).update({ status: 'approved', approvedAt: Date.now(), approvedBy: auth.currentUser ? auth.currentUser.uid : 'admin' });
    await rtdb.ref('users/' + uid + '/notifications').push({
      title: '👑 Premium ' + (tierNames[tier]||('Tier '+tier)) + ' Activated!',
      message: 'Premium ' + (tierNames[tier]||'Tier '+tier) + ' 30 din ke liye activate ho gaya! ' + gdBonus + ' Green Diamonds bhi credit kiye gaye hain.',
      type: 'premium_activated', read: false, timestamp: Date.now(), createdAt: Date.now()
    });
    showToast('✅ Premium ' + (tierNames[tier]||('Tier '+tier)) + ' activated! ' + gdBonus + ' GD credited.');
    loadPremiumReqSection();
  } catch(e) { showToast('Error: ' + e.message, true); }
};

window.rejectPremiumReq = async function(reqId) {
  await rtdb.ref('premiumRequests/' + reqId).update({ status: 'rejected', rejectedAt: Date.now() });
  showToast('Request rejected.');
  loadPremiumReqSection();
};

/* ══ SEASON PASS APPROVAL ══ */
window.approveSeasonPass = async function(reqId, uid, season) {
  if (!uid) return;
  try {
    await rtdb.ref('battlePass/' + season + '/' + uid + '/hasPremium').set(true);
    await rtdb.ref('seasonPassRequests/' + reqId).update({ status: 'approved', approvedAt: Date.now() });
    await rtdb.ref('users/' + uid + '/notifications').push({
      title: '🎫 Season Pass Activated!',
      message: 'Season Pass activate ho gaya! Saare 50 tiers ke premium rewards unlock ho gaye.',
      type: 'seasonpass_activated', read: false, timestamp: Date.now(), createdAt: Date.now()
    });
    showToast('✅ Season Pass approved!');
    loadSeasonPassSection();
  } catch(e) { showToast('Error: ' + e.message, true); }
};

window.rejectSeasonPass = async function(reqId) {
  await rtdb.ref('seasonPassRequests/' + reqId).update({ status: 'rejected', rejectedAt: Date.now() });
  showToast('Season Pass request rejected.');
  loadSeasonPassSection();
};

window.loadSeasonPassSection = async function() {
  var el = document.getElementById('section-seasonPass');
  if (!el) return;
  el.innerHTML = '<div class="section-title"><i class="fas fa-ticket-alt" style="color:#b964ff"></i> Season Pass Requests <span class="count" id="spCount">0</span></div><div id="spReqList"><div class="empty-state">Loading...</div></div>';
  var snap = await rtdb.ref('seasonPassRequests').orderByChild('status').equalTo('pending').once('value');
  var list = document.getElementById('spReqList');
  if (!list) return;
  if (!snap.exists()) { list.innerHTML = '<div class="empty-state">No pending Season Pass requests.</div>'; return; }
  var rows = [];
  snap.forEach(function(c) { rows.push(Object.assign({_id: c.key}, c.val())); });
  rows.sort(function(a,b) { return (b.createdAt||0)-(a.createdAt||0); });
  document.getElementById('spCount').textContent = rows.length;
  var h = '<table class="data-table"><thead><tr><th>User</th><th>Season</th><th>Amount</th><th>Time</th><th>Screenshot</th><th>Action</th></tr></thead><tbody>';
  rows.forEach(function(r) {
    var id = r._id;
    h += '<tr>';
    h += '<td><strong>' + (r.userName||'Unknown') + '</strong><br><small style="color:#888">' + (r.uid||'').substring(0,10) + '</small></td>';
    h += '<td>' + (r.season||'-') + '</td>';
    h += '<td>₹' + (r.price||49) + '</td>';
    h += '<td>' + new Date(r.createdAt||0).toLocaleString('en-IN') + '</td>';
    h += '<td>' + (r.screenshotBase64 ? '<img src="' + r.screenshotBase64 + '" style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="window.open(this.src)">' : '-') + '</td>';
    h += '<td><button class="btn btn-primary btn-xs" style="background:linear-gradient(135deg,#b964ff,#7b2ff7);border:none;color:#fff" onclick="approveSeasonPass(\'' + id + '\',\'' + r.uid + '\',\'' + (r.season||'') + '\')"><i class="fas fa-check"></i> Approve</button> <button class="btn btn-danger btn-xs" onclick="rejectSeasonPass(\'' + id + '\')"><i class="fas fa-times"></i></button></td>';
    h += '</tr>';
  });
  h += '</tbody></table>';
  list.innerHTML = h;
};

/* ══════════════════════════════════════════════════════
   DIAMOND PACKAGES — Admin se edit karo
   ══════════════════════════════════════════════════════ */

window.saveDiamondPackages = async function() {
  var rows = document.querySelectorAll('#diamondPkgEditor .dia-pkg-row');
  var pkgs = [];
  rows.forEach(function(row) {
    var price = Number(row.querySelector('.pkg-price').value) || 0;
    var diamonds = Number(row.querySelector('.pkg-diamonds').value) || 0;
    var label = row.querySelector('.pkg-label').value.trim() || '';
    if (price > 0 && diamonds > 0) pkgs.push({ price: price, diamonds: diamonds, label: label });
  });
  if (!pkgs.length) return showToast('At least 1 package add karo!', true);
  try {
    await rtdb.ref('appSettings/diamondPackages').set(pkgs);
    var msg = document.getElementById('diaPkgSaveMsg');
    if (msg) { msg.style.display = 'inline'; setTimeout(function(){ msg.style.display = 'none'; }, 2000); }
    showToast('✅ Diamond packages saved!');
  } catch(e) { showToast('Error: ' + e.message, true); }
};

window.addDiaPkgRow = function() {
  var editor = document.getElementById('diamondPkgEditor');
  if (!editor) return;
  var row = document.createElement('div');
  row.className = 'dia-pkg-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end';
  row.innerHTML = '<div><label style="font-size:11px;color:#888">💰 Price (₹)</label><input type="number" class="form-input pkg-price" placeholder="99"></div><div><label style="font-size:11px;color:#888">💎 Diamonds</label><input type="number" class="form-input pkg-diamonds" placeholder="200"></div><div><label style="font-size:11px;color:#888">Label</label><input type="text" class="form-input pkg-label" placeholder="Custom Pack"></div><button onclick="this.closest(\'.dia-pkg-row\').remove()" style="padding:8px 10px;border-radius:8px;background:rgba(255,0,60,.1);border:1px solid rgba(255,0,60,.2);color:#ff003c;cursor:pointer;height:38px;margin-top:auto"><i class="fas fa-trash"></i></button>';
  editor.appendChild(row);
};

/* Load diamond packages into editor on settings open */
(function loadDiaPkgEditor() {
  var _iv = setInterval(function() {
    if (!window.rtdb || !document.getElementById('diamondPkgEditor')) return;
    clearInterval(_iv);
    rtdb.ref('appSettings/diamondPackages').once('value', function(s) {
      var pkgs = s.val();
      if (!pkgs || !pkgs.length) return;
      var editor = document.getElementById('diamondPkgEditor');
      if (!editor) return;
      editor.innerHTML = '';
      pkgs.forEach(function(p) {
        var row = document.createElement('div');
        row.className = 'dia-pkg-row';
        row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end';
        row.innerHTML = '<div><label style="font-size:11px;color:#888">💰 Price (₹)</label><input type="number" class="form-input pkg-price" value="' + p.price + '"></div><div><label style="font-size:11px;color:#888">💎 Diamonds</label><input type="number" class="form-input pkg-diamonds" value="' + p.diamonds + '"></div><div><label style="font-size:11px;color:#888">Label</label><input type="text" class="form-input pkg-label" value="' + (p.label||'') + '"></div><button onclick="this.closest(\'.dia-pkg-row\').remove()" style="padding:8px 10px;border-radius:8px;background:rgba(255,0,60,.1);border:1px solid rgba(255,0,60,.2);color:#ff003c;cursor:pointer;height:38px;margin-top:auto"><i class="fas fa-trash"></i></button>';
        editor.appendChild(row);
      });
    });
  }, 800);
})();

/* ══════════════════════════════════════════════════════
   BADGE COUNTERS — Sky Diamond + Premium pending badges
   ══════════════════════════════════════════════════════ */
(function watchPendingBadges() {
  var _iv = setInterval(function() {
    if (!window.rtdb) return;
    clearInterval(_iv);
    // Watch sky diamond requests
    rtdb.ref('walletRequests').orderByChild('status').equalTo('pending').on('value', function(s) {
      var cnt = 0;
      if (s.exists()) s.forEach(function(c){ var t = (c.val().type||''); if(t==='diamond_purchase'||t==='add'||t==='sky_diamond') cnt++; });
      var bd = document.getElementById('skyDiaBadge');
      if (bd) { bd.textContent = cnt; bd.style.display = cnt ? 'flex' : 'none'; }
    });
    rtdb.ref('skyDiamondRequests').orderByChild('status').equalTo('pending').on('value', function(s) {
      var cnt = s.exists() ? s.numChildren() : 0;
      var bd = document.getElementById('skyDiaBadge');
      if (bd) { var cur = parseInt(bd.textContent)||0; bd.textContent = cur+cnt; bd.style.display = (cur+cnt)?'flex':'none'; }
    });
    // Watch premium requests
    rtdb.ref('premiumRequests').orderByChild('status').equalTo('pending').on('value', function(s) {
      var cnt = s.exists() ? s.numChildren() : 0;
      var bd = document.getElementById('premiumBadge');
      if (bd) { bd.textContent = cnt; bd.style.display = cnt ? 'flex' : 'none'; }
    });
  }, 1200);
})();

/* ✅ AUDIT FIX: header "DB Rules" button called window.showSecurityRules,
   which was never defined anywhere — tap did nothing. Real implementation:
   fetch the actual deployed firebase-rules.json (same file this admin panel
   ships next to) and show it, so admins have a quick read-only reference
   without leaving the page. */
if (!window.showSecurityRules) {
  window.showSecurityRules = function() {
    fetch('firebase-rules.json').then(function(r) { return r.text(); }).then(function(text) {
      alert('Current firebase-rules.json (read-only reference — deploy changes via Firebase Console):\n\n' + text);
    }).catch(function(e) {
      alert('Could not load firebase-rules.json: ' + e.message);
    });
  };
}