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
      if (restoreSelectionIfWiped()) { /* dropdown khali kar diya gaya tha — bahal + roster reload */ }
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
  /* ── IS SELECT ka asli bug (WALK6G/6H me pakda gaya) ──────────────────
     Realtime `matches` event v22 channel se `loadTournaments(true)` chalata
     hai, jo Results dropdown ko dobara bharta hai aur admin ka chuna hua
     match KHO jata hai (value ''). Uske baad roster kisi match ka load hi
     nahi hota — admin purani/khali list dekhta rehta hai.

     Hal: admin ki chuni hui match yaad rakho (sirf asli user 'change' se,
     programmatic reset se nahi) aur agar dropdown khali ho jaye to wapas
     laga do + roster reload karo. */
  var _resultMid = null;

  function selOpts() {
    var s = document.getElementById('resultTournamentSelect');
    return (s && s.options) ? s.options : [];
  }
  function optionExists(mid) {
    var os = selOpts();
    for (var i = 0; i < os.length; i++) if (os[i].value === mid) return true;
    return false;
  }
  /* user ka asli selection yaad rakho (programmatic value-set change event nahi bhagata) */
  document.addEventListener('change', function (ev) {
    try {
      var t = ev.target;
      if (t && t.id === 'resultTournamentSelect') _resultMid = t.value || null;
    } catch (e) {}
  }, true);
  /* pehle se koi match selected hai to yaad rakho */
  (function seed() {
    var s = document.getElementById('resultTournamentSelect');
    if (s && s.value) _resultMid = s.value;
    else setTimeout(seed, 1000);
  })();

  function restoreSelectionIfWiped() {
    try {
      if (window.currentSection !== 'results' || !_resultMid) return false;
      var s = document.getElementById('resultTournamentSelect');
      if (!s || s.value === _resultMid || !optionExists(_resultMid)) return false;
      s.value = _resultMid;
      if (typeof window.loadParticipants === 'function') window.loadParticipants();
      return true;
    } catch (e) { return false; }
  }

  /* loadTournaments ke foran baad bhi check (options async bharte hain) */
  function installSelectKeeper() {
    if (typeof window.loadTournaments !== 'function' || window.loadTournaments._qaSelectKeeper) return false;
    var _orig = window.loadTournaments;
    var wrapped = function () {
      var r = _orig.apply(this, arguments);
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (restoreSelectionIfWiped() || tries > 20 || !_resultMid) clearInterval(iv);
      }, 150);
      return r;
    };
    wrapped._qaSelectKeeper = true;
    window.loadTournaments = wrapped;
    return true;
  }
  if (!installSelectKeeper()) {
    var _ik = 0, _ikT = setInterval(function () { _ik++; if (_ik > 60 || installSelectKeeper()) clearInterval(_ikT); }, 250);
  }

  /* ── INSTANT path: live_join_events (public-read mirror table) ───────────
     `join_requests` khud RLS-protected hai (jr_select_own), isliye uske
     postgres_changes events admin ke socket tak nahi aate (live-proven —
     socket anon reh jata hai kyunki auth Firebase se hoti hai).
     Isliye DB me ek trigger `live_join_events` (chhoti, public-read, sirf
     match_id + filled_slots — koi personal data nahi) me mirror likhta hai,
     aur us table ke events anon socket ko TURANT milte hain (live-proven:
     lag ~0.36s). Yahi asli instant path hai; 6s poll sirf safety-net rehta hai.
  */
  var _lastLiveRefresh = 0;
  var _liveClientRef = null;

  function subscribeLiveJoins() {
    if (!window._supa || typeof window._supa.channel !== 'function') return false;
    if (window._qaJoinLive && window._supa === _liveClientRef) return true;
    try {
      _liveClientRef = window._supa;
      window._qaJoinLive = true;
      window._supa.channel('qa_live_joins_' + Math.floor(Date.now() / 1000))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_join_events' }, function (payload) {
          try {
            var row = (payload && payload.new) || {};
            var mid = String(row.match_id || '');
            var now = Date.now();
            if (!mid) return;
            /* Universal <0.3s Pulse for RLS-protected tables (users, coin_requests, support_tickets, etc.) */
            if (mid.indexOf('pulse:') === 0) {
              var tbl = mid.slice(6);
              if (typeof window._bridgePulseTable === 'function') {
                window._bridgePulseTable(tbl);
              }
              return;
            }
            if (typeof window._bridgePulseTable === 'function') {
              window._bridgePulseTable('join_requests');
              window._bridgePulseTable('matches');
            }
            if (now - _lastLiveRefresh < 1200) return;
            var sel = document.getElementById('resultTournamentSelect');
            if (window.currentSection === 'results' && sel && String(sel.value) === String(mid)) {
              _lastLiveRefresh = now;
              if (rosterHasEdits()) {
                if (typeof window.showToast === 'function') {
                  window.showToast('🔄 Naya join aaya (ab ' + (row.filled_slots != null ? row.filled_slots : '?') + ' slots bhare). Values save karke Refresh karo.', 'inf');
                }
              } else if (typeof window.loadParticipants === 'function') {
                window.loadParticipants();
                console.log('[QA-Freshness] live event → roster refresh (' + String(mid).slice(0, 8) + ')');
              }
            }
          } catch (e) {}
        })
        .subscribe(function (status) { console.log('[QA-Freshness] live_join_events channel:', status); });
      return true;
    } catch (e) { window._qaJoinLive = false; return false; }
  }

  if (!subscribeLiveJoins()) {
    var _lsN = 0, _lsT = setInterval(function () { _lsN++; if (_lsN > 240 || subscribeLiveJoins()) clearInterval(_lsT); }, 500);
  }
  /* token sync ke baad _supa naya client ban sakta hai — naye client par dobara subscribe */
  window.addEventListener('supabase:authenticated', function () { setTimeout(subscribeLiveJoins, 400); });
  setInterval(subscribeLiveJoins, 5000);

  console.log('[QA-Freshness] INSTANT live_join_events + roster 6s safety poll + list 15s + select-keeper active');
})();
