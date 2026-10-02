/* ================================================================================
   FA53 OCR ENGINE — v4.0 "PLUS" LAYER  (additive, zero-risk upgrade)
   --------------------------------------------------------------------------------
   Purana engine (fa53-ocr-autofill.js v3.0m) image-processing aur matching me
   kaafi advanced hai — lekin usmein ye 6 cheezein BILKUL NAHI thi (grep se
   verified: cache=0, hash=0, pool=0, dpi=0, deskew=0, learn=0):

     ❌ koi result-cache nahi      -> wahi image dobara daalo to poora OCR phir se
     ❌ koi worker-pool nahi       -> ek hi worker, sab kaam serial (slow)
     ❌ user_defined_dpi set nahi  -> Tesseract ko DPI pata nahi = accuracy loss
     ❌ dictionary ON hai          -> Free Fire IGN (gibberish) me dawg nuksaan karta hai
     ❌ deskew/rotation nahi       -> tirchhi photo ka text galat padha jaata hai
     ❌ correction-memory nahi     -> admin ki manual correction bhool jaati thi

   Ye layer un sab ko add karti hai — HOST ENGINE KO CHHUE BINA (sirf
   Tesseract.createWorker ko wrap karta hai, isliye engine ke saare recognition
   paths automatically behtar ho jaate hain).

   Public API:  window.fa53Plus
     .stats()                    -> cache hits, avg ms, pool size
     .reset()                    -> cache + stats clear
     .cache                      -> {size, max, hits, misses}
     .deskew(source)             -> {angle, canvas}  (auto-straighten)
     .confusionScore(a,b)        -> OCR-confusion-aware similarity (0..1)
     .learn(pair) / .learnings() -> manual corrections yaad rakho
     .applyLearned(text)         -> known corrections text par lagao
     .qualityReport(rows)        -> per-row confidence + auto-review flags
     .parallelMap(items, fn)     -> worker-pool se parallel OCR (batch speedup)
     .set({dawgOff:true})        -> dictionary off/on (advanced)
================================================================================ */
(function () {
  'use strict';
  if (window.fa53Plus) return;                       /* double-load guard */

  var VERSION   = '4.0-plus';
  var LS_LEARN  = 'mes_ocr_learn_v1';
  var LS_CACHE  = 'mes_ocr_cache_v1';
  var LS_STATS  = 'mes_ocr_stats_v1';
  var CACHE_MAX = 40;                                 /* entries (LRU) */
  var CACHE_BYTES_MAX = 3 * 1024 * 1024;              /* ~3 MB localStorage cap */

  var _stats = { cacheHits: 0, cacheMiss: 0, totalMs: 0, runs: 0, poolCreated: 0, deskews: 0 };
  var _opts  = { dpi: '300', interword: true, dawgOff: true, cache: true, badge: true };

  function _ls(key, val) {
    try {
      if (val === undefined) { var s = localStorage.getItem(key); return s ? JSON.parse(s) : null; }
      localStorage.setItem(key, JSON.stringify(val)); return true;
    } catch (e) { return null; }
  }
  function _now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function _clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ───────────────────────── 1. blob hashing (deterministic) ─────────────── */
  function _fnv(bytes) {
    var h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
    for (var i = 0; i < bytes.length; i++) {
      h1 ^= bytes[i]; h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + bytes[i] * ((i % 251) + 1)) >>> 0;
    }
    return h1.toString(36) + '-' + h2.toString(36);
  }
  function _blobHash(blob) {
    return (blob && blob.arrayBuffer)
      ? blob.arrayBuffer().then(function (ab) { return _fnv(new Uint8Array(ab)); })
      : Promise.resolve('nohash' + (blob && blob.size || 0));
  }
  /* perceptual dHash (64-bit) — same-dikhne wali (re-compressed) images pakadta hai */
  function _dHash(source) {
    return new Promise(function (res) {
      try {
        var img = source;
        var c = document.createElement('canvas'); c.width = 9; c.height = 8;
        var x = c.getContext('2d');
        x.drawImage(img, 0, 0, 9, 8);
        var d = x.getImageData(0, 0, 9, 8).data, bits = '';
        for (var y = 0; y < 8; y++)
          for (var xx = 0; xx < 8; xx++) {
            var i = (y * 9 + xx) * 4, j = (y * 9 + xx + 1) * 4;
            var L = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
            var R = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114;
            bits += (L > R) ? '1' : '0';
          }
        res(bits);
      } catch (e) { res(''); }
    });
  }

  /* ───────────────────────── 2. result cache (LRU + localStorage) ─────────── */
  var _mem = {};              /* key -> result object (fast path) */
  var _order = [];            /* LRU order */

  function _cacheLoad() {
    var d = _ls(LS_CACHE);
    if (d && d.k) { _mem = d.k; _order = d.o || Object.keys(_mem); }
  }
  function _cacheSave() {
    try {
      var keys = _order.slice(-CACHE_MAX), out = {};
      for (var i = 0; i < keys.length; i++) if (_mem[keys[i]]) out[keys[i]] = _mem[keys[i]];
      var s = JSON.stringify({ k: out, o: keys });
      if (s.length < CACHE_BYTES_MAX) _ls(LS_CACHE, { k: out, o: keys });
    } catch (e) {}
  }
  function _cacheGet(key) {
    if (!_opts.cache || !key || !_mem[key]) return null;
    var i = _order.indexOf(key); if (i >= 0) { _order.splice(i, 1); _order.push(key); }
    return _mem[key];
  }
  function _cachePut(key, val) {
    if (!_opts.cache || !key || !val) return;
    _mem[key] = val; _order.push(key);
    while (_order.length > CACHE_MAX) { var old = _order.shift(); delete _mem[old]; }
  }

  /* ───────────────────────── 3. Tesseract hardening + instrumentation ─────── */
  function _hardened(base) {
    var p = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) p[k] = base[k];
    /* sirf tab set karo jab engine ne khud na kaha ho — engine ki settings always jeetती हैं */
    if (!('user_defined_dpi' in p) && _opts.dpi)         p.user_defined_dpi = _opts.dpi;
    if (!('preserve_interword_spaces' in p) && _opts.interword) p.preserve_interword_spaces = '1';
    if (_opts.dawgOff) {
      /* dictionary OFF: IGN/codes jaise gibberish tokens me Tesseract "sahi word"
         me badalne ki koshish nahi karta (accuracy win). Numeric whitelist wale
         passes isse affect nahi hote. Toggle: fa53Plus.set({dawgOff:false}) */
      if (!('load_system_dawg' in p)) p.load_system_dawg = '0';
      if (!('load_freq_dawg'   in p)) p.load_freq_dawg   = '0';
    }
    return p;
  }

  function _def(obj, name, val) {
    try { Object.defineProperty(obj, name, { value: val, configurable: true, writable: true }); return true; }
    catch (e) { try { obj[name] = val; return obj[name] === val; } catch (e2) { return false; } }
  }
  function _instrument(worker) {
    if (!worker || worker.__fa53Plus) return worker;
    try { worker.__fa53Plus = VERSION; } catch (e) {}

    /* setParameters merge */
    if (typeof worker.setParameters === 'function') {
      var _sp = worker.setParameters.bind(worker);
      var _spw = function (p) { return _sp(_hardened(p)); };
      _spw.__fa53wrapped = VERSION;
      _def(worker, 'setParameters', _spw);
    }
    /* recognize cache */
    if (typeof worker.recognize === 'function') {
      var _rc = worker.recognize.bind(worker);
      var _rcw = function (blob, opts, output) {
        var t0 = _now();
        var wantHeavy = !!(output && (output.blocks || output.hocr || output.tsv));
        var keyP = JSON.stringify([opts || null, output ? (output.blocks ? 'b' : 't') : 't', _opts.dawgOff, _opts.dpi]);
        return _blobHash(blob).then(function (h) {
          var key = h + '|' + keyP;
          var hit = (!wantHeavy) ? _cacheGet(key) : null;
          if (hit) {
            _stats.cacheHits++;
            try { console.log('[OCR v4] cache HIT (' + (h.slice(0, 10)) + ') — recognition skip'); } catch (e) {}
            return hit;
          }
          _stats.cacheMiss++;
          return _rc(blob, opts, output).then(function (res) {
            _stats.totalMs += (_now() - t0); _stats.runs++;
            if (!wantHeavy && res && res.data) {
              /* halka (text-only) result cache karo — blocks wale heavy results skip */
              _cachePut(key, { data: { text: res.data.text || '', confidence: res.data.confidence || 0,
                                       lines: res.data.lines || null }, __cached: true, __v: VERSION });
              _cacheSave();
            }
            return res;
          });
        });
      };
      _rcw.__fa53wrapped = VERSION;
      var ok = _def(worker, 'recognize', _rcw);
      if (!ok) { try { console.warn('[OCR v4] worker.recognize wrap FAILED — cache off is worker ke liye'); } catch (e) {} }
    }
    return worker;
  }

  var _origCreate = null;
  function _patchFactory() {
    if (!window.Tesseract || !window.Tesseract.createWorker) return false;
    if (window.Tesseract.createWorker.__fa53factory === VERSION) return true;   /* already ours */
    _origCreate = window.Tesseract.createWorker;
    var _fac = function () {
      var args = arguments, self = this;
      var pr = _origCreate.apply(self, args);
      return pr.then(function (w) { _stats.poolCreated++; return _instrument(w); });
    };
    _fac.__fa53factory = VERSION;
    _def(window.Tesseract, 'createWorker', _fac);
    console.log('%c[OCR v4] engine PLUS layer active — DPI ' + _opts.dpi + ', dictionary ' +
      (_opts.dawgOff ? 'OFF' : 'ON') + ', result-cache ON', 'color:#00ff9c;font-weight:700');
    _badge();
    return true;
  }

  /* chhota badge (visual proof ki enhanced engine chalu hai) */
  function _badge() {
    if (!_opts.badge || document.getElementById('fa53plusBadge')) return;
    try {
      var b = document.createElement('div');
      b.id = 'fa53plusBadge';
      b.title = 'OCR v4 PLUS: result-cache + DPI + worker-pool + deskew + learning';
      b.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9998;background:rgba(0,255,156,.12);' +
        'border:1px solid rgba(0,255,156,.35);color:#00ff9c;font:700 10px/1.2 system-ui;padding:4px 8px;' +
        'border-radius:20px;pointer-events:none;opacity:.75';
      b.textContent = '⚡ OCR v4';
      (document.body || document.documentElement).appendChild(b);
    } catch (e) {}
  }

  /* ───────────────────────── 4. worker pool (batch parallelism) ───────────── */
  var _pool = [], _poolBusy = [], _queue = [];
  function _poolSize() {
    var hc = navigator.hardwareConcurrency || 2;
    return _clamp(Math.floor(hc / 2), 1, 3);
  }
  function _makeWorker() {
    if (!window.Tesseract) return Promise.reject(new Error('Tesseract not loaded'));
    return Tesseract.createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js'
    }).then(function (w) {
      _instrument(w);                         /* apne worker ko khud instrument karo */
      return w.setParameters(_hardened({ tessedit_pageseg_mode: '6' })).then(function () { return w; });
    });
  }
  function _acquire() {
    for (var i = 0; i < _pool.length; i++) if (!_poolBusy[i]) { _poolBusy[i] = true; return Promise.resolve(_pool[i]); }
    if (_pool.length < _poolSize()) {
      var idx = _pool.length; _pool.push(null); _poolBusy.push(true);
      return _makeWorker().then(function (w) { _pool[idx] = w; return w; });
    }
    return new Promise(function (res) { _queue.push(res); });
  }
  function _release(w) {
    var i = _pool.indexOf(w);
    if (i >= 0) _poolBusy[i] = false;
    if (_queue.length) { var next = _queue.shift(); if (next) next(_acquire()); }
  }
  function parallelMap(items, fn, limit) {
    var max = limit || _poolSize(), i = 0, out = new Array(items.length), done = 0;
    return new Promise(function (res, rej) {
      function next() {
        if (i >= items.length) return;
        var idx = i++;
        Promise.resolve(fn(items[idx], idx)).then(function (r) {
          out[idx] = r; done++;
          if (done === items.length) res(out); else next();
        }, function (e) { done++; out[idx] = { __error: String(e) }; if (done === items.length) res(out); else next(); });
      }
      for (var k = 0; k < Math.min(max, items.length); k++) next();
      if (!items.length) res([]);
    });
  }

  /* ───────────────────────── 5. deskew (auto-straighten) ──────────────────── */
  /* Projection-profile variance: sahi angle par text lines ki row-histogram
     "sharp" hoti hai (variance max). ±8° scan karke best angle chunte hain. */
  function _profileVariance(canvas) {
    var c = document.createElement('canvas');
    var W = 320, H = Math.max(40, Math.round(canvas.height * 320 / Math.max(canvas.width, 1)));
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.drawImage(canvas, 0, 0, W, H);
    var d = x.getImageData(0, 0, W, H).data, rows = new Float64Array(H), mean = 0;
    for (var y = 0; y < H; y++) {
      var s = 0;
      for (var xx = 0; xx < W; xx++) {
        var i = (y * W + xx) * 4;
        s += Math.max(0, 255 - (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114));  /* ink amount */
      }
      rows[y] = s; mean += s;
    }
    mean /= H;
    var v = 0; for (var y2 = 0; y2 < H; y2++) { var t = rows[y2] - mean; v += t * t; }
    return v / H;
  }
  function deskew(source, maxDeg) {
    return new Promise(function (res) {
      try {
        var md = maxDeg || 8;
        var base = document.createElement('canvas');
        var w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
        base.width = w; base.height = h;
        base.getContext('2d').drawImage(source, 0, 0, w, h);
        var best = { angle: 0, score: _profileVariance(base) };
        for (var a = -md; a <= md; a++) {
          if (a === 0) continue;
          var t = document.createElement('canvas'); t.width = w; t.height = h;
          var tx = t.getContext('2d');
          tx.translate(w / 2, h / 2); tx.rotate(a * Math.PI / 180); tx.translate(-w / 2, -h / 2);
          tx.drawImage(base, 0, 0);
          var s = _profileVariance(t);
          if (s > best.score * 1.005) { best = { angle: a, score: s }; }
        }
        var out = document.createElement('canvas'); out.width = w; out.height = h;
        var ox = out.getContext('2d');
        if (best.angle !== 0) {
          ox.translate(w / 2, h / 2); ox.rotate(best.angle * Math.PI / 180); ox.translate(-w / 2, -h / 2);
        }
        ox.drawImage(base, 0, 0);
        _stats.deskews++;
        res({ angle: best.angle, canvas: out });
      } catch (e) { res({ angle: 0, canvas: null, error: String(e) }); }
    });
  }

  /* ───────────────────────── 6. OCR-confusion-aware matching ──────────────── */
  /* Tesseract ki classic galtiyan: 0/O/Q/D, 1/l/I/|, 5/S, 8/B, 2/Z, 6/G, rn/m,
     cl/d, vv/w, 9/g, 4/A. Ye pairs "match" maane jaate hain (0.35 cost). */
  var CONFUSE = {
    '0': 'oOQDC()', 'o': '0OQDC()', '1': 'lI|!itL[]', 'l': '1I|!it', 'i': '1lI|!', '|': '1lI!',
    '5': 'Ss', 's': '5S', '8': 'B', 'b': '8B', '2': 'Zz', 'z': '2Z', '6': 'Gb', 'g': '9qb',
    '9': 'gq', '4': 'A', 'a': '4A', '7': 'Tt', 't': '7T', '3': 'E', 'c': 'Ce(', 'e': '3Ec',
    'm': 'MN', 'n': 'N', 'u': 'Uv', 'v': 'Vuy', 'y': 'Yv', 'k': 'Kx', 'x': 'Xk', 'w': 'Wv',
    'p': 'P', 'q': 'Q9g', 'j': 'Ji', 'f': 'F', 'r': 'R', 'h': 'H', 'd': 'Dcl', 'D': '0Od'
  };
  function _charCost(a, b) {
    if (a === b) return 0;
    var set = CONFUSE[a] || '';
    if (set.indexOf(b) >= 0) return 0.35;               /* classic OCR confusion */
    var set2 = CONFUSE[b] || '';
    if (set2.indexOf(a) >= 0) return 0.35;
    return 1;
  }
  /* multi-char confusions (rn->m, cl->d, vv->w, ii->n ...) */
  var MULTI = [['rn', 'm'], ['cl', 'd'], ['vv', 'w'], ['ii', 'n'], ['nn', 'm'], ['tl', 'd'], ['fj', 'f']];
  function confusionScore(a, b) {
    a = String(a || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    b = String(b || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    if (!a || !b) return 0;
    for (var mI = 0; mI < MULTI.length; mI++) {
      a = a.split(MULTI[mI][0]).join(MULTI[mI][1]);
      b = b.split(MULTI[mI][0]).join(MULTI[mI][1]);
    }
    var la = a.length, lb = b.length, dp = [], i, j;
    for (i = 0; i <= la; i++) dp[i] = [i];
    for (j = 0; j <= lb; j++) dp[0][j] = j;
    for (i = 1; i <= la; i++)
      for (j = 1; j <= lb; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + _charCost(a[i - 1], b[j - 1]));
    var maxLen = Math.max(la, lb);
    return _clamp(1 - (dp[la][lb] / maxLen), 0, 1);
  }

  /* ───────────────────────── 7. learning memory (corrections) ─────────────── */
  var _learn = _ls(LS_LEARN) || { pairs: {}, hits: 0 };
  function _learnSave() { _ls(LS_LEARN, _learn); }
  function learn(pair, toStr) {
    /* Supports both learn('0CR_H3R0', 'OCR_HERO') and learn({from:'0CR_H3R0', to:'OCR_HERO'}) */
    if (!pair) return false;
    if (typeof pair === 'string' && typeof toStr === 'string') {
      pair = [{ from: pair, to: toStr }];
    }
    var list = Array.isArray(pair) ? pair : [pair];
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var f = String(list[i].from || '').trim(), t = String(list[i].to || '').trim();
      if (!f || !t || f === t) continue;
      _learn.pairs[f] = { to: t, n: ((_learn.pairs[f] || {}).n || 0) + 1, at: Date.now() };
      n++;
    }
    if (n) _learnSave();
    return n > 0;
  }
  function applyLearned(text) {
    var out = String(text || ''), keys = Object.keys(_learn.pairs);
    for (var i = 0; i < keys.length; i++) {
      if (out.indexOf(keys[i]) >= 0) { out = out.split(keys[i]).join(_learn.pairs[keys[i]].to); _learn.hits++; }
    }
    return out;
  }
  function learnings() { return JSON.parse(JSON.stringify(_learn)); }
  function exportLearnings() { return JSON.stringify(_learn.pairs, null, 1); }
  function importLearnings(json) {
    try { var o = JSON.parse(json), n = 0;
      for (var k in o) if (o[k] && o[k].to) { _learn.pairs[k] = o[k]; n++; }
      _learnSave(); return n;
    } catch (e) { return 0; }
  }

  /* ───────────────────────── 8. per-row quality report (auto-review) ──────── */
  /* rows = [{slot, name, nameConf, kills, killsConf}] */
  function qualityReport(rows) {
    rows = rows || [];
    var out = [], seen = {}, totalK = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {}, flags = [];
      var nc = typeof r.nameConf === 'number' ? r.nameConf : null;
      var kc = typeof r.killsConf === 'number' ? r.killsConf : null;
      if (nc !== null && nc < 70) flags.push('name-low-conf');
      if (kc !== null && kc < 70) flags.push('kills-low-conf');
      if (!r.name) flags.push('name-empty');
      if (r.kills === null || r.kills === undefined || isNaN(r.kills)) flags.push('kills-missing');
      if (typeof r.kills === 'number' && (r.kills < 0 || r.kills > 99)) flags.push('kills-out-of-range');
      var key = String(r.name || '').toLowerCase().replace(/\s+/g, '');
      if (key && seen[key]) flags.push('duplicate-name(slot ' + seen[key] + ')');
      else if (key) seen[key] = r.slot || (i + 1);
      totalK += (typeof r.kills === 'number' ? r.kills : 0);
      out.push({ slot: r.slot || (i + 1), name: r.name || '', kills: r.kills,
                 score: Math.round(((nc === null ? 60 : nc) + (kc === null ? 60 : kc)) / 2),
                 review: flags.length > 0, flags: flags });
    }
    var avg = out.length ? Math.round(out.reduce(function (s, x) { return s + x.score; }, 0) / out.length) : 0;
    return { rows: out, avgScore: avg, totalKills: totalK, needReview: out.filter(function (x) { return x.review; }).length };
  }

  /* ───────────────────────── 9. public surface ────────────────────────────── */
  var api = {
    version: VERSION,
    get cache() { return { size: _order.length, max: CACHE_MAX, hits: _stats.cacheHits, misses: _stats.cacheMiss }; },
    stats: function () {
      return {
        version: VERSION, cacheHits: _stats.cacheHits, cacheMisses: _stats.cacheMiss,
        runs: _stats.runs, avgRecognitionMs: _stats.runs ? Math.round(_stats.totalMs / _stats.runs) : 0,
        poolSize: _pool.length, poolTarget: _poolSize(), deskews: _stats.deskews, learnPairs: Object.keys(_learn.pairs).length,
        opts: JSON.parse(JSON.stringify(_opts))
      };
    },
    reset: function () { _mem = {}; _order = []; _ls(LS_CACHE, { k: {}, o: [] }); _stats = { cacheHits: 0, cacheMiss: 0, totalMs: 0, runs: 0, poolCreated: 0, deskews: 0 }; return true; },
    set: function (o) { for (var k in (o || {})) _opts[k] = o[k]; return JSON.parse(JSON.stringify(_opts)); },
    deskew: deskew, dHash: _dHash, confusionScore: confusionScore,
    instrument: _instrument,   /* host engine apne workers ko yahan se instrument kar sakta hai */
    learn: learn, applyLearned: applyLearned, learnings: learnings,
    exportLearnings: exportLearnings, importLearnings: importLearnings,
    qualityReport: qualityReport, parallelMap: parallelMap,
    acquire: _acquire, release: _release,
    recognizeWithPool: function (blob, opts) {
      return _acquire().then(function (w) {
        return w.recognize(blob, opts || {}).then(function (r) { _release(w); return r; },
                                               function (e) { _release(w); throw e; });
      });
    },
    terminatePool: function () {
      _pool.forEach(function (w) { try { w.terminate(); } catch (e) {} });
      _pool = []; _poolBusy = []; _queue = []; return true;
    }
  };
  window.fa53Plus = api;
  window.FA53Plus = api;
  window.fa53OCRPlus = api;

  _cacheLoad();
  if (!_patchFactory()) {
    /* Tesseract abhi load nahi hua (CDN) — retry */
    var tries = 0, iv = setInterval(function () {
      _patchFactory();
      /* CDN ne Tesseract dobara/re-load kiya ho to phir se patch karo */
      if (window.Tesseract && window.Tesseract.createWorker && window.Tesseract.createWorker.__fa53factory !== VERSION) _patchFactory();
      if (++tries > 120) clearInterval(iv);
    }, 1000);
    window.addEventListener('pagehide', function () { clearInterval(iv); }, { once: true });
  }
  window.addEventListener('pagehide', function () { try { api.terminatePool(); } catch (e) {} }, { once: true });
  console.log('[OCR v4] PLUS layer loaded — window.fa53Plus.stats() try karo');
})();
