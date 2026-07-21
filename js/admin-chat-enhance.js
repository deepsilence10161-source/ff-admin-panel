/* =============================================
   ADMIN CHAT ENHANCEMENTS - Quick Replies & Typing
   js/admin-chat-enhance.js
   ============================================= */

var quickReplies = [
    { text: 'Please wait, we are checking your request... ⏳', icon: '⏳' },
    { text: 'Your request has been approved! ✅', icon: '✅' },
    { text: 'Please share your UTR/transaction number for verification.', icon: '🔢' },
    { text: 'Room ID and password will be shared 15 minutes before the match. 🎮', icon: '🎮' },
    { text: 'Your wallet has been updated. Please check your balance. 💰', icon: '💰' },
    { text: 'Please provide your UID for faster assistance.', icon: '🆔' },
    { text: 'We apologize for the inconvenience. Our team is looking into this. 🔧', icon: '🔧' },
    { text: 'Thank you for your patience! Your issue has been resolved. 🎉', icon: '🎉' },
    { text: 'Please upload a clear screenshot of your payment proof.', icon: '📸' },
    { text: 'Your profile verification is pending. Please wait for approval.', icon: '👤' }
];

var adminTypingTimeout = null;

function injectQuickReplies() {
    var chatInputBar = document.querySelector('.chat-input-bar');
    if (!chatInputBar) return;
    
    // Check if already injected
    if (document.getElementById('quickRepliesContainer')) return;
    
    var container = document.createElement('div');
    container.id = 'quickRepliesContainer';
    container.className = 'quick-replies-container';
    container.innerHTML = '<div class="quick-replies-label">Quick Replies:</div>' +
        '<div class="quick-replies-list">' +
        quickReplies.map(function(r, i) {
            return '<button class="quick-reply-btn" onclick="useQuickReply(' + i + ')" title="' + r.text + '">' +
                r.icon + '</button>';
        }).join('') +
        '</div>';
    
    chatInputBar.parentNode.insertBefore(container, chatInputBar);
}

function useQuickReply(index) {
    var reply = quickReplies[index];
    if (!reply) return;
    
    var input = document.getElementById('chatInput');
    if (input) {
        input.value = reply.text;
        input.focus();
    }
}

function setupChatEnhancements() {
    // Inject quick replies when chat is opened
    var chatObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList') {
                var chatMain = document.getElementById('chatMainArea');
                if (chatMain && chatMain.querySelector('.chat-input-bar')) {
                    injectQuickReplies();
                    setupTypingIndicator();
                }
            }
        });
    });
    
    var chatMain = document.getElementById('chatMainArea');
    if (chatMain) {
        chatObserver.observe(chatMain, { childList: true, subtree: true });
    }
}

function setupTypingIndicator() {
    var input = document.getElementById('chatInput');
    if (!input || input.dataset.typingSetup) return;
    
    input.dataset.typingSetup = 'true';
    
    input.addEventListener('keyup', function(e) {
        if (e.key === 'Enter') return;
        onAdminTyping();
    });
    
    input.addEventListener('focus', function() {
        onAdminTyping();
    });
}

function onAdminTyping() {
    if (!activeChatUid) return;
    
    // Set typing indicator
    rtdb.ref(CHAT_PATH_PRIMARY + '/' + activeChatUid + '/adminTyping').set(true);
    
    // Clear previous timeout
    if (adminTypingTimeout) {
        clearTimeout(adminTypingTimeout);
    }
    
    // Remove typing indicator after 3 seconds of no typing
    adminTypingTimeout = setTimeout(function() {
        if (activeChatUid) {
            rtdb.ref(CHAT_PATH_PRIMARY + '/' + activeChatUid + '/adminTyping').set(false);
        }
    }, 3000);
}

function clearAdminTyping() {
    if (activeChatUid) {
        rtdb.ref(CHAT_PATH_PRIMARY + '/' + activeChatUid + '/adminTyping').set(false);
    }
}

// Search within chat
function searchInChat(query) {
    if (!query || query.length < 2) return;
    
    var messages = document.querySelectorAll('.chat-bubble');
    var found = false;
    
    messages.forEach(function(msg) {
        var text = msg.textContent.toLowerCase();
        if (text.includes(query.toLowerCase())) {
            msg.style.backgroundColor = 'rgba(0, 255, 156, 0.2)';
            if (!found) {
                msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                found = true;
            }
        } else {
            msg.style.backgroundColor = '';
        }
    });
    
    if (!found) {
        showToast('No messages found with: ' + query, true);
    }
}

function clearChatSearch() {
    document.querySelectorAll('.chat-bubble').forEach(function(msg) {
        msg.style.backgroundColor = '';
    });
}

// Mark all chats as read
async function markAllChatsRead() {
    if (!confirm('Mark all support chats as read?')) return;
    
    try {
        var snap = await rtdb.ref(CHAT_PATH_PRIMARY).once('value');
        var updates = {};
        
        snap.forEach(function(userSnap) {
            var uid = userSnap.key;
            userSnap.forEach(function(msgSnap) {
                var msg = msgSnap.val();
                if (!isAdminMsg(msg) && !msg.read) {
                    updates[CHAT_PATH_PRIMARY + '/' + uid + '/' + msgSnap.key + '/read'] = true;
                }
            });
        });
        
        if (Object.keys(updates).length > 0) {
            await rtdb.ref().update(updates);
            showToast('✅ All chats marked as read!');
        } else {
            showToast('No unread messages');
        }
    } catch (e) {
        console.error('Mark all read error:', e);
        showToast('Error: ' + e.message, true);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(setupChatEnhancements, 1000);
});

console.log('✅ admin-chat-enhance.js loaded');
