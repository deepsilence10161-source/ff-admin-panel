/* ================================================================
   APP SETTINGS ADMIN — fa-app-settings.js
   Admin se sab kuch control karo — koi code change nahi
   ✅ MIGRATED (2026-08): Firebase appSettings/liveConfig →
   Supabase app_settings table (key='live_config') aur
   adminConfig/creatorSystem (key='creator_system'). Firebase ab
   sirf chat/presence/anti-cheat ke liye — koi bhi actual data
   Firebase pe nahi rehta.
   ✅ B24 (2026-10-07): video_moderation hata — poora "Creator Video
   System" gaya (wajah us section ki jagah neeche likhi hai).
   ================================================================ */

var _AS  = {}; // main config cache (app_settings.live_config)
var _CVS = {}; // creator settings cache (app_settings.creator_system)

/* ── VERSION COMPARE (2026-10-06) ─────────────────────────────────
   appLatestVersion ko automatically manage kiya jaata hai (GitHub Actions
   har APK release par set karta hai). Admin form purane value ke saath save
   kare to naya/bada number overwrite na ho — uske liye semantic compare.
   '1.0.112' > '1.0.9' — plain number compare se yeh galat hota, isliye
   hissa-dar-hissa (dot se alag) compare kar rahe hain. */
function _verCmp(a, b) {
  var pa = String(a || '0').split('.'), pb = String(b || '0').split('.');
  var n = Math.max(pa.length, pb.length);
  for (var i = 0; i < n; i++) {
    var x = parseInt(pa[i] || '0', 10) || 0, y = parseInt(pb[i] || '0', 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

window.loadAppSettings = function() {
  /* Remove any leftover diagnostic banner if present */
  if (!window._supa) { setTimeout(window.loadAppSettings, 500); return; }

  /* ✅ BUG FIX (2026-09-17, confirmed via screenshot): "Loading
     settings..." spinner stays up forever, and the whole admin panel
     stops responding to clicks after that — happened on a visibly
     very slow connection (3 KB/s in the reporting screenshot's status
     bar). The .then()/.catch() fix from the previous round only
     covers the query actually rejecting; it does nothing if the
     underlying network request just hangs and never settles at all
     (neither resolves nor rejects) — which is exactly what a
     3 KB/s connection can do to a request that would normally take
     under a second. A native Promise has no built-in timeout, so a
     genuinely stuck fetch leaves .then()/.catch() both permanently
     unfired — the previous fix couldn't have helped a screenshot
     taken on a version that predates it, but it also can't fully fix
     this specific "request never settles" case on its own. Racing the
     real query against a manual timeout, using Promise.race, forces
     SOME outcome within 10s no matter what the network does — this is
     also why "poora admin panel kaam karna band kar deta hai" makes
     sense even though only this one tab's content looked broken: an
     unresolved promise chain doesn't freeze other buttons by itself,
     but on a connection this slow, every OTHER admin action fired
     afterward (tab switches, other loads) queues up behind the same
     starved network/JS-engine conditions, making the whole panel feel
     dead until something actually completes or times out. */
  var _settingsTimedOut = false;
  var _timeoutTimer = setTimeout(function () {
    _settingsTimedOut = true;
    console.error('[AppSettings] load timed out after 10s — network likely too slow/stuck');
    var cont = document.getElementById('appSettingsContent');
    if (cont) cont.innerHTML = '<div style="text-align:center;padding:40px;color:#ff6b6b"><i class="fas fa-wifi fa-2x"></i><br><br>Settings load hone mein bahut time lag raha hai.<br><span style="font-size:11px;color:#888">Network slow ho sakta hai — check karo aur retry karo.</span><br><br><button class="btn btn-ghost btn-sm" onclick="loadAppSettings()">Retry</button></div>';
  }, 10000);

  window._supa.from('app_settings').select('key,value').in('key', ['live_config', 'creator_system'])   /* ✅ B24: video_moderation gaya */
    .then(function(r) {
      clearTimeout(_timeoutTimer);
      if (_settingsTimedOut) return; /* already showed the timeout message; a late success shouldn't silently replace it without the admin re-triggering */
      if (r.error) { console.error('[AppSettings] load error:', r.error.message); _renderAppSettings(); return; }
      var rows = r.data || [];
      var byKey = {};
      rows.forEach(function(row) { byKey[row.key] = row.value; });
      _AS = byKey.live_config || {};
      _CVS.creator = byKey.creator_system || {};
      _renderAppSettings();
    }, function(e) {
      clearTimeout(_timeoutTimer);
      if (_settingsTimedOut) return;
      /* ✅ BUG FIX (2026-09-17): "App Settings tab pe jaate hi crash" —
         this .then() had no second/reject argument and no .catch(), so
         if the Supabase query itself ever rejected (network drop,
         timeout, auth token mid-refresh), it became a silent unhandled
         promise rejection: the "Loading settings..." spinner stayed up
         forever with zero visible error, which can look and feel like
         the whole tab crashed/froze even though nothing else on the
         page actually broke. Now surfaces a real error message in the
         panel itself instead of an infinite silent spinner, and logs
         the actual failure reason to the console so it can be diagnosed
         from a screenshot instead of guessed at. */
      console.error('[AppSettings] load promise rejected:', e);
      var cont = document.getElementById('appSettingsContent');
      if (cont) cont.innerHTML = '<div style="text-align:center;padding:40px;color:#ff6b6b"><i class="fas fa-exclamation-triangle fa-2x"></i><br><br>Settings load nahi ho payi.<br><span style="font-size:11px;color:#888">' + ((e && e.message) || String(e)) + '</span><br><br><button class="btn btn-ghost btn-sm" onclick="loadAppSettings()">Retry</button></div>';
    });
};

function _renderAppSettings() {
  try {
  var c = _AS;

  /* ── helpers ── */
  function val(path, def) {
    var parts = path.split('.');
    var cur = c;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return def;
      cur = cur[parts[i]];
    }
    return cur != null ? cur : def;
  }

  /* ✅ B22 (2026-10-06): settings ke andar HTML me value daalne se pehle
     escape — pehle sirf instructions textarea me hota tha, ab QR ka data-URI
     (jo bahut lamba hota hai aur theoretically quote bhi rakhta hai) bhi
     value attribute me jata hai. */
  function _asEsc(v) {
    return String(v == null ? '' : v).replace(/[<>&"']/g, function (ch) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function row(id, label, value, type, hint) {
    type = type || 'number';
    hint = hint ? '<div style="font-size:10px;color:#666;margin-top:3px">' + hint + '</div>' : '';
    return '<div class="form-group" style="margin-bottom:10px">' +
      '<label style="font-size:12px">' + label + '</label>' +
      '<input type="' + type + '" id="as_' + id + '" class="form-input" value="' + value + '" style="font-size:13px">' +
      hint + '</div>';
  }

  function section(title, icon, color, content) {
    return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px;margin-bottom:14px">' +
      '<div style="font-size:13px;font-weight:800;color:' + color + ';margin-bottom:12px;display:flex;align-items:center;gap:8px">' +
        '<i class="' + icon + '"></i> ' + title +
      '</div>' + content + '</div>';
  }

  var html = '';

  /* ── APP FORCE UPDATE CONTROL (2026-07) ──
     Minimum Supported Version (not just "latest version") so a small
     patch release doesn't force EVERY user to update — only versions
     older than the minimum get blocked. Force Update ON/OFF lets you
     instantly disable the whole thing (e.g. wrong APK link, no new
     release ready yet) without touching code. */
  html += section('📱 App Force Update Control', 'fas fa-mobile-alt', '#ff6b6b',
    '<div style="background:rgba(255,107,107,.07);border:1px solid rgba(255,107,107,.2);border-radius:10px;padding:10px 12px;margin-bottom:12px">' +
      '<div style="font-size:11px;color:#ccc">Jis user ki installed APK version <b>Minimum Supported Version</b> se purani hogi, usko poori app ki jagah ek blank "Update Required" screen dikhegi — jab tak wo naya APK <b>install</b> nahi kar leta (sirf download karne se nahi hategi).</div>' +
    '</div>' +
    row('appLatestVersion', '🆕 Latest Version (e.g. 1.3.8)', val('appLatestVersion','1.0.0'), 'text', '🤖 AUTO: har APK release par GitHub Actions apne aap set karta hai. Yahan se purani (chhoti) value save nahi hogi — safe hai.') +
    row('appMinSupportedVersion', '⛔ Minimum Supported Version (e.g. 1.3.5)', val('appMinSupportedVersion','1.0.0'), 'text', 'Isse purani installed version wale users ko FORCE update screen dikhegi. Chhota bug fix ho to isse mat badlo — sirf "Latest Version" badlo.') +
    row('appApkUrl', '🔗 APK Download URL', val('appApkUrl',''), 'text', 'Direct .apk link (GitHub Release / Uptodown / apna host) — "Update Now" button isi ko kholega') +
    row('appSupportContact', '💬 Support WhatsApp Number (optional)', val('appSupportContact',''), 'text', 'Format: 91XXXXXXXXXX (country code ke saath). Update screen par "Contact Support" button dikhega — link kaam na kare to user fasega nahi.') +
    row('appExpectedSigningHash', '🔒 Expected APK Signing SHA-256 (advanced, optional)', val('appExpectedSigningHash',''), 'text', 'Khaali chhodo agar pata nahi. Agar bharoge, to koi bhi resigned/tampered APK (fake version number ke saath) bhi block ho jayega — sirf tumhare real GitHub Actions keystore se signed APK hi chalega.') +
    '<div class="form-group" style="margin-bottom:6px"><label style="font-size:12px">🚨 Force Update ON/OFF</label>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:6px">' +
        '<label class="toggle"><input type="checkbox" id="as_appForceUpdateEnabled" ' + (val('appForceUpdateEnabled', false) ? 'checked' : '') + '><span class="toggle-slider"></span></label>' +
        '<span id="forceUpdateToggleLabel" style="font-size:12px;color:' + (val('appForceUpdateEnabled', false) ? '#ff6b6b' : '#888') + '">' + (val('appForceUpdateEnabled', false) ? '🔴 ON — purani version wale LOCKED hain' : '⚪ OFF — koi bhi version chal jaayega') + '</span>' +
      '</div>' +
      '<div style="font-size:10px;color:#666;margin-top:4px">Emergency switch: kuch galat ho jaaye (galat APK link, bug) to isse OFF karke turant sabko wapas app use karne do — code/release change kiye bina.</div>' +
    '</div>'
  );
  html += section('Auto Squad & Duo Matching', 'fas fa-users', '#00d4ff',
    row('autoSquadEnabled', '👥 Auto Squad/Duo Matching ON/OFF', val('autoSquadEnabled',1), 'number', '1 = ON, 0 = OFF') +
    row('autoSquadTimeout', '⏰ Max wait time (minutes)', val('autoSquadTimeout',15), 'number', 'Itne min baad queue cancel ho jaayegi')
  );

  /* ✅ B30 (2026-10-07): "Pre-Match Check-In System" ka poora section hata diya
     (Check-In ON/OFF + khulne/band hone ke minute). Poora system user panel se
     nikal gaya — features/checkin-system.js delete, matches.js ke button gaye.
     Wajah: check-in ka asli kaam check-in-miss auto-refund / slot-release tha,
     aur wo policy 2026-10-03 me hi khatam ho chuki thi — yaani yeh settings
     aisi cheez chalati thi jo maujood hi nahi thi. */

  html += section('Watch & Earn Settings', 'fas fa-eye', '#b964ff',
    row('watchEarnEnabled',      '👀 Watch & Earn ON/OFF', val('watchEarnEnabled',1),         'number', '1 = ON, 0 = OFF') +
    /* ✅ FIX (2026-10-06): mismatch saaf kiya. Pehle yahan "Coins per interval"
       + "Interval 5 min" tha (yaani 2 coins / 5 min) — par user panel me
       "2🪙/min" dikhta tha. Owner ne confirm kiya: 2 coins PER MINUTE sahi hai.
       Ab interval default 1 hai aur neeche live "= X coins per minute" line
       dikhti hai, taki admin ko hamesha asli rate pata rahe. */
    row('watchCoinsPerInterval', '🪙 Coins per interval (har interval par)', val('watchCoinsPerInterval',2), 'number', 'Har interval poora hone par itne coins milte hain') +
    row('watchIntervalMins',     '⏱️ Interval (minutes) — 1 = हर मिनट',    val('watchIntervalMins',1),     'number', 'Default 1 rakho to 2 coins har minute (user ko yahi dikhta hai)') +
    '<div style="background:rgba(0,212,255,.06);border:1px solid rgba(0,212,255,.2);border-radius:8px;padding:8px 10px;margin:-4px 0 10px;font-size:11px;color:#8fe3ff">' +
      '📐 असली rate: <b id="as_watchRate">' + (val('watchCoinsPerInterval',2) / Math.max(1, val('watchIntervalMins',1))).toFixed(2) + ' coins / minute</b>' +
      ' — user panel me bilkul yahi rate dikhega' +
    '</div>' +
    row('watchDailyLimitMins',   '📅 Daily limit (minutes)', val('watchDailyLimitMins',30),    'number', 'Din mein kitne min tak earn kar sakte hain')
  );

  /* ✅ B18 (2026-10-07): ye section admin ko samajh hi nahi aata tha —
     (a) "Season end (days from today)" har save par aaj se dobara ginta tha
         (tareekh kabhi theek nahi baithti thi),
     (b) "Season Active (1/0)" me 1/0 likhna padta tha (galat number bhi chal jaata),
     (c) सबसे बड़ी बात: in settings ka USER PANEL par koi asar hi nahi tha —
         user ki season ek ALAG row (app_settings.currentSeason) se aati thi,
         jo 2026-09-08 se waisi hi padi thi (endDate: null ⇒ user ko jhoothi
         "30 din baaki" dikhti thi).
     Ab: naam + ON/OFF toggle + ASLI tareekh, aur ek hi save dono jagah
     (live_config + currentSeason) likhta hai — dono panel ek hi sach dekhte hain. */
  var _sEndMs = Number(val('seasonEndDate', 0)) || (Date.now() + (Number(val('seasonEndDays', 90)) || 90) * 86400000);
  var _sEndD  = new Date(_sEndMs);
  var _sEndVal = isNaN(_sEndD.getTime()) ? '' :
        (_sEndD.getFullYear() + '-' + String(_sEndD.getMonth() + 1).padStart(2, '0') + '-' + String(_sEndD.getDate()).padStart(2, '0'));
  html += section('Seasonal League', 'fas fa-trophy', '#ffd700',
    row('seasonName', '🏆 Season ka naam', val('seasonName','Season 1'), 'text', 'User panel (profile/rank screen) par yahi naam dikhta hai') +
    '<div class="form-group" style="margin-bottom:10px">' +
      '<label style="font-size:12px">📅 Season chal raha hai?</label>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:6px">' +
        '<label class="toggle"><input type="checkbox" id="as_seasonActive" ' + ((Number(val('seasonActive',1)) !== 0) ? 'checked' : '') + '><span class="toggle-slider"></span></label>' +
        '<span style="font-size:11px;color:#888">ON = season chalu (rank points gine jaate hain) · OFF = off-season</span>' +
      '</div>' +
    '</div>' +
    row('seasonEndDate', '⏳ Season khatam hone ki tareekh', _sEndVal, 'date', 'Jab tak season chalu hai, ye tareekh user ko dikhti hai') +
    '<div id="as_seasonLeft" style="font-size:11px;color:#00ff9c;margin:-4px 0 10px"></div>'
  );

  /* 1. EARN SETTINGS */
  html += section('Coin Earn Settings', 'fas fa-coins', '#ffd700',
    row('adCoins',         '📺 Ad Watch Coins',          val('adCoinsPerWatch', 10),   'number', 'Rewarded ad dekhhne pe kitne coins milenge') +
    row('adDailyLimit',    '📺 Ad Daily Limit',           val('adDailyLimit', 5),       'number', 'Roz maximum kitni baar ad dekh sakte hain')
    /* ✅ REMOVED (2026-08-22): "Share Result Coins" — per explicit
       instruction, sharing a result should not pay coins. The feature
       (giveShareCoins in growth.js) has been fully removed from both
       panels; this config field is removed with it since it no longer
       controls anything. */
  );

  /* ✅ BUG FIX (2026-09-16): "Daily check in coins, daily login, check
     in — teeno hi same reward dete the, sirf ek chahiye" — m_daily_login
     and m_daily_checkin removed from here. Both used to pay coins for
     the exact same event as "Daily Check-In Coins" above (the real
     Check-In button, process_daily_checkin RPC) — a user could collect
     all three for one login/check-in. daily_match and daily_kills3
     remain — genuinely separate actions.
     ✅ B26 (2026-10-07): "📅 Daily Check-In Coins" + "🔥 7-Day Streak
     Bonus Coins" rows bhi hata diye — dono DEAD settings thi. Wajah:
     process_daily_checkin RPC (2026-09-20 Round-4) se teeno params
     IGNORE karta hai aur server constants par chalta hai (7-din cycle
     5,7,10,12,15,20,30 + day-30 par 100 bonus) — yahan value badalne ka
     user par ZERO asar hota tha (UI galat vaada kar rahi thi).
     Ab daily check-in rewards ka EK hi editor: Quick Tools →
     "🎁 Daily Bonus Editor" (live_config.dailyBonusRewards — migration
     2026-10-07-b24-b26 ke saath RPC bhi usi ko padhta hai). */
  var m = val('missions', {});
  html += section('Mission Rewards (Coins)', 'fas fa-tasks', '#00ff9c',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    row('m_daily_match',    '🎮 1 Match Khelo',   m.daily_match   || 10) +
    row('m_daily_kills3',   '💀 3 Kills Karo',    m.daily_kills3  || 5) +
    row('m_week_5matches',  '🎯 5 Matches/Week',  m.week_5matches || 50) +
    row('m_week_top3',      '🏆 Top 3 Finish',    m.week_top3     || 30) +
    /* ✅ REMOVED (2026-08-22): "Share/Week" mission reward — same
       removal as above, this mission's only progress source no longer
       exists. */
    '</div>'
  );

  /* 3. STREAK MILESTONES */
  var sm = val('streakMilestones', {});
  html += section('Streak Milestone Rewards', 'fas fa-fire', '#ff8c00',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    row('sm_3',   '🔥 Day 3 Coins',   (sm[3]  && sm[3].coins)  || 20) +
    row('sm_7',   '🔥 Day 7 Coins',   (sm[7]  && sm[7].coins)  || 100) +
    row('sm_14',  '🔥 Day 14 Coins',  (sm[14] && sm[14].coins) || 200) +
    row('sm_30',  '🔥 Day 30 Coins',  (sm[30] && sm[30].coins) || 500) +
    row('sm_60',  '🔥 Day 60 Coins',  (sm[60] && sm[60].coins) || 1000) +
    row('sm_100', '🔥 Day 100 Coins', (sm[100]&& sm[100].coins)|| 2000) +
    '</div>'
  );

  /* 4. REFERRAL SETTINGS */
  /* ✅ B20 (2026-10-07): teeno referral rewards ab DB me WAKAI lagu hain —
     join bonus dono ko (apply_referral_code + claim_referral_reward),
     SD bonus sirf dost ki PEHLI SD purchase par (resolve_sd_request →
     referrals.sd_bonus_paid), match bonus jab dost ke total_matches
     threshold paar karein (users par trg_ref_match_bonus). Match
     milestone bhi ab yahin se setting hai (referralMatchThreshold). */
  html += section('Refer & Earn Settings', 'fas fa-user-friends', '#b964ff',
    row('refJoinCoins',      '👥 Dost join kare → Coins',         val('referralJoinCoins', 50),         'number', 'Dono ko milenge') +
    row('refSDBonus',        '💎 Dost SD kharido → Sky Diamond Bonus', val('referralSDBonusDiamonds', 10), 'number', 'Referrer ko — sirf dost ki PEHLI SD purchase par') +
    row('refMatchThreshold', '🎮 Match Milestone (kitne matches?)', val('referralMatchThreshold', 5),   'number', 'Dost itne matches poore kare') +
    row('refMatchCoins',     '🎮 Dost ' + val('referralMatchThreshold', 5) + ' matches khele → Coins', val('referralMatchCoins', 30), 'number', 'Referrer ko milenge')
  );

  /* 5. PREMIUM SETTINGS */
  var pp = val('premium.prices', {1:49, 2:99, 3:199});
  var pb = val('premium.bonuses', {1:50, 2:150, 3:400});
  html += section('Premium Subscription', 'fas fa-gem', '#b964ff',
    '<div style="font-size:11px;color:#888;margin-bottom:10px">Prices (₹/month) aur Monthly Bonus Coins</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    row('pp_silver_price',  '🥈 Silver — Price ₹', pp[1]||49)  +
    row('pp_silver_bonus',  '🥈 Silver — Coins/mo', pb[1]||50)  +
    row('pp_gold_price',    '🥇 Gold — Price ₹',   pp[2]||99)  +
    row('pp_gold_bonus',    '🥇 Gold — Coins/mo',  pb[2]||150) +
    row('pp_diamond_price', '💎 Diamond — Price ₹',pp[3]||199) +
    row('pp_diamond_bonus', '💎 Diamond — Coins/mo',pb[3]||400) +
    '</div>'
  );

  /* 5b. BATTLE PASS SETTINGS */
  html += section('Battle Pass / Season Pass', 'fas fa-medal', '#00ff9c',
    row('battlePassPrice', '🎫 Battle Pass Price ₹/season', val('battlePassPrice', 49), 'number', 'Ek season unlock karne ki price — features/battle-pass.js isi ko live padhta hai')
  );

  /* 5c. NOTIFICATION TIMING (pehle yahan 'Room ID Auto-Release Settings' ke
     naam se ek roomReleaseMins row thi — ✅ B6/B21 (2026-10-06): wo row
     Room Manager ki per-match setting ka DUPLICATE thi aur use koi
     padhta bhi nahi tha (asli release har match ke `room_release_minutes`
     se hota hai, jo Room Manager me chips se set hota hai). User ka niyam:
     "Room ID/password timing SIRF Room Manager me" — isliye hata di gayi.
     Notification wale timings yahan Settings me hi rehte hain. */
  html += section('Notification Timing Settings', 'fas fa-bell', '#00ff9c',
    row('matchReminderMins', '🔔 Match reminder notification (minute pehle)', val('matchReminderMins', 30), 'number', 'User ko match se pehle notification jaegi (user khud bhi match se pehle ka samay chun sakta hai)') +
    /* ✅ B4 (2026-10-07): match shuru hone se pehle ka push — SERVER (cron) bhejta
       hai, is liye panel band hone par bhi pahunchta hai. Default 5 minute. */
    row('matchStartAlertMins', '⚡ Match start alert (minute pehle) — OneSignal push', val('matchStartAlertMins', 5), 'number', 'Match ke saare joined players ko server se push jaega (app band ho tab bhi). Default 5 minute.') +
    /* ✅ A9 (2026-10-06): purani broadcast naye users ko kitne din tak dikhe — 0 = sab */
    row('notifBroadcastDays', '📣 Purani broadcast notification kitne din tak dikhe', val('notifBroadcastDays', 7), 'number', 'Naye user ko sirf itne din ki admin broadcast dikhegi (0 = sab dikhe)') +
    /* ✅ B5 (2026-10-07): admin panel ke apne match-start alerts pehle code me
       15/5 par hardcode the — ab yahin se badalte hain (default wahi 15/5). */
    row('admAlertEarlyMins', '🖥️ Admin panel chetavni (minute pehle)', val('admAlertEarlyMins', 15), 'number', 'Admin panel me match shuru hone se itne minute pehle pehli chetavni (default 15)') +
    row('admAlertUrgentMins', '🚨 Admin panel URGENT chetavni (minute pehle)', val('admAlertUrgentMins', 5), 'number', 'Itne minute pehle laal URGENT chetavni (default 5; isse zyada nahi ho sakti)')
  );

  /* 5d. PAYMENT SETTINGS — Paytm Instant Checkout */
  html += section('Payment Settings', 'fas fa-wallet', '#00baf2',
    '<div style="background:rgba(0,186,242,.07);border:1px solid rgba(0,186,242,.2);border-radius:10px;padding:10px 12px;margin-bottom:12px">' +
      '<div style="font-size:11px;font-weight:800;color:#00baf2;margin-bottom:4px">⚡ Paytm Instant Checkout</div>' +
      '<div style="font-size:11px;color:#888">Enable karne se pehle Supabase mein secrets set karo:<br>' +
      '<code style="font-size:10px;color:#ffd700">PAYTM_MID, PAYTM_MERCHANT_KEY, PAYTM_ENV, PAYTM_WEBSITE, PAYTM_CALLBACK_URL</code><br>' +
      'Bina secrets ke enable kiya to users ko error aayega.</div>' +
    '</div>' +
    '<div class="form-group" style="margin-bottom:10px"><label style="font-size:12px">⚡ Paytm Instant Checkout ON/OFF</label>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:6px">' +
        '<label class="toggle"><input type="checkbox" id="as_paytmEnabled" ' + (val('paytmEnabled', false) ? 'checked' : '') + '><span class="toggle-slider"></span></label>' +
        '<span id="paytmToggleLabel" style="font-size:12px;color:' + (val('paytmEnabled', false) ? '#00ff9c' : '#888') + '">' + (val('paytmEnabled', false) ? '✅ Button visible to users' : '🔴 Button hidden from users') + '</span>' +
      '</div>' +
      '<div style="font-size:10px;color:#666;margin-top:4px">ON = "Pay Instantly via Paytm" button wallet mein dikhega</div>' +
      /* ✅ B23 (2026-10-06): ONLINE PAYMENT KI SEEMA — user ka niyam:
         "Paytm ON ho to har transaction par ₹2000 ki seema (₹2000 se upar
          online payment par shopkeeper charge lagta hai)".
         Isliye ye value live_config.paytmMaxTxn me jati hai aur user panel
         (js/paytm-checkout.js) isse pehle hi rok deta hai — order banta hi
         nahi, paisa kat bhi nahi sakta, aur koi payment atka nahi rehta.
         Isse upar ka amount user UPI/QR (manual) se deta hai. */
      '<div class="form-group" style="margin-bottom:10px"><label style="font-size:12px">⚡ Online Payment ki Seema (₹ max per transaction)</label>' +
        '<input type="number" id="as_paytmMaxTxn" class="form-input" value="' + String(val('paytmMaxTxn', 2000)) + '" min="10" style="font-size:13px">' +
        '<div style="font-size:10px;color:#666;margin-top:3px">Itne se upar ka payment user ko sIdha UPI/QR (manual) se lena hoga — online payment isi seema tak (atki/fail payment se bachne ke liye)</div>' +
      '</div>' +
    '</div>' +
    /* ✅ BUG 16 (2026-10-04): Manual Payment (UPI QR) system — pehle user
       panel mein hardcoded "miniesports@upi" text line thi, koi QR nahi,
       koi admin control nahi. Ab yahan se QR image URL + UPI ID + payee
       name + instructions set karo — user ke "Buy Sky Diamonds" modal mein
       wahi dikhta hai. Single source: live_config.manualPayment. */
    '<div style="border-top:1px solid rgba(255,255,255,.07);margin:14px 0 12px;padding-top:12px">' +
      '<div style="font-size:11px;font-weight:800;color:#00ff9c;margin-bottom:8px">📱 Manual UPI Payment (QR System)</div>' +
      '<div class="form-group" style="margin-bottom:10px"><label style="font-size:12px">Manual Payment ON/OFF</label>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:6px">' +
          '<label class="toggle"><input type="checkbox" id="as_manualPayEnabled" ' + (val('manualPayment.enabled', true) ? 'checked' : '') + '><span class="toggle-slider"></span></label>' +
          '<span style="font-size:12px;color:' + (val('manualPayment.enabled', true) ? '#00ff9c' : '#888') + '">' + (val('manualPayment.enabled', true) ? '✅ QR + UPI ID users ko dikhega' : '🔴 Manual payment band') + '</span>' +
        '</div>' +
      '</div>' +
      row('manualPayUpiId', 'UPI ID', val('manualPayment.upiId', 'miniesports@upi'), 'text', 'Jaise: miniesports@upi — user isi ID pe paisa bhejta hai') +
      row('manualPayPayee', 'Payee Name', val('manualPayment.payeeName', 'Mini eSports'), 'text', 'UPI app mein payee ke naam se dikhega') +
      /* ✅ B22 (2026-10-06): "Payment settings me QR URL ki jagah SIIDHE QR upload ho"
         — pehle yahan ek text box tha (ImgBB ka link paste karna padta tha).
         Ab: gallery se QR image chuno -> wahi image (chhota kar ke, PNG data-URI)
         `manualPayment.qrImageUrl` me chali jati hai aur user panel usi ko
         dikhata hai. Koi bahar ka link ya hosting ki zaroorat nahi.
         Purana `#as_manualPayQrUrl` input bhi bana hua hai (hidden) — save
         wala code usi ko padhta hai, isliye single source waisa hi hai. */
      '<div class="form-group" style="margin-bottom:10px" id="as_manualPayQrBlock">' +
        '<label style="font-size:12px">UPI QR Image (upload karo)</label>' +
        '<input type="hidden" id="as_manualPayQrUrl" value="' + _asEsc(val('manualPayment.qrImageUrl', '')) + '">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">' +
          '<input type="file" id="as_manualPayQrFile" accept="image/*" style="display:none" onchange="window._manualPayQrPick(this)">' +
          '<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById(\'as_manualPayQrFile\').click()"><i class="fas fa-upload"></i> QR upload karo</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" onclick="window._manualPayQrClear()"><i class="fas fa-trash"></i> hatao</button>' +
          '<span id="as_manualPayQrInfo" style="font-size:11px;color:var(--text-muted)"></span>' +
        '</div>' +
        '<div id="as_manualPayQrPrevWrap" style="margin-top:8px;display:none">' +
          '<img id="as_manualPayQrPrev" alt="QR preview" style="width:120px;height:120px;object-fit:contain;background:#fff;border-radius:10px;padding:6px">' +
        '</div>' +
        '<div style="font-size:10px;color:#666;margin-top:4px">Gallery se apne UPI QR ki photo chuno — image apne aap 600px tak chhoti ho jati hai. Khali chhodne par user ko sirf UPI ID + deep-link dikhta hai.</div>' +
      '</div>' +
        '<textarea id="as_manualPayInstructions" class="form-input" rows="4" style="font-size:12px">' + String(val('manualPayment.instructions', '')).replace(/[<>&]/g, function (ch) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]; }) + '</textarea>' +
        '<div style="font-size:10px;color:#666;margin-top:3px">Steps jaise: UPI app se paisa bhejo → UTR copy karo → screenshot + UTR submit karo</div>' +
      '</div>' +
    '</div>'
  );

  /* 6. CREATOR SETTINGS */
  html += section('Creator Program', 'fas fa-broadcast-tower', '#00d4ff',
    /* ✅ BUG FIX (2026-10-04): purana "Match Commission %" (key 'commission')
       HATA diya — ye creator_system.sdMatchCommissionPct ka DUPLICATE tha
       (do alag jagah se commission set hoti thi, confusion + galat value).
       Ab commission ka SINGLE source of truth: "Creator Match Hosting"
       section ka "💎 SD Match Commission %" (creator_system.sdMatchCommissionPct). */
    row('minPayout',     '💵 Min Payout Amount ₹',   val('creatorMinPayout', 100),               'number', 'Creator itne se zyada hone par withdraw request kar sakta hai')
  );

  /* 7. COSMETICS PRICES */
  var cos = val('cosmetics', {});
  html += section('Cosmetics Store Prices (Sky Diamonds 💎)', 'fas fa-store', '#00d4ff',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    row('cos_frame_neon',   '🟢 Neon Frame',      (cos.frame_neon   && cos.frame_neon.price)   || 50)  +
    row('cos_frame_fire',   '🔥 Fire Frame',      (cos.frame_fire   && cos.frame_fire.price)   || 75)  +
    row('cos_frame_galaxy', '🌌 Galaxy Frame',    (cos.frame_galaxy && cos.frame_galaxy.price) || 100) +
    row('cos_frame_gold',   '🏆 Gold Champion',   (cos.frame_gold   && cos.frame_gold.price)   || 150) +
    row('cos_tag_beast',    '⚡ BEAST MODE Tag',  (cos.tag_beast    && cos.tag_beast.price)    || 30)  +
    row('cos_tag_pro',      '🎯 PRO PLAYER Tag',  (cos.tag_pro      && cos.tag_pro.price)      || 30)  +
    row('cos_tag_king',     '👑 KING Tag',        (cos.tag_king     && cos.tag_king.price)     || 50)  +
    row('cos_vip_slot',     '⭐ VIP Slot Pass',   (cos.vip_slot     && cos.vip_slot.price)     || 200) +
    '</div>'
  );

  /* 8. SKY DIAMOND PACKAGES */
  var sdp = val('sdPackages', [
    {label:'Starter',  diamonds:50,  price:49},
    {label:'Popular',  diamonds:120, price:99,  popular:true},
    {label:'Value',    diamonds:260, price:199},
    {label:'Mega',     diamonds:600, price:399},
  ]);
  var sdHtml = '<div style="font-size:11px;color:#888;margin-bottom:10px">User in packages se Sky Diamonds kharida karte hain</div>';
  sdHtml += '<div id="sdPackagesContainer">';
  sdp.forEach(function(pkg, i) {
    sdHtml += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px">';
    sdHtml += '<div class="form-group" style="margin:0"><label style="font-size:11px">Label</label><input type="text" id="sdp_label_' + i + '" class="form-input" value="' + (pkg.label||'') + '" style="font-size:12px"></div>';
    sdHtml += '<div class="form-group" style="margin:0"><label style="font-size:11px">💎 Diamonds</label><input type="number" id="sdp_dia_' + i + '" class="form-input" value="' + (pkg.diamonds||0) + '" style="font-size:12px"></div>';
    sdHtml += '<div class="form-group" style="margin:0"><label style="font-size:11px">₹ Price</label><input type="number" id="sdp_price_' + i + '" class="form-input" value="' + (pkg.price||0) + '" style="font-size:12px"></div>';
    sdHtml += '<button onclick="removeSDPackage(' + i + ')" style="padding:8px;border-radius:8px;background:rgba(255,60,60,.1);border:1px solid rgba(255,60,60,.2);color:#ff6b6b;cursor:pointer;margin-bottom:0">✕</button>';
    sdHtml += '</div>';
  });
  sdHtml += '</div>';
  sdHtml += '<button onclick="addSDPackage()" style="padding:8px 14px;border-radius:10px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-size:12px;font-weight:700;cursor:pointer;margin-top:4px">+ Package Add Karo</button>';
  html += section('Sky Diamond Packages', 'fas fa-gem', '#00d4ff', sdHtml);

  /* ✅ B24 (2026-10-07): poora "Creator Video System" HATA diya (section +
     settings + payload). Wajah: ye feature LIVE nahi tha —
       * user panel me video dekhne/earn karne wali koi screen hi nahi thi
         (submitCreatorVideo ke koi callers nahi the — dead function, hata diya),
       * admin me videos review karne ka koi page nahi tha,
       * creator_videos table khaali (0 rows) thi,
       * aur ye settings ek purane Firebase path (adminConfig/videoModeration)
         se "connect" dikhayi ja rahi thi jahan koi likhta hi nahi tha.
     Yani 7 settings sirf jhoothi tasveer dete the ("Watcher ko itne coins") —
     inhe hata kar user panel me sirf ASLI watch feature rakha: Watch & Earn
     (match live stream — 2 coins/minute, upar ki section me set hota hai). */
  var cc = _CVS.creator || {};
  function ccVal(k, def) { return cc[k] != null ? cc[k] : def; }

  var matchHtml =
    row('cvCreatorMatchEnabled', '🎮 Creator Match Hosting ON/OFF',  ccVal('creatorMatchEnabled',1),   'number', '1 = ON, 0 = OFF — Creator apna match create kar sakta hai') +
    /* ✅ BUG FIX (2026-10-04): "🪙 Coin Match Commission %" row HATAYA —
       coin/green-diamond creator matches par ab koi commission nahi (sirf
       hosted Sky Diamond match par). Single commission setting = SD %. */
    row('cvSDMatchComm',         '💎 SD Match Commission %',          ccVal('sdMatchCommissionPct',15), 'number', 'Hosted Sky Diamond match par user ke sky diamond spend ka X% creator ko ₹ payout queue mein jaayega (coin/GD matches par koi commission nahi)') +
    row('cvHoldDays',            '🔒 Commission Hold Days',           ccVal('commissionHoldDays',7),    'number', 'SD match commission itne din hold rahega payout ke pehle') +
    /* ✅ B25 (2026-10-06): 'Min Followers to Host SD Match' row HATA di gayi.
       Wajah: is setting ko poore app me KAHIN check hi nahi kiya jata tha
       (na user panel me, na creator-match hosting me) — sirf value save hoti
       thi aur user ke apne bayan (1k-5k dropdown) se koi taalluq nahi tha.
       Yani admin ise badal kar kuch bhi control nahi kar sakta tha — aur
       followers asli me verify karna mumkin bhi nahi. Isliye bekaar dava
       dikhane se behtar hai row hi na ho. Baaki creator settings jaisi hain
       waisi hi kaam karti hain. */
    row('cvMaxCreatorMatches',   '📋 Max Active Matches per Creator', ccVal('maxCreatorMatches',3),     'number', 'Creator ek saath kitne live/upcoming matches rakh sakta hai');

  html += section('Creator Match Hosting', 'fas fa-gamepad', '#00ff9c',
    '<div style="font-size:11px;color:#888;margin-bottom:12px">Commission structure — Creator apna match host karke earn karta hai</div>' + matchHtml
  );

  var cont = document.getElementById('appSettingsContent');
  if (cont) cont.innerHTML = html;
  /* ✅ B22: QR pehle se saved ho (data-URI ya link) to preview + info dikhao */
  try { if (window._manualPayQrHydrate) window._manualPayQrHydrate(); } catch (e) {}
  /* ✅ B18: "kitne din baaki" live hint (tareekh badalte hi) */
  try { if (window._seasonDateHint) window._seasonDateHint(); } catch (e) {}
  } catch (e) {
    /* ✅ BUG FIX (2026-09-17): "App Settings tab pe jaate hi crash" —
       this whole function had no try/catch, so any unexpected data
       shape (e.g. a field saved in an older/different shape by a
       previous version of this panel) would throw here and leave
       #appSettingsContent stuck on its "Loading settings..." spinner
       forever with no visible error — which looks and feels like a
       full crash even though only this one tab is actually affected.
       Surfaces the real error message + which line threw, instead of
       an unexplained frozen spinner, so the real cause is visible from
       a screenshot instead of needing guesswork. */
    console.error('[AppSettings] _renderAppSettings() threw:', e);
    var cont2 = document.getElementById('appSettingsContent');
    if (cont2) cont2.innerHTML = '<div style="text-align:center;padding:40px;color:#ff6b6b"><i class="fas fa-exclamation-triangle fa-2x"></i><br><br>Settings render nahi ho payi.<br><span style="font-size:11px;color:#888;word-break:break-word">' + (e && e.message || String(e)) + '</span><br><span style="font-size:10px;color:#666">' + (e && e.stack ? e.stack.split('\n').slice(0,3).join('<br>') : '') + '</span><br><br><button class="btn btn-ghost btn-sm" onclick="loadAppSettings()">Retry</button></div>';
  }
}

window.saveAppSettings = function() {
  var db = window.rtdb || window.db;
  if (!db) return;
  var btn = document.getElementById('saveAppSettingsBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

  function g(id) {
    var el = document.getElementById('as_' + id);
    return el ? el.value : null;
  }
  function gn(id, def) { var v = g(id); return v !== null ? Number(v) : def; }

  // Read SD packages
  /* Bug 22 Fix: Read ALL visible rows by collecting all sdp_label_N elements
     Sequential while loop fails when middle rows are deleted */
  var sdPkgs = [];
  var _allLabelEls = document.querySelectorAll('[id^="sdp_label_"]');
  if (_allLabelEls.length) {
    _allLabelEls.forEach(function(el) {
      var idx = el.id.replace('sdp_label_', '');
      var lbl   = el.value || '';
      var dia   = Number((document.getElementById('sdp_dia_'   + idx)||{}).value || 0);
      var price = Number((document.getElementById('sdp_price_' + idx)||{}).value || 0);
      if (lbl && dia && price) sdPkgs.push({ label: lbl, diamonds: dia, price: price });
    });
  }

  var config = {
    /* ── App Force Update Control ── */
    appLatestVersion:        g('appLatestVersion') || '1.0.0',
    appMinSupportedVersion:  g('appMinSupportedVersion') || '1.0.0',
    appApkUrl:               g('appApkUrl') || '',
    appSupportContact:       g('appSupportContact') || '',
    appExpectedSigningHash:  g('appExpectedSigningHash') || '',
    appForceUpdateEnabled:   !!(document.getElementById('as_appForceUpdateEnabled') && document.getElementById('as_appForceUpdateEnabled').checked),
    adCoinsPerWatch:    gn('adCoins', 10),
    adDailyLimit:       gn('adDailyLimit', 5),
    /* ✅ B26 (2026-10-07): checkinCoins / checkinStreakBonus7 payload se hata
       diye — RPC inhe padhta hi nahi (server constants; upar note dekho). */
    /* ✅ REMOVED (2026-08-22): shareCoins — feature fully removed */
    referralJoinCoins:  gn('refJoinCoins', 50),
    referralSDBonusDiamonds: gn('refSDBonus', 10),
    referralMatchCoins: gn('refMatchCoins', 30),
    /* ✅ B20 (2026-10-07): match milestone bhi ab setting — DB trigger
       (trg_ref_match_bonus) aur user panel dono isi key se threshold
       uthate hain. Default 5. */
    referralMatchThreshold: gn('refMatchThreshold', 5),
    /* ✅ BUG FIX (2026-10-04): 'commission' key save band — duplicate
       commission system clean (single source = creator_system.sdMatchCommissionPct). */
    creatorMinPayout:   gn('minPayout', 100),
    matchReminderMins: gn('matchReminderMins', 30),
    /* ✅ B4 (2026-10-07): server cron isi value se "match shuru hone wala hai"
       push bhejta hai (public.send_match_start_alerts → live_config.
       matchStartAlertMins). Default 5 minute. */
    matchStartAlertMins: gn('matchStartAlertMins', 5),
    notifBroadcastDays: gn('notifBroadcastDays', 7),
    /* ✅ B5 (2026-10-07): admin panel ke apne alerts ki timings — pehle
       fa-admin-v10-final.js me 15/5 hardcode the. Default wahi 15/5. */
    admAlertEarlyMins:  gn('admAlertEarlyMins', 15),
    admAlertUrgentMins: gn('admAlertUrgentMins', 5),
    missions: {
      /* ✅ BUG FIX (2026-09-16): daily_login / daily_checkin removed —
         see the Mission Rewards section render above for why. */
      daily_match:    gn('m_daily_match', 10),
      daily_kills3:   gn('m_daily_kills3', 5),
      week_5matches:  gn('m_week_5matches', 50),
      week_top3:      gn('m_week_top3', 30),
      /* ✅ REMOVED (2026-08-22): week_share — feature fully removed */
    },
    streakMilestones: {
      3:   { coins: gn('sm_3',   20) },
      7:   { coins: gn('sm_7',   100), badge: '🔥 Unstoppable' },
      14:  { coins: gn('sm_14',  200) },
      30:  { coins: gn('sm_30',  500), badge: '⚡ Dedicated' },
      60:  { coins: gn('sm_60',  1000), badge: '👑 Legend' },
      100: { coins: gn('sm_100', 2000), badge: '🌟 Immortal' },
    },
    premium: {
      prices:  { 1: gn('pp_silver_price',49),  2: gn('pp_gold_price',99),  3: gn('pp_diamond_price',199) },
      bonuses: { 1: gn('pp_silver_bonus',50), 2: gn('pp_gold_bonus',150), 3: gn('pp_diamond_bonus',400) },
    },
    cosmetics: {
      frame_neon:   { name:'Neon Frame',     price:gn('cos_frame_neon',50),   icon:'🟢', type:'frame' },
      frame_fire:   { name:'Fire Frame',     price:gn('cos_frame_fire',75),   icon:'🔥', type:'frame' },
      frame_galaxy: { name:'Galaxy Frame',   price:gn('cos_frame_galaxy',100),icon:'🌌', type:'frame' },
      frame_gold:   { name:'Gold Champion',  price:gn('cos_frame_gold',150),  icon:'🏆', type:'frame' },
      tag_beast:    { name:'⚡ BEAST MODE',  price:gn('cos_tag_beast',30),    icon:'⚡', type:'tag' },
      tag_pro:      { name:'🎯 PRO PLAYER',  price:gn('cos_tag_pro',30),      icon:'🎯', type:'tag' },
      tag_king:     { name:'👑 KING',        price:gn('cos_tag_king',50),     icon:'👑', type:'tag' },
      vip_slot:     { name:'VIP Slot Pass',  price:gn('cos_vip_slot',200),    icon:'⭐', type:'vip' },
    },
    autoSquadEnabled:      gn('autoSquadEnabled',1),
    autoSquadTimeout:      gn('autoSquadTimeout',15),
    /* ✅ B30: checkInEnabled / checkInOpenMins / checkInCloseMins payload se
       hata diye (upar rows wale note ki wajah — pre-match check-in gaya). */
    watchEarnEnabled:      gn('watchEarnEnabled',1),
    watchCoinsPerInterval: gn('watchCoinsPerInterval',2),
    /* ✅ FIX (2026-10-06): default 5 → 1 (2 coins per MINUTE — owner-confirmed).
       Purana default 5 hone se naya save bina soche 2 coins / 5 min kar deta tha
       jabki user panel 2/min dikhata tha = wahi mismatch. */
    watchIntervalMins:     gn('watchIntervalMins',1),
    watchDailyLimitMins:   gn('watchDailyLimitMins',30),
    seasonName:            document.getElementById('as_seasonName')&&document.getElementById('as_seasonName').value||'Season 1',
    /* ✅ B18: ON/OFF toggle (1/0 likhne ki zaroorat khatam) */
    seasonActive:          (function () { var el = document.getElementById('as_seasonActive'); return (el && el.checked) ? 1 : 0; })(),
    /* ✅ B18: ASLI tareekh (local din ke aakhir tak) + backward-compat ke liye
       din bhi (purane readers ke liye) */
    seasonEndDate:         (function () {
                              var el = document.getElementById('as_seasonEndDate');
                              if (!el || !el.value) return null;
                              var d = new Date(el.value + 'T23:59:59');
                              return isNaN(d.getTime()) ? null : d.getTime();
                            })(),
    seasonEndDays:         (function () {
                              var el = document.getElementById('as_seasonEndDate');
                              if (!el || !el.value) return gn('seasonEndDays', 90);
                              var d = new Date(el.value + 'T23:59:59');
                              if (isNaN(d.getTime())) return gn('seasonEndDays', 90);
                              return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
                            })(),
    battlePassPrice:       gn('battlePassPrice',49),
    sdPackages: sdPkgs.length ? sdPkgs : null,
    /* ── Paytm Instant Checkout toggle ── */
    paytmEnabled: !!(document.getElementById('as_paytmEnabled') && document.getElementById('as_paytmEnabled').checked),
    /* ✅ B23: online payment ki seema (₹, default 2000) — user panel ka
       paytm-checkout.js isse pehle hi rok deta hai (order banta hi nahi). */
    paytmMaxTxn: (function () { var el = document.getElementById('as_paytmMaxTxn'); var v = el ? Number(el.value) : 2000; return (isFinite(v) && v > 0) ? v : 2000; })(),
    /* ✅ BUG 16 (2026-10-04): Manual UPI payment (QR) — single source
       live_config.manualPayment, quick-deposit.js isi ko render karta hai. */
    manualPayment: {
      enabled:      !!(document.getElementById('as_manualPayEnabled') && document.getElementById('as_manualPayEnabled').checked),
      upiId:        (g('manualPayUpiId') || 'miniesports@upi').trim(),
      payeeName:    (g('manualPayPayee') || 'Mini eSports').trim(),
      qrImageUrl:   (g('manualPayQrUrl') || '').trim(),
      minAmount:    gn('manualPayMin', 10),
      instructions: (function () { var el = document.getElementById('as_manualPayInstructions'); return el ? el.value : ''; })(),
      updatedAt:    Date.now(),
    },
    updatedAt: Date.now(),
  };

  // Build creator/video config objects (moved above the save block so they
  // exist before being referenced in the upsert calls below)
  /* ✅ B24: gsEl/bkwRaw/bkwArr (video banned-keywords) hata — video system gaya */
  /* ✅ B24: videoModerationConfig poora hata — ab koi video_moderation row
     likhi hi nahi jaati (creator_system ka creator config neeche hai). */
  var creatorSystemConfig = {
    creatorMatchEnabled:   gn('cvCreatorMatchEnabled',1),
    /* ✅ BUG FIX (2026-10-04): coinMatchCommissionPct save band — coin matches
       par commission nahi milta (single commission = SD only). */
    sdMatchCommissionPct:  gn('cvSDMatchComm',15),
    commissionHoldDays:    gn('cvHoldDays',7),
    maxCreatorMatches:     gn('cvMaxCreatorMatches',3),
    updatedAt: Date.now(),
  };

  /* ✅ FIX (2026-08): App Settings ka poora data ab Supabase 'app_settings'
     table mein jaata hai (key='live_config'), Firebase mein NAHI —
     'appSettings' Firebase-only list se hata diya gaya hai is session mein
     (chat/presence/anti-cheat ke alawa koi bhi 'data' Firebase pe nahi
     rehta, jaisa confirm hua). Pehle yahan do bugs the: (1) db.ref(...).set()
     silently no-op ho raha tha kyunki 'appSettings' na TABLE_MAP mein tha na
     Firebase-only mein — bridge console.warn karke return kar deta tha;
     (2) neeche wale secondary Supabase-write mein .catch() ek raw
     PostgrestFilterBuilder pe chained tha jo function hi nahi hai (same bug
     class jo pehle 74 jagah fix hui thi) — woh khud crash kar deta tha aur
     wahi "insert(...).catch is not a function" jaisi error screen pe dikhti
     thi. Ab dono ek hi saaf async upsert mein consolidate kar diye. */
  if (!window._supa) {
    if (window.showToast) showToast('Error: Supabase client not ready', true);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save All Settings'; }
    return;
  }
  /* 🤖 AUTO-MANAGED appLatestVersion (2026-10-06)
     ──────────────────────────────────────────────────────────────
     appLatestVersion ab GitHub Actions har APK release par apne aap set
     karta hai. Par save karte waqt purana form (jo CI-update se pehle
     khula tha) chhota number wapas likh deta — live me bilkul yahi hua
     tha: APK v1.0.111 publish tha, par DB me 1.0.109 pada reh gaya.
     Isliye ab save se pehle DB ki current value padhi jaati hai aur
     max() rakha jaata hai. Select fail ho jaye to bhi save rukta nahi
     (bina guard ke normal save chalta hai). */
  /* ✅ FIX (gehri audit, 2026-10-07) — LIVE_CONFIG KA SILENT WIPE:
     Pehle ye save poori live_config ko is form ke object se REPLACE kar deta tha
     (upsert → value = config). Iska matlab: jo key is payload me nahi hai, wo
     save par CHUP-CHAAP delete ho jaati thi. Live me bilkul yahi hua — B24/B26
     migration ne live_config me `dailyBonusRewards` + marker `dailyBonusRewardsLive`
     daale the, aur in dono ko is Save ne uda diya (DB me aaj dono gayab the),
     jisse admin ka Daily Bonus Editor bekaar ho gaya tha (client marker na dekh kar
     purane constants dikhata, jabki server config padhta hai = UI vs server ka
     mismatch). Ab: current row ko BASE bana kar uske upar form ki values chadhati
     hain (read-modify-write) — yani is form se bahar ki koi bhi key zinda rehti hai.
     Sirf woh keys jaan-bujh kar hataayi jaati hain jo features ke saath poori tarah
     mar chuki hain (neeche list), warna purane kachre rows me pade rehte. */
  var _DEAD_CFG_KEYS = ['checkinCoins', 'checkinStreakBonus7', 'shareCoins', 'commission',
                        'checkInEnabled', 'checkInOpenMins', 'checkInCloseMins',
                        'videoModeration', 'bannedKeywords'];
  function _upsertLive(mergedValue) {
    var _val = mergedValue || config;
    _DEAD_CFG_KEYS.forEach(function (k) { try { delete _val[k]; } catch (e) {} });
    return window._supa.from('app_settings')
      .upsert({ key: 'live_config', value: _val, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }

  window._supa.from('app_settings').select('value').eq('key', 'live_config').limit(1)
    .then(function(_cur) {
      var _row = (_cur && _cur.data && _cur.data[0]) || null;
      try {
        var _dbVer = _row && _row.value && _row.value.appLatestVersion;
        if (_dbVer && _verCmp(config.appLatestVersion, _dbVer) < 0) {
          config.appLatestVersion = _dbVer;
          if (window.showToast) showToast('🤖 Latest Version auto-managed hai — ' + _dbVer + ' hi rakha gaya', false);
        }
      } catch (e) { /* compare fail → jaisa hai waisa save */ }
      var _merged = Object.assign({}, (_row && _row.value) || {}, config);
      return _upsertLive(_merged);
    }, function() { return _upsertLive(); })
    .then(function(r1) {
      if (r1.error) throw r1.error;
      _AS = config;
      /* ✅ B24: video_moderation upsert hata; sirf creator_system bacha */
      var p3 = window._supa.from('app_settings')
        .upsert({ key: 'creator_system', value: creatorSystemConfig, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      /* ✅ B18: user panel ki season row (app_settings.currentSeason) bhi isi
         save se update — pehle wo hamesha ke liye padi rehti thi aur admin ki
         koi bhi season setting user tak pahunchti hi nahi thi. Purane
         seasonNum/id barqarar rehte hain (read-modify-write). */
      var p4 = window._supa.from('app_settings').select('value').eq('key', 'currentSeason').limit(1)
        .then(function (cur) {
          var old = (cur && cur.data && cur.data[0] && cur.data[0].value) || {};
          var _end = config.seasonEndDate ? new Date(config.seasonEndDate).toISOString() : null;
          var row = Object.assign({}, old, {
            name:      config.seasonName || 'Season 1',
            active:    Number(config.seasonActive) !== 0,
            endDate:   _end,
            seasonNum: Number(old.seasonNum) || 1
          });
          return window._supa.from('app_settings')
            .upsert({ key: 'currentSeason', value: row, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        }, function () { return null; });
      return Promise.all([p2, p3, p4]);
    })
    .then(function(results) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save All Settings'; }
      var err = results.find(function(r) { return r && r.error; });
      if (err) {
        if (window.showToast) showToast('Main settings saved. Creator settings error: ' + err.error.message, true);
      } else {
        if (window.showToast) showToast('✅ Settings saved! User app mein live ho gaya.', false);
        _CVS.creator = creatorSystemConfig;
      }
    })
    .then(null, function(e) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save All Settings'; }
      if (window.showToast) showToast('Error: ' + (e.message || e), true);
    });
};

/* ✅ B18 — "kitne din baaki" live hint (tareekh badalte hi update) */
window._seasonDateHint = function () {
  var el = document.getElementById('as_seasonEndDate');
  var box = document.getElementById('as_seasonLeft');
  if (!el || !box) return;
  function upd() {
    if (!el.value) { box.textContent = '⚠️ Koi tareekh nahi chuni — user ko season ka ant nahi dikhega'; box.style.color = '#ffb84d'; return; }
    var d = new Date(el.value + 'T23:59:59');
    if (isNaN(d.getTime())) { box.textContent = '⚠️ Tareekh samajh nahi aayi'; box.style.color = '#ff6b6b'; return; }
    /* B18: din calendar-din me ginte hain (warna 45 din ki tareekh 46 dikhati) */
    var _t0 = new Date(); _t0.setHours(0, 0, 0, 0);
    var _t1 = new Date(d.getTime()); _t1.setHours(0, 0, 0, 0);
    var days = Math.round((_t1.getTime() - _t0.getTime()) / 86400000);
    box.textContent = days > 0
      ? '👀 User ko dikhega: ' + days + ' din baaki (khatam: ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ')'
      : '⛔ Ye tareekh nikal chuki hai (season khatam dikhega)';
    box.style.color = days > 0 ? '#00ff9c' : '#ff6b6b';
  }
  el.onchange = upd; el.oninput = upd;
  upd();
};

/* SD Package add/remove */
var _sdPkgCount = 4;
window.addSDPackage = function() {
  var cont = document.getElementById('sdPackagesContainer');
  if (!cont) return;
  var i = _sdPkgCount++;
  var div = document.createElement('div');
  div.id = 'sdpkg_row_' + i;
  div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px';
  div.innerHTML = '<div class="form-group" style="margin:0"><label style="font-size:11px">Label</label><input type="text" id="sdp_label_' + i + '" class="form-input" value="Custom" style="font-size:12px"></div>' +
    '<div class="form-group" style="margin:0"><label style="font-size:11px">💎 Diamonds</label><input type="number" id="sdp_dia_' + i + '" class="form-input" value="100" style="font-size:12px"></div>' +
    '<div class="form-group" style="margin:0"><label style="font-size:11px">₹ Price</label><input type="number" id="sdp_price_' + i + '" class="form-input" value="149" style="font-size:12px"></div>' +
    '<button onclick="removeSDPackage(' + i + ')" style="padding:8px;border-radius:8px;background:rgba(255,60,60,.1);border:1px solid rgba(255,60,60,.2);color:#ff6b6b;cursor:pointer">✕</button>';
  cont.appendChild(div);
};

window.removeSDPackage = function(i) {
  var row = document.getElementById('sdpkg_row_' + i);
  if (row) row.remove();
  else {
    // Original rows don't have wrapper div — just clear values
    ['label','dia','price'].forEach(function(f){
      var el = document.getElementById('sdp_' + f + '_' + i);
      if (el) el.closest('div').closest('div').style.display = 'none';
    });
  }
};

/* ══════════════════════════════════════════════════════════════════════
   ✅ B22 (2026-10-06) — QR IMAGE SIDHA UPLOAD (URL paste nahi)
   Admin gallery se QR ki photo chunta hai; yahin browser me hi image
   600px tak chhoti kar ke PNG data-URI bana di jati hai aur wahi
   `manualPayment.qrImageUrl` me save hoti hai (live_config, single source).
   User panel ka quick-deposit.js usi ko <img> me dikhata hai — koi bahar ki
   hosting/URL ki zaroorat nahi, aur QR kabhi "toota hua link" nahi hoga.
   ══════════════════════════════════════════════════════════════════════ */
window._MANUAL_PAY_QR_MAX = 600;                 /* px — isse zyada chhota kar diya jata hai */
window._MANUAL_PAY_QR_MAX_BYTES = 400 * 1024;   /* ~400 KB se bada data-URI save nahi karenge */

window._manualPayQrHydrate = function () {
  var inp = document.getElementById('as_manualPayQrUrl');
  var prev = document.getElementById('as_manualPayQrPrev');
  var wrap = document.getElementById('as_manualPayQrPrevWrap');
  var info = document.getElementById('as_manualPayQrInfo');
  if (!inp || !prev || !wrap) return;
  var v = String(inp.value || '');
  if (v && (v.indexOf('data:image/') === 0 || /^https?:\/\//i.test(v))) {
    prev.src = v;
    wrap.style.display = 'block';
    if (info) info.textContent = (v.indexOf('data:image/') === 0)
      ? '✅ QR laga hua hai (~' + Math.round(v.length * 0.75 / 1024) + ' KB)'
      : '✅ QR link laga hua hai';
  } else {
    prev.removeAttribute('src');
    wrap.style.display = 'none';
    if (info) info.textContent = 'QR abhi nahi lagaya';
  }
};

window._manualPayQrClear = function () {
  var inp = document.getElementById('as_manualPayQrUrl');
  var f = document.getElementById('as_manualPayQrFile');
  if (inp) inp.value = '';
  if (f) f.value = '';
  window._manualPayQrHydrate();
  if (window.showToast) showToast('QR hata diya — Save All Settings dabana na bhoolo', false);
};

window._manualPayQrPick = function (input) {
  try {
    var f = (input && input.files && input.files[0]) || null;
    if (!f) return;
    if (!/^image\//i.test(f.type || '')) {
      if (window.showToast) showToast('Sirf image file chuno (PNG/JPG)', true);
      input.value = '';
      return;
    }
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = window._MANUAL_PAY_QR_MAX || 600;
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var scale = Math.min(1, max / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var ctx = c.getContext('2d');
        /* QR safed background par hona chahiye — transparent PNG ko bhi
           scan-able rakhne ke liye safed base bhar dete hain */
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        var dataUri = c.toDataURL('image/png');
        if (dataUri.length * 0.75 > (window._MANUAL_PAY_QR_MAX_BYTES || 409600)) {
          /* bahut heavy — JPEG me try karo (QR ke liye quality 0.92 kaafi hai) */
          dataUri = c.toDataURL('image/jpeg', 0.92);
        }
        if (dataUri.length * 0.75 > (window._MANUAL_PAY_QR_MAX_BYTES || 409600)) {
          if (window.showToast) showToast('QR image bahut badi hai — chhoti photo chuno', true);
          input.value = '';
          return;
        }
        var inp = document.getElementById('as_manualPayQrUrl');
        if (inp) inp.value = dataUri;
        window._manualPayQrHydrate();
        if (window.showToast) showToast('✅ QR lag gaya (' + cw + '×' + ch + ') — ab Save All Settings dabao', false);
        /* wahi file dobara chunne par bhi onchange chale */
        input.value = '';
      };
      img.onerror = function () {
        if (window.showToast) showToast('Ye image padhi nahi ja saki — dobara try karo', true);
        input.value = '';
      };
      img.src = String(fr.result || '');
    };
    fr.onerror = function () {
      if (window.showToast) showToast('File padhi nahi ja saki', true);
      input.value = '';
    };
    fr.readAsDataURL(f);
  } catch (e) {
    if (window.showToast) showToast('QR upload fail: ' + (e && e.message), true);
  }
};

/* Purana quick-tools ka "UPI Settings" button isi section par le aata hai —
   pehle wo ek ALAG modal kholta tha jo doosri keys (appSettings/payment.
   qrCodeUrl) likhta tha jinhe user panel padhta hi nahi (dead duplicate). */
window._openManualPaySettings = function () {
  try {
    if (window.showSection) window.showSection('settings', null);
    if (window.loadAppSettings) window.loadAppSettings();
    setTimeout(function () {
      var el = document.getElementById('as_manualPayQrBlock');
      var box = document.getElementById('as_manualPayUpiId');
      var t = box || el;
      if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 600);
  } catch (e) {}
};

window.resetAppSettings = function() {
  if (!confirm('Sab settings default pe reset karo?')) return;
  if (!window._supa) return;
  window._supa.from('app_settings').delete().eq('key', 'live_config')
    .then(function(r) {
      if (r.error) { if (window.showToast) showToast('Error: ' + r.error.message, true); return; }
      if (window.showToast) showToast('Settings reset ho gayi — defaults apply honge.', false);
      _AS = {};
      _renderAppSettings();
    });
};

console.log('✅ fa-app-settings.js loaded');
