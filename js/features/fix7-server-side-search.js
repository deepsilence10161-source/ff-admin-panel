/* ============================================================
   FIX 7: SERVER-SIDE SEARCH (Admin Panel)
   - Users tab me wo users bhi milen jo local cache (500) me nahi hain
   - Backend: SUPABASE (pehle ye Firebase RTDB par jata tha — par admin
     panel Supabase par migrate ho chuka hai, isliye wo search KHAALI
     lautta tha; Users tab me 500 se zyada users par kuch bhi na milta)

   ✅ B1 FIX (2026-10-06): poori file saaf ki gayi.
   Pehle ye file window.renderUsers ko OVERRIDE karti thi (fa02 ke saath
   mil kar TEEN parat ban jati thi) aur apne alag filter naam
   ('unverified', 'active') istemal karti thi — isliye All/Verified/
   Pending/Banned tabs kaam nahi karte the aur search ke waqt filter
   bekaar ho jata tha.
   Ab: koi renderUsers hook NAHI. Sirf ek saaf function:
       window._fa07ServerSearch(query, cb)  →  Supabase se seedha search
   Jise EK hi renderer (admin-inline-b.js ka renderUsers) tab bulata hai
   jab local cache me query ka koi natija na mile — isliye search aur
   filter dono hamesha saath lagte hain.
   ============================================================ */

(function() {
  'use strict';

  var _fa07Busy = false;   /* ek waqt me ek hi server search (spam rok) */

  /* Supabase se seedha search — IGN, FF UID, phone, ya UID se.
     Nateeja wahi shakl me lauta hai jo renderUsers samajhta hai
     (_fa02/_fa07 dono ek hi renderer use karte hain). */
  function serverSearch(query, cb) {
    query = (query || '').trim();
    cb = cb || function() {};
    if (!query || !window._supa) { cb([]); return; }
    if (_fa07Busy) { cb([]); return; }

    /* SQL-injection se bachne ke liye % _ \ \ ko escape karo (PostgREST filter) */
    var like = '%' + query.replace(/([\\%_])/g, '\\$1') + '%';
    _fa07Busy = true;

    window._supa.from('users')
      .select('*')
      .or('ign.ilike.' + like + ',ff_uid.ilike.' + like + ',phone.ilike.' + like + ',id.ilike.' + like)
      .eq('is_deleted', false)
      .limit(50)
      .then(function(r) {
        _fa07Busy = false;
        if (r.error) { console.warn('[FA07] server search fail:', r.error.message); cb([]); return; }
        var mapper = window._supaUserToFirebase || function(u) { return u; };
        var out = (r.data || []).map(function(u) {
          var m = mapper(u) || {};
          m._uid = u.id;
          m._fromServer = true;
          return m;
        });
        cb(out);
      }, function(e) {
        _fa07Busy = false;
        console.warn('[FA07] server search error:', e && e.message);
        cb([]);
      });
  }

  window._fa07ServerSearch = serverSearch;

  /* Admin ke liye: bade users table par search tez rakhne ke liye
     ye indexes ek baar Supabase me bana do (idempotent, safe). */
  window.fa07_indexSql = function() {
    return [
      'create index if not exists idx_users_ign_lower  on public.users (lower(ign));',
      'create index if not exists idx_users_ffuid       on public.users (ff_uid);',
      'create index if not exists idx_users_phone       on public.users (phone);'
    ].join('\n');
  };

  console.log('[Mini eSports] ✅ Fix 7: Server-side search ready (Supabase)');
})();
