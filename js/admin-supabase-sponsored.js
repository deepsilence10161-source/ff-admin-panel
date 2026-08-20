/* ══════════════════════════════════════════════════════════════
   ADMIN SUPABASE — SPONSORED WITHDRAWAL
   Bug#118 Fix: Separated from admin-supabase-core.js
   Handles: sponsored prize withdrawals, table render, approve/reject
   ══════════════════════════════════════════════════════════════ */
(function() {
'use strict';
/* ✅ FIX (2026-08-20): loadSponsoredWithdrawals used to be defined INSIDE
   _initSponsoredWd(), which returns early until window._supaAuthed is true.
   js/fa-sponsored-system.js used to define a (wrong, Firebase-backed) copy at
   load time that masked this — now that the duplicate is deleted, the function
   would simply not exist until login completed, and loadSponsoredSection()
   would silently render nothing. Defined immediately instead; the auth wait
   moved inside, with a visible "connecting" state and an automatic retry. */
window.loadSponsoredWithdrawals = function() {
    if (!window._supa || !window._supaAuthed) {
      var tb0 = document.getElementById('sponsoredWdTable');
      if (tb0) tb0.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#888">' +
        '<i class="fas fa-spinner fa-spin"></i> Supabase se connect ho raha hai…</td></tr>';
      clearTimeout(window._spWdRetry);
      window._spWdRetry = setTimeout(window.loadSponsoredWithdrawals, 800);
      return;
    }
      /* ✅ 2026-08-20 (Wallet tab removal): this is the ONE live loader for
         sponsored withdrawals — js/fa-sponsored-system.js used to define a
         second, Firebase-backed copy that this file silently overwrote; that
         dead copy has been deleted.

         Extended select so the table can show the columns carried over from
         the deleted "Wallet Requests" tab (FF UID, UTR, Proof). Those live on
         joined users / optional wallet_transactions columns, so if any of them
         is absent in this project the whole PostgREST query would 400 and the
         table would silently stay empty — hence the fallback to the original
         minimal select. */
      var base = 'id,user_id,amount,note,status,created_at';
      function run(sel, isFallback) {
        return window._supa.from('wallet_transactions')
          .select(sel)
          .eq('txn_type','pending_withdraw')
          .order('created_at',{ascending:false}).limit(100)
          .then(function(r){
            if (r.error) {
              if (!isFallback) { console.warn('[SponsoredWd] extended select failed, retrying minimal:', r.error.message); return run(base + ',users(ign,email)', true); }
              console.error('[SponsoredWd]', r.error.message);
              return;
            }
            window._sponsoredWdList = r.data || [];
            var pending = (r.data||[]).filter(function(w){return !w.status||w.status==='pending';}).length;
            /* ✅ FIX: was writing to #sponsoredWdBadge, which does not exist in
               index.html — the sidebar badge is #sponsoredBadge, so the pending
               count never showed. Write to both so either markup works. */
            ['sponsoredWdBadge','sponsoredBadge'].forEach(function(id){
              var b = document.getElementById(id);
              if (b) { b.textContent = pending || ''; b.style.display = pending ? 'flex' : 'none'; }
            });
            var cnt = document.getElementById('sponsoredCount');
            if (cnt) cnt.textContent = (r.data||[]).length;
            _renderSponsoredWdTable();
          }, function(e){ console.error('[SponsoredWd]', e && e.message); });
      }
      return run(base + ',ref_id,screenshot_url,utr_number,users(ign,email,ff_uid)', false);
};

function _esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function _renderSponsoredWdTable() {
      var tb = document.getElementById('sponsoredWdTable'); if (!tb) return;
      var rows = window._sponsoredWdList || [];
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#666">No sponsored withdrawal requests</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function(w) {
        var u  = w.users || {};
        var st = w.status || 'pending';
        var badge = st==='approved' ? '<span style="color:#00ff9c;font-weight:700">✅ Approved</span>'
                  : st==='rejected' ? '<span style="color:#ff5555;font-weight:700">❌ Rejected</span>'
                  : '<span style="color:#ffaa00;font-weight:700">⏳ Pending</span>';
        var upi = (w.note||'').replace('Sponsored withdrawal to UPI: ','') || '—';
        var uid = w.user_id || '';
        var cached = (window.usersCache && window.usersCache[uid]) || {};
        var ffUid  = u.ff_uid || cached.ffUid || cached.gameUid || '—';
        var utr    = w.utr_number || w.ref_id || '';
        var proof  = w.screenshot_url || '';
        var proofHtml = proof
          ? '<img src="'+_esc(proof)+'" style="width:36px;height:36px;border-radius:6px;cursor:pointer;object-fit:cover;border:1px solid rgba(255,255,255,.15)" onclick="if(window.viewScreenshot)viewScreenshot(this.src);else window.open(this.src)">'
          : '<span style="color:#555;font-size:10px">No photo</span>';
        var actions = (st==='pending'||!st)
          ? '<button onclick="window.approveSponsoredWd(\'' + _esc(w.id) + '\',event)" style="background:rgba(0,255,106,.12);border:1px solid #00ff9c;color:#00ff9c;padding:4px 10px;border-radius:6px;cursor:pointer;margin-right:4px;font-size:11px">✅ Approve</button>'
          + '<button onclick="window.rejectSponsoredWd(\'' + _esc(w.id) + '\',event)" style="background:rgba(255,60,60,.12);border:1px solid #ff5555;color:#ff5555;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px">❌ Reject</button>'
          : '';
        return '<tr>'
          + '<td><span style="font-weight:700;color:var(--primary);font-size:11px">'+_esc(u.ign||'N/A')+'</span><div style="font-size:9px;color:#666;font-family:monospace">'+_esc(u.email||String(uid).substring(0,10))+'</div></td>'
          + '<td><span style="font-family:monospace;font-size:10px;color:#00d4ff;background:rgba(0,212,255,.08);padding:2px 6px;border-radius:5px">'+_esc(ffUid)+'</span></td>'
          + '<td style="color:#00ff9c;font-weight:800">₹'+(w.amount||0)+'</td>'
          + '<td><code style="font-size:11px">'+_esc(upi)+'</code></td>'
          + '<td>'+(utr ? '<span style="font-family:monospace;font-size:10px;color:#ccc">'+_esc(utr)+'</span>' : '<span style="color:#555;font-size:10px">—</span>')+'</td>'
          + '<td>'+proofHtml+'</td>'
          + '<td style="font-size:11px;color:#888">Sponsored Prize</td>'
          + '<td style="font-size:11px;color:#666">'+new Date(w.created_at||Date.now()).toLocaleDateString('en-IN')+'</td>'
          + '<td>'+badge+(actions?'<br><div style="margin-top:5px">'+actions+'</div>':'')+'</td>'
          + '</tr>';
  }).join('');
}

function _initSponsoredWd() {
    /* Auth race: window._supa exists ANON from page-load; wait for
       window._supaAuthed (set by syncFirebaseToken) too, or the first cycle
       every page load hits the anon client and is RLS-rejected on
       wallet_transactions. */
    if (!window._supa || !window._supaAuthed) { setTimeout(_initSponsoredWd, 500); return; }

    window.approveSponsoredWd = async function(txnId, evt) {
      if (!confirm('Approve this sponsored withdrawal?')) return;
      var _doneBtn = (window._btnBusy ? window._btnBusy(evt) : function(){});
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
      } catch(e) { if (window.showToast) showToast('Error: '+(e&&e.message?e.message:e),true); }
      finally { _doneBtn(); }
    };

    window.rejectSponsoredWd = async function(txnId, evt) {
      var _doneBtn2 = (window._btnBusy ? window._btnBusy(evt) : function(){});
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
      } catch(e) { if (window.showToast) showToast('Error: '+(e&&e.message?e.message:e),true); }
      finally { _doneBtn2(); }
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
