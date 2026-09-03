/* ================================================================
   ADMIN — CREATOR MATCH REVIEW + STRIKE MANAGEMENT
   fa-creator-video-review.js | Admin Panel (2026-08 full rewrite)

   REPURPOSED (2026-08): this file used to review auto-hidden creator
   VIDEOS via a Firebase-only system (creatorVideos/videoReports) that
   was never actually wired to anything in User Panel — that whole
   video-sharing feature was confirmed dead code and removed. This is
   now the review queue for creator-hosted MATCH RESULTS instead.

   How it fits the bigger picture: creator-hosted matches auto-approve
   and pay out the instant a result is submitted — admin does zero work
   for the vast majority of them. A result only lands here if
   creator_publish_result's anomaly checks flagged it (impossible kill
   count, suspicious repeat-winner pattern, or payout over the safety
   cap) — see that RPC's comments in the Supabase migration history.

   Talks directly to real Supabase tables/RPCs:
     creator_result_flags         — the flag queue itself
     admin_dismiss_creator_flag() — false alarm: pays out normally
     admin_confirm_creator_cheat()— confirmed cheat: voids match,
                                     refunds players, strikes creator
     users.creator_strikes / creator_suspended_until /
       creator_suspended_permanently — the running strike record
   ================================================================ */

(function() {
'use strict';

function supa() { return window._supa; }

/* ─── Load + Render flagged match results ──────────────────────── */
window.loadCreatorMatchFlags = function() {
  var cont = document.getElementById('creatorMatchFlagsContent');
  if (!cont) return;
  cont.innerHTML = '<div style="text-align:center;padding:30px;color:#666"><i class="fas fa-spinner fa-spin"></i> Loading flagged matches...</div>';

  if (!supa()) {
    cont.innerHTML = '<div style="color:#ff6b6b;padding:16px">Supabase not ready. Refresh karein.</div>';
    return;
  }

  supa().from('creator_result_flags')
    .select('id,match_id,creator_uid,reason,details,created_at,status')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .then(function(r) {
      if (r.error) { cont.innerHTML = '<div style="color:#ff6b6b;padding:16px">Load error: ' + _esc(r.error.message) + '</div>'; return; }
      var flags = r.data || [];
      _updateFlagBadge(flags.length);
      _renderFlags(cont, flags);
    });
};

function _updateFlagBadge(count) {
  var b = document.getElementById('creatorFlagBadge');
  if (!b) return;
  if (count > 0) { b.style.display = ''; b.textContent = count; }
  else { b.style.display = 'none'; }
}

var _REASON_LABELS = {
  impossible_kill_count: '💀 Impossible Kill Count — total kills lobby size se zyada',
  repeat_winner_pattern: '🔁 Repeat Winner Pattern — same player baar-baar #1',
  payout_cap_exceeded: '💰 Payout Cap Exceeded — match ka payout safety limit se zyada'
};

function _renderFlags(cont, flags) {
  if (!flags.length) {
    cont.innerHTML = '<div style="text-align:center;padding:30px;color:#666">✅ Koi flagged match nahi hai abhi — sab auto-approved matches theek se chal rahe hain.</div>';
    return;
  }

  // Batch-fetch creator IGNs + match titles so each card doesn't fire its own query
  var creatorUids = [...new Set(flags.map(function(f){ return f.creator_uid; }))];
  var matchIds = [...new Set(flags.map(function(f){ return f.match_id; }))];

  Promise.all([
    supa().from('users').select('id,ign').in('id', creatorUids),
    supa().from('matches').select('id,title,entry_fee,entry_type,filled_slots').in('id', matchIds)
  ]).then(function(results) {
    var creators = {}; (results[0].data || []).forEach(function(u){ creators[u.id] = u.ign; });
    var matches = {}; (results[1].data || []).forEach(function(m){ matches[m.id] = m; });

    var html = '<div style="font-size:11px;color:#888;margin-bottom:14px">⚠️ Ye matches auto-anomaly-check trip hue hain. Review karo — dismiss karo (false alarm, normal payout hoga) ya cheat confirm karo (match void, players refund, creator ko strike).</div>';
    html += '<div style="display:grid;gap:12px">';

    flags.forEach(function(f) {
      var m = matches[f.match_id] || {};
      var creatorName = creators[f.creator_uid] || f.creator_uid;
      var reasonLabel = _REASON_LABELS[f.reason] || f.reason;
      var d = f.details || {};
      var createdDate = f.created_at ? new Date(f.created_at).toLocaleString('en-IN') : 'Unknown';

      html += '<div style="background:rgba(255,107,53,.05);border:1px solid rgba(255,107,53,.2);border-radius:14px;padding:16px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">';
      html += '<div>';
      html += '<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:3px">' + _esc(m.title || f.match_id) + '</div>';
      html += '<div style="font-size:11px;color:#888">Creator: <span style="color:#00d4ff">' + _esc(creatorName) + '</span> · ' + createdDate + '</div>';
      html += '</div>';
      html += '<div style="background:rgba(255,60,60,.15);border:1px solid rgba(255,60,60,.3);color:#ff6b6b;font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;text-align:right">FLAGGED</div>';
      html += '</div>';

      html += '<div style="font-size:12px;color:#ffaa00;margin-bottom:8px;padding:8px;background:rgba(255,170,0,.06);border-radius:8px">' + reasonLabel + '</div>';

      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;font-size:11px">';
      html += '<div style="text-align:center;padding:6px;background:rgba(255,255,255,.03);border-radius:8px"><div style="color:#666">Total Kills</div><div style="font-weight:800;color:#fff">' + (d.total_kills ?? '-') + '</div></div>';
      html += '<div style="text-align:center;padding:6px;background:rgba(255,255,255,.03);border-radius:8px"><div style="color:#666">Payout</div><div style="font-weight:800;color:#fff">' + (d.total_payout ?? '-') + '</div></div>';
      html += '<div style="text-align:center;padding:6px;background:rgba(255,255,255,.03);border-radius:8px"><div style="color:#666">Lobby Size</div><div style="font-weight:800;color:#fff">' + (m.filled_slots ?? '-') + '</div></div>';
      html += '</div>';

      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
      html += '<button onclick="adminDismissCreatorFlag(\'' + f.id + '\')" ' +
        'style="padding:10px;border-radius:10px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.25);color:#00ff9c;font-size:12px;font-weight:700;cursor:pointer">' +
        '✅ Dismiss (Pay Out Normally)</button>';
      html += '<button onclick="adminConfirmCreatorCheat(\'' + f.id + '\')" ' +
        'style="padding:10px;border-radius:10px;background:rgba(255,60,60,.1);border:1px solid rgba(255,60,60,.25);color:#ff6b6b;font-size:12px;font-weight:700;cursor:pointer">' +
        '🚫 Confirm Cheat (Void + Strike)</button>';
      html += '</div>';
      html += '</div>'; // card
    });

    html += '</div>';
    cont.innerHTML = html;
  }).catch(function(e) {
    cont.innerHTML = '<div style="color:#ff6b6b;padding:16px">Error: ' + _esc(e.message) + '</div>';
  });
}

/* ─── Dismiss flag (false alarm — pays out normally) ───────────── */
window.adminDismissCreatorFlag = function(flagId) {
  if (!confirm('Ye false alarm hai? Match normally pay out hoga, koi strike nahi.')) return;
  if (!supa()) return;
  supa().rpc('admin_dismiss_creator_flag', { p_flag_id: flagId }).then(function(r) {
    if (r.data && r.data.success) {
      if (window.showToast) showToast('✅ Dismissed — match pay out ho gaya normally.', false);
    } else {
      if (window.showToast) showToast('Error: ' + ((r.data && r.data.error) || (r.error && r.error.message) || 'unknown'), true);
    }
    setTimeout(window.loadCreatorMatchFlags, 800);
  }).catch(function(e) {
    if (window.showToast) showToast('Error: ' + e.message, true);
  });
};

/* ─── Confirm cheat (void match, refund players, strike creator) ─ */
window.adminConfirmCreatorCheat = function(flagId) {
  if (!confirm('Cheating confirm karoge? Match void ho jayega, players ko refund milega, creator ko strike milega (3 strikes = 30-day suspend + Premium cancel, 6 = permanent ban).')) return;
  if (!supa()) return;
  supa().rpc('admin_confirm_creator_cheat', { p_flag_id: flagId }).then(function(r) {
    if (r.data && r.data.success) {
      var strikes = r.data.strikes;
      var msg = '🚫 Match void, players refund ho gaye. Creator strikes: ' + strikes + '/6';
      if (strikes >= 6) msg += ' — PERMANENTLY BANNED';
      else if (strikes >= 3) msg += ' — 30-day SUSPENDED + Premium cancelled';
      if (window.showToast) showToast(msg, false);
    } else {
      if (window.showToast) showToast('Error: ' + ((r.data && r.data.error) || (r.error && r.error.message) || 'unknown'), true);
    }
    setTimeout(function() { window.loadCreatorMatchFlags(); window.loadCreatorStrikeHistory(); }, 800);
  }).catch(function(e) {
    if (window.showToast) showToast('Error: ' + e.message, true);
  });
};

/* ─── Creator Strike History ────────────────────────────────────── */
window.loadCreatorStrikeHistory = function() {
  var cont = document.getElementById('creatorStrikeHistoryContent');
  if (!cont) return;
  cont.innerHTML = '<div style="text-align:center;padding:20px;color:#666"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

  if (!supa()) return;

  supa().from('users')
    .select('id,ign,creator_strikes,creator_suspended_until,creator_suspended_permanently,creator_rating,creator_rating_count')
    .gt('creator_strikes', 0)
    .order('creator_strikes', { ascending: false })
    .limit(50)
    .then(function(r) {
      if (r.error) { cont.innerHTML = '<div style="color:#ff6b6b;padding:16px">Error: ' + _esc(r.error.message) + '</div>'; return; }
      _renderStrikeHistory(cont, r.data || []);
    });
};

function _renderStrikeHistory(cont, results) {
  if (!results.length) {
    cont.innerHTML = '<div style="text-align:center;padding:20px;color:#888">No strikes issued yet.</div>';
    return;
  }

  var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr style="background:rgba(255,255,255,.05)">' +
    '<th style="padding:8px;text-align:left;color:#888">Creator</th>' +
    '<th style="padding:8px;text-align:center;color:#888">Strikes</th>' +
    '<th style="padding:8px;text-align:center;color:#888">Rating</th>' +
    '<th style="padding:8px;text-align:center;color:#888">Status</th>' +
    '<th style="padding:8px;text-align:center;color:#888">Action</th>' +
    '</tr></thead><tbody>';

  results.forEach(function(r) {
    var statusHtml;
    if (r.creator_suspended_permanently) {
      statusHtml = '<span style="color:#ff6b6b;font-weight:700">Permanently Banned</span>';
    } else if (r.creator_suspended_until && new Date(r.creator_suspended_until) > new Date()) {
      statusHtml = '<span style="color:#ff8c00">Suspended until ' + new Date(r.creator_suspended_until).toLocaleDateString('en-IN') + '</span>';
    } else {
      statusHtml = '<span style="color:#ffd700">Active (Warning)</span>';
    }
    var strikeBadge = r.creator_strikes >= 6 ? '🔴' : r.creator_strikes >= 3 ? '🟠' : '🟡';
    var isSuspended = r.creator_suspended_permanently || (r.creator_suspended_until && new Date(r.creator_suspended_until) > new Date());

    html += '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">';
    html += '<td style="padding:8px;color:#aaa;font-size:11px">' + _esc(r.ign || r.id) + '</td>';
    html += '<td style="padding:8px;text-align:center;font-weight:800;color:#fff">' + strikeBadge + ' ' + r.creator_strikes + '/6</td>';
    html += '<td style="padding:8px;text-align:center;color:#ffd700">' + (r.creator_rating || 5).toFixed(1) + '★ (' + (r.creator_rating_count||0) + ')</td>';
    html += '<td style="padding:8px;text-align:center">' + statusHtml + '</td>';
    html += '<td style="padding:8px;text-align:center">';
    if (isSuspended) {
      html += '<button onclick="adminLiftCreatorSuspension(\'' + r.id + '\')" style="padding:5px 10px;border-radius:8px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-size:11px;cursor:pointer">Lift Ban</button>';
    }
    html += '</td></tr>';
  });
  html += '</tbody></table>';
  cont.innerHTML = html;
}

/* ─── Lift Suspension / Un-Ban Creator ─────────────────────────── */
window.adminLiftCreatorSuspension = function(creatorUid) {
  if (!confirm('Is creator ka ban/suspension lift karein? Strikes count reset nahi hoga, sirf suspension hategi.')) return;
  if (!supa()) return;
  supa().from('users').update({
    creator_suspended_until: null,
    creator_suspended_permanently: false,
    is_creator: true
  }).eq('id', creatorUid).then(function(r) {
    if (r.error) { if (window.showToast) showToast('Error: ' + r.error.message, true); return; }
    supa().from('notifications').insert({
      user_id: creatorUid, type: 'creator_strike',
      title: '✅ Suspension Lifted', body: 'Aapka hosting suspension admin ne lift kar diya hai.'
    }).catch(function(){});
    if (window.showToast) showToast('✅ Suspension lift ho gaya.', false);
    setTimeout(window.loadCreatorStrikeHistory, 800);
  });
};

/* ─── Helpers ───────────────────────────────────────────────────── */
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Badge on page load — check for open flags so admin sees the red
   count without having to open the section first. */
setTimeout(function() {
  if (window._supa) {
    window._supa.from('creator_result_flags').select('id', { count: 'exact', head: true }).eq('status', 'open')
      .then(function(r) {
        var b = document.getElementById('creatorFlagBadge');
        if (b && r.count > 0) { b.style.display = ''; b.textContent = r.count; }
      });
  }
}, 3000);

console.log('✅ fa-creator-video-review.js (creator match review, 2026-08) loaded');
})();
