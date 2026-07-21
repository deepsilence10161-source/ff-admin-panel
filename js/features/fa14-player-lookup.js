/* ADMIN FEATURE A14: Instant Player Lookup
   FF UID / phone / IGN se instant player card — ban, send coins, view history.
   FIX: usersCache use karta hai — poora DB download nahi karta */
(function(){
'use strict';

window.fa14PlayerLookup = function() {
  var h = '<div>'
    + '<div class="form-group"><label>Search (FF UID / Phone / IGN)</label>'
    + '<input id="pl_q" class="form-input" placeholder="Enter FF UID, phone or IGN..." oninput="fa14Search()"></div>'
    + '<div id="pl_result"></div></div>';
  showAdminModal('🔍 Player Lookup', h);
};

window.fa14Search = function() {
  var q = ((document.getElementById('pl_q') || {}).value || '').trim().toLowerCase();
  var out = document.getElementById('pl_result');
  if (!out || q.length < 3) { if (out) out.innerHTML = ''; return; }

  // Use usersCache first (already loaded, instant)
  var cache = window.usersCache || {};
  var found = null, fk = '';

  Object.keys(cache).forEach(function(uid) {
    if (found) return;
    var d = cache[uid] || {};
    if ((d.ffUid || '').toLowerCase() === q ||
        (d.phone || '').includes(q) ||
        (d.ign || '').toLowerCase().includes(q) ||
        uid.toLowerCase().includes(q)) {
      found = d; fk = uid;
    }
  });

  if (found) {
    _renderResult(fk, found);
    return;
  }

  // Cache miss — fallback to Firebase fetch
  out.innerHTML = '<div style="text-align:center;color:#aaa;padding:10px"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
  rtdb.ref('users').once('value').then(function(s) {
    s.forEach(function(c) {
      if (found) return;
      var d = c.val() || {};
      if ((d.ffUid || '').toLowerCase() === q ||
          (d.phone || '').includes(q) ||
          (d.ign || '').toLowerCase().includes(q)) {
        found = d; fk = c.key;
      }
    });
    if (!found) {
      out.innerHTML = '<div style="text-align:center;color:#ff4444;padding:10px">No user found</div>';
    } else {
      _renderResult(fk, found);
    }
  }).catch(function(e) {
    out.innerHTML = '<div style="color:#ff4444;padding:10px">Error: ' + e.message + '</div>';
  });
};

function _renderResult(fk, found) {
  var out = document.getElementById('pl_result');
  if (!out) return;
  var dep = ((found.wallet || {}).depositBalance) || ((found.realMoney || {}).deposited) || 0;
  var win = ((found.wallet || {}).winningBalance) || ((found.realMoney || {}).winnings) || 0;
  var coins = found.coins || 0;
  var matches = (found.stats || {}).matches || 0;
  var kills = (found.stats || {}).kills || 0;
  var banned = found.isBanned || found.blocked || found.banned;

  out.innerHTML = '<div style="background:rgba(0,255,156,.06);border:1px solid rgba(0,255,156,.15);border-radius:12px;padding:14px">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'
    + '<div>'
    + '<div style="font-size:15px;font-weight:700">' + (found.ign || 'Unknown') + ' '
    + (found.profileVerified ? '<span style="font-size:11px;color:#00ff9c">✅ Verified</span>' : '')
    + (banned ? ' <span style="font-size:11px;color:#ff4444">🚫 Banned</span>' : '')
    + '</div>'
    + '<div style="font-size:11px;color:#aaa">UID: ' + fk + '</div>'
    + '<div style="font-size:11px;color:#00d4ff;font-family:monospace">FF: ' + (found.ffUid || '—') + '</div>'
    + '</div>'
    + '<div style="text-align:right;font-size:11px;color:#aaa">'
    + (found.phone || '') + '</div>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">'
    + '<div style="background:rgba(0,255,156,.08);border-radius:8px;padding:8px;text-align:center"><div style="font-size:10px;color:#aaa">Deposit</div><div style="font-weight:700;color:#00ff9c">₹' + dep + '</div></div>'
    + '<div style="background:rgba(255,215,0,.08);border-radius:8px;padding:8px;text-align:center"><div style="font-size:10px;color:#aaa">Winnings</div><div style="font-weight:700;color:#ffd700">₹' + win + '</div></div>'
    + '<div style="background:rgba(255,215,0,.06);border-radius:8px;padding:8px;text-align:center"><div style="font-size:10px;color:#aaa">Coins</div><div style="font-weight:700">🪙' + coins + '</div></div>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;font-size:11px;color:#aaa">'
    + '<span>🎮 ' + matches + ' matches</span><span>💀 ' + kills + ' kills</span>'
    + '</div>'
    + '<div style="display:flex;gap:6px">'
    + (banned
      ? '<button onclick="fa14Unban(\'' + fk + '\')" style="flex:1;padding:8px;border-radius:8px;background:#00ff9c;color:#000;font-weight:700;border:none;cursor:pointer;font-size:12px">✅ Unban</button>'
      : '<button onclick="fa14Ban(\'' + fk + '\')" style="flex:1;padding:8px;border-radius:8px;background:#ff4444;color:#fff;font-weight:700;border:none;cursor:pointer;font-size:12px">🚫 Ban</button>'
    )
    + '<button onclick="fa14GiveCoins(\'' + fk + '\')" style="flex:1;padding:8px;border-radius:8px;background:#ffd700;color:#000;font-weight:700;border:none;cursor:pointer;font-size:12px">🪙 Give Coins</button>'
    + '<button onclick="window.openUserModal&&openUserModal(\'' + fk + '\')" style="padding:8px 12px;border-radius:8px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-weight:700;cursor:pointer;font-size:12px">👁️</button>'
    + '</div></div>';
}

window.fa14Ban = async function(uid) {
  var r = prompt('Ban reason:'); if (!r) return;
  await rtdb.ref('users/' + uid).update({ isBanned: true, blocked: true, banReason: r, bannedAt: Date.now() });
  await rtdb.ref('users/' + uid + '/notifications').push({ title: '🚫 Account Banned', message: 'Reason: ' + r, type: 'system', timestamp: Date.now(), read: false });
  if (window.usersCache && window.usersCache[uid]) { window.usersCache[uid].isBanned = true; window.usersCache[uid].blocked = true; }
  showToast('🚫 Banned!'); fa14Search();
};

window.fa14Unban = async function(uid) {
  await rtdb.ref('users/' + uid).update({ isBanned: false, blocked: false, banReason: null, bannedAt: null });
  if (window.usersCache && window.usersCache[uid]) { window.usersCache[uid].isBanned = false; window.usersCache[uid].blocked = false; }
  showToast('✅ Unbanned!'); fa14Search();
};

window.fa14GiveCoins = async function(uid) {
  var amt = Number(prompt('Coins amount:')); if (!amt || amt <= 0) return;
  await rtdb.ref('users/' + uid + '/coins').transaction(function(c) { return (c || 0) + amt; });
  await rtdb.ref('users/' + uid + '/notifications').push({ title: '🪙 Coins Received!', message: amt + ' coins admin ne diye!', type: 'cashback', timestamp: Date.now(), read: false });
  if (window.usersCache && window.usersCache[uid]) window.usersCache[uid].coins = (window.usersCache[uid].coins || 0) + amt;
  showToast('🪙 ' + amt + ' coins given!'); fa14Search();
};

})();
