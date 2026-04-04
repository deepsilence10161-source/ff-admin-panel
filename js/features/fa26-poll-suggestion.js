/* ADMIN FEATURE A26: Poll + Suggestion Management
   - Admin polls create/manage karo (with optional image)
   - User suggestions review, reward, reply karo
*/
(function(){
'use strict';

/* ══════════════════════════════════════
   PART 1: POLL MANAGEMENT
══════════════════════════════════════ */

window.showPollManager = function() {
  var rt = window.rtdb || window.db;
  if (!rt) return;

  rt.ref('polls').orderByChild('createdAt').limitToLast(20).once('value', function(s) {
    var polls = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; polls.unshift(d); });

    var h = '<div>';
    h += '<button onclick="openCreatePollForm()" style="width:100%;padding:11px;border-radius:10px;background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;font-weight:800;border:none;cursor:pointer;margin-bottom:14px;font-size:13px">+ Create New Poll</button>';

    if (!polls.length) {
      h += '<div style="text-align:center;padding:20px;color:#aaa">Koi polls nahi hain abhi. Create karo!</div>';
    }

    polls.forEach(function(poll) {
      var totalVotes = poll.totalVotes || 0;
      var isActive = poll.status === 'active';
      var opts = poll.options || {};

      h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(' + (isActive ? '0,212,255' : '255,255,255') + ',.15);border-radius:12px;padding:12px;margin-bottom:10px">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      h += '<span style="font-size:13px;font-weight:700;color:var(--txt,#fff);flex:1;margin-right:8px">' + (poll.question || 'Poll') + '</span>';
      h += '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:rgba(' + (isActive ? '0,255,156,.15)' : '255,100,100,.15)') + ';color:' + (isActive ? '#00ff9c' : '#ff6464') + '">' + (isActive ? '🟢 Active' : '🔴 Closed') + '</span>';
      h += '</div>';

      // Results
      h += '<div style="margin:8px 0">';
      Object.keys(opts).forEach(function(optKey) {
        var opt = opts[optKey];
        var votes = opt.votes || 0;
        var pct = totalVotes > 0 ? Math.round((votes/totalVotes)*100) : 0;
        h += '<div style="margin-bottom:4px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">';
        h += '<span>' + (opt.label || optKey) + '</span><span style="color:#00d4ff">' + pct + '% (' + votes + ')</span></div>';
        h += '<div style="height:4px;background:rgba(255,255,255,.08);border-radius:4px"><div style="height:100%;width:' + pct + '%;background:#00d4ff;border-radius:4px"></div></div></div>';
      });
      h += '</div>';
      h += '<div style="font-size:10px;color:#666;margin-bottom:8px">Total: ' + totalVotes + ' votes</div>';

      h += '<div style="display:flex;gap:6px">';
      if (isActive) {
        h += '<button onclick="closePoll(\'' + poll._key + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,100,100,.12);border:1px solid rgba(255,100,100,.25);color:#ff6464;font-size:11px;font-weight:700;cursor:pointer">🔴 Close Poll</button>';
      } else {
        h += '<button onclick="reopenPoll(\'' + poll._key + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(0,255,156,.08);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer">🟢 Reopen</button>';
      }
      h += '<button onclick="deletePoll(\'' + poll._key + '\')" style="padding:7px 10px;border-radius:8px;background:rgba(255,50,50,.08);border:1px solid rgba(255,50,50,.15);color:#ff4444;font-size:11px;cursor:pointer">🗑️</button>';
      h += '</div></div>';
    });

    h += '</div>';
    _adminModal('📊 Poll Manager', h);
  });
};

function _adminModal(title, content) {
  if (window.showAdminModal) showAdminModal(title, content);
  else if (window.showModal) showModal(title, content);
}

function _closeModal() {
  var m = document.getElementById('adminModalOverlay') || document.getElementById('genericModal');
  if (m) m.classList.remove('show');
}

window.openCreatePollForm = function() {
  var h = '<div>';
  h += '<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Question</label>';
  h += '<input id="pollQ" type="text" maxlength="150" placeholder="e.g. Kya hum Squad matches barhayein?" style="width:100%;padding:9px;border-radius:9px;background:#111;border:1px solid #333;color:#fff;font-size:13px;box-sizing:border-box"></div>';

  h += '<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Description (optional)</label>';
  h += '<textarea id="pollDesc" rows="2" maxlength="200" placeholder="Thodi detail..." style="width:100%;padding:9px;border-radius:9px;background:#111;border:1px solid #333;color:#fff;font-size:12px;resize:none;box-sizing:border-box"></textarea></div>';

  h += '<div style="margin-bottom:10px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Options (ek per line, 2–4 options)</label>';
  h += '<textarea id="pollOpts" rows="4" placeholder="Haan, bilkul\nNahi, mat karo\nPehle solo fix karo" style="width:100%;padding:9px;border-radius:9px;background:#111;border:1px solid #333;color:#fff;font-size:13px;resize:none;box-sizing:border-box"></textarea></div>';

  h += '<div style="margin-bottom:14px"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">Screenshot URL (optional)</label>';
  h += '<input id="pollImg" type="url" placeholder="https://..." style="width:100%;padding:9px;border-radius:9px;background:#111;border:1px solid #333;color:#fff;font-size:12px;box-sizing:border-box"></div>';

  h += '<button onclick="createPoll()" style="width:100%;padding:12px;border-radius:10px;background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;font-weight:800;border:none;cursor:pointer;font-size:13px">📊 Create Poll</button>';
  h += '</div>';
  _adminModal('+ Create Poll', h);
};

window.createPoll = function() {
  var rt = window.rtdb || window.db;
  if (!rt) return;

  var q = ((document.getElementById('pollQ')||{}).value||'').trim();
  var desc = ((document.getElementById('pollDesc')||{}).value||'').trim();
  var optsRaw = ((document.getElementById('pollOpts')||{}).value||'').trim();
  var imgUrl = ((document.getElementById('pollImg')||{}).value||'').trim();

  if (!q) { if(window.showToast) showToast('Question likhna zaroori hai!'); return; }

  var optLines = optsRaw.split('\n').map(function(x) { return x.trim(); }).filter(function(x) { return x.length > 0; });
  if (optLines.length < 2 || optLines.length > 4) { if(window.showToast) showToast('2 se 4 options chahiye!'); return; }

  var options = {};
  optLines.forEach(function(label, idx) {
    options['opt' + (idx+1)] = { label: label, votes: 0 };
  });

  var pollData = {
    question: q,
    description: desc,
    options: options,
    totalVotes: 0,
    status: 'active',
    createdAt: Date.now(),
    createdBy: 'admin'
  };
  if (imgUrl) pollData.imageUrl = imgUrl;

  rt.ref('polls').push(pollData).then(function() {
    if(window.showToast) showToast('✅ Poll created! Users ko dikhai degi.');
    window.showPollManager();
  });
};

window.closePoll = function(key) {
  var rt = window.rtdb || window.db;
  if (!rt) return;
  rt.ref('polls/' + key).update({ status: 'closed' }).then(function() {
    if(window.showToast) showToast('Poll closed');
    window.showPollManager();
  });
};

window.reopenPoll = function(key) {
  var rt = window.rtdb || window.db;
  if (!rt) return;
  rt.ref('polls/' + key).update({ status: 'active' }).then(function() {
    if(window.showToast) showToast('Poll reopened');
    window.showPollManager();
  });
};

window.deletePoll = function(key) {
  var rt = window.rtdb || window.db;
  if (!rt || !confirm('Poll delete karna hai?')) return;
  rt.ref('polls/' + key).remove().then(function() {
    if(window.showToast) showToast('Deleted');
    window.showPollManager();
  });
};

/* ══════════════════════════════════════
   PART 2: SUGGESTION MANAGEMENT
══════════════════════════════════════ */

window.showSuggestionManager = function() {
  var rt = window.rtdb || window.db;
  if (!rt) return;

  var _filter = window._sgFilter || 'pending';

  rt.ref('suggestions').orderByChild('status').equalTo(_filter).limitToLast(30).once('value', function(s) {
    var list = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; list.unshift(d); });
    list.sort(function(a,b) { return (b.upvotes||0) - (a.upvotes||0); });

    var catIcons = { bug: '🐛', feature: '✨', ux: '🎨', fraud: '🛡️', other: '💬' };
    var h = '<div>';

    // Filter tabs
    h += '<div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto">';
    ['pending','approved','rejected','rewarded'].forEach(function(f) {
      var active = _filter === f;
      h += '<button onclick="window._sgFilter=\'' + f + '\';showSuggestionManager()" style="padding:6px 12px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;cursor:pointer;border:1px solid ' + (active ? '#00d4ff' : 'rgba(255,255,255,.1)') + ';background:' + (active ? 'rgba(0,212,255,.12)' : 'transparent') + ';color:' + (active ? '#00d4ff' : '#aaa') + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>';
    });
    h += '</div>';

    if (!list.length) {
      h += '<div style="text-align:center;padding:20px;color:#aaa">Koi suggestions nahi hain</div>';
    }

    list.forEach(function(sg) {
      h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;margin-bottom:10px">';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">';
      h += '<span style="font-size:13px;font-weight:700;flex:1;margin-right:8px">' + (catIcons[sg.category]||'💬') + ' ' + sg.title + '</span>';
      h += '<span style="font-size:10px;color:#aaa">👍 ' + (sg.upvotes||0) + '</span>';
      h += '</div>';
      h += '<div style="font-size:11px;color:#aaa;margin-bottom:8px">' + sg.description + '</div>';
      h += '<div style="font-size:10px;color:#666;margin-bottom:8px">By: ' + (sg.userName||'User') + ' • ' + new Date(sg.createdAt).toLocaleDateString('en-IN') + '</div>';
      if (sg.adminNote) h += '<div style="font-size:11px;color:#00d4ff;background:rgba(0,212,255,.06);border-radius:8px;padding:6px;margin-bottom:8px">Admin note: ' + sg.adminNote + '</div>';
      if (sg.reward) h += '<div style="font-size:11px;color:#ffd700;font-weight:700;margin-bottom:8px">🏆 Reward: ' + sg.reward + '</div>';

      if (_filter === 'pending') {
        h += '<div style="display:flex;gap:6px">';
        h += '<button onclick="approveSuggestion(\'' + sg._key + '\',\'' + (sg.uid||'') + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.25);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer">✅ Approve</button>';
        h += '<button onclick="rejectSuggestion(\'' + sg._key + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,100,100,.1);border:1px solid rgba(255,100,100,.25);color:#ff6464;font-size:11px;font-weight:700;cursor:pointer">❌ Reject</button>';
        h += '</div>';
      } else if (_filter === 'approved') {
        h += '<button onclick="rewardSuggestion(\'' + sg._key + '\',\'' + (sg.uid||'') + '\')" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,215,0,.12);border:1px solid rgba(255,215,0,.25);color:#ffd700;font-size:11px;font-weight:700;cursor:pointer">🏆 Send Reward</button>';
      }
      h += '</div>';
    });

    h += '</div>';
    _adminModal('💡 Suggestions (' + list.length + ')', h);
  });
};

window.approveSuggestion = function(key, uid) {
  var rt = window.rtdb || window.db;
  if (!rt) return;
  var note = prompt('Admin note (optional):') || 'Teri suggestion approve ho gayi! Implement karenge.';
  rt.ref('suggestions/' + key).update({ status: 'approved', adminNote: note, approvedAt: Date.now() });
  // Notify user
  if (uid) {
    var nk = rt.ref('users/' + uid + '/notifications').push().key;
    rt.ref('users/' + uid + '/notifications/' + nk).set({
      title: '✅ Suggestion Approved!',
      message: 'Teri suggestion accept ho gayi: ' + note,
      type: 'system', timestamp: Date.now(), read: false
    });
  }
  if(window.showToast) showToast('✅ Approved!');
  window.showSuggestionManager();
};

window.rejectSuggestion = function(key) {
  var rt = window.rtdb || window.db;
  if (!rt) return;
  rt.ref('suggestions/' + key).update({ status: 'rejected', rejectedAt: Date.now() });
  if(window.showToast) showToast('Rejected');
  window.showSuggestionManager();
};

window.rewardSuggestion = function(key, uid) {
  var rt = window.rtdb || window.db;
  if (!rt || !uid) return;

  var rewardType = prompt('Reward type:\n1 = Coins\n2 = Real Money\nEnter 1 or 2:');
  if (!rewardType) return;
  var amount = Number(prompt('Amount (coins/₹):'));
  if (!amount || amount <= 0) { if(window.showToast) showToast('Invalid amount'); return; }

  var rewardLabel = rewardType === '2' ? '₹' + amount : amount + ' coins';

  rt.ref('suggestions/' + key).update({ status: 'rewarded', reward: rewardLabel, rewardedAt: Date.now() });

  if (rewardType === '2') {
    rt.ref('users/' + uid + '/realMoney/bonus').transaction(function(v) { return (v||0) + amount; });
  } else {
    rt.ref('users/' + uid + '/coins').transaction(function(v) { return (v||0) + amount; });
  }

  // Notify user
  var nk = rt.ref('users/' + uid + '/notifications').push().key;
  rt.ref('users/' + uid + '/notifications/' + nk).set({
    title: '🏆 Suggestion Reward Mila!',
    message: 'Teri suggestion ke liye ' + rewardLabel + ' reward diya gaya! Shukriya!',
    type: 'wallet_approved', timestamp: Date.now(), read: false
  });

  if(window.showToast) showToast('🏆 Reward sent: ' + rewardLabel);
  window.showSuggestionManager();
};

console.log('[Admin] ✅ A26: Poll + Suggestion Manager loaded');
})();
