/* ================================================================
   ADMIN — CREATOR VIDEO REVIEW + STRIKE MANAGEMENT
   fa-creator-video-review.js | Admin Panel v26
   
   Features:
   - Lists all auto-hidden videos (sorted by report count)
   - Per-video: Restore (false positive) | Confirm Hidden (creator strike)
   - Restore → penalizes each reporter (deducts coins)
   - Confirm → adds creator strike → strike 2 = 7d suspend, strike 3 = permanent ban
   - Creator Strike history table
   
   Firebase paths:
     creatorVideos/{videoId}           — video record
     videoReports/{videoId}/{uid}      — reports on a video
     users/{uid}/videoStrikes          — creator strike data
   
   Supabase: creator_videos, video_reports (mirror for analytics)
   ================================================================ */

(function() {
'use strict';

var db = function() { return window.rtdb || window.db; };

/* ─── Load + Render hidden videos list ─────────────────────────── */
window.loadCreatorVideoReview = function() {
  var cont = document.getElementById('creatorVideoReviewContent');
  if (!cont) return;
  cont.innerHTML = '<div style="text-align:center;padding:30px;color:#666"><i class="fas fa-spinner fa-spin"></i> Loading auto-hidden videos...</div>';

  if (!db()) {
    cont.innerHTML = '<div style="color:#ff6b6b;padding:16px">Firebase not ready. Refresh karein.</div>';
    return;
  }

  db().ref('creatorVideos').orderByChild('status').equalTo('auto_hidden')
    .once('value', function(snap) {
      var videos = [];
      snap.forEach(function(child) {
        var v = child.val();
        v._id = child.key;
        videos.push(v);
      });
      // Sort by report count desc
      videos.sort(function(a,b){ return (b.reportCount||0) - (a.reportCount||0); });
      _renderHiddenVideos(cont, videos);
    });
};

function _renderHiddenVideos(cont, videos) {
  if (!videos.length) {
    cont.innerHTML = '<div style="text-align:center;padding:30px;color:#666">✅ Koi auto-hidden video nahi hai abhi.</div>';
    return;
  }

  var html = '<div style="font-size:11px;color:#888;margin-bottom:14px">⚠️ Ye videos community reports ki wajah se auto-hide hue hain. Review karo aur action lo.</div>';
  html += '<div style="display:grid;gap:12px">';

  videos.forEach(function(v) {
    var platform = v.platform || 'youtube';
    var platIcon = platform === 'instagram' ? '📸' : '▶️';
    var createdDate = v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-IN') : 'Unknown';

    html += '<div style="background:rgba(255,107,53,.05);border:1px solid rgba(255,107,53,.2);border-radius:14px;padding:16px">';
    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">';
    html += '<div>';
    html += '<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:3px">' + _esc(v.title || 'Untitled') + '</div>';
    html += '<div style="font-size:11px;color:#888">Creator: <span style="color:#00d4ff">' + _esc(v.creatorUid || '') + '</span> · ' + createdDate + '</div>';
    html += '</div>';
    html += '<div style="background:rgba(255,60,60,.15);border:1px solid rgba(255,60,60,.3);color:#ff6b6b;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px">🚩 ' + (v.reportCount || 0) + ' Reports</div>';
    html += '</div>';

    // Description
    if (v.description) {
      html += '<div style="font-size:12px;color:#aaa;margin-bottom:10px;padding:8px;background:rgba(255,255,255,.03);border-radius:8px">' + _esc(v.description) + '</div>';
    }

    // Link
    html += '<div style="margin-bottom:12px">';
    html += '<a href="' + _esc(v.link||'') + '" target="_blank" rel="noopener" style="font-size:12px;color:#00d4ff;text-decoration:none">' + platIcon + ' ' + _esc(v.link||'No Link') + '</a>';
    html += '</div>';

    // Action buttons
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    html += '<button onclick="adminRestoreVideo(\'' + v._id + '\',\'' + _esc(v.creatorUid||'') + '\')" ' +
      'style="padding:10px;border-radius:10px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.25);color:#00ff9c;font-size:12px;font-weight:700;cursor:pointer">' +
      '✅ Restore (False Positive)</button>';
    html += '<button onclick="adminConfirmHidden(\'' + v._id + '\',\'' + _esc(v.creatorUid||'') + '\')" ' +
      'style="padding:10px;border-radius:10px;background:rgba(255,60,60,.1);border:1px solid rgba(255,60,60,.25);color:#ff6b6b;font-size:12px;font-weight:700;cursor:pointer">' +
      '🚫 Confirm (Give Strike)</button>';
    html += '</div>';
    html += '</div>'; // card
  });

  html += '</div>';
  cont.innerHTML = html;
}

/* ─── Restore Video (false positive) ──────────────────────────── */
window.adminRestoreVideo = function(videoId, creatorUid) {
  if (!confirm('Is video ko restore karoge? Sabhi reporters ko penalty milegi.')) return;
  if (!db()) return;

  var _falseReportPenalty = 3; // default fallback
  db().ref('adminConfig/videoModeration/videoFalseReportPenalty').once('value', function(ps) {
    if (ps.val() != null) _falseReportPenalty = Number(ps.val());

    // Get all reporters
    db().ref('videoReports/' + videoId).once('value', function(rSnap) {
      var reporters = [];
      rSnap.forEach(function(r) {
        if (r.key !== 'resolved') reporters.push(r.key);
      });

      // Restore video status
      db().ref('creatorVideos/' + videoId).update({ status: 'live', strikeAction: 'restored', resolvedAt: Date.now() });

      // Also mirror to Supabase
      if (window._supa) {
        window._supa.from('creator_videos').update({ status: 'live', report_count: 0 })
          .eq('firebase_id', videoId)
          .then(function(){ console.log('[Admin] Video restored in Supabase'); })
          .catch(function(e){ console.warn('[Admin] Supabase restore error:', e.message); });
      }

      // Penalize each reporter
      reporters.forEach(function(reporterUid) {
        db().ref('users/' + reporterUid + '/coins').transaction(function(coins) {
          return Math.max(0, (coins || 0) - _falseReportPenalty);
        });
        // Log wallet transaction in Supabase
        if (window._supa) {
          window._supa.from('wallet_transactions').insert({
            user_id: reporterUid,
            txn_type: 'debit',
            amount: _falseReportPenalty,
            currency: 'coins',
            reason: 'false_video_report_penalty',
            created_at: new Date().toISOString(),
          }).catch(function(e){ console.warn('[Admin] Wallet txn error:', e.message); });
        }
        // Notify reporter
        _sendPushToUser(reporterUid, 'Report Penalty', 'Aapki galat report ki wajah se ' + _falseReportPenalty + ' coins kat gaye.');
      });

      // Mark reports as resolved
      db().ref('videoReports/' + videoId).update({ resolved: true, resolution: 'restored', resolvedAt: Date.now() });

      if (window.showToast) showToast('✅ Video restore ho gaya. ' + reporters.length + ' reporters ko penalty mili.', false);
      // Reload list
      setTimeout(window.loadCreatorVideoReview, 1000);
    });
  });
};

/* ─── Confirm Hidden (give creator strike) ─────────────────────── */
window.adminConfirmHidden = function(videoId, creatorUid) {
  if (!confirm('Video violation confirm karoge? Creator ko strike milegi.')) return;
  if (!db() || !creatorUid) return;

  // Get current strikes
  db().ref('users/' + creatorUid + '/videoStrikes').once('value', function(sSnap) {
    var strikeData = sSnap.val() || { count: 0, suspended: false };
    var newCount   = (strikeData.count || 0) + 1;
    var now = Date.now();
    var updates = { count: newCount, lastStrikeAt: now };
    var notifMsg = '';
    var suspendDays = 0;

    if (newCount === 1) {
      notifMsg = 'Aapka ek video hamari community guidelines ke against tha. Warning: Agle violation pe 7 din ka suspension.';
    } else if (newCount === 2) {
      // 7 day suspension
      suspendDays = 7;
      updates.suspended     = true;
      updates.suspendedUntil = now + (7 * 24 * 60 * 60 * 1000);
      notifMsg = '⛔ Strike 2: Aapki video sharing 7 din ke liye suspend ho gayi.';
    } else if (newCount >= 3) {
      // Permanent ban from video sharing
      updates.suspended     = true;
      updates.suspendedUntil = -1; // permanent
      notifMsg = '🚫 Strike 3: Aap permanently Creator Video System se ban ho gaye hain.';
      _sendAdminAlert('🚨 Creator permanently banned from videos: ' + creatorUid);
    }

    db().ref('users/' + creatorUid + '/videoStrikes').set(updates);

    // Confirm video as violation
    db().ref('creatorVideos/' + videoId).update({
      status: 'removed',
      strikeAction: 'confirmed_violation',
      resolvedAt: now,
    });

    // Mirror to Supabase
    if (window._supa) {
      window._supa.from('creator_videos').update({ status: 'removed' })
        .eq('firebase_id', videoId)
        .catch(function(e){ console.warn('[Admin] Supabase confirm error:', e.message); });
    }

    // Mark reports resolved
    db().ref('videoReports/' + videoId).update({ resolved: true, resolution: 'confirmed', resolvedAt: now });

    // Notify creator
    _sendPushToUser(creatorUid, '⚠️ Video Violation', notifMsg);
    if (window._supa) {
      window._supa.from('notifications').insert({
        user_id: creatorUid, type: 'info', title: 'Video Violation',
        body: notifMsg, created_at: new Date().toISOString(),
      }).catch(function(){});
    }

    var msg = '🚫 Strike ' + newCount + ' diya creator ko';
    if (suspendDays > 0) msg += '. 7-day suspension laga.';
    else if (newCount >= 3) msg += '. Permanent ban!';
    if (window.showToast) showToast(msg, false);
    setTimeout(window.loadCreatorVideoReview, 1000);
  });
};

/* ─── Creator Strike History ────────────────────────────────────── */
window.loadCreatorStrikeHistory = function() {
  var cont = document.getElementById('creatorStrikeHistoryContent');
  if (!cont) return;
  cont.innerHTML = '<div style="text-align:center;padding:20px;color:#666"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

  if (!db()) return;

  // Query Firebase users with videoStrikes.count >= 1
  // Firebase doesn't support querying nested fields, so we do a targeted query
  db().ref('creatorVideos').orderByChild('strikeAction').equalTo('confirmed_violation')
    .limitToLast(50).once('value', function(snap) {
      var creatorUids = {};
      snap.forEach(function(child) {
        var v = child.val();
        if (v.creatorUid) creatorUids[v.creatorUid] = true;
      });

      var uids = Object.keys(creatorUids);
      if (!uids.length) {
        cont.innerHTML = '<div style="text-align:center;padding:20px;color:#888">No strikes issued yet.</div>';
        return;
      }

      // Load strike data for each creator
      var results = [];
      var pending = uids.length;
      uids.forEach(function(uid) {
        db().ref('users/' + uid + '/videoStrikes').once('value', function(sSnap) {
          var data = sSnap.val() || {};
          if (data.count) {
            results.push({ uid: uid, count: data.count, suspended: data.suspended, suspendedUntil: data.suspendedUntil, lastStrikeAt: data.lastStrikeAt });
          }
          pending--;
          if (!pending) _renderStrikeHistory(cont, results);
        });
      });
    });
};

function _renderStrikeHistory(cont, results) {
  if (!results.length) {
    cont.innerHTML = '<div style="text-align:center;padding:20px;color:#888">No strikes issued yet.</div>';
    return;
  }
  results.sort(function(a,b){ return (b.count||0) - (a.count||0); });

  var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr style="background:rgba(255,255,255,.05)">' +
    '<th style="padding:8px;text-align:left;color:#888">Creator UID</th>' +
    '<th style="padding:8px;text-align:center;color:#888">Strikes</th>' +
    '<th style="padding:8px;text-align:center;color:#888">Status</th>' +
    '<th style="padding:8px;text-align:center;color:#888">Last Strike</th>' +
    '<th style="padding:8px;text-align:center;color:#888">Action</th>' +
    '</tr></thead><tbody>';

  results.forEach(function(r) {
    var statusHtml = '';
    if (!r.suspended) {
      statusHtml = '<span style="color:#ffd700">Active (Warning)</span>';
    } else if (r.suspendedUntil === -1) {
      statusHtml = '<span style="color:#ff6b6b;font-weight:700">Permanently Banned</span>';
    } else {
      var untilDate = new Date(r.suspendedUntil).toLocaleDateString('en-IN');
      statusHtml = '<span style="color:#ff8c00">Suspended until ' + untilDate + '</span>';
    }
    var lastDate = r.lastStrikeAt ? new Date(r.lastStrikeAt).toLocaleDateString('en-IN') : '-';
    var strikeBadge = r.count >= 3 ? '🔴' : r.count === 2 ? '🟠' : '🟡';

    html += '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">';
    html += '<td style="padding:8px;color:#aaa;font-size:11px">' + _esc(r.uid) + '</td>';
    html += '<td style="padding:8px;text-align:center;font-weight:800;color:#fff">' + strikeBadge + ' ' + r.count + '</td>';
    html += '<td style="padding:8px;text-align:center">' + statusHtml + '</td>';
    html += '<td style="padding:8px;text-align:center;color:#888">' + lastDate + '</td>';
    html += '<td style="padding:8px;text-align:center">';
    if (r.suspended) {
      html += '<button onclick="adminLiftStrike(\'' + r.uid + '\')" style="padding:5px 10px;border-radius:8px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.2);color:#00ff9c;font-size:11px;cursor:pointer">Lift Ban</button>';
    }
    html += '</td></tr>';
  });
  html += '</tbody></table>';
  cont.innerHTML = html;
}

/* ─── Lift Strike / Un-Suspend Creator ─────────────────────────── */
window.adminLiftStrike = function(creatorUid) {
  if (!confirm('Is creator ka ban/suspension lift karein?')) return;
  if (!db()) return;
  db().ref('users/' + creatorUid + '/videoStrikes').update({
    suspended: false,
    suspendedUntil: null,
    liftedBy: 'admin',
    liftedAt: Date.now(),
  }, function(err) {
    if (err) { if (window.showToast) showToast('Error: ' + err.message, true); return; }
    _sendPushToUser(creatorUid, '✅ Suspension Lifted', 'Aapka video sharing suspension admin ne lift kar diya hai.');
    if (window.showToast) showToast('✅ Suspension lift ho gaya.', false);
    setTimeout(window.loadCreatorStrikeHistory, 800);
  });
};

/* ─── Helpers ───────────────────────────────────────────────────── */
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _sendPushToUser(uid, title, body) {
  // Uses existing OneSignal push system
  if (window._supa) {
    window._supa.from('notifications').insert({
      user_id: uid, type: 'info',
      title: title, body: body,
      created_at: new Date().toISOString(),
    }).catch(function(){});
  }
  // OneSignal send-to-specific-user (relies on existing notification system)
  if (window.sendOneSignalToUID) {
    window.sendOneSignalToUID(uid, title, body);
  }
}

function _sendAdminAlert(msg) {
  if (!db()) return;
  db().ref('adminAlerts').push({ message: msg, createdAt: Date.now(), type: 'creator_ban' });
}

console.log('✅ fa-creator-video-review.js loaded');
})();
