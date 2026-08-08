/* =============================================
   ADMIN NOTIFICATION TEMPLATES
   js/admin-notif-templates.js
   ============================================= */

var notificationTemplates = [
    {
        id: 'match_starting',
        icon: '🎮',
        title: 'Match Starting Soon!',
        message: 'Room ID: {roomId} | Password: {roomPass}\nJoin before the match starts!'
    },
    {
        id: 'deposit_approved',
        icon: '💰',
        title: 'Deposit Approved!',
        message: '₹{amount} has been added to your wallet. Happy gaming!'
    },
    {
        id: 'withdrawal_done',
        icon: '💸',
        title: 'Withdrawal Processed!',
        message: '₹{amount} has been sent to your UPI. Please check and confirm.'
    },
    {
        id: 'results_out',
        icon: '🏆',
        title: 'Results Published!',
        message: '{matchName} results are out! Check your earnings and stats now.'
    },
    {
        id: 'maintenance',
        icon: '⚙️',
        title: 'Maintenance Notice',
        message: 'App will be under maintenance for {duration} minutes. We apologize for the inconvenience.'
    },
    {
        id: 'bonus_added',
        icon: '🎁',
        title: 'Bonus Added!',
        message: '₹{amount} bonus has been credited to your wallet. Enjoy!'
    },
    {
        id: 'warning',
        icon: '⚠️',
        title: 'Important Notice',
        message: '{message}'
    },
    {
        id: 'new_match',
        icon: '🔥',
        title: 'New Match Available!',
        message: '{matchName} is now open for registration! Entry: ₹{entryFee}. Join now!'
    },
    {
        id: 'profile_approved',
        icon: '✅',
        title: 'Profile Verified!',
        message: 'Your profile has been verified. You now have full access to all features!'
    },
    {
        id: 'profile_rejected',
        icon: '❌',
        title: 'Profile Verification Failed',
        message: 'Your profile verification was rejected. Reason: {reason}. Please try again.'
    },
    {
        id: 'referral_reward',
        icon: '👥',
        title: 'Referral Reward!',
        message: '₹{amount} referral bonus added! Thanks for inviting your friends.'
    },
    {
        id: 'custom',
        icon: '📢',
        title: 'Announcement',
        message: '{message}'
    }
];

function renderNotifTemplates() {
    var container = document.getElementById('notifTemplatesGrid');
    if (!container) return;
    
    var html = '';
    notificationTemplates.forEach(function(t) {
        html += '<div class="template-card" onclick="useNotifTemplate(\'' + t.id + '\')">' +
            '<div class="template-icon">' + t.icon + '</div>' +
            '<div class="template-info">' +
                '<div class="template-title">' + t.title + '</div>' +
                '<div class="template-preview">' + t.message.substring(0, 40) + '...</div>' +
            '</div>' +
        '</div>';
    });
    
    container.innerHTML = html;
}

function useNotifTemplate(templateId) {
    var template = notificationTemplates.find(function(t) { return t.id === templateId; });
    if (!template) return;
    
    document.getElementById('globalNotifTitle').value = template.icon + ' ' + template.title;
    document.getElementById('globalNotifMsg').value = template.message;
    
    // Highlight variables
    var msg = template.message;
    var variables = msg.match(/\{[^}]+\}/g);
    
    if (variables && variables.length > 0) {
        showToast('📝 Replace variables: ' + variables.join(', '));
    } else {
        showToast('✅ Template applied!');
    }
    
    // Focus on message field
    document.getElementById('globalNotifMsg').focus();
}

function clearNotifForm() {
    document.getElementById('globalNotifTitle').value = '';
    document.getElementById('globalNotifMsg').value = '';
}

// Add template with variable replacement
function sendTemplatedNotification(templateId, variables, targetUid) {
    var template = notificationTemplates.find(function(t) { return t.id === templateId; });
    if (!template) return Promise.reject('Template not found');
    
    var title = template.icon + ' ' + template.title;
    var message = template.message;
    
    // Replace variables
    Object.keys(variables).forEach(function(key) {
        var regex = new RegExp('\\{' + key + '\\}', 'g');
        title = title.replace(regex, variables[key]);
        message = message.replace(regex, variables[key]);
    });
    
    if (targetUid) {
        // Send to specific user
        return rtdb.ref(DB_USERS + '/' + targetUid + '/notifications').push({
            title: title,
            message: message,
            timestamp: Date.now(),
            createdAt: Date.now(),
            read: false,
            type: templateId
        });
    } else {
        // For global, use the existing function
        document.getElementById('globalNotifTitle').value = title;
        document.getElementById('globalNotifMsg').value = message;
        return sendGlobalNotification();
    }
}

console.log('✅ admin-notif-templates.js loaded');
