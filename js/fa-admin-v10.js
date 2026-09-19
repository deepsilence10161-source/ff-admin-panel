/* ================================================================
   MINI eSPORTS ADMIN — fa-admin-v10.js
   ================================================================
   1. SMART MATCH TEMPLATES  — 6 templates, sirf Time+Room+Pass
   2. LIVE ATTENDANCE DASHBOARD — Present/Absent/Pending real-time
   3. ADMIN MATCH-START ALERTS  — 15min + 5min pehle
   4. OCR RESULT SYSTEM         — Tesseract + Fuzzy match (Levenshtein)
   5. BEAUTIFUL RESULT UI       — Screenshot → auto-fill → verify → publish
   ================================================================ */
(function () {
  'use strict';


  /* ✅ REMOVED (2026-08): dead 'Smart Match Templates / Quick Create' block
     (was Section 1, ~290 lines) — fully shadowed by fa-admin-v10-final.js's
     own Quick Create implementation (which loads after this file and
     redefines window.showQuickCreate anyway), and was the cause of two
     identical 'Quick Create' buttons appearing in the Matches section.
     fa-admin-v10-final.js's version is kept since it also drives the
     template-bar UI on the manual creation form. */

  /* ✅ REMOVED (2026-08-22): entire duplicate 'Admin Match-Start Alerts'
     engine (_scheduleMatchAlert, _showAdminAlert, _goToAttendance,
     _playAlertSound, _initAlerts + its own setTimeout(_initAlerts,3000)
     polling loop). This ran a COMPLETELY SEPARATE alert scheduler in
     parallel with fa-admin-v10-final.js's _showAlert() system — same
     matches, same 15min/5min windows, both watching independently — so
     every "match starting soon" event fired TWO overlapping banners
     (fixed top-center from this file, stacked top-right from
     fa-admin-v10-final.js), confirmed live as the visually garbled
     "URGENT! Testing2 5 minutes mein shuru hoga!" duplicate banners.
     fa-admin-v10-final.js's _showAlert is strictly more capable (proper
     multi-alert stacking with a 3-alert cap, per-match dismissal,
     browser Notification API support) so it's the one kept — this file
     already had the exact same duplicate-feature problem documented and
     fixed twice above (Quick Create, Live Attendance); this was the one
     remaining instance of the pattern. */


  /* ─────────────────────────────────────────────────────────────
     SECTION 4 — OCR RESULT SYSTEM
     Tesseract.js + Levenshtein fuzzy match
     BR mode: rank + kills per player
     CS mode: kills per player (no overall rank, team rank)
  ───────────────────────────────────────────────────────────── */

  /* Levenshtein Distance — pure JS, no deps */
  function levenshtein(a, b) {
    a = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    b = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var m = a.length, n = b.length;
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [i];
      for (var j = 1; j <= n; j++) {
        if (!dp[i]) dp[i] = [];
        dp[i][j] = i === 0 ? j :
          a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] :
          1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }

  /* Find best match from player list */
  function fuzzyMatch(ocrName, playerList) {
    if (!ocrName || !playerList || !playerList.length) return null;
    var best = null, bestDist = Infinity;
    var cleanOcr = ocrName.toLowerCase().replace(/[^a-z0-9]/g, '');
    playerList.forEach(function (p) {
      var cleanP = (p.name || p.ign || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      var dist = levenshtein(cleanOcr, cleanP);
      /* Similarity ratio */
      var maxLen = Math.max(cleanOcr.length, cleanP.length);
      var ratio = maxLen > 0 ? 1 - (dist / maxLen) : 0;
      if (dist < bestDist && ratio > 0.5) {
        bestDist = dist;
        best = { player: p, distance: dist, ratio: ratio };
      }
    });
    return best;
  }

  /* Parse OCR text for BR mode: extract name, rank, kills */
  function parseOcrTextBR(rawText) {
    var lines = rawText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var results = [];

    lines.forEach(function (line) {
      /* Pattern: name + K/D/A pattern e.g. "PlayerName 14/2/2 5035" */
      /* Also handle rank numbers at start */

      /* Try to find kills from K/D/A: e.g. 14/2/2 */
      var kdaMatch = line.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
      var kills = kdaMatch ? parseInt(kdaMatch[1]) : null;

      /* Try rank from beginning: "1 PlayerName ..." or "#1 PlayerName" */
      var rankMatch = line.match(/^#?(\d+)\s+(.+)/);
      var rank = null, namePart = line;
      if (rankMatch && parseInt(rankMatch[1]) <= 20) {
        rank = parseInt(rankMatch[1]);
        namePart = rankMatch[2];
      }

      /* Extract name: everything before the K/D/A pattern */
      if (kdaMatch) {
        var idx = line.indexOf(kdaMatch[0]);
        namePart = line.substring(0, idx).trim();
        /* Clean up rank from name */
        namePart = namePart.replace(/^#?\d+\s+/, '').trim();
      }

      /* Damage number (large number at end) — ignore for our purposes */

      if (namePart && namePart.length >= 2) {
        results.push({
          rawName: namePart,
          rank: rank,
          kills: kills,
        });
      }
    });

    return results;
  }

  /* Parse OCR text for Clash Squad mode */
  function parseOcrTextCS(rawText) {
    var lines = rawText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var results = [];

    lines.forEach(function (line) {
      var kdaMatch = line.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
      if (!kdaMatch) return;
      var kills = parseInt(kdaMatch[1]);
      var idx = line.indexOf(kdaMatch[0]);
      var namePart = line.substring(0, idx).trim().replace(/^#?\d+\s+/, '').trim();
      if (namePart && namePart.length >= 2) {
        results.push({ rawName: namePart, kills: kills, rank: null });
      }
    });

    return results;
  }

  /* Main OCR function — called when screenshot is uploaded in result section */
  window.runOCROnScreenshot = function (imageData, matchType, playerList, onComplete) {
    var isCS = (matchType || '').toUpperCase() === 'CS';

    /* Show progress */
    var progressEl = document.getElementById('_ocrProgress');
    if (progressEl) {
      progressEl.style.display = 'block';
      progressEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> OCR running... (Tesseract)';
    }

    /* Check if Tesseract is loaded */
    if (typeof Tesseract === 'undefined') {
      /* Load Tesseract dynamically */
      var script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js';
      script.onload = function () { _runTesseract(imageData, isCS, playerList, onComplete, progressEl); };
      script.onerror = function () {
        if (progressEl) progressEl.innerHTML = '❌ Tesseract load failed. Manual fill karo.';
        if (onComplete) onComplete(null, 'Tesseract load failed');
      };
      document.head.appendChild(script);
      return;
    }

    _runTesseract(imageData, isCS, playerList, onComplete, progressEl);
  };

  function _runTesseract(imageData, isCS, playerList, onComplete, progressEl) {
    Tesseract.recognize(imageData, 'eng', {
      logger: function (m) {
        if (progressEl && m.progress) {
          var pct = Math.round(m.progress * 100);
          progressEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> OCR ' + pct + '%...';
        }
      }
    }).then(function (result) {
      var rawText = result.data.text;

      /* Parse based on match type */
      var parsed = isCS ? parseOcrTextCS(rawText) : parseOcrTextBR(rawText);

      /* Fuzzy match each OCR result against player list */
      var matched = [];
      var unmatchedOCR = [];

      parsed.forEach(function (ocrEntry) {
        var match = fuzzyMatch(ocrEntry.rawName, playerList);
        if (match && match.ratio >= 0.5) {
          matched.push({
            playerUid: match.player.uid,
            playerName: match.player.name || match.player.ign,
            ocrName: ocrEntry.rawName,
            rank: ocrEntry.rank,
            kills: ocrEntry.kills,
            confidence: Math.round(match.ratio * 100),
          });
        } else {
          unmatchedOCR.push(ocrEntry.rawName);
        }
      });

      if (progressEl) {
        progressEl.innerHTML = '✅ OCR complete — ' + matched.length + ' players matched, ' +
          unmatchedOCR.length + ' unmatched';
        progressEl.style.color = '#00ff9c';
      }

      if (onComplete) onComplete(matched, null, unmatchedOCR);
    }).catch(function (err) {
      if (progressEl) progressEl.innerHTML = '❌ OCR error: ' + err.message;
      if (onComplete) onComplete(null, err.message);
    });
  }

  /* Apply OCR results to the result table */
  window.applyOCRToTable = function (matched) {
    if (!matched || !matched.length) return;
    var applied = 0;
    var rows = document.querySelectorAll('#mrPlayerTable tr[data-uid]');

    matched.forEach(function (m) {
      rows.forEach(function (row) {
        if (row.dataset.uid !== m.playerUid) return;
        /* Fill rank */
        if (m.rank !== null && m.rank !== undefined) {
          var rankInp = row.querySelector('.mr-rank-input');
          if (rankInp) {
            rankInp.value = m.rank;
            rankInp.style.background = 'rgba(0,255,156,.15)'; /* green flash */
            rankInp.style.borderColor = '#00ff9c';
            setTimeout(function () {
              rankInp.style.background = 'rgba(255,215,0,.08)';
              rankInp.style.borderColor = 'rgba(255,215,0,.3)';
            }, 2000);
          }
        }
        /* Fill kills */
        if (m.kills !== null && m.kills !== undefined) {
          var killsInp = row.querySelector('.mr-kills-input');
          if (killsInp) {
            killsInp.value = m.kills;
            killsInp.style.background = 'rgba(0,255,156,.15)';
            killsInp.style.borderColor = '#00ff9c';
            setTimeout(function () {
              killsInp.style.background = 'rgba(255,107,107,.08)';
              killsInp.style.borderColor = 'rgba(255,107,107,.3)';
            }, 2000);
          }
        }
        /* Recalculate prize */
        if (window.mrCalcPrize) {
          var anyInp = row.querySelector('.mr-rank-input');
          if (anyInp) mrCalcPrize(anyInp);
        }
        applied++;
      });
    });

    if (window.showToast) showToast('✅ OCR: ' + applied + ' players auto-filled!', false);
    if (window.mrCheckDuplicateRanks) mrCheckDuplicateRanks();
  };

  /* ─────────────────────────────────────────────────────────────
     SECTION 5 — ENHANCED RESULT UI
     Screenshot upload triggers OCR automatically
  ───────────────────────────────────────────────────────────── */

  /* Wrap mrAddScreenshots to trigger OCR automatically */
  var _origMrAdd = null;
  function _wrapMrAddScreenshots() {
    if (!window.mrAddScreenshots || window._mrOCRWrapped) return;
    window._mrOCRWrapped = true;
    _origMrAdd = window.mrAddScreenshots;
    window.mrAddScreenshots = function (input) {
      _origMrAdd.call(this, input);
      /* After file is read, trigger OCR */
      setTimeout(function () {
        _triggerAutoOCR();
      }, 500);
    };
  }

  function _triggerAutoOCR() {
    var screenshots = window._mrScreenshots || [];
    if (!screenshots.length) return;
    var matchData = window._mrMatchData;
    var matchType = matchData ? (matchData.matchType || 'BR') : 'BR';

    /* Get player list from table */
    var rows = document.querySelectorAll('#mrPlayerTable tr[data-uid]');
    if (!rows.length) return;
    var playerList = [];
    rows.forEach(function (row) {
      var uid = row.dataset.uid;
      var nameEl = row.querySelector('td:nth-child(2) div');
      var name = nameEl ? nameEl.textContent.trim() : '';
      if (uid && name) playerList.push({ uid: uid, name: name });
    });

    if (!playerList.length) return;

    /* Use first screenshot */
    window.runOCROnScreenshot(screenshots[0], matchType, playerList, function (matched, err, unmatched) {
      if (err) {
        if (window.showToast) showToast('OCR error — manual fill karo: ' + err, true);
        return;
      }
      if (!matched || !matched.length) {
        if (window.showToast) showToast('OCR: Koi player nahi mila — manual fill karo', true);
        return;
      }

      /* Show confirmation before applying */
      _showOCRConfirmation(matched, unmatched || []);
    });
  }

  function _showOCRConfirmation(matched, unmatched) {
    var h = '';
    h += '<div style="font-size:13px;font-weight:900;color:#00ff9c;margin-bottom:12px">' +
      '✅ OCR Complete — ' + matched.length + ' players found</div>';

    /* Matched players table */
    h += '<div style="max-height:300px;overflow-y:auto;margin-bottom:12px">';
    h += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    h += '<thead><tr style="background:rgba(255,255,255,.05)">' +
      '<th style="padding:6px;text-align:left">Player</th>' +
      '<th style="padding:6px;text-align:center;color:#ffd700">Rank</th>' +
      '<th style="padding:6px;text-align:center;color:#ff6b6b">Kills</th>' +
      '<th style="padding:6px;text-align:center;color:#00d4ff">Confidence</th>' +
      '</tr></thead><tbody>';

    matched.forEach(function (m) {
      var confColor = m.confidence >= 80 ? '#00ff9c' : m.confidence >= 60 ? '#ffd700' : '#ff6b6b';
      h += '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">';
      h += '<td style="padding:6px">';
      h += '<div style="font-weight:700;color:#fff">' + m.playerName + '</div>';
      if (m.ocrName !== m.playerName) {
        h += '<div style="font-size:10px;color:#555">OCR: ' + m.ocrName + '</div>';
      }
      h += '</td>';
      h += '<td style="padding:6px;text-align:center;color:#ffd700;font-weight:800">' +
        (m.rank !== null ? m.rank : '—') + '</td>';
      h += '<td style="padding:6px;text-align:center;color:#ff6b6b;font-weight:800">' +
        (m.kills !== null ? m.kills : '—') + '</td>';
      h += '<td style="padding:6px;text-align:center;color:' + confColor + ';font-weight:700">' +
        m.confidence + '%</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';

    /* Unmatched */
    if (unmatched.length) {
      h += '<div style="padding:8px 12px;background:rgba(255,170,0,.06);border:1px solid rgba(255,170,0,.2);' +
        'border-radius:10px;margin-bottom:12px;font-size:11px;color:#ffaa00">';
      h += '⚠️ ' + unmatched.length + ' OCR names unmatched: ' + unmatched.join(', ');
      h += '</div>';
    }

    h += '<div style="display:flex;gap:8px">';
    h += '<button onclick="window.applyOCRToTable(window._pendingOCRResults);window.closeModal&&closeModal()" ' +
      'style="flex:1;padding:12px;border-radius:11px;border:none;background:linear-gradient(135deg,#00ff9c,#00d4ff);' +
      'color:#000;font-size:13px;font-weight:900;cursor:pointer">✅ Apply to Table</button>';
    h += '<button onclick="window.closeModal&&closeModal()" ' +
      'style="flex:1;padding:12px;border-radius:11px;border:1px solid rgba(255,255,255,.1);' +
      'background:rgba(255,255,255,.04);color:#aaa;font-size:13px;cursor:pointer">Cancel</button>';
    h += '</div>';

    window._pendingOCRResults = matched;
    if (window.openModal) openModal('🤖 OCR Results — Verify karo', h);
  }

  /* Add OCR progress bar to result section */
  function _injectOCRUI() {
    var ssArea = document.querySelector('#section-matchResult .card-body');
    if (!ssArea || document.getElementById('_ocrProgress')) return;

    var bar = document.createElement('div');
    bar.id = '_ocrProgress';
    bar.style.cssText = 'display:none;padding:10px 14px;background:rgba(0,212,255,.07);' +
      'border:1px solid rgba(0,212,255,.2);border-radius:10px;font-size:12px;' +
      'color:#00d4ff;margin-bottom:10px;font-weight:600';
    bar.innerHTML = '<i class="fas fa-robot"></i> OCR ready — screenshot upload karo';

    /* Insert after screenshot area */
    var ssDiv = ssArea.querySelector('div[style*="rgba(0,255,156"]');
    if (ssDiv && ssDiv.nextSibling) {
      ssArea.insertBefore(bar, ssDiv.nextSibling);
    } else if (ssArea.firstChild) {
      ssArea.insertBefore(bar, ssArea.firstChild.nextSibling);
    }
  }

  /* CSS animations */
  var style = document.createElement('style');
  style.textContent =
    '@keyframes alertSlideIn{from{transform:translateX(-50%) translateY(-20px);opacity:0}' +
    'to{transform:translateX(-50%) translateY(0);opacity:1}}';
  document.head.appendChild(style);

  /* Init */
  var _initTimer = setInterval(function () {
    if (window.mrAddScreenshots && !window._mrOCRWrapped) {
      _wrapMrAddScreenshots();
    }
    if (document.getElementById('section-matchResult')) {
      _injectOCRUI();
    }
  }, 1000);

  /* ✅ REMOVED (2026-08): duplicate Quick Create button injection —
     fa-admin-v10-final.js already injects this button (id='_v10QcBtn'),
     this file's version (id='_qcBtn') used a different id so neither's
     dedup-guard caught the other, causing two identical buttons. */

  console.log('[Admin v10] fa-admin-v10.js loaded ✅');
})();
