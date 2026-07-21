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
  /* Bug New-9 Fix: Read from Supabase polls table (source of truth).
     Firebase 'polls' path is inconsistent with user-side poll voting in Supabase.
     NOTE: createPoll still writes to Firebase (for user panel live updates via
     onValue listener), but admin READ now uses Supabase for accurate vote tallies. */
  var supa = window._supa;
  if (!supa) {
    // Fallback to Firebase if Supabase not ready
    _fa54FirebaseFallback();
    return;
  }

  supa.from('polls')
    .select('id,title,options,votes,status,created_at,image_url')
    .order('created_at', { ascending: false })
    .limit(20)
    .then(function (r) {
      var polls = r.data || [];

      var h = '<div>';
      h += '<button onclick="openCreatePollForm()" style="width:100%;padding:11px;border-radius:10px;background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;font-weight:800;border:none;cursor:pointer;margin-bottom:14px;font-size:13px">+ Create New Poll</button>';

      if (!polls.length) {
        h += '<div style="text-align:center;padding:20px;color:#aaa">Koi polls nahi hain abhi. Create karo!</div>';
      }

      polls.forEach(function(poll) {
        var opts    = Array.isArray(poll.options) ? poll.options : Object.values(poll.options || {});
        var votesMap = poll.votes || {};
        var totalVotes = Object.values(votesMap).reduce(function(a,b){ return a + (Number(b)||0); }, 0);
        var isActive = poll.status === 'active';

        h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(' + (isActive ? '0,212,255' : '255,255,255') + ',.15);border-radius:12px;padding:12px;margin-bottom:10px">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
        h += '<span style="font-size:13px;font-weight:700;color:var(--txt,#fff);flex:1;margin-right:8px">' + (poll.title || 'Poll') + '</span>';
        h += '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:rgba(' + (isActive ? '0,255,156,.15)' : '255,100,100,.15)') + ';color:' + (isActive ? '#00ff9c' : '#ff6464') + '">' + (isActive ? '🟢 Active' : '🔴 Closed') + '</span>';
        h += '</div>';

        h += '<div style="margin:8px 0">';
        opts.forEach(function(opt) {
          var label  = typeof opt === 'string' ? opt : (opt.label || opt.text || 'Option');
          var optKey = typeof opt === 'string' ? opt : (opt.id || label);
          var votes  = Number(votesMap[optKey] || votesMap[label] || 0);
          var pct    = totalVotes > 0 ? Math.round((votes/totalVotes)*100) : 0;
          h += '<div style="margin-bottom:4px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">';
          h += '<span>' + label + '</span><span style="color:#00d4ff">' + pct + '% (' + votes + ')</span></div>';
          h += '<div style="height:4px;background:rgba(255,255,255,.08);border-radius:4px"><div style="height:100%;width:' + pct + '%;background:#00d4ff;border-radius:4px"></div></div></div>';
        });
        h += '</div>';
        h += '<div style="font-size:10px;color:#666;margin-bottom:8px">Total: ' + totalVotes + ' votes</div>';

        h += '<div style="display:flex;gap:6px">';
        if (isActive) {
          h += '<button onclick="closePoll(\'' + poll.id + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,100,100,.12);border:1px solid rgba(255,100,100,.25);color:#ff6464;font-size:11px;font-weight:700;cursor:pointer">🔴 Close Poll</button>';
        } else {
          h += '<button onclick="reopenPoll(\'' + poll.id + '\')" style="flex:1;padding:7px;border-radius:8px;background:rgba(0,255,156,.08);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer">🟢 Reopen</button>';
        }
        h += '<button onclick="deletePoll(\'' + poll.id + '\')" style="padding:7px 10px;border-radius:8px;background:rgba(255,50,50,.08);border:1px solid rgba(255,50,50,.15);color:#ff4444;font-size:11px;cursor:pointer">🗑️</button>';
        h += '</div></div>';
      });

      h += '</div>';
      _adminModal('📊 Poll Manager', h);
    }).catch(function(e) {
      console.error('[fa54] Supabase polls error:', e.message);
      _fa54FirebaseFallback(); // graceful fallback
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
  var supa = window._supa;
  if (!supa) { if(window.showToast) showToast('Supabase not ready — retry'); return; }

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

  /* Write directly to Supabase polls table — single source of truth */
  var pollRow = {
    question:    q,
    description: desc,
    options:     options,      /* stored as JSONB */
    total_votes: 0,
    status:      'active',
    created_at:  new Date().toISOString(),
    created_by:  'admin'
  };
  if (imgUrl) pollRow.image_url = imgUrl;

  supa.from('polls').insert(pollRow)
    .then(function(r) {
      if (r.error) throw r.error;
      if(window.showToast) showToast('✅ Poll created! Users ko dikhai degi.');
      window.showPollManager();
    })
    .catch(function(e) {
      console.error('[fa26] createPoll failed:', e.message);
      if(window.showToast) showToast('Poll create failed: ' + e.message, true);
    });
};

window.closePoll = function(key) {
  var supa = window._supa;
  /* Supabase is source of truth — single write only */
  if (supa) {
    supa.from('polls').update({ status: 'closed' }).eq('id', key)
      .then(function() { if(window.showToast) showToast('Poll closed'); window.showPollManager(); })
      .catch(function(e) { console.error('[fa26] closePoll failed:', e.message); });
  }
};

window.reopenPoll = function(key) {
  var supa = window._supa;
  if (supa) {
    supa.from('polls').update({ status: 'active' }).eq('id', key)
      .then(function() { if(window.showToast) showToast('Poll reopened'); window.showPollManager(); })
      .catch(function(e) { console.error('[fa26] reopenPoll failed:', e.message); });
  }
};

window.deletePoll = function(key) {
  if (!confirm('Poll delete karna hai?')) return;
  var supa = window._supa;
  if (supa) {
    supa.from('polls').delete().eq('id', key)
      .then(function() { if(window.showToast) showToast('Deleted'); window.showPollManager(); })
      .catch(function(e) { console.error('[fa26] deletePoll failed:', e.message); });
  }
};

/* Firebase fallback for showPollManager (when Supabase unavailable) */
function _fa54FirebaseFallback() {
  var rt = window.rtdb || window.db;
  if (!rt) { _adminModal('📊 Poll Manager', '<div style="padding:20px;text-align:center;color:#888">Koi data source available nahi</div>'); return; }
  rt.ref('polls').orderByChild('createdAt').limitToLast(20).once('value', function(s) {
    var polls = [];
    if (s.exists()) s.forEach(function(c) { var d = c.val(); d._key = c.key; polls.unshift(d); });
    var h = '<div><button onclick="openCreatePollForm()" style="width:100%;padding:11px;border-radius:10px;background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;font-weight:800;border:none;cursor:pointer;margin-bottom:14px;font-size:13px">+ Create New Poll</button>';
    if (!polls.length) h += '<div style="text-align:center;padding:20px;color:#aaa">Koi polls nahi hain abhi.</div>';
    polls.forEach(function(poll) {
      var totalVotes = poll.totalVotes || 0;
      var isActive   = poll.status === 'active';
      var opts       = poll.options || {};
      h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;margin-bottom:10px">';
      h += '<div style="font-size:13px;font-weight:700;margin-bottom:4px">' + (poll.question||'Poll') + '</div>';
      Object.keys(opts).forEach(function(k) {
        var o = opts[k]; var v = o.votes||0; var p = totalVotes>0?Math.round((v/totalVotes)*100):0;
        h += '<div style="font-size:11px;color:#aaa;margin-bottom:2px">' + (o.label||k) + ': ' + p + '% (' + v + ')</div>';
      });
      h += '<div style="font-size:10px;color:#555">Total: ' + totalVotes + ' votes · ' + (isActive?'🟢 Active':'🔴 Closed') + '</div></div>';
    });
    h += '</div>';
    _adminModal('📊 Poll Manager (Firebase)', h);
  });
}

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

/* ── User Suggestions (Supabase) — v32.4 ──────────────────────────
   The user panel's new "My Suggestions" feature saves to the
   user_suggestions Supabase table. This admin view lets admins see
   all submissions, filter by status, and send a reply (stored in
   admin_reply column so the user sees it in their panel). Separate
   from the older Firebase-based suggestion manager above which
   handled staff-only internal tool requests. */
window.showUserSuggestions = function() {
  var supa = window._supa || window.supabase;
  if (!supa) { if(window.showToast) showToast('Supabase not ready'); return; }

  var _filter = window._usgFilter || 'pending';

  function render(rows) {
    var statusCols = { pending:'#888', reviewed:'#00d4ff', implemented:'#00ff9c', declined:'#ff6b6b' };
    var h = '';

    /* Filter tabs */
    h += '<div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto">';
    ['pending','reviewed','implemented','declined'].forEach(function(f) {
      var active = _filter === f;
      h += '<button onclick="window._usgFilter=\'' + f + '\';showUserSuggestions()" style="padding:6px 12px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;cursor:pointer;border:1px solid ' + (active ? '#ffd700' : 'rgba(255,255,255,.1)') + ';background:' + (active ? 'rgba(255,215,0,.1)' : 'transparent') + ';color:' + (active ? '#ffd700' : '#aaa') + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>';
    });
    h += '</div>';

    if (!rows.length) {
      h += '<div style="text-align:center;padding:20px;color:#aaa">Is filter mein koi suggestion nahi hai</div>';
    }

    rows.forEach(function(sg) {
      var col = statusCols[sg.status] || '#888';
      var dt = sg.created_at ? new Date(sg.created_at).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'2-digit'}) : '';
      h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px;margin-bottom:8px">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      h += '<span style="font-size:10px;font-weight:800;color:' + col + '">' + sg.status.toUpperCase() + '</span>';
      h += '<span style="font-size:10px;color:#555">' + dt + '</span>';
      h += '</div>';
      h += '<div style="font-size:13px;color:#ccc;line-height:1.5;margin-bottom:8px">' + (sg.message || '').replace(/</g,'&lt;') + '</div>';
      h += '<div style="font-size:10px;color:#666;margin-bottom:8px">User: ' + (sg.user_id || '').slice(0,12) + '…</div>';
      if (sg.admin_reply) {
        h += '<div style="padding:8px 10px;border-radius:8px;background:rgba(0,212,255,.07);border-left:2px solid #00d4ff;margin-bottom:8px">';
        h += '<div style="font-size:10px;font-weight:800;color:#00d4ff;margin-bottom:2px">Tumhari Reply:</div>';
        h += '<div style="font-size:12px;color:#aaa">' + (sg.admin_reply || '').replace(/</g,'&lt;') + '</div></div>';
      }
      h += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
      ['reviewed','implemented','declined'].forEach(function(ns) {
        if (sg.status === ns) return;
        var btnCols = {reviewed:'rgba(0,212,255,.1)/rgba(0,212,255,.3)/#00d4ff', implemented:'rgba(0,255,156,.1)/rgba(0,255,156,.3)/#00ff9c', declined:'rgba(255,107,107,.1)/rgba(255,107,107,.3)/#ff6b6b'};
        var bc = (btnCols[ns]||'').split('/');
        h += '<button onclick="_usgSetStatus(\'' + sg.id + '\',\'' + ns + '\')" style="padding:6px 10px;border-radius:8px;background:' + (bc[0]||'rgba(255,255,255,.05)') + ';border:1px solid ' + (bc[1]||'rgba(255,255,255,.1)') + ';color:' + (bc[2]||'#aaa') + ';font-size:10px;font-weight:700;cursor:pointer">' + ns.charAt(0).toUpperCase() + ns.slice(1) + '</button>';
      });
      h += '<button onclick="_usgReply(\'' + sg.id + '\')" style="padding:6px 10px;border-radius:8px;background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.2);color:#ffd700;font-size:10px;font-weight:700;cursor:pointer">✏️ Reply</button>';
      h += '</div></div>';
    });
    _adminModal('💡 User Suggestions (' + rows.length + ')', h);
  }

  supa.from('user_suggestions').select('*').eq('status', _filter).order('created_at', {ascending:false}).limit(30)
    .then(function(r) { render(r.data||[]); })
    .catch(function(e) { if(window.showToast) showToast('Load fail: ' + e.message, true); });
};

window._usgSetStatus = function(id, status) {
  var supa = window._supa || window.supabase;
  if (!supa) return;
  supa.from('user_suggestions').update({ status: status, updated_at: new Date().toISOString() }).eq('id', id)
    .then(function() { if(window.showToast) showToast('Status updated: ' + status); window.showUserSuggestions(); })
    .catch(function(e) { if(window.showToast) showToast('Update fail: ' + e.message, true); });
};

window._usgReply = function(id) {
  var reply = prompt('User ko reply likho:');
  if (!reply || !reply.trim()) return;
  var supa = window._supa || window.supabase;
  if (!supa) return;
  supa.from('user_suggestions').update({ admin_reply: reply.trim(), status: 'reviewed', updated_at: new Date().toISOString() }).eq('id', id)
    .then(function() { if(window.showToast) showToast('Reply bhej diya!'); window.showUserSuggestions(); })
    .catch(function(e) { if(window.showToast) showToast('Reply fail: ' + e.message, true); });
};

console.log('[Admin] ✅ A26: Poll + Suggestion Manager loaded');
})();
