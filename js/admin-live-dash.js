/* =============================================
   ADMIN LIVE DASHBOARD - Real-time Activity Feed
   js/admin-live-dash.js
   ============================================= */

var serverTimeOffset = 0;
var liveFeedListener = null;

function initLiveDashboard() {
    console.log('Initializing Live Dashboard...');
    
    // Server time sync
    rtdb.ref('.info/serverTimeOffset').on('value', function(s) {
        serverTimeOffset = s.val() || 0;
        console.log('Server time offset:', serverTimeOffset);
    });
    
    // Live activity feed listener
    if (liveFeedListener) {
        rtdb.ref('activityLogs').off('value', liveFeedListener);
    }
    
    liveFeedListener = rtdb.ref('activityLogs')
        .orderByChild('timestamp')
        .limitToLast(15)
        .on('value', function(s) {
            var items = [];
            s.forEach(function(c) {
                items.unshift({ key: c.key, ...c.val() });
            });
            renderLiveActivityFeed(items);
        });
    
    // Live pending counts
    setupLivePendingCounts();
    
    // Update time displays every minute
    setInterval(updateTimeDisplays, 60000);
    
    console.log('✅ Live Dashboard initialized');
}

function renderLiveActivityFeed(items) {
    var el = document.getElementById('liveActivityFeed');
    if (!el) return;
    
    if (items.length === 0) {
        el.innerHTML = '<p class="text-muted text-xs" style="padding:10px">No recent activity</p>';
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
        'team_approved': '👥'
    };
    
    var typeColors = {
        'user_banned': 'text-danger',
        'user_unbanned': 'text-primary',
        'manual_credit': 'text-primary',
        'manual_debit': 'text-warning',
        'results_published': 'text-primary',
        'match_cancelled': 'text-danger',
        'profile_approved': 'text-primary',
        'withdrawal_approved': 'text-info',
        'deposit_approved': 'text-primary'
    };
    
    el.innerHTML = items.map(function(item) {
        var ago = getTimeAgo(item.timestamp);
        var icon = typeIcons[item.type] || '📋';
        var colorClass = typeColors[item.type] || '';
        var typeLabel = (item.type || 'action').replace(/_/g, ' ');
        
        var details = '';
        if (item.matchName) details += '<span class="text-xs text-dim">Match: ' + item.matchName + '</span> ';
        if (item.amount) details += '<span class="text-xs text-primary">₹' + item.amount + '</span> ';
        if (item.targetUid) details += '<span class="text-xxs font-mono text-muted">' + item.targetUid.substring(0, 12) + '...</span>';
        
        return '<div class="feed-item">' +
            '<div class="flex items-center justify-between">' +
                '<div class="flex items-center gap-2">' +
                    '<span style="font-size:14px">' + icon + '</span>' +
                    '<span class="font-bold text-xs ' + colorClass + '">' + typeLabel + '</span>' +
                '</div>' +
                '<span class="text-xxs text-muted">' + ago + '</span>' +
            '</div>' +
            (details ? '<div class="mt-1">' + details + '</div>' : '') +
        '</div>';
    }).join('');
}

function getTimeAgo(timestamp) {
    if (!timestamp) return '';
    var now = Date.now() + serverTimeOffset;
    var diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
}

function setupLivePendingCounts() {
    // Live wallet pending count
    rtdb.ref(DB_WALLET).on('value', function(s) {
        var pending = 0, withdrawPending = 0;
        s.forEach(function(c) {
            if (c.val().status === 'pending') {
                pending++;
                if (normalizeWalletType(c.val().type) === 'withdraw') withdrawPending++;
            }
        });
        
        var el = document.getElementById('liveWalletPending');
        if (el) el.textContent = pending;
        
        var el2 = document.getElementById('liveWithdrawPending');
        if (el2) el2.textContent = withdrawPending;
    });
    
    // Live profile pending count
    rtdb.ref(DB_PROFILE).on('value', function(s) {
        var pending = 0;
        s.forEach(function(c) {
            if (!c.val().status || c.val().status === 'pending') pending++;
        });
        
        var el = document.getElementById('liveProfilePending');
        if (el) el.textContent = pending;
    });
    
    // Live active matches count
    rtdb.ref(DB_MATCHES).on('value', function(s) {
        var live = 0, upcoming = 0;
        s.forEach(function(c) {
            var status = getAdminMatchStatus(c.val());
            if (status === 'live') live++;
            if (status === 'upcoming') upcoming++;
        });
        
        var el = document.getElementById('liveLiveMatches');
        if (el) el.textContent = live;
        
        var el2 = document.getElementById('liveUpcomingMatches');
        if (el2) el2.textContent = upcoming;
    });
}

function updateTimeDisplays() {
    // Update all relative time displays
    document.querySelectorAll('[data-timestamp]').forEach(function(el) {
        var ts = Number(el.dataset.timestamp);
        if (ts) el.textContent = getTimeAgo(ts);
    });
}

// Quick stats for dashboard
function getLiveStats() {
    return {
        serverTime: Date.now() + serverTimeOffset,
        offset: serverTimeOffset
    };
}

console.log('✅ admin-live-dash.js loaded');
