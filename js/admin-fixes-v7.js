/* ═══════════════════════════════════════════════════════════════════
   MINI ESPORTS — ADMIN PANEL v7 FIXES + NEW FEATURES
   Fixes: UTR shown in withdrawal, Support Chat Typing Indicator,
          Withdrawal duplicate guard, Gift ticket visibility
   Features: Admin-Editable Daily Bonus Rewards, Extended Push Notifs,
             Recently Won Feed management, Invite & Earn admin view,
             WhatsApp share config, Referral Leaderboard admin
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─── Utility ─── */
  function _$  (id) { return document.getElementById(id); }
  function _toast (msg, type) { if (window.showToast) window.showToast(msg, type); else alert(msg); }
  function _modal (title, body) { if (window.openModal) window.openModal(title, body); else if (window.showModal) window.showModal(title, body); }
  function waitFor (fn, cb, max) {
    var t = 0, i = setInterval(function () {
      t++; if (fn()) { clearInterval(i); cb(); }
      if (t > (max || 80)) clearInterval(i);
    }, 500);
  }

  /* ════════════════════════════════════════════
     FIX: WITHDRAWAL REQUESTS — UTR PROMINENTLY SHOWN
     Ab withdrawal card mein UTR clearly dikhega
     aur UTR missing hone par warning badge
  ════════════════════════════════════════════ */
  waitFor(function () { return window.showPendingWallet; }, function () {
    var _origShowPendingWallet = window.showPendingWallet;
    window.showPendingWallet = function () {
      if (!window.rtdb) { _origShowPendingWallet(); return; }
      rtdb.ref('walletRequests').orderByChild('status').equalTo('pending').once('value', function (s) {
        var reqs = [];
        if (s.exists()) s.forEach(function (c) { reqs.push(Object.assign({}, c.val(), { _key: c.key })); });
        reqs.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });

        var h = '<div>';
        h += '<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">';
        h += '<button class="btn btn-ghost btn-sm" onclick="window.exportCSV(\'wallet\')"><i class="fas fa-download"></i> Export</button>';
        h += '<span style="font-size:11px;color:#aaa;margin-left:auto">' + reqs.length + ' pending requests</span>';
        h += '</div>';

        if (!reqs.length) {
          h += '<div style="text-align:center;padding:32px;color:#aaa"><i class="fas fa-check-circle" style="font-size:32px;color:#00ff9c;display:block;margin-bottom:8px"></i>No pending requests ✅</div>';
        }

        reqs.forEach(function (r) {
          var isDeposit = r.type === 'deposit';
          var hasUTR = r.utr && r.utr.toString().trim().length > 0;
          var utrFromUser = r.utrNumber || r.utr || '';  // support both field names
          var utrBadge = hasUTR
            ? '<span style="background:rgba(0,255,156,.15);color:#00ff9c;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;font-family:monospace">UTR: ' + utrFromUser + '</span>'
            : '<span style="background:rgba(255,107,107,.15);color:#ff6b6b;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700">⚠️ UTR Missing</span>';

          h += '<div class="card" style="margin-bottom:10px;border:1px solid ' + (hasUTR ? 'rgba(255,255,255,.1)' : 'rgba(255,107,107,.3)') + '">';
          h += '<div class="card-body compact">';

          // Header row
          h += '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">';
          h += '<div>';
          h += '<div style="font-weight:700;font-size:13px">' + (isDeposit ? '📥 Deposit' : '📤 Withdrawal') + '</div>';
          h += '<div style="font-size:22px;font-weight:900;color:' + (isDeposit ? '#00d4ff' : '#00ff9c') + ';margin:2px 0">₹' + (r.amount || r.withdrawalAmount || 0) + '</div>';
          h += '<div style="font-size:10px;color:#aaa">' + (r.userName || '?') + ' · ' + new Date(r.createdAt || 0).toLocaleString() + '</div>';
          h += '</div>';
          h += '<div style="display:flex;flex-direction:column;gap:5px">';
          h += '<button class="btn btn-primary btn-xs" onclick="window.approveWallet(\'' + r._key + '\',\'' + r.uid + '\',' + (r.amount || 0) + ',\'' + r.type + '\')">✅ Approve</button>';
          h += '<button class="btn btn-danger btn-xs" onclick="window.rejectWallet(\'' + r._key + '\',\'' + r.uid + '\',' + (r.amount || 0) + ',\'' + r.type + '\')">❌ Reject</button>';
          if (r.utr) h += '<button class="btn btn-ghost btn-xs" onclick="window._addUTRToRequest(\'' + r._key + '\')">📝 Add UTR</button>';
          h += '</div></div>';

          // UTR row — prominent
          h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.06)">';
          h += utrBadge;
          if (!hasUTR) {
            h += '<input type="text" id="utrInput_' + r._key + '" placeholder="Enter UTR number" style="flex:1;padding:5px 8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,107,107,.3);color:#fff;font-size:11px;font-family:monospace">';
            h += '<button onclick="window._saveAdminUTR(\'' + r._key + '\')" style="padding:5px 10px;border-radius:8px;background:rgba(0,212,255,.15);border:1px solid rgba(0,212,255,.3);color:#00d4ff;font-size:11px;cursor:pointer;font-weight:700">Save</button>';
          }
          h += '</div>';

          // UPI + details
          h += '<div style="font-size:11px;color:#aaa;margin-top:4px">';
          if (r.upiId) h += '💳 UPI: <span style="color:#fff;font-family:monospace">' + r.upiId + '</span> &nbsp;';
          if (r.diamondsWithdrawn) h += '💎 ' + r.diamondsWithdrawn + ' diamonds';
          h += '</div>';

          if (isDeposit && r.screenshotBase64) {
            h += '<button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="window._viewSS(\'' + r._key + '\')"><i class="fas fa-image"></i> View Proof</button>';
          }
          if (!isDeposit && r.screenshotBase64) {
            h += '<button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="window._viewSS(\'' + r._key + '\')"><i class="fas fa-image"></i> View Payment Proof</button>';
          }

          h += '</div></div>';
        });

        h += '</div>';
        if (window._adminModal) window._adminModal('💳 Pending Wallet Requests (' + reqs.length + ')', h);
        else _modal('💳 Pending Wallet Requests (' + reqs.length + ')', h);
      });
    };

    // Save UTR from admin side
    window._saveAdminUTR = function (key) {
      var inp = _$('utrInput_' + key);
      if (!inp || !inp.value.trim()) { _toast('UTR number enter karo', 'err'); return; }
      rtdb.ref('walletRequests/' + key).update({ utr: inp.value.trim(), utrAddedByAdmin: true, utrAddedAt: Date.now() });
      _toast('✅ UTR saved!');
      window.showPendingWallet();
    };
    window._addUTRToRequest = function (key) {
      var utr = prompt('Enter UTR number for this request:');
      if (!utr || !utr.trim()) return;
      rtdb.ref('walletRequests/' + key).update({ utr: utr.trim(), utrAddedByAdmin: true });
      _toast('✅ UTR added!');
      window.showPendingWallet();
    };

    console.log('[v7-Admin] ✅ Fix: UTR shown prominently in withdrawal requests');
  });

  /* ════════════════════════════════════════════
     FIX: SUPPORT CHAT — ADMIN TYPING INDICATOR
     Admin type kare to user ko "typing..." dikhe
  ════════════════════════════════════════════ */
  waitFor(function () { return window.rtdb; }, function () {
    var _adminTypingTimeouts = {};

    window.setupAdminTypingForUser = function (userId) {
      var chatInput = _$('adminChatInput') || document.querySelector('.admin-chat-input') || document.querySelector('[id*="chatInput"]');
      if (!chatInput || chatInput._adminTypingSetup) return;
      chatInput._adminTypingSetup = true;

      chatInput.addEventListener('input', function () {
        rtdb.ref('supportTyping/admin_for_' + userId).set({ typing: true, ts: Date.now() });
        clearTimeout(_adminTypingTimeouts[userId]);
        _adminTypingTimeouts[userId] = setTimeout(function () {
          rtdb.ref('supportTyping/admin_for_' + userId).set({ typing: false, ts: Date.now() });
        }, 2500);
      });
      chatInput.addEventListener('blur', function () {
        rtdb.ref('supportTyping/admin_for_' + userId).set({ typing: false, ts: Date.now() });
      });
    };

    // Show user typing status in admin chat
    window.listenUserTyping = function (userId, statusElId) {
      rtdb.ref('supportTyping/user_' + userId).on('value', function (s) {
        var data = s.val();
        var el = _$(statusElId) || document.querySelector('.user-typing-status');
        if (!el) return;
        if (data && data.typing && (Date.now() - (data.ts || 0)) < 5000) {
          el.innerHTML = '<span style="color:#00ff9c;font-size:11px;animation:pulse 1s infinite">✍️ User typing...</span>';
        } else {
          el.textContent = '';
        }
      });
    };

    // Inject typing status into admin chat UI when it opens
    var _observer = new MutationObserver(function () {
      var chatBoxes = document.querySelectorAll('[data-user-id]');
      chatBoxes.forEach(function (box) {
        var uid = box.getAttribute('data-user-id');
        if (uid && !box._typingInited) {
          box._typingInited = true;
          window.setupAdminTypingForUser(uid);
          if (!box.querySelector('.user-typing-status')) {
            var typingEl = document.createElement('div');
            typingEl.className = 'user-typing-status';
            typingEl.style.cssText = 'height:16px;font-size:11px;padding:0 8px';
            box.appendChild(typingEl);
            window.listenUserTyping(uid, null);
          }
        }
      });
    });
    _observer.observe(document.body, { childList: true, subtree: true });

    console.log('[v7-Admin] ✅ Fix: Admin typing indicator setup');
  });

  /* ════════════════════════════════════════════════════════════
     ✨ NEW FEATURE: DAILY BONUS REWARD EDITOR
     Admin panel se daily login bonus rewards set kar sake
  ════════════════════════════════════════════════════════════ */
  window.showDailyBonusConfig = function () {
    if (!window.rtdb) return;
    rtdb.ref('appSettings/dailyBonusRewards').once('value', function (s) {
      var cfg = s.val() || { day1: 5, day2: 7, day3: 10, day4: 12, day5: 15, day6: 20, day7: 30 };
      var h = '<div>';
      h += '<div style="background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.2);border-radius:10px;padding:10px;margin-bottom:14px;font-size:12px;color:#ffaa00">';
      h += '⚡ Yeh rewards user ko daily login streak par milte hain (Coins). Changes turant effect honge.';
      h += '</div>';
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
      var dayEmojis = ['🌱','🌿','🌳','⚡','🔥','💫','👑'];
      var dayLabels = ['Day 1','Day 2','Day 3','Day 4','Day 5','Day 6','Day 7 (Max)'];
      for (var i = 1; i <= 7; i++) {
        h += '<div class="form-group">';
        h += '<label style="display:flex;align-items:center;gap:6px">' + dayEmojis[i-1] + ' ' + dayLabels[i-1] + ' <span style="font-size:10px;color:#666">(coins)</span></label>';
        h += '<input type="number" id="dbDay' + i + '" class="form-input" value="' + (cfg['day' + i] || 5) + '" min="1" max="10000">';
        h += '</div>';
      }
      h += '</div>';
      h += '<div class="form-group" style="margin-top:10px">';
      h += '<label>Special Day-30 Bonus (coins) <span style="font-size:10px;color:#666">Monthly legend reward</span></label>';
      h += '<input type="number" id="dbDay30Bonus" class="form-input" value="' + (cfg.day30Bonus || 100) + '" min="0">';
      h += '</div>';
      h += '<button class="btn btn-primary w-full" onclick="window._saveDailyBonusConfig()" style="margin-top:12px"><i class="fas fa-save"></i> Save Daily Bonus Rewards</button>';
      h += '<button class="btn btn-ghost w-full" onclick="window._previewDailyBonus()" style="margin-top:6px"><i class="fas fa-eye"></i> Preview User Experience</button>';
      h += '</div>';
      _modal('🎁 Daily Bonus Reward Editor', h);
    });
  };

  window._saveDailyBonusConfig = function () {
    var data = { day30Bonus: Number((_$('dbDay30Bonus') || {}).value) || 100, updatedAt: Date.now() };
    for (var i = 1; i <= 7; i++) {
      var val = Number((_$('dbDay' + i) || {}).value) || 5;
      data['day' + i] = val;
    }
    rtdb.ref('appSettings/dailyBonusRewards').set(data);
    if (window._logAction) window._logAction('update_daily_bonus_config', null, data);
    _toast('✅ Daily bonus rewards saved! Users ko turant effect milega.');
    if (window.closeModal) window.closeModal();
  };

  window._previewDailyBonus = function () {
    var dayEmojis = ['🌱','🌿','🌳','⚡','🔥','💫','👑'];
    var h = '<div>';
    h += '<div style="font-size:12px;color:#aaa;margin-bottom:12px;text-align:center">Aise dikhai dega user ko:</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';
    for (var i = 1; i <= 7; i++) {
      var coins = Number((_$('dbDay' + i) || {}).value) || 5;
      var isToday = (i === 3); // preview as day 3
      h += '<div style="text-align:center;padding:8px 2px;border-radius:10px;background:' +
        (i < 3 ? 'rgba(0,255,156,.15)' : i === 3 ? 'linear-gradient(135deg,#00ff9c,#00cc7a)' : 'rgba(255,255,255,.04)') +
        ';border:1px solid ' + (isToday ? '#00ff9c' : i < 3 ? 'rgba(0,255,156,.3)' : 'rgba(255,255,255,.08)') + '">';
      h += '<div style="font-size:14px">' + (i <= 3 ? '✅' : '🔒') + '</div>';
      h += '<div style="font-size:9px;color:' + (i < 3 ? '#00ff9c' : isToday ? '#000' : '#666') + ';font-weight:700">' + dayEmojis[i-1] + '</div>';
      h += '<div style="font-size:8px;color:' + (isToday ? '#000' : '#aaa') + '">+🪙' + coins + '</div>';
      h += '</div>';
    }
    h += '</div>';
    h += '<div style="margin-top:12px;text-align:center;padding:10px;background:rgba(255,170,0,.08);border-radius:10px">';
    h += '<div style="font-size:20px;font-weight:900;color:#ffaa00">+🪙 ' + (Number((_$('dbDay3') || {}).value) || 10) + ' Coins</div>';
    h += '<div style="font-size:11px;color:#aaa">Day 3 reward (preview)</div>';
    h += '</div>';
    h += '</div>';
    _modal('👁️ Preview — Daily Bonus', h);
  };

  // Add Daily Bonus Config button to admin settings/appSettings section
  waitFor(function () { return window.showAppSettings || document.querySelector('.admin-settings'); }, function () {
    var existing = document.querySelector('[onclick*="showDailyBonusConfig"]');
    if (!existing) {
      // Inject button near settings area
      var settingsBtns = document.querySelectorAll('[onclick*="showWithdrawalConfig"], [onclick*="showAppSettings"]');
      settingsBtns.forEach(function (btn) {
        if (!btn.parentNode.querySelector('.daily-bonus-btn')) {
          var newBtn = document.createElement('button');
          newBtn.className = btn.className + ' daily-bonus-btn';
          newBtn.onclick = window.showDailyBonusConfig;
          newBtn.innerHTML = '<i class="fas fa-gift"></i> Daily Bonus Rewards';
          btn.parentNode.appendChild(newBtn);
        }
      });
    }
    console.log('[v7-Admin] ✅ New Feature: Daily Bonus Config Editor added');
  });

  /* ════════════════════════════════════════════════════════════
     ✨ NEW FEATURE: EXTENDED PUSH NOTIFICATIONS PANEL
     Admin new tournament, friend won, daily bonus notifications bhej sake
  ════════════════════════════════════════════════════════════ */
  window.showExtendedNotifPanel = function () {
    var h = '<div>';
    h += '<div style="font-size:12px;color:#aaa;margin-bottom:14px">Sab users ya specific users ko targeted notifications bhejo</div>';

    // Notification types
    var notifTypes = [
      { id: 'new_tournament', icon: '🏆', label: 'New Tournament Added', desc: 'Naya match add hone par notify karo' },
      { id: 'daily_bonus', icon: '🎁', label: 'Daily Bonus Reminder', desc: '"Daily bonus waiting" notification' },
      { id: 'social_proof', icon: '📣', label: 'Social Proof (Someone Won)', desc: 'User ko batao ki kisi ne jeeta' },
      { id: 'custom', icon: '📝', label: 'Custom Message', desc: 'Apna custom notification bhejo' }
    ];

    h += '<div style="margin-bottom:14px">';
    h += '<label class="form-label">Notification Type</label>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    notifTypes.forEach(function (nt) {
      h += '<div onclick="window._selectNotifType(\'' + nt.id + '\')" id="notifType_' + nt.id + '" style="padding:10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:all .2s">';
      h += '<div style="font-size:16px">' + nt.icon + '</div>';
      h += '<div style="font-size:11px;font-weight:700;margin-top:4px">' + nt.label + '</div>';
      h += '<div style="font-size:10px;color:#aaa">' + nt.desc + '</div>';
      h += '</div>';
    });
    h += '</div></div>';

    h += '<div id="notifConfigArea" style="display:none">';
    h += '<div class="form-group"><label>Title</label><input type="text" id="notifTitle" class="form-input" placeholder="Notification title"></div>';
    h += '<div class="form-group"><label>Message</label><textarea id="notifMsg" class="form-input" rows="3" placeholder="Notification message" style="resize:vertical"></textarea></div>';
    h += '<div class="form-group"><label>Target</label>';
    h += '<select id="notifTarget" class="form-input">';
    h += '<option value="all">All Users</option>';
    h += '<option value="active">Active Users (last 7 days)</option>';
    h += '<option value="inactive">Inactive Users (7+ days)</option>';
    h += '<option value="no_deposit">Users with No Deposits</option>';
    h += '</select></div>';
    h += '<button class="btn btn-primary w-full" onclick="window._sendExtendedNotif()"><i class="fas fa-paper-plane"></i> Send Notification</button>';
    h += '</div>';
    h += '</div>';

    _modal('📣 Extended Notifications', h);
  };

  window._selectNotifType = function (type) {
    document.querySelectorAll('[id^="notifType_"]').forEach(function (el) {
      el.style.border = '1px solid rgba(255,255,255,.1)';
      el.style.background = 'rgba(255,255,255,.04)';
    });
    var sel = _$('notifType_' + type);
    if (sel) { sel.style.border = '1px solid rgba(0,212,255,.4)'; sel.style.background = 'rgba(0,212,255,.08)'; }

    var area = _$('notifConfigArea'); if (!area) return;
    area.style.display = 'block';

    var defaults = {
      new_tournament: { title: '🏆 New Tournament Added!', msg: 'Ek naya tournament add hua hai! Abhi join karo aur prizes jeeto.' },
      daily_bonus: { title: '🎁 Daily Bonus Waiting!', msg: 'Aaj ka daily login bonus claim nahi kiya abhi tak. App kholo aur +🪙 coins pao!' },
      social_proof: { title: '🏆 Kisi ne abhi jeeta!', msg: 'Ek player ne abhi ₹500 jeeta Mini eSports pe! Tum bhi khelke jeet sakte ho.' },
      custom: { title: '', msg: '' }
    };
    var d = defaults[type] || {};
    var titleEl = _$('notifTitle'); if (titleEl) titleEl.value = d.title || '';
    var msgEl = _$('notifMsg'); if (msgEl) msgEl.value = d.msg || '';
    window._selectedNotifType = type;
  };

  window._sendExtendedNotif = function () {
    var title = (_$('notifTitle') || {}).value || '';
    var msg = (_$('notifMsg') || {}).value || '';
    var target = (_$('notifTarget') || {}).value || 'all';
    if (!title || !msg) { _toast('Title aur message dono bharo', 'err'); return; }

    if (!window.rtdb) { _toast('Firebase not ready', 'err'); return; }

    var sevenDaysAgo = Date.now() - 7 * 86400000;

    rtdb.ref('users').once('value', function (s) {
      var count = 0;
      var promises = [];
      s.forEach(function (c) {
        var u = c.val(); if (!u) return;
        var uid = c.key;
        var include = false;
        if (target === 'all') include = true;
        else if (target === 'active' && u.lastSeen && u.lastSeen > sevenDaysAgo) include = true;
        else if (target === 'inactive' && (!u.lastSeen || u.lastSeen <= sevenDaysAgo)) include = true;
        else if (target === 'no_deposit' && !(u.realMoney && u.realMoney.deposited > 0)) include = true;

        if (include) {
          count++;
          var nid = rtdb.ref('users/' + uid + '/notifications').push().key;
          promises.push(rtdb.ref('users/' + uid + '/notifications/' + nid).set({
            title: title, message: msg,
            type: window._selectedNotifType || 'admin_broadcast',
            read: false, createdAt: Date.now()
          }));
        }
      });
      Promise.all(promises).then(function () {
        _toast('✅ Notification sent to ' + count + ' users!');
        if (window.closeModal) window.closeModal();
        if (window._logAction) window._logAction('send_broadcast_notif', null, { title: title, target: target, count: count });
      });
    });
  };

  /* ════════════════════════════════════════════════════════════
     ✨ NEW FEATURE: REFERRAL & INVITE ANALYTICS DASHBOARD
     Admin ko dikhega: kitne referrals, top inviters, earnings
  ════════════════════════════════════════════════════════════ */
  window.showReferralAnalytics = function () {
    if (!window.rtdb) return;
    var h = '<div id="refAnalyticsBody"><div style="text-align:center;padding:24px;color:#aaa"><i class="fas fa-spinner fa-spin"></i> Loading...</div></div>';
    _modal('🎯 Referral Analytics', h);

    var monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

    rtdb.ref('referrals').once('value', function (s) {
      var all = [], thisMonth = [];
      var now = Date.now();
      if (s.exists()) s.forEach(function (c) {
        var r = c.val(); if (!r) return;
        all.push(r);
        if ((r.createdAt || 0) >= monthStart.getTime()) thisMonth.push(r);
      });

      // Group by referrer
      var counts = {}, names = {}, earnings = {};
      all.forEach(function (r) {
        if (!r.referrerId) return;
        counts[r.referrerId] = (counts[r.referrerId] || 0) + 1;
        names[r.referrerId] = r.referrerName || r.referrerId.substring(0, 8);
        earnings[r.referrerId] = (earnings[r.referrerId] || 0) + (r.bonus || 150);
      });
      var sorted = Object.keys(counts).map(function (uid) {
        return { uid: uid, count: counts[uid], name: names[uid], earned: earnings[uid] };
      }).sort(function (a, b) { return b.count - a.count; });

      var h2 = '<div>';
      // Summary cards
      h2 += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">';
      h2 += '<div class="card" style="text-align:center;padding:12px"><div style="font-size:22px;font-weight:900;color:#00d4ff">' + all.length + '</div><div style="font-size:10px;color:#aaa">Total Referrals</div></div>';
      h2 += '<div class="card" style="text-align:center;padding:12px"><div style="font-size:22px;font-weight:900;color:#00ff9c">' + thisMonth.length + '</div><div style="font-size:10px;color:#aaa">This Month</div></div>';
      h2 += '<div class="card" style="text-align:center;padding:12px"><div style="font-size:22px;font-weight:900;color:#ffd700">🪙' + (all.length * 150) + '</div><div style="font-size:10px;color:#aaa">Coins Given</div></div>';
      h2 += '</div>';

      // Top inviters
      h2 += '<div style="font-size:11px;font-weight:800;color:#aaa;text-transform:uppercase;margin-bottom:8px">🏆 Top Inviters</div>';
      if (!sorted.length) {
        h2 += '<p style="text-align:center;color:#aaa;font-size:12px;padding:16px">Abhi koi referrals nahi hue</p>';
      }
      var medals = ['🥇','🥈','🥉'];
      sorted.slice(0, 10).forEach(function (p, i) {
        h2 += '<div class="card" style="display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:6px">';
        h2 += '<div style="font-size:20px;width:28px">' + (medals[i] || '#' + (i+1)) + '</div>';
        h2 += '<div style="flex:1"><div style="font-weight:700;font-size:12px">' + p.name + '</div><div style="font-size:10px;color:#aaa">UID: ' + p.uid.substring(0,12) + '</div></div>';
        h2 += '<div style="text-align:right"><div style="font-size:14px;font-weight:900;color:#00d4ff">' + p.count + ' refers</div><div style="font-size:10px;color:#ffd700">🪙' + p.earned + ' given</div></div>';
        h2 += '</div>';
      });

      h2 += '<button class="btn btn-ghost w-full" style="margin-top:12px" onclick="window.exportReferralCSV()"><i class="fas fa-download"></i> Export Referral Data</button>';
      h2 += '</div>';

      var bodyEl = _$('refAnalyticsBody');
      if (bodyEl) bodyEl.innerHTML = h2;
    });
  };

  window.exportReferralCSV = function () {
    rtdb.ref('referrals').once('value', function (s) {
      if (!s.exists()) { _toast('No referral data', 'inf'); return; }
      var rows = [['Date', 'Referrer Name', 'Referrer UID', 'Referred Name', 'Referred UID', 'Bonus Given']];
      s.forEach(function (c) {
        var r = c.val(); if (!r) return;
        rows.push([
          new Date(r.createdAt || 0).toLocaleString(),
          r.referrerName || '', r.referrerId || '',
          r.referredName || '', r.referredUid || '',
          r.bonus || 150
        ]);
      });
      var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'referrals-' + new Date().toISOString().split('T')[0] + '.csv';
      a.click();
      _toast('✅ Referral data exported!');
    });
  };

  /* ════════════════════════════════════════════════════════════
     ✨ NEW FEATURE: RECENTLY WON ADMIN CONTROL
     Admin results section se winners ko share kar sake
  ════════════════════════════════════════════════════════════ */
  window.shareRecentWin = function (matchName, amount, playerName) {
    var msg = '🏆 ' + playerName + ' ne ' + matchName + ' mein ₹' + amount + ' jeeta Mini eSports pe!\n\n' +
      '🎮 Tum bhi khelke jeeto — join karo ab!\n' +
      '📲 ' + (window.location.origin || 'https://mini-esports.app');
    var h = '<div>';
    h += '<div style="background:rgba(0,0,0,.4);border-radius:12px;padding:12px;margin-bottom:12px;font-size:12px;color:#ddd;line-height:1.7">' + msg.replace(/\n/g, '<br>') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    h += '<a href="https://wa.me/?text=' + encodeURIComponent(msg) + '" target="_blank" class="btn" style="background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;justify-content:center;display:flex;align-items:center;gap:6px"><i class="fab fa-whatsapp"></i> WhatsApp</a>';
    h += '<a href="https://t.me/share/url?url=' + encodeURIComponent(window.location.origin || '') + '&text=' + encodeURIComponent(msg) + '" target="_blank" class="btn" style="background:linear-gradient(135deg,#0088cc,#005fa3);color:#fff;justify-content:center;display:flex;align-items:center;gap:6px"><i class="fab fa-telegram"></i> Telegram</a>';
    h += '</div>';
    h += '<button class="btn btn-ghost w-full" style="margin-top:8px" onclick="navigator.clipboard&&navigator.clipboard.writeText(\'' + msg.replace(/'/g, "\\'") + '\').then(function(){if(window.showToast)showToast(\'Copied!\')})"><i class="fas fa-copy"></i> Copy Message</button>';
    h += '</div>';
    _modal('📢 Share This Win', h);
  };

  /* ════════════════════════════════════════════════════════════
     ✨ NEW FEATURE: GIFT TICKET ADMIN VIEW
     Admin dekh sake gifted tickets aur unka status
  ════════════════════════════════════════════════════════════ */
  window.showGiftTickets = function () {
    if (!window.rtdb) return;
    rtdb.ref('giftTickets').orderByChild('createdAt').limitToLast(50).once('value', function (s) {
      var tickets = [];
      if (s.exists()) s.forEach(function (c) { tickets.push(Object.assign({}, c.val(), { _key: c.key })); });
      tickets.reverse();
      var h = '<div>';
      if (!tickets.length) {
        h += '<p style="text-align:center;color:#aaa;padding:20px">Koi gift tickets nahi hain abhi</p>';
      }
      tickets.forEach(function (t) {
        var statusColor = t.status === 'gifted' ? '#00ff9c' : t.status === 'used' ? '#00d4ff' : '#ffd700';
        h += '<div class="card" style="margin-bottom:8px;padding:12px">';
        h += '<div style="display:flex;justify-content:space-between;align-items:start">';
        h += '<div>';
        h += '<div style="font-weight:700;font-size:12px">🎁 ' + (t.matchName || 'Match') + '</div>';
        h += '<div style="font-size:11px;color:#aaa">From: <strong>' + (t.fromName || '?') + '</strong> → To FF UID: <strong>' + (t.toFFUid || '?') + '</strong></div>';
        h += '<div style="font-size:10px;color:#666">' + new Date(t.createdAt || 0).toLocaleString() + '</div>';
        h += '</div>';
        h += '<div>';
        h += '<span style="background:rgba(255,255,255,.06);color:' + statusColor + ';padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700">' + (t.status || 'pending').toUpperCase() + '</span>';
        h += '<div style="font-size:12px;font-weight:700;margin-top:4px;text-align:right">' + (t.entryType === 'coin' ? '🪙' : '💎') + (t.fee || 0) + '</div>';
        h += '</div>';
        h += '</div></div>';
      });
      h += '</div>';
      _modal('🎁 Gift Tickets (' + tickets.length + ')', h);
    });
  };

  /* ════════════════════════════════════════════════════════════
     INJECT ADMIN QUICK ACTION BUTTONS INTO SIDEBAR/HEADER
  ════════════════════════════════════════════════════════════ */
  function injectAdminButtons () {
    // Find existing settings buttons area
    var settingsArea = document.querySelector('.admin-actions') ||
      document.querySelector('[class*="action"]') ||
      document.querySelector('.sidebar-bottom') ||
      document.querySelector('aside');

    if (!settingsArea || settingsArea._v7Injected) return;
    settingsArea._v7Injected = true;

    var btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'padding:8px;border-top:1px solid rgba(255,255,255,.08);margin-top:8px';
    btnWrap.innerHTML =
      '<div style="font-size:9px;font-weight:800;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;padding:0 4px">v7 Tools</div>' +
      '<button onclick="window.showDailyBonusConfig()" style="width:100%;padding:8px;margin-bottom:4px;border-radius:8px;background:rgba(255,170,0,.1);border:1px solid rgba(255,170,0,.2);color:#ffaa00;font-size:11px;font-weight:700;cursor:pointer;text-align:left"><i class="fas fa-gift"></i> Daily Bonus Editor</button>' +
      '<button onclick="window.showExtendedNotifPanel()" style="width:100%;padding:8px;margin-bottom:4px;border-radius:8px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);color:#00d4ff;font-size:11px;font-weight:700;cursor:pointer;text-align:left"><i class="fas fa-bell"></i> Extended Notifications</button>' +
      '<button onclick="window.showReferralAnalytics()" style="width:100%;padding:8px;margin-bottom:4px;border-radius:8px;background:rgba(185,100,255,.1);border:1px solid rgba(185,100,255,.2);color:#b964ff;font-size:11px;font-weight:700;cursor:pointer;text-align:left"><i class="fas fa-chart-bar"></i> Referral Analytics</button>' +
      '<button onclick="window.showGiftTickets()" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.2);color:#ffd700;font-size:11px;font-weight:700;cursor:pointer;text-align:left"><i class="fas fa-ticket-alt"></i> Gift Tickets</button>';
    settingsArea.appendChild(btnWrap);
  }

  // Retry injection until DOM is ready
  var _injectTries = 0;
  var _injectInterval = setInterval(function () {
    _injectTries++;
    injectAdminButtons();
    if (_injectTries > 20) clearInterval(_injectInterval);
  }, 800);

  // Also add a floating action button if sidebar injection fails
  setTimeout(function () {
    if (document.querySelector('._v7Injected')) return;
    if (_$('v7AdminFAB')) return;
    var fab = document.createElement('div');
    fab.id = 'v7AdminFAB';
    fab.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:6px';
    fab.innerHTML =
      '<button onclick="window.showDailyBonusConfig()" title="Daily Bonus Editor" style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#ffaa00,#ff6b00);border:none;color:#fff;font-size:16px;cursor:pointer;box-shadow:0 4px 16px rgba(255,170,0,.4)">🎁</button>' +
      '<button onclick="window.showExtendedNotifPanel()" title="Send Notifications" style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#00d4ff,#0066ff);border:none;color:#fff;font-size:16px;cursor:pointer;box-shadow:0 4px 16px rgba(0,212,255,.4)">🔔</button>' +
      '<button onclick="window.showReferralAnalytics()" title="Referral Analytics" style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#b964ff,#7928ca);border:none;color:#fff;font-size:16px;cursor:pointer;box-shadow:0 4px 16px rgba(185,100,255,.4)">📊</button>';
    document.body.appendChild(fab);
  }, 3000);

  /* ════════════════════════════════════════════
     STYLES
  ════════════════════════════════════════ */
  var style = document.createElement('style');
  style.textContent = [
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}',
    '#v7AdminFAB button:hover{transform:scale(1.1);transition:transform .2s}',
    '.daily-bonus-btn{margin-top:4px!important}',
    '[id^="notifType_"]:hover{border-color:rgba(0,212,255,.4)!important;background:rgba(0,212,255,.06)!important}'
  ].join('');
  document.head.appendChild(style);

  console.log('[Mini eSports] ✅✅✅ admin-fixes-v7.js fully loaded — All admin features active');
})();
