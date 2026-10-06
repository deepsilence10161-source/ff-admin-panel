/* ════════════════════════════════════════════════════════════════════════
   B13 (2026-10-06) — "Approval/reject click par request MILLISECONDS me
   hategi — bilkul live, bina lag. SAB JAGAH."

   ── Asli samasya (live code padh kar) ─────────────────────────────────
   Admin panel ke saare approve/reject handlers ek hi tarah kaam karte hain:
       button click → Supabase RPC → phir poora section dobara load
       (loadSkyDiamondReqSection / loadPremiumReqSection / …)
   Us re-load me network round-trip lagta hai (kabhi 1-3 second), aur us
   tak ROW WAISI HI khadi rehti hai — admin ko lagta hai "click kaam hi
   nahi kiya" aur wo dobara click kar deta hai (duplicate action ka risk).

   ── Ilaaj (yahi file) ──────────────────────────────────────────────────
   ek chhota generic wrapper jo un saare handlers par lagta hai:
     1. click hote hi (0 ms par) → button band + row par 'busy' look
        (aage-peeche se pata chalta hai ki click laga hai)
     2. jab handler ka asli kaam BAN jaye (RPC resolve ho jaye) → row
        turant fade hokar DOM se hat jati hai — section ke dobara load
        hone ka intezaar NAHI (wo background me chalta rehta hai aur
        aakhir me sab kuch reconcile kar deta hai)
     3. agar handler ne ERROR toast diya → row waisi hi rehti hai aur
        button dobara chalu ho jata hai (galat row kabhi nahi hatti)

   Naya handler aage jo bhi bane, `window._admFastAct([...names])` dobara
   call karne par apne aap wrap ho jata hai (idempotent — `_admFast` flag).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── click kiya gaya button yaad rakho (window.event par bharosa nahi) ── */
  window._admLastClickBtn = null;
  document.addEventListener('click', function (e) {
    try {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (b) window._admLastClickBtn = b;
    } catch (_e) {}
  }, true);

  /* row kaise dhoondhein: table row → data-row → card jaisa koi block */
  function _rowOf(btn) {
    if (!btn || !btn.closest) return null;
    return btn.closest('tr') ||
           btn.closest('[data-row]') ||
           btn.closest('.request-card') ||
           btn.closest('.card') ||
           btn.closest('.list-item') ||
           btn.parentElement;
  }

  function _busyLook(row, on) {
    if (!row) return;
    if (on) {
      if (!row.getAttribute('data-adm-fast-old')) {
        row.setAttribute('data-adm-fast-old', row.style.opacity || ' ');
      }
      row.style.transition = 'opacity .15s';
      row.style.opacity = '0.45';
      row.style.pointerEvents = 'none';
    } else {
      row.style.opacity = '';
      row.style.pointerEvents = '';
      row.removeAttribute('data-adm-fast-old');
    }
  }

  function _removeRow(row) {
    if (!row || !row.parentNode) return;
    row.style.transition = 'opacity .16s';
    row.style.opacity = '0';
    setTimeout(function () {
      if (row && row.parentNode) row.parentNode.removeChild(row);
    }, 170);
  }

  /* ── ek handler ko wrap karo ── */
  window._admFastAct = function (names) {
    (names || []).forEach(function (n) {
      var orig = window[n];
      if (typeof orig !== 'function' || orig._admFast) return;

      var wrapped = function () {
        var btn = window._admLastClickBtn;
        var row = _rowOf(btn);
        if (btn) { btn.disabled = true; btn.style.opacity = '0.55'; }
        _busyLook(row, true);

        /* handler ne error toast diya ya nahi — usi se faisla */
        var hadErr = false;
        var origToast = window.showToast;
        if (typeof origToast === 'function') {
          window.showToast = function (m, isErr) {
            if (isErr) hadErr = true;
            return origToast.apply(this, arguments);
          };
        }

        function finish(errFlag) {
          if (errFlag) hadErr = true;
          if (window.showToast !== origToast) window.showToast = origToast;
          if (btn) { btn.disabled = false; btn.style.opacity = ''; }
          if (hadErr) {
            _busyLook(row, false);          /* kuch galat hua — row waisi hi rahegi */
          } else {
            _removeRow(row);                /* ✅ kaam ban gaya — row abhi hatti hai */
          }
        }

        var out;
        try {
          out = orig.apply(this, arguments);
        } catch (e) {
          finish(true);
          throw e;
        }
        if (out && typeof out.then === 'function') {
          out.then(function () { finish(false); },
                   function () { finish(true); });
        } else {
          finish(false);
        }
        return out;
      };
      wrapped._admFast = true;
      window[n] = wrapped;
      (window._admFastWrapped = window._admFastWrapped || []).push(n);
    });
  };

  /* ── saare approve/reject/verify handlers (jagah-jagah ke) ── */
  window._ADM_FAST_NAMES = [
    'approveSkyDiamond', 'rejectSkyDiamond',
    'approveSkyDiaReq', 'rejectSkyDiaReq',
    'approvePremium', 'approvePremiumReq', 'rejectPremiumReq',
    'approveSeasonPass', 'rejectSeasonPass',
    'approveProfile', 'rejectProfile', 'approveProfileUpdate',
    'approveCreator', 'rejectCreator', 'approveCreatorPayout',
    'approveSponsoredWd', 'rejectSponsoredWd', 'approveSponsoredWithdrawal', 'rejectSponsoredWithdrawal',
    'approveWallet', 'rejectWallet', 'approveAddMoney',
    'approveTeam', 'verifyTeamJoins',
    'approveSuggestion', 'rejectSuggestion',
    'resolveAlert', 'resolveCheatReport', 'resolveTicket',
    'confirmWithdrawal', 'denyRefund'
  ];

  function _wrapAll() {
    try { window._admFastAct(window._ADM_FAST_NAMES); } catch (_e) {}
  }

  /* pehli baar page load par + late-installed handlers ke liye kuch der tak */
  if (document.readyState === 'complete') setTimeout(_wrapAll, 300);
  else window.addEventListener('load', function () { setTimeout(_wrapAll, 300); });
  var _tries = 0;
  var _iv = setInterval(function () {
    _wrapAll();
    if (++_tries >= 25) clearInterval(_iv);   /* ~50s tak dekhte rehte hain */
  }, 2000);
})();
