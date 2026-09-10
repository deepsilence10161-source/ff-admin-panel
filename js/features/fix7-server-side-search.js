/* ============================================================
   FIX 7: SERVER-SIDE SEARCH (Admin Panel)
   - fa02-smart-search.js ka enhancement
   - 5000+ users ke liye: orderByChild().startAt().endAt() use karo
   - Client-side cache sirf small result sets ke liye
   ============================================================ */

(function() {
  'use strict';

  var CACHE_SIZE_THRESHOLD = 500;  // Isse zyada users → server-side search
  var _lastQuery = '', _lastFilter = 'all', _serverSearchTimeout = null;

  /* ── Server-side IGN search ── */
  function serverSearchByIgn(query, cb) {
    var q = query.toLowerCase().trim();
    db.ref('users')
      .orderByChild('ign')
      .startAt(q)
      .endAt(q + '\uf8ff')
      .limitToFirst(50)
      .once('value', function(s) {
        var results = [];
        if (s.exists()) s.forEach(function(c) { results.push(Object.assign({ _uid: c.key }, c.val())); });
        cb(results);
      });
  }

  /* ── Server-side FF UID search ── */
  function serverSearchByFfUid(query, cb) {
    var q = query.trim();
    db.ref('users')
      .orderByChild('ffUid')
      .startAt(q)
      .endAt(q + '\uf8ff')
      .limitToFirst(20)
      .once('value', function(s) {
        var results = [];
        if (s.exists()) s.forEach(function(c) { results.push(Object.assign({ _uid: c.key }, c.val())); });
        cb(results);
      });
  }

  /* ── Merge results (deduplicate by _uid) ── */
  function mergeResults(a, b) {
    var seen = {}, out = [];
    a.concat(b).forEach(function(u) {
      if (!seen[u._uid]) { seen[u._uid] = true; out.push(u); }
    });
    return out;
  }

  /* ── Apply filter (status/activity) ── */
  function applyFilter(users, filter) {
    if (filter === 'all') return users;
    return users.filter(function(u) {
      if (filter === 'banned')     return u.isBanned || u.blocked;
      if (filter === 'verified')   return !!u.profileVerified;
      if (filter === 'unverified') return !u.profileVerified;
      if (filter === 'active') {
        var ls = Number(u.lastSeen || u.lastLoginAt || 0);
        return Date.now() - ls <= 7 * 86400000;
      }
      return true;
    });
  }

  /* ── Main enhanced search ── */
  function enhancedSearchSmart(query, filter, cb) {
    query  = (query || '').trim();
    filter = filter || 'all';

    /* Decide: client or server? */
    var cacheSize = window.usersCache ? Object.keys(window.usersCache).length : 0;
    var useServer = cacheSize > CACHE_SIZE_THRESHOLD || !cacheSize;

    if (!query) {
      /* Empty query — show all from cache (server fetch would be too large) */
      if (window.usersCache) {
        var all = Object.keys(window.usersCache).map(function(uid) {
          return Object.assign({ _uid: uid }, window.usersCache[uid]);
        });
        return cb(applyFilter(all, filter));
      }
      return cb([]);
    }

    if (!useServer) {
      /* ─ CLIENT-SIDE (cache small enough) ─ */
      var q = query.toLowerCase();
      var results = Object.keys(window.usersCache).filter(function(uid) {
        var u = window.usersCache[uid]; if (!u) return false;
        return (u.ign||'').toLowerCase().includes(q) ||
               (u.ffUid||'').toLowerCase().includes(q) ||
               uid.toLowerCase().includes(q) ||
               (u.phone||'').includes(q) ||
               (u.displayName||'').toLowerCase().includes(q);
      }).map(function(uid) { return Object.assign({ _uid: uid }, window.usersCache[uid]); });
      return cb(applyFilter(results, filter));
    }

    /* ─ SERVER-SIDE ─ */
    /* Show loading indicator */
    var searchEl = document.getElementById('searchUser');
    if (searchEl) searchEl.style.opacity = '0.6';

    /* Run parallel searches by IGN + ffUid */
    var ignResults = [], ffResults = [], done = 0;

    function finish() {
      done++;
      if (done < 2) return;
      var merged = applyFilter(mergeResults(ignResults, ffResults), filter);
      if (searchEl) searchEl.style.opacity = '1';
      cb(merged);
    }

    serverSearchByIgn(query, function(r) { ignResults = r; finish(); });
    serverSearchByFfUid(query, function(r) { ffResults = r; finish(); });
  }

  /* ── Debounced hook into existing renderUsers ── */
  function hookRenderUsers() {
    var orig = window.renderUsers;
    if (!orig || window._fa07SearchHooked) return;
    window._fa07SearchHooked = true;

    window.renderUsers = function() {
      var searchEl = document.getElementById('searchUser');
      var query    = searchEl ? searchEl.value : '';
      var filter   = window._fa02ActiveFilter || 'all';

      /* Debounce */
      clearTimeout(_serverSearchTimeout);
      _serverSearchTimeout = setTimeout(function() {
        enhancedSearchSmart(query, filter, function(results) {
          /* Temporarily override usersCache with filtered results for orig render */
          var _origCache = window.usersCache;
          var tempCache = {};
          results.forEach(function(u) { tempCache[u._uid] = u; });
          window._fa07Results = results;
          window.usersCache = tempCache;
          orig.call(this);
          window.usersCache = _origCache;
        });
      }, query.length > 0 ? 400 : 0);
    };

    console.log('[FA07] renderUsers hooked for server-side search.');
  }

  /* ── Wait for page ready ── */
  var _hookInterval = setInterval(function() {
    if (window.renderUsers && window.db) {
      hookRenderUsers();
      clearInterval(_hookInterval);
    }
  }, 500);

  /* ── Index creation helper (run once in console to set up Firebase indexes) ── */
  window.fa07_createIndexes = function() {
    console.log('Add these indexes to Firebase Console → Database → Rules:');
    console.log(JSON.stringify({
      "users": {
        ".indexOn": ["ign", "ffUid", "phone", "lastSeen", "isBanned", "profileVerified"]
      }
    }, null, 2));
  };

  console.log('[Mini eSports] ✅ Fix 7: Server-Side Search loaded. Cache threshold:', CACHE_SIZE_THRESHOLD, 'users.');
})();
