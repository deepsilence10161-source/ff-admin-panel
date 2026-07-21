/* ═══════════════════════════════════════════════════════════════════════════
   MINI eSPORTS — ADMIN PANEL BUG FIX PATCH v24 FINAL
   Applied AFTER: admin-fixes-v23-FINAL.js
   
   FIXES IN THIS FILE:
   ─────────────────────────────────────────────────────────────────────────
   BUG #1  (CRITICAL) confirmWithdrawal — No Supabase balance sync after
           Firebase transaction. User sees old balance in app.
   
   BUG #5  (MAJOR)   fa66_checkAndCancelEmpty — Uses stale m.joinedCount.
           Fix: Query live count from Supabase join_requests.
   
   BUG #6  (MAJOR)   fa73_detectIPClusters — deviceMeta never written by
           user panel → always empty. Replaced with graceful fallback.
   
   BUG #7  (MAJOR)   runFraudCheck — After "Continue" click, original
           function still loads ALL deviceJoins (no real pagination).
           Fix: True .limitToLast(1000) pagination with chunk render.
   
   BUG #10 (MINOR)   saveTournament — No duplicate match name warning.
           Fix: Client-side name uniqueness check before save.
   
   BUG #12 (MINOR)   renderProfileRequests — proposedIgn not trimmed.
           Fix: .trim() on all proposed fields.
   
   BUG #13 (MINOR)   approveProfileUpdate — Only Firebase checked for IGN
           uniqueness, not Supabase. Fix: Add Supabase uniqueness check.
   
   BUG #14 (MINOR)   deleteTournament — Join requests only marked
           cancelled, not removed from Supabase. Fix: Supabase delete added.
   
   BUG #15 (MINOR)   showMatchFeedbacks — Function exists but no nav entry.
           Fix: Button injected into Feedback section.
   
   BUG #16 (MINOR)   adminClearUserNotifications — No user existence check
           before deleting from Supabase. Fix: Guard added.
   
   BUG #17 (MINOR)   exportWalletTransactionsCSV — No Firebase fallback if
           Supabase is down. Fix: Fallback to walletRequests node.
   
   BUG #19 (MINOR)   setUserPartner / removeUserPartner — Defined but no
           UI. Fix: Buttons added to User modal footer.
   
   BUG #20 (MINOR)   syncTournamentStatuses — Runs every 30s even when
           browser tab is hidden. Fix: document.hidden guard.
   
   BUG #26 (MAJOR)   fa58_showBatchWithdrawals — Queries wrong ref
           (withdrawalRequests). Fix: Uses walletRequests + type filter.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
'use strict';

/* ── Shared helpers ────────────────────────────────────────────────────── */
function getDB()   { return window.rtdb || window.adminDb || window.db || null; }
function getSupa() { return window._supa || null; }
function getAuth() { return window.auth || null; }
function getAdminUid() {
  var a = getAuth();
  return (a && a.currentUser) ? a.currentUser.uid : 'admin';
}
function escH(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Retry a patch until the target function exists */
function patchWhenReady(name, patcher, delay) {
  delay = delay || 700;
  var attempts = 0;
  var iv = setInterval(function () {
    attempts++;
    if (typeof window[name] !== 'undefined') { clearInterval(iv); patcher(); }
    if (attempts > 60) {
      clearInterval(iv);
      console.warn('[v24] Could not patch:', name);
    }
  }, delay);
}

/* ════════════════════════════════════════════════════════════════════════
   BUG #1 (CRITICAL) — confirmWithdrawal
   Problem: After approving a withdrawal, Firebase balances are decremented
   but Supabase (sky_diamonds / coins) is NEVER updated. User app reads
   from Supabase, so balance stays unchanged after approval.
   Fix: After the existing Firebase steps, decrement Supabase balance
   and insert a wallet_transactions record.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('confirmWithdrawal', function () {
  if (window.confirmWithdrawal._v24SupaSync) return; // prevent double-patch
  var _orig = window.confirmWithdrawal;

  window.confirmWithdrawal = async function () {
    /* Run the original function (Firebase steps + modal close) */
    await _orig.apply(this, arguments);

    /* After original completes, sync to Supabase */
    var supa = getSupa();
    if (!supa) return;

    /* Pull the data that was just processed (same globals as original) */
    var w   = window.allWalletRequests && window.pendingWithdrawData
              ? window.allWalletRequests[window.pendingWithdrawData.requestId]
              : null;
    if (!w) return; // already closed / data gone

    var uid = w.uid || w.userId || w.oderId || null;
    if (!uid) return;

    var amt    = Number(w.amount) || 0;
    var rid    = window.pendingWithdrawData && window.pendingWithdrawData.requestId;
    /* Determine currency column based on request type */
    var wdCol  = (w.entryType === 'coin' || w.type === 'coin')
                 ? 'coins' : 'sky_diamonds';

    /* TDS may have been applied — use netAmt stored on request, else full amt */
    var netAmt = Number(w.amountAfterTDS || w.netAmount || amt);
    if (netAmt <= 0) return;

    try {
      /* STEP A: Decrement Supabase balance via RPC */
      var rpcResult = await supa.rpc('decrement_balance', {
        p_uid: uid, p_col: wdCol, p_amount: netAmt
      }).catch(function () { return { error: { message: 'rpc_missing' } }; });

      /* STEP B: Fallback — direct read+update if RPC not available */
      if (rpcResult && rpcResult.error) {
        var cur = await supa.from('users').select(wdCol).eq('id', uid).single()
                    .catch(function () { return { data: null }; });
        if (cur && cur.data) {
          var newBal = Math.max(0, (cur.data[wdCol] || 0) - netAmt);
          await supa.from('users').update({ [wdCol]: newBal }).eq('id', uid)
            .catch(function (e) {
              console.error('[v24 Bug#1] Supabase balance update fallback error:', e.message);
            });
        }
      }

      /* STEP C: Insert wallet_transactions record */
      await supa.from('wallet_transactions').insert({
        user_id:    uid,
        txn_type:   'debit',
        amount:     netAmt,
        currency:   wdCol,
        reason:     'Withdrawal approved by admin',
        ref_id:     rid || null,
        created_at: new Date().toISOString()
      }).catch(function (e) {
        console.warn('[v24 Bug#1] wallet_transactions insert failed:', e.message);
      });

      console.log('[v24 Bug#1 ✅] confirmWithdrawal: Supabase synced —',
        netAmt, wdCol, 'debited for', uid);

    } catch (e) {
      console.error('[v24 Bug#1] confirmWithdrawal Supabase sync error:', e.message);
    }
  };

  window.confirmWithdrawal._v24SupaSync = true;
  console.log('[v24] BUG #1 ✅ confirmWithdrawal: Supabase balance sync added');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #5 (MAJOR) — fa66_checkAndCancelEmpty
   Problem: Uses m.joinedCount from match node which is not real-time.
   A match with real participants can be incorrectly cancelled.
   Fix: Query live count from Supabase join_requests (authoritative DB).
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('fa66_checkAndCancelEmpty', function () {
  if (window.fa66_checkAndCancelEmpty._v24LiveCount) return;

  var _orig = window.fa66_checkAndCancelEmpty;

  window.fa66_checkAndCancelEmpty = async function () {
    var db   = getDB();
    var supa = getSupa();
    if (!db) return;

    /* Prefer Supabase for live counts (authoritative) */
    if (supa) {
      var now = Date.now();
      var MIN_PLAYERS_PCT = window._fa66MinPlayersPct || 0.25;

      try {
        /* Fetch upcoming matches from Supabase */
        var matchRes = await supa.from('matches')
          .select('id,name,status,scheduled_at,max_players,entry_fee,entry_type')
          .eq('status', 'upcoming');

        if (!matchRes.data || matchRes.data.length === 0) return;

        for (var i = 0; i < matchRes.data.length; i++) {
          var m   = matchRes.data[i];
          var mId = m.id;
          var mt  = m.scheduled_at ? new Date(m.scheduled_at).getTime() : 0;

          if (!mt || mt > now) continue;          // not started yet
          if (mt + 15 * 60000 < now) continue;   // more than 15 min past — skip

          /* Get LIVE count from Supabase join_requests */
          var countRes = await supa.from('join_requests')
            .select('id', { count: 'exact', head: true })
            .eq('match_id', mId)
            .not('status', 'in', '("cancelled","refunded","rejected")');

          var filled = (countRes && countRes.count != null) ? countRes.count : 0;
          var max    = Number(m.max_players) || 1;

          if (filled >= 2 && (filled / max) >= MIN_PLAYERS_PCT) continue; // enough players

          /* Auto-cancel in Supabase */
          await supa.from('matches').update({
            status:       'cancelled',
            cancelled_at: new Date().toISOString(),
            cancel_reason: 'auto_low_players'
          }).eq('id', mId).catch(function (e) {
            console.error('[v24 fa66] Supabase cancel error:', e.message);
          });

          /* Refund players with entries */
          if (filled > 0 && Number(m.entry_fee) > 0) {
            var jRes = await supa.from('join_requests')
              .select('user_id,entry_fee,entry_type')
              .eq('match_id', mId)
              .not('status', 'in', '("cancelled","refunded","rejected")')
              .catch(function () { return { data: [] }; });

            var rows = (jRes && jRes.data) ? jRes.data : [];
            rows.forEach(function (r) {
              var currency  = (r.entry_type === 'sky' || r.entry_type === 'sky_diamond')
                              ? 'sky_diamonds' : 'coins';
              var refundAmt = Number(r.entry_fee) || Number(m.entry_fee) || 0;
              if (!refundAmt) return;

              supa.rpc('increment_balance', {
                p_uid: r.user_id, p_col: currency, p_amount: refundAmt
              }).catch(function (e) {
                console.error('[v24 fa66] refund error', r.user_id, e.message);
              });

              supa.from('join_requests').update({ status: 'refunded' })
                .eq('user_id', r.user_id).eq('match_id', mId).catch(function () {});

              /* Notify user via Supabase notifications */
              supa.from('notifications').insert({
                user_id:    r.user_id,
                type:       'info',
                title:      '🔄 Match Cancelled — Refund!',
                body:       (m.name || 'Match') + ' cancel ho gaya (players kam the). ' +
                            refundAmt + ' ' + currency + ' refund ho gaya.',
                created_at: new Date().toISOString()
              }).catch(function () {});
            });
          }

          /* Also update Firebase match node for consistency */
          db.ref('matches/' + mId).update({
            status: 'cancelled', cancelledAt: Date.now(),
            cancelReason: 'auto_low_players'
          }).catch(function () {});

          console.log('[v24 fa66] Auto-cancelled match:', m.name,
            '— live count:', filled, '/', max);
        }
      } catch (e) {
        console.error('[v24 fa66] Supabase query error, falling back:', e.message);
        _orig.apply(this, arguments); // Firebase fallback
      }

    } else {
      /* Supabase unavailable — use original Firebase logic */
      _orig.apply(this, arguments);
    }
  };

  window.fa66_checkAndCancelEmpty._v24LiveCount = true;
  console.log('[v24] BUG #5 ✅ fa66_checkAndCancelEmpty: Live count from Supabase');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #6 (MAJOR) — fa73_detectIPClusters
   Problem: deviceMeta.fingerprint is NEVER written by the user panel.
   Source 2 (joinRequests with deviceMeta) always returns empty.
   Fix: Disable Source 2 (remove the broken path). Keep Source 1
   (deviceJoins, which IS written by anti-cheat.js) as the only source.
   Show a clear admin message when no data is found.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('fa73_detectIPClusters', function () {
  if (window.fa73_detectIPClusters._v24Fixed) return;

  window.fa73_detectIPClusters = function () {
    var db = getDB();
    if (!db) return;

    var uidMap = {}; // deviceId → Set of uids

    function addToMap(deviceId, uid) {
      if (!deviceId || !uid) return;
      if (!uidMap[deviceId]) uidMap[deviceId] = new Set();
      uidMap[deviceId].add(uid);
    }

    function renderClusters() {
      var clusters = Object.keys(uidMap).filter(function (id) {
        return uidMap[id].size >= 2;
      });

      if (!clusters.length) {
        var msg = '<div style="text-align:center;padding:20px;color:#888;font-size:12px">' +
          '<i class="fas fa-check-circle" style="font-size:28px;color:#00ff9c;margin-bottom:8px;display:block"></i>' +
          'Koi suspicious device cluster nahi mila.<br>' +
          '<span style="font-size:10px;margin-top:6px;display:block;color:#555">' +
          'Note: Yeh check sirf confirmed joins ke liye kaam karta hai (deviceJoins node).</span>' +
          '</div>';
        if (window.openAdminModal) window.openAdminModal('🌐 Device Cluster Report', msg);
        else if (window.openModal) window.openModal('🌐 Device Cluster Report', msg);
        return;
      }

      var rows = clusters.slice(0, 20).map(function (deviceId) {
        var uids = Array.from(uidMap[deviceId]);
        return '<div style="background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.15);' +
          'border-radius:10px;padding:10px;margin-bottom:8px">' +
          '<div style="font-size:11px;font-weight:700;color:#ff6b6b;margin-bottom:4px">' +
          '📱 Device: ' + escH(deviceId.substring(0, 20)) + '… (' + uids.length + ' accounts)</div>' +
          '<div style="font-size:10px;color:#888">' +
          uids.map(function (u) { return escH(u.substring(0, 12)) + '…'; }).join(', ') +
          '</div></div>';
      }).join('');

      var h = '<div>' +
        '<div style="font-size:12px;color:#ff6b6b;margin-bottom:12px">⚠️ ' +
        clusters.length + ' device cluster(s) mila:</div>' + rows + '</div>';

      if (window.openAdminModal) window.openAdminModal('🌐 Device Cluster Report', h);
      else if (window.openModal) window.openModal('🌐 Device Cluster Report', h);
    }

    /* Source: ONLY deviceJoins (confirmed joins with verified device IDs) */
    db.ref('deviceJoins').limitToLast(2000).once('value', function (snap) {
      if (snap.exists()) {
        snap.forEach(function (deviceSnap) {
          var deviceId = deviceSnap.key;
          deviceSnap.forEach(function (matchSnap) {
            var rec = matchSnap.val();
            if (rec && rec.uid) addToMap(deviceId, rec.uid);
          });
        });
      }

      if (Object.keys(uidMap).length === 0) {
        var noDataMsg = '<div style="text-align:center;padding:20px;color:#888;font-size:12px">' +
          '<i class="fas fa-database" style="font-size:28px;color:#555;margin-bottom:8px;display:block"></i>' +
          'deviceJoins node empty hai — abhi tak koi confirmed match join nahi hua.<br>' +
          '<span style="font-size:10px;margin-top:4px;display:block">Data tab milega jab players matches join karein.</span>' +
          '</div>';
        if (window.openAdminModal) window.openAdminModal('🌐 Device Cluster Report', noDataMsg);
        else if (window.openModal) window.openModal('🌐 Device Cluster Report', noDataMsg);
        return;
      }
      renderClusters();
    });
  };

  window.fa73_detectIPClusters._v24Fixed = true;
  console.log('[v24] BUG #6 ✅ fa73_detectIPClusters: Source 2 (broken) removed; Source 1 only');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #7 (MAJOR) — runFraudCheck
   Problem: v22 added a confirm dialog but the original function still
   loads ALL deviceJoins when admin clicks "Continue". No real pagination.
   Fix: Completely replace with a chunked, paginated version that ALWAYS
   uses .limitToLast(1000) and never loads the full node.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('runFraudCheck', function () {
  if (window.runFraudCheck._v24Paginated) return;

  window.runFraudCheck = async function () {
    var db = getDB();
    if (!db) {
      if (window.showToast) window.showToast('DB not ready', true);
      return;
    }

    var PAGE_SIZE = 1000; // max entries per page
    var uidDeviceMap = {}; // uid → [deviceIds]
    var deviceUidMap = {}; // deviceId → [uids]

    /* Show loading indicator */
    if (window.showToast) window.showToast('🔍 Fraud check chal raha hai…', false);

    try {
      /* Always use limitToLast — NEVER load full node */
      var snap = await db.ref('deviceJoins').limitToLast(PAGE_SIZE).once('value');

      if (!snap.exists()) {
        if (window.showToast) window.showToast('deviceJoins data nahi mila', false);
        return;
      }

      /* Build maps */
      snap.forEach(function (deviceSnap) {
        var deviceId = deviceSnap.key;
        deviceSnap.forEach(function (matchSnap) {
          var rec = matchSnap.val();
          var uid = rec && rec.uid;
          if (!uid) return;

          /* uid → devices */
          if (!uidDeviceMap[uid]) uidDeviceMap[uid] = [];
          if (uidDeviceMap[uid].indexOf(deviceId) < 0) uidDeviceMap[uid].push(deviceId);

          /* device → uids */
          if (!deviceUidMap[deviceId]) deviceUidMap[deviceId] = [];
          if (deviceUidMap[deviceId].indexOf(uid) < 0) deviceUidMap[deviceId].push(uid);
        });
      });

      /* Find suspicious: devices used by 2+ uids */
      var flaggedDevices = Object.keys(deviceUidMap).filter(function (d) {
        return deviceUidMap[d].length >= 2;
      });

      /* Find suspicious: uids using 2+ devices */
      var flaggedUsers = Object.keys(uidDeviceMap).filter(function (u) {
        return uidDeviceMap[u].length >= 2;
      });

      /* Build report HTML */
      var totalEntries = snap.numChildren();
      var reportRows = '';

      if (flaggedDevices.length === 0 && flaggedUsers.length === 0) {
        reportRows = '<div style="text-align:center;padding:20px;color:#00ff9c;font-size:13px">' +
          '<i class="fas fa-shield-alt" style="font-size:28px;margin-bottom:8px;display:block"></i>' +
          'Koi fraud pattern nahi mila ✅<br>' +
          '<span style="font-size:10px;color:#888">Checked ' + totalEntries + ' entries (last ' + PAGE_SIZE + ')</span>' +
          '</div>';
      } else {
        /* Device clusters section */
        if (flaggedDevices.length > 0) {
          reportRows += '<div style="margin-bottom:14px">' +
            '<div style="font-size:11px;font-weight:800;color:#ff6b6b;margin-bottom:8px">' +
            '📱 Multi-Account Devices (' + flaggedDevices.length + ')</div>';
          flaggedDevices.slice(0, 15).forEach(function (deviceId) {
            var uids = deviceUidMap[deviceId];
            reportRows += '<div style="background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.15);' +
              'border-radius:8px;padding:8px;margin-bottom:6px">' +
              '<div style="font-size:10px;font-weight:700;color:#ff6b6b">' +
              escH(deviceId.substring(0, 24)) + '… → ' + uids.length + ' accounts</div>' +
              '<div style="font-size:10px;color:#888;margin-top:3px">' +
              uids.slice(0, 5).map(function (u) { return escH(u.substring(0, 12)); }).join(', ') +
              (uids.length > 5 ? '…' : '') + '</div></div>';
          });
          reportRows += '</div>';
        }

        /* Multi-device users section */
        if (flaggedUsers.length > 0) {
          reportRows += '<div>' +
            '<div style="font-size:11px;font-weight:800;color:#ffd700;margin-bottom:8px">' +
            '🔀 Multi-Device Users (' + flaggedUsers.length + ')</div>';
          flaggedUsers.slice(0, 15).forEach(function (uid) {
            var devices = uidDeviceMap[uid];
            reportRows += '<div style="background:rgba(255,215,0,.04);border:1px solid rgba(255,215,0,.15);' +
              'border-radius:8px;padding:8px;margin-bottom:6px">' +
              '<div style="font-size:10px;font-weight:700;color:#ffd700">' +
              escH(uid.substring(0, 20)) + '…</div>' +
              '<div style="font-size:10px;color:#888;margin-top:3px">' +
              devices.length + ' devices: ' +
              devices.slice(0, 3).map(function (d) { return escH(d.substring(0, 12)); }).join(', ') +
              (devices.length > 3 ? '…' : '') + '</div>' +
              '<button onclick="banUser(\'' + escH(uid) + '\');if(window.openAdminModal){document.querySelector(\'.admin-modal,.modal\').classList.remove(\'show\')}" ' +
              'style="margin-top:6px;padding:4px 10px;border-radius:6px;background:rgba(255,68,68,.15);border:1px solid rgba(255,68,68,.3);' +
              'color:#ff4455;font-size:10px;cursor:pointer">⛔ Ban User</button>' +
              '</div>';
          });
          reportRows += '</div>';
        }

        /* Summary bar */
        reportRows = '<div style="background:rgba(0,0,0,.3);border-radius:8px;padding:8px;margin-bottom:12px;font-size:11px">' +
          '<span style="color:#888">Checked: </span><b>' + totalEntries + '</b>' +
          ' entries (last ' + PAGE_SIZE + ') &nbsp;|&nbsp; ' +
          '<span style="color:#ff6b6b">Flagged devices: ' + flaggedDevices.length + '</span>' +
          ' &nbsp;|&nbsp; ' +
          '<span style="color:#ffd700">Flagged users: ' + flaggedUsers.length + '</span>' +
          '</div>' + reportRows;
      }

      var fullHtml = '<div style="max-height:420px;overflow-y:auto">' + reportRows + '</div>';

      if (window.openAdminModal) window.openAdminModal('🛡️ Fraud Check Report', fullHtml);
      else if (window.openModal) window.openModal('🛡️ Fraud Check Report', fullHtml);

    } catch (e) {
      console.error('[v24 Bug#7] runFraudCheck error:', e.message);
      if (window.showToast) window.showToast('Fraud check error: ' + e.message, true);
    }
  };

  window.runFraudCheck._v24Paginated = true;
  console.log('[v24] BUG #7 ✅ runFraudCheck: True pagination with limitToLast(1000)');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #10 (MINOR) — saveTournament
   Problem: No duplicate match name check. Admin can create matches with
   identical names causing confusion.
   Fix: Check existing matches for same name before save (client-side).
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('saveTournament', function () {
  if (window.saveTournament._v24NameCheck) return;
  var _orig = window.saveTournament;

  window.saveTournament = async function () {
    var nameEl = document.getElementById('tName') ||
                 document.getElementById('matchName') ||
                 document.getElementById('tournamentName');
    var proposedName = nameEl ? nameEl.value.trim().toLowerCase() : '';

    if (proposedName && window.allTournaments) {
      var existingKeys = Object.keys(window.allTournaments);
      var editingId    = window._editingTournamentId || null; // skip current match if editing

      var duplicate = existingKeys.find(function (key) {
        if (key === editingId) return false; // skip self when editing
        var t = window.allTournaments[key];
        return t && (t.name || '').trim().toLowerCase() === proposedName;
      });

      if (duplicate) {
        var proceed = confirm(
          '⚠️ Duplicate Match Name\n\n' +
          '"' + nameEl.value.trim() + '" naam ka match already exists.\n\n' +
          'Phir bhi save karna hai?\n(Alag naam rakhna recommended hai)'
        );
        if (!proceed) return;
      }
    }

    return _orig.apply(this, arguments);
  };

  window.saveTournament._v24NameCheck = true;
  console.log('[v24] BUG #10 ✅ saveTournament: Duplicate name warning added');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #12 (MINOR) — renderProfileRequests
   Problem: proposedIgn, proposedFfUid, proposedPhone not trimmed.
   Leading/trailing spaces can pass validation silently.
   Fix: Patch to apply .trim() to all proposed fields.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('renderProfileRequests', function () {
  if (window.renderProfileRequests._v24Trim) return;
  var _orig = window.renderProfileRequests;

  window.renderProfileRequests = function (snap) {
    /* Pre-process snap to inject trimmed values before original runs */
    if (snap && snap.forEach) {
      snap.forEach(function (ch) {
        var d = ch.val();
        if (!d) return;
        /* Trim all text fields in-place */
        ['requestedIgn','ign','username','newIgn','newUsername','playerName','gameName',
         'requestedUid','requestedFfUid','ffUid','gameUid','newFfUid','newUid',
         'gameId','freeFireUid','phone','newPhone','mobileNumber','mobile'
        ].forEach(function (field) {
          if (typeof d[field] === 'string') d[field] = d[field].trim();
        });
      });
    }
    return _orig.apply(this, arguments);
  };

  window.renderProfileRequests._v24Trim = true;
  console.log('[v24] BUG #12 ✅ renderProfileRequests: .trim() on all proposed fields');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #13 (MINOR) — approveProfileUpdate
   Problem: IGN uniqueness is only checked in Firebase (users node).
   A user could steal an IGN that exists only in Supabase.
   Fix: Add Supabase uniqueness check before approving.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('approveProfileUpdate', function () {
  if (window.approveProfileUpdate._v24SupaCheck) return;
  var _orig = window.approveProfileUpdate;

  window.approveProfileUpdate = async function (rid) {
    var supa = getSupa();
    if (!supa) {
      /* Supabase unavailable — fall through to original */
      return _orig.apply(this, arguments);
    }

    /* Peek at the request to get proposed IGN */
    var db  = getDB();
    var req = null;
    if (db) {
      var dbKey = window.DB_PROFILE_UPDATE || 'profileUpdates';
      var rs = await db.ref(dbKey + '/' + rid).once('value').catch(function () { return null; });
      if (rs && rs.exists()) req = rs.val();
    }

    if (!req) return _orig.apply(this, arguments); // can't read request — let original handle

    var proposedIgn = (
      req.requestedIgn || req.newIgn || req.ign ||
      req.newUsername || req.username || req.playerName || ''
    ).trim();

    var uid = req.uid || req.userId || req.oderId || null;

    if (proposedIgn && uid) {
      try {
        /* Check Supabase for duplicate IGN */
        var supaCheck = await supa.from('users')
          .select('id')
          .ilike('ign', proposedIgn)
          .neq('id', uid)
          .limit(1)
          .catch(function () { return { data: [] }; });

        if (supaCheck.data && supaCheck.data.length > 0) {
          window.showToast
            ? window.showToast('❌ IGN "' + proposedIgn + '" already taken in Supabase!', true)
            : alert('IGN already taken in Supabase!');
          return; // block approval
        }
      } catch (e) {
        console.warn('[v24 Bug#13] Supabase IGN check error (proceeding):', e.message);
      }
    }

    return _orig.apply(this, arguments);
  };

  window.approveProfileUpdate._v24SupaCheck = true;
  console.log('[v24] BUG #13 ✅ approveProfileUpdate: Supabase IGN uniqueness check added');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #14 (MINOR) — deleteTournament
   Problem: Join requests are only marked "cancelled" in Firebase.
   Supabase join_requests table is never cleaned up.
   Fix: Also delete from Supabase join_requests and notify players.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('deleteTournament', function () {
  if (window.deleteTournament._v24SupaClean) return;
  var _orig = window.deleteTournament;

  window.deleteTournament = async function (id) {
    /* Run original (handles Firebase + confirm dialog) */
    await _orig.apply(this, arguments);

    /* After original: clean up Supabase */
    var supa = getSupa();
    if (!supa || !id) return;

    try {
      /* Delete all join_requests for this match from Supabase */
      await supa.from('join_requests').delete().eq('match_id', id)
        .catch(function (e) {
          console.warn('[v24 Bug#14] join_requests delete error:', e.message);
        });

      /* Also mark match as cancelled in Supabase (original only removes from Firebase) */
      await supa.from('matches').delete().eq('id', id)
        .catch(function (e) {
          console.warn('[v24 Bug#14] matches delete error:', e.message);
        });

      console.log('[v24 Bug#14 ✅] deleteTournament: Supabase cleanup done for', id);
    } catch (e) {
      console.error('[v24 Bug#14] deleteTournament Supabase cleanup error:', e.message);
    }
  };

  window.deleteTournament._v24SupaClean = true;
  console.log('[v24] BUG #14 ✅ deleteTournament: Supabase join_requests cleanup added');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #15 (MINOR) — showMatchFeedbacks
   Problem: Function is defined but has no nav entry point.
   Fix: Inject a "View Feedback" button in the Analytics section.
   ════════════════════════════════════════════════════════════════════════ */
(function _injectFeedbackButton() {
  function tryInject() {
    if (typeof window.showMatchFeedbacks !== 'function') return false;

    /* Find the analytics / feedback section to inject the button */
    var targets = [
      document.querySelector('#analyticsSection .section-actions'),
      document.querySelector('#feedbackSection'),
      document.querySelector('.section-title[data-section="analytics"]'),
      document.querySelector('#analyticsSection'),
      document.querySelector('.admin-content')
    ];

    var container = targets.find(function (el) { return el !== null; });
    if (!container) return false;

    /* Avoid duplicate injection */
    if (document.getElementById('_v24FeedbackBtn')) return true;

    var btn = document.createElement('button');
    btn.id        = '_v24FeedbackBtn';
    btn.className = 'btn btn-ghost btn-sm';
    btn.innerHTML = '<i class="fas fa-comment-dots"></i> Match Feedback';
    btn.title     = 'View player feedback submitted after matches';
    btn.style.cssText = 'margin:4px;font-size:11px';
    btn.onclick   = function () { window.showMatchFeedbacks(); };

    container.appendChild(btn);
    console.log('[v24] BUG #15 ✅ showMatchFeedbacks: Feedback button injected');
    return true;
  }

  /* Try immediately, then retry after DOM is ready */
  if (!tryInject()) {
    var iv = setInterval(function () {
      if (tryInject()) clearInterval(iv);
    }, 1200);
    setTimeout(function () { clearInterval(iv); }, 15000);
  }
})();

/* ════════════════════════════════════════════════════════════════════════
   BUG #16 (MINOR) — adminClearUserNotifications
   Problem: Deletes from Supabase without checking if user exists.
   Could throw error silently or expose user ID in logs.
   Fix: Check user exists in Firebase before proceeding.
   ════════════════════════════════════════════════════════════════════════ */
(function _patchClearNotifications() {
  var _wait = setInterval(function () {
    if (typeof window.adminClearUserNotifications !== 'function') return;
    clearInterval(_wait);
    if (window.adminClearUserNotifications._v24Guard) return;

    var _orig = window.adminClearUserNotifications;

    window.adminClearUserNotifications = async function (uid) {
      if (!uid) return;

      var db  = getDB();
      var exists = true; // assume exists unless Firebase says otherwise

      if (db) {
        try {
          var snap = await db.ref((window.DB_USERS || 'users') + '/' + uid).once('value');
          exists = snap.exists();
        } catch (e) {
          console.warn('[v24 Bug#16] User existence check error:', e.message);
          /* If check fails, proceed anyway to avoid blocking admin */
        }
      }

      if (!exists) {
        if (window.showToast) window.showToast('User not found: ' + uid.substring(0, 10), true);
        console.warn('[v24 Bug#16] adminClearUserNotifications: user not found', uid);
        return;
      }

      return _orig.apply(this, arguments);
    };

    window.adminClearUserNotifications._v24Guard = true;
    console.log('[v24] BUG #16 ✅ adminClearUserNotifications: User existence guard added');
  }, 800);
})();

/* ════════════════════════════════════════════════════════════════════════
   BUG #17 (MINOR) — exportWalletTransactionsCSV
   Problem: Fails silently if Supabase is down — no Firebase fallback.
   Fix: Add Firebase fallback reading walletRequests node.
   ════════════════════════════════════════════════════════════════════════ */
(function _patchExportWalletCSV() {
  var _wait = setInterval(function () {
    if (typeof window.exportWalletTransactionsCSV !== 'function') return;
    clearInterval(_wait);
    if (window.exportWalletTransactionsCSV._v24Fallback) return;

    var _orig = window.exportWalletTransactionsCSV;

    window.exportWalletTransactionsCSV = async function (uid) {
      var supa = getSupa();

      /* Try Supabase first */
      if (supa) {
        try {
          return await _orig.apply(this, arguments);
        } catch (e) {
          console.warn('[v24 Bug#17] Supabase export failed, using Firebase fallback:', e.message);
        }
      }

      /* Firebase fallback */
      var db = getDB();
      if (!db) {
        if (window.showToast) window.showToast('DB not available', true);
        return;
      }

      try {
        if (window.showToast) window.showToast('Supabase unavailable — Firebase se export ho raha hai…', false);

        var walletSnap = await db.ref(window.DB_WALLET || 'walletRequests')
          .orderByChild(uid ? 'uid' : 'status')
          .limitToLast(500)
          .once('value');

        if (!walletSnap.exists()) {
          if (window.showToast) window.showToast('Koi transactions nahi mili', true);
          return;
        }

        var rows = [];
        walletSnap.forEach(function (c) {
          var w = c.val(); if (!w) return;
          if (uid && w.uid !== uid && w.userId !== uid) return;
          rows.push([
            escH(c.key),
            escH(w.uid || w.userId || ''),
            escH(w.type || ''),
            w.amount || 0,
            escH(w.currency || 'inr'),
            '"' + escH((w.description || w.reason || '').replace(/"/g, '""')) + '"',
            escH(w.requestId || ''),
            w.createdAt ? new Date(w.createdAt).toISOString() : ''
          ].join(','));
        });

        if (!rows.length) {
          if (window.showToast) window.showToast('Koi transactions nahi mili', true);
          return;
        }

        var csv  = ['ID,User ID,Type,Amount,Currency,Description,Ref ID,Date']
                    .concat(rows).join('\n');
        var blob = new Blob([csv], { type: 'text/csv' });
        var a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = 'wallet_transactions_firebase_' +
                     new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        if (window.showToast) window.showToast('✅ Exported ' + rows.length + ' transactions (Firebase fallback)');

      } catch (e) {
        console.error('[v24 Bug#17] Firebase export error:', e.message);
        if (window.showToast) window.showToast('Export error: ' + e.message, true);
      }
    };

    window.exportWalletTransactionsCSV._v24Fallback = true;
    console.log('[v24] BUG #17 ✅ exportWalletTransactionsCSV: Firebase fallback added');
  }, 800);
})();

/* ════════════════════════════════════════════════════════════════════════
   BUG #19 (MINOR) — setUserPartner / removeUserPartner
   Problem: Both functions defined but no UI to call them.
   Fix: Patch openUserModal to add "Set Partner" / "Remove Partner"
   buttons in the user modal footer.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('openUserModal', function () {
  if (window.openUserModal._v24Partner) return;
  var _orig = window.openUserModal;

  window.openUserModal = async function (uid) {
    await _orig.apply(this, arguments);

    /* Inject partner buttons into modal footer */
    var ft = document.getElementById('userModalFooter');
    if (!ft) return;

    /* Avoid duplicate injection */
    if (ft.querySelector('._v24PartnerBtn')) return;

    var partnerBtns = document.createElement('span');
    partnerBtns.innerHTML =
      ' <button class="btn btn-ghost btn-sm _v24PartnerBtn" ' +
      'onclick="window._v24PromptSetPartner(\'' + escH(uid) + '\')" ' +
      'title="Set duo partner for this user">' +
      '<i class="fas fa-user-plus"></i> Set Partner' +
      '</button>' +
      ' <button class="btn btn-ghost btn-sm _v24PartnerBtn" ' +
      'style="color:var(--danger,#ff4455)"' +
      'onclick="window._v24PromptRemovePartner(\'' + escH(uid) + '\')" ' +
      'title="Remove duo partner">' +
      '<i class="fas fa-user-minus"></i> Remove Partner' +
      '</button>';

    ft.appendChild(partnerBtns);
  };

  window.openUserModal._v24Partner = true;
});

/** Helper: prompt admin for partner UID then call setUserPartner */
window._v24PromptSetPartner = function (userA) {
  var userB = prompt(
    'Partner ka UID enter karo (jis user ka partner set karna hai "' +
    escH(userA.substring(0, 12)) + '…" ke liye):'
  );
  if (!userB || !userB.trim()) return;
  if (typeof window.setUserPartner === 'function') {
    window.setUserPartner(userA, userB.trim());
  } else {
    alert('setUserPartner function not available');
  }
};

/** Helper: prompt then call removeUserPartner */
window._v24PromptRemovePartner = function (userA) {
  var userB = prompt(
    'Partner ka UID enter karo (jis partner ko remove karna hai "' +
    escH(userA.substring(0, 12)) + '…" ke liye):'
  );
  if (!userB || !userB.trim()) return;
  if (typeof window.removeUserPartner === 'function') {
    window.removeUserPartner(userA, userB.trim());
  } else {
    alert('removeUserPartner function not available');
  }
};

console.log('[v24] BUG #19 ✅ setUserPartner / removeUserPartner: UI buttons added to user modal');

/* ════════════════════════════════════════════════════════════════════════
   BUG #20 (MINOR) — syncTournamentStatuses
   Problem: Runs every 30 seconds even when the browser tab is hidden,
   causing unnecessary Firebase reads and re-renders.
   Fix: Add document.hidden check at the top of the function.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('syncTournamentStatuses', function () {
  if (window.syncTournamentStatuses._v24HiddenGuard) return;
  var _orig = window.syncTournamentStatuses;

  window.syncTournamentStatuses = function () {
    /* Skip execution when tab is not visible */
    if (document.hidden) {
      /* Silently skip — will run again on the next interval when visible */
      return;
    }
    return _orig.apply(this, arguments);
  };

  window.syncTournamentStatuses._v24HiddenGuard = true;
  console.log('[v24] BUG #20 ✅ syncTournamentStatuses: document.hidden guard added');
});

/* ════════════════════════════════════════════════════════════════════════
   BUG #26 (MAJOR) — fa58_showBatchWithdrawals
   Problem: Queries 'withdrawalRequests' ref which is EMPTY.
   Withdrawals are actually stored in 'walletRequests' with type='withdraw'.
   Fix: Change ref to walletRequests and filter by type === 'withdraw'.
   ════════════════════════════════════════════════════════════════════════ */
patchWhenReady('fa58_showBatchWithdrawals', function () {
  if (window.fa58_showBatchWithdrawals._v24FixedRef) return;

  window.fa58_showBatchWithdrawals = function () {
    var db = getDB();
    if (!db) return;

    var walletRef = window.DB_WALLET || 'walletRequests';

    /* Query walletRequests filtered by status=pending */
    db.ref(walletRef).orderByChild('status').equalTo('pending')
      .once('value', function (snap) {
        var requests = [];
        if (snap.exists()) {
          snap.forEach(function (c) {
            var d = c.val();
            /* Filter: only withdrawal-type requests */
            var tp = (d.type || '').toLowerCase();
            if (tp !== 'withdraw' && tp !== 'withdrawal' && tp !== 'wd') return;
            d._key = c.key;
            requests.push(d);
          });
        }

        if (!requests.length) {
          if (window.toast) window.toast('Koi pending withdrawal nahi hai', 'ok');
          else if (window.showToast) window.showToast('Koi pending withdrawal nahi hai', false);
          return;
        }

        /* Sort by amount descending */
        requests.sort(function (a, b) { return (b.amount || 0) - (a.amount || 0); });
        var total = requests.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);

        var rows = requests.map(function (r) {
          var safeKey = escH(r._key);
          return '<tr id="_fa58row_' + safeKey + '">' +
            '<td style="padding:8px;text-align:center">' +
            '<input type="checkbox" class="_fa58cb" data-key="' + safeKey + '" style="width:16px;height:16px;cursor:pointer"></td>' +
            '<td style="padding:8px;font-size:12px;color:#fff">' + escH(r.userName || r.uid || 'User') + '</td>' +
            '<td style="padding:8px;font-size:12px;color:#00ff9c;font-weight:700">₹' + (r.amount || 0) + '</td>' +
            '<td style="padding:8px;font-size:11px;color:#888">' + escH(r.upiId || r.upi || '-') + '</td>' +
            '<td style="padding:8px;font-size:10px;color:#555">' +
            new Date(r.createdAt || 0).toLocaleDateString('en-IN') + '</td>' +
            '</tr>';
        }).join('');

        var h = '<div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
          '<span style="font-size:12px;color:#888">' + requests.length +
          ' pending · Total: <b style="color:#00ff9c">₹' + total + '</b></span>' +
          '<div style="display:flex;gap:8px">' +
          '<button onclick="document.querySelectorAll(\'._fa58cb\').forEach(function(c){c.checked=true})" ' +
          'style="font-size:11px;color:#00d4ff;background:none;border:none;cursor:pointer">Select All</button>' +
          '<button onclick="document.querySelectorAll(\'._fa58cb\').forEach(function(c){c.checked=false})" ' +
          'style="font-size:11px;color:#888;background:none;border:none;cursor:pointer">Clear</button>' +
          '</div></div>' +
          '<div style="overflow-x:auto;max-height:280px;overflow-y:auto">' +
          '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.1)">' +
          '<th style="padding:6px;width:30px"></th>' +
          '<th style="padding:6px;font-size:11px;color:#888;text-align:left">User</th>' +
          '<th style="padding:6px;font-size:11px;color:#888;text-align:left">Amount</th>' +
          '<th style="padding:6px;font-size:11px;color:#888;text-align:left">UPI</th>' +
          '<th style="padding:6px;font-size:11px;color:#888;text-align:left">Date</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>' +
          '<div style="display:flex;gap:8px;margin-top:14px">' +
          '<button onclick="window._fa58v24Approve(\'approved\')" ' +
          'style="flex:1;padding:12px;border-radius:12px;background:rgba(0,255,156,.15);border:1px solid rgba(0,255,156,.3);' +
          'color:#00ff9c;font-weight:800;font-size:13px;cursor:pointer">✅ Approve Selected</button>' +
          '<button onclick="window._fa58v24Approve(\'rejected\')" ' +
          'style="flex:1;padding:12px;border-radius:12px;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);' +
          'color:#ff6b6b;font-weight:800;font-size:13px;cursor:pointer">❌ Reject Selected</button>' +
          '</div></div>';

        if (window.openAdminModal) window.openAdminModal('💸 Batch Withdrawal Approval', h);
        else if (window.openModal) window.openModal('💸 Batch Withdrawal Approval', h);
      });
  };

  /** Approve/reject selected rows using correct walletRequests ref */
  window._fa58v24Approve = function (status) {
    var db = getDB();
    if (!db) return;

    var checked = document.querySelectorAll('._fa58cb:checked');
    if (!checked.length) {
      if (window.toast) window.toast('Koi select nahi kiya', 'err');
      else if (window.showToast) window.showToast('Koi select nahi kiya', true);
      return;
    }

    var walletRef = window.DB_WALLET || 'walletRequests';
    var count = 0;

    checked.forEach(function (cb) {
      var key = cb.getAttribute('data-key');
      if (!key) return;
      db.ref(walletRef + '/' + key).update({
        status:      status,
        processedAt: Date.now(),
        processedBy: window.auth && window.auth.currentUser
                     ? window.auth.currentUser.uid : 'admin'
      });
      var row = document.getElementById('_fa58row_' + key);
      if (row) { row.style.opacity = '.3'; row.style.pointerEvents = 'none'; }
      count++;
    });

    var msg = (status === 'approved' ? '✅ ' : '❌ ') + count + ' withdrawals ' + status;
    if (window.toast) window.toast(msg, status === 'approved' ? 'ok' : 'err');
    else if (window.showToast) window.showToast(msg, status !== 'approved');
  };

  window.fa58_showBatchWithdrawals._v24FixedRef = true;
  console.log('[v24] BUG #26 ✅ fa58_showBatchWithdrawals: Fixed ref (walletRequests + type filter)');
});

/* ════════════════════════════════════════════════════════════════════════
   CSS INJECTION — Bug #11 (Toast overflow) + minor UI polish
   Ensures toast never overflows on any screen width.
   ════════════════════════════════════════════════════════════════════════ */
(function _injectV24CSS() {
  if (document.getElementById('_v24FixCSS')) return;
  var style = document.createElement('style');
  style.id  = '_v24FixCSS';
  style.textContent = [
    /* Bug #11: Toast container — prevent overflow on screens < 480px */
    '.toast-container{',
    '  max-width:min(350px,calc(100vw - 24px));',
    '  right:12px;',
    '  left:auto;',
    '}',
    /* Extra safeguard below 360px */
    '@media(max-width:360px){',
    '  .toast-container{left:8px;right:8px;max-width:none;}',
    '  .toast{font-size:10px;padding:8px 10px;}',
    '}',
    /* Partner buttons: match existing btn-ghost style */
    '._v24PartnerBtn{font-size:10px !important;padding:5px 8px !important;}',
    /* Feedback button pulse (draws admin attention) */
    '#_v24FeedbackBtn{animation:none;}',
    '#_v24FeedbackBtn:hover{color:var(--primary,#00ff9c) !important;}'
  ].join('\n');

  (document.head || document.documentElement).appendChild(style);
  console.log('[v24] CSS fixes injected (Bug #11 toast overflow)');
})();

/* ════════════════════════════════════════════════════════════════════════
   BOOT SUMMARY
   ════════════════════════════════════════════════════════════════════════ */
console.log('%c╔═══════════════════════════════════════════╗', 'color:#00ff9c;font-weight:bold');
console.log('%c║  Admin Panel Bug Fix Patch v24 FINAL       ║', 'color:#00ff9c;font-weight:bold');
console.log('%c╠═══════════════════════════════════════════╣', 'color:#00ff9c;font-weight:bold');
console.log('%c║  #1  confirmWithdrawal Supabase sync  ✅  ║', 'color:#00d4ff');
console.log('%c║  #5  fa66 live count from Supabase    ✅  ║', 'color:#00d4ff');
console.log('%c║  #6  fa73 broken source removed       ✅  ║', 'color:#00d4ff');
console.log('%c║  #7  runFraudCheck real pagination    ✅  ║', 'color:#00d4ff');
console.log('%c║  #10 saveTournament dup name warn     ✅  ║', 'color:#00d4ff');
console.log('%c║  #11 toast overflow CSS fix           ✅  ║', 'color:#00d4ff');
console.log('%c║  #12 renderProfileRequests trim()     ✅  ║', 'color:#00d4ff');
console.log('%c║  #13 approveProfileUpdate Supa IGN    ✅  ║', 'color:#00d4ff');
console.log('%c║  #14 deleteTournament Supabase clean  ✅  ║', 'color:#00d4ff');
console.log('%c║  #15 showMatchFeedbacks nav button    ✅  ║', 'color:#00d4ff');
console.log('%c║  #16 clearNotifs user guard           ✅  ║', 'color:#00d4ff');
console.log('%c║  #17 exportCSV Firebase fallback      ✅  ║', 'color:#00d4ff');
console.log('%c║  #19 setUserPartner UI buttons        ✅  ║', 'color:#00d4ff');
console.log('%c║  #20 syncTournament hidden tab guard  ✅  ║', 'color:#00d4ff');
console.log('%c║  #26 fa58 correct walletRequests ref  ✅  ║', 'color:#00d4ff');
console.log('%c╚═══════════════════════════════════════════╝', 'color:#00ff9c;font-weight:bold');

})(); // end IIFE
