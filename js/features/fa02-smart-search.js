/* =============================================
   FEATURE A02: Smart Admin User Search
   - IGN, FF UID, UID, Phone, Name se search (yahi is file ka असली kamaal)

   ✅ B1 FIX (2026-10-06) — poori file saaf ki gayi:
   Pehle ye file window.renderUsers ko OVERRIDE karti thi aur apni alag
   filter-chip bar + apni alag table rows (sirf 6 column) banati thi.
   Nateeja (live me dekha gaya):
     • Users table ka header (10 column) aur rows (6 column) ka mel nahi hota tha
     • filter chips DO jagah dikhti thi (ek is file se, ek index.html se)
     • search karne par All/Verified/Pending/Banned filter bekaar ho jata tha
       (fa02 ka apna renderer filter ko nazarandaz karta tha)
     • 'Active (7d)' chip chupke se rows gira deti thi
   Ab EK hi renderer hai (admin-inline-b.js ka renderUsers) aur EK hi filter
   bar (index.html ke Users section me, Matches ke filter-tabs jaisi).
   Ye file sirf apna behtar search deti hai — window._fa02EnhancedSearch —
   jise wahi ek renderer use karta hai, isliye search (phone/name samet) aur
   filter DONO saath lagte hain aur columns hamesha melte hain.
   ============================================= */
(function() {
  'use strict';

  /* IGN / FF UID / UID / Phone / Name — sabse search karta hai.
     Chhota query (< 2 akshar) par khali array nahi lauta — caller basic
     matcher chala sakta hai. */
  function enhancedSearch(query) {
    query = (query || '').toLowerCase().trim();
    if (!window.usersCache) return [];
    return Object.keys(window.usersCache).filter(function(uid) {
      var u = window.usersCache[uid];
      if (!u) return false;
      if (!query) return true;
      var ign = (u.ign || '').toLowerCase();
      var ffUid = (u.ffUid || '').toLowerCase();
      var phone = (u.phone || '').toLowerCase();
      var name = (u.displayName || '').toLowerCase();
      return ign.indexOf(query) >= 0 || ffUid.indexOf(query) >= 0 ||
             uid.toLowerCase().indexOf(query) >= 0 || phone.indexOf(query) >= 0 ||
             name.indexOf(query) >= 0;
    }).map(function(uid) { return Object.assign({ _uid: uid }, window.usersCache[uid]); });
  }

  /* Sirf search — koi hook nahi, koi chip bar nahi, koi render override nahi.
     (Purana code yahan window.renderUsers ko badal deta tha aur
      window.fA02Search.setFilter banata tha — dono hata diye, kyunki naye
      filter tabs seedhe renderUsers() ko bulate hain.) */
  window._fa02EnhancedSearch = enhancedSearch;
  window.fA02Search = { search: enhancedSearch };

  console.log('[fa02] Smart user search ready (single renderer — B1 fix)');
})();
