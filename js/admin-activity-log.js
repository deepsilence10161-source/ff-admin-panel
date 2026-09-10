/* =============================================
   ADMIN ACTIVITY LOG - Audit Trail Viewer
   js/admin-activity-log.js
   ============================================= */

var activityFilter = 'all';
var activityLogs = [];

async function loadActivityLog() {
    var listEl = document.getElementById('activityLogList');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i> Loading activity logs...</div>';

    /* Bug Low #17 Fix: Read from Supabase admin_activity_log (primary) with
       Firebase activityLogs as fallback. Supabase is the durable audit trail;
       Firebase is ephemeral and can be cleared. */
    try {
      var supaLogs = [];
      if (window._supa) {
        var supaRes = await window._supa.from('admin_activity_log')
          .select('*').order('created_at', { ascending: false }).limit(150);
        supaLogs = (supaRes.data || []).map(function(r) {
          return {
            key: r.id, type: r.action_type, uid: r.target_uid,
            details: r.details || {}, timestamp: new Date(r.created_at).getTime(),
            adminUid: r.admin_uid, targetRef: r.target_ref
          };
        });
      }

      if (supaLogs.length) {
        activityLogs = supaLogs;
        renderActivityLog();
        return;
      }

      // Supabase empty or unavailable — read from Firebase
      var snap = await rtdb.ref('activityLogs')
        .orderByChild('timestamp').limitToLast(150).once('value');
      activityLogs = [];
      snap.forEach(function(c) { activityLogs.unshift({ key: c.key, ...c.val() }); });
      renderActivityLog();

    } catch (e) {
        console.error('Activity log error:', e);
        listEl.innerHTML = '<div class="info-box red">Error loading logs: ' + e.message + '</div>';
    }
}

function renderActivityLog() {
    var listEl = document.getElementById('activityLogList');
    if (!listEl) return;
    
    // Apply filter
    var filtered = activityLogs;
    if (activityFilter !== 'all') {
        filtered = activityLogs.filter(function(log) {
            return log.type && log.type.toLowerCase().includes(activityFilter.toLowerCase());
        });
    }
    
    // Update count
    var countEl = document.getElementById('activityLogCount');
    if (countEl) {
        countEl.textContent = filtered.length;
    }
    
    if (filtered.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">' +
            '<i class="fas fa-clipboard-list" style="font-size:32px;opacity:0.3"></i>' +
            '<p class="mt-2">No activity logs found</p>' +
        '</div>';
        return;
    }
    
    var typeIcons = {
        'user_banned': '⛔',
        'user_unbanned': '✅',
        'manual_credit': '💰',
        'manual_debit': '💸',
        'results_published': '🏆',
        'match_cancelled': '🚫',
        'profile_approved': '👤',
        'profile_rejected': '❌',
        'profile_update_approved': '✏️',
        'withdrawal_approved': '💳',
        'deposit_approved': '💵',
        'wallet_rejected': '🚫',
        'match_created': '🎮',
        'bulk_matches_created': '📅',
        'team_approved': '👥',
        'bulk_vouchers_created': '🎫',
        'notification_sent': '📢'
    };
    
    var typeColors = {
        'user_banned': 'text-danger',
        'user_unbanned': 'text-primary',
        'manual_credit': 'text-primary',
        'manual_debit': 'text-warning',
        'results_published': 'text-primary',
        'match_cancelled': 'text-danger',
        'profile_approved': 'text-primary',
        'profile_rejected': 'text-danger',
        'withdrawal_approved': 'text-info'
    };
    
    var html = '<div class="activity-list">';
    
    filtered.forEach(function(log) {
        var icon = typeIcons[log.type] || '📋';
        var colorClass = typeColors[log.type] || '';
        var typeLabel = (log.type || 'action').replace(/_/g, ' ').toUpperCase();
        var timeAgo = getActivityTimeAgo(log.timestamp);
        var fullTime = log.timestamp ? new Date(log.timestamp).toLocaleString() : '';
        
        html += '<div class="activity-item">' +
            '<div class="activity-header">' +
                '<div class="activity-type">' +
                    '<span class="activity-icon">' + icon + '</span>' +
                    '<span class="activity-label ' + colorClass + '">' + typeLabel + '</span>' +
                '</div>' +
                '<span class="activity-time" title="' + fullTime + '">' + timeAgo + '</span>' +
            '</div>' +
            '<div class="activity-details">';
        
        // Match info
        if (log.matchName) {
            html += '<div class="activity-detail"><i class="fas fa-gamepad"></i> ' + log.matchName + '</div>';
        }
        
        // User info
        if (log.targetUid) {
            var userName = getUserName(log.targetUid);
            html += '<div class="activity-detail"><i class="fas fa-user"></i> ' + 
                userName + ' <span class="font-mono text-xxs">(' + log.targetUid.substring(0, 12) + '...)</span></div>';
        }
        
        // Amount
        if (log.amount) {
            var amountClass = log.type === 'manual_debit' ? 'text-danger' : 'text-primary';
            html += '<div class="activity-detail ' + amountClass + '"><i class="fas fa-rupee-sign"></i> ₹' + log.amount + '</div>';
        }
        
        // Reason
        if (log.reason) {
            html += '<div class="activity-detail text-warning"><i class="fas fa-comment"></i> ' + log.reason + '</div>';
        }
        
        // Count (for bulk operations)
        if (log.count) {
            html += '<div class="activity-detail"><i class="fas fa-layer-group"></i> Count: ' + log.count + '</div>';
        }
        
        // Admin info
        if (log.adminEmail) {
            html += '<div class="activity-detail text-muted"><i class="fas fa-user-shield"></i> ' + log.adminEmail + '</div>';
        }
        
        html += '</div></div>';
    });
    
    html += '</div>';
    
    listEl.innerHTML = html;
}

function getActivityTimeAgo(timestamp) {
    if (!timestamp) return '';
    var diff = Date.now() - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return new Date(timestamp).toLocaleDateString();
}

function filterActivityLog(filter) {
    activityFilter = filter;
    renderActivityLog();
}

function refreshActivityLog() {
    loadActivityLog();
    showToast('Activity log refreshed!');
}

function exportActivityLog() {
    if (activityLogs.length === 0) {
        showToast('No logs to export', true);
        return;
    }
    
    var csv = 'Timestamp,Type,Match,User,Amount,Reason,Admin\n';
    
    activityLogs.forEach(function(log) {
        csv += [
            log.timestamp ? new Date(log.timestamp).toLocaleString() : '',
            log.type || '',
            (log.matchName || '').replace(/,/g, ';'),
            log.targetUid || '',
            log.amount || '',
            (log.reason || '').replace(/,/g, ';'),
            log.adminEmail || log.admin || ''
        ].join(',') + '\n';
    });
    
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'activity-log-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    
    showToast('✅ Activity log exported!');
}

function clearOldLogs() {
    if (!confirm('Delete logs older than 30 days? This cannot be undone.')) return;
    
    var cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    rtdb.ref('activityLogs').orderByChild('timestamp').endAt(cutoff).once('value', function(s) {
        var deleteCount = 0;
        var updates = {};
        
        s.forEach(function(c) {
            updates['activityLogs/' + c.key] = null;
            deleteCount++;
        });
        
        if (deleteCount === 0) {
            showToast('No old logs to delete');
            return;
        }
        
        rtdb.ref().update(updates).then(function() {
            showToast('✅ Deleted ' + deleteCount + ' old logs');
            loadActivityLog();
        });
    });
}

// Real-time listener for new activity
function setupActivityListener() {
    rtdb.ref('activityLogs')
        .orderByChild('timestamp')
        .startAt(Date.now())
        .on('child_added', function(s) {
            var log = s.val();
            var typeLabel = (log.type || 'Action').replace(/_/g, ' ');
            console.log('🔔 New activity:', typeLabel);
            if (document.getElementById('section-activity') &&
                document.getElementById('section-activity').classList.contains('active')) {
                loadActivityLog();
            }
        });
}

/* ═══════════════════════════════════════════════════════════════
   Bug Low #17 Fix: logAdminActivity — dual-write to Firebase + Supabase
   Call this instead of rtdb.ref('activityLogs').push() directly.
   Ensures durable audit trail even if Firebase is cleared.
═══════════════════════════════════════════════════════════════ */
window.logAdminActivity = function(type, data) {
  var adminUid = (window.adminUser && window.adminUser.uid) || 'system';
  var entry = Object.assign({ type: type, adminUid: adminUid, timestamp: Date.now() }, data || {});

  // Firebase
  if (window.rtdb) {
    window.rtdb.ref('activityLogs').push(entry)
      .catch(function(e){ console.warn('[ActivityLog] Firebase write failed:', e.message); });
  }
  // Supabase (Bug Low #17 Fix — permanent audit trail)
  if (window._supa) {
    window._supa.from('admin_activity_log').insert({
      admin_uid:   adminUid,
      action_type: type,
      target_uid:  data && data.uid   ? data.uid   : null,
      target_ref:  data && data.reqId ? data.reqId : (data && data.matchId ? data.matchId : null),
      details:     data || {},
      status:      'open'
    }).catch(function(e){ console.warn('[ActivityLog] Supabase write failed:', e.message); });
  }
};

console.log('✅ admin-activity-log.js loaded');
