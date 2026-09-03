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

    /* Issue #9 Fix: Check Supabase user_roles table first (authoritative),
       then Firebase admins/ as fallback. Supabase roles survive Firebase clears. */
    u.getIdToken(true).then(function () {
      var supa = window._supa;
      if (supa) {
        supa.from('user_roles').select('role').eq('user_id', u.uid).single()
          .then(function(r) {
            if (r.data && (r.data.role === 'admin' || r.data.role === 'super_admin')) {
              cb(true); return;
            }
            // Not found in Supabase — check Firebase fallback
            _checkFirebaseAdmin(u, cb);
          })
          .catch(function() { _checkFirebaseAdmin(u, cb); });
      } else {
        _checkFirebaseAdmin(u, cb);
      }
    }).catch(function () { cb(false); });
  }

  function _checkFirebaseAdmin(u, cb) {
    var rtdb = window.rtdb;
    if (!rtdb) {
      // Last resort: email whitelist
      if (u.email === 'admin@fft.com' || u.email === 'admin@fftapp.com') { cb(true); return; }
      cb(false); return;
    }
    /* Check RTDB admins (bridge → Supabase admins table) */
    rtdb.ref('admins/' + u.uid).once('value', function (s) {
      if (s.exists()) { cb(true); return; }
      if (u.email === 'admin@fft.com' || u.email === 'admin@fftapp.com') { cb(true); return; }
      /* Supabase admins table direct check as final fallback */
      var supa = window._supa;
      if (supa) {
        supa.from('admins').select('uid').eq('uid', u.uid).maybeSingle()
          .then(function(r) { cb(!!(r && r.data)); })
          .catch(function() { cb(false); });
      } else { cb(false); }
    });
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
                adminUid: (window.auth && window.auth.currentUser) ? window._adminUid() : 'admin',
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

    /* ✅ FIX (2026-08-21, CRITICAL — money bug): the old version tried to
       refund via rtdb.ref('users/'+uid+'/coins').transaction(...) and
       rtdb.ref('users/'+uid+'/realMoney/deposited').transaction(...) —
       neither path nor column exists in the real Supabase schema
       (users.coins / users.sky_diamonds are the real columns, and the
       bridge's .transaction() talks to Supabase, not a Firebase-style
       nested realMoney.deposited object). Every "refund" here was
       silently writing to a path that went nowhere — no error, no
       refund, money just vanished when a match was deleted. This now
       calls the atomic cancel_match_with_refunds() RPC which reads the
       real entry_fee_paid per join_request and credits the correct
       users.coins / users.sky_diamonds column inside one transaction,
       so there's no race condition and no silent no-op. */
    window.deleteTournament = function (id) {
      var supa = (window._supa || (window.getSupa && window.getSupa()));
      if (!supa) { origDel(id); return; }

      reVerifyAdmin(function (ok) {
        if (!ok) { _toast('❌ Session expired — dobara login karo', 'err'); return; }

        supa.from('matches').select('*').eq('id', id).single().then(function (ms) {
          var match = ms.data;
          if (!match) { origDel(id); return; }

          supa.from('join_requests')
            .select('id', { count: 'exact', head: true })
            .eq('match_id', id)
            .not('status', 'in', '(cancelled,refunded,rejected)')
            .then(function (jc) {
              var joinedCount = jc.count || 0;
              var matchName = match.name || match.title || id;
              var entryFee = Number(match.entry_fee) || 0;

              var confirmMsg = joinedCount > 0
                ? '⚠️ "' + matchName + '" delete karna hai?\n\n' +
                  joinedCount + ' players joined hain.\n' +
                  (entryFee > 0
                    ? 'Sabko entry fee (jo unhone actually pay ki thi) wapas milegi.'
                    : 'Entry fee 0 hai — koi refund nahi.') +
                  '\n\nOK = Delete + Refund\nCancel = Ruk jao'
                : '⚠️ "' + matchName + '" delete karna hai?\n\nKoi joined player nahi — seedha delete ho jayega.\n\nConfirm?';

              if (!confirm(confirmMsg)) return;

              supa.rpc('cancel_match_with_refunds', {
                p_match_id: id,
                p_admin_uid: (window._adminUid ? window._adminUid() : null)
              }).then(function (res) {
                var data = res.data;
                if (!data || data.ok !== true) {
                  _toast('❌ Refund/cancel failed: ' + ((data && data.error) || (res.error && res.error.message) || 'unknown error'), 'err');
                  return;
                }
                /* Clean up the Firebase-only side (room chat, live listeners etc.)
                   via the original delete path, but Supabase matches row is
                   already marked cancelled by the RPC — origDel's own Supabase
                   delete (if any) will just no-op on a missing/renamed row. */
                origDel(id);
                var rc = data.refund_count || 0;
                _toast('✅ Match cancelled. ' + rc + ' refund' + (rc === 1 ? '' : 's') + ' issue kiye.', 'ok');
              }).catch(function (e) {
                _toast('❌ Refund/cancel error: ' + e.message, 'err');
              });
            });
        });
      });
    };
    console.log('[Security] ✅ deleteTournament refund patch applied (RPC-based, schema-correct)');
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
            adminUid: window._adminUid(),
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
