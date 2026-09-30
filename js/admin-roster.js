/* =============================================
   ADMIN ROSTER - Live Match Roster
   js/admin-roster.js
   ============================================= */

var rosterStatus = {}; // Local tracking: { uid: 'present'|'kick'|'waiting' }
var rosterPlayers = []; // Current roster players

function loadRosterMatches() {
    var select = document.getElementById('rosterMatchSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select Live/Upcoming Match --</option>';
    
    Object.keys(allTournaments).forEach(function(id) {
        var t = allTournaments[id];
        var status = getAdminMatchStatus(t);
        if (status === 'live' || status === 'upcoming') {
            var timeStr = t.matchTime ? new Date(t.matchTime).toLocaleString() : '';
            select.innerHTML += '<option value="' + id + '">' + t.name + ' (' + status.toUpperCase() + ') - ' + timeStr + '</option>';
        }
    });
}

function loadRoster() {
    var mid = document.getElementById('rosterMatchSelect').value;
    if (!mid) {
        document.getElementById('rosterTable').innerHTML = '<tr><td colspan="5" class="text-muted text-center">Select a match first</td></tr>';
        document.getElementById('rosterStats').innerHTML = '';
        return;
    }
    
    var tb = document.getElementById('rosterTable');
    tb.innerHTML = '<tr><td colspan="5" class="text-muted text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';
    
    rosterPlayers = [];
    
    // Check joinRequests
    rtdb.ref(DB_JOIN).once('value', function(s) {
        s.forEach(function(c) {
            var j = c.val();
            var tid = j.tournamentId || j.matchId;
            var isJoined = (j.status === 'approved' || j.status === 'joined' || j.status === 'confirmed' || !j.status);
            
            if (tid === mid && isJoined) {
                var uid = j.userId || j.uid || j.oderId;
                rosterPlayers.push({
                    uid: uid,
                    ign: j.userName || j.playerName || j.ign || getUserName(uid),
                    ffUid: j.userFFUID || j.ffUid || j.gameUid || 'N/A',
                    reqId: c.key
                });
                /* ✅ FIX (2026-10-01): pehle se save ki hui attendance wapas dikhao
                   (warna reload par sab "Waiting" ho jata tha) */
                var _att = j.attendanceStatus;
                if (_att === 'present') rosterStatus[uid] = 'present';
                else if (_att === 'absent') rosterStatus[uid] = 'kick';
            }
        });
        
        // Also check matches/{mid}/joined
        rtdb.ref(DB_MATCHES + '/' + mid + '/joined').once('value', function(joinedSnap) {
            if (joinedSnap.exists()) {
                joinedSnap.forEach(function(ps) {
                    var pdata = ps.val() || {};
                    /* ✅ FIX (2026-10-01): is RTDB path ke keys JOIN-REQUEST id hote
                       hain, user id nahi — isliye upar wale loop ka 'exists' check
                       kabhi match nahi karta tha aur ek hi player roster me DO baar
                       dikhta tha (live-proven: 2 rows, dono QAUser01). Ab user id
                       hi use hoti hai (jo status-marking ke liye bhi chahiye). */
                    var puid = pdata.uid || pdata.userId || ps.key;
                    // Check if already added
                    var exists = rosterPlayers.some(function(p) { return p.uid === puid || (p.reqId && p.reqId === ps.key); });
                    if (!exists) {
                        rosterPlayers.push({
                            uid: puid,
                            ign: pdata.playerName || pdata.ign || getUserName(puid),
                            ffUid: pdata.ffUid || pdata.gameUid || 'N/A',
                            reqId: null
                        });
                    }
                });
            }
            
            renderRosterTable();
        });
    });
}

function renderRosterTable() {
    var tb = document.getElementById('rosterTable');
    
    if (rosterPlayers.length === 0) {
        tb.innerHTML = '<tr><td colspan="5" class="text-muted text-center">No players joined this match yet</td></tr>';
        document.getElementById('rosterStats').innerHTML = '';
        return;
    }
    
    tb.innerHTML = '';
    
    rosterPlayers.forEach(function(p, i) {
        var st = rosterStatus[p.uid] || 'waiting';
        var stBadge = st === 'present' ? '<span class="badge green">✅ Present</span>' :
                      st === 'kick' ? '<span class="badge red">⛔ Kicked</span>' :
                      '<span class="badge yellow">⬜ Waiting</span>';
        
        tb.innerHTML += '<tr>' +
            '<td class="text-xs text-muted">' + (i + 1) + '</td>' +
            '<td><strong class="text-sm">' + p.ign + '</strong></td>' +
            '<td class="font-mono text-xs">' + p.ffUid + '</td>' +
            '<td>' + stBadge + '</td>' +
            '<td>' +
                '<button class="btn btn-primary btn-xs" onclick="markRoster(\'' + p.uid + '\',\'present\')" title="Mark Present">✅</button> ' +
                '<button class="btn btn-danger btn-xs" onclick="markRoster(\'' + p.uid + '\',\'kick\')" title="Mark Kicked">⛔</button> ' +
                '<button class="btn btn-ghost btn-xs" onclick="markRoster(\'' + p.uid + '\',\'waiting\')" title="Reset">↩</button>' +
            '</td>' +
        '</tr>';
    });
    
    // Stats
    var present = 0, kick = 0, waiting = 0;
    rosterPlayers.forEach(function(p) {
        var st = rosterStatus[p.uid] || 'waiting';
        if (st === 'present') present++;
        else if (st === 'kick') kick++;
        else waiting++;
    });
    
    document.getElementById('rosterStats').innerHTML =
        '<div class="stat-card"><div class="stat-icon blue"><i class="fas fa-users"></i></div><h3>Total</h3><div class="value">' + rosterPlayers.length + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon green"><i class="fas fa-check"></i></div><h3>Present</h3><div class="value text-primary">' + present + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon red"><i class="fas fa-ban"></i></div><h3>Kicked</h3><div class="value text-danger">' + kick + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon orange"><i class="fas fa-clock"></i></div><h3>Waiting</h3><div class="value text-warning">' + waiting + '</div></div>';
}

/* ✅ FIX (live-testing 2026-10-01): pehle ye marking sirf browser memory
   (rosterStatus object) me thi — DB me KAHIN nahi jati thi, isliye page reload
   (ya doosre device) par hamesha "Waiting" wapas aa jata tha. Ab har marking
   `join_requests.attendance_status` me save hoti hai (wahi column jo
   Live-Attendance modal bhi use karta hai), aur load par wapas padhi jati hai. */
function _rosterPersist(uid, status, cb) {
    var db = (typeof getDB === 'function') ? getDB() : (typeof rtdb !== 'undefined' ? rtdb : null);
    var val = status === 'present' ? 'present' : status === 'kick' ? 'absent' : null;
    var mid = document.getElementById('rosterMatchSelect');
    mid = mid ? mid.value : null;
    try {
        if (window._supa) {
            /* Supabase seedha (fk-safe): match + user dono se match karke */
            var q = window._supa.from('join_requests').update({ attendance_status: val }).eq('user_id', uid);
            if (mid) q = q.eq('match_id', mid);
            q.then(function (r) {
                if (r && r.error) { showToast('⚠️ Save nahi hua: ' + r.error.message, true); cb && cb(false); return; }
                cb && cb(true);
            }, function (e) { showToast('⚠️ Save nahi hua: ' + (e && e.message), true); cb && cb(false); });
        } else if (db && db.ref) {
            db.ref('joinRequests/' + uid).update({ attendanceStatus: val }, function () { cb && cb(true); });
        } else cb && cb(false);
    } catch (e) { cb && cb(false); }
}

function markRoster(uid, status) {
    rosterStatus[uid] = status;
    renderRosterTable();

    var action = status === 'present' ? 'marked present' : status === 'kick' ? 'kicked' : 'reset';
    console.log('Roster: Player ' + uid + ' ' + action);
    _rosterPersist(uid, status, function (ok) {
        if (ok) showToast(status === 'present' ? '✅ Present saved' : status === 'kick' ? '⛔ Kicked saved' : '↩ Reset saved');
    });
}

function exportRosterList() {
    var mid = document.getElementById('rosterMatchSelect').value;
    if (!mid || rosterPlayers.length === 0) {
        showToast('No players to export', true);
        return;
    }
    
    var matchName = allTournaments[mid] ? allTournaments[mid].name : 'Match';
    var list = '🎮 IGN LIST — ' + matchName + '\n';
    list += '━'.repeat(30) + '\n\n';
    
    rosterPlayers.forEach(function(p, i) {
        var st = rosterStatus[p.uid] || '';
        var stIcon = st === 'present' ? ' ✅' : st === 'kick' ? ' ⛔' : '';
        list += (i + 1) + '. ' + p.ign + ' (FF: ' + p.ffUid + ')' + stIcon + '\n';
    });
    
    list += '\n━'.repeat(30);
    list += '\nTotal: ' + rosterPlayers.length + ' players';
    
    if (navigator.clipboard) {
        navigator.clipboard.writeText(list).then(function() {
            showToast('✅ IGN List copied to clipboard!');
        });
    } else {
        // Fallback
        var ta = document.createElement('textarea');
        ta.value = list;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('✅ IGN List copied!');
    }
}

function clearRosterStatus() {
    if (confirm('Clear all roster status?')) {
        rosterStatus = {};
        renderRosterTable();
        showToast('Roster status cleared');
    }
}

// Auto-refresh roster every 30 seconds
setInterval(function() {
    var mid = document.getElementById('rosterMatchSelect');
    if (mid && mid.value && document.getElementById('section-roster').classList.contains('active')) {
        loadRoster();
    }
}, 30000);

console.log('✅ admin-roster.js loaded');
