/* ================================================================
   ADMIN FEATURE: KYC Queue + Dispute Queue + Legal Dashboard
   Admin panel mein yeh automatically available hoga
   ================================================================ */
(function () {
  'use strict';

  /* ─── KYC QUEUE ─── */
  window.faKYCQueue = async function () {
    try {
      var s = await rtdb.ref('kycRequests').orderByChild('status').equalTo('pending').once('value');
      var list = [];
      s.forEach(function (c) { var d = c.val(); d._k = c.key; list.push(d); });

      var h = '<div>';
      if (!list.length) {
        h += '<div style="text-align:center;padding:24px;color:#00ff9c;font-size:13px">✅ No pending KYC requests!</div>';
      }
      list.forEach(function (r) {
        var ts = r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;margin-bottom:10px">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
          + '<div><strong style="font-size:14px">' + (r.ign || r.uid || 'User') + '</strong>'
          + '<div style="font-size:11px;color:#aaa;margin-top:2px">' + ts + '</div></div>'
          + '<span style="background:rgba(255,170,0,.15);border:1px solid rgba(255,170,0,.3);padding:3px 10px;border-radius:20px;font-size:11px;color:#ffaa00;font-weight:700">PENDING</span>'
          + '</div>'
          + '<div style="background:rgba(0,0,0,.3);border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px;line-height:1.8">'
          + '<span style="color:#aaa">Name:</span> <strong>' + (r.name || '-') + '</strong><br>'
          + '<span style="color:#aaa">PAN:</span> <strong>' + (r.pan || '-') + '</strong><br>'
          + '<span style="color:#aaa">Aadhaar Last 4:</span> <strong>XXXX-XXXX-' + (r.aadhaarLast4 || '????') + '</strong>'
          + '</div>'
          + '<div style="display:flex;gap:8px">'
          + '<button onclick="faKYCApprove(\'' + r._k + '\',\'' + r.uid + '\')" style="flex:1;padding:9px;border-radius:8px;background:#00ff9c;color:#000;font-weight:800;border:none;cursor:pointer;font-size:12px">✅ Approve</button>'
          + '<button onclick="faKYCReject(\'' + r._k + '\',\'' + r.uid + '\')" style="flex:1;padding:9px;border-radius:8px;background:#ff4444;color:#fff;font-weight:800;border:none;cursor:pointer;font-size:12px">❌ Reject</button>'
          + '</div></div>';
      });
      h += '</div>';
      showAdminModal('🪪 KYC Queue (' + list.length + ')', h);
    } catch (e) { showToast('Error: ' + e.message, true); }
  };

  window.faKYCApprove = async function (key, uid) {
    try {
      await rtdb.ref('kycRequests/' + key).update({ status: 'approved', reviewedAt: Date.now() });
      await rtdb.ref('users/' + uid + '/kyc').update({ status: 'verified', verifiedAt: Date.now() });
      var nk = rtdb.ref('users/' + uid + '/notifications').push().key;
      await rtdb.ref('users/' + uid + '/notifications/' + nk).set({ title: '✅ KYC Verified!', message: 'Aapki KYC verify ho gayi. Ab aap ₹500+ withdraw kar sakte hain.', type: 'system', timestamp: Date.now(), read: false });
      showToast('✅ KYC Approved!');
      faKYCQueue();
    } catch (e) { showToast('Error: ' + e.message, true); }
  };

  window.faKYCReject = async function (key, uid) {
    try {
      await rtdb.ref('kycRequests/' + key).update({ status: 'rejected', reviewedAt: Date.now() });
      await rtdb.ref('users/' + uid + '/kyc/status').set('rejected');
      var nk = rtdb.ref('users/' + uid + '/notifications').push().key;
      await rtdb.ref('users/' + uid + '/notifications/' + nk).set({ title: '❌ KYC Rejected', message: 'Aapki KYC reject hui. Sahi documents submit karein.', type: 'system', timestamp: Date.now(), read: false });
      showToast('❌ KYC Rejected');
      faKYCQueue();
    } catch (e) { showToast('Error: ' + e.message, true); }
  };

  /* ─── DISPUTE QUEUE ─── */
  window.faDisputeQueue = async function () {
    try {
      var s = await rtdb.ref('disputes').orderByChild('status').equalTo('open').once('value');
      var list = [];
      s.forEach(function (c) { var d = c.val(); d._k = c.key; list.push(d); });
      list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

      var h = '<div>';
      if (!list.length) {
        h += '<div style="text-align:center;padding:24px;color:#00ff9c;font-size:13px">✅ No open disputes!</div>';
      }
      list.forEach(function (r) {
        var ts = r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,170,0,.15);border-radius:12px;padding:14px;margin-bottom:10px">'
          + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
          + '<div><strong>' + (r.ign || r.uid || 'User') + '</strong>'
          + '<div style="font-size:11px;color:#aaa;margin-top:2px">' + ts + ' | Match: ' + (r.matchId || '-') + '</div></div>'
          + '<span style="background:rgba(255,107,107,.15);border:1px solid rgba(255,107,107,.3);padding:3px 10px;border-radius:20px;font-size:10px;color:#ff6b6b;font-weight:700">OPEN</span>'
          + '</div>'
          + '<div style="background:rgba(255,170,0,.06);border:1px solid rgba(255,170,0,.1);border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px;line-height:1.8">'
          + '<span style="color:#aaa">Type:</span> <strong style="color:#ffaa00">' + (r.type || '-') + '</strong><br>'
          + '<span style="color:#aaa">Details:</span> ' + (r.description || '-')
          + '</div>'
          + '<div style="display:flex;gap:8px">'
          + '<button onclick="faDisputeResolve(\'' + r._k + '\',\'' + r.uid + '\')" style="flex:1;padding:9px;border-radius:8px;background:#00ff9c;color:#000;font-weight:800;border:none;cursor:pointer;font-size:12px">✅ Mark Resolved</button>'
          + '<button onclick="faDisputeClose(\'' + r._k + '\',\'' + r.uid + '\')" style="flex:1;padding:9px;border-radius:8px;background:rgba(255,255,255,.1);color:#fff;font-weight:800;border:none;cursor:pointer;font-size:12px">❌ Close</button>'
          + '</div></div>';
      });
      h += '</div>';
      showAdminModal('⚖️ Disputes (' + list.length + ')', h);
    } catch (e) { showToast('Error: ' + e.message, true); }
  };

  window.faDisputeResolve = async function (key, uid) {
    try {
      await rtdb.ref('disputes/' + key).update({ status: 'resolved', resolvedAt: Date.now() });
      var nk = rtdb.ref('users/' + uid + '/notifications').push().key;
      await rtdb.ref('users/' + uid + '/notifications/' + nk).set({ title: '✅ Dispute Resolved', message: 'Aapka dispute resolve ho gaya hai. Kisi aur problem ke liye contact karein.', type: 'system', timestamp: Date.now(), read: false });
      showToast('✅ Resolved!');
      faDisputeQueue();
    } catch (e) { showToast('Error: ' + e.message, true); }
  };

  window.faDisputeClose = async function (key, uid) {
    try {
      await rtdb.ref('disputes/' + key).update({ status: 'closed', closedAt: Date.now() });
      showToast('Closed');
      faDisputeQueue();
    } catch (e) { showToast('Error: ' + e.message, true); }
  };

  /* ─── LEGAL COMPLIANCE DASHBOARD ─── */
  window.faLegalDashboard = async function () {
    try {
      var [kycSnap, dispSnap, usersSnap] = await Promise.all([
        rtdb.ref('kycRequests').orderByChild('status').equalTo('pending').once('value'),
        rtdb.ref('disputes').orderByChild('status').equalTo('open').once('value'),
        rtdb.ref('users').once('value')
      ]);

      var kycPending = 0; kycSnap.forEach(function () { kycPending++; });
      var dispOpen = 0; dispSnap.forEach(function () { dispOpen++; });
      var totalUsers = 0, ageVerified = 0, tcAccepted = 0, kycVerified = 0;
      usersSnap.forEach(function (c) {
        var u = c.val() || {};
        totalUsers++;
        if (u.ageVerified) ageVerified++;
        if (u.tcAccepted) tcAccepted++;
        if (u.kyc && u.kyc.status === 'verified') kycVerified++;
      });

      var h = '<div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'
        + _lCard('👥', 'Total Users', totalUsers, '#00d4ff')
        + _lCard('🔞', 'Age Verified', ageVerified + '/' + totalUsers, '#00ff9c')
        + _lCard('📋', 'T&C Accepted', tcAccepted + '/' + totalUsers, '#00ff9c')
        + _lCard('🪪', 'KYC Verified', kycVerified + '/' + totalUsers, '#b964ff')
        + _lCard('⏳', 'KYC Pending', kycPending, kycPending > 0 ? '#ffaa00' : '#00ff9c')
        + _lCard('⚖️', 'Open Disputes', dispOpen, dispOpen > 0 ? '#ff6b6b' : '#00ff9c')
        + '</div>'
        + '<div style="display:grid;gap:8px">'
        + '<button onclick="faKYCQueue()" style="padding:12px;border-radius:10px;background:rgba(185,100,255,.12);border:1px solid rgba(185,100,255,.25);color:#b964ff;font-weight:800;font-size:13px;cursor:pointer">🪪 Manage KYC Queue (' + kycPending + ')</button>'
        + '<button onclick="faDisputeQueue()" style="padding:12px;border-radius:10px;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.2);color:#ff6b6b;font-weight:800;font-size:13px;cursor:pointer">⚖️ Manage Disputes (' + dispOpen + ')</button>'
        + '</div>'
        + '<div style="margin-top:14px;padding:12px;background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.1);border-radius:10px;font-size:11px;color:#8888aa;line-height:1.8">'
        + '📌 <strong style="color:#fff">Legal Reminders:</strong><br>'
        + '• GST 28% — monthly file karo (jab revenue ₹20L/year cross kare)<br>'
        + '• TDS 30% — user winnings par deduct karo aur quarterly govt ko deposit karo<br>'
        + '• Grievance response: 30 din ke andar (DPDP Act 2023)<br>'
        + '• Dispute response: 24-48 hours mein'
        + '</div></div>';

      showAdminModal('⚖️ Legal Compliance Dashboard', h);
    } catch (e) { showToast('Error: ' + e.message, true); }
  };

  function _lCard(icon, label, val, color) {
    return '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;text-align:center">'
      + '<div style="font-size:22px;margin-bottom:4px">' + icon + '</div>'
      + '<div style="font-size:11px;color:#888;margin-bottom:4px">' + label + '</div>'
      + '<div style="font-size:20px;font-weight:900;color:' + color + '">' + val + '</div>'
      + '</div>';
  }

  /* ─── AUTO-INJECT BUTTONS IN ADMIN PANEL ─── */
  window.addEventListener('load', function () {
    setTimeout(function () {
      // Find admin button container and add Legal button
      var btns = document.querySelectorAll('.feature-btn, .admin-btn, [onclick*="fa0"]');
      if (btns.length === 0) return;
      var parent = btns[0].parentNode;
      if (!parent) return;

      // Check not already added
      if (document.getElementById('_legal_btn')) return;

      var legalBtn = document.createElement('button');
      legalBtn.id = '_legal_btn';
      legalBtn.onclick = function () { window.faLegalDashboard && window.faLegalDashboard(); };
      legalBtn.className = btns[0].className;
      legalBtn.style.cssText = 'background:linear-gradient(135deg,rgba(0,255,156,.15),rgba(0,212,255,.1));border:1px solid rgba(0,255,156,.3);color:#00ff9c';
      legalBtn.innerHTML = '<i class="fas fa-balance-scale"></i><span>Legal Dashboard</span>';

      var kycBtn = document.createElement('button');
      kycBtn.onclick = function () { window.faKYCQueue && window.faKYCQueue(); };
      kycBtn.className = btns[0].className;
      kycBtn.style.cssText = 'background:linear-gradient(135deg,rgba(185,100,255,.15),rgba(185,100,255,.08));border:1px solid rgba(185,100,255,.25);color:#b964ff';
      kycBtn.innerHTML = '<i class="fas fa-id-card"></i><span>KYC Queue</span>';

      var dispBtn = document.createElement('button');
      dispBtn.onclick = function () { window.faDisputeQueue && window.faDisputeQueue(); };
      dispBtn.className = btns[0].className;
      dispBtn.style.cssText = 'background:linear-gradient(135deg,rgba(255,107,107,.12),rgba(255,107,107,.06));border:1px solid rgba(255,107,107,.2);color:#ff6b6b';
      dispBtn.innerHTML = '<i class="fas fa-gavel"></i><span>Disputes</span>';

      parent.insertBefore(dispBtn, btns[0]);
      parent.insertBefore(kycBtn, btns[0]);
      parent.insertBefore(legalBtn, btns[0]);
    }, 800);
  });

  console.log('[Mini eSports Admin] ✅ Legal Features loaded: KYC Queue + Dispute Queue + Legal Dashboard');
})();
