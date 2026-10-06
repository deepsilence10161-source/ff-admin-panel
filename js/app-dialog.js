/* ================================================================
   APP DIALOG — js/app-dialog.js  (Mini eSports ADMIN PANEL)

   ✅ BUG FIX (2026-10-06, B3):
   Shikayat: "koi bhi native browser popup na aaye — '…github.io says'
   jaisa popup nahi, har confirm/alert app ki apni UI me ho."

   Admin panel me pehle 85 jagah native confirm()/alert()/prompt() the.
   Browser me wo BADA, bhadda white popup dikhata hai jisme upar
   "deepsilence10161-source.github.io says" likha aata hai — admin ka
   rang-roop kahin nahi. (Bilkul wahi shikayat live testing me aayi thi.)

   Ab: apna overlay — aapke theme ke rang (--primary/--card/--border),
   gol kone, bade saaf button, Enter = haan, Esc = cancel, bahar tap = band.

   Public API:
     • window.appAlert(msg, opts)            → Promise
     • window.appConfirm(msg, opts)          → Promise<true|false>
     • window.appPrompt(label, def, opts)    → Promise<string|null>
     • window.appConfirmCb(msg, onYes, onNo) → purane callback andaaz me

   Saath me SURAKSHA-JAAL (neeche): koi aisi jagah bach gayi jise hum
   badalna bhool gaye aur wo phir bhi native confirm() bulaye — to wo bhi
   isi app-UI dialog me badal jayegi. Click wale handler se bulaye gaye
   confirm bilkul theek chalte hain: "Haan" dabane par wahi button dobara
   apne aap chalta hai, aapko dobara nahi dabana padta.
================================================================ */
(function () {
  'use strict';
  if (window.__appDialogReady) return;
  window.__appDialogReady = true;

  var _styleId = '_appDlgStyle';

  function _injectCss() {
    if (document.getElementById(_styleId)) return;
    var css = ''
      + '#_appDlgOv{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;'
      + 'background:rgba(0,0,0,.72);backdrop-filter:blur(3px);padding:18px}'
      + '#_appDlgOv.show{display:flex}'
      + '#_appDlgCard{width:100%;max-width:380px;background:var(--card,#171b22);border:1px solid var(--border,#2a3038);'
      + 'border-radius:16px;padding:20px 18px 16px;box-shadow:0 18px 50px rgba(0,0,0,.6);animation:_appDlgIn .16s ease-out}'
      + '@keyframes _appDlgIn{from{transform:translateY(10px) scale(.97);opacity:0}to{transform:none;opacity:1}}'
      + '#_appDlgIcon{font-size:30px;text-align:center;margin-bottom:8px}'
      + '#_appDlgMsg{font-size:14px;line-height:1.55;color:var(--text,#e8ecf1);text-align:center;white-space:pre-wrap;'
      + 'word-break:break-word;max-height:46vh;overflow:auto}'
      + '#_appDlgIn{display:none;width:100%;margin-top:12px;padding:11px 12px;border-radius:10px;'
      + 'background:var(--bg-dark,#0f1319);border:1px solid var(--border,#2a3038);color:var(--text,#e8ecf1);font-size:14px;box-sizing:border-box}'
      + '#_appDlgBtns{display:flex;gap:10px;margin-top:16px}'
      + '#_appDlgBtns button{flex:1;padding:12px;border-radius:10px;border:none;font-size:14px;font-weight:800;cursor:pointer}'
      + '#_appDlgOk{background:var(--primary,#00d4ff);color:#00212b}'
      + '#_appDlgOk.danger{background:#ff4444;color:#fff}'
      + '#_appDlgNo{background:transparent;color:var(--text-muted,#8b95a3);border:1px solid var(--border,#2a3038)!important}';
    var st = document.createElement('style');
    st.id = _styleId;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function _build() {
    if (document.getElementById('_appDlgOv')) return;
    _injectCss();
    var ov = document.createElement('div');
    ov.id = '_appDlgOv';
    ov.innerHTML = '<div id="_appDlgCard" role="dialog" aria-modal="true">'
      + '<div id="_appDlgIcon"></div>'
      + '<div id="_appDlgMsg"></div>'
      + '<input id="_appDlgIn" type="text" autocomplete="off">'
      + '<div id="_appDlgBtns">'
      +   '<button id="_appDlgNo" type="button">Cancel</button>'
      +   '<button id="_appDlgOk" type="button">OK</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) _answer(false); });
    document.getElementById('_appDlgNo').addEventListener('click', function () { _answer(false); });
    document.getElementById('_appDlgOk').addEventListener('click', function () { _answer(true); });
    document.addEventListener('keydown', function (e) {
      if (!_open) return;
      if (e.key === 'Escape') { e.preventDefault(); _answer(false); }
      else if (e.key === 'Enter') { e.preventDefault(); _answer(true); }
    });
  }

  var _open = false, _mode = 'alert', _resolve = null, _opts = {}, _replay = null;

  function _show(mode, message, opts) {
    _build();
    _mode = mode; _opts = opts || {};
    _open = true;
    var ov = document.getElementById('_appDlgOv');
    document.getElementById('_appDlgIcon').textContent = _opts.icon ||
      (mode === 'confirm' ? '❓' : mode === 'prompt' ? '✍️' : (opts && opts.danger ? '⚠️' : 'ℹ️'));
    document.getElementById('_appDlgMsg').innerHTML = _esc(message);
    var inp = document.getElementById('_appDlgIn');
    inp.style.display = (mode === 'prompt') ? 'block' : 'none';
    inp.value = (mode === 'prompt') ? (_opts.defaultValue || '') : '';
    inp.placeholder = _opts.placeholder || '';
    var ok = document.getElementById('_appDlgOk');
    ok.textContent = _opts.okText || (mode === 'confirm' ? 'Haan, karo' : 'OK');
    ok.className = _opts.danger ? 'danger' : '';
    var no = document.getElementById('_appDlgNo');
    no.textContent = _opts.cancelText || 'Cancel';
    no.style.display = (mode === 'alert') ? 'none' : 'block';
    ov.classList.add('show');
    try { if (mode === 'prompt') setTimeout(function () { inp.focus(); }, 40); } catch (e) {}
  }

  function _hide() {
    var ov = document.getElementById('_appDlgOv');
    if (ov) ov.classList.remove('show');
    _open = false;
  }

  function _answer(yes) {
    if (!_open) return;
    var val = document.getElementById('_appDlgIn').value;
    var mode = _mode, res = _resolve, opts = _opts;
    _resolve = null;
    _hide();
    if (res) {
      try { res(yes ? (mode === 'prompt' ? val : true) : (mode === 'prompt' ? null : false)); } catch (e) {}
    }
    try {
      if (yes && typeof opts.onYes === 'function') opts.onYes(mode === 'prompt' ? val : undefined);
      if (!yes && typeof opts.onNo === 'function') opts.onNo();
    } catch (e) { console.warn('[AppDialog] callback fail:', e && e.message); }
    if (yes) {
      _q.push({ mode: mode, v: (mode === 'prompt' ? val : true) });   /* jawab yaad rakho */
      _startReplay();                                                /* wahi button dobara, jawab sath */
    } else {
      _q = []; _cur = 0; _replay = null;                             /* cancel — kuch nahi, saaf */
    }
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── Public API ── */
  window.appAlert = function (message, opts) {
    return new Promise(function (res) { _show('alert', message, opts); _resolve = function () { res(true); }; });
  };
  window.appConfirm = function (message, opts) {
    if (typeof opts === 'function') opts = { onYes: opts };
    return new Promise(function (res) { _show('confirm', message, opts); _resolve = res; });
  };
  window.appConfirmCb = function (message, onYes, onNo, opts) {
    opts = opts || {}; opts.onYes = onYes; opts.onNo = onNo;
    return window.appConfirm(message, opts);
  };
  window.appPrompt = function (message, defaultValue, opts) {
    if (typeof defaultValue === 'object' && defaultValue !== null) { opts = defaultValue; defaultValue = ''; }
    return new Promise(function (res) {
      _show('prompt', message, Object.assign({ defaultValue: defaultValue || '' }, opts || {}));
      _resolve = res;
    });
  };

  /* ── SURAKSHA-JAAL (multi-step flows ke sath) ───────────────────
     Sabse ahem baat: kai jagah pehle ACCOUNT/REASON poocha jata hai
     (prompt) aur phir "pakka?" (confirm) — jaise Ban: pehle reason,
     phir "Ban user X? Reason: Y". Native me ye do popup lagataar aate
     the. Ab:
       1. Pehla jawab aap app-UI me dete ho (reason likh kar / Haan).
       2. Wahi button apne aap dobara chalta hai aur aapke diye hue
          jawab apne aap laga diye jate hain (queue) — dobara nahi poocha
          jata, aur koi native popup bhi nahi.
       3. Agar kisi nayi shakh (branch) me kuch naya poocha jaye, to wo
          phir se app-UI me hi dikhega — native kabhi nahi.
     "Cancel" dabane par kuch nahi hota (bilkul native jaisa) aur queue
     saaf ho jati hai, taki agli baar button dabane par fresh shuru ho. */
  var _q = [], _cur = 0, _bypass = false, _replaying = false, _replay = null;

  function _nextQueued(mode) {
    var e = _q[_cur];
    if (e && e.mode === mode) { _cur++; return { hit: true, v: e.v }; }
    return { hit: false };
  }

  function _startReplay() {
    if (!_replay) return;
    var fn = _replay, before = _q.length;
    _cur = 0; _bypass = true; _replaying = true;
    /* Rate-limit/duplicate-click guards ko batao ki ye user ka dobara click
       NAHI hai — wahi ek action apne aap aage badh raha hai. */
    window.__appDialogBypass = true;
    setTimeout(function () {
      try { fn(); } catch (e) { console.warn('[AppDialog] replay fail:', e && e.message); }
      setTimeout(function () { _replaying = false; }, 0);
      /* 1.8 second baad dekho: replay ne apna jawab kharch kiya? Agar nahi
         (button band tha / guard ne rok diya), to user ko chup-chaap kuch
         na-hone ki jagah saaf batao. */
      setTimeout(function () {
        window.__appDialogBypass = false;
        var kuchPuchhaJaRahaHai = document.getElementById('_appDlgOv')
          && document.getElementById('_appDlgOv').classList.contains('show');
        if (before > 0 && _cur === 0 && !kuchPuchhaJaRahaHai) {
          window.appAlert('Kaam poora nahi hua — kripya wahi button ek baar dobara dabaiye.', { icon: '⚠️' });
        }
      }, 1800);
    }, 30);
  }

  /* naya click (asli user ka) = purani queue bekaar, saaf karo */
  document.addEventListener('click', function (e) {
    var t = e.target;
    /* Hamare hi dialog ke andar ka click "asli kaam wala button" nahi hai —
       isliye na yaad rakho, na queue saaf karo (warna apna hi jawab ud jata). */
    var inDlg = !!(t && t.closest && t.closest('#_appDlgOv'));
    var el = (t && t.closest && !inDlg)
      ? t.closest('[onclick], button, a, .nav-item, .filter-tab, .tab') : null;
    if (el) window.__appDialogLastEl = el;
    if (!_replaying && !_bypass && !inDlg) { _q = []; _cur = 0; }
  }, true);

  function _replayFromLastEl() {
    var el = window.__appDialogLastEl;
    if (el && el.click) return function () { el.click(); };
    return null;
  }

  var _nativeAlert = window.alert, _nativeConfirm = window.confirm, _nativePrompt = window.prompt;
  window.alert = function (msg) {
    if (_bypass) {                 /* replay ke dauran alert chup-chaap nigal lo */
      var r = _nextQueued('alert');
      if (r.hit) return;
      _bypass = false;
    }
    window.appAlert(msg, { icon: 'ℹ️' });
  };
  window.confirm = function (msg) {
    if (_bypass) {
      var r = _nextQueued('confirm');
      if (r.hit) return !!r.v;
      _bypass = false;             /* nayi shakh — app-UI me poocho */
    }
    _replay = _replayFromLastEl();
    window.appConfirm(msg, { icon: '⚠️' });
    return false;                  /* natija dialog se (replay ke zariye) */
  };
  window.prompt = function (msg, def) {
    if (_bypass) {
      var r = _nextQueued('prompt');
      if (r.hit) return r.v;
      _bypass = false;
    }
    _replay = _replayFromLastEl();
    window.appPrompt(msg, def || '', {});
    return null;
  };

  /* E2E/debug ke liye — kis waqt kaun sa jawab line me hai, ye dikhata hai */
  window.__appDialogState = function () {
    return { q: _q.slice(), cur: _cur, bypass: _bypass, replaying: _replaying,
             lastEl: window.__appDialogLastEl ? (window.__appDialogLastEl.id || window.__appDialogLastEl.className || '?') : null };
  };
  window._appDialogNatives = { alert: _nativeAlert, confirm: _nativeConfirm, prompt: _nativePrompt };

  console.log('[AppDialog] ready — koi browser popup nahi, sab app-UI (B3)');
})();
