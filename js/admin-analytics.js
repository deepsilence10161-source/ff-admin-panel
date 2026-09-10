/* =============================================
   ADMIN ANALYTICS - Revenue Dashboard
   js/admin-analytics.js
   ============================================= */

var analyticsData = {
    totalRevenue: 0,
    totalPayout: 0,
    netProfit: 0,
    dailyData: {},
    topMatches: [],
    topPlayers: []
};

async function loadAnalytics() {
    console.log('Loading analytics...');
    
    try {
        // Reset
        analyticsData = {
            totalRevenue: 0,
            totalPayout: 0,
            netProfit: 0,
            dailyData: {},
            topMatches: [],
            topPlayers: []
        };
        
        // Load wallet requests
        var walSnap = await rtdb.ref(DB_WALLET).once('value');
        
        walSnap.forEach(function(c) {
            var w = c.val();
            if (w.status !== 'approved') return;
            
            var amount = Number(w.amount) || 0;
            var date = new Date(w.createdAt || w.timestamp || Date.now());
            var dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
            
            if (!analyticsData.dailyData[dayKey]) {
                analyticsData.dailyData[dayKey] = { revenue: 0, payout: 0 };
            }
            
            var type = normalizeWalletType(w.type);
            if (type === 'add') {
                analyticsData.totalRevenue += amount;
                analyticsData.dailyData[dayKey].revenue += amount;
            } else if (type === 'withdraw') {
                analyticsData.totalPayout += amount;
                analyticsData.dailyData[dayKey].payout += amount;
            }
        });
        
        // Load match entry fees + prizes — calculate platform profit
        var matchSnap = await rtdb.ref(DB_MATCHES).once('value');
        var matchPrizes = [];
        var totalEntryFees = 0;
        var totalPrizesOut = 0;
        
        matchSnap.forEach(function(c) {
            var m = c.val();
            var totalDistributed = 0;
            
            // Count entry fees from join requests for this match
            // (approximated from filledSlots * entryFee)
            var fee = Number(m.entryFee) || 0;
            var filled = Number(m.filledSlots) || Number(m.joinedSlots) || 0;
            if (fee > 0 && filled > 0 && m.entryType !== 'coin') {
                totalEntryFees += fee * filled;
            }
            
            if (m.results) {
                Object.values(m.results).forEach(function(r) {
                    totalDistributed += Number(r.totalWinning) || 0;
                });
            }
            
            if (totalDistributed > 0) {
                analyticsData.totalPayout += totalDistributed;
                matchPrizes.push({
                    id: c.key,
                    name: m.name,
                    prizePool: m.prizePool || 0,
                    distributed: totalDistributed
                });
            }
        });
        
        // Sort top matches by prize pool
        analyticsData.topMatches = matchPrizes.sort(function(a, b) {
            return b.distributed - a.distributed;
        }).slice(0, 5);
        
        // Platform profit = Entry fees collected - Prizes distributed
        analyticsData.totalEntryFees = totalEntryFees;
        analyticsData.totalPrizesOut = totalPrizesOut || analyticsData.totalPayout;
        analyticsData.platformProfit = totalEntryFees - (totalPrizesOut || 0);
        
        // Overall net (deposits - withdrawals, for manual UPI tracking)
        analyticsData.netProfit = analyticsData.totalRevenue - analyticsData.totalPayout;
        
        // Load top players by earnings
        if (usersSnapshot) {
            var players = [];
            usersSnapshot.forEach(function(c) {
                var u = c.val();
                var earnings = (u.totalWinnings || 0) + (u.stats ? u.stats.earnings || 0 : 0);
                if (earnings > 0) {
                    players.push({
                        uid: c.key,
                        ign: u.ign || 'Unknown',
                        earnings: earnings
                    });
                }
            });
            analyticsData.topPlayers = players.sort(function(a, b) {
                return b.earnings - a.earnings;
            }).slice(0, 5);
        }
        
        renderAnalytics();
        
    } catch (e) {
        console.error('Analytics error:', e);
        showToast('Error loading analytics: ' + e.message, true);
    }
}

function renderAnalytics() {
    // Main stats cards
    var _rev=document.getElementById('analRevenue'); if(_rev)_rev.textContent='₹'+analyticsData.totalRevenue.toLocaleString();
    var _pay=document.getElementById('analPayout'); if(_pay)_pay.textContent='₹'+analyticsData.totalPayout.toLocaleString();
    // Platform profit cards
    var _ef=document.getElementById('analEntryFees'); if(_ef)_ef.textContent='₹'+(analyticsData.totalEntryFees||0).toLocaleString();
    var _pp=document.getElementById('analPlatformProfit');
    if(_pp){
        var profit=analyticsData.platformProfit||0;
        _pp.textContent='₹'+profit.toLocaleString();
        _pp.style.color=profit>=0?'var(--primary)':'var(--danger)';
    }
    
    var netEl = document.getElementById('analNet');
    if(netEl) { netEl.textContent = '₹' + analyticsData.netProfit.toLocaleString();
    netEl.className = analyticsData.netProfit >= 0 ? 'value text-primary' : 'value text-danger'; }
    
    // Bar chart (last 7 days)
    renderBarChart();
    
    // Top matches
    var topMatchesHtml = '';
    if (analyticsData.topMatches.length === 0) {
        topMatchesHtml = '<p class="text-muted text-xs">No match data yet</p>';
    } else {
        analyticsData.topMatches.forEach(function(m, i) {
            topMatchesHtml += '<div class="feed-item">' +
                '<div class="flex items-center justify-between">' +
                    '<span class="text-xs font-bold">#' + (i + 1) + ' ' + m.name + '</span>' +
                    '<span class="text-primary font-bold">₹' + m.distributed + '</span>' +
                '</div>' +
            '</div>';
        });
    }
    var _tm=document.getElementById('analTopMatches'); if(_tm)_tm.innerHTML=topMatchesHtml;
    
    // Top players
    var topPlayersHtml = '';
    if (analyticsData.topPlayers.length === 0) {
        topPlayersHtml = '<p class="text-muted text-xs">No player data yet</p>';
    } else {
        analyticsData.topPlayers.forEach(function(p, i) {
            topPlayersHtml += '<div class="feed-item">' +
                '<div class="flex items-center justify-between">' +
                    '<span class="text-xs font-bold">#' + (i + 1) + ' ' + p.ign + '</span>' +
                    '<span class="text-primary font-bold">₹' + p.earnings + '</span>' +
                '</div>' +
            '</div>';
        });
    }
    var _tp=document.getElementById('analTopPlayers'); if(_tp)_tp.innerHTML=topPlayersHtml;
}

function renderBarChart() {
    var chartEl = document.getElementById('analChart');
    if (!chartEl) return;
    
    // Get last 7 days
    var days = [];
    for (var i = 6; i >= 0; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
    }
    
    var maxVal = 1;
    days.forEach(function(day) {
        var data = analyticsData.dailyData[day] || { revenue: 0 };
        if (data.revenue > maxVal) maxVal = data.revenue;
    });
    
    var html = '<div class="bar-chart">';
    days.forEach(function(day) {
        var data = analyticsData.dailyData[day] || { revenue: 0, payout: 0 };
        var pct = Math.round((data.revenue / maxVal) * 100);
        var dayLabel = new Date(day).toLocaleDateString('en-US', { weekday: 'short' });
        
        html += '<div class="bar-col">' +
            '<div class="bar-value">₹' + data.revenue + '</div>' +
            '<div class="bar-fill-container">' +
                '<div class="bar-fill" style="height:' + Math.max(pct, 5) + '%"></div>' +
            '</div>' +
            '<div class="bar-label">' + dayLabel + '</div>' +
        '</div>';
    });
    html += '</div>';
    
    chartEl.innerHTML = html;
}

function refreshAnalytics() {
    loadAnalytics();
    showToast('Analytics refreshed!');
}

console.log('✅ admin-analytics.js loaded');
