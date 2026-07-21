/* =============================================
   FEATURE A04: Smart Bulk Notification Sender
   - Admin sab users ko ya specific group ko notification bheje
   - Pre-written templates available hain
   - Target: All / Verified Only / Active Only / Specific Match Players
   - Firebase: notifications/ node me push hota hai
   ============================================= */
(function() {
  'use strict';

  var NOTIF_TEMPLATES = [
    { icon: '🔥', title: 'New Match Live!', body: 'Nayi match available hai — abhi join karo aur prize jeeto!' },
    { icon: '💰', title: 'Special Prize Pool!', body: 'Aaj ki match me double prize pool hai! Limited slots — jaldi karo.' },
    { icon: '🎉', title: 'Weekend Special!', body: 'Weekend Special Match shuru ho gayi hai. Extra coins + cash prizes!' },
    { icon: '⚡', title: 'Flash Match Alert!', body: '30 min mein special flash match — abhi join karo!' },
    { icon: '🏆', title: 'Tournament Results', body: 'Is hafte ke tournament results announce ho gaye hain. Check karo!' },
    { icon: '🎁', title: 'Free Coins Event!', body: 'Aaj free check-in karo aur double coins pao. Limited time offer!' },
    { icon: '📣', title: 'Maintenance Notice', body: 'App kal raat 2-3 AM maintenance ke liye band rahega. Apna balance save karo.' }
  ];

  function showBulkNotifSender() {
    var h = '<div>';
    h += '<div class="form-group"><label>Target Users</label><select id="fa04Target" class="form-input"><option value="all">🌍 All Users</option><option value="verified">✅ Verified Only</option><option value="active">🟢 Active (7 days)</option></select></div>';
    h += '<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Quick Templates:</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    NOTIF_TEMPLATES.forEach(function(t, i) {
      h += '<span onclick="window.fA04Notif.applyTemplate(' + i + ')" style="padding:4px 10px;border-radius:20px;background:var(--bg-dark);border:1px solid var(--border);font-size:10px;cursor:pointer;color:var(--text)">' + t.icon + ' ' + t.title + '</span>';
    });
    h += '</div></div>';
    h += '<div class="form-group"><label>Title</label><input type="text" id="fa04Title" class="form-input" placeholder="Notification title..." maxlength="60"></div>';
    h += '<div class="form-group"><label>Message</label><textarea id="fa04Body" class="form-input" placeholder="Notification message..." rows="3" maxlength="200" style="resize:vertical"></textarea></div>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
    h += '<div id="fa04Preview" style="font-size:11px;color:var(--text-muted)">0 users targeted</div>';
    h += '<button onclick="window.fA04Notif.preview()" class="btn btn-ghost btn-sm">Preview Count</button>';
    h += '</div>';
    h += '<button onclick="window.fA04Notif.send()" class="btn btn-primary" style="width:100%"><i class="fas fa-paper-plane"></i> Send Notification</button>';
    h += '</div>';

    showAdminModal('📣 Bulk Notification', h);
  }

  function getTargetUsers(target) {
    if (!window.usersCache) return [];
    var now = Date.now();
    return Object.keys(window.usersCache).filter(function(uid) {
      var u = window.usersCache[uid];
      if (!u) return false;
      if (target === 'verified') return u.profileVerified;
      if (target === 'active') {
        var ls = Number(u.lastSeen || u.lastLoginAt || 0);
        return now - ls < 7 * 24 * 60 * 60 * 1000;
      }
      return true; // all
    });
  }

  window.fA04Notif = {
    applyTemplate: function(idx) {
      var t = NOTIF_TEMPLATES[idx];
      if (!t) return;
      var titleEl = document.getElementById('fa04Title');
      var bodyEl = document.getElementById('fa04Body');
      if (titleEl) titleEl.value = t.title;
      if (bodyEl) bodyEl.value = t.body;
    },
    preview: function() {
      var target = document.getElementById('fa04Target') ? document.getElementById('fa04Target').value : 'all';
      var count = getTargetUsers(target).length;
      var prev = document.getElementById('fa04Preview');
      if (prev) prev.textContent = count + ' users ko notification milegi';
      if (prev) prev.style.color = 'var(--primary)';
    },
    send: function() {
      var target = document.getElementById('fa04Target') ? document.getElementById('fa04Target').value : 'all';
      var title = document.getElementById('fa04Title') ? document.getElementById('fa04Title').value.trim() : '';
      var body = document.getElementById('fa04Body') ? document.getElementById('fa04Body').value.trim() : '';

      if (!title) { showAdminToast('Title enter karo', true); return; }
      if (!body) { showAdminToast('Message enter karo', true); return; }

      var rtdb = window.rtdb || window.db;
      var supa = window._supa;

      /* Bug Critical #1 Fix + Medium #12 Fix:
         Write notifications to BOTH Firebase (push triggers) AND Supabase
         (user panel reads from Supabase notifications table, not Firebase).
         Previous code only wrote to Firebase — users never saw these. */

      if (target === 'all') {
        // Firebase global path (for real-time listeners)
        if (rtdb) {
          rtdb.ref('notifications').push({
            targetUserId: 'all', title: title, body: body,
            type: 'admin_alert', timestamp: Date.now(), icon: 'fa-bullhorn'
          });
        }
        // Supabase: insert a row with user_id = NULL + target_all = true so
        // all user-panel instances reading "notifications where user_id = me OR target_all = true" get it
        if (supa) {
          supa.from('notifications').insert({
            user_id: null,
            target_all: true,
            type: 'admin_alert',
            title: title,
            body: body,
            is_read: false
          }).catch(function(e){ console.warn('[fa04] Supabase all-notif fail:', e.message); });
        }
        showAdminToast('✅ Global notification sent!');
      } else {
        // Per-user notification
        var users = getTargetUsers(target);
        if (!users.length) { showAdminToast('Koi user nahi mila', true); return; }

        users.forEach(function(uid) {
          // Firebase
          if (rtdb) {
            rtdb.ref('users/' + uid + '/notifications').push({
              type: 'admin_alert', title: title, body: body, timestamp: Date.now(), read: false
            });
          }
          // Supabase — user panel reads from here
          if (supa) {
            supa.from('notifications').insert({
              user_id: uid, type: 'admin_alert', title: title, body: body, is_read: false
            }).catch(function(){});
          }
        });

        showAdminToast('✅ Notification ' + users.length + ' users ko bhej di!');
      }

      var modal = document.getElementById('adminModal');
      if (modal) modal.style.display = 'none';
    }
  };

  function showAdminToast(msg, isErr) { if (window.showToast) window.showToast(msg, isErr); }
  function showAdminModal(title, body) {
    var m = document.getElementById('adminModal'), mt = document.getElementById('adminModalTitle'), mb = document.getElementById('adminModalBody');
    if (m && mt && mb) { mt.textContent = title; mb.innerHTML = body; m.style.display = 'flex'; }
  }

  // Override existing showBulkMessage if present
  window.showBulkMessage = showBulkNotifSender;
  window.fA04BulkNotif = { show: showBulkNotifSender };
})();
