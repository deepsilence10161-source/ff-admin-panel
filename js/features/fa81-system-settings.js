/* ================================================================
   SYSTEM SETTINGS — js/features/fa81-system-settings.js
   Device Cleanup (SAFE-CLEANER v5) — Server-Side Policy Control Panel
   ================================================================

   यह टैब admin को पूरा नियंत्रण देता है कि किन users/devices की
   फ़ाइलें कभी डिलीट न हों। SSOT = Supabase app_settings key='apk_cleanup'
   (वही row जो user-panel का features/device-cleanup.js और native
   SafeCleaner पढ़ते हैं — यहाँ बदलते ही पूरे सिस्टम पर लागू)।

   सुरक्षा नियम (यह कोड कभी नहीं तोड़ता):
     • mode हमेशा 'app_owned_only' — UI में बदला नहीं जा सकता।
     • कोई exemption हटाते समय appConfirm — अनजाने में कभी नहीं।
     • अगर exemption बिल्कुल खाली (0 uid + 0 device + cutoff खाली)
       हो जाए तो save रुकेगा + सख़्त confirm — यानी owner की सुरक्षा
       कभी चुपचाप बंद नहीं होगी।
     • हर save पर admin_activity_log में audit entry।
   ================================================================ */
(function () {
  'use strict';

  var POLICY_KEY = 'apk_cleanup';

  /* ── राज्य (state) — एक जगह, यही UI और save दोनों चलाते हैं ── */
  window._sysSet = {
    policy: null,
    users: [],
    filter: '',
    loaded: false
  };

  /* ── PURE: यूज़र/डिवाइस क्या exempt है? (fail-safe = हाँ/सुरक्षित) ── */
  window._sysSetIsUidExempt = function (policy, uid) {
    try {
      if (!policy || !uid) return false;
      var uids = policy.exemptUids || [];
      return uids.indexOf(uid) !== -1;
    } catch (e) { return false; }
  };
  window._sysSetIsDeviceExempt = function (policy, fp) {
    try {
      if (!policy || !fp) return false;
      var fps = policy.exemptDeviceFps || [];
      return fps.indexOf(fp) !== -1;
    } catch (e) { return false; }
  };

  /* ── PURE: save ke liye policy object — validation + locked fields ── */
  window._sysSetBuildPolicy = function (st) {
    var p = (st && st.policy) ? st.policy : {};
    var uids = [];
    (p.exemptUids || []).forEach(function (u) {
      u = String(u || '').trim();
      if (u && uids.indexOf(u) === -1) uids.push(u);
    });
    var fps = [];
    (p.exemptDeviceFps || []).forEach(function (f) {
      f = String(f || '').trim();
      if (f && fps.indexOf(f) === -1) fps.push(f);
    });
    return {
      enabled: p.enabled === true,
      onUpdateWipe: p.onUpdateWipe !== false,
      mode: 'app_owned_only',            /* LOCKED — कभी बदलेगा नहीं */
      exemptUids: uids,
      exemptDeviceFps: fps,
      exemptRegisteredBefore: String(p.exemptRegisteredBefore || '2026-10-10').substring(0, 10),
      updatedAt: new Date().toISOString(),
      updatedBy: (window.adminUser && window.adminUser.uid) || 'admin-panel'
    };
  };

  /* ── PURE: क्या यह save जोखिमपूर्ण है (सारी सुरक्षा खाली)? ── */
  window._sysSetIsRiskySave = function (built) {
    return (built.exemptUids.length === 0 &&
            built.exemptDeviceFps.length === 0 &&
            !built.exemptRegisteredBefore);
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _renderMaster() {
    var el = document.getElementById('sysSetMaster');
    if (!el) return;
    var p = window._sysSet.policy || {};
    var on = p.enabled === true;
    var wipe = p.onUpdateWipe !== false;
    el.innerHTML =
      '<div class="grid-2" style="gap:10px;margin-bottom:12px">' +
        '<div style="background:rgba(' + (on ? '0,255,156' : '255,80,80') + ',.07);border:1px solid rgba(' + (on ? '0,255,156' : '255,80,80') + ',.25);border-radius:10px;padding:12px">' +
          '<div style="font-size:11px;font-weight:700;color:' + (on ? '#00ff9c' : '#ff6b6b') + ';margin-bottom:6px">Cleanup System</div>' +
          '<button class="btn btn-sm" style="width:100%;background:' + (on ? 'rgba(0,255,156,.15);color:#00ff9c' : 'rgba(255,80,80,.15);color:#ff6b6b') + ';font-weight:800" onclick="sysSetToggleEnabled()">' +
            (on ? '✅ चालू (ENABLED)' : '⛔ बंद (DISABLED)') +
          '</button>' +
          '<div style="font-size:10px;color:#666;margin-top:6px">' + (on ? 'नए users पर अपडेट के बाद सफ़ाई होगी।' : 'कहीं भी कुछ भी डिलीट नहीं होगा (fail-safe)।') + '</div>' +
        '</div>' +
        '<div style="background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.2);border-radius:10px;padding:12px">' +
          '<div style="font-size:11px;font-weight:700;color:#ffd700;margin-bottom:6px">Update-पर पुरानी कोड-फ़ाइलें मिटाएँ</div>' +
          '<button class="btn btn-sm" style="width:100%;background:' + (wipe ? 'rgba(255,215,0,.15);color:#ffd700' : 'rgba(136,136,136,.15);color:#888') + ';font-weight:800" onclick="sysSetToggleWipe()">' +
            (wipe ? '✅ चालू (ON)' : '⏸️ बंद (OFF)') +
          '</button>' +
          '<div style="font-size:10px;color:#666;margin-top:6px">सिर्फ़ app-private पुरानी फ़ाइलें (APK/WebView-कैश)। व्यक्तिगत फ़ाइलें कभी नहीं।</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-group" style="max-width:280px">' +
        '<label style="font-size:11px;font-weight:700;color:#00d4ff">🛡️ छूट की तारीख़ — इससे पहले बने सभी खाते सुरक्षित</label>' +
        '<input type="date" class="form-input" id="sysSetCutoff" value="' + _esc(p.exemptRegisteredBefore || '2026-10-10') + '" onchange="sysSetDateChange(this.value)">' +
        '<div style="font-size:10px;color:#666;margin-top:4px">इस तारीख़ से पहले जो account बने हैं, उनके device पर कभी कुछ डिलीट नहीं होगा। खाली मत छोड़िए।</div>' +
      '</div>';
  }

  function _renderExemptUsers() {
    var el = document.getElementById('sysSetUsersWrap');
    if (!el) return;
    var p = window._sysSet.policy || {};
    var exempt = p.exemptUids || [];
    var f = (window._sysSet.filter || '').toLowerCase();

    var rows = '';
    window._sysSet.users.forEach(function (u) {
      var hay = ((u.ign || '') + ' ' + (u.email || '') + ' ' + (u.id || '') + ' ' + (u.device_fp || '')).toLowerCase();
      if (f && hay.indexOf(f) === -1) return;
      var isEx = window._sysSetIsUidExempt(p, u.id);
      rows +=
        '<tr style="border-top:1px solid rgba(255,255,255,.06)">' +
          '<td style="padding:8px 6px;font-size:12px;color:#eee">' + _esc(u.ign || '(नाम नहीं)') + '</td>' +
          '<td style="padding:8px 6px;font-size:11px;color:#aaa">' + _esc(u.email || '-') + '</td>' +
          '<td style="padding:8px 6px;font-size:10px;color:#888;font-family:monospace">' + _esc(String(u.id || '').substring(0, 12)) + '…</td>' +
          '<td style="padding:8px 6px;font-size:10px;color:#888;font-family:monospace">' + _esc(u.device_fp || '-') + '</td>' +
          '<td style="padding:8px 6px;font-size:10px;color:#666">' + _esc(String(u.created_at || '').substring(0, 10)) + '</td>' +
          '<td style="padding:8px 6px;text-align:center">' + (isEx
            ? '<span style="color:#00ff9c;font-weight:800;font-size:11px">🔒 सुरक्षित</span>'
            : '<span style="color:#ff9f43;font-weight:700;font-size:11px">सफ़ाई लागू</span>') + '</td>' +
          '<td style="padding:8px 6px;text-align:center">' +
            '<button class="btn btn-sm ' + (isEx ? 'btn-ghost' : '') + '" style="font-size:10px;' + (isEx
              ? 'background:rgba(255,80,80,.12);color:#ff6b6b'
              : 'background:rgba(0,255,156,.12);color:#00ff9c') + '" onclick="sysSetToggleUser(\'' + _esc(u.id) + '\')">' +
              (isEx ? 'छूट हटाएँ' : '🔒 छूट दें') +
            '</button>' +
          '</td>' +
        '</tr>';
    });

    var chips = '';
    exempt.forEach(function (uid) {
      chips += '<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.3);color:#00ff9c;border-radius:99px;padding:3px 9px;font-size:10px;margin:2px">' +
        _esc(uid) + ' <a href="javascript:void(0)" style="color:#ff6b6b;text-decoration:none;font-weight:900" onclick="sysSetToggleUser(\'' + _esc(uid) + '\')" title="छूट हटाएँ">✕</a></span>';
    });

    el.innerHTML =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        '<input class="form-input" id="sysSetSearch" style="flex:1;min-width:180px" placeholder="🔍 खोजें — नाम, email, UID, device..." value="' + _esc(window._sysSet.filter) + '" oninput="sysSetFilter(this.value)">' +
        '<button class="btn btn-sm" style="background:rgba(0,212,255,.15);color:#00d4ff;font-weight:700" onclick="sysSetExemptAllUsers()">🛡️ सभी वर्तमान यूज़र्स को छूट दें</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="loadSystemSettings()"><i class="fas fa-sync-alt"></i> Refresh</button>' +
      '</div>' +
      '<div class="table-wrapper" style="max-height:340px;overflow:auto"><table style="width:100%;min-width:680px;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="color:#888;font-size:10px;text-transform:uppercase">' +
          '<th style="padding:6px;text-align:left">IGN</th><th style="padding:6px;text-align:left">Email</th>' +
          '<th style="padding:6px;text-align:left">UID</th><th style="padding:6px;text-align:left">Device FP</th>' +
          '<th style="padding:6px;text-align:left">बना</th><th style="padding:6px;text-align:center">स्थिति</th><th style="padding:6px;text-align:center">क्रिया</th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="7" style="padding:16px;color:#666;text-align:center">कोई यूज़र नहीं मिला</td></tr>') + '</tbody>' +
      '</table></div>' +
      '<div style="margin-top:12px;padding:10px;background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.15);border-radius:10px">' +
        '<div style="font-size:11px;font-weight:700;color:#00d4ff;margin-bottom:6px">🔒 वर्तमान सुरक्षित यूज़र्स (' + exempt.length + ')</div>' +
        (chips || '<div style="font-size:11px;color:#666">कोई नहीं</div>') +
        '<div style="display:flex;gap:6px;margin-top:8px">' +
          '<input class="form-input" id="sysSetManualUid" style="flex:1" placeholder="UID चिपकाएँ / लिखें..." onkeydown="if(event.key===\'Enter\')sysSetAddUidManual()">' +
          '<button class="btn btn-sm" style="background:rgba(0,255,156,.15);color:#00ff9c;font-weight:700" onclick="sysSetAddUidManual()">+ जोड़ें</button>' +
        '</div>' +
      '</div>';
  }

  function _renderDevices() {
    var el = document.getElementById('sysSetDevicesWrap');
    if (!el) return;
    var p = window._sysSet.policy || {};
    var fps = p.exemptDeviceFps || [];
    var chips = '';
    fps.forEach(function (fp) {
      chips += '<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(185,100,255,.1);border:1px solid rgba(185,100,255,.35);color:#c9a0ff;border-radius:99px;padding:4px 10px;font-size:11px;margin:3px;font-family:monospace">' +
        _esc(fp) + ' <a href="javascript:void(0)" style="color:#ff6b6b;text-decoration:none;font-weight:900" onclick="sysSetToggleDevice(\'' + _esc(fp) + '\')" title="हटाएँ">✕</a></span>';
    });
    el.innerHTML =
      '<div style="font-size:11px;color:#888;margin-bottom:8px">जिन devices (fingerprint) की फ़ाइलें कभी नहीं मिटनी चाहिए — उन्हें यहाँ रखें। User-panel हर login पर इसी सूची से मिलान करता है।</div>' +
      (chips || '<div style="font-size:11px;color:#666;margin-bottom:8px">कोई device सुरक्षित नहीं</div>') +
      '<div style="display:flex;gap:6px;margin-top:8px">' +
        '<input class="form-input" id="sysSetManualFp" style="flex:1;font-family:monospace" placeholder="DFP_..." onkeydown="if(event.key===\'Enter\')sysSetAddDeviceManual()">' +
        '<button class="btn btn-sm" style="background:rgba(185,100,255,.15);color:#c9a0ff;font-weight:700" onclick="sysSetAddDeviceManual()">+ Device जोड़ें</button>' +
      '</div>';
  }

  function _renderStatus() {
    var el = document.getElementById('sysSetStatus');
    if (!el) return;
    var p = window._sysSet.policy || {};
    var built = window._sysSetBuildPolicy(window._sysSet);
    el.innerHTML =
      '<div style="font-size:11px;color:#888;line-height:2">' +
        '<div>• स्रोत (SSOT): <code style="color:#00d4ff">app_settings.key=\'apk_cleanup\'</code> — यहाँ Save करते ही user-panel + native SafeCleaner पर लागू।</div>' +
        '<div>• mode: <code style="color:#00ff9c">app_owned_only</code> (लॉक्ड — सिर्फ़ app-private फ़ाइलें ही कभी डिलीट हो सकती हैं)।</div>' +
        '<div>• सुरक्षित यूज़र्स: <strong style="color:#00ff9c">' + built.exemptUids.length + '</strong> • सुरक्षित devices: <strong style="color:#c9a0ff">' + built.exemptDeviceFps.length + '</strong> • छूट-तारीख़: <strong style="color:#00d4ff">' + _esc(built.exemptRegisteredBefore || '—') + '</strong></div>' +
        '<div>• अंतिम अपडेट: ' + _esc(p.updatedAt || '—') + '</div>' +
      '</div>';
  }

  function _renderAll() {
    _renderMaster();
    _renderExemptUsers();
    _renderDevices();
    _renderStatus();
    var saveBtn = document.getElementById('sysSetSaveBtn');
    if (saveBtn) saveBtn.disabled = false;
  }

  /* ═══════════════════════════════════════════════════════════
     LOAD
     ═══════════════════════════════════════════════════════════ */

  window.loadSystemSettings = function () {
    var wrap = document.getElementById('sysSetUsersWrap');
    if (wrap && !window._sysSet.loaded) {
      wrap.innerHTML = '<div style="text-align:center;padding:24px;color:#555"><i class="fas fa-spinner fa-spin"></i><br><br>लोड हो रहा है...</div>';
    }
    if (!window._supa) {
      if (window.showToast) showToast('Error: Supabase client तैयार नहीं — refresh करें', true);
      return;
    }
    /* पॉलिसी + users — साथ में */
    var pPol = window._supa.from('app_settings').select('value').eq('key', POLICY_KEY).limit(1);
    var pUsr = window._supa.from('users').select('id,ign,email,device_fp,created_at,is_admin').order('created_at', { ascending: false }).limit(500);
    Promise.all([Promise.resolve(pPol), Promise.resolve(pUsr)]).then(function (res) {
      /* पॉलिसी — न मिले तो fail-safe defaults (वही जो server पर हैं) */
      var polRes = res[0] || {};
      var row = (polRes.data && polRes.data.length) ? polRes.data[0] : (polRes.data && polRes.data.value ? polRes.data : null);
      var val = row && row.value ? row.value : null;
      window._sysSet.policy = val || {
        enabled: true, onUpdateWipe: true, mode: 'app_owned_only',
        exemptUids: [], exemptDeviceFps: [], exemptRegisteredBefore: '2026-10-10'
      };
      /* users */
      var usRes = res[1] || {};
      window._sysSet.users = usRes.data || [];
      window._sysSet.loaded = true;
      _renderAll();
    }).catch(function (e) {
      if (window.showToast) showToast('Load error: ' + ((e && e.message) || e), true);
    });
  };

  /* ═══════════════════════════════════════════════════════════
     ACTIONS — हर ख़तरनाक क्रिया पर confirm + audit log
     ═══════════════════════════════════════════════════════════ */

  window.sysSetToggleEnabled = function () {
    var p = window._sysSet.policy;
    p.enabled = !(p.enabled === true);
    if (!p.enabled) {
      var doIt = window.appConfirm
        ? window.appConfirm('⛔ Cleanup system बंद करें? किसी भी device पर कोई सफ़ाई नहीं होगी (fail-safe मोड)।')
        : Promise.resolve(confirm('Cleanup system बंद करें?'));
      doIt.then(function (yes) { if (!yes) { p.enabled = true; } _renderMaster(); });
      return;
    }
    _renderMaster();
  };

  window.sysSetToggleWipe = function () {
    var p = window._sysSet.policy;
    p.onUpdateWipe = !(p.onUpdateWipe !== false);
    _renderMaster();
  };

  window.sysSetDateChange = function (v) {
    var p = window._sysSet.policy;
    p.exemptRegisteredBefore = String(v || '').substring(0, 10);
    _renderStatus();
  };

  window.sysSetFilter = function (v) {
    window._sysSet.filter = v || '';
    _renderExemptUsers();
    var inp = document.getElementById('sysSetSearch');
    if (inp) { inp.focus(); }
  };

  window.sysSetToggleUser = function (uid) {
    var p = window._sysSet.policy;
    var list = p.exemptUids || (p.exemptUids = []);
    var idx = list.indexOf(uid);
    if (idx === -1) {
      list.push(uid);
      if (window.logAdminActivity) logAdminActivity('cleanup_exempt_add', { uid: uid });
      if (window.showToast) showToast('🔒 छूट जोड़ी — Save करना न भूलें', false);
      _renderAll();
    } else {
      /* ⚠️ खतरनाक क्रिया — confirm ज़रूरी */
      var ask = window.appConfirm
        ? window.appConfirm('⚠️ इस यूज़र की छूट हटाएँ?\n\n' + uid + '\n\nइसके बाद इसके device पर अपडेट के बाद सफ़ाई हो सकती है।')
        : Promise.resolve(confirm('छूट हटाएँ? ' + uid));
      ask.then(function (yes) {
        if (!yes) return;
        list.splice(idx, 1);
        if (window.logAdminActivity) logAdminActivity('cleanup_exempt_remove', { uid: uid });
        if (window.showToast) showToast('छूट हटाई — Save करना न भूलें', true);
        _renderAll();
      });
    }
  };

  window.sysSetToggleDevice = function (fp) {
    var p = window._sysSet.policy;
    var list = p.exemptDeviceFps || (p.exemptDeviceFps = []);
    var idx = list.indexOf(fp);
    if (idx === -1) {
      list.push(fp);
      if (window.logAdminActivity) logAdminActivity('cleanup_device_exempt_add', { device_fp: fp });
      if (window.showToast) showToast('🔒 Device सुरक्षित — Save करना न भूलें', false);
      _renderAll();
    } else {
      var ask = window.appConfirm
        ? window.appConfirm('⚠️ इस device की सुरक्षा हटाएँ?\n\n' + fp + '\n\nइस device पर सफ़ाई लागू हो सकती है।')
        : Promise.resolve(confirm('Device सुरक्षा हटाएँ? ' + fp));
      ask.then(function (yes) {
        if (!yes) return;
        list.splice(idx, 1);
        if (window.logAdminActivity) logAdminActivity('cleanup_device_exempt_remove', { device_fp: fp });
        if (window.showToast) showToast('Device सुरक्षा हटाई — Save करना न भूलें', true);
        _renderAll();
      });
    }
  };

  window.sysSetAddUidManual = function () {
    var inp = document.getElementById('sysSetManualUid');
    var uid = inp && inp.value ? inp.value.trim() : '';
    if (!uid) { if (window.showToast) showToast('UID खाली है', true); return; }
    var p = window._sysSet.policy;
    var list = p.exemptUids || (p.exemptUids = []);
    if (list.indexOf(uid) !== -1) { if (window.showToast) showToast('पहले से सुरक्षित है', true); return; }
    list.push(uid);
    if (window.logAdminActivity) logAdminActivity('cleanup_exempt_add', { uid: uid, manual: true });
    if (window.showToast) showToast('🔒 छूट जोड़ी — Save करना न भूलें', false);
    _renderAll();
  };

  window.sysSetAddDeviceManual = function () {
    var inp = document.getElementById('sysSetManualFp');
    var fp = inp && inp.value ? inp.value.trim() : '';
    if (!fp) { if (window.showToast) showToast('Device FP खाली है', true); return; }
    var p = window._sysSet.policy;
    var list = p.exemptDeviceFps || (p.exemptDeviceFps = []);
    if (list.indexOf(fp) !== -1) { if (window.showToast) showToast('पहले से सुरक्षित है', true); return; }
    list.push(fp);
    if (window.logAdminActivity) logAdminActivity('cleanup_device_exempt_add', { device_fp: fp, manual: true });
    if (window.showToast) showToast('🔒 Device सुरक्षित — Save करना न भूलें', false);
    _renderAll();
  };

  window.sysSetExemptAllUsers = function () {
    var ask = window.appConfirm
      ? window.appConfirm('🛡️ सूची के सभी ' + window._sysSet.users.length + ' यूज़र्स को छूट दें?\n\nउनके devices पर कभी कुछ डिलीट नहीं होगा। (भविष्य के नए users पर फ़ीचर लागू रहेगा।)')
      : Promise.resolve(confirm('सभी यूज़र्स को छूट दें?'));
    ask.then(function (yes) {
      if (!yes) return;
      var p = window._sysSet.policy;
      var list = p.exemptUids || (p.exemptUids = []);
      window._sysSet.users.forEach(function (u) {
        if (u.id && list.indexOf(u.id) === -1) list.push(u.id);
      });
      if (window.logAdminActivity) logAdminActivity('cleanup_exempt_bulk_all', { count: list.length });
      if (window.showToast) showToast('🛡️ सभी यूज़र्स सुरक्षित — Save करना न भूलें', false);
      _renderAll();
    });
  };

  /* ═══════════════════════════════════════════════════════════
     SAVE — read-modify-write नहीं; apk_cleanup की पूरी row हमारी है
     ═══════════════════════════════════════════════════════════ */

  window.sysSetSave = function () {
    var btn = document.getElementById('sysSetSaveBtn');
    var built = window._sysSetBuildPolicy(window._sysSet);

    /* 🔒 सुरक्षा गेट: अगर कोई छूट नहीं बची + तारीख़ भी खाली = जोखिमपूर्ण */
    if (window._sysSetIsRiskySave(built)) {
      var ask = window.appConfirm
        ? window.appConfirm('🚨 ख़तरा: कोई भी यूज़र/device सुरक्षित नहीं है!\n\nइसे सेव करने पर OWNER के device पर भी सफ़ाई लागू हो सकती है।\n\nक्या आप वाक़ई जारी रखना चाहते हैं?')
        : Promise.resolve(confirm('ख़तरा: कोई छूट नहीं! जारी रखें?'));
      ask.then(function (yes) { if (yes) _doSave(built, btn); });
      return;
    }
    _doSave(built, btn);
  };

  function _doSave(built, btn) {
    if (!window._supa) {
      if (window.showToast) showToast('Error: Supabase client तैयार नहीं', true);
      return;
    }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
    window._supa.from('app_settings')
      .upsert({ key: POLICY_KEY, value: built, updated_by: built.updatedBy, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .then(function (r) {
        if (r && r.error) throw r.error;
        window._sysSet.policy = built;
        if (window.logAdminActivity) logAdminActivity('cleanup_policy_save', {
          enabled: built.enabled, onUpdateWipe: built.onUpdateWipe,
          exemptUids: built.exemptUids.length, exemptDeviceFps: built.exemptDeviceFps.length,
          exemptRegisteredBefore: built.exemptRegisteredBefore
        });
        if (window.showToast) showToast('✅ System Settings सेव — user app + native पर लागू हो गए!', false);
        _renderAll();
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save System Settings'; }
      })
      .catch(function (e) {
        if (window.showToast) showToast('Save error: ' + ((e && e.message) || e), true);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save System Settings'; }
      });
  }

  console.log('✅ fa81-system-settings.js loaded');
})();
