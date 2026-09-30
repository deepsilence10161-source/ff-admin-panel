/* ═══════════════════════════════════════════════════════════════════════════
   QA LIVE FRESHNESS (2026-09-30) — admin panel
   ───────────────────────────────────────────────────────────────────────────
   ASLI PROBLEM (live-proven, WALK5K/L/M/N/O):
   Supabase Realtime `postgres_changes` ka socket anon role par reh jata hai
   kyunki auth Firebase ID token se hoti hai (Realtime RLS ke liye sirf
   Supabase-issued JWT accept karta hai). Nateeja:
     • `matches` (public RLS) ke events AATE hain ✓
     • `join_requests` (RLS: sirf apni rows / is_admin) ke events NAHI aate ✗
   Isliye admin ko naye joins dikhane ke liye pehle koi auto-refresh nahi tha —
   Results section me khuli participants list purani reh jati thi (admin purani
   roster dekh kar publish kar sakta tha).

   YEH FILE:
   1) Results section ka roster har 6s par halka check karta hai (sirf ids ki
      ginti) aur sirf tab `loadParticipants()` chalata hai jab ginti badle.
      Agar admin ne kills/rank bhare hue hain to refresh NAHI hota — sirf ek
      toast aata hai (typing kabhi wipe nahi hoti).
   2) Tournaments/Matches/Dashboard list ke liye 15s ka safety poll.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ROSTER_MS = 6000;
  var LIST_MS   = 15000;
  var _notifiedFor = -1;

  function rosterHasEdits() {
    try {
      var ins = document.querySelectorAll(
        '#participantsList input[type="number"], #participantsList .kills-input, #participantsList .rank-input');
      for (var i = 0; i < ins.length; i++) {
        var v = (ins[i].value || '').trim();
        if (v !== '' && v !== '0') return true;
      }
    } catch (e) {}
    return false;
  }

  function renderedRows() {
    try { return document.querySelectorAll('#participantsList tr[data-uid]').length; } catch (e) { return 0; }
  }

  var _busy = false;
  async function rosterTick() {
    try {
      if (_busy || document.hidden) return;
      if (window.currentSection !== 'results') return;
      if (!window._supa || !window._supa.from) return;
      var sel = document.getElementById('resultTournamentSelect');
      var mid = sel && sel.value;
      if (!mid) return;
      _busy = true;
      var r = await window._supa.from('join_requests').select('id').eq('match_id', mid);
      _busy = false;
      if (!r || r.error) return;
      var n = (r.data || []).length;
      var shown = renderedRows();
      if (n === shown) { _notifiedFor = -1; return; }
      if (rosterHasEdits()) {
        if (_notifiedFor !== n && typeof window.showToast === 'function') {
          _notifiedFor = n;
          window.showToast('🔄 Ab ' + n + ' players hain (naya join hua). Apne bhare values save karne ke baad roster Refresh karo.', 'inf');
        }
        return;
      }
      if (typeof window.loadParticipants === 'function') window.loadParticipants();
    } catch (e) { _busy = false; }
  }

  setInterval(rosterTick, ROSTER_MS);

  /* Admin tab background me tha (document.hidden) to ticks skip hote hain —
     jab wapas foreground aaye, usi second refresh karo (6s wait na ho) */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { try { rosterTick(); listTick(); } catch (e) {} }
  });

  /* testing/manual ke liye handle */
  window.__qaFreshTick = rosterTick;

  /* list freshness — 15s safety poll (realtime matches-events ke saath idempotent) */
  var _listBusy = false;
  function listTick() {
    try {
      if (_listBusy || document.hidden) return;
      var sec = window.currentSection || '';
      if (sec !== 'tournaments' && sec !== 'matches' && sec !== 'dashboard') return;
      /* results section me list refresh mat karo — wahan admin kills/rank bhar
         raha hota hai aur list-rebuild se resultTournamentSelect reset ho jata hai */
      if (typeof window.loadTournaments !== 'function') return;
      _listBusy = true;
      Promise.resolve(window.loadTournaments(true)).then(function () { _listBusy = false; },
                                                        function () { _listBusy = false; });
    } catch (e) { _listBusy = false; }
  }
  setInterval(listTick, LIST_MS);

  /* ── IS SELECT ka asli bug-fix (WALK6G me pakda gaya) ──────────────────
     Realtime `matches` event par v22 channel `loadTournaments(true)` chalata
     hai, jo Results ka `#resultTournamentSelect` dobara fill karta hai aur
     uska selected match KHO jata hai (value ''). Uske baad results section
     kisi match ka roster hi nahi dikhata. Yahan hum refresh se pehle
     selection yaad rakhte hain aur turant wapas lagate hain (+ roster reload).
  */
  function installSelectKeeper() {
    if (typeof window.loadTournaments !== 'function' || window.loadTournaments._qaSelectKeeper) return false;
    var _orig = window.loadTournaments;
    var wrapped = function () {
      var sel = document.getElementById('resultTournamentSelect');
      var prev = sel ? sel.value : null;
      var r = _orig.apply(this, arguments);
      /* options async fill hote hain — isliye thoda retry karte hain */
      if (sel && prev) {
        (function restoreLeft(attempts) {
          setTimeout(function () {
            try {
              var os = sel.options || [], found = false;
              for (var i = 0; i < os.length; i++) { if (os[i].value === prev) { found = true; break; } }
              if (found) {
                if (sel.value !== prev) {
                  sel.value = prev;
                  if (window.currentSection === 'results' && typeof window.loadParticipants === 'function') {
                    setTimeout(function () { try { window.loadParticipants(); } catch (e) {} }, 60);
                  }
                }
              } else if (attempts > 0) {
                restoreLeft(attempts - 1);
              }
            } catch (e) {}
          }, 150);
        })(16);   /* ~2.4 s tak retry */
      }
      return r;
    };
    wrapped._qaSelectKeeper = true;
    window.loadTournaments = wrapped;
    return true;
  }
  if (!installSelectKeeper()) {
    var _ik = 0, _ikT = setInterval(function () { _ik++; if (_ik > 60 || installSelectKeeper()) clearInterval(_ikT); }, 250);
  }

  console.log('[QA-Freshness] roster 6s + list 15s fallback + select-keeper active (realtime join_requests RLS-blocked hai)');
})();
