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

  /* list freshness — 15s safety poll (realtime matches-events ke saath idempotent) */
  var _listBusy = false;
  setInterval(function () {
    try {
      if (_listBusy || document.hidden) return;
      var sec = window.currentSection || '';
      if (sec !== 'tournaments' && sec !== 'matches' && sec !== 'dashboard') return;
      if (typeof window.loadTournaments !== 'function') return;
      _listBusy = true;
      Promise.resolve(window.loadTournaments(true)).then(function () { _listBusy = false; },
                                                        function () { _listBusy = false; });
    } catch (e) { _listBusy = false; }
  }, LIST_MS);

  console.log('[QA-Freshness] roster 6s + list 15s fallback active (realtime join_requests RLS-blocked hai)');
})();
