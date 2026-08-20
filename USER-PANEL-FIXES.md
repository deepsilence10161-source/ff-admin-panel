# USER PANEL — Fix karne wali cheezein
**Repo:** `deepsilence10161-source/ff-user-panel`
**Date:** 2026-08-20
**Kisne likha:** Admin panel ki deep code-level testing ke dauraan mile bugs.
Yeh saare fixes **user panel** me karne hain — admin panel me inka fix possible nahi.

> Admin panel ke saare fixes branch `arena/01a01da9-ff-admin-panel` me ho chuke hain.
> Database (Supabase) ka kaam: `supabase/admin-panel-fixes.sql` (admin repo me) chalao.

---

## 🔴 BUG U-1 — Ek ad dekhne par 10 ki jagah **50 coins** mil rahe hain

**Severity:** CRITICAL (paisa/economy leak — 5x zyada coins bant rahe hain)

### Root cause (confirmed)
User panel me `window.watchAdForCoins` **do baar** define hota hai:

| File | Line | Reward | Config padhta hai? |
|---|---|---|---|
| `features/ads.js` | 287 | `CFG.adCoinsPerWatch` (default 10) | ✅ Haan |
| `features/rewarded-bonus.js` | 83 | **`_giveCoins(uid, 50, ...)` — 50 hardcoded** | ❌ Nahi |

Aur `index.html` me load order aisa hai:

```html
line 668: <script src="features/ads.js" defer></script>
line 674: <script src="features/rewarded-bonus.js" defer></script>   <!-- ye baad me -->
```

`rewarded-bonus.js` baad me load hota hai, isliye uska **hardcoded 50** waala version
`ads.js` ke config-driven version ko **overwrite** kar deta hai. Isi wajah se admin
panel me kuch bhi set karo, user ko hamesha 50 hi milte the.

Ek aur jagah bhi 50 likha hai — `features/rewarded-bonus.js` line ~55:
```js
h += '<div ...>Ek ad = +50 Coins</div>';   // UI text bhi hardcoded
```
Aur `index.html` line ~445 me `+10🪙` likha hai. Yaani UI me hi do jagah do alag
number dikh rahe the.

### Fix (features/rewarded-bonus.js)

`window.watchAdForCoins` waala poora block **hata do** (kyunki `ads.js` waala
version pehle se sahi hai aur config padhta hai), ya usko config-driven bana do:

```js
/* ── Watch Ad for Coins ──
   ✅ FIX: 50 hardcoded tha. Ab CFG se aata hai (default 10), exactly wahi
   value jo Admin Panel → Settings → Ad Reward Settings set karta hai
   (app_settings.live_config.adCoinsPerWatch). */
window.watchAdForCoins = function() {
  var uid = window.U && window.U.uid;
  if (!uid) return;

  var reward    = (window.CFG && Number(window.CFG.adCoinsPerWatch)) || 10;
  var dailyMax  = (window.CFG && Number(window.CFG.adDailyLimit))    || MAX_ADS_DAY;

  if (_getCount(uid) >= dailyMax) { if(window.toast) toast('Aaj ki limit ho gayi!','inf'); return; }
  if (!window.AdManager) { if(window.toast) toast('Ad load nahi hua','err'); return; }
  if (window.closeModal) closeModal();

  setTimeout(function() {
    window.AdManager.showRewardedAd(function() {
      _incCount(uid);
      _giveCoins(uid, reward, function() {
        if(window.toast) toast('🪙 +' + reward + ' Coins mile! Aaj aur ads dekho.','ok');
        if(window.awardBPXP) window.awardBPXP('ad_watched');
      }, function() {
        if(window.toast) toast('Coins credit nahi ho paye, dobara try karo','err');
      });
    }, function() {
      if(window.toast) toast('Ad pura dekho reward ke liye!','inf');
    }, 'coins_bonus');
  }, 400);
};
```

Aur modal ka text bhi dynamic karo (same file, `showRewardedBonusModal`):
```js
var _adReward = (window.CFG && Number(window.CFG.adCoinsPerWatch)) || 10;
h += '<div style="font-size:11px;color:#888;margin-top:3px">Ek ad = +' + _adReward + ' Coins</div>';
```

Aur `index.html` line ~445 ka hardcoded `+10🪙` bhi runtime pe CFG se update karo
(ya kam se kam dono jagah same number rakho).

### ⚠️ Double-credit ka khatra bhi check karo
`features/ads.js` waala version **`increment_balance` RPC** call karta hai, jabki
`rewarded-bonus.js` waala `_giveCoins()` use karta hai. Merge karte waqt confirm
karo ki coins **sirf ek hi baar** credit ho rahe hain — `_giveCoins` ki body dekh lo,
agar wo bhi RPC + local `UD.coins` dono badhata hai to wo bhi 2x ho sakta hai.

---

## 🔴 BUG U-2 — Daily Missions ki screen baar-baar khulti rehti hai 😭

**Severity:** CRITICAL (app unusable ho jaata hai, modal loop 300ms me repeat)

### Root cause (confirmed — 3 defects ek saath)

**File:** `features/growth.js`

#### (a) `claimMission()` "already claimed" branch panel ko dobara khol deta hai
```js
// features/growth.js, ~line 278
window.db.ref(path).once('value', function(s) {
    if (s.val()) {
      toast('Pehle se claim ho chuka hai', 'inf');
      if (window.showMissionsPanel) setTimeout(window.showMissionsPanel, 300);  // ← LOOP
      return;
    }
```

#### (b) Bridge ka READ sub-key ignore karta hai aur poora object lauta deta hai
**File:** `core/db-bridge.js`, ~line 614
```js
if (root === 'users' && parts[2] === 'missionProgress') {
  ... callback(_fakeSnap(obj));   // obj = { mission_key: progress, ... }
}
```
Yahan `parts[3]` (yaani `claimed_daily_login_<date>`) ko **bilkul ignore** kiya gaya hai.
`claimMission` `users/{uid}/missionProgress/claimed_daily_login_...` maangta hai,
lekin use **poora map** milta hai. Khali map bhi `{}` hota hai — aur JS me
**`{}` truthy hai** → `if (s.val())` hamesha TRUE → hamesha "Pehle se claim ho chuka hai".

#### (c) Bridge ka WRITE claim flag ko save hi nahi karta
**File:** `core/db-bridge.js`, ~line 202
```js
if (field === 'missionProgress' && typeof value === 'object') { ... }
```
`claimMission` `.set(true)` karta hai — `value` **boolean** hai, object nahi. Isliye
yeh branch match hi nahi karta, write kahin nahi jaata, flag kabhi persist nahi hota.

### Loop kaise banta hai
```
showMissionsPanel()
  → prog me 'claimed_daily_login_<date>' nahi milta   (defect b + c)
  → auto-claim: claimMission('daily_login', ...)
      → read se {} milta hai → truthy → "Pehle se claim ho chuka hai"
      → setTimeout(showMissionsPanel, 300)             (defect a)
          → wapas upar se ... ∞
```

### Fix

**1. `features/growth.js` — re-entrancy guard + already-claimed branch se re-render hatao**

```js
/* ✅ FIX: auto-claim ek session me sirf EK BAAR chale */
var _autoClaimedToday = null;

window.showMissionsPanel = function() {
  ...
    if (window.openModal) openModal('🎯 Missions', h);

    // Auto-claim daily login — sirf ek baar
    if (!prog['claimed_daily_login_' + today] && _autoClaimedToday !== today) {
      _autoClaimedToday = today;
      var _r = (window.CFG && window.CFG.missions && window.CFG.missions.daily_login) || 5;
      claimMission('daily_login', _r, today, 'daily', /* silent */ true);
    }
  });
};

window.claimMission = function(missionId, coins, period, type, silent) {
  ...
  window.db.ref(path).once('value', function(s) {
    var v = s.val();
    /* ✅ FIX: {} bhi truthy hota hai — sirf `true`/number ko claimed maano */
    var alreadyClaimed = (v === true || v === 1 || v === 'true');
    if (alreadyClaimed) {
      if (!silent && window.toast) toast('Pehle se claim ho chuka hai', 'inf');
      /* ✅ FIX: yahan se panel dobara MAT kholo — yahi infinite loop tha */
      return;
    }
    ...
    /* success ke baad hi re-render, aur sirf jab silent na ho */
    if (!silent && window.showMissionsPanel) setTimeout(window.showMissionsPanel, 300);
  });
};
```

**2. `core/db-bridge.js` — read: sub-key honour karo**

```js
/* users/{uid}/missionProgress[/{key}] */
if (root === 'users' && parts[2] === 'missionProgress') {
  var today2 = new Date().toISOString().split('T')[0];
  var subKey = parts[3] || null;                      // ✅ NEW
  window._supa.from('mission_progress').select('*')
    .eq('user_id', parts[1]).gte('period', today2)
    .then(function(r) {
      var obj = {};
      (r.data || []).forEach(function(m) {
        obj[m.mission_key] = m.progress;
        if (m.claimed) obj['claimed_' + m.mission_key + '_' + m.period] = true;  // ✅ NEW
      });
      callback(_fakeSnap(subKey ? (obj[subKey] != null ? obj[subKey] : null) : obj));  // ✅
    }, function() { callback(_fakeSnap(subKey ? null : {})); });
  return;
}
```

**3. `core/db-bridge.js` — write: scalar claim flag handle karo**

```js
/* users/{uid}/missionProgress/{key} = <scalar>  ✅ NEW branch, object waale se PEHLE */
if (field === 'missionProgress' && parts[3] != null) {
  var _today = new Date().toISOString().split('T')[0];
  var _key   = parts[3];
  /* 'claimed_<mission>_<period>' → claim RPC; warna progress RPC */
  var m = /^claimed_(.+?)_(.+)$/.exec(_key);
  if (m) {
    return window._supa.rpc('claim_mission_reward', {
      p_mission_key: m[1], p_period: m[2], p_coins: 0   /* coins alag se credit hote hain */
    });
  }
  return window._supa.rpc('track_mission_progress', {
    p_mission_key: _key, p_period: _today, p_progress: Number(value) || 0, p_target: 1
  });
}
```

**4. Backend:** `mission_progress` table + `track_mission_progress` + naya
`claim_mission_reward` RPC chahiye — SQL admin repo ke
`supabase/admin-panel-fixes.sql` **SECTION 7** me diya hua hai.

> 💡 **Best approach:** coins credit + claim flag dono ek hi atomic RPC
> (`claim_mission_reward`) me kar do. Abhi `claimMission` alag se
> `increment_balance` bhi call karta hai — agar claim flag save nahi hota to
> **user infinite coins farm kar sakta hai**. Yeh sirf isliye exploit nahi hua
> kyunki UI loop me phans jaata tha. Bahut zaroori hai.

---

## 🟠 BUG U-3 — `.catch()` supabase query builder par (poore user panel me check karo)

**Severity:** HIGH (silent crashes)

supabase-js v2 ka query builder ek **thenable** hai — usme sirf `.then()` hai,
**`.catch()` aur `.finally()` NAHI hain**. Maine actual library (`v2` UMD) par
verify kiya:

```
before shim: typeof builder.catch = undefined
             typeof builder.finally = undefined
             typeof builder.then = function
```

Matlab yeh line **hamesha** `TypeError: ....catch is not a function` throw karti hai:

```js
window._supa.from('users').update(x).eq('id', uid).catch(function(e){ ... });
```

Admin panel me **~40 aisi lines** thi — unme se ek line hi
"Profile update approve par error + button me chakri" bug ki jad thi.

**User panel me bhi check karo:**
```bash
grep -rn "_supa" --include=*.js . | grep -n "\.catch("
# aur multi-line ke liye:
grep -rzoP "_supa\.(from|rpc)\([^;]{0,600}?\.catch\s*\(" -r .
```

**Do options:**
1. Har jagah `.catch(fn)` → `.then(null, fn)` kar do, **ya**
2. Admin panel waala global shim copy kar lo (recommended, one-line fix):
   - File: `js/supabase-compat-patch.js` (admin repo me hai)
   - `index.html` me supabase-js UMD ke **turant baad** load karo:
     ```html
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/..."></script>
     <script src="js/supabase-compat-patch.js"></script>   <!-- ← ye -->
     ```
   Yeh `PostgrestBuilder.prototype` par `.catch()` + `.finally()` add kar deta hai,
   toh purani saari lines apne aap kaam karne lagti hain.

> Note: `.then(...).catch(...)` **safe hai** (kyunki `.then()` ek real Promise
> deta hai). Sirf **direct builder par** `.catch()` galat hai.

---

## 🟡 BUG U-4 — `DB.matches.getUpcoming()` galat column names maangta hai

**File:** `core/db.js` ~line 370

```js
.from('active_matches')
.select('id,title,mode,status,game,scheduled_at,entry_fee,prize_pool,
         team_size,max_players,current_players,map,perspective,is_featured,
         match_type,banner_url')
```

`matches` table me actually yeh columns hain (admin bridge ke mapping se confirm):
`max_slots`, `filled_slots`, `match_sub_type` — **`max_players` / `current_players`
/ `team_size` / `perspective` / `is_featured` / `match_type` / `banner_url` / `game`
exist nahi karte.**

Abhi yeh function **kahin call nahi hota** (live path `core/listeners.js:273` hai
jo `select('*')` karta hai), isliye user ko dikkat nahi aa rahi — lekin jis din koi
ise use karega, PostgREST **42703** error dega aur home screen khali dikhega.

**Fix:** ya to `select('*')` kar do, ya sahi column names likho:
```js
.select('id,title,mode,match_sub_type,status,scheduled_at,entry_fee,entry_type,' +
        'prize_pool,first_prize,max_slots,filled_slots,map,is_special,special_category')
```

---

## 🟡 BUG U-5 — Ad daily limit do jagah alag-alag

- `features/ads.js` → `CFG.adDailyLimit` (default **5**)
- `features/rewarded-bonus.js` → `MAX_ADS_DAY = 5` (hardcoded const)
- Admin panel purana default **20** bhejta tha (ab 5 kar diya)
- Dono files **alag localStorage key** use karti hain:
  - `ads.js`: `_adWatched_<date>_<uid>`
  - `rewarded-bonus.js`: `_mes_rew_bonus_<uid>_<date>`

Matlab user **dono counters alag-alag** bhar ke **double ads** dekh sakta hai.
Ek hi counter aur ek hi limit source (`CFG.adDailyLimit`) rakho.

Aur limit `localStorage` me hai — user clear kar ke unlimited ads dekh sakta hai.
Ideally limit **server-side** (`mission_progress` ya `watch_earn_log` table) me hone chahiye.

---

## 🟡 BUG U-6 — `claimMission('daily_login', 5, ...)` me reward hardcoded

`features/growth.js` line ~250: auto-claim me `5` hardcoded hai, jabki mission list
me reward `CFG.missions.daily_login` se aata hai. Agar admin ne 10 set kiya, to card
"Claim +10" dikhayega par milenge 5. `CFG` se lo (U-2 ke fix me ye shaamil hai).

---

## ✅ Checklist (user panel)

- [ ] U-1: `features/rewarded-bonus.js` → `watchAdForCoins` config-driven karo (50 hardcoded hatao)
- [ ] U-1: modal + `index.html` ka `+10🪙` text bhi CFG se aaye
- [ ] U-1: double-credit check (`_giveCoins` vs `increment_balance`)
- [ ] U-2: `features/growth.js` → auto-claim guard + already-claimed branch se re-render hatao
- [ ] U-2: `core/db-bridge.js` → missionProgress read me `parts[3]` honour karo
- [ ] U-2: `core/db-bridge.js` → missionProgress scalar write handle karo
- [ ] U-2: SQL SECTION 7 chalao (`mission_progress`, `track_mission_progress`, `claim_mission_reward`)
- [ ] U-3: `.catch()` on supabase builder — shim add karo ya `.then(null, fn)` karo
- [ ] U-4: `core/db.js` `getUpcoming()` ke column names theek karo
- [ ] U-5: ad daily limit ek hi counter + ek hi source
- [ ] U-6: daily_login reward CFG se
