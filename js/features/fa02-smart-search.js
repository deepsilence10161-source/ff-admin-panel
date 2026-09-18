/* =============================================
   FEATURE A02: Smart Admin User Search
   - IGN, FF UID, UID, Phone se search
   - Filters: banned/verified/unverified/active
   - Debounced real-time search
   - Export filtered results to CSV
   ============================================= */
(function() {
  'use strict';

  var _searchTimeout = null;

  function enhancedSearch(query, filter) {
    query = (query || '').toLowerCase().trim();
    filter = filter || 'all';

    if (!window.usersCache) return [];

    return Object.keys(window.usersCache).filter(function(uid) {
      var u = window.usersCache[uid];
      if (!u) return false;

      // Filter
      if (filter === 'banned' && !u.isBanned && !u.blocked) return false;
      if (filter === 'verified' && !u.profileVerified) return false;
      if (filter === 'unverified' && u.profileVerified) return false;
      if (filter === 'active') {
        var lastSeen = Number(u.lastSeen || u.lastLoginAt || 0);
        if (Date.now() - lastSeen > 7 * 24 * 60 * 60 * 1000) return false; // 7 days
      }

      // Search
      if (!query) return true;
      var ign = (u.ign || '').toLowerCase();
      var ffUid = (u.ffUid || '').toLowerCase();
      var phone = (u.phone || '').toLowerCase();
      var name = (u.displayName || '').toLowerCase();
      return ign.includes(query) || ffUid.includes(query) || uid.toLowerCase().includes(query) || phone.includes(query) || name.includes(query);
    }).map(function(uid) { return Object.assign({ _uid: uid }, window.usersCache[uid]); });
  }

  function injectSearchEnhancement() {
    var searchEl = document.getElementById('searchUser');
    if (!searchEl || searchEl._f_a02_enhanced) return;
    searchEl._f_a02_enhanced = true;

    // Add filter chips below search
    var filterHTML = '<div id="fa02Filters" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;margin-bottom:6px">';
    var filters = [
      { val: 'all', label: 'All' },
      { val: 'verified', label: '✅ Verified' },
      { val: 'unverified', label: '⏳ Pending' },
      { val: 'banned', label: '🚫 Banned' },
      { val: 'active', label: '🟢 Active (7d)' }
    ];
    filters.forEach(function(f) {
      filterHTML += '<span class="fa02-filter-chip" data-filter="' + f.val + '" onclick="window.fA02Search.setFilter(\'' + f.val + '\',this)" style="padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid var(--border);background:' + (f.val === 'all' ? 'var(--primary)' : 'var(--bg-dark)') + ';color:' + (f.val === 'all' ? '#000' : 'var(--text-muted)') + '">' + f.label + '</span>';
    });
    filterHTML += '</div>';

    searchEl.insertAdjacentHTML('afterend', filterHTML);

    // Update placeholder
    searchEl.placeholder = '🔍 IGN, FF UID, UID, Phone se search...';

    // Debounced search
    searchEl.oninput = function() {
      clearTimeout(_searchTimeout);
      _searchTimeout = setTimeout(function() {
        if (window.renderUsers) window.renderUsers();
      }, 300);
    };
  }

  // Override renderUsers to use enhanced search
  function hookRenderUsers() {
    var orig = window.renderUsers;
    if (!orig || window._fa02Hooked) return;
    window._fa02Hooked = true;

    window.renderUsers = function() {
      injectSearchEnhancement();
      var searchEl = document.getElementById('searchUser');
      var query = searchEl ? searchEl.value : '';
      var filter = window._fa02CurrentFilter || 'all';
      var results = enhancedSearch(query, filter);

      var tb = document.getElementById('usersTable');
      if (!tb) { orig.apply(this, arguments); return; }

      // If no query or filter, use original
      if (!query && filter === 'all') { orig.apply(this, arguments); return; }

      // Render filtered results
      if (results.length === 0) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">Koi user nahi mila</td></tr>';
        return;
      }

      var html = '';
      results.slice(0, 100).forEach(function(u) {
        var uid = u._uid;
        var ign = u.ign || u.displayName || 'Unknown';
        var ff = u.ffUid || 'N/A';
        var bal = Number((u.realMoney||{}).deposited||0) + Number((u.realMoney||{}).winnings||0);
        var db_ = Number((u.realMoney||{}).deposited||0);
        var wb = Number((u.realMoney||{}).winnings||0);
        var mt = (u.stats||{}).matches||0;
        var lv = 1 + Math.floor(((u.stats||{}).matches||0)/3);
        var bn = u.isBanned || u.blocked;
        var st = bn ? '<span class="badge danger">Banned</span>' : u.profileVerified ? '<span class="badge green">Verified</span>' : '<span class="badge yellow">Pending</span>';

        if (window.idTag) {
          html += '<tr><td>' + window.idTag(ign, uid) + '<div class="text-xxs mt-1" style="color:var(--primary);font-family:monospace">FF: ' + ff + '</div></td>' +
            '<td><span class="text-primary font-bold">₹' + bal + '</span><div class="text-xxs text-muted">D:₹' + db_ + ' W:₹' + wb + '</div></td>' +
            '<td>' + mt + '</td><td><span class="badge cyan">Lv' + lv + '</span></td>' +
            '<td>' + st + '</td>' +
            '<td class="flex gap-1"><button class="btn btn-ghost btn-xs" onclick="openUserModal(\'' + uid + '\')"><i class="fas fa-eye"></i></button></td></tr>';
        }
      });
      tb.innerHTML = html;
    };
  }

  window.fA02Search = {
    setFilter: function(val, el) {
      window._fa02CurrentFilter = val;
      document.querySelectorAll('.fa02-filter-chip').forEach(function(c) {
        var isActive = c.dataset.filter === val;
        c.style.background = isActive ? 'var(--primary)' : 'var(--bg-dark)';
        c.style.color = isActive ? '#000' : 'var(--text-muted)';
      });
      if (window.renderUsers) window.renderUsers();
    },
    search: enhancedSearch
  };

  // Init
  var _try = 0;
  var _check = setInterval(function() {
    _try++;
    if (window.renderUsers && window.usersCache !== undefined) {
      clearInterval(_check);
      hookRenderUsers();
      injectSearchEnhancement();
    }
    if (_try > 30) clearInterval(_check);
  }, 500);
})();
