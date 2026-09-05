/* =============================================
   FEATURE A03: Quick Match Creator with Templates
   - Admin ke liye pre-set match templates
   - "Solo ₹20 Entry", "Squad ₹50 Entry" etc. 1 click se
   - Fields auto-fill ho jaati hain
   - Time bhara hai already (next hour)
   ============================================= */
(function() {
  'use strict';

  var TEMPLATES = [
    {
      name: '⚡ Solo Quick ₹10',
      data: { name: 'Quick Solo Match', mode: 'solo', type: 'solo', entryFee: 10, entryType: 'paid', maxSlots: 20, prizePool: 150, firstPrize: 100, secondPrize: 50, perKillPrize: 0, matchType: 'Battle Royale', difficulty: 'beginner' }
    },
    {
      name: '🎯 Solo Pro ₹50',
      data: { name: 'Pro Solo Battle', mode: 'solo', type: 'solo', entryFee: 50, entryType: 'paid', maxSlots: 20, prizePool: 700, firstPrize: 500, secondPrize: 200, perKillPrize: 5, matchType: 'Battle Royale', difficulty: 'pro' }
    },
    {
      name: '👥 Duo ₹30',
      data: { name: 'Duo Challenge', mode: 'duo', type: 'duo', entryFee: 30, entryType: 'paid', maxSlots: 10, prizePool: 200, firstPrize: 150, secondPrize: 50, perKillPrize: 3, matchType: 'Battle Royale', difficulty: 'intermediate' }
    },
    {
      name: '💪 Squad ₹50',
      data: { name: 'Squad Showdown', mode: 'squad', type: 'squad', entryFee: 50, entryType: 'paid', maxSlots: 12, prizePool: 400, firstPrize: 280, secondPrize: 120, perKillPrize: 5, matchType: 'Battle Royale', difficulty: 'intermediate' }
    },
    {
      name: '🪙 Free Coin Match',
      data: { name: 'Daily Free Match', mode: 'solo', type: 'solo', entryFee: 0, entryType: 'coin', maxSlots: 30, prizePool: 0, firstPrize: 0, secondPrize: 0, perKillPrize: 0, matchType: 'Battle Royale', difficulty: 'beginner' }
    },
    {
      name: '🏆 Mega Tournament ₹100',
      data: { name: 'Mega Tournament', mode: 'squad', type: 'squad', entryFee: 100, entryType: 'paid', maxSlots: 16, prizePool: 1200, firstPrize: 800, secondPrize: 300, thirdPrize: 100, perKillPrize: 10, matchType: 'Battle Royale', difficulty: 'expert' }
    },
    {
      name: '📺 Ad Match (Free)',
      data: { name: 'Ad Free Match', mode: 'solo', type: 'solo', entryFee: 0, entryType: 'ad', matchCategory: 'ad', adsRequired: 2, maxSlots: 30, prizes: { perKill: { coins: 5 }, first: { coins: 50 }, second: { coins: 25 }, third: { coins: 10 } }, matchType: 'Battle Royale', difficulty: 'beginner' }
    },
    {
      name: '🪙 Coin Match',
      data: { name: 'Coin Battle', mode: 'solo', type: 'solo', entryFee: 20, entryType: 'coin', matchCategory: 'coin', maxSlots: 20, prizes: { perKill: { skyDiamonds: 2 }, first: { skyDiamonds: 100 }, second: { skyDiamonds: 50 }, third: { skyDiamonds: 25 } }, matchType: 'Battle Royale', difficulty: 'intermediate' }
    },
    {
      name: '💠 Sky Diamond Match',
      data: { name: 'Diamond Battle', mode: 'solo', type: 'solo', entryFee: 50, entryType: 'skyDiamond', matchCategory: 'paid', maxSlots: 20, prizes: { perKill: { greenDiamonds: 2 }, first: { greenDiamonds: 200 }, second: { greenDiamonds: 100 }, third: { greenDiamonds: 50 } }, matchType: 'Battle Royale', difficulty: 'pro' }
    }
  ];

  function showTemplatePicker() {
    var h = '<div>';
    h += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Ek template choose karo — sab fields auto-fill ho jayengi</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';

    TEMPLATES.forEach(function(t, i) {
      h += '<div onclick="window.fA03QuickCreate.applyTemplate(' + i + ')" style="padding:12px;border:1px solid var(--border);border-radius:12px;cursor:pointer;background:var(--bg-dark);transition:.15s" onmouseover="this.style.borderColor=\'var(--primary)\'" onmouseout="this.style.borderColor=\'var(--border)\'">';
      h += '<div style="font-size:13px;font-weight:700;margin-bottom:4px">' + t.name + '</div>';
      h += '<div style="font-size:10px;color:var(--text-muted)">₹' + t.data.prizePool + ' pool · ' + t.data.maxSlots + ' slots · ' + (t.data.difficulty || 'mid') + '</div>';
      h += '</div>';
    });
    h += '</div></div>';

    showAdminModal('⚡ Quick Match Templates', h);
  }

  function applyTemplate(idx) {
    var tpl = TEMPLATES[idx];
    if (!tpl) return;
    var d = tpl.data;

    // Set next hour as match time
    var nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

    // Fill create form fields
    var fieldMap = {
      'createMatchName': d.name,
      'createMode': d.mode || d.type,
      'createEntryType': d.entryType,
      'createEntryFee': d.entryFee,
      'createMaxSlots': d.maxSlots,
      'createPrizePool': d.prizePool,
      'createFirstPrize': d.firstPrize || 0,
      'createSecondPrize': d.secondPrize || 0,
      'createThirdPrize': d.thirdPrize || 0,
      'createPerKill': d.perKillPrize || 0,
      'createMatchType': d.matchType || 'Battle Royale',
      'createDifficulty': d.difficulty || 'intermediate'
    };

    Object.keys(fieldMap).forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.value = fieldMap[id];
        el.dispatchEvent(new Event('change'));
      }
    });

    // Set datetime-local
    var dtEl = document.getElementById('createMatchTime');
    if (dtEl) {
      var iso = new Date(nextHour.getTime() - nextHour.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      dtEl.value = iso;
    }

    // Close template modal and open create form
    var modal = document.getElementById('adminModal');
    if (modal) modal.style.display = 'none';

    // Navigate to create match section
    var createNav = document.querySelector('[onclick*="createMatch"], [data-section="createMatch"], [onclick*="navAdmin(\'create\')"]');
    if (createNav) createNav.click();

    showAdminToast('✅ Template applied: ' + tpl.name);
  }

  function addTemplateButton() {
    // Add near create match button
    var createBtn = document.querySelector('[onclick*="createMatch"]') || document.querySelector('.create-match-btn');
    if (!createBtn || document.getElementById('fa03TemplateBtn')) return;

    var btn = document.createElement('button');
    btn.id = 'fa03TemplateBtn';
    btn.className = 'btn btn-ghost btn-sm';
    btn.innerHTML = '<i class="fas fa-layer-group"></i> Templates';
    btn.onclick = showTemplatePicker;
    btn.style.marginLeft = '8px';
    createBtn.parentNode.insertBefore(btn, createBtn.nextSibling);
  }

  function showAdminToast(msg, isErr) {
    if (window.showToast) window.showToast(msg, isErr);
  }

  function showAdminModal(title, body) {
    var m = document.getElementById('adminModal');
    var mt = document.getElementById('adminModalTitle');
    var mb = document.getElementById('adminModalBody');
    if (m && mt && mb) { mt.textContent = title; mb.innerHTML = body; m.style.display = 'flex'; }
  }

  window.fA03QuickCreate = { show: showTemplatePicker, applyTemplate: applyTemplate };
  window.showMatchTemplates = showTemplatePicker;

  // Init
  var _try = 0;
  var _check = setInterval(function() {
    _try++;
    if (document.querySelector('[onclick*="createMatch"]')) {
      clearInterval(_check);
      addTemplateButton();
    }
    if (_try > 30) clearInterval(_check);
  }, 500);
})();
