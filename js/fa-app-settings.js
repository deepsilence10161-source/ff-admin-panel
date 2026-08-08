/* ================================================================
   APP SETTINGS ADMIN — fa-app-settings.js
   Admin se sab kuch control karo — koi code change nahi
   Firebase: appSettings/liveConfig
   ================================================================ */

var _AS  = {}; // main config cache (appSettings/liveConfig)
var _CVS = {}; // creator+video settings cache (adminConfig/creatorSystem + adminConfig/videoModeration)

window.loadAppSettings = function() {
  var db = window.rtdb || window.db;
  if (!db) { setTimeout(window.loadAppSettings, 500); return; }
  // Load main settings
  db.ref('appSettings/liveConfig').once('value', function(snap) {
    _AS = snap.val() || {};
    // Also load creator/video config from separate paths
    db.ref('adminConfig/creatorSystem').once('value', function(cs) {
      _CVS.creator = cs.val() || {};
      db.ref('adminConfig/videoModeration').once('value', function(vm) {
        _CVS.video = vm.val() || {};
        _renderAppSettings();
      });
    });
  });
};

function _renderAppSettings() {
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
    row('appLatestVersion', '🆕 Latest Version (e.g. 1.3.8)', val('appLatestVersion','1.0.0'), 'text', 'Sirf display ke liye — "Update Available" jaisi info screens mein dikhta hai') +
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

  html += section('Pre-Match Check-In System', 'fas fa-clipboard-check', '#ffd700',
    row('checkInEnabled',    '✅ Check-In System ON/OFF', val('checkInEnabled',1),     'number', '1 = ON, 0 = OFF') +
    row('checkInOpenMins',   '⏰ Check-in kitne min pehle khule', val('checkInOpenMins',30),  'number', 'Default: 30 min pehle') +
    row('checkInCloseMins',  '⏰ Check-in kitne min pehle band ho', val('checkInCloseMins',5), 'number', 'Default: 5 min pehle — no-shows release honge')
  );

  html += section('Watch & Earn Settings', 'fas fa-eye', '#b964ff',
    row('watchEarnEnabled',      '👀 Watch & Earn ON/OFF', val('watchEarnEnabled',1),         'number', '1 = ON, 0 = OFF') +
    row('watchCoinsPerInterval', '🪙 Coins per interval', val('watchCoinsPerInterval',2),     'number', 'Har interval pe kitne coins milenge') +
    row('watchIntervalMins',     '⏱️ Interval (minutes)',  val('watchIntervalMins',5),         'number', 'Har X min mein coins milenge') +
    row('watchDailyLimitMins',   '📅 Daily limit (minutes)', val('watchDailyLimitMins',30),    'number', 'Din mein kitne min tak earn kar sakte hain')
  );

  html += section('Seasonal League', 'fas fa-trophy', '#ffd700',
    row('seasonName',      '🏆 Season Name',         val('seasonName','Season 1'),    'text',   'e.g. "Season 1" ya "Spring 2026"') +
    row('seasonEndDays',   '📅 Season end (days from today)', val('seasonEndDays',90), 'number', 'Kitne din mein season khatam hoga') +
    row('seasonActive',    '✅ Season Active (1/0)',   val('seasonActive',1),           'number', '1 = Active season, 0 = Off-season')
  );

  /* 1. EARN SETTINGS */
  html += section('Coin Earn Settings', 'fas fa-coins', '#ffd700',
    row('adCoins',         '📺 Ad Watch Coins',          val('adCoinsPerWatch', 10),   'number', 'Rewarded ad dekhhne pe kitne coins milenge') +
    row('adDailyLimit',    '📺 Ad Daily Limit',           val('adDailyLimit', 5),       'number', 'Roz maximum kitni baar ad dekh sakte hain') +
    row('checkinCoins',    '📅 Daily Check-In Coins',     val('checkinCoins', 5),       'number', 'Roz check-in karne pe coins') +
    row('checkinBonus7',   '🔥 7-Day Streak Bonus Coins', val('checkinStreakBonus7', 50),'number', '7 din streak hone pe extra bonus') +
    row('shareCoins',      '📲 Share Result Coins',       val('shareCoins', 20),        'number', 'Match result share karne pe coins (1x/day)')
  );

  /* 2. MISSIONS */
  var m = val('missions', {});
  html += section('Mission Rewards (Coins)', 'fas fa-tasks', '#00ff9c',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    row('m_daily_login',    '📅 Daily Login',     m.daily_login   || 5) +
    row('m_daily_match',    '🎮 1 Match Khelo',   m.daily_match   || 10) +
    row('m_daily_kills3',   '💀 3 Kills Karo',    m.daily_kills3  || 5) +
    row('m_daily_checkin',  '🎁 Check-In',        m.daily_checkin || 5) +
    row('m_week_5matches',  '🎯 5 Matches/Week',  m.week_5matches || 50) +
    row('m_week_top3',      '🏆 Top 3 Finish',    m.week_top3     || 30) +
    row('m_week_share',     '📲 Share/Week',      m.week_share    || 20) +
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
  html += section('Refer & Earn Settings', 'fas fa-user-friends', '#b964ff',
    row('refJoinCoins',      '👥 Dost join kare → Coins',         val('referralJoinCoins', 50),         'number', 'Dono ko milenge') +
    row('refSDBonus',        '💎 Dost SD kharido → Sky Diamond Bonus', val('referralSDBonusDiamonds', 10), 'number', 'Referrer ko milenge') +
    row('refMatchCoins',     '🎮 Dost 5 matches khele → Coins',   val('referralMatchCoins', 30),        'number', 'Referrer ko milenge')
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

  /* 5b. ROOM RELEASE TIMING */
  html += section('Room ID Auto-Release Settings', 'fas fa-key', '#00ff9c',
    row('roomReleaseMins', '⏰ Room ID kitne minute pehle jaega (default: 10)', val('roomReleaseMins', 10), 'number', 'Ye time Firebase "appSettings/liveConfig/roomReleaseMins" mein save hoga') +
    row('matchReminderMins', '🔔 Match reminder notification (minute pehle)', val('matchReminderMins', 30), 'number', 'User ko match se pehle notification jaegi')
  );

  /* 5c. PAYMENT SETTINGS — Paytm Instant Checkout */
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
    '</div>'
  );

  /* 6. CREATOR SETTINGS */
  html += section('Creator Program', 'fas fa-broadcast-tower', '#00d4ff',
    row('commission',    '💰 Match Commission %',    Math.round((val('commission', 0.15)) * 100), 'number', 'Har Sky Diamond entry ka %, creator ko milega (e.g. 15 = 15%)') +
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

  /* 9. CREATOR & VIDEO SYSTEM */
  var cv = _CVS.video   || {};
  var cc = _CVS.creator || {};
  function cvVal(k, def) { return cv[k] != null ? cv[k] : def; }
  function ccVal(k, def) { return cc[k] != null ? cc[k] : def; }

  // Banned keywords textarea helper
  var bkw = cvVal('videoBannedKeywords', 'gandi,nangi,sexy,vulgar,18+,nude,porn,adult,xxx,explicit,hack tool,cheat,mod apk,aimbot,wallhack');
  var bkwDisplay = Array.isArray(bkw) ? bkw.join(',') : (bkw || '');

  // Allowed platforms dropdown
  var selPlatform = function(selected) {
    var opts = [{v:'both',l:'YouTube + Instagram (Both)'},{v:'youtube',l:'YouTube Only'},{v:'instagram',l:'Instagram Only'}];
    return '<select id="as_cvAllowedPlatforms" class="form-input" style="font-size:13px">' +
      opts.map(function(o){ return '<option value="' + o.v + '"' + (selected === o.v ? ' selected' : '') + '>' + o.l + '</option>'; }).join('') +
    '</select>';
  };

  var vidHtml =
    row('cvVideoEnabled',       '📹 Video System ON/OFF',                cvVal('videoEnabled',1),          'number', '1 = ON, 0 = OFF — User panel mein Video tab dikhe ya nahi') +
    row('cvWatchCoins',         '🪙 Coins per Video Watched',            cvVal('videoWatchCoins',5),        'number', 'Watcher ko ek video dekhne pe milne wale coins') +
    row('cvDailyLimit',         '📅 Max Videos per Watcher per Day',     cvVal('videoDailyLimit',10),       'number', 'Roz ek user kitne videos watch karke coins earn kar sakta hai') +
    row('cvAutoHideReports',    '🚩 Auto-Hide on X Reports',             cvVal('videoAutoHideReports',5),   'number', 'Itne reports aane pe video automatically hide ho jaayegi') +
    row('cvFalseReportPenalty', '⚠️ False Report Penalty (Coins)',       cvVal('videoFalseReportPenalty',3),'number', 'Admin restore kare to har reporter ke itne coins katenge') +
    '<div class="form-group" style="margin-bottom:10px"><label style="font-size:12px">🔤 Banned Keywords (comma-separated)</label>' +
      '<textarea id="as_cvBannedKeywords" class="form-input" rows="3" style="font-size:12px;resize:vertical">' + bkwDisplay + '</textarea>' +
      '<div style="font-size:10px;color:#666;margin-top:3px">Title + Description mein ye words mile to video block ho jaayegi</div></div>' +
    '<div class="form-group" style="margin-bottom:10px"><label style="font-size:12px">🌐 Allowed Platforms</label>' + selPlatform(cvVal('videoAllowedPlatforms','both')) +
      '<div style="font-size:10px;color:#666;margin-top:3px">Creator kaunsa platform link submit kar sakta hai</div></div>';

  var matchHtml =
    row('cvCreatorMatchEnabled', '🎮 Creator Match Hosting ON/OFF',  ccVal('creatorMatchEnabled',1),   'number', '1 = ON, 0 = OFF — Creator apna match create kar sakta hai') +
    row('cvCoinMatchComm',       '🪙 Coin Match Commission %',        ccVal('coinMatchCommissionPct',10),'number', 'Coin matches ka X% creator ko GD mein milega') +
    row('cvSDMatchComm',         '💎 SD Match Commission %',          ccVal('sdMatchCommissionPct',15), 'number', 'SD matches ka X% creator ko ₹ payout queue mein jaayega') +
    row('cvHoldDays',            '🔒 Commission Hold Days',           ccVal('commissionHoldDays',7),    'number', 'SD match commission itne din hold rahega payout ke pehle') +
    row('cvMaxCreatorMatches',   '📋 Max Active Matches per Creator', ccVal('maxCreatorMatches',3),     'number', 'Creator ek saath kitne live/upcoming matches rakh sakta hai') +
    row('cvMinFollowersSD',      '👥 Min Followers to Host SD Match', ccVal('minFollowersForSD',1000),  'number', 'Creator ne declare karne honge ≥ ye followers SD match ke liye');

  html += section('Creator Video System', 'fas fa-video', '#ff6b35',
    '<div style="font-size:11px;color:#888;margin-bottom:12px">Video sharing settings — Creators YouTube/Instagram links share karte hain, users earn karte hain</div>' + vidHtml
  );
  html += section('Creator Match Hosting', 'fas fa-gamepad', '#00ff9c',
    '<div style="font-size:11px;color:#888;margin-bottom:12px">Commission structure — Creator apna match host karke earn karta hai</div>' + matchHtml
  );

  var cont = document.getElementById('appSettingsContent');
  if (cont) cont.innerHTML = html;
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
    checkinCoins:       gn('checkinCoins', 5),
    checkinStreakBonus7:gn('checkinBonus7', 50),
    shareCoins:         gn('shareCoins', 20),
    referralJoinCoins:  gn('refJoinCoins', 50),
    referralSDBonusDiamonds: gn('refSDBonus', 10),
    referralMatchCoins: gn('refMatchCoins', 30),
    commission:         gn('commission', 15) / 100,
    creatorMinPayout:   gn('minPayout', 100),
    roomReleaseMins:  gn('roomReleaseMins', 10),
    matchReminderMins: gn('matchReminderMins', 30),
    missions: {
      daily_login:    gn('m_daily_login', 5),
      daily_match:    gn('m_daily_match', 10),
      daily_kills3:   gn('m_daily_kills3', 5),
      daily_checkin:  gn('m_daily_checkin', 5),
      week_5matches:  gn('m_week_5matches', 50),
      week_top3:      gn('m_week_top3', 30),
      week_share:     gn('m_week_share', 20),
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
    checkInEnabled:        gn('checkInEnabled',1),
    checkInOpenMins:       gn('checkInOpenMins',30),
    checkInCloseMins:      gn('checkInCloseMins',5),
    watchEarnEnabled:      gn('watchEarnEnabled',1),
    watchCoinsPerInterval: gn('watchCoinsPerInterval',2),
    watchIntervalMins:     gn('watchIntervalMins',5),
    watchDailyLimitMins:   gn('watchDailyLimitMins',30),
    seasonName:            document.getElementById('as_seasonName')&&document.getElementById('as_seasonName').value||'Season 1',
    seasonEndDays:         gn('seasonEndDays',90),
    seasonActive:          gn('seasonActive',1),
    sdPackages: sdPkgs.length ? sdPkgs : null,
    /* ── Paytm Instant Checkout toggle ── */
    paytmEnabled: !!(document.getElementById('as_paytmEnabled') && document.getElementById('as_paytmEnabled').checked),
    updatedAt: Date.now(),
  };

  /* ✅ Also save to Supabase app_settings */
  if (window._supa) {
    window._supa.from('app_settings')
      .update({ value: config, updated_at: new Date().toISOString() })
      .eq('key', 'live_config')
      .then(function() { console.log('[AdminSync] App settings saved to Supabase'); })
      .catch(function(e) { console.error('[AdminSync] Settings Supabase save error:', e.message); });
  }

  // Build creator/video config objects for separate Firebase paths (Section F1)
  var gsEl = function(id) { var el = document.getElementById('as_' + id); return el ? el.value : null; };
  var bkwRaw = gsEl('cvBannedKeywords') || '';
  var bkwArr  = bkwRaw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  var videoModerationConfig = {
    videoEnabled:           gn('cvVideoEnabled',1),
    videoWatchCoins:        gn('cvWatchCoins',5),
    videoDailyLimit:        gn('cvDailyLimit',10),
    videoAutoHideReports:   gn('cvAutoHideReports',5),
    videoFalseReportPenalty:gn('cvFalseReportPenalty',3),
    videoBannedKeywords:    bkwArr,
    videoAllowedPlatforms:  gsEl('cvAllowedPlatforms') || 'both',
    updatedAt: Date.now(),
  };
  var creatorSystemConfig = {
    creatorMatchEnabled:   gn('cvCreatorMatchEnabled',1),
    coinMatchCommissionPct:gn('cvCoinMatchComm',10),
    sdMatchCommissionPct:  gn('cvSDMatchComm',15),
    commissionHoldDays:    gn('cvHoldDays',7),
    maxCreatorMatches:     gn('cvMaxCreatorMatches',3),
    minFollowersForSD:     gn('cvMinFollowersSD',1000),
    updatedAt: Date.now(),
  };

  // Save to main liveConfig
  db.ref('appSettings/liveConfig').set(config, function(err) {
    if (err) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save All Settings'; }
      if (window.showToast) showToast('Error: ' + err.message, true);
      return;
    }
    _AS = config;
    // Save creator/video settings to their own paths
    var _pendingSaves = 2;
    function _onCreatorSaveDone(saveErr) {
      _pendingSaves--;
      if (_pendingSaves === 0) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save All Settings'; }
        if (saveErr) {
          if (window.showToast) showToast('Main settings saved. Creator config error: ' + saveErr.message, true);
        } else {
          if (window.showToast) showToast('✅ Settings saved! User app mein live ho gaya.', false);
          _CVS.video   = videoModerationConfig;
          _CVS.creator = creatorSystemConfig;
        }
      }
    }
    db.ref('adminConfig/videoModeration').set(videoModerationConfig, _onCreatorSaveDone);
    db.ref('adminConfig/creatorSystem').set(creatorSystemConfig, _onCreatorSaveDone);
  });
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

window.resetAppSettings = function() {
  if (!confirm('Sab settings default pe reset karo?')) return;
  var db = window.rtdb || window.db;
  if (!db) return;
  db.ref('appSettings/liveConfig').remove(function() {
    if (window.showToast) showToast('Settings reset ho gayi — defaults apply honge.', false);
    _AS = {};
    _renderAppSettings();
  });
};

console.log('✅ fa-app-settings.js loaded');
