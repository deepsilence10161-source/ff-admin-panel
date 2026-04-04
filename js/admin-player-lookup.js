/* =============================================
   ADMIN PLAYER LOOKUP - Advanced Search
   js/admin-player-lookup.js
   ============================================= */

var lookupResults = [];
var currentInvestigationUid = null;

function searchPlayers() {
    var query = document.getElementById('playerSearchInput').value.trim().toLowerCase();
    var resultsEl = document.getElementById('lookupResults');
    
    if (!query || query.length < 2) {
        resultsEl.innerHTML = '<p class="text-muted text-xs" style="padding:20px;text-align:center">Enter at least 2 characters to search</p>';
        return;
    }
    
    if (!usersSnapshot) {
        resultsEl.innerHTML = '<p class="text-muted text-xs" style="padding:20px;text-align:center">Users loading...</p>';
        return;
    }
    
    lookupResults = [];
    
    usersSnapshot.forEach(function(c) {
        var u = c.val();
        var uid = c.key;
        
        var matches = 
            (u.ign && u.ign.toLowerCase().includes(query)) ||
            uid.toLowerCase().includes(query) ||
            (u.ffUid && u.ffUid.toLowerCase().includes(query)) ||
            (u.phone && u.phone.includes(query)) ||
            (u.email && u.email.toLowerCase().includes(query));
        
        if (matches) {
            // Calculate stats
            var totalMatches = u.stats ? u.stats.matches || 0 : 0;
            var totalWins = u.stats ? u.stats.wins || 0 : 0;
            var winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;
            var isSuspicious = winRate > 70 && totalMatches >= 5;
            
            lookupResults.push({
                uid: uid,
                ign: u.ign || 'Unknown',
                ffUid: u.ffUid || 'N/A',
                phone: u.phone || '',
                email: u.email || '',
                totalMatches: totalMatches,
                totalWins: totalWins,
                winRate: winRate,
                totalKills: u.totalKills || (u.stats ? u.stats.kills || 0 : 0),
                totalEarnings: u.totalWinnings || (u.stats ? u.stats.earnings || 0 : 0),
                depositBalance: u.realMoney ? u.realMoney.deposited || 0 : 0,
                winningBalance: u.realMoney ? u.realMoney.winnings || 0 : 0,
                isBanned: u.isBanned || u.blocked || false,
                profileVerified: u.profileVerified || false,
                isSuspicious: isSuspicious
            });
        }
    });
    
    renderLookupResults();
}

function renderLookupResults() {
    var resultsEl = document.getElementById('lookupResults');
    
    if (lookupResults.length === 0) {
        resultsEl.innerHTML = '<p class="text-muted text-xs" style="padding:20px;text-align:center">No users found</p>';
        return;
    }
    
    var html = '<div class="table-wrapper" style="max-height:300px"><table><thead><tr>' +
        '<th>IGN</th><th>FF UID</th><th>Stats</th><th>Balance</th><th>Status</th><th>Actions</th>' +
    '</tr></thead><tbody>';
    
    lookupResults.forEach(function(u) {
        var statusBadges = '';
        if (u.isBanned) statusBadges += '<span class="badge red">Banned</span> ';
        if (u.isSuspicious) statusBadges += '<span class="badge red">⚠️ ' + u.winRate + '% WR</span> ';
        if (u.profileVerified) statusBadges += '<span class="badge green">Verified</span> ';
        if (!statusBadges) statusBadges = '<span class="badge blue">Normal</span>';
        
        html += '<tr>' +
            '<td>' + idTag(u.ign, u.uid) + '</td>' +
            '<td class="font-mono text-xs">' + u.ffUid + '</td>' +
            '<td class="text-xs">' +
                '<div>Matches: <strong>' + u.totalMatches + '</strong></div>' +
                '<div>Wins: <strong>' + u.totalWins + '</strong></div>' +
                '<div>Kills: <strong>' + u.totalKills + '</strong></div>' +
            '</td>' +
            '<td class="text-xs">' +
                '<div class="text-primary">₹' + (u.depositBalance + u.winningBalance) + '</div>' +
                '<div class="text-muted">D:₹' + u.depositBalance + ' W:₹' + u.winningBalance + '</div>' +
            '</td>' +
            '<td>' + statusBadges + '</td>' +
            '<td>' +
                '<button class="btn btn-ghost btn-xs" onclick="investigatePlayer(\'' + u.uid + '\')" title="Investigate"><i class="fas fa-search"></i></button> ' +
                '<button class="btn btn-ghost btn-xs" onclick="openUserModal(\'' + u.uid + '\')" title="Full Profile"><i class="fas fa-user"></i></button> ' +
                (u.isBanned 
                    ? '<button class="btn btn-primary btn-xs" onclick="unbanUser(\'' + u.uid + '\')" title="Unban"><i class="fas fa-unlock"></i></button>'
                    : '<button class="btn btn-warning btn-xs" onclick="banUser(\'' + u.uid + '\')" title="Ban"><i class="fas fa-ban"></i></button>') +
            '</td>' +
        '</tr>';
    });
    
    html += '</tbody></table></div>';
    html += '<div class="text-xs text-muted mt-2">' + lookupResults.length + ' user(s) found</div>';
    
    resultsEl.innerHTML = html;
}

async function investigatePlayer(uid) {
    currentInvestigationUid = uid;
    var detailEl = document.getElementById('investigationDetail');
    detailEl.innerHTML = '<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i> Loading investigation...</div>';
    detailEl.style.display = 'block';
    
    try {
        // Get user data
        var userSnap = await rtdb.ref(DB_USERS + '/' + uid).once('value');
        var u = userSnap.val() || {};
        
        // Get join requests
        var joinSnap = await rtdb.ref(DB_JOIN).orderByChild('userId').equalTo(uid).once('value');
        var joins = [];
        joinSnap.forEach(function(c) { joins.push(c.val()); });
        
        // Also check oderId
        var joinSnap2 = await rtdb.ref(DB_JOIN).orderByChild('oderId').equalTo(uid).once('value');
        joinSnap2.forEach(function(c) { 
            var exists = joins.some(function(j) { return j.matchId === c.val().matchId; });
            if (!exists) joins.push(c.val());
        });
        
        // Get transactions
        var txSnap = await rtdb.ref(DB_USERS + '/' + uid + '/transactions')
            .orderByChild('timestamp')
            .limitToLast(10)
            .once('value');
        var transactions = [];
        txSnap.forEach(function(c) { transactions.unshift(c.val()); });
        
        // Get wallet requests
        var walletSnap = await rtdb.ref(DB_WALLET).orderByChild('uid').equalTo(uid).once('value');
        var walletRequests = [];
        walletSnap.forEach(function(c) { walletRequests.push(c.val()); });
        
        // Calculate stats
        var totalMatches = u.stats ? u.stats.matches || 0 : joins.length;
        var totalWins = u.stats ? u.stats.wins || 0 : 0;
        var winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;
        var isSuspicious = winRate > 70 && totalMatches >= 5;
        
        // Build investigation report
        var html = '';
        
        // Suspicious warning
        if (isSuspicious) {
            html += '<div class="info-box red mb-3"><i class="fas fa-exclamation-triangle"></i> ' +
                '<strong>⚠️ SUSPICIOUS ACTIVITY:</strong> ' + winRate + '% win rate with ' + totalMatches + ' matches!' +
            '</div>';
        }
        
        // User header
        html += '<div class="flex items-center gap-3 mb-3">' +
            '<div class="chat-avatar" style="width:50px;height:50px;font-size:18px">' + (u.ign || 'U').charAt(0).toUpperCase() + '</div>' +
            '<div>' +
                '<div class="font-bold" style="font-size:16px">' + (u.ign || 'Unknown') + '</div>' +
                '<div class="text-xs text-muted font-mono">' + uid + '</div>' +
                '<div class="text-xs">FF: ' + (u.ffUid || 'N/A') + ' | Ph: ' + (u.phone || 'N/A') + '</div>' +
            '</div>' +
            '<div class="ml-auto">' +
                (u.isBanned ? '<span class="badge red">BANNED</span>' : '<span class="badge green">Active</span>') +
            '</div>' +
        '</div>';
        
        // Quick stats grid
        html += '<div class="stats-grid mb-3" style="grid-template-columns:repeat(4,1fr)">' +
            '<div class="stat-card"><h3>Matches</h3><div class="value">' + totalMatches + '</div></div>' +
            '<div class="stat-card"><h3>Wins</h3><div class="value">' + totalWins + '</div></div>' +
            '<div class="stat-card"><h3>Win Rate</h3><div class="value ' + (isSuspicious ? 'text-danger' : '') + '">' + winRate + '%</div></div>' +
            '<div class="stat-card"><h3>Earnings</h3><div class="value text-primary">₹' + (u.totalWinnings || 0) + '</div></div>' +
        '</div>';
        
        // Wallet info
        html += '<div class="grid-2 mb-3">' +
            '<div class="manual-wallet-card">' +
                '<div class="font-bold text-xs mb-2"><i class="fas fa-wallet"></i> Wallet Balance</div>' +
                '<div class="user-stat-row"><span>Deposit</span><strong class="text-primary">₹' + (u.realMoney ? u.realMoney.deposited || 0 : 0) + '</strong></div>' +
                '<div class="user-stat-row"><span>Winning</span><strong class="text-primary">₹' + (u.realMoney ? u.realMoney.winnings || 0 : 0) + '</strong></div>' +
            '</div>' +
            '<div class="manual-wallet-card">' +
                '<div class="font-bold text-xs mb-2"><i class="fas fa-history"></i> Request Summary</div>' +
                '<div class="user-stat-row"><span>Joins</span><strong>' + joins.length + '</strong></div>' +
                '<div class="user-stat-row"><span>Wallet Reqs</span><strong>' + walletRequests.length + '</strong></div>' +
            '</div>' +
        '</div>';
        
        // Recent transactions
        html += '<div class="card mb-3"><div class="card-header"><i class="fas fa-exchange-alt"></i> Recent Transactions</div>' +
            '<div class="card-body compact" style="max-height:150px;overflow-y:auto">';
        if (transactions.length === 0) {
            html += '<p class="text-muted text-xs">No transactions</p>';
        } else {
            transactions.forEach(function(tx) {
                var isPositive = tx.amount > 0;
                html += '<div class="feed-item">' +
                    '<div class="flex justify-between">' +
                        '<span class="text-xs">' + (tx.type || 'Unknown') + '</span>' +
                        '<span class="' + (isPositive ? 'text-primary' : 'text-danger') + ' font-bold">' +
                            (isPositive ? '+' : '') + '₹' + tx.amount +
                        '</span>' +
                    '</div>' +
                    '<div class="text-xxs text-muted">' + (tx.description || '') + '</div>' +
                '</div>';
            });
        }
        html += '</div></div>';
        
        // Recent matches
        html += '<div class="card"><div class="card-header"><i class="fas fa-gamepad"></i> Recent Matches (' + joins.length + ')</div>' +
            '<div class="card-body compact" style="max-height:150px;overflow-y:auto">';
        if (joins.length === 0) {
            html += '<p class="text-muted text-xs">No match history</p>';
        } else {
            joins.slice(0, 10).forEach(function(j) {
                var matchName = allTournaments[j.matchId] ? allTournaments[j.matchId].name : j.matchId;
                html += '<div class="feed-item">' +
                    '<div class="flex justify-between">' +
                        '<span class="text-xs font-bold">' + matchName + '</span>' +
                        '<span class="badge ' + (j.status === 'approved' ? 'green' : 'yellow') + '">' + (j.status || 'joined') + '</span>' +
                    '</div>' +
                    '<div class="text-xxs text-muted">Entry: ₹' + (j.entryFee || 0) + '</div>' +
                '</div>';
            });
        }
        html += '</div></div>';
        
        // Quick actions
        html += '<div class="flex gap-2 mt-3">' +
            '<button class="btn btn-ghost btn-sm" onclick="openUserModal(\'' + uid + '\')"><i class="fas fa-user"></i> Full Profile</button>' +
            '<button class="btn btn-purple btn-sm" onclick="openManualWalletModalForUser(\'' + uid + '\')"><i class="fas fa-wallet"></i> Edit Balance</button>' +
            (u.isBanned 
                ? '<button class="btn btn-primary btn-sm" onclick="unbanUser(\'' + uid + '\');investigatePlayer(\'' + uid + '\')"><i class="fas fa-unlock"></i> Unban</button>'
                : '<button class="btn btn-danger btn-sm" onclick="banUser(\'' + uid + '\');investigatePlayer(\'' + uid + '\')"><i class="fas fa-ban"></i> Ban</button>') +
        '</div>';
        
        detailEl.innerHTML = html;
        
    } catch (e) {
        console.error('Investigation error:', e);
        detailEl.innerHTML = '<div class="info-box red">Error loading data: ' + e.message + '</div>';
    }
}

function openManualWalletModalForUser(uid) {
    document.getElementById('manualUid').value = uid;
    openManualWalletModal();
    lookupManualUser();
}

function clearLookup() {
    document.getElementById('playerSearchInput').value = '';
    document.getElementById('lookupResults').innerHTML = '<p class="text-muted text-xs" style="padding:20px;text-align:center">Enter IGN, UID, FF UID, or Phone to search</p>';
    document.getElementById('investigationDetail').style.display = 'none';
    lookupResults = [];
}

console.log('✅ admin-player-lookup.js loaded');
