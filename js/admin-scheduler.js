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

/* Cross-cutting #4 Fix: Rate limit flag for bulk operations */
var _bulkCreateLastRun = 0;

async function executeBulkCreate() {
    /* Cross-cutting #4 Fix: Debounce — prevent double-fire from impatient double-clicks
       or rapid re-submissions. 10s cooldown between bulk create attempts. */
    var now = Date.now();
    if (now - _bulkCreateLastRun < 10000) {
      showToast('⏳ Please wait before creating another bulk set', true); return;
    }
    _bulkCreateLastRun = now;

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
    /* Improvement 2: Warn if start date is in the past — block if ALL dates are past */
    if (startDate) {
      var _todayMidnight = new Date(); _todayMidnight.setHours(0,0,0,0);
      var _startParts = startDate.split('-').map(Number);
      var _startMs = Date.UTC(_startParts[0], _startParts[1]-1, _startParts[2]);
      if (_startMs < _todayMidnight.getTime()) {
        if (!confirm('⚠️ Start date is in the past! Kya aap phir bhi create karna chahte ho?\nPast matches immediately "completed" dikhenge.')) {
          return;
        }
      }
    }
    
    var btn = document.querySelector('#bulkSchedulerModal .btn-primary');
    if (btn) setLoading(btn, true);
    
    try {
        var [hours, minutes] = time.split(':').map(Number);
        /* ✅ Bug 11 Fix: Parse startDate as UTC to avoid DST/timezone shifts
           Input format: YYYY-MM-DD — parse parts manually to avoid local timezone interpretation */
        var _baseDateUTC;
        if (startDate) {
          var _dp = startDate.split('-').map(Number); /* [yyyy, mm, dd] */
          _baseDateUTC = new Date(Date.UTC(_dp[0], _dp[1]-1, _dp[2], hours, minutes, 0, 0));
        } else {
          _baseDateUTC = new Date();
          _baseDateUTC.setHours(hours, minutes, 0, 0);
        }
        var baseDate = _baseDateUTC;
        var created = 0;
        
        for (var i = 0; i < days; i++) {
            /* Clone base date and advance by i days using UTC methods */
            var matchDate = new Date(baseDate.getTime());
            matchDate = new Date(Date.UTC(
              matchDate.getUTCFullYear(),
              matchDate.getUTCMonth(),
              matchDate.getUTCDate() + i,
              hours, minutes, 0, 0
            ));
            
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
            
            /* ✅ Bug 9 Fix: Write to Supabase FIRST (source of truth), then Firebase */
            var _supaMatchId = null;
            if (window._supa) {
              try {
                var _supaRes = await window._supa.from('matches').insert({
                  title: matchData.name || matchData.matchName || matchData.title || 'Match',
                  status: matchData.status || 'upcoming',
                  scheduled_at: new Date(matchData.matchTime).toISOString(),
                  entry_fee: matchData.entryFee || 0,
                  entry_type: matchData.entryType || 'coin',
                  max_slots: matchData.maxSlots || matchData.totalSlots || 12,
                  mode: matchData.mode || matchData.type || 'solo',
                  map: matchData.map || '',
                  data: matchData
                }).select('id').single();
                if (_supaRes.data) {
                  _supaMatchId = _supaRes.data.id;
                } else if (_supaRes.error) {
                  /* Previously this branch was unreachable from here — a
                     failed insert with no thrown exception (e.g. an RLS
                     denial) left _supaRes.data null but never hit the
                     catch block below, so it fell through completely
                     silently. Most likely cause: the admin account's
                     users.is_admin isn't set to true in Postgres, so
                     matches_admin_write RLS denies the insert — see the
                     note at the end of MIGRATION-permission-denied-full-fix.sql. */
                  console.error('[Scheduler] Supabase insert REJECTED (match will only exist in Firebase, not Supabase):', _supaRes.error.message);
                  if (typeof toast === 'function') toast('⚠️ Match saved to Firebase only — Supabase sync failed: ' + _supaRes.error.message, true);
                }
              } catch(supaErr) {
                console.warn('[Scheduler] Supabase insert failed, continuing with Firebase:', supaErr.message);
                if (typeof toast === 'function') toast('⚠️ Match saved to Firebase only — Supabase sync failed: ' + supaErr.message, true);
              }
            }
            /* Also write to Firebase RTDB for real-time sync */
            var _fbRef = await rtdb.ref(DB_MATCHES).push(Object.assign({}, matchData, {
              supabaseId: _supaMatchId || null
            }));
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
    /* ✅ Bug 11 Fix: UTC-safe date parsing */
    var _bdp = startDate ? startDate.split('-').map(Number) : null;
    var baseDate = _bdp
      ? new Date(Date.UTC(_bdp[0], _bdp[1]-1, _bdp[2], hours, minutes, 0, 0))
      : new Date();
    
    var preview = '📅 Schedule Preview:\n\n';
    
    for (var i = 0; i < Math.min(days, 10); i++) {
        var matchDate = new Date(Date.UTC(
          baseDate.getUTCFullYear(), baseDate.getUTCMonth(),
          baseDate.getUTCDate() + i, hours, minutes, 0, 0
        ));
        
        var conflicts = checkTimeConflicts(matchDate.getTime());
        var conflictWarning = conflicts.length > 0 ? ' ⚠️ Conflict!' : '';
        
        preview += (i + 1) + '. ' + name + ' #' + (i + 1) + '\n';
        preview += '   ' + matchDate.toLocaleString() + conflictWarning + '\n\n';
    }
    
    if (days > 10) preview += '... and ' + (days - 10) + ' more\n';
    
    alert(preview);
}

console.log('✅ admin-scheduler.js loaded');
