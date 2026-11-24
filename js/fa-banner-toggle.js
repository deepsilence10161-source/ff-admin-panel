/* ================================================================
   MINI eSPORTS ADMIN — js/fa-banner-toggle.js
   ----------------------------------------------------------------
   OWNER ORDER (2026-11-24):
     "banner change band kar dete hain usse ui bigadta hai"
     "agar tune block kiya photo upload banner to admin panel me
      setting section me ise on off karne ka option rakh dena,
      agar kabhi man hua to change kar lenge"

   Ye script Settings → App Settings me ek ALAG card jodta hai:
     🖼️ Profile Banner Change (User App)   [toggle]  [Save]

   Flag: app_settings.key='live_config' → value.bannerChangeEnabled
         0 = BAND (default) | 1 = CHALU
   User app ise features/app-config.js se padhta hai (realtime), isliye
   save karte hi user app me turant asar dikhta hai.

   ⚠️ DESIGN RULES (jaan-boojh kar):
     1. fa-app-settings-v2.js OBFUSCATED hai → usko chheda nahi gaya.
        Ye file purely ADDITIVE hai (wrapper + alag card + alag save).
     2. _renderAppSettings() ASYNC hai aur #appSettingsContent.innerHTML
        ko baad me replace karta hai → ek baar inject karna kaafi nahi.
        Isliye SELF-HEALING loop: card gayab hote hi dobara lag jata hai.
     3. Save MERGE-ONLY hai: fresh live_config padh kar SIRF
        bannerChangeEnabled key set karte hain. "Save All Settings" wale
        poore-object overwrite se ye flag kabhi nahi tutega, aur ye save
        baaki 40+ keys ko kabhi nahi chhuta.
     4. Mobile comfort: card flex-wrap, button min-height 44px.
   ================================================================ */
(function () {
  'use strict';

  var KEY = 'bannerChangeEnabled';
  var TABLE = 'app_settings';
  var ROW = 'live_config';
  var CARD_ID = 'bannerToggleCard';
  var BY = 'admin-banner-toggle';

  function log() { try { console.log.apply(console, ['[BannerToggle]'].concat([].slice.call(arguments))); } catch (e) {} }
  function toast(msg, isErr) { try { if (window.showToast) window.showToast(msg, !!isErr); } catch (e) {} }
  function supa() { return window._supa || null; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── DB helpers ─────────────────────────────────────────────── */
  function readFlag(cb) {
    var s = supa();
    if (!s) { cb(null, 'supabase client (_supa) abhi ready nahi'); return; }
    s.from(TABLE).select('key,value').eq('key', ROW).then(function (r) {
      if (r && r.error) { cb(null, r.error.message || 'read error'); return; }
      var rows = (r && r.data) || [];
      var val = rows.length ? (rows[0].value || {}) : {};
      var raw = val[KEY];
      cb(raw == null ? 0 : Number(raw) ? 1 : 0, null, val);
    }, function (e) { cb(null, (e && e.message) || String(e)); });
  }

  /* merge-only write: fresh read → sirf ye key badlo → upsert */
  window._saveBannerToggle = function () {
    var box = document.getElementById('as_' + KEY);
    var btn = document.getElementById('bannerToggleSave');
    var msg = document.getElementById('bannerToggleMsg');
    if (!box) { toast('Banner toggle abhi render nahi hua — Refresh dabao', true); return; }
    var want = box.checked ? 1 : 0;
    var s = supa();
    if (!s) { toast('Supabase client ready nahi — page refresh karo', true); return; }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }
    if (msg) { msg.textContent = '⏳ Save ho raha hai…'; msg.style.color = '#888'; }

    s.from(TABLE).select('key,value').eq('key', ROW).then(function (r) {
      if (r && r.error) throw r.error;
      var rows = (r && r.data) || [];
      var merged = Object.assign({}, rows.length ? (rows[0].value || {}) : {});
      merged[KEY] = want;                       /* SIRF ye key — baaki sab untouched */
      return s.from(TABLE).upsert({
        key: ROW,
        value: merged,
        updated_by: BY,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
    }).then(function (w) {
      if (w && w.error) throw w.error;
      try { if (window._AS && typeof window._AS === 'object') window._AS[KEY] = want; } catch (e) {}
      paintLabel(want);
      if (msg) {
        msg.textContent = want
          ? '✅ ON saved — user app me turant live (banner change chalu). Keys saved: merge-only.'
          : '✅ OFF saved — user app me turant live (banner change band). Keys saved: merge-only.';
        msg.style.color = '#00ff9c';
      }
      toast(want ? '✅ Banner change ON — user app me live' : '✅ Banner change OFF — user app me live', false);
      log('saved', want);
    }).catch(function (e) {
      var m = (e && e.message) || String(e);
      if (msg) { msg.textContent = '❌ Save fail: ' + m; msg.style.color = '#ff6b6b'; }
      toast('Banner toggle save fail: ' + m, true);
      log('save error', m);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Banner Setting'; }
    });
  };

  function paintLabel(on) {
    var lbl = document.getElementById('as_' + KEY + '_lbl');
    if (!lbl) return;
    lbl.style.color = on ? '#00ff9c' : '#888';
    lbl.textContent = on
      ? '🟢 ON — banner change chalu (user app me premium flow wapas)'
      : '⚪ OFF — banner change band (default)';
  }

  /* ── card HTML ──────────────────────────────────────────────── */
  function cardHTML() {
    return ''
      + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px;margin-bottom:14px">'
      +   '<div style="font-size:13px;font-weight:800;color:#b964ff;margin-bottom:12px;display:flex;align-items:center;gap:8px">'
      +     '<i class="fas fa-image"></i> 🖼️ Profile Banner Change (User App)'
      +   '</div>'
      +   '<div style="background:rgba(185,100,255,.07);border:1px solid rgba(185,100,255,.2);border-radius:10px;padding:10px 12px;margin-bottom:12px">'
      +     '<div style="font-size:11px;color:#ccc;line-height:1.6">User app me profile <b>banner photo</b> badalne se profile UI bigadti thi, isliye ye <b>default BAND</b> hai. '
      +       'Kabhi man ho to yahan se <b>ON</b> kar do — save karte hi user app me <b>turant</b> live ho jata hai (app update/reinstall ki zaroorat nahi). '
      +       'Purane lage hue banners hamesha dikhte rehte hain; sirf <i>naya</i> change block hota hai.</div>'
      +   '</div>'
      +   '<div class="form-group" style="margin-bottom:10px">'
      +     '<label style="font-size:12px">Banner change allow karein?</label>'
      +     '<div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap">'
      +       '<label class="toggle"><input type="checkbox" id="as_' + KEY + '" data-on="banner change chalu" data-off="banner change band (default)" onchange="window._bannerToggleFlip(this)"><span class="toggle-slider"></span></label>'
      +       '<span id="as_' + KEY + '_lbl" style="font-size:12px;font-weight:700;color:#888">⚪ OFF — banner change band (default)</span>'
      +     '</div>'
      +   '</div>'
      +   '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px">'
      +     '<button type="button" id="bannerToggleSave" class="btn btn-ghost btn-sm" onclick="window._saveBannerToggle()" style="min-height:44px;padding:10px 16px;font-size:12px"><i class="fas fa-save"></i> Save Banner Setting</button>'
      +     '<button type="button" class="btn btn-ghost btn-sm" onclick="window._bannerToggleRefresh()" style="min-height:44px;padding:10px 16px;font-size:12px" title="DB se current value dobara padho"><i class="fas fa-sync-alt"></i> Refresh</button>'
      +     '<span style="font-size:10px;color:#666">Ye save <b>sirf</b> bannerChangeEnabled key badalta hai — baaki settings safe.</span>'
      +   '</div>'
      +   '<div id="bannerToggleMsg" style="font-size:11px;margin-top:8px;color:#888">⏳ DB se current value padhi ja rahi hai…</div>'
      + '</div>';
  }

  window._bannerToggleFlip = function (el) {
    try { if (window._asTglUpd) window._asTglUpd(el); } catch (e) {}
    paintLabel(!!(el && el.checked));
    var msg = document.getElementById('bannerToggleMsg');
    if (msg) { msg.textContent = '👉 Badlav abhi sirf screen par hai — "Save Banner Setting" dabana zaroori hai.'; msg.style.color = '#ffb84d'; }
  };

  window._bannerToggleRefresh = function () {
    var msg = document.getElementById('bannerToggleMsg');
    if (msg) { msg.textContent = '⏳ DB se current value padhi ja rahi hai…'; msg.style.color = '#888'; }
    syncFromDb();
  };

  function syncFromDb() {
    readFlag(function (on, err) {
      var box = document.getElementById('as_' + KEY);
      var msg = document.getElementById('bannerToggleMsg');
      if (box) box.checked = !!on;
      paintLabel(!!on);
      if (msg) {
        if (err) { msg.textContent = '❌ DB se value nahi padhi ja saki: ' + esc(err); msg.style.color = '#ff6b6b'; }
        else {
          msg.textContent = on
            ? '🟢 DB me abhi ON (1) hai — user app banner change kar sakte hain.'
            : '⚪ DB me abhi OFF (0) hai — user app me banner change band hai.';
          msg.style.color = on ? '#00ff9c' : '#888';
        }
      }
      log('db flag =', on, err || '');
    });
  }

  /* ── inject (self-healing) ──────────────────────────────────── */
  function settingsVisible() {
    var sec = document.getElementById('section-settings');
    if (!sec) return false;
    if (sec.offsetParent !== null) return true;
    try { return window.getComputedStyle(sec).display !== 'none'; } catch (e) { return false; }
  }

  /* ✅ FIX (2026-11-24, local proof se mila): pehle inserted card ka id
     CARD_ID + '_inner' set ho jata tha — getElementById(CARD_ID) hamesha null,
     isliye heal() loop har 1.5s me NAYA card dalta raha (57 duplicate cards
     dikhe). Ab jo card DOM me jata hai USKA id hi CARD_ID hai, aur ek
     injection counter guard bhi hai (pathological loop kabhi na chale). */
  var INJECT_MAX = 60;
  var injects = 0;

  function inject() {
    var host = document.getElementById('appSettingsContent');
    if (!host) return false;
    if (document.getElementById(CARD_ID)) return true;           /* already there */
    if (injects >= INJECT_MAX) { log('inject guard: ' + injects + ' baar inject ho chuka — ruk gaya'); return false; }
    var wrap = document.createElement('div');
    wrap.innerHTML = cardHTML();
    var card = wrap.firstElementChild;
    if (!card) return false;
    card.id = CARD_ID;
    /* sabse upar rakho taaki owner ko turant dikhe */
    if (host.firstElementChild) host.insertBefore(card, host.firstElementChild);
    else host.appendChild(card);
    injects++;
    log('card injected (#' + injects + ')');
    syncFromDb();
    return true;
  }

  function heal() {
    try {
      if (!settingsVisible()) return;
      var host = document.getElementById('appSettingsContent');
      if (!host) return;
      /* spinner/error content me inject mat karo — v2 ka render aane do */
      if (document.getElementById(CARD_ID)) return;
      inject();
    } catch (e) { log('heal error', e && e.message); }
  }

  /* ── hook: loadAppSettings ke baad bhi card zinda rahe ──────── */
  function hook() {
    if (typeof window.loadAppSettings !== 'function') return false;
    if (window.loadAppSettings.__bannerToggleWrapped) return true;
    var orig = window.loadAppSettings;
    var wrapped = function () {
      var r;
      try { r = orig.apply(this, arguments); }
      catch (e) { log('loadAppSettings threw', e && e.message); throw e; }
      /* _renderAppSettings async hai → thodi der tak guard chala ke card bachao */
      var n = 0;
      var g = setInterval(function () {
        n++;
        heal();
        if (n >= 60) clearInterval(g);
      }, 250);
      return r;
    };
    wrapped.__bannerToggleWrapped = true;
    window.loadAppSettings = wrapped;
    log('loadAppSettings wrapped');
    return true;
  }

  var tries = 0;
  var boot = setInterval(function () {
    tries++;
    if (hook()) { clearInterval(boot); heal(); }
    else if (tries > 200) { clearInterval(boot); log('loadAppSettings never appeared — card sirf heal loop se aayega'); }
  }, 250);

  /* permanent self-heal (v2 ka async innerHTML wipe isse bharta hai) */
  setInterval(heal, 1500);

  log('fa-banner-toggle.js loaded (bannerChangeEnabled, default OFF)');
})();
