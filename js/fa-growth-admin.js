/* ================================================================
   GROWTH ADMIN — fa-growth-admin.js
   Mini eSports Admin Panel v11

   1. Creator Program Management (Approve/Reject/Payouts)
   2. Sky Diamond Cosmetics Requests
   3. Achievement Leaderboard
   4. Streak Top Players
   5. Dashboard Stats Update (new metrics)
   ================================================================ */

/* ── HELPERS ── */
function _gEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _gToast(msg, err) {
  if (window.showToast) showToast(msg, err||false);
}
function _gDb() { return window.rtdb || window.db; }

/* ================================================================
   1. CREATOR PROGRAM MANAGEMENT
   ================================================================ */
window.loadCreatorSection = function() {
  loadCreatorApplications();
  loadCreatorPayouts();
  loadCreatorLeaderboard();
};

function loadCreatorApplications() {
  var tbody = document.getElementById('creatorAppTable');
  if (!tbody || !_gDb()) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:#555">Loading...</td></tr>';

  _gDb().ref('users').orderByChild('creatorProfile/code').startAt('').once('value', function(snap) {
    var apps = [];
    snap.forEach(function(c) {
      var u = c.val();
      if (u.creatorProfile && u.creatorProfile.code) {
        apps.push({ uid: c.key, u: u, cp: u.creatorProfile });
      }
    });

    // Update badge
    var pending = apps.filter(function(a){ return a.cp.status === 'pending'; }).length;
    if (window.updateBadge) updateBadge('creatorBadge', pending);
    var countEl = document.getElementById('creatorAppCount');
    if (countEl) countEl.textContent = apps.length;

    if (!apps.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#555">Koi creator application nahi</td></tr>';
      return;
    }

    var html = '';
    apps.forEach(function(a) {
      var cp = a.cp;
      var stats = {}; // will load separately
      var statusBadge = cp.status === 'approved'
        ? '<span style="color:#00ff9c;font-weight:700;font-size:11px">✅ Approved</span>'
        : cp.status === 'rejected'
        ? '<span style="color:#ff6b6b;font-weight:700;font-size:11px">❌ Rejected</span>'
        : '<span style="color:#ffd700;font-weight:700;font-size:11px">⏳ Pending</span>';

      var actionBtns = '';
      if (cp.status === 'pending') {
        actionBtns = '<button onclick="approveCreator(\'' + a.uid + '\',\'' + _gEsc(cp.code) + '\')" style="padding:4px 10px;border-radius:8px;background:rgba(0,255,156,.12);border:1px solid rgba(0,255,156,.25);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">✅ Approve</button>' +
          '<button onclick="rejectCreator(\'' + a.uid + '\')" style="padding:4px 10px;border-radius:8px;background:rgba(255,60,60,.08);border:1px solid rgba(255,60,60,.2);color:#ff6b6b;font-size:11px;cursor:pointer">❌ Reject</button>';
      } else if (cp.status === 'approved') {
        actionBtns = '<button onclick="viewCreatorStats(\'' + a.uid + '\')" style="padding:4px 10px;border-radius:8px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.25);color:#00d4ff;font-size:11px;cursor:pointer">📊 Stats</button>';
      }

      html += '<tr>';
      html += '<td>' + _gEsc(a.u.ign || a.uid.substring(0,8)) + '</td>';
      html += '<td><strong style="color:#fff;font-size:13px;letter-spacing:1px">' + _gEsc(cp.code) + '</strong></td>';
      html += '<td>' + _gEsc(cp.followers || '—') + '</td>';
      html += '<td><a href="' + _gEsc(cp.channel||'#') + '" target="_blank" style="color:#00d4ff;font-size:11px">' + (cp.channel ? 'View →' : '—') + '</a></td>';
      html += '<td>' + statusBadge + '</td>';
      html += '<td style="font-size:11px;color:#666">' + (cp.createdAt ? new Date(cp.createdAt).toLocaleDateString('en-IN') : '—') + '</td>';
      html += '<td>' + actionBtns + '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;
  });
}

window.approveCreator = function(uid, code) {
  if (!confirm('Creator "' + code + '" approve karo?')) return;
  _gDb().ref('users/' + uid + '/creatorProfile/status').set('approved');
  _gDb().ref('users/' + uid + '/notifications').push({
    type: 'creator_approved', title: '✅ Creator Approved!',
    message: 'Tumhara creator code "' + code + '" approve ho gaya! Ab tumhe har Sky Diamond purchase pe 20% commission milegi.',
    read: false, timestamp: Date.now()
  });
  _gToast('Creator approved!', false);
  loadCreatorApplications();
};

window.rejectCreator = function(uid) {
  if (!confirm('Is creator application ko reject karo?')) return;
  _gDb().ref('users/' + uid + '/creatorProfile/status').set('rejected');
  _gDb().ref('users/' + uid + '/notifications').push({
    type: 'creator_rejected', title: '❌ Creator Application',
    message: 'Tumhari creator application abhi approve nahi hui. Kuch din baad dobara try karo.',
    read: false, timestamp: Date.now()
  });
  _gToast('Application rejected.', false);
  loadCreatorApplications();
};

window.viewCreatorStats = function(uid) {
  _gDb().ref('creatorStats/' + uid).once('value', function(s) {
    var stats = s.val() || {};
    _gDb().ref('users/' + uid + '/creatorProfile').once('value', function(cs) {
      var cp = cs.val() || {};
      var h = '<div style="text-align:center;margin-bottom:16px">';
      h += '<div style="font-size:20px;font-weight:900;color:#00d4ff;letter-spacing:2px">' + _gEsc(cp.code||'') + '</div>';
      h += '<div style="font-size:12px;color:#888;margin-top:4px">' + _gEsc(cp.followers||'') + ' followers</div></div>';
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
      [
        { l: 'Total Sales', v: stats.totalSales||0, c: '#00d4ff' },
        { l: 'Total Commission', v: '₹'+(stats.totalCommission||0), c: '#00ff9c' },
        { l: 'Pending Payout', v: '₹'+(stats.pendingPayout||0), c: '#ffd700' },
        { l: 'Paid Out', v: '₹'+(stats.paidOut||0), c: '#888' },
      ].forEach(function(i) {
        h += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;text-align:center">';
        h += '<div style="font-size:11px;color:#666;margin-bottom:4px">' + i.l + '</div>';
        h += '<div style="font-size:20px;font-weight:900;color:' + i.c + '">' + i.v + '</div></div>';
      });
      h += '</div>';
      if (window.openAdminModal) openAdminModal('Creator Stats', h);
      else alert(JSON.stringify(stats));
    });
  });
};

function loadCreatorPayouts() {
  var tbody = document.getElementById('creatorPayoutTable');
  if (!tbody || !_gDb()) return;

  _gDb().ref('creatorPayouts').orderByChild('status').equalTo('pending').once('value', function(snap) {
    if (!snap.exists()) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:#555">Koi pending payout nahi</td></tr>';
      return;
    }
    var html = '';
    snap.forEach(function(c) {
      var d = c.val();
      html += '<tr>';
      html += '<td>' + _gEsc(d.ign||d.uid.substring(0,8)) + '</td>';
      html += '<td style="color:#00ff9c;font-weight:800">₹' + (d.amount||0) + '</td>';
      html += '<td style="font-size:11px;color:#666">' + (d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN') : '—') + '</td>';
      html += '<td><span style="color:#ffd700;font-size:11px;font-weight:700">⏳ Pending</span></td>';
      html += '<td>';
      html += '<button onclick="approveCreatorPayout(\'' + c.key + '\',\'' + d.uid + '\',' + (d.amount||0) + ')" style="padding:4px 10px;border-radius:8px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.25);color:#00ff9c;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">✅ Paid</button>';
      html += '</td></tr>';
    });
    tbody.innerHTML = html;
  });
}

window.approveCreatorPayout = function(payoutId, uid, amount) {
  if (!confirm('₹' + amount + ' payout mark as paid?')) return;
  _gDb().ref('creatorPayouts/' + payoutId + '/status').set('paid');
  _gDb().ref('creatorPayouts/' + payoutId + '/paidAt').set(Date.now());
  _gDb().ref('creatorStats/' + uid + '/paidOut').transaction(function(v){ return (v||0) + amount; });
  _gDb().ref('users/' + uid + '/notifications').push({
    type: 'creator_payout', title: '💰 Payout Complete!',
    message: '₹' + amount + ' tumhare UPI pe transfer ho gaya! Creator program ke liye shukriya 🙏',
    read: false, timestamp: Date.now()
  });
  _gToast('Payout marked as paid!', false);
  loadCreatorPayouts();
};

function loadCreatorLeaderboard() {
  var container = document.getElementById('creatorLeaderboard');
  if (!container || !_gDb()) return;

  _gDb().ref('creatorStats').once('value', function(snap) {
    if (!snap.exists()) {
      container.innerHTML = '<div style="text-align:center;padding:16px;color:#555">Koi creator data nahi</div>';
      return;
    }
    var creators = [];
    snap.forEach(function(c) { creators.push({ uid: c.key, s: c.val() }); });
    creators.sort(function(a,b){ return (b.s.totalCommission||0) - (a.s.totalCommission||0); });

    var html = '<table><thead><tr><th>#</th><th>Creator UID</th><th>Sales</th><th>Commission</th><th>Pending</th></tr></thead><tbody>';
    creators.slice(0, 10).forEach(function(c, i) {
      html += '<tr>';
      html += '<td style="font-weight:800;color:' + (i<3?'#ffd700':'#666') + '">' + (i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)) + '</td>';
      html += '<td style="font-size:11px;color:#888">' + c.uid.substring(0,12) + '...</td>';
      html += '<td style="color:#00d4ff;font-weight:700">' + (c.s.totalSales||0) + '</td>';
      html += '<td style="color:#00ff9c;font-weight:800">₹' + (c.s.totalCommission||0) + '</td>';
      html += '<td style="color:#ffd700">₹' + (c.s.pendingPayout||0) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  });
}

/* ================================================================
   2. TOP STREAKS
   ================================================================ */
window.loadStreakLeaderboard = function() {
  var container = document.getElementById('streakLeaderboardContainer');
  if (!container || !_gDb()) return;
  container.innerHTML = '<div style="text-align:center;padding:16px;color:#555"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

  _gDb().ref('users').orderByChild('loginStreak').limitToLast(20).once('value', function(snap) {
    var players = [];
    snap.forEach(function(c) {
      var u = c.val();
      if (Number(u.loginStreak||0) > 0) {
        players.push({ uid: c.key, ign: u.ign||'Unknown', streak: Number(u.loginStreak||0), avatarBg: u.avatarBg||'#1a1a2e' });
      }
    });
    players.sort(function(a,b){ return b.streak - a.streak; });

    if (!players.length) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:#555">Koi streak data nahi</div>';
      return;
    }

    var html = '<table><thead><tr><th>#</th><th>Player</th><th>Streak</th><th>Milestone</th></tr></thead><tbody>';
    players.forEach(function(p, i) {
      var milestone = p.streak >= 100 ? '🌟 Immortal' : p.streak >= 60 ? '👑 Legend' : p.streak >= 30 ? '⚡ Dedicated' : p.streak >= 7 ? '🔥 Unstoppable' : '';
      html += '<tr>';
      html += '<td style="font-weight:800;color:' + (i<3?'#ffd700':'#666') + '">' + (i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)) + '</td>';
      html += '<td style="font-weight:700">' + _gEsc(p.ign) + '</td>';
      html += '<td style="color:#ff8c00;font-weight:800;font-size:15px">🔥 ' + p.streak + '</td>';
      html += '<td>' + (milestone ? '<span style="font-size:12px;font-weight:700">' + milestone + '</span>' : '<span style="color:#444">—</span>') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  });
};

/* ================================================================
   3. ACHIEVEMENT STATS
   ================================================================ */
window.loadAchievementStats = function() {
  var container = document.getElementById('achievementStatsContainer');
  if (!container || !_gDb()) return;
  container.innerHTML = '<div style="text-align:center;padding:16px;color:#555"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

  _gDb().ref('users').once('value', function(snap) {
    var counts = {};
    var ACH_IDS = ['city_king','unstoppable','veteran','slayer','legend','recruiter','wealthy','clan_chief'];
    ACH_IDS.forEach(function(id){ counts[id] = 0; });

    snap.forEach(function(c) {
      var u = c.val();
      var a = u.achievementsV3 || {};
      ACH_IDS.forEach(function(id){ if (a[id]) counts[id]++; });
    });

    var labels = { city_king:'🌆 City King', unstoppable:'🔥 Unstoppable', veteran:'🎖️ Veteran', slayer:'⚡ Slayer', legend:'👑 Legend', recruiter:'🤝 Recruiter', wealthy:'💎 Diamond Hoarder', clan_chief:'⚔️ Clan Chief' };
    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    ACH_IDS.forEach(function(id) {
      html += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px;display:flex;align-items:center;justify-content:space-between">';
      html += '<div style="font-size:12px;font-weight:700">' + (labels[id]||id) + '</div>';
      html += '<div style="font-size:18px;font-weight:900;color:#00d4ff">' + counts[id] + '</div>';
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  });
};

/* ================================================================
   4. COSMETICS REVENUE TRACKING
   ================================================================ */
window.loadCosmeticsRevenue = function() {
  var container = document.getElementById('cosmeticsRevenueContainer');
  if (!container || !_gDb()) return;

  _gDb().ref('users').once('value', function(snap) {
    var itemCounts = {};
    var ITEMS = [
      { id:'frame_neon', name:'Neon Frame', price:50 },
      { id:'frame_fire', name:'Fire Frame', price:75 },
      { id:'frame_galaxy', name:'Galaxy Frame', price:100 },
      { id:'frame_gold', name:'Gold Champion', price:150 },
      { id:'tag_beast', name:'⚡ BEAST MODE', price:30 },
      { id:'tag_pro', name:'🎯 PRO PLAYER', price:30 },
      { id:'tag_king', name:'👑 KING', price:50 },
      { id:'vip_slot', name:'VIP Slot Pass', price:200 },
    ];
    ITEMS.forEach(function(i){ itemCounts[i.id] = 0; });

    snap.forEach(function(c) {
      var cosmetics = (c.val().cosmetics) || {};
      ITEMS.forEach(function(i){ if (cosmetics[i.id]) itemCounts[i.id]++; });
    });

    var html = '<table><thead><tr><th>Item</th><th>Price (💎)</th><th>Sold</th><th>Revenue (💎)</th></tr></thead><tbody>';
    var totalRevenue = 0;
    ITEMS.forEach(function(item) {
      var sold = itemCounts[item.id];
      var rev = sold * item.price;
      totalRevenue += rev;
      html += '<tr>';
      html += '<td style="font-weight:700">' + _gEsc(item.name) + '</td>';
      html += '<td style="color:#00d4ff">💎 ' + item.price + '</td>';
      html += '<td style="color:#ffd700;font-weight:700">' + sold + '</td>';
      html += '<td style="color:#00ff9c;font-weight:800">💎 ' + rev + '</td>';
      html += '</tr>';
    });
    html += '<tr style="background:rgba(0,255,156,.05);border-top:2px solid rgba(0,255,156,.2)">';
    html += '<td colspan="3" style="font-weight:800;color:#00ff9c">Total Revenue</td>';
    html += '<td style="font-weight:900;font-size:15px;color:#00ff9c">💎 ' + totalRevenue + '</td>';
    html += '</tr>';
    html += '</tbody></table>';
    container.innerHTML = html;
  });
};

/* ================================================================
   5. INJECT CREATOR + STATS SECTIONS INTO ADMIN HTML
   ================================================================ */
window.initGrowthAdmin = function() {
  if (document.getElementById('section-creatorProgram')) return; // already injected

  // Add nav badge listener for creator pending
  if (_gDb()) {
    _gDb().ref('users').on('value', function(snap) {
      var pending = 0;
      snap.forEach(function(c) {
        var cp = (c.val().creatorProfile||{});
        if (cp.code && cp.status === 'pending') pending++;
      });
      if (window.updateBadge) updateBadge('creatorBadge', pending);
    });
  }

  // Inject sections
  var body = document.querySelector('.main-content') || document.getElementById('mainContent') || document.body;

  var creatorSection = document.createElement('div');
  creatorSection.className = 'section';
  creatorSection.id = 'section-creatorProgram';
  creatorSection.style.display = 'none';
  creatorSection.innerHTML = `
    <div class="section-header">
      <div class="section-title"><i class="fas fa-broadcast-tower" style="color:#00d4ff"></i> Creator Program <span class="count" id="creatorAppCount">0</span></div>
      <div class="section-actions">
        <button class="btn btn-sm btn-ghost" onclick="loadCreatorSection()"><i class="fas fa-sync-alt"></i> Refresh</button>
      </div>
    </div>

    <div style="background:linear-gradient(135deg,rgba(0,100,255,.06),rgba(0,212,255,.04));border:1px solid rgba(0,212,255,.15);border-radius:12px;padding:12px;margin-bottom:16px;font-size:12px;color:#888;line-height:1.7">
      🔵 <strong style="color:#00d4ff">Creator Match Commission:</strong>
      Creator match banata hai → players Sky Diamond entry fee dete hain → Creator ko automatically <strong style='color:#00ff9c'>15%</strong> milta hai → Minimum ₹100 hone pe payout request → Admin approve karta hai
    </div>

    <!-- Applications Table -->
    <div class="card" style="margin-bottom:16px"><div class="card-body compact">
      <div style="font-size:13px;font-weight:800;color:#00d4ff;margin-bottom:12px"><i class="fas fa-users"></i> Creator Applications</div>
      <div class="table-wrapper"><table>
        <thead><tr><th>IGN</th><th>Code</th><th>Followers</th><th>Channel</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody id="creatorAppTable"><tr><td colspan="7" style="text-align:center;padding:16px;color:#555">Loading...</td></tr></tbody>
      </table></div>
    </div></div>

    <!-- Payout Table -->
    <div class="card" style="margin-bottom:16px"><div class="card-body compact">
      <div style="font-size:13px;font-weight:800;color:#00ff9c;margin-bottom:12px"><i class="fas fa-money-bill-wave"></i> Pending Payouts</div>
      <div class="table-wrapper"><table>
        <thead><tr><th>Creator</th><th>Amount</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead>
        <tbody id="creatorPayoutTable"><tr><td colspan="5" style="text-align:center;padding:16px;color:#555">Loading...</td></tr></tbody>
      </table></div>
    </div></div>

    <!-- Leaderboard -->
    <div class="card"><div class="card-body compact">
      <div style="font-size:13px;font-weight:800;color:#ffd700;margin-bottom:12px"><i class="fas fa-trophy"></i> Top Creators by Commission</div>
      <div id="creatorLeaderboard"><div style="text-align:center;padding:16px;color:#555">Loading...</div></div>
    </div></div>
  `;
  body.appendChild(creatorSection);

  // Growth Analytics section
  var analyticsSection = document.createElement('div');
  analyticsSection.className = 'section';
  analyticsSection.id = 'section-growthAnalytics';
  analyticsSection.style.display = 'none';
  analyticsSection.innerHTML = `
    <div class="section-header">
      <div class="section-title"><i class="fas fa-chart-line" style="color:#b964ff"></i> Growth Analytics</div>
      <div class="section-actions">
        <button class="btn btn-sm btn-ghost" onclick="loadStreakLeaderboard();loadAchievementStats();loadCosmeticsRevenue()"><i class="fas fa-sync-alt"></i> Refresh</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <!-- Streak Leaderboard -->
      <div class="card"><div class="card-body compact">
        <div style="font-size:13px;font-weight:800;color:#ff8c00;margin-bottom:12px">🔥 Top Login Streaks</div>
        <div id="streakLeaderboardContainer"><div style="text-align:center;padding:16px;color:#555">Click Refresh</div></div>
      </div></div>

      <!-- Achievement Stats -->
      <div class="card"><div class="card-body compact">
        <div style="font-size:13px;font-weight:800;color:#ffd700;margin-bottom:12px">🏅 Achievement Distribution</div>
        <div id="achievementStatsContainer"><div style="text-align:center;padding:16px;color:#555">Click Refresh</div></div>
      </div></div>
    </div>

    <!-- Cosmetics Revenue -->
    <div class="card" style="margin-top:16px"><div class="card-body compact">
      <div style="font-size:13px;font-weight:800;color:#00d4ff;margin-bottom:12px">💎 Cosmetics Revenue (Sky Diamonds)</div>
      <div id="cosmeticsRevenueContainer"><div style="text-align:center;padding:16px;color:#555">Click Refresh</div></div>
    </div></div>
  `;
  body.appendChild(analyticsSection);

  // Inject season buttons into dashboard header
  var dashHeader = document.querySelector('#section-dashboard .section-header .section-actions, #section-dashboard .section-actions');
  if (dashHeader && !document.getElementById('seasonBtns')) {
    var seasonBtns = document.createElement('div');
    seasonBtns.id = 'seasonBtns';
    seasonBtns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    seasonBtns.innerHTML =
      '<button onclick="startNewSeason()" style="padding:7px 12px;border-radius:10px;background:linear-gradient(135deg,#ffd700,#ff8c00);border:none;color:#000;font-size:11px;font-weight:800;cursor:pointer"><i class=\"fas fa-play\"></i> New Season</button>' +
      '<button onclick="endCurrentSeason()" style="padding:7px 12px;border-radius:10px;background:rgba(255,60,60,.1);border:1px solid rgba(255,60,60,.2);color:#ff6b6b;font-size:11px;font-weight:700;cursor:pointer"><i class=\"fas fa-flag-checkered\"></i> End Season</button>';
    dashHeader.appendChild(seasonBtns);
  }
  console.log('✅ fa-growth-admin.js sections injected');
};

/* ================================================================
   6. INJECT NAV ITEMS
   ================================================================ */
window.injectGrowthNavItems = function() {
  if (document.getElementById('growthNavItems')) return;

  // Find the "Tools" section label in sidebar
  var sidebar = document.querySelector('.sidebar-nav') || document.querySelector('.nav-section-label');
  if (!sidebar) return;

  // Find the Tools nav section label
  var allLabels = document.querySelectorAll('.nav-section-label');
  var toolsLabel = null;
  allLabels.forEach(function(l) {
    if (l.textContent.trim() === 'Tools') toolsLabel = l;
  });

  if (!toolsLabel) return;

  var wrapper = document.createElement('div');
  wrapper.id = 'growthNavItems';
  wrapper.innerHTML = `
    <div class="nav-section-label">Growth</div>
    <div class="nav-item" onclick="showSection('creatorProgram',this);loadCreatorSection()">
      <i class="fas fa-broadcast-tower" style="color:#00d4ff"></i>
      <span class="nav-label">Creator Program</span>
      <span class="nav-badge cyan" id="creatorBadge" style="display:none">0</span>
    </div>
    <div class="nav-item" onclick="showSection('growthAnalytics',this);loadStreakLeaderboard();loadAchievementStats();loadCosmeticsRevenue()">
      <i class="fas fa-chart-line" style="color:#b964ff"></i>
      <span class="nav-label">Growth Analytics</span>
    </div>
    <div class="nav-item" onclick="showSection('appSettings',this);loadAppSettings()">
      <i class="fas fa-sliders-h" style="color:#ffd700"></i>
      <span class="nav-label">App Settings</span>
    </div>
  `;
  toolsLabel.parentNode.insertBefore(wrapper, toolsLabel);
};

/* ================================================================
   7. UPDATE DASHBOARD STATS — add creator + streak metrics
   ================================================================ */
window.updateGrowthDashStats = function() {
  if (!_gDb()) return;

  _gDb().ref('users').once('value', function(snap) {
    var totalUsers = 0, creatorCount = 0, streakUsers = 0, achievementUsers = 0;
    snap.forEach(function(c) {
      var u = c.val();
      totalUsers++;
      if (u.creatorProfile && u.creatorProfile.status === 'approved') creatorCount++;
      if (Number(u.loginStreak||0) >= 3) streakUsers++;
      if (u.achievementsV3 && Object.keys(u.achievementsV3).length > 0) achievementUsers++;
    });

    var el;
    el = document.getElementById('statCreators');
    if (el) el.textContent = creatorCount;
    el = document.getElementById('statStreakUsers');
    if (el) el.textContent = streakUsers;
    el = document.getElementById('statAchievUsers');
    if (el) el.textContent = achievementUsers;
  });

  // Creator total commission
  _gDb().ref('creatorStats').once('value', function(snap) {
    var total = 0;
    snap.forEach(function(c){ total += Number(c.val().totalCommission||0); });
    var el = document.getElementById('statCreatorCommission');
    if (el) el.textContent = '₹' + total;
  });
};

/* ================================================================
   INIT
   ================================================================ */
function growthAdminInit() {
  if (typeof showSection === 'undefined') {
    setTimeout(growthAdminInit, 800);
    return;
  }
  window.injectGrowthNavItems();
  window.initGrowthAdmin();
  setTimeout(window.updateGrowthDashStats, 3000);
  console.log('✅ fa-growth-admin.js initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(growthAdminInit, 1500); });
} else {
  setTimeout(growthAdminInit, 1500);
}
