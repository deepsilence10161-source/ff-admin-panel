/* ══════════════════════════════════════════════════════════════
   ADMIN SUPABASE — SPONSORED WITHDRAWAL
   Bug#118 Fix: Separated from admin-supabase-core.js
   Handles: sponsored prize withdrawals, table render, approve/reject
   ══════════════════════════════════════════════════════════════ */
(function() {
'use strict';
function _initSponsoredWd() {
    if (!window._supa) { setTimeout(_initSponsoredWd, 2500); return; }

    window.loadSponsoredWithdrawals = function() {
      window._supa.from('wallet_transactions')
        .select('id,user_id,amount,note,status,created_at,users(ign,email)')
        .eq('txn_type','pending_withdraw')
        .order('created_at',{ascending:false}).limit(100)
        .then(function(r){
          window._sponsoredWdList = r.data || [];
          var pending = (r.data||[]).filter(function(w){return !w.status||w.status==='pending';}).length;
          var badge = document.getElementById('sponsoredWdBadge');
          if (badge) badge.textContent = pending || '';
          _renderSponsoredWdTable();
        }).catch(function(e){ console.error('[SponsoredWd]',e.message); });
    };

    function _renderSponsoredWdTable() {
      var tb = document.getElementById('sponsoredWdTable'); if (!tb) return;
      var rows = window._sponsoredWdList || [];
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#666">No sponsored withdrawal requests</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function(w) {
        var u = w.users || {};
        var st = w.status || 'pending';
        var badge = st==='approved' ? '<span style="color:#00ff9c">✅ Approved</span>'
                  : st==='rejected' ? '<span style="color:#ff5555">❌ Rejected</span>'
                  : '<span style="color:#ffaa00">⏳ Pending</span>';
        var upi = (w.note||'').replace('Sponsored withdrawal to UPI: ','');
        var actions = (st==='pending'||!st)
          ? '<button onclick="window.approveSponsoredWd(\''+w.id+'\')" style="background:rgba(0,255,106,.12);border:1px solid #00ff9c;color:#00ff9c;padding:4px 10px;border-radius:6px;cursor:pointer;margin-right:4px;font-size:11px">✅ Approve</button>'
          + '<button onclick="window.rejectSponsoredWd(\''+w.id+'\')" style="background:rgba(255,60,60,.12);border:1px solid #ff5555;color:#ff5555;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px">❌ Reject</button>'
          : '';
        return '<tr><td>'+(u.ign||'N/A')+'<br><small style="color:#666">'+(u.email||'')+'</small></td>'
          +'<td>₹'+(w.amount||0)+'</td><td>'+upi+'</td>'
          +'<td>'+new Date(w.created_at||Date.now()).toLocaleDateString('en-IN')+'</td>'
          +'<td>'+badge+'</td><td>'+actions+'</td></tr>';
      }).join('');
    }

    window.approveSponsoredWd = async function(txnId) {
      if (!confirm('Approve this sponsored withdrawal?')) return;
      try {
        /* BUG #45 FIX (2026-07): the old direct .update({status,reviewed_at,reviewed_by})
           call referenced columns that never existed on wallet_transactions (now added, but
           more importantly the old code decremented the WRONG backend — a Firebase RTDB node
           the user's actual wallet display never reads — so the user's real balance never
           went down, letting them resubmit the same withdrawal repeatedly). Now uses a single
           admin-checked RPC that atomically re-verifies sufficient balance (protects against
           double-approving two pending requests that together exceed the real balance) and
           correctly decrements the real Supabase sponsored_winnings column. */
        var r = await window._supa.rpc('resolve_sponsored_withdrawal', { p_txn_id: txnId, p_action: 'approve' });
        if (r.error || (r.data && r.data.success === false)) {
          var msg = (r.data && r.data.error) || (r.error && r.error.message) || 'Unknown error';
          if (window.showToast) showToast('❌ ' + msg, true);
          return;
        }
        var txn = (window._sponsoredWdList||[]).find(function(w){return w.id===txnId;});
        if (txn && txn.user_id) {
          /* Notify user via Firebase (push notification trigger only, not balance) */
          if (window.rtdb) {
            window.rtdb.ref('users/'+txn.user_id+'/notifications').push({
              title:'💰 Withdrawal Approved!',
              message:'Aapki ₹'+(txn.amount||0)+' sponsored withdrawal approve ho gayi. 3-5 business days mein UPI pe aayegi.',
              timestamp:Date.now(), read:false, type:'sponsored_wd_approved'
            });
          }
          if (window._adminNotifyUser) {
            window._adminNotifyUser(txn.user_id, { type:'wallet', title:'💰 Withdrawal Approved!',
              message:'₹'+(txn.amount||0)+' sponsored prize withdrawal approved. 3-5 days mein aayegi.' });
          }
        }
        if (window.showToast) showToast('✅ Withdrawal approved!');
        window.loadSponsoredWithdrawals();
      } catch(e) { if (window.showToast) showToast('Error: '+e.message,true); }
    };

    window.rejectSponsoredWd = async function(txnId) {
      var reason = prompt('Rejection reason (user ko dikhega):') || 'Admin ne reject kiya';
      try {
        /* BUG #45 FIX (2026-07): same broken-columns issue as approve, above. No balance
           change needed here — nothing is deducted until approval, so reject correctly just
           marks the request rejected. */
        var r = await window._supa.rpc('resolve_sponsored_withdrawal', { p_txn_id: txnId, p_action: 'reject', p_note: reason });
        if (r.error || (r.data && r.data.success === false)) {
          var msg = (r.data && r.data.error) || (r.error && r.error.message) || 'Unknown error';
          if (window.showToast) showToast('❌ ' + msg, true);
          return;
        }
        var txn = (window._sponsoredWdList||[]).find(function(w){return w.id===txnId;});
        if (txn && txn.user_id && window.rtdb) {
          window.rtdb.ref('users/'+txn.user_id+'/notifications').push({
            title:'❌ Withdrawal Rejected',
            message:'Aapki ₹'+(txn.amount||0)+' withdrawal reject hui. Reason: '+reason,
            timestamp:Date.now(), read:false, type:'sponsored_wd_rejected'
          });
        }
        if (window.showToast) showToast('❌ Withdrawal rejected');
        window.loadSponsoredWithdrawals();
      } catch(e) { if (window.showToast) showToast('Error: '+e.message,true); }
    };

    window.loadSponsoredWithdrawals();
    setInterval(window.loadSponsoredWithdrawals, 60000);
    console.log('[AdminSync] Sponsored withdrawal admin section ✅');
  }
  setTimeout(_initSponsoredWd, 3000);

  /* ═══════════════════════════════════════════════════════════════
     M11 Fix: Universal _logAction interceptor — dual-writes every
     admin action to BOTH Firebase activityLogs AND Supabase
     admin_activity_log so no audit events are lost.
  ═══════════════════════════════════════════════════════════════ */
  function _patchLogAction() {
    var _origLog = window._logAction || window.logAdminActivity;
    window._logAction = function(type, matchId, details) {
      var adminUid = (window.adminUser && window.adminUser.uid) || 'system';
      var entry = Object.assign({ type: type, adminUid: adminUid, timestamp: Date.now() }, details || {});
      /* Firebase */
      var rtdb = window.rtdb || window.db;
      if (rtdb) rtdb.ref('activityLogs').push(entry).catch(function(){});
      /* Supabase */
      if (window._supa) {
        window._supa.from('admin_activity_log').insert({
          admin_uid:   adminUid,
          action_type: type,
          target_uid:  (details && details.uid)     || null,
          target_ref:  (details && details.matchId)  || null,
          details:     details || {},
          status:      'open'
        }).catch(function(e){ console.warn('[SponsoredSync] activity_log fail:', e.message); });
      }
      if (_origLog && _origLog !== window._logAction) _origLog(type, matchId, details);
    };
    window.logAdminActivity = window._logAction;
    console.log('[SponsoredSync] _logAction patched ✅');
  }
  setTimeout(_patchLogAction, 1500);

})();
