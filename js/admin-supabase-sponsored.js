/* ══════════════════════════════════════════════════════════════
   ADMIN SUPABASE — SPONSORED WITHDRAWAL
   Bug#118 Fix: Separated from admin-supabase-core.js
   Handles: sponsored prize withdrawals, table render, approve/reject
   ══════════════════════════════════════════════════════════════ */
(function() {
'use strict';
function _initSponsoredWd() {
    /* ✅ FIX (live-testing): same auth-race class as admin-supabase-sync.js
       — window._supa exists ANON from page-load; wait for
       window._supaAuthed (set by syncFirebaseToken) too, or this fires
       against the anon client and gets RLS-rejected on wallet_transactions
       for the first cycle every page load. */
    if (!window._supa || !window._supaAuthed) { setTimeout(_initSponsoredWd, 500); return; }

    window.loadSponsoredWithdrawals = function() {
      window._supa.from('wallet_transactions')
        .select('id,user_id,amount,note,status,created_at,users(ign,email,ff_uid)')
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
        tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#666">No sponsored withdrawal requests</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function(w) {
        var u = w.users || {};
        var st = w.status || 'pending';
        var badge = st==='approved' ? '<span style="color:#00ff9c">✅ Approved</span>'
                  : st==='rejected' ? '<span style="color:#ff5555">❌ Rejected</span>'
                  : '<span style="color:#ffaa00">⏳ Pending</span>';
        var upi = (w.note||'').replace('Sponsored withdrawal to UPI: ','');
        /* ✅ B11 (2026-10-07): approve par ab server payout reference (UTR)
           LAZMI karta hai; wo reference isi note me ' | Payout ref: X' ban
           kar hamesha ke liye rehta hai — admin ko yahin dikhaya jaata hai
           taaki "paisa gaya ya nahi" ka proof table me hi nazar aaye. */
        var _refM = /Payout ref:\s*([^|]+)/.exec(w.note || '');
        var payoutRef = _refM ? _refM[1].trim() : '';
        var actions = (st==='pending'||!st)
          ? '<button onclick="window.approveSponsoredWd(\''+w.id+'\')" style="background:rgba(0,255,106,.12);border:1px solid #00ff9c;color:#00ff9c;padding:4px 10px;border-radius:6px;cursor:pointer;margin-right:4px;font-size:11px">✅ Approve</button>'
          + '<button onclick="window.rejectSponsoredWd(\''+w.id+'\')" style="background:rgba(255,60,60,.12);border:1px solid #ff5555;color:#ff5555;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px">❌ Reject</button>'
          : '';
        /* ✅ FIX (2026-08-19): Wallet Requests tab (now removed) had an
           FF UID column this section never had — sourced here via the
           users(ff_uid) embed added to the select() above, instead of
           the removed tab's usersCache lookup, since this file already
           fetches its own row data straight from Supabase. */
        return '<tr><td>'+(u.ign||'N/A')+'<br><small style="color:#666">'+(u.email||'')+'</small></td>'
          +'<td><span style="font-family:monospace;font-size:10px;color:#00d4ff;background:rgba(0,212,255,.08);padding:2px 6px;border-radius:5px">'+(u.ff_uid||'—')+'</span></td>'
          +'<td>₹'+(w.amount||0)+'</td><td>'+upi+'</td>'
          +'<td>'+new Date(w.created_at||Date.now()).toLocaleDateString('en-IN')+'</td>'
          +'<td>'+badge
            +(payoutRef ? '<br><small style="color:#00ff9c;font-family:monospace">UTR: '+payoutRef+'</small>' : '')
            +(st==='pending'||!st ? '<br><small style="color:#888">Approve par UTR lazmi</small>' : '')
          +'</td><td>'+actions+'</td></tr>';
      }).join('');
    }

    window.approveSponsoredWd = async function(txnId) {
      /* ✅ B11 SURAKSHA (2026-10-07): asli paisa bahar jaane wala rasta —
         (1) native confirm ki jagah app ka apna dialog (B3 usool),
         (2) payment reference (UTR/UPI txn id) LAZMI — server bhi bina
             reference ke approve hi nahi karta (payout_ref_required),
         (3) audit trail: kis admin ne kab kitna bheja, wallet_audit_log me.
         Purana code bina kisi proof ke chup-chaap approve kar deta tha aur
         sirf ek Firebase notification bhejta tha — "paisa bheja ya nahi" ka
         koi record nahi bachta tha. */
      var _u = (window._sponsoredWdList||[]).find(function(w){ return w.id===txnId; });
      var _amt = _u ? (_u.amount||0) : 0;
      var ok = window.appConfirm
        ? await window.appConfirm('₹' + _amt + ' ka sponsored prize withdrawal approve karna hai?\n\nUser ke UPI par paisa bhejne ke BAAD uska UTR / transaction id daalna hoga.', { icon: '💰', okText: 'Haan, aage badho' })
        : true;
      /* ⚠️ ZAROORI (live E2E me pakda gaya): B13 ka instant-action wrapper
         (adm-fast-actions.js) har approve/reject handler ko wrap karta hai aur
         promise RESOLVE hone par maan leta hai ki "kaam ban gaya" → row DOM se
         hata deta hai. Error sirf tab pata chalta hai jab handler `showToast(msg,
         true)` bulaye. Isliye cancel aur "reference nahi mila" — dono par error
         toast dena LAZMI hai, warna row bina paisa bheje gayab ho jaati thi. */
      if (!ok) { if (window.showToast) showToast('⏸ Cancel kiya — withdrawal pending hi hai (kuch nahi hua)', true); return; }

      var ref = window.appPrompt
        ? await window.appPrompt('Payout reference daalo (UTR / UPI transaction id — kam se kam 6 akshar):', '', { placeholder: 'e.g. 412345678901 / UPI-TXN-ID' })
        : '';
      ref = (ref || '').trim();
      if (ref.length < 6) {
        if (window.showToast) showToast('❌ Payout reference zaroori hai (UTR / UPI txn id) — approve nahi hua', true);
        if (window.appAlert) window.appAlert('❌ Payout reference zaroori hai (kam se kam 6 akshar). Bina reference ke approve nahi hota — ye jaan-bujh kar lagaya gaya suraksha-niyam hai.', { icon: '⚠️' });
        return;
      }
      try {
        /* BUG #45 FIX (2026-07): the old direct .update({status,reviewed_at,reviewed_by})
           call referenced columns that never existed on wallet_transactions (now added, but
           more importantly the old code decremented the WRONG backend — a Firebase RTDB node
           the user's actual wallet display never reads — so the user's real balance never
           went down, letting them resubmit the same withdrawal repeatedly). Now uses a single
           admin-checked RPC that atomically re-verifies sufficient balance (protects against
           double-approving two pending requests that together exceed the real balance) and
           correctly decrements the real Supabase sponsored_winnings column. */
        var r = await window._supa.rpc('resolve_sponsored_withdrawal', { p_txn_id: txnId, p_action: 'approve', p_note: ref });
        if (r.error || (r.data && r.data.success === false)) {
          var msg = (r.data && r.data.error) || (r.error && r.error.message) || 'Unknown error';
          var _map = { payout_ref_required: 'Payout reference zaroori hai (UTR/UPI txn id)', 'Already resolved': 'Ye request pehle hi resolve ho chuki hai', 'Insufficient sponsored_winnings remaining — balance may have changed since request was submitted': 'Balance ab kaafi nahi (pehle hi koi dusri request nikal gayi) — dobara check karo' };
          if (window.showToast) showToast('❌ ' + (_map[msg] || msg), true);
          return;
        }
        /* Audit: kis admin ne kitna payout kiya + reference */
        if (window._logAction) {
          try { window._logAction('sponsored_wd_approve', null, { uid: (_u && _u.user_id) || null, amount: _amt, payoutRef: ref, txnId: txnId }); } catch (e) {}
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
        if (window.showToast) showToast('✅ Withdrawal approved! (UTR: ' + ref + ')');
        window.loadSponsoredWithdrawals();
      } catch(e) { if (window.showToast) showToast('Error: '+e.message,true); }
    };

    window.rejectSponsoredWd = async function(txnId) {
      /* ✅ B3 usool: native prompt ki jagah app ka apna dialog. */
      var reason = (window.appPrompt
        ? await window.appPrompt('Rejection reason likho (user ko dikhega):', 'Admin ne reject kiya', { icon: '❌', okText: 'Reject karo', danger: true })
        : null);
      if (reason === null || reason === undefined) return;
      reason = String(reason).trim() || 'Admin ne reject kiya';
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
