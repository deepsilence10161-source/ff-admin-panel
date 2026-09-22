/* ── admin-inline.js · Part B: CORE (config, auth, login, users, dashboard) ── */

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
      }).then(null, function(e){ console.warn('[NotifBridge] Supabase fail:', e.message); })
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
    }).then(null, function(e){ console.warn('[NotifBridge] All-notify Supabase fail:', e.message); });
  }
};

/* ✅ REMOVED (R24 dead-code): _supaPublishResult — zero callers (fa22's
   mrPublishResults never called it, per its own comment); and it held the
   OLD double-credit pattern (increment_balance per winner) that R24 already
   eliminated from publishResults. Balance moves exactly once via the bridge. */
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
  /* ✅ FIX (live-testing, 2026-08 — root cause of the "generic
     permission_denied" burst seen across many rounds of testing, minified
     as `Pe` in the SDK): whenever the RTDB SDK can't establish a
     WebSocket (routine in sandboxed/headless test environments, some
     mobile networks, some corporate proxies), it silently falls back to
     an HTTP long-polling transport that loads via a JSONP-style <script>
     tag (and in some SDK code paths, a hidden <iframe>) against
     {db}.firebaseio.com/.lp?.... Both script-src and frame-src additions
     for *.firebaseio.com were tried in earlier rounds and reduced but
     did not eliminate the burst, because CSP directive coverage for a
     legacy JSONP/iframe transport is inherently fragile — different SDK
     versions and code paths can route the fallback slightly differently,
     and there's no single directive guaranteed to cover all of them.
     The actually reliable fix is to prevent the fallback from ever being
     attempted: force WebSockets only. If a WebSocket genuinely can't be
     established, the connection will just fail/retry via a normal
     'disconnected' state (support chat degrades gracefully) instead of
     trying — and CSP-blocking — the long-polling fallback. */
  if (rtdb && rtdb.INTERNAL && typeof rtdb.INTERNAL.forceWebSockets === 'function') {
    rtdb.INTERNAL.forceWebSockets();
  }
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
/* ✅ REMOVED (2026-08-21): DB_TEAM/'teamRequests' — see Team Requests removal note above. */
/* BUG #46 FIX (2026-07-31, CRITICAL — widespread): 41 places across 9 files did
   `_adminUid()` / `.email` directly, with no null check. If Firebase Auth's
   currentUser is ever null when one of these runs (session not yet settled, token
   refresh gap, or any other reason the two auth systems in this app — Firebase for
   admin login, Supabase for everything else — can drift out of sync), the whole
   action throws a TypeError immediately and does nothing visible to the admin —
   consistent with "approve/reject/many buttons do nothing" reports. These helpers
   are null-safe everywhere the pattern is used, so the action can proceed even if
   currentUser is momentarily unavailable, rather than silently dying. */
function _adminUid() {
  /* ✅ FIX (live-testing — CRITICAL): this was calling window._adminUid()
     from inside its OWN body. Since a top-level `function _adminUid(){}`
     declaration IS window._adminUid (same global binding), this was
     infinite self-recursion. It never actually threw a visible
     RangeError: Maximum call stack size exceeded, because the try/catch
     wrapping it silently swallowed the stack overflow and fell through
     to the 'unknown_admin' fallback — EVERY single call to _adminUid()
     across the whole codebase (activityLogs, approve/reject audit
     trails, the "Trust This Device" email-match check, etc.) silently
     returned the fallback instead of the real admin UID/email, no
     matter who was actually logged in. This is very likely the root
     cause of "Trust This Device" always saying the email doesn't
     match — curEmail was always 'unknown', which can never equal
     anything the admin types. Fix: read the real property directly. */
  try { return (window.auth && window.auth.currentUser && window.auth.currentUser.uid) || 'unknown_admin'; }
  catch(e) { return 'unknown_admin'; }
}
function _adminEmail() {
  /* ✅ FIX (live-testing — CRITICAL): same infinite self-recursion bug
     as _adminUid() above, same silent 'unknown' fallback via try/catch. */
  try { return (window.auth && window.auth.currentUser && window.auth.currentUser.email) || 'unknown'; }
  catch(e) { return 'unknown'; }
}
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

/* ✅ WATCHDOG (2026-09-06, REVISED same day after it caused a new bug):
   original version force-reset the button (setLoading(false), which
   RE-ENABLES it) after 15s if still "loading". That re-enable was
   itself the bug: if the real save was still genuinely in flight
   (not hung, just slow) when the watchdog fired, the admin would see
   the button look normal again and tap Save a second time — starting
   a SECOND, overlapping saveTournament() call on the same match while
   the first was still running. The second call reads
   allTournaments[id] (which may not yet reflect the first call's
   still-in-flight write) for its old-vs-new matchTime comparison,
   so the two calls could race and write conflicting matchTime/status
   values — reproducing the exact "match time reverts / goes live
   unexpectedly" symptom this session was trying to fix, via a new
   mechanism (double-submit) instead of the original one.
   Fixed: the watchdog now only ever shows a "still working" message
   past 15s — it NEVER re-enables the button. The button can only be
   re-enabled by the real saveTournament() call actually finishing
   (success or error), so a second overlapping call is impossible. If
   a save is ever truly and permanently hung (not just slow), the
   admin can still close and reopen the modal to reset the button —
   that already correctly aborts the stuck UI state without risking a
   double-submit. */
function _safeSaveTournament(){
  var btn = document.getElementById('saveTournamentBtn');
  /* Extra guard: if a save is already in flight (button already shows
     loading), ignore this click entirely rather than starting a
     second overlapping saveTournament() call. */
  if (btn && btn.classList.contains('loading')) {
    console.warn('[_safeSaveTournament] ignored — a save is already in progress');
    return;
  }
  var warned = false;
  var watchdog = setTimeout(function(){
    if (btn && btn.classList.contains('loading')) {
      warned = true;
      console.warn('[_safeSaveTournament] save taking >15s — still waiting, button intentionally NOT re-enabled to avoid a double-submit');
      showToast('⏳ Save mein thoda zyada time lag raha hai — please wait, dobara tap mat karo.', true);
    }
  }, 15000);
  Promise.resolve(saveTournament()).catch(function(e){
    console.error('[_safeSaveTournament] saveTournament threw:', e);
  }).then(function(){
    clearTimeout(watchdog);
  });
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
      /* ✅ BUG FIX (2026-08-22): 'pending' was NOT in this list — but
      validate_and_join_match() (the RPC that actually deducts the entry
      fee and creates the row) sets status='pending' by default. Money is
      already taken at that point; 'pending' here means room/attendance
      pending, NOT membership pending. Excluding it meant a player who
      had genuinely joined (and paid) simply never appeared in Joined
      Players / notification lists / refund lists until some OTHER admin
      action happened to flip status — confirmed live (Testing2: user
      showed 'Joined' in their own app but the row was invisible here).
      Now only the genuinely-not-joined terminal statuses are excluded. */
      var _NOT_JOINED=['cancelled','refunded','rejected','no_show'];
      var isJoined=(_NOT_JOINED.indexOf(j.status)===-1);
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
  /* ✅ FIX (2026-08, live-testing): bridge-wait (max 4s) + 7 parallel
     loaders (each capped at 8s) = a worst-case of ~12s just for these two
     phases, before mainApp is even shown — leaving only ~3s of headroom
     against the outer 15s force-open ceiling in admin-inline.js before
     ANY other overhead (script parse, DOM paint, slow network hop)
     pushes it over. Tightened both budgets so the total worst-case stays
     comfortably under the 15s ceiling: bridge-wait 4s→2.5s (bridge
     install is normally near-instant; this only matters when it's
     genuinely broken, in which case failing 1.5s faster costs nothing),
     loader timeout 8s→6s (still generous for a single Supabase read). */
  var _bridgeWait = 0;
  while (!(window.rtdb && window.rtdb._isSupaBridge) && _bridgeWait < 25) {
    await new Promise(function(r){ setTimeout(r, 100); });
    _bridgeWait++;
  }
  if (!(window.rtdb && window.rtdb._isSupaBridge)) {
    /* ✅ FIX (live-testing — this was the actual root cause of the
       permission_denied errors seen on matches/users/profileRequests/
       profileUpdates/walletRequests/disputes, not just a timing issue):
       previously, even after this exact warning logged, execution fell
       through and started every listener below ANYWAY — permanently
       binding them to raw (un-bridged) Firebase RTDB for the entire
       session, since these paths are Supabase-only and blocked in
       Firebase Rules by design. A slow bridge install (e.g. under
       network/CPU pressure) meant guaranteed permission_denied spam on
       every login, with listeners that would NEVER self-correct even
       once the bridge did finish installing moments later. Now: keep
       polling in the background (uncapped) and only start listeners
       once the bridge is actually confirmed ready. */
    console.error('[initializeAdminPanel] Supabase bridge not ready after 2.5s — deferring all realtime listeners until it is (will keep retrying in the background; matches/wallet/join-requests will appear once ready).');
    await new Promise(function(resolve) {
      (function _pollBridge() {
        if (window.rtdb && window.rtdb._isSupaBridge) { resolve(); return; }
        setTimeout(_pollBridge, 300);
      })();
    });
    console.log('[initializeAdminPanel] Supabase bridge now ready — starting realtime listeners.');
  }
  console.log('Init — using DB node: '+DB_MATCHES+'/ for matches');
  setupProfileListener();
  setupProfileUpdateListener();
  setupUsersListener();
  /* ✅ REMOVED (2026-08-19): setupWalletListener() call removed —
     the function itself no longer exists (Wallet Requests tab
     deleted). This was an unguarded direct call at boot, so leaving
     it in place would have crashed the entire admin panel init
     sequence immediately on load ("setupWalletListener is not
     defined"), taking down setupJoinRequestsListener/
     setupRealtimeListeners/loadMaintenanceState and everything else
     below it in this same synchronous block with it. */
  setupJoinRequestsListener();
  setupRealtimeListeners();
  loadMaintenanceState();
  setTimeout(function(){
    /* ✅ FIX (live-testing — this was the actual remaining root cause
       of permission_denied on matches/profileRequests/walletRequests):
       initLiveDashboard() (admin-live-dash.js) binds permanent .on()
       listeners directly on DB_WALLET/DB_PROFILE/DB_MATCHES with no
       bridge-readiness check of its own. It was called from this
       setTimeout, OUTSIDE the bridge-wait block above (lines ~380-409)
       — so even though that block correctly waits for the bridge,
       this 1s-later call had no such guard, and would bind to raw
       Firebase on these Supabase-only paths if the bridge somehow
       still wasn't ready. Guard it the same way. */
    if (window.rtdb && window.rtdb._isSupaBridge) {
      if(window.initLiveDashboard)initLiveDashboard();
      if(window.initWithdrawalQueue)initWithdrawalQueue();
    } else {
      console.warn('[initializeAdminPanel] Supabase bridge not ready — deferring initLiveDashboard/initWithdrawalQueue.');
      (function _deferDashInit(waited){
        waited = waited || 0;
        if (window.rtdb && window.rtdb._isSupaBridge) {
          if(window.initLiveDashboard)initLiveDashboard();
          if(window.initWithdrawalQueue)initWithdrawalQueue();
          return;
        }
        if (waited >= 15000) {
          console.error('[initializeAdminPanel] Supabase bridge never became ready — initLiveDashboard/initWithdrawalQueue not started.');
          return;
        }
        setTimeout(function(){ _deferDashInit(waited + 300); }, 300);
      })();
    }
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
  /* ✅ FIX (2026-08-18, F3 live-testing): loader timeout 6000→3500ms.
     The 7 loaders run in PARALLEL, and each timed-out promise keeps
     resolving in the background (the data still renders when it arrives),
     so the 6s caps only ever delayed the moment the loading screen is
     hidden. Worst case before: 2.5s bridge-wait + 6s loaders ≈ 8.5s+
     (plus ~50-script parse time), which could cross the outer 15s
     force-open ceiling on slow connections and flash the "INITIALIZING"
     spinner for 15s. With 3.5s caps the panel opens in ~6s worst case
     while every section still fills in live. */
  /* R24 (2026-09-21) BOOT-SLIM: loadSettings/loadVouchers/loadSupportTickets
     boot से हटाए — ये सिर्फ अपने खंड का UI भरते हैं और showSection() खंड-खुलने
     पर पहले से फिर से बुला लेता है (settings→loadSettings+loadVouchers,
     support→loadSupportChats+loadSupportTickets)। बूट पर वे केवल parallel-read
     contention बढ़ाते थे। बरकरार: refreshDashboard (डिफ़ॉल्ट खंड), loadTournaments
     (allTournaments/allJoinRequests globals — dashboard इन्हीं से खिलता है),
     loadSupportChats (20s-interval अलर्ट-स्कैनर — खंड-अपेक्षित नहीं)। */
  await Promise.all([
    _withTimeout(function(){return refreshDashboard();}, 'refreshDashboard', 3500),
    _withTimeout(function(){return loadTournaments();}, 'loadTournaments', 3500),
    /* ✅ REMOVED (2026-08-21): loadTeamRequests() call — function deleted, Team Requests section removed. */
    _withTimeout(function(){return loadSupportChats();}, 'loadSupportChats', 3500)
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
  /* ✅ REMOVED (2026-08-19): walletBadge listener removed — the badge's
     nav item no longer exists (Wallet Requests tab deleted), and this
     was counting pending rows in the now-dead DB_WALLET Firebase node
     anyway (nothing writes real pending data there anymore). Sky
     Diamond/Premium/Sponsored Prizes badges are each already updated by
     their own dedicated sections independently. */
  /* ✅ REMOVED (2026-08-21): teamBadge listener — Team Requests section deleted. */

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
    
    var acts=pending?'<button class="btn btn-primary btn-xs" onclick="approveProfile(\''+id+'\', event)" title="Approve — writes IGN & FF UID to users/{uid}"><i class="fas fa-check"></i> Approve</button> <button class="btn btn-danger btn-xs" onclick="openRejectModal(\'profile\',\''+id+'\', event)"><i class="fas fa-times"></i> Reject</button>':'<span class="text-xxs text-muted">'+status+'</span>';
    
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

async function approveProfile(rid, evt){
  console.log('═══════════════════════════════');
  console.log('APPROVE PROFILE REQUEST: '+rid);
  /* ℹ️ NOTE (live-testing, 2026-08): a server-side RPC
     admin_approve_profile(p_request_id) exists in the database and does
     the same job atomically with a row lock — but it sets
     profile_status = 'complete', while the User Panel's isOk()/isVO()
     and every profileStatus check across screens/profile.js,
     features-user.js, ui-fixes.js etc. check for the string 'approved'
     specifically. Using that RPC as-is (which was considered during
     this session) would have silently broken profile verification for
     every future approval, since profile_status='approved' would never
     get set. Left as a manual flow (which does write the correct
     'approved' value) rather than risk that swap without also
     fixing/verifying the RPC and the migration deploying it. If someone
     wants to move to the RPC later: fix admin_approve_profile to set
     profile_status='approved' (or add a users-table trigger that treats
     'complete' as equivalent — but that's a bigger schema change) before
     switching this function over.
     ✅ CORRECTION (2026-08): the earlier version of this comment claimed
     a 'profile_verified' column also gets set to true — that column was
     never actually added to the users table (schema audit confirmed
     only 'profile_status' exists), so every write to it was silently
     failing this whole time. All profile_verified reads/writes have
     been removed; profile_status='approved' is the single source of
     truth for verification state everywhere in both panels now. */
  /* ✅ FIX (live-testing): this used to reference the bare global
     `event` (relying on window.event, a legacy/non-standard fallback).
     Now takes the event as an explicit parameter from the
     onclick="approveProfile(id, event)" call instead. */
  var event = evt;
  /* Disable the button that was clicked to prevent double-clicks */
  var clickedBtn = null;
  if(event&&event.target){
    clickedBtn=event.target.closest('.btn');
    if(clickedBtn){
      /* ✅ FIX (2026-08-19, CRITICAL): every early-return below (duplicate
         IGN/FF UID/phone, missing UID, empty IGN, etc.) left this button
         disabled with a spinner FOREVER — nothing ever re-enabled it,
         since the only thing that normally replaces the spinner is the
         Firebase listener re-rendering the whole row after a SUCCESSFUL
         write, which obviously never fires when we return early instead
         of writing anything. Storing the original HTML here so every
         return path (via the _resetBtn() calls added below) can restore
         the exact clickable button instead of leaving it stuck spinning
         — this is the literal "button spinning forever" bug reported
         live, and it was hit on essentially every request since the FF
         UID check itself had a separate false-positive bug (see the
         bridge-level fix in supabase-rtdb-bridge.js) that made it fire
         on nearly every approval. */
      clickedBtn.dataset._origHtml = clickedBtn.innerHTML;
      clickedBtn.disabled=true;clickedBtn.style.opacity='0.5';clickedBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    }
  }
  function _resetBtn(){
    if(clickedBtn){clickedBtn.disabled=false;clickedBtn.style.opacity='';clickedBtn.innerHTML=clickedBtn.dataset._origHtml||'<i class="fas fa-check"></i> Approve';}
  }
  try{
    /* STEP 1: Read the profile request */
    var rs=await rtdb.ref(DB_PROFILE+'/'+rid).once('value');
    if(!rs.exists()){showToast('Request not found!',true);_resetBtn();return;}
    var r=rs.val();
    var uid=getUid(r);
    if(!uid){showToast('UID missing in request! Cannot approve.',true);_resetBtn();return;}
    
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
      _resetBtn();
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
    /* ✅ FIX (2026-08): profileVerified always read false — the 'profile_verified'
       column doesn't exist in the users table (only 'profile_status' does), so this
       check never worked via that field. Also 'APPROVED' (uppercase) never matched
       live data, which is always lowercase 'approved'. Both bugs meant this safeguard
       silently never triggered. Now checks the real field with the real casing. */
    var alreadyVerified = currentUser.profile_status === 'approved';
    var isUpdateRequest = (r.type === 'update' || r._savePath === 'profileUpdates');
    if (alreadyVerified && !isUpdateRequest) {
      /* This is a NEW verification request for an already-verified user — suspicious */
      showToast('⚠️ User already has a verified profile! Use "Profile Updates" section to change IGN/FF UID.', true);
      /* Redirect to profile updates section */
      if (window.showSection) showSection('profileUpdates');
      _resetBtn();
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
      if(ignDup){showToast('❌ IGN "'+proposedIgn+'" is already taken by another user!',true);_resetBtn();return;}
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
      if(phoneDup){showToast('❌ Phone "'+proposedPhone+'" already used by another user!',true);_resetBtn();return;}
      console.log('✅ Phone is unique');
    }
    
    /* STEP 7: Validate FF UID — must be unique in ffUIDIndex */
    if(proposedFfUid){
      var fi=await rtdb.ref('ffUIDIndex/'+proposedFfUid).once('value');
      if(fi.exists()&&fi.val()!==uid){
        showToast('❌ FF UID "'+proposedFfUid+'" is already linked to another user!',true);
        _resetBtn();
        return;
      }
      console.log('✅ FF UID is unique or belongs to same user');
    }
    
    /* STEP 8: Build the update object — ONLY include fields that have values.
       ✅ FIX (2026-08-18, live DB verification): removed `approved`,
       `accessMode`, `profileUpdatePending`, `status`, `pendingUid` and
       `profileRequired` — NONE of them exist as users-table columns (REST
       42703 on each), and the bridge's supaUpdate() throws on the first
       bad column, so this STEP 9 write was aborting the entire approval
       (no IGN/FF UID saved, no notification, request left pending).
       `profile_status` is now written lowercase 'approved' — the exact
       value the user panel's profile_status==='approved' checks match
       ('APPROVED'/uppercase never matched anything). */
    var userData={
      profileVerified:true,
      profile_status:'approved',
      /* ✅ Bug 12 Fix: Clear all pending fields so user panel shows correct approved data */
      pendingIgn: null,
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
      processedBy:_adminUid(),
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
      /* ✅ FIX (2026-08-18): removed `pending_uid:null` and
         `profile_required:false` from this payload — neither column exists
         on users (REST 42703), so the ENTIRE update was failing
         silently. The remaining fields now go through. */
      window._supa.from("users").update({ign:proposedIgn,ff_uid:proposedFfUid||null,phone:proposedPhone||null,profile_status:"approved",pending_ign:null,updated_at:new Date().toISOString()}).eq("id",uid).then(null, function(e){console.warn("[ApproveProfile] Supabase sync:",e.message);});
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
      admin:_adminUid(),
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
    _resetBtn();
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
    
    var acts=ip?'<button class="btn btn-primary btn-xs" onclick="approveProfileUpdate(\''+id+'\', event)" title="Approve — overwrites current IGN/FF UID"><i class="fas fa-check"></i> Approve</button> <button class="btn btn-danger btn-xs" onclick="openRejectModal(\'profileUpdate\',\''+id+'\', event)"><i class="fas fa-times"></i> Reject</button>':'<span class="text-xxs text-muted">'+st+(d.rejectionReason?'<div title="'+d.rejectionReason+'" style="cursor:pointer;color:#f66;font-size:9px;margin-top:2px"><i class="fas fa-comment-alt"></i> '+d.rejectionReason.substring(0,20)+(d.rejectionReason.length>20?'...':'')+'</div>':'')+'</span>';
    var requestCountBadge = (d.requestCount && d.requestCount > 1) ? '<span style="background:#b964ff22;color:#b964ff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:4px">#'+d.requestCount+' request</span>' : '';
    /* ── FF UID CHANGE (2026-08-21): distinct from a same-UID IGN-only
       update — flag it clearly and show payment proof for non-premium
       requesters, so admin doesn't have to guess whether ffChanged means
       a genuine paid/premium UID-change request or just a false-positive
       diff. */
    var uidChangeBadge = d.uidChangeRequested ? ('<span style="background:'+(d.uidChangeVia==='premium'?'#b964ff22;color:#b964ff':'#ffd70022;color:#ffd700')+';font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:4px">'+(d.uidChangeVia==='premium'?'👑 PREMIUM':'💰 PAID ₹'+(d.paymentAmount||49))+' UID CHANGE</span>') : '';
    var paymentProofHtml = (d.uidChangeRequested && d.uidChangeVia==='paid') ?
      ('<div style="margin-top:4px">'+(d.paymentScreenshot?'<img src="'+d.paymentScreenshot+'" style="width:40px;height:40px;object-fit:cover;border-radius:4px;cursor:pointer" onclick="window.open(this.src)">':'<span class="text-xxs" style="color:#f66">No screenshot</span>')+' <span class="text-xxs text-muted">UTR: '+(d.paymentUtr||'—')+'</span></div>') : '';
    
    tb.innerHTML+='<tr>'+
      /* Col 1: User Name */
      '<td><strong class="text-sm">'+displayName+'</strong>'+requestCountBadge+uidChangeBadge+'<div class="text-xxs text-muted mt-1"><i class="fas fa-user-shield" style="font-size:8px;color:var(--primary)"></i> Verified User</div>'+paymentProofHtml+'</td>'+
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
async function approveProfileUpdate(rid, evt){
  console.log('═══════════════════════════════');
  console.log('APPROVE PROFILE UPDATE: '+rid);
  /* ✅ FIX (live-testing — same bare-`event` bug as approveProfile above,
     same class of "button silently does nothing" symptom). */
  var event = evt;
  /* Disable button to prevent double-clicks */
  var clickedBtn = null;
  if(event&&event.target){
    clickedBtn=event.target.closest('.btn');
    if(clickedBtn){
      /* ✅ FIX (2026-08-19, CRITICAL): same "spinner forever" bug as
         approveProfile above — see that function's comment for the full
         explanation. This was the specific function/screenshot reported
         live ("Profile update section me approve par click kiya to error
         aaya aur vo button me chakri si ghumne lagi bas"). */
      clickedBtn.dataset._origHtml = clickedBtn.innerHTML;
      clickedBtn.disabled=true;clickedBtn.style.opacity='0.5';clickedBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    }
  }
  function _resetBtn(){
    if(clickedBtn){clickedBtn.disabled=false;clickedBtn.style.opacity='';clickedBtn.innerHTML=clickedBtn.dataset._origHtml||'<i class="fas fa-check"></i> Approve';}
  }
  try{
    var rs=await rtdb.ref(DB_PROFILE_UPDATE+'/'+rid).once('value');
    if(!rs.exists()){showToast('Request not found!',true);_resetBtn();return;}
    var r=rs.val();
    var uid=getUid(r);
    if(!uid){showToast('UID missing in request!',true);_resetBtn();return;}
    
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
      if(dup){showToast('❌ IGN "'+newIgn+'" already taken!',true);_resetBtn();return;}
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
        _resetBtn();
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
      processedBy:_adminUid(),
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
      changes:{newIgn:newIgn,newFfUid:newFfUid,oldIgn:currentUser.ign||null,oldFfUid:currentUser.ffUid||null,uidChangeVia:r.uidChangeVia||null},
      admin:_adminUid(),
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
      /* ✅ FIX (2026-08-19): wrong column name — table has `action_type`,
         not `action` (confirmed live schema). This insert was silently
         failing every time (caught by the trailing .catch(function(){})),
         so this action never actually appeared in the activity log even
         though the approval itself succeeded. Also `details` is a real
         jsonb column, not text — was double-encoding via JSON.stringify()
         (works, but stores an escaped JSON *string* instead of a proper
         jsonb object); passing the object directly now. */
      window._supa.from('admin_activity_log').insert({
        admin_uid:_adminUid(),
        action_type:'profile_update_approved',
        target_uid:uid,
        details:{newIgn:newIgn,newFfUid:newFfUid,requestId:rid},
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
    _resetBtn();
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
    /* ✅ FIX (2026-08-17): 'complete' just meant "profile info filled in"
       (and was users.profile_status's old column default, now fixed
       separately) — not "approved by admin". Only 'approved' should show
       the verified checkmark. */
    var ph=u.phone||'-',em=u.email||'-',vf=(u.profileStatus==='approved')?'<span class="badge green">✓</span>':'<span class="badge yellow">—</span>';
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
  /* BUG FIX (2026-08): three stat rows below (Sky Diamond, Green
     Diamond, Coins) used escaped quotes \' instead of real string-
     concat quotes ' — so instead of splicing in the JS expression's
     result, the literal text "'+(u.skyDiamonds||db_)+'" etc. was
     printed to the page verbatim. Also swapped the stray `db_`
     fallback (a wallet-deposit variable, unrelated to sky diamonds)
     for a plain 0, matching every other stat's fallback pattern. */
  bd.innerHTML='<div class="flex items-center gap-3 mb-3"><div class="chat-avatar" style="width:44px;height:44px;font-size:16px">'+(window.admEsc?window.admEsc((u.ign||'U').charAt(0)):(u.ign||'U').charAt(0))+'</div><div><div class="font-bold" style="font-size:14px">'+(window.admEsc?window.admEsc(u.ign||'N/A'):(u.ign||'N/A'))+'</div><div class="text-xxs text-muted font-mono">'+uid+'</div><div class="text-xxs text-dim">FF: '+(u.ffUid||'N/A')+' | Ph: '+(u.phone||'N/A')+'</div></div></div><div class="detail-tabs"><div class="detail-tab active" onclick="switchTab(this,\'to_'+uid+'\')">Overview</div><div class="detail-tab" onclick="switchTab(this,\'th_'+uid+'\')">History</div><div class="detail-tab" onclick="switchTab(this,\'tl_'+uid+'\')">Level</div></div><div class="detail-panel active" id="to_'+uid+'"><div class="user-stat-row"><div class="stat-label"><i class="fas fa-gem" style="color:#00d4ff"></i> Sky Diamond</div><div class="stat-val" style="color:#00d4ff">💎'+(u.skyDiamonds||0)+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-circle" style="color:#00ff64"></i> Green Diamond</div><div class="stat-val" style="color:#00ff64"><img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block">'+(u.greenDiamonds||0)+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-coins" style="color:#ffd700"></i> Coins</div><div class="stat-val" style="color:#ffd700">🪙'+(u.coins||0)+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-gamepad"></i> Matches</div><div class="stat-val">'+(u.stats?u.stats.matches||0:0)+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-crown"></i> Wins</div><div class="stat-val">'+(u.stats?u.stats.wins||0:0)+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-crosshairs"></i> Kills</div><div class="stat-val">'+(u.totalKills||(u.stats?u.stats.kills||0:0))+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-coins"></i> Earnings</div><div class="stat-val text-primary">₹'+(u.totalWinnings||(u.stats?u.stats.earnings||0:0))+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-users"></i> Referrals</div><div class="stat-val">'+ref+'</div></div><div class="user-stat-row"><div class="stat-label"><i class="fas fa-shield-halved"></i> Profile</div><div class="stat-val">'+(u.profile_status==='approved'?'<span class="badge green">Verified</span>':'<span class="badge yellow">Unverified</span>')+'</div></div></div><div class="detail-panel" id="th_'+uid+'">'+mh+'</div><div class="detail-panel" id="tl_'+uid+'"><div class="user-stat-row"><div class="stat-label"><i class="fas fa-star"></i> Level</div><div class="stat-val"><span class="badge cyan">Lv '+lv+'</span></div></div><div class="mb-3"><div class="flex justify-between text-xxs mb-1"><span class="text-dim">EXP</span><span class="text-primary">'+xp+'/'+mx+'</span></div><div class="exp-bar"><div class="exp-fill" style="width:'+pct+'%"></div></div></div><div class="grid-2 mt-3"><div class="form-group"><label>Level</label><input type="number" id="eL_'+uid+'" class="form-input" value="'+lv+'" min="1"></div><div class="form-group"><label>EXP</label><input type="number" id="eX_'+uid+'" class="form-input" value="'+xp+'" min="0"></div></div><button class="btn btn-primary btn-sm" onclick="saveUserLevel(\''+uid+'\')"><i class="fas fa-save"></i> Save</button></div>';
  var ft=document.getElementById('userModalFooter'),bn=u.isBanned||u.blocked,lbHid=u.leaderboardHidden;
  ft.innerHTML=(bn?'<button class="btn btn-primary btn-sm" onclick="unbanUser(\''+uid+'\');closeModal(\'userModal\')"><i class="fas fa-unlock"></i> Unban</button>':'<button class="btn btn-warning btn-sm" onclick="banUser(\''+uid+'\');closeModal(\'userModal\')"><i class="fas fa-ban"></i> Ban</button>')+' '+(lbHid?'<button class="btn btn-primary btn-sm" onclick="toggleLeaderboardHidden(\''+uid+'\',false)"><i class="fas fa-eye"></i> Show on Leaderboard</button>':'<button class="btn btn-ghost btn-sm" onclick="toggleLeaderboardHidden(\''+uid+'\',true)"><i class="fas fa-eye-slash"></i> Hide from Leaderboard</button>')+' <button class="btn btn-danger btn-sm" onclick="deleteUser(\''+uid+'\');closeModal(\'userModal\')"><i class="fas fa-trash"></i> Delete</button> <button class="btn btn-ghost btn-sm" onclick="closeModal(\'userModal\')">Close</button>';
  document.getElementById('userModal').classList.add('show');
}
/* ✅ NEW (2026-08-22): the durable, race-free replacement for manually
   deleting a row from the `leaderboard` table — a direct delete gets
   silently undone by trg_sync_leaderboard the next time ANYTHING about
   that user updates (coins, login, literally any users row change),
   because the trigger only checked is_banned/ign, not any kind of
   "admin hid this user" flag. This sets the new leaderboard_hidden
   column, which the trigger now respects permanently regardless of
   how many other times that user's row gets touched afterward. */
async function toggleLeaderboardHidden(uid,hide){
  try{
    await rtdb.ref(DB_USERS+'/'+uid).update({leaderboardHidden:!!hide});
    if(window.usersCache&&window.usersCache[uid])window.usersCache[uid].leaderboardHidden=!!hide;
    showToast(hide?'User hidden from leaderboard':'User shown on leaderboard again');
  }catch(e){showToast('Error: '+e.message,true);}
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
    /* Bug#8+10 Fix, BUG #40 FIX (2026-07-30): moved from direct .update({is_banned:...})
       to the set_user_ban_status RPC — the raw column UPDATE relied only on is_admin+RLS,
       and the is_banned/ban_reason columns had a blanket UPDATE grant for authenticated
       (not just admins), so any logged-in user could self-unban via a direct API call.
       The RPC checks is_caller_admin() server-side and the column grant is now revoked
       entirely, so this path is the only way to change ban status at all. Also now
       correctly syncs the ban reason (previous version only synced is_banned, never
       ban_reason, to Supabase). */
    if(window._supa){window._supa.rpc('set_user_ban_status',{p_uid:uid,p_banned:true,p_reason:r}).then(null, function(e){console.warn('[BUG#40] banUser Supabase:',e.message);});}
    /* Refresh cache */
    if(window.usersCache&&window.usersCache[uid])window.usersCache[uid].isBanned=true;
    showToast('User banned');
  }catch(e){showToast('Error: '+e.message,true);}
}
async function unbanUser(uid){
  if(!confirm('Unban?'))return;
  try{
    await rtdb.ref(DB_USERS+'/'+uid).update({isBanned:false,blocked:false,status:'active',banReason:null,bannedAt:null});
    /* FIX Bug#10, BUG #40 FIX (2026-07-30): moved to set_user_ban_status RPC — see banUser
       comment above for why the direct column UPDATE was a security gap. */
    if(window._supa){
      window._supa.rpc('set_user_ban_status',{p_uid:uid,p_banned:false})
        .catch(function(e){console.warn('[BUG#40] unbanUser Supabase sync:',e.message);});
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
       Mark deleted so user cannot re-appear in stats/leaderboard.
       BUG #41 FIX (2026-07-30): `deleted_at` column didn't exist in the schema at all —
       this whole update has been failing outright (column does not exist) every time,
       silently caught by the .catch() below. Column now added.
       BUG #40 FIX (2026-07-30): is_banned split out into its own RPC call (see banUser
       comment) since that column's direct-UPDATE grant is now revoked — a compound
       update touching is_banned alongside other columns would otherwise fail entirely. */
    if(window._supa){
      window._supa.rpc('set_user_ban_status',{p_uid:uid,p_banned:true,p_reason:'Account deleted'}).then(null, function(){});
      window._supa.from('users').update({
        is_deleted:true,
        deleted_at:new Date().toISOString(),ign:'[deleted]',ff_uid:null,phone:null
      }).eq('id',uid)
        .catch(function(e){console.warn('[Bug#10 Fix] deleteUser Supabase cleanup:',e.message);});
      /* Remove from leaderboard */
      window._supa.from('leaderboard').delete().eq('user_id',uid).then(null, function(){});
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
          var _supaOk=await window._supa.rpc('increment_balance',{p_uid:uid,p_col:supaCol,p_amount:amt}).then(null, function(){return {error:{message:'rpc_missing'}};});
          if(_supaOk&&_supaOk.error&&_supaOk.error.message&&_supaOk.error.message.includes('rpc_missing')){
            /* RPC not set up — fallback to direct read+update */
            var _cur=await window._supa.from('users').select(supaCol).eq('id',uid).single().then(function(r){return r;}, function(){return {data:null};});
            if(_cur.data) window._supa.from('users').update({[supaCol]:(_cur.data[supaCol]||0)+amt}).eq('id',uid).then(null, function(){});
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
          var _supaOk2=await window._supa.rpc('decrement_balance',{p_uid:uid,p_col:supaCol,p_amount:amt}).then(null, function(){return {error:{message:'rpc_missing'}};});
          if(_supaOk2&&_supaOk2.error&&_supaOk2.error.message&&_supaOk2.error.message.includes('rpc_missing')){
            var _cur2=await window._supa.from('users').select(supaCol).eq('id',uid).single().then(function(r){return r;}, function(){return {data:null};});
            if(_cur2.data) window._supa.from('users').update({[supaCol]:Math.max((_cur2.data[supaCol]||0)-amt,0)}).eq('id',uid).then(null, function(){});
          }
        }
      }
    }
    await rtdb.ref(DB_USERS+'/'+uid+'/transactions').push({type:act==='credit'?'admin_credit':'admin_debit',currency:wt,amount:act==='credit'?amt:-amt,description:rsn,timestamp:Date.now()});
    if(window._supa){window._supa.from('wallet_transactions').insert({user_id:uid,currency:supaCol,txn_type:act==='credit'?'admin_credit':'admin_debit',amount:act==='credit'?amt:-amt,description:rsn}).then(null, function(){});}
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
    /* ✅ FIX (2026-08-19, CRITICAL): "Wallet Pending" and "Platform
       Profit"/"Total Collected" dashboard stats used to be calculated
       from DB_WALLET (Firebase walletRequests node) — but nothing
       writes to that node anymore. quick-deposit.js (Sky Diamond
       purchases) and diamond-system.js (Green Diamond withdrawals) both
       write directly to Supabase sd_requests now (see earlier session
       fixes), and Sponsored Prize withdrawals live in Supabase
       wallet_transactions. This means these dashboard numbers have been
       silently stale/wrong (reading an effectively-dead data source)
       for a while — a real problem for figures like Platform Profit
       that a real-money platform owner needs to trust. Now pulls from
       the actual live Supabase tables instead. */
    var wp=0,wd=0;
    if (window._supa) {
      try {
        var sdPending = await window._supa.from('sd_requests').select('request_type').eq('status','pending');
        (sdPending.data||[]).forEach(function(r){ wp++; if(r.request_type==='green_diamond_withdrawal') wd++; });
        var wtPending = await window._supa.from('wallet_transactions').select('id').eq('txn_type','pending_withdraw').or('status.is.null,status.eq.pending');
        var wtCount = (wtPending.data||[]).length;
        wp += wtCount; wd += wtCount;
      } catch(e) { console.error('[Dashboard] wallet stats fetch failed:', e.message); }
    }
    document.getElementById('statWalletReq').textContent=wp;document.getElementById('statPendingWithdraw').textContent=wd;
    var pp=0;pS.forEach(function(c){if(!c.val().status||c.val().status==='pending')pp++;});document.getElementById('statPendingProfiles').textContent=pp;
    var am=0;tS.forEach(function(c){if(c.val().status==='live')am++;});document.getElementById('statActiveMatches').textContent=am;
    /* Platform profit stats — now calculated from live Supabase data
       (sd_requests deposits/withdrawals + wallet_transactions sponsored
       payouts) instead of the dead DB_WALLET Firebase node. */
    try {
      var totalDeposits = 0, totalPayouts = 0;
      if (window._supa) {
        var sdApproved = await window._supa.from('sd_requests').select('request_type, amount_inr').eq('status','approved');
        (sdApproved.data||[]).forEach(function(r){
          var amt = Number(r.amount_inr)||0;
          if (r.request_type === 'sky_diamond_purchase') totalDeposits += amt;
          else if (r.request_type === 'green_diamond_withdrawal') totalPayouts += amt;
        });
        var wtApproved = await window._supa.from('wallet_transactions').select('amount').eq('txn_type','pending_withdraw').eq('status','approved');
        (wtApproved.data||[]).forEach(function(r){ totalPayouts += Number(r.amount)||0; });
      }
      var netProfit = totalDeposits - totalPayouts;
      var profEl = document.getElementById('dashPlatformProfit');
      var collEl = document.getElementById('dashTotalCollected');
      if(profEl) profEl.textContent = '₹' + netProfit;
      if(collEl) collEl.textContent = '₹' + totalDeposits;
      /* ✅ REMOVED (2026-08): coin_requests poll removed — coins are never
         purchasable in the User Panel, feature retired. */
      /* Paid matches count */
      var tmEl = document.getElementById('dashTotalMatches');
      if(tmEl) { var paidCount=0; tS.forEach(function(c){if(Number(c.val().entryFee)>0)paidCount++;}); tmEl.textContent = paidCount; }
    } catch(e) { /* silent */ }
    var rE=document.getElementById('recentProfiles');var rh='',rc=0;
    pS.forEach(function(c){var d=c.val();if((!d.status||d.status==='pending')&&rc<5){rc++;rh+='<div class="feed-item"><div class="flex items-center gap-2"><span class="badge primary" style="font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(window.admEsc?window.admEsc(d.ign||d.username||'Unknown'):(d.ign||d.username||'Unknown'))+'</span><span class="badge yellow">Pending</span></div><div class="time">'+(d.createdAt?new Date(d.createdAt).toLocaleString():'N/A')+'</div></div>';}});
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
