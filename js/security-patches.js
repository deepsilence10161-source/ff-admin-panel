/* ================================================================
   MINI eSPORTS — ADMIN PANEL SECURITY PATCHES
   Fixes:
   1.  Per-action admin token re-verify (Issue #3)
   2.  approveWallet — screenshot required for deposits (Issue: Payment Proof)
   3.  deleteTournament — refund joined players first (Issue #7)
   4.  mrPublishResults — screenshot required warning (Issue #9)
   5.  executeBulkCreate — past startDate upfront warning (Issue #5)
   6.  User search — ffUid case-insensitive fix (Issue #8)
   7.  Duplicate rank — enforce all team members same rank (Issue #10)
   ================================================================ */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     HELPER: Re-verify current user is still admin
     Call before any destructive / financial action
     ──────────────────────────────────────────── */
  function reVerifyAdmin(cb) {
    var auth = window.auth || (window.firebase && window.firebase.auth());
    if (!auth) { cb(false); return; }
    var u = auth.currentUser;
    if (!u) { cb(false); return; }

    // Force token refresh to confirm session still valid
    u.getIdToken(true).then(function () {
      // Check RTDB admin record still exists
      var rtdb = window.rtdb;
      if (!rtdb) { cb(true); return; } // fallback: allow if no rtdb ref
      rtdb.ref('admins/' + u.uid).once('value', function (s) {
        if (s.exists()) { cb(true); return; }
        // Fallback: email whitelist
        if (u.email === 'admin@fft.com' || u.email === 'admin@fftapp.com') { cb(true); return; }
        // Try Firestore
        var db = window.db;
        if (db && db.collection) {
          db.collection('admins').doc(u.uid).get().then(function (fs) {
            cb(fs.exists);
          }).catch(function () { cb(false); });
        } else {
          cb(false);
        }
      });
    }).catch(function () { cb(false); });
  }

  function _toast(msg, type) {
    if (window.showToast) window.showToast(msg, type === 'err');
    else if (window._toast) window._toast(msg, type);
    else alert(msg);
  }

  /* ─────────────────────────────────────────────
     1. PATCH approveWallet
     Deposits ke liye screenshot mandatory
     ──────────────────────────────────────────── */
  function patchApproveWallet() {
    var orig = window.approveWallet;
    if (!orig || window._approveWalletPatched) return;
    window._approveWalletPatched = true;

    window.approveWallet = function (key, uid, amount, type) {
      var rtdb = window.rtdb;

      // Re-verify admin first
      reVerifyAdmin(function (ok) {
        if (!ok) { _toast('❌ Session expired — dobara login karo', 'err'); if (window.auth) window.auth.signOut(); return; }

        if (type === 'deposit' && rtdb) {
          // Check screenshot exists before approving
          rtdb.ref('walletRequests/' + key + '/screenshotBase64').once('value', function (s) {
            if (!s.exists() || !s.val()) {
              var force = confirm(
                '⚠️ Payment Proof (screenshot) missing hai!\n\n' +
                'User ne screenshot upload nahi kiya.\n\n' +
                'Kya aap bina proof ke ₹' + amount + ' approve karna chahte hain?\n\n' +
                'OK = Approve anyway (risky)\nCancel = Mat karo'
              );
              if (!force) return;
              // Log this override
              rtdb.ref('adminAlerts').push({
                type: 'proof_bypass',
                adminUid: (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : 'admin',
                walletKey: key,
                uid: uid,
                amount: amount,
                note: 'Deposit approved WITHOUT screenshot proof',
                timestamp: Date.now(),
                severity: 'HIGH'
              });
            }
            orig(key, uid, amount, type);
          });
        } else {
          orig(key, uid, amount, type);
        }
      });
    };
    console.log('[Security] ✅ approveWallet screenshot check patched');
  }

  /* ─────────────────────────────────────────────
     2. PATCH deleteTournament
     Joined players ko pehle refund karo
     ──────────────────────────────────────────── */
  function patchDeleteTournament() {
    var origDel = window.deleteTournament;
    if (!origDel || window._deleteTournamentPatched) return;
    window._deleteTournamentPatched = true;

    window.deleteTournament = function (id) {
      var rtdb = window.rtdb;
      var DB_MATCHES = window.DB_MATCHES || 'matches';
      var DB_JOIN = window.DB_JOIN || 'joinRequests';

      if (!rtdb) { origDel(id); return; }

      // Re-verify admin
      reVerifyAdmin(function (ok) {
        if (!ok) { _toast('❌ Session expired — dobara login karo', 'err'); return; }

        // Fetch match data + joined players
        rtdb.ref(DB_MATCHES + '/' + id).once('value', function (ms) {
          var match = ms.val();
          if (!match) { origDel(id); return; }

          var entryFee = Number(match.entryFee) || 0;
          var entryType = (match.entryType || '').toLowerCase();
          var isCoin = entryType === 'coin' || entryFee === 0;

          // Count joined players
          rtdb.ref(DB_JOIN).orderByChild('matchId').equalTo(id).once('value', function (js) {
            var joinedPlayers = [];
            if (js.exists()) {
              js.forEach(function (c) {
                var jr = c.val();
                if (jr.status !== 'rejected' && jr.status !== 'cancelled') {
                  joinedPlayers.push({ key: c.key, uid: jr.userId || jr.uid, amount: entryFee });
                }
              });
            }

            var matchName = match.name || id;
            var confirmMsg = joinedPlayers.length > 0
              ? '⚠️ "' + matchName + '" delete karna hai?\n\n' +
                joinedPlayers.length + ' players joined hain.\n' +
                (isCoin
                  ? 'Sabko entry fee coins wapas milenge.'
                  : entryFee > 0
                    ? 'Sabko ₹' + entryFee + ' entry fee refund milegi.'
                    : 'Entry fee 0 hai — koi refund nahi.') +
                '\n\nOK = Delete + Refund\nCancel = Ruk jao'
              : '⚠️ "' + matchName + '" delete karna hai?\n\nKoi joined player nahi — seedha delete ho jayega.\n\nConfirm?';

            if (!confirm(confirmMsg)) return;

            // Issue refunds
            var refundCount = 0;
            function doDelete() {
              origDel(id);
              if (refundCount > 0) _toast('✅ Deleted. ' + refundCount + ' refunds issue kiye.', 'ok');
            }

            if (!joinedPlayers.length || entryFee <= 0) {
              doDelete();
              return;
            }

            var done = 0;
            joinedPlayers.forEach(function (p) {
              if (!p.uid) { done++; if (done === joinedPlayers.length) doDelete(); return; }

              var refundPath = isCoin
                ? 'users/' + p.uid + '/coins'
                : 'users/' + p.uid + '/realMoney/deposited';

              rtdb.ref(refundPath).transaction(function (v) {
                return (v || 0) + p.amount;
              }, function () {
                // Log refund transaction
                rtdb.ref('users/' + p.uid + '/transactions').push({
                  type: 'refund',
                  amount: p.amount,
                  description: 'Match cancelled refund — ' + matchName,
                  timestamp: Date.now()
                });
                rtdb.ref('users/' + p.uid + '/notifications').push({
                  title: '💰 Match Cancelled — Refund',
                  message: '"' + matchName + '" cancel hua. ₹' + p.amount + ' wapas mil gaye.',
                  type: 'refund',
                  read: false,
                  timestamp: Date.now()
                });
                // Cancel join request
                rtdb.ref(DB_JOIN + '/' + p.key).update({ status: 'cancelled', cancelReason: 'match_deleted', cancelledAt: Date.now() });
                refundCount++;
                done++;
                if (done === joinedPlayers.length) doDelete();
              });
            });
          });
        });
      });
    };
    console.log('[Security] ✅ deleteTournament refund patch applied');
  }

  /* ─────────────────────────────────────────────
     3. PATCH mrPublishResults
     Screenshot required warning + duo/squad rank sync
     ──────────────────────────────────────────── */
  function patchPublishResults() {
    var orig = window.mrPublishResults;
    if (!orig || window._publishPatched) return;
    window._publishPatched = true;

    window.mrPublishResults = async function () {
      // Re-verify admin
      var adminOk = await new Promise(function (res) { reVerifyAdmin(res); });
      if (!adminOk) { _toast('❌ Session expired — dobara login karo', 'err'); return; }

      // Screenshot check
      var screenshots = window._mrScreenshots || [];
      if (screenshots.length === 0) {
        var proceed = confirm(
          '📸 Screenshot upload nahi kiya!\n\n' +
          'Result screenshot proof ke bina publish karna risky hai.\n\n' +
          'OK = Bina screenshot ke publish karo\nCancel = Screenshot pehle lo'
        );
        if (!proceed) return;
        // Log this
        var rtdb = window.rtdb;
        if (rtdb && window.auth && window.auth.currentUser) {
          var mid = (document.getElementById('mrMatchFilter') || {}).value || '';
          rtdb.ref('adminAlerts').push({
            type: 'result_no_screenshot',
            adminUid: window.auth.currentUser.uid,
            matchId: mid,
            note: 'Results published WITHOUT screenshot proof',
            timestamp: Date.now(),
            severity: 'MEDIUM'
          });
        }
      }

      // Duo/Squad rank consistency check
      // All members of same team must have same rank
      var rows = document.querySelectorAll('#mrPlayerTable tr[data-uid]');
      var teamRanks = {};
      var rankMismatch = false;
      rows.forEach(function (row) {
        var rank = Number(row.querySelector('.mr-rank-input').value) || 0;
        if (!rank) return;
        var slotEl = row.querySelector('td:nth-child(4) span');
        var slot = slotEl ? slotEl.textContent.trim() : '';
        if (slot && slot.indexOf('/') > -1) {
          var teamId = slot.split('/')[0];
          if (teamRanks[teamId] === undefined) {
            teamRanks[teamId] = rank;
          } else if (teamRanks[teamId] !== rank) {
            rankMismatch = true;
          }
        }
      });
      if (rankMismatch) {
        _toast('⚠️ Ek team ke members ke rank alag-alag hain! Sab ko same rank do.', 'err');
        return;
      }

      // Auto-fill: if captain has rank, apply same to all team members
      var teamRankMap = {};
      rows.forEach(function (row) {
        var rankInp = row.querySelector('.mr-rank-input');
        var rank = Number(rankInp.value) || 0;
        if (!rank) return;
        var slotEl = row.querySelector('td:nth-child(4) span');
        var slot = slotEl ? slotEl.textContent.trim() : '';
        if (slot && slot.indexOf('/') > -1) {
          var teamId = slot.split('/')[0];
          teamRankMap[teamId] = rank;
        }
      });
      // Now fill missing members
      rows.forEach(function (row) {
        var rankInp = row.querySelector('.mr-rank-input');
        var rank = Number(rankInp.value) || 0;
        if (rank) return; // already filled
        var slotEl = row.querySelector('td:nth-child(4) span');
        var slot = slotEl ? slotEl.textContent.trim() : '';
        if (slot && slot.indexOf('/') > -1) {
          var teamId = slot.split('/')[0];
          if (teamRankMap[teamId]) {
            rankInp.value = teamRankMap[teamId];
            rankInp.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      });

      // Call original
      return orig.apply(this, arguments);
    };
    console.log('[Security] ✅ mrPublishResults patched (screenshot check + duo rank sync)');
  }

  /* ─────────────────────────────────────────────
     4. PATCH executeBulkCreate
     Past startDate pe upfront warning
     ──────────────────────────────────────────── */
  function patchBulkCreate() {
    var orig = window.executeBulkCreate;
    if (!orig || window._bulkCreatePatched) return;
    window._bulkCreatePatched = true;

    window.executeBulkCreate = async function () {
      var startDateVal = (document.getElementById('bulkStartDate') || {}).value;
      if (startDateVal) {
        var sd = new Date(startDateVal);
        // Check if the date itself is in the past (not just time)
        var today = new Date(); today.setHours(0, 0, 0, 0);
        if (sd < today) {
          var proceed = confirm(
            '⚠️ Start date pehle ka hai (' + sd.toLocaleDateString('en-IN') + ')!\n\n' +
            'Past dates ke matches create honge jo kabhi start nahi honge.\n\n' +
            'Aaj ki date se start karo?\nOK = Continue anyway\nCancel = Date fix karo'
          );
          if (!proceed) return;
        }
      }

      // Re-verify admin
      var adminOk = await new Promise(function (res) { reVerifyAdmin(res); });
      if (!adminOk) { _toast('❌ Session expired — dobara login karo', 'err'); return; }

      return orig.apply(this, arguments);
    };
    console.log('[Security] ✅ executeBulkCreate past date warning patched');
  }

  /* ─────────────────────────────────────────────
     5. PATCH _searchUsers — ffUid case-insensitive
     ffUid is typically numeric but future-proof with
     lowercase compare for name/email/uid fields
     ──────────────────────────────────────────── */
  function patchUserSearch() {
    var orig = window._searchUsers;
    if (!orig || window._searchUsersPatched) return;
    window._searchUsersPatched = true;

    window._searchUsers = function () {
      var qEl = document.getElementById('userSearchQ') || {};
      var raw = (qEl.value || '').trim();
      var q = raw.toLowerCase();
      var res = document.getElementById('userSearchResults');
      if (!res) return;
      if (q.length < 2) { res.innerHTML = '<p class="text-muted text-xxs">Type at least 2 characters</p>'; return; }
      res.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i></div>';

      var rtdb = window.rtdb;
      if (!rtdb) { orig && orig(); return; }

      rtdb.ref('users').once('value', function (s) {
        var matches = [];
        s.forEach(function (c) {
          var u = c.val(), uid = c.key;
          var ignL = (u.ign || '').toLowerCase();
          var emailL = (u.email || '').toLowerCase();
          var ffUidL = (u.ffUid || '').toLowerCase();
          var uidL = uid.toLowerCase();
          var phoneL = (u.phone || '').toLowerCase();

          if (ignL.includes(q) || emailL.includes(q) || ffUidL.includes(q) || uidL.includes(q) || phoneL.includes(q)) {
            matches.push(Object.assign({}, u, { _uid: uid }));
          }
        });
        if (!matches.length) { res.innerHTML = '<p class="text-muted text-xxs">No users found for "' + raw + '"</p>'; return; }
        var h = '<div style="display:flex;flex-direction:column;gap:6px">';
        matches.slice(0, 10).forEach(function (u) {
          h += '<div style="padding:10px 12px;border-radius:10px;background:var(--bg-card);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
          h += '<div>';
          h += '<div style="font-weight:700;font-size:13px">' + (u.ign || u.displayName || 'User') + '</div>';
          h += '<div class="text-xxs text-muted">' + (u.email || '') + ' · ' + (u.ffUid || '') + ' · ' + (u.profileStatus || 'unknown') + '</div>';
          h += '</div>';
          h += '<button class="btn btn-ghost btn-xs" onclick="window.openUserModal && openUserModal(\'' + u._uid + '\')"><i class="fas fa-eye"></i></button>';
          h += '</div>';
        });
        h += '</div>';
        res.innerHTML = h;
      });
    };
    console.log('[Security] ✅ User search case-insensitive patch applied');
  }

  /* ─────────────────────────────────────────────
     APPLY ALL PATCHES
     Wait for window functions to be defined
     ──────────────────────────────────────────── */
  function applyAll() {
    patchApproveWallet();
    patchDeleteTournament();
    patchPublishResults();
    patchBulkCreate();
    patchUserSearch();
    console.log('[Mini eSports] ✅ Admin Security Patches fully applied');
  }

  // Some functions are defined after DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(applyAll, 500);
    });
  } else {
    setTimeout(applyAll, 500);
  }

})();
