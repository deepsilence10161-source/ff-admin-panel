/* =============================================
   ADMIN SCHEDULER - Bulk Match Creator
   js/admin-scheduler.js
   ============================================= */

function openBulkScheduler() {
    var modal = document.getElementById('bulkSchedulerModal');
    if (modal) {
        // Reset form
        document.getElementById('bulkName').value = '';
        document.getElementById('bulkMode').value = 'squad';
        document.getElementById('bulkMap').value = 'Bermuda';
        document.getElementById('bulkEntryType').value = 'paid';
        document.getElementById('bulkFee').value = '30';
        document.getElementById('bulkPerKill').value = '10';
        document.getElementById('bulkSlots').value = '12';
        document.getElementById('bulkPrize1').value = '0';
        document.getElementById('bulkPrize2').value = '0';
        document.getElementById('bulkPrize3').value = '0';
        document.getElementById('bulkTime').value = '20:00';
        document.getElementById('bulkDays').value = '7';
        document.getElementById('bulkStartDate').valueAsDate = new Date();
        
        modal.classList.add('show');
    }
}

function closeBulkScheduler() {
    var modal = document.getElementById('bulkSchedulerModal');
    if (modal) modal.classList.remove('show');
}

async function executeBulkCreate() {
    var name = document.getElementById('bulkName').value.trim();
    var mode = document.getElementById('bulkMode').value;
    var map = document.getElementById('bulkMap').value;
    var entryType = document.getElementById('bulkEntryType').value;
    var fee = Number(document.getElementById('bulkFee').value) || 0;
    var perKill = Number(document.getElementById('bulkPerKill').value) || 0;
    var slots = Number(document.getElementById('bulkSlots').value) || 12;
    var prize1 = Number(document.getElementById('bulkPrize1').value) || 0;
    var prize2 = Number(document.getElementById('bulkPrize2').value) || 0;
    var prize3 = Number(document.getElementById('bulkPrize3').value) || 0;
    var time = document.getElementById('bulkTime').value;
    var days = Number(document.getElementById('bulkDays').value) || 1;
    var startDate = document.getElementById('bulkStartDate').value;
    
    // Validation
    if (!name) { showToast('Enter match name template', true); return; }
    if (!time) { showToast('Enter match time', true); return; }
    if (days < 1 || days > 30) { showToast('Days must be 1-30', true); return; }
    if (entryType === 'paid' && fee <= 0) { showToast('Entry fee required for paid matches', true); return; }
    if (perKill <= 0) { showToast('Per kill prize required', true); return; }
    
    var btn = document.querySelector('#bulkSchedulerModal .btn-primary');
    if (btn) setLoading(btn, true);
    
    try {
        var [hours, minutes] = time.split(':').map(Number);
        var baseDate = startDate ? new Date(startDate) : new Date();
        var created = 0;
        
        for (var i = 0; i < days; i++) {
            var matchDate = new Date(baseDate);
            matchDate.setDate(matchDate.getDate() + i);
            matchDate.setHours(hours, minutes, 0, 0);
            
            // Skip if in the past
            if (matchDate.getTime() < Date.now()) continue;
            
            var matchData = {
                name: name + ' #' + (i + 1),
                gameMode: mode,
                matchType: mode,
                mode: mode,
                map: map,
                entryType: entryType,
                entryFee: fee,
                perKillPrize: perKill,
                prizePool: prize1 + prize2 + prize3,
                firstPrize: prize1,
                secondPrize: prize2,
                thirdPrize: prize3,
                maxSlots: slots,
                matchTime: matchDate.getTime(),
                status: 'upcoming',
                filledSlots: 0,
                joinedSlots: 0,
                roomId: '',
                roomPassword: '',
                isSpecial: false,
                createdAt: Date.now(),
                createdBy: auth.currentUser ? auth.currentUser.uid : 'admin'
            };
            
            await rtdb.ref(DB_MATCHES).push(matchData);
            created++;
            
            console.log('Created match:', matchData.name, 'at', matchDate.toLocaleString());
        }
        
        if (btn) setLoading(btn, false);
        closeBulkScheduler();
        
        if (created > 0) {
            showToast('✅ ' + created + ' matches created successfully!');
            loadTournaments();
            
            // Log activity
            await rtdb.ref('activityLogs').push({
                type: 'bulk_matches_created',
                count: created,
                template: name,
                admin: auth.currentUser ? auth.currentUser.uid : 'admin',
                timestamp: Date.now()
            });
        } else {
            showToast('No matches created (all dates in the past)', true);
        }
        
    } catch (e) {
        if (btn) setLoading(btn, false);
        console.error('Bulk create error:', e);
        showToast('Error: ' + e.message, true);
    }
}

function checkTimeConflicts(matchTime) {
    var conflicts = [];
    Object.keys(allTournaments).forEach(function(id) {
        var t = allTournaments[id];
        if (!t.matchTime) return;
        
        var diff = Math.abs(t.matchTime - matchTime);
        if (diff < 30 * 60 * 1000) { // Within 30 minutes
            conflicts.push(t.name);
        }
    });
    return conflicts;
}

function previewBulkSchedule() {
    var name = document.getElementById('bulkName').value.trim() || 'Match';
    var time = document.getElementById('bulkTime').value;
    var days = Number(document.getElementById('bulkDays').value) || 1;
    var startDate = document.getElementById('bulkStartDate').value;
    
    if (!time) { showToast('Enter time first', true); return; }
    
    var [hours, minutes] = time.split(':').map(Number);
    var baseDate = startDate ? new Date(startDate) : new Date();
    
    var preview = '📅 Schedule Preview:\n\n';
    
    for (var i = 0; i < Math.min(days, 10); i++) {
        var matchDate = new Date(baseDate);
        matchDate.setDate(matchDate.getDate() + i);
        matchDate.setHours(hours, minutes, 0, 0);
        
        var conflicts = checkTimeConflicts(matchDate.getTime());
        var conflictWarning = conflicts.length > 0 ? ' ⚠️ Conflict!' : '';
        
        preview += (i + 1) + '. ' + name + ' #' + (i + 1) + '\n';
        preview += '   ' + matchDate.toLocaleString() + conflictWarning + '\n\n';
    }
    
    if (days > 10) preview += '... and ' + (days - 10) + ' more\n';
    
    alert(preview);
}

console.log('✅ admin-scheduler.js loaded');
