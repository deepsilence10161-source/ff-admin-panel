/**
 * supabase-init-early.js
 * Supabase client ko jaldi initialize karo — BEFORE admin-inline.js
 * Taki bridge install hone se pehle _supa available ho
 *
 * ✅ FIX (Audit C1): Pehle yeh client SIRF anon key se banta tha — kabhi
 * authenticate nahi hota tha, isliye Postgres mein auth.uid() hamesha NULL
 * rehta tha aur har admin-only RLS policy "permission denied" deti thi.
 * Ab window.syncFirebaseToken(firebaseUser) login ke baad call hota hai
 * (admin-inline.js se) jo Firebase ID token leke client ko Authorization:
 * Bearer header ke saath RECREATE karta hai — Dev Guide Section 8 ke
 * exact pattern follow karke.
 */
(function () {
  'use strict';

  var SUPA_URL = 'https://hddhkculuyrfoevxmlwy.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkZGhrY3VsdXlyZm9ldnhtbHd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NTQ1MTgsImV4cCI6MjA5NDAzMDUxOH0.2hhDGez1fVFjS5ljSU3tSOEJuusLmQpERjcrh45T7po';

  window._SUPA_URL = SUPA_URL;
  window._SUPA_KEY = SUPA_KEY;

  function tryInit() {
    if (window._supa) return; /* Already initialized by someone else */
    if (window.supabase && window.supabase.createClient) {
      window._supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);
      console.log('%c[SupaEarlyInit] ✅ window._supa ready (anon — pre-login)', 'color:#00d4ff;font-weight:700');
      /* Fire event so bridge and other scripts know _supa is ready */
      document.dispatchEvent(new Event('supabase:ready'));
    } else {
      setTimeout(tryInit, 100);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     syncFirebaseToken(firebaseUser)
     Dev Guide Section 8 — AUTH FLOW:
       1. user.getIdToken(true) → fresh JWT
       2. Supabase client RECREATED with Authorization: Bearer <jwt>
       3. Supabase validates via Firebase JWKS (Third-Party Auth)
       4. auth.uid() in Postgres = Firebase UID ✅
     Called once right after login, then again every time Firebase
     auto-refreshes the ID token (~hourly) via onIdTokenChanged.
  ───────────────────────────────────────────────────────────────── */
  window.syncFirebaseToken = async function (firebaseUser) {
    if (!firebaseUser || !window.supabase || !window.supabase.createClient) return null;
    try {
      var idToken = await firebaseUser.getIdToken(true);
      window._supa = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
        global: { headers: { Authorization: 'Bearer ' + idToken } }
      });
      console.log('%c[SupaAuth] ✅ Supabase client authenticated as Firebase UID ' + firebaseUser.uid, 'color:#00ff9c;font-weight:700');
      document.dispatchEvent(new Event('supabase:authenticated'));
      return window._supa;
    } catch (e) {
      console.error('[SupaAuth] ❌ Failed to sync Firebase token to Supabase:', e);
      return null;
    }
  };

  /* Dev Guide ke documented namespace ke saath bhi expose karo:
     await DB.auth.syncFirebaseToken(firebaseUser) */
  window.DB = window.DB || {};
  window.DB.auth = window.DB.auth || {};
  window.DB.auth.syncFirebaseToken = window.syncFirebaseToken;

  tryInit();

  /* ═══════════════════════════════════════════════════════════════════
     ✅ FIX (Audit M2 + confirmed real bug): getDB/getSupa/getAuth/
     getAdminUid/escH/patchWhenReady pehle 6 alag files mein IIFE-LOCAL
     'function X(){}' declarations ke roop mein the — matlab woh sirf
     apne hi IIFE ke andar visible the, GLOBAL nahi the jaisa lagta tha.
     Real browser test se confirm hua: "Live Attendance" nav click karne
     par "getDB is not defined" crash hota tha, kyunki window._loadAttSection
     (fa-admin-v10-final.js ke us IIFE ke BAHAR define hua tha jahan getDB
     declared thi) ko getDB() bilkul nahi milta tha.
     Ab yeh TRUE GLOBAL hain (window.X = window.X || ...) — pehla jo bhi
     file load hoti hai woh set kar deti hai, baaki files ki apni local
     copies harmless redundant rehti hain (unke apne IIFE ke andar wahi
     kaam karti hain) lekin ab koi bhi file/scope getDB() ko bare call
     karke bhi safely access kar sakti hai. */
  window.getDB = window.getDB || function () {
    return window.rtdb || window.adminDb || window.db || null;
  };
  window.getSupa = window.getSupa || function () {
    return window._supa || null;
  };
  window.getAuth = window.getAuth || function () {
    return window.auth || null;
  };
  window.getAdminUid = window.getAdminUid || function () {
    var a = window.getAuth();
    return (a && a.currentUser) ? a.currentUser.uid : 'admin';
  };
  window.escH = window.escH || function (s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  window.patchWhenReady = window.patchWhenReady || function (name, patcher, delay) {
    delay = delay || 700;
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (typeof window[name] !== 'undefined') { clearInterval(iv); patcher(); }
      if (attempts > 60) {
        clearInterval(iv);
        console.warn('[patchWhenReady] Could not patch:', name);
      }
    }, delay);
  };

  /* ✅ FIX (Audit follow-up — season-history): User Panel ke screens/rank.js
     mein calcRkScore/calcRk already define hain (live rank display ke liye).
     Admin panel ke paas iska apna koi copy nahi tha — season-end archival
     (fa68_checkSeasonReset, endCurrentSeason) ya to ek phantom field
     ('stats/rankPoints' jo kabhi exist hi nahi karta) use kar rahe the ya
     bilkul alag formula. Yahi EXACT formula yahan bhi rakha hai taaki
     season-end pe jo tier/points calculate ho, woh user ko app mein
     pure season mein jo dikhta raha (rank.js se) usi se consistent rahe. */
  window.calcRkScore = window.calcRkScore || function (stats) {
    stats = stats || {};
    var wins = Number(stats.wins || 0), kills = Number(stats.kills || 0),
        matches = Number(stats.matches || 0), streak = Number(stats.winStreak || 0);
    return wins * 40 + kills * 2 + matches * 1 + streak * 10;
  };
  window.calcRk = window.calcRk || function (stats) {
    var s = window.calcRkScore(stats);
    if (s >= 5000) return { badge: 'Grandmaster', emoji: '🌟', pts: s };
    if (s >= 3500) return { badge: 'Heroic',      emoji: '⚔️', pts: s };
    if (s >= 2000) return { badge: 'Legend',      emoji: '👑', pts: s };
    if (s >= 1501) return { badge: 'Diamond',     emoji: '💎', pts: s };
    if (s >= 1001) return { badge: 'Platinum',    emoji: '🔷', pts: s };
    if (s >= 601)  return { badge: 'Gold',        emoji: '🥇', pts: s };
    if (s >= 301)  return { badge: 'Silver',      emoji: '🥈', pts: s };
    return           { badge: 'Bronze',       emoji: '🏅', pts: s };
  };

  /* ✅ FIX (Audit follow-up — season-history): position-based season-end
     reward — seasonal-league.js (User Panel) ke "🏆 Season End Rewards"
     list se exactly match karta hai, taaki jo promise user ko dikhta hai
     woh hi reward archive ho. */
  window.calcSeasonReward = window.calcSeasonReward || function (position) {
    if (!position || position < 1) return null;
    if (position === 1)  return { badge: 'Grandmaster Badge', reward: '🌟 Grandmaster Badge + 500🪙', emoji: '🌟' };
    if (position <= 5)   return { badge: 'Legend Badge',      reward: '👑 Legend Badge + 200🪙',      emoji: '👑' };
    if (position <= 20)  return { badge: 'Diamond Badge',     reward: '💎 Diamond Badge + 100🪙',     emoji: '💎' };
    if (position <= 100) return { badge: 'Gold Badge',        reward: '🥇 Gold Badge + 50🪙',         emoji: '🥇' };
    return null;
  };
})();
