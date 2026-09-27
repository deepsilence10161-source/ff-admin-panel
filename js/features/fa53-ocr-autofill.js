/* ================================================================
   FA53: FREE FIRE OCR ENGINE v2.4
   Technology : Tesseract.js (Apache License 2.0) — FREE, Unlimited
   FIXES v2.4 (2026-09-21):
   - 3-variant consensus: normal + invert + SOFT (upscale+contrast, no hard
     threshold) — glossy/dark screenshots me binarize text kha jata hai,
     soft variant wahan bhi dekhta hai; teeno confidence-order me merge
   - Duplicate-rank repair: OCR same rank do baar padh le to position-order
     se re-number (result-screen ka CRAM hi sach hai)
   FIXES v2.3 (2026-09-21):
   - normLine(): unicode-fold (full-width 0-9, Devanagari 0-9 -> ASCII),
     zero-width strip, bullet/pipe separators -> space, space-collapse —
     parseResult/parseLobby ab normalized lines par chalte hain
   - fixNum() v2: z->2, s->5, t->7, A->4, !->1 bhi (sirf numeric-slot par)
   - slotKills(): 2-char slot me KOI DIGIT nahi -> name-fragment maan ke
     REJECT (v2.2b ka sabse bada wrong-fill source); kills >99 bhi reject
   - Ambiguity-guard: best aur second-best match lagbhag barabar (gap<8)
     -> SKIP — galat player bharne se behtar manual
   FIXES v2.2 (2026-09-21):
   - Confidence-picking: normal+inverted variants me se JO BEHTAR padha usi se
     parser priority (pehle naive normal-first tha)
   - fixNum(): OCR digit-confusions (O->0, l->1, S->5, B->8...) sirf numeric
     captures par auto-correct
   - Naye result-patterns: "1. Name K" (rank-first) + "Name K kills"
   - fuzzyScore me Levenshtein (chhote IGN matches behtar)
   FIXES v2.1:
   - Double-trigger removed (hook auto-runs once; button does manual re-run)
   - console.log removed from production paths
   - Result parser: damage regex fixed \d+ (was \d{3,6} missed DMG < 100)
   - FF positional rank detection (results are ordered 1..N)
   - Lobby name filter > 16 chars (was 28, too loose)
   - SKIP list expanded for admin UI strings
   - Verified counter badge after lobby OCR
================================================================ */
(function () {
'use strict';

/* ── 1. TESSERACT LOADER ── */
var TSR = { ready:false, loading:false, queue:[],
  load:function(cb){
    if(TSR.ready){if(cb)cb();return;}
    if(cb)TSR.queue.push(cb);
    if(TSR.loading)return;
    TSR.loading=true;
    function attempt(urls,i){
      if(i>=urls.length)return;
      var s=document.createElement('script');s.src=urls[i];
      s.onload=function(){TSR.ready=true;TSR.loading=false;TSR.queue.forEach(function(f){try{f();}catch(e){}});TSR.queue=[];};
      s.onerror=function(){attempt(urls,i+1);};
      document.head.appendChild(s);
    }
    attempt(['https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'],0);
  }
};
TSR.load();

/* ── 2. IMAGE PREPROCESSOR ── */
function preprocessImage(file,invert,opts){
  return new Promise(function(resolve){
    var url=URL.createObjectURL(file);
    var img=new Image();
    img.onerror=function(){URL.revokeObjectURL(url);resolve(file);};
    img.onload=function(){
      URL.revokeObjectURL(url);
      var scale=Math.min(2.5,2400/Math.max(img.width,img.height,1));
      if(scale<1)scale=1;
      if(opts&&opts.scale)scale=opts.scale;   /* v2.5: chhoti screenshots ke liye zyada upscale */
      var W=Math.round(img.width*scale),H=Math.round(img.height*scale);
      var cv=document.createElement('canvas');cv.width=W;cv.height=H;
      var ctx=cv.getContext('2d');
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(img,0,0,W,H);
      var id=ctx.getImageData(0,0,W,H),px=id.data;
      for(var i=0;i<px.length;i+=4){
        var r=px[i],g=px[i+1],b=px[i+2];
        var isGold=r>200&&g>160&&b<100,isWhite=r>190&&g>190&&b>190,isCyan=r<100&&g>170&&b>200,isGreen=r<100&&g>200&&b<120;
        var gray=0.299*r+0.587*g+0.114*b;
        var boosted=Math.max(0,Math.min(255,((gray-128)*2.0)+128));
        var bright=(isGold||isWhite||isCyan||isGreen)?255:boosted;
        /* v2.4 'soft' variant: koi hard threshold nahi — sirf upscale+contrast;
           glossy/dark screenshots par binarize patla text kha jata hai */
        var out;
        if(invert==='soft'){ out=bright; }
        else if(invert==='white'){
          /* v2.5: sirf NEAR-WHITE pixels (teeno channel high) — FF result screens
             me text white hota hai, plate/background colored. Purane threshold
             (145) me bright plate bhi white ban jata tha aur text doob jata tha. */
          out=(Math.min(r,g,b)>=175)?255:0;
        }
        else if(invert==='maxch'){
          /* v2.5: koi bhi channel bright ho (gold/cyan text bhi) */
          out=(Math.max(r,g,b)>=180)?255:0;
        }
        else { out=invert?(bright>145?0:255):(bright>145?255:0); }
        px[i]=px[i+1]=px[i+2]=out;px[i+3]=255;
      }
      ctx.putImageData(id,0,0);
      cv.toBlob(function(blob){resolve(blob||file);},'image/png');
    };
    img.src=url;
  });
}

/* ── 3. OCR RUNNER — singleton worker reuse to prevent memory leaks ── */
/* ✅ Bug 15 Fix: Single shared worker, not new one per call */
/* Issue #32 Fix: Terminate Tesseract worker on page hide to prevent memory leak.
   Without this, the worker thread persists even after navigation, wasting ~60MB. */
/* ✅ FIX (Audit M3): yeh 3 variables kabhi declare nahi hui thi — har baar
   admin tab switch karta ya page band karta, "_ocrWorker is not defined"
   crash hota (confirmed via real browser test). Isi wajah se worker kabhi
   terminate nahi hota tha — jo memory-leak fix yahan likhne ki koshish ki
   gayi thi, woh khud kaam nahi kar raha tha. */
var _ocrWorker = null, _ocrWorkerReady = false, _ocrWorkerBusy = false;
function _terminateOcrWorker() {
  if (_ocrWorker) {
    try { _ocrWorker.terminate(); } catch(e) {}
    _ocrWorker        = null;
    _ocrWorkerReady   = false;
    _ocrWorkerBusy    = false;
  }
}
window.addEventListener('pagehide',      _terminateOcrWorker);
window.addEventListener('beforeunload',  _terminateOcrWorker);
/* Bug#12 Fix: Also terminate OCR worker when admin navigates away from result section.
   The worker consumes significant memory and should be freed between uses. */
window.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') {
    /* Tab hidden — terminate to free resources; will be recreated on demand */
    _terminateOcrWorker();
  }
});
/* Expose terminate function for section navigation cleanup */
window._terminateOcrWorker = _terminateOcrWorker;

async function _getOCRWorker(onPct) {
  /* If worker doesn't exist or was terminated, create fresh one */
  if (!_ocrWorker || !_ocrWorkerReady) {
    _ocrWorkerReady = false;
    _ocrWorker = await Tesseract.createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
      logger: function(m) { if (onPct && m.status === 'recognizing text') onPct(Math.round(m.progress * 100)); }
    });
    await _ocrWorker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.,!?@#$%&*()-+=|;:\' ',
      preserve_interword_spaces: '1', tessedit_pageseg_mode: '6'
    });
    _ocrWorkerReady = true;
  }
  return _ocrWorker;
}

/* Release worker on page hide to free memory */
window.addEventListener('pagehide', function() {
  if (_ocrWorker) { try { _ocrWorker.terminate(); } catch(e) {} _ocrWorker = null; _ocrWorkerReady = false; }
});

async function recognize(blob, onPct) {
  /* Wait if worker is busy (queue-like behavior) */
  var _wait = 0;
  while (_ocrWorkerBusy && _wait < 30) { await new Promise(function(r){setTimeout(r,500);}); _wait++; }
  _ocrWorkerBusy = true;
  try {
    var worker = await _getOCRWorker(onPct);
    var result = await worker.recognize(blob);
    _ocrWorkerBusy = false;
    /* v2.2: confidence bhi lauto — runOCR ab dono variants me se BETTER wala primary banata hai */
    return { text: result.data.text || '', conf: Number(result.data.confidence) || 0 };
  } catch(e) {
    _ocrWorkerBusy = false;
    /* Worker error — terminate and recreate on next call */
    try { if (_ocrWorker) _ocrWorker.terminate(); } catch(e2) {}
    _ocrWorker = null; _ocrWorkerReady = false;
    throw e;
  }
}

async function runOCR(file,onPct){
  /* v2.4: 3-variant consensus — sab variants parallel, confidence-order me
     merge (best pehle = parser priority), dedupe case-insensitive */
  var ps=await Promise.all([preprocessImage(file,false),preprocessImage(file,true),preprocessImage(file,'soft')]);
  var ts=await Promise.all([recognize(ps[0],onPct),recognize(ps[1]),recognize(ps[2])]);
  ts=ts.filter(Boolean).sort(function(a,b){return (b.conf||0)-(a.conf||0);});
  if(!ts.length)ts=[{text:''}];
  var seen={},lines=[];
  ts.forEach(function(t){(t.text||'').split('\n').forEach(function(l){
    l=l.trim();var k=l.toLowerCase().replace(/\s+/g,'');
    if(k.length>1&&!seen[k]){seen[k]=true;lines.push(l);}
  });});
  return lines.join('\n');
}

/* ── 4. FUZZY MATCH ── */
function norm(s){return(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
/* v2.3: line-normalizer — OCR text ke unicode/divider variants ek shape me */
function normLine(s){
  return String(s||'')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g,'')
    .replace(/[\uFF10-\uFF19]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0xFEE0);})
    .replace(/[\u0966-\u096F]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0x966+48);})
    .replace(/[\u00B7\u2022\u25CF\u25C6|]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
/* v2.2: OCR digit-confusion fix — sirf NUMERIC captures par (names par kabhi nahi):
   O/Q->0, l/I/|/i->1, Z->2, S->5, b/G->6, T->7, B->8, g/q->9 */
function fixNum(t){
  return String(t||'').replace(/[OoQ]/g,'0').replace(/[lI|i!]/g,'1').replace(/[Zz]/g,'2')
    .replace(/A/g,'4').replace(/[Ss]/g,'5').replace(/b/g,'6').replace(/G/g,'6').replace(/[Tt]/g,'7')
    .replace(/B/g,'8').replace(/[gq]/g,'9');
}
/* v2.3: numeric-slot validator — 2-char slot me >=1 digit zaroori
   (pure-alpha = name-fragment, REJECT); valid range 0-99 */
function slotKills(raw){
  var t=String(raw||'').trim();
  if(!t)return -1;
  if(t.length>=2&&!/\d/.test(t))return -1;
  var n=parseInt(fixNum(t),10);
  if(isNaN(n)||n<0||n>99)return -1;
  return n;
}
function fuzzyScore(a,b){
  var na=norm(a),nb=norm(b);
  if(!na||!nb)return 0;
  if(na===nb)return 100;
  if(na.includes(nb)||nb.includes(na))return Math.max(0,88-Math.abs(na.length-nb.length));
  var pfx=0;while(pfx<na.length&&pfx<nb.length&&na[pfx]===nb[pfx])pfx++;
  var pfxSc=Math.round((pfx/Math.max(na.length,nb.length))*70);
  function bigrams(s){var o={};for(var i=0;i<s.length-1;i++)o[s.slice(i,i+2)]=true;return o;}
  var bg1=bigrams(na),bg2=bigrams(nb),shared=0,total=Object.keys(bg1).length+Object.keys(bg2).length;
  Object.keys(bg1).forEach(function(k){if(bg2[k])shared++;});
  var biSc=total?Math.round(2*shared/total*65):0;
  /* v2.2: Levenshtein bhi — chhote IGNs me bigrams kamzor hota hai */
  function lev(x,y){
    var m=x.length,n=y.length,d=[],i,j;
    if(!m)return n; if(!n)return m;
    for(i=0;i<=m;i++)d[i]=[i];
    for(j=0;j<=n;j++)d[0][j]=j;
    for(i=1;i<=m;i++)for(j=1;j<=n;j++)
      d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(x[i-1]===y[j-1]?0:1));
    return d[m][n];
  }
  var lv=lev(na,nb);
  var lvSc=Math.round((1-lv/Math.max(na.length,nb.length))*85);
  return Math.max(pfxSc,biSc,lvSc);
}
function bestMatch(name,list,minSc){
  var scored=list.map(function(item){return{item:item,score:fuzzyScore(name,item.name)};});
  scored.sort(function(a,b){return b.score-a.score;});
  var top=scored[0];
  if(!top||top.score<(minSc||55))return null;
  /* v2.3: ambiguity-guard — second-best bahut kareeb hai to SKIP */
  if(scored[1]&&(top.score-scored[1].score)<8)return null;
  return top;
}

/* ── 4.5 WORD-BOX PARSER (v2.5, 2026-09-27) ──────────────────────────────
   Problem (live panel par measured): line-based parser poore screenshot ki
   lines par chalta tha, isliye (a) naam ke colored plate + background art
   text ko kha jaate the, (b) K/D/A/DMG columns ek hi line me mix ho jaate the.
   Fix: Tesseract se word-level bounding boxes lo, header row ("NAME ... K ...")
   se kills-column ka x-center nikalo, phir HAR row ko uske boxes se banao:
     - kills  = kills-column ke x-range me pada numeric word
     - name   = us word se LEFT ke words
   Multiple masks (white/maxch/soft) me se jo sabse zyada valid rows de wahi
   chunta hai. Purana parseResult fallback ke roop me bana rehta hai. */
async function ocrWords(blob, psm){
  var worker = await _getOCRWorker();
  var out = await worker.recognize(blob, {}, { blocks: true });
  var lines = [];
  function walkLine(l){
    if (!l) return;
    var tx = (l.text || '').trim(); if (!tx) return;
    lines.push({ text: tx, y: l.bbox ? (l.bbox.y0 + l.bbox.y1) / 2 : null,
      words: (l.words || []).map(function (w) {
        return { t: (w.text || '').trim(), x0: w.bbox ? w.bbox.x0 : 0, x1: w.bbox ? w.bbox.x1 : 0,
                 x: w.bbox ? (w.bbox.x0 + w.bbox.x1) / 2 : 0,
                 h: w.bbox ? Math.abs(w.bbox.y1 - w.bbox.y0) : 0 };
      }) });
  }
  (out.data.blocks || []).forEach(function (bl) {
    (bl.paragraphs || []).forEach(function (pa) { (pa.lines || []).forEach(walkLine); });
    if (!bl.paragraphs && bl.lines) bl.lines.forEach(walkLine);
  });
  if (!lines.length) (out.data.text || '').split('\n').forEach(function (tt) {
    if (tt.trim()) lines.push({ text: tt.trim(), y: null, words: [] });
  });
  return { lines: lines, conf: Number(out.data.confidence) || 0 };
}

function _cleanName(s){
  var t = String(s || '').replace(/[|\[\]{}\/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  var keep = t.split(' ').filter(function (p) { return /[A-Za-z0-9]{2,}/.test(p); });
  t = (keep.length ? keep : t.split(' ')).join(' ').trim();
  t = t.replace(/^[^A-Za-z0-9(]+/, '').replace(/[^A-Za-z0-9)!?]+$/, '').trim();
  return t.slice(0, 22);
}

/* ek OCR pass (words+boxes) se rows nikalo — header se kills column milta hai */
/* ── 4.6 NAME-STRIP REFINEMENT (v2.5b) ─────────────────────────────
   Full-image pass me naam plate ke avatar + gradient graphics ke saath mil
   jaata hai ('Ly NEES' jaise junk). FF result screen me kills column ka x
   killsX se pata chalta hai aur naam hamesha uske LEFT hota hai — isliye
   har row ke naam-area ka narrow strip alag se OCR hota hai (psm 7 = single
   line). Additive hai: jo naam zyada match kare wahi use hota hai. */
function _loadImgFile(file){
  return new Promise(function(res){
    var url=URL.createObjectURL(file), im=new Image();
    im.onload=function(){res(im);};
    im.onerror=function(){URL.revokeObjectURL(url);res(null);};
    im.src=url;
  });
}
/* v2.7: Bradley adaptive threshold — integral image se local mean, phir
   pixel > (mean - C) ko text maano. Ghost/glow/blurry screenshots me global
   threshold se kaafi behtar (free, pure JS, koi library nahi). */
function _adaBinary(px, w, h, C, invert){
  var n = w*h, i, x, y;
  var gray = new Float32Array(n);
  for (i=0;i<n;i++){ var r=px[i*4],g=px[i*4+1],b=px[i*4+2]; gray[i]=Math.min(r,g,b); }
  var W1 = w+1;
  var I = new Float64Array((w+1)*(h+1));
  for (y=0;y<h;y++){
    var rs=0;
    for (x=0;x<w;x++){ rs += gray[y*w+x]; I[(y+1)*W1 + (x+1)] = I[y*W1 + (x+1)] + rs; }
  }
  var rad = Math.max(5, Math.round(Math.min(w,h)*0.18));
  for (y=0;y<h;y++){
    var y0=Math.max(0,y-rad), y1=Math.min(h-1,y+rad);
    for (x=0;x<w;x++){
      var x0=Math.max(0,x-rad), x1=Math.min(w-1,x+rad);
      var area=(x1-x0+1)*(y1-y0+1);
      var sum = I[(y1+1)*W1 + (x1+1)] - I[y0*W1 + (x1+1)] - I[(y1+1)*W1 + x0] + I[y0*W1 + x0];
      var mean = sum/area;
      var on = (gray[y*w+x] > (mean - C));
      if (invert) on = !on;
      var idx=(y*w+x)*4; px[idx]=px[idx+1]=px[idx+2]=on?255:0; px[idx+3]=255;
    }
  }
}
function _stripBlob(im, x0, y0, x1, y1, thr, inv){
  var W=im.naturalWidth||im.width, H=im.naturalHeight||im.height;
  x0=Math.max(0,Math.round(x0)); y0=Math.max(0,Math.round(y0));
  x1=Math.min(W,Math.round(x1)); y1=Math.min(H,Math.round(y1));
  var cw=x1-x0, ch=y1-y0;
  if(cw<20||ch<8) return Promise.resolve(null);
  /* v2.5c: 1400/cw (≈7.6x) par smooth+binary text blur ho jata tha aur OCR
     junk deta tha; probe me ~4x (700 px target) sabse saaf nikla. */
  var s=Math.max(1,Math.min(8, 700/cw));
  var cv=document.createElement('canvas'); cv.width=Math.round(cw*s); cv.height=Math.round(ch*s);
  var ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(im, x0,y0,cw,ch, 0,0, cv.width, cv.height);
  var id=ctx.getImageData(0,0,cv.width,cv.height), px=id.data;
  if(thr==='ada'){
    /* v2.7 ADVANCED: adaptive local-mean threshold (Bradley) — blurry/ghost
       text ke liye. Global threshold in images me fail hota hai (glow/shadow),
       local mean se har pixel apne aas-paas ke background se compare hota hai. */
    _adaBinary(px, cv.width, cv.height, 10, !!inv);
  } else {
    for(var i=0;i<px.length;i+=4){
      var r=px[i],g=px[i+1],b=px[i+2];
      var on=(Math.min(r,g,b)>=thr);
      if(inv) on=!on;
      px[i]=px[i+1]=px[i+2]=on?255:0; px[i+3]=255;
    }
  }
  ctx.putImageData(id,0,0);
  return new Promise(function(res){cv.toBlob(function(bl){res(bl);},'image/png');});
}
/* v2.5g: per-row KILLS digit — data-driven rule (thr_matrix.json).
   Discovery: high threshold digit ki thin stroke kha jata tha ('7'→'5'),
   thr≈110 sabse stable nikla (img1 4/4, img2 row0 bhi). Ab: K-word bbox
   (padding ke saath, jisse '17' ka '1' bhi aaye) x 5 offsets x thr110 —
   majority vote; tie/none par thr200 se dobara; phir bhi nahi to parser
   ka purana reading. psm 10 = single character. */
function _digitVote(im, x0, y0, x1, y1, thr, offs, inv){
  var votes = {};
  for (var i = 0; i < offs.length; i++) {
    try {
      var bl = await (_stripBlob(im, x0 + offs[i], y0, x1 + offs[i], y1, thr, inv));
      if (!bl) continue;
      var pass = await (ocrWords(bl, 10));
      var tx = ((pass.lines[0] && pass.lines[0].text) || '').replace(/[^0-9]/g, '');
      if (!tx) continue;
      var v = parseInt(tx, 10);
      if (isNaN(v) || v < 0 || v > 99) continue;
      votes[v] = (votes[v] || 0) + 1;
    } catch (e) {}
  }
  return votes;
}
function _pickVote(votes){
  var bestV = null, bestC = 0, tie = false;
  Object.keys(votes).forEach(function (k) {
    var c = votes[k];
    if (c > bestC) { bestC = c; bestV = parseInt(k, 10); tie = false; }
    else if (c === bestC) tie = true;
  });
  if (bestV == null || tie || bestC < 2) return null;
  return bestV;
}
async function _numStrips(im, rows, Wo, Ho, scale){
  if(!im||!Wo||!Ho) return;
  scale = scale || 1;
  var off = Math.max(3, Math.round(0.004 * Wo));
  var offs = [-off, -Math.round(off/2), 0, Math.round(off/2), off];
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(r.y==null) continue;
    var yc = r.y * Ho;
    /* window: K-word bbox + parser fx + padding (dono ka union) */
    var hw = Math.max(0.020 * Wo, 12);
    var x0 = r.fx != null ? (r.fx/scale - hw) : null, x1 = r.fx != null ? (r.fx/scale + hw) : null;
    if(r.kwx0 != null && r.kwx1 != null){
      var pad = (r.kwh ? r.kwh * 0.55 : hw);
      var bx0 = r.kwx0/scale - pad, bx1 = r.kwx1/scale + (r.kwh ? r.kwh * 0.15 : 0);
      x0 = (x0 == null) ? bx0 : Math.min(x0, bx0);
      x1 = (x1 == null) ? bx1 : Math.max(x1, bx1);
    }
    if(x0 == null || x1 == null) continue;
    var y0 = yc - Math.max(0.024 * Ho, (r.kwh ? r.kwh/scale * 0.8 : 8));
    var y1 = yc + Math.max(0.024 * Ho, (r.kwh ? r.kwh/scale * 0.8 : 8));
    /* v2.7 ADVANCED: thr110 → ada (blurry ke liye) → thr200 fallback ladder */
    var v = _pickVote(_digitVote(im, x0, y0, x1, y1, 110, offs));
    if(v == null) v = _pickVote(_digitVote(im, x0, y0, x1, y1, 'ada', offs));
    if(v == null) v = _pickVote(_digitVote(im, x0, y0, x1, y1, 200, offs));
    if(v == null) v = _pickVote(_digitVote(im, x0, y0, x1, y1, 'ada', offs, true));
    if(v != null) r.kills = v;
  }
}
/* v2.6: name-strip variants + naam-jaisa heuristic.
   Discovery (name_thr.json): thr 168/190 high the — 110/140 par naam saaf
   padhte hain (img1 'Vanisherrr' 0.95 @140). Ab 4 variants (3 thresholds x
   2 windows), aur runtime par heuristic se sabse 'naam-jaise' text chuna
   jata hai (letters zyada, digits/symbols kam). */
function _nameLikeScore(t){
  /* v2.7 fix: pehle absolute letters count se score tha — is se lamba GANDA
     text (adhoori neighbouring column mila hua) saaf chhote naam ko hara deta
     tha (e.g. 'Boa Vanisherr z8)' > 'Vanisherrr'). Ab letter-RATIO bhi count
     hota hai aur digits/junk par sakht penalty hai. */
  var letters=(t.match(/[A-Za-z]/g)||[]).length;
  var digits=(t.match(/[0-9]/g)||[]).length;
  var junk=(t.match(/[^A-Za-z0-9 ]/g)||[]).length;
  var tot=t.replace(/\s+/g,'').length || 1;
  if(letters<3) return -99;
  var ratio=letters/tot;
  return letters*0.6 + ratio*6 - digits*2 - junk*2;
}
async function _nameStrips(im, rows, killsXo, Wo, Ho, scale){
  if(!im||!Wo||!Ho) return;
  scale = scale || 1;
  var variants=[
    {lx:0.205, rx:0.070, hh:0.038, thr:140},
    {lx:0.205, rx:0.070, hh:0.038, thr:115},
    {lx:0.185, rx:0.062, hh:0.038, thr:140},
    {lx:0.205, rx:0.070, hh:0.038, thr:'ada'}
  ];
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(r.y==null) continue;
    var ax = (killsXo != null) ? killsXo : ((r.fx != null && r.fx > 0) ? (r.fx / scale) : null);
    if (!ax) continue;
    var yc=r.y*Ho, texts=[];
    for(var v=0; v<variants.length; v++){
      var o=variants[v];
      try{
        var bl=await _stripBlob(im, ax-o.lx*Wo, yc-o.hh*Ho, ax-o.rx*Wo, yc+o.hh*Ho, o.thr, o.inv);
        if(!bl) continue;
        var pass=await ocrWords(bl, 7);
        var tx=((pass.lines[0]&&pass.lines[0].text)||'').trim();
        if(!tx) continue;
        var cleaned=_cleanName(tx);
        if(_nameLikeScore(cleaned) > -50) texts.push(cleaned);   /* sirf plausible naam */
      }catch(e){}
    }
    /* v2.7: ek hi "best" chunne se kabhi-kabhi kaam ka candidate gir jata tha —
       ab TOP-2 distinct candidates store karte hain; auto-fill dono try karta hai. */
    var cands=[];
    for(var c=0;c<texts.length;c++){ if(cands.indexOf(texts[c])<0) cands.push(texts[c]); }
    cands.sort(function(a,b){ return _nameLikeScore(b)-_nameLikeScore(a); });
    if(cands.length){ r.name2=cands[0]; }
    if(cands.length>1){ r.name3=cands[1]; }
  }
}
/* gate-free best-candidate score (candidate pick karne ke liye; gate runResult me) */
function _bestScore(name,list){
  var best=null,second=null;
  list.forEach(function(item){
    var sc=fuzzyScore(name,item.name);
    if(!best||sc>best.score){ second=best; best={item:item,score:sc}; }
    else if(!second||sc>second.score){ second={item:item,score:sc}; }
  });
  if(!best) return null;
  return {item:best.item, score:best.score, second:second?second.score:null};
}

function _rowsFromWords(pass, W, H){
  var killsX = null, hdrY = null, nameX0 = null, i, ln, ws, k;
  for (i = 0; i < pass.lines.length; i++) {
    ln = pass.lines[i]; ws = ln.words || [];
    if (!ws.length || ln.y == null) continue;
    for (var j = 0; j < ws.length; j++) {
      if (/^(K|KILLS?)$/i.test(ws[j].t) && ws[j].h > H * 0.008) { k = ws[j]; break; }
      if (/^(K\/?D\/?A|K\/A)$/i.test(ws[j].t)) { k = ws[j]; k.__kda = true; break; }
    }
    if (k) {
      killsX = k.__kda ? (k.x0 + (k.x1 - k.x0) * 0.12) : (k.x0 + k.x1) / 2;
      hdrY = ln.y;
      for (var m = 0; m < ws.length; m++) if (/^NAME$/i.test(ws[m].t)) { nameX0 = ws[m].x0; break; }
      break;
    }
  }
  var tol = killsX != null ? Math.max(W * 0.022, 10) : null;
  /* v2.5e: HEADER-LESS fallback — chhoti screenshots me 'K' header alag se
     nahi milta, pehle wahan rows hi 0 aati thi. Ab header ke bina bhi: har
     line = ek row, kills = us line ka SABSE LEFT number (≤99). */
  var headerless = (hdrY == null);
  var rows = [];
  pass.lines.forEach(function (ln2) {
    if (ln2.y == null) return;
    if (!headerless && ln2.y <= hdrY + H * 0.010) return;
    if (/^(NAME|K|A|D|DMG|KILLS)\b/i.test(ln2.text) && !/\d/.test(ln2.text)) return;
    if (/SURVIVAL|REVIVAL/i.test(ln2.text) && !/\d/.test(ln2.text)) return;
    var w2 = (ln2.words || []).filter(function (w) { return w.t; });
    var nums = w2.filter(function (w) { return /^\d{1,4}$/.test(w.t); })
                 .map(function (w) { return { v: parseInt(w.t, 10), w: w }; });
    if (!nums.length) return;
    /* v2.5d: FF result me har TEAM ka block alag indent hota hai — ek global
       killsX sirf ek team ke liye sahi hota hai. Isliye har row ka apna anchor
       'fx' = us row ka sabse LEFT wala number (K column). */
    var fx = null;
    for (var q = 0; q < nums.length; q++) { if (fx == null || nums[q].w.x < fx) fx = nums[q].w.x; }
    var kills = null, kw = null;
    if (fx != null && killsX != null && Math.abs(fx - killsX) <= tol * 1.5) { fx = killsX; }
    var anchor = (fx != null ? fx : killsX);
    if (anchor != null) {
      var tol2 = (fx != null ? tol : tol);
      var cand = nums.filter(function (n) { return Math.abs(n.w.x - anchor) <= tol2 && n.v <= 99; });
      if (cand.length) { kills = cand[0].v; kw = cand[0].w; }
    }
    if (kills == null) {
      var lo = nameX0 != null ? nameX0 + W * 0.06 : W * 0.12;
      var small = nums.filter(function (n) { return n.v <= 99 && n.w.x > lo && n.w.x < W * 0.62; });
      if (small.length) { kills = small[0].v; kw = small[0].w; }
    }
    if (kills == null && headerless && nums.length) { kills = nums[0].v; kw = nums[0].w; }  /* leftmost */
    if (kills == null) return;
    var left = w2.filter(function (w) {
      return kw ? (w.x1 < kw.x0 - W * 0.004) : (w.x < W * 0.42);
    }).filter(function (w) { return !/^(NAME|K|A|D|DMG|KILLS)$/i.test(w.t); })
      .map(function (w) { return w.t; }).join(' ');
    var hasDmg = nums.some(function (n) { return n.v >= 100 && n.v <= 99999; });
    /* v2.5g: pre-filter ab sirf bilkul khaali junk hataata hai — asli validity
       naam-strip ke BAAD decide hoti hai (naam + numbers dono chahiye). */
    if (!nums.length) return;
    var fromCol = (killsX != null) ? nums.some(function (n) { return Math.abs(n.w.x - killsX) <= tol && n.v === kills; })
                                   : (fx != null && nums.some(function (n) { return n.v === kills && n.w.x === fx; }));
    rows.push({ kills: kills, y: Number((ln2.y / H).toFixed(3)), name: _cleanName(left), raw: ln2.text.slice(0, 80),
                nums: nums.length, hasDmg: hasDmg, fromCol: fromCol, fx: fx,
                kwx0: kw ? kw.x0 : null, kwx1: kw ? kw.x1 : null, kwy: kw ? kw.y : null, kwh: kw ? kw.h : null });
  });
  /* v2.5d: ek hi player ki do lines (split rows, e.g. 'ANSHU' + 'oy EE') ko
     y-proximity se merge karo — warna rank numbering shift ho jati hai. */
  rows.sort(function (a, b) { return a.y - b.y; });
  var merged = [];
  rows.forEach(function (r) {
    var last = merged[merged.length - 1];
    if (last && Math.abs(r.y - last.y) <= 0.018) {
      var lc = ((last.name || '').match(/[A-Za-z]/g) || []).length;
      var rc = ((r.name || '').match(/[A-Za-z]/g) || []).length;
      if (rc > lc) merged[merged.length - 1] = r;
      return;
    }
    merged.push(r);
  });
  rows = merged;
  /* v2.5: rank = row ka order (FF result screen top-to-bottom 1..N hoti hai) */
  rows.forEach(function (r, i) { r.rank = i + 1; });
  return { rows: rows, killsX: killsX };
}

/* ek image par multi-mask word-box OCR; jo mask sabse zyada valid rows de wahi */
async function parseResultV25(file, onPct){
  /* ✅ FIX: original image ke dims chahiye (pehle preprocessed blob ke dims
     use ho rahe the — 588px ki screenshot 1470px ban chuki hoti thi, isliye
     'small' mode kabhi trigger hi nahi hota tha). */
  /* v2.5b: image element ek hi baar load — dims ke liye bhi aur name-strip
     refinement ke liye bhi (dobara decode karne ki zaroorat nahi). */
  var imEl = await _loadImgFile(file);
  var dims = imEl ? { w: (imEl.naturalWidth || imEl.width), h: (imEl.naturalHeight || imEl.height) } : { w: 0, h: 0 };
  var small = (dims.w || 9999) < 900;
  var sc = small ? Math.max(2.5, Math.min(8, 4200 / Math.max(dims.w || 1, 1))) : 0;   /* 0 = default */
  var modes = [['white', 0], ['maxch', 0], ['soft', 0], [false, 175]];
  if (small) modes = [['maxch', 0], ['white', 0], ['soft', 0]];
  var best = null, dbg = [];
  for (var i = 0; i < modes.length; i++) {
    try {
      var blob = await preprocessImage(file, modes[i][0], sc ? { scale: sc } : null);
      var pass = await ocrWords(blob, 6);
      /* ✅ FIX: word-box coordinates SCALED canvas ke hain — purane dims dene se
         column x-thresholds galat ho jaate the (kills=63 jaise junk isi se aaya). */
      var effScale = sc ? sc : Math.min(2.5, 2400 / Math.max(dims.w || 1, dims.h || 1));
      if (effScale < 1) effScale = 1;
      var W2 = Math.round((dims.w || 1000) * effScale), H2 = Math.round((dims.h || 1000) * effScale);
      var pr = _rowsFromWords(pass, W2, H2);
      var score = pr.rows.filter(function (r) { return r.kills != null && /[A-Za-z]{2,}/.test(r.name); }).length * 2 + pr.rows.length;
      dbg.push({ mode: String(modes[i][0]), rows: pr.rows.length, score: score, conf: Math.round(pass.conf) });
      if (!best || score > best.score) best = { score: score, rows: pr.rows, mode: String(modes[i][0]), conf: Math.round(pass.conf), killsX: pr.killsX, scale: effScale };
      if (onPct) onPct(Math.round(((i + 1) / modes.length) * 100));
    } catch (e) { dbg.push({ mode: String(modes[i][0]), err: String((e && e.message) || e).slice(0, 80) }); }
  }
  /* v2.5b: chune gaye pass ke rows par name-strip refinement */
  if (best && best.rows.length && best.rows.length <= 20 && imEl) {
    try { await _nameStrips(imEl, best.rows, (best.killsX != null ? best.killsX / (best.scale || 1) : null), dims.w || 1000, dims.h || 1000, best.scale || 1); } catch (e) {}
    try { await _numStrips(imEl, best.rows, dims.w || 1000, dims.h || 1000, best.scale || 1); } catch (e) {}
  }
  /* v2.5g: ab final filter — row tabhi valid hai jab (a) naam me kam-se-kam
     2 letters hon (full-pass ya name-strip se) AUR (b) numbers maujood hon.
     Header/summary/'So close!' jaise junk rows isse hat jate hain; rank
     phir dobara assign hota hai. */
  if (best && best.rows.length) {
    best.rows = best.rows.filter(function (r) {
      var nm = (r.name || '') + ' ' + (r.name2 || '') + ' ' + (r.name3 || '');
      var letters = (nm.match(/[A-Za-z]{2,}/g) || []).length;
      var numeric = (r.nums || 0) >= 1 && r.kills != null;
      return letters >= 1 && numeric;
    });
    best.rows.forEach(function (r, i) { r.rank = i + 1; });
  }
  if (imEl && imEl.src && imEl.src.indexOf('blob:') === 0) { try { URL.revokeObjectURL(imEl.src); } catch (e) {} }
  return { rows: (best && best.rows) || [], mode: best ? best.mode : null,
           score: best ? best.score : 0, conf: best ? best.conf : 0, killsX: best ? best.killsX : null, debug: dbg };
}

/* ── 5. PARSERS ── */

/* Result parser
   FIX v2.1: \d+ for damage (was \d{3,6} — missed damage < 100)
   FIX v2.1: positional rank fallback when no #N found */
function parseResult(text){
  var lines=text.split('\n').map(function(l){return normLine(l);}).filter(Boolean);
  var players=[];
  lines.forEach(function(line){
    // v2.2 rank-first: "1. Name K" / "1) Name K [DMG]"  (kill-slot letters bhi — fixNum संभालता है)
    var m0=line.match(/^(\d{1,2})[.)°]\s+(.{2,22}?)\s+([0-9A-Za-z!]{1,2})(?:\s+(\d+))?\s*$/);
    if(m0){var rk0=parseInt(fixNum(m0[1]),10),kl0=slotKills(m0[3]);
      if(rk0>=1&&rk0<=48&&kl0>=0){var nm0=m0[2].replace(/[|[\]{}\\/]/g,'').trim();if(nm0.length>=2){players.push({name:nm0,kills:kl0,rank:rk0});return;}}}
    // "Name  K  D  A  DMG" — FIX: \d+ not \d{3,6}
    var m1=line.match(/^(.{2,22}?)\s+([0-9A-Za-z!]{1,2})\s+\d+\s+(\d+)/);
    if(m1){var kl1=slotKills(m1[2]);if(kl1>=0){var nm=m1[1].replace(/[|[\]{}\\/]/g,'').trim();if(nm.length>=2){players.push({name:nm,kills:kl1,rank:0});return;}}}
    // "Name K/D/A DMG"
    var m2=line.match(/^(.{2,22}?)\s+([0-9A-Za-z!]{1,2})\s*\/\s*\d+\s*\/\s*\d+\s+(\d+)/);
    if(m2){var kl2=slotKills(m2[2]);if(kl2>=0){var nm2=m2[1].replace(/[|[\]{}\\/]/g,'').trim();if(nm2.length>=2){players.push({name:nm2,kills:kl2,rank:0});return;}}}
    // "Name  Kills  DMG" — simple 2-col
    var m3=line.match(/^(.{2,22}?)\s+([0-9A-Za-z!]{1,2})\s+(\d{2,6})\s*$/);
    if(m3){var kl3=slotKills(m3[2]);if(kl3>=0){var nm3=m3[1].replace(/[|[\]{}\\/]/g,'').trim();if(nm3.length>=2){players.push({name:nm3,kills:kl3,rank:0});return;}}}
    // v2.2: "Name 3 kills" (word wala)
    var m4=line.match(/^(.{2,22}?)\s+([0-9A-Za-z!]{1,2})\s+kills?\b/i);
    if(m4){var kl4=slotKills(m4[2]);if(kl4>=0){var nm4=m4[1].replace(/[|[\]{}\\/]/g,'').trim();if(nm4.length>=2){players.push({name:nm4,kills:kl4,rank:0});return;}}}
  });

  // Try #N rank pattern first
  var rPat=/#\s*(\d{1,2})\b/g,rm,ri=0;
  while((rm=rPat.exec(normLine(text)))!==null){
    var pos=parseInt(rm[1]);
    if(pos>=1&&pos<=48&&ri<players.length){if(!players[ri].rank){players[ri].rank=pos;ri++;}}
  }
  // FIX v2.1: if no #N found, use positional order (FF results screen IS ordered 1..N)
  if(ri===0&&players.length>0){players.forEach(function(p,i){if(!p.rank)p.rank=i+1;});}
  /* v2.4: duplicate-rank repair — OCR same rank do baar padh le (#2 #2 jaisa)
     to position-order se re-number; galat duplicate ranks prize-calc ko
     bigaad sakte the */
  var _rc={},_dup=false;
  players.forEach(function(p){if(p.rank){_rc[p.rank]=(_rc[p.rank]||0)+1;if(_rc[p.rank]>1)_dup=true;}});
  if(_dup)players.forEach(function(p,i){p.rank=i+1;});

  // Single player fallback
  if(!players.length){
    var kM=text.match(/\bk\b\s*[:\s]+(\d{1,2})|kills?\s*[:\s]+(\d{1,2})/i);
    var rM=text.match(/#\s*(\d{1,2})\b/);
    if(kM||rM)players.push({name:'',kills:parseInt((kM&&(kM[1]||kM[2]))||0),rank:parseInt((rM&&rM[1])||0)});
  }
  return players;
}

/* Lobby parser
   FIX v2.1: max name length 16 (was 28 — too loose, caught admin UI text)
   FIX v2.1: SKIP list expanded with common admin UI strings */
function parseLobby(text){
  var SKIP=/^(booyah|free fire|bermuda|kalahari|purgatory|squad|duo|solo|room|lobby|waiting|start|ready|status|in room|verify|joined|pending|slot|player|match|mode|entry|refresh|all matches|export|fraud|health|broadcast|not enough|spectator|team|info|invite|tournament|result|prize|fee|rank|kills|phone|ffuid|action|joined at|done|cancel|ban|warn|dismiss|approved|admin|settings|support|analytics|activity|select a match|loading|error|search)/i;
  var lines=text.split('\n').map(function(l){return normLine(l);}).filter(Boolean);
  var players=[];
  lines.forEach(function(line){
    // FIX: max 16 chars (was 28)
    if(SKIP.test(line)||line.length<2||line.length>16)return;
    if(/^\d+$/.test(line))return;
    if(/^[^a-zA-Z]+$/.test(line))return;
    // "N Name"
    var m1=line.match(/^([0-9A-Za-z!]{1,2})\s+(.{2,14})$/);
    if(m1){var sl1=parseInt(fixNum(m1[1]),10);if(sl1>=1&&sl1<=48){players.push({name:m1[2].trim(),slot:sl1});return;}}
    // "Name  N"
    var m2=line.match(/^(.{2,14}?)\s+([0-9A-Za-z!]{1,2})$/);
    if(m2){var sl2=parseInt(fixNum(m2[2]),10);if(sl2>=1&&sl2<=48){players.push({name:m2[1].trim(),slot:sl2});return;}}
    // Plain name
    if(line.length>=3&&line.length<=14&&/[a-zA-Z]/.test(line)){players.push({name:line,slot:0});}
  });
  var seen={};
  return players.filter(function(p){var k=norm(p.name);if(!k||seen[k])return false;seen[k]=true;return true;});
}

/* ── 6. STATUS BAR ── */
function bar(anchorId,msg,type){
  var C={loading:{bg:'rgba(0,180,255,.12)',br:'rgba(0,180,255,.4)',tx:'#00b4ff'},success:{bg:'rgba(0,255,156,.1)',br:'rgba(0,255,156,.4)',tx:'#00ff9c'},error:{bg:'rgba(255,68,68,.12)',br:'rgba(255,68,68,.4)',tx:'#ff6b6b'},warn:{bg:'rgba(255,200,0,.1)',br:'rgba(255,200,0,.4)',tx:'#ffc800'},info:{bg:'rgba(185,100,255,.1)',br:'rgba(185,100,255,.4)',tx:'#b964ff'}};
  var c=C[type]||C.loading;
  var id='_ocrBar_'+anchorId;
  var el=document.getElementById(id);
  if(!el){
    el=document.createElement('div');el.id=id;
    el.style.cssText='border-radius:8px;padding:9px 14px;margin:8px 0 4px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:8px;transition:opacity .4s';
    var anc=document.getElementById(anchorId);
    if(anc&&anc.parentNode)anc.parentNode.insertBefore(el,anc.nextSibling);
    else{var fb=document.getElementById('mrSsPreview')||document.getElementById('joinedPlayersTable');if(fb&&fb.parentNode)fb.parentNode.insertBefore(el,fb);}
  }
  el.style.opacity='1';el.style.background=c.bg;el.style.border='1px solid '+c.br;el.style.color=c.tx;
  el.innerHTML=msg;
  if(type==='success'||type==='error'){clearTimeout(el._t);el._t=setTimeout(function(){el.style.opacity='0';setTimeout(function(){if(el.parentNode)el.remove();},500);},6000);}
  return el;
}

/* ── 7. RESULT AUTO-FILL ── */
var _rBusy=false;
async function runResult(files){
  /* ✅ FIX (2026-09-27): ek hi upload ko multiple wrappers/buttons se dobara
     process hone se roko (auto wrapper + v10 trigger + direct listener —
     teenon same FileList bhejte hain; identity guard duplicate run khaata hai,
     lekin naya upload = nayi FileList = normally chalta hai). */
  if(files && files.length && window._ocrLastFilesRef===files) return;
  if(files && files.length) window._ocrLastFilesRef=files;
  if(_rBusy){bar('mrSsPreview','⏳ OCR chal raha hai...','warn');return;}
  var rows=document.querySelectorAll('#mrPlayerTable tr[data-uid], #participantsList tr[data-uid]');
  if(!rows.length){bar('mrSsPreview','⚠️ Pehle match select karo aur players load karo','warn');return;}
  if(!TSR.ready){bar('mrSsPreview','⏳ OCR engine load ho raha hai...','info');await new Promise(function(r){TSR.load(r);});}
  _rBusy=true;
  var fileArr=Array.from(files).slice(0,5);
  var b=bar('mrSsPreview','<i class="fas fa-spinner fa-spin"></i> &nbsp;Scanning...','loading');
  try{
    var all=[];
    for(var i=0;i<fileArr.length;i++){
      if(b)b.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;Image '+(i+1)+'/'+fileArr.length+' scan...';
      /* v2.5 pehla rasta: word-box parsing (columns alag, crosses nahi) */
      var boxed=null;
      try{ boxed=await parseResultV25(fileArr[i],function(p){if(b)b.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;'+(i+1)+'/'+fileArr.length+': '+p+'%';}); }catch(e){}
      if(boxed && boxed.rows && boxed.rows.length){
        all=all.concat(boxed.rows);
        window._ocrLastParse=window._ocrLastParse||{}; window._ocrLastParse[fileArr[i].name||i]=boxed.debug;
      } else {
        /* fallback: purana line-parser (agar boxes na mile) */
        var text=await runOCR(fileArr[i],function(p){if(b)b.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;'+(i+1)+'/'+fileArr.length+': '+p+'%';});
        all=all.concat(parseResult(text));
      }
    }
    if(!all.length){bar('mrSsPreview','⚠️ Player data detect nahi hua — clearer screenshot upload karo','warn');_rBusy=false;return;}
    var seen={};
    all=all.filter(function(p){var k=norm(p.name);if(!k||seen[k])return false;seen[k]=true;return true;});
    var tbl=[];
    rows.forEach(function(row){var el=row.querySelector('td:nth-child(2) div');if(el)tbl.push({name:el.textContent.trim(),row:row});});
    var plans=[],skipped=0,lowConf=0;
    all.forEach(function(op){
      var anyName=(op.name&&op.name.length>=2)||(op.name2&&op.name2.length>=2)||(op.name3&&op.name3.length>=2);
      if(!anyName){if(rows.length===1){plans.push({row:rows[0],op:op});}return;}
      /* v2.5 SAFETY GATE: auto-fill sirf jab naam ka match solid ho.
         72 se neeche = skip (galat row me kills bharne se prize galat ho sakta). */
      var pick=null;
      [op.name, op.name2, op.name3].forEach(function(nm){
        if(!nm||nm.length<2)return;
        var s2=_bestScore(nm,tbl);
        if(s2&&(!pick||s2.score>pick.score))pick=s2;
      });
      if(!pick||pick.score<72){skipped++;return;}
      if(pick.second!=null&&(pick.score-pick.second)<8){skipped++;return;}
      /* quality: row real result-row jaisa ho (3+ numbers ya DMG ya kills K-column se) */
      var strong = (op.fromCol === true) || (op.hasDmg === true && (op.nums || 0) >= 3);
      if (!strong) { lowConf++; return; }
      plans.push({row:pick.item.row, op:op});
    });
    /* ✅ SAFETY (2026-09-27): rank OCR row-ORDER par depend karta hai. Rank sirf
       tab bharo jab HAR panel row match ho gayi ho (complete 1:1 mapping) —
       warna order shift ho sakta hai aur rank ghalat fill hoga (galat prize).
       Kills per-player independent hain, wo har matched row me safe hain. */
    var fillRank = (plans.length >= rows.length);
    plans.forEach(function(p){ _fillRow(p.row,p.op,fillRank); });
    var filled = plans.length;
    if(window.mrCalcPrize)rows.forEach(function(r){var inp=r.querySelector('.mr-rank-input');if(inp)window.mrCalcPrize(inp);});
    if(window.mrCheckDuplicateRanks)window.mrCheckDuplicateRanks();
    var msg='✅ Done! <b>'+filled+'/'+rows.length+' players</b> auto-filled';
    if(skipped>0)msg+=' <span style="opacity:.6;font-weight:400">('+skipped+' unmatched)</span>';
    if(lowConf>0)msg+=' <span style="opacity:.6;font-weight:400">('+lowConf+' low-confidence — manually check karo)</span>';
    if(!fillRank&&filled>0)msg+=' <span style="opacity:.7;font-weight:400">— kills fill hue; rank manually verify karo (kuch rows read nahi hui)</span>';
    bar('mrSsPreview',msg,filled>0?'success':'warn');
  }catch(e){bar('mrSsPreview','❌ Error: '+((e&&e.message)||e||'unknown'),'error');}
  _rBusy=false;
}

function _fillRow(row,op,allowRank){
  /* R19: active result-table (participantsList) के inputs .rank-input/.kills-input
     हैं — पुराना mrPlayerTable (.mr-*-input) कभी populate होता ही नहीं था, इसलिए
     OCR auto-fill मरा हुआ था। दोनों selectors पकड़ो, जो मिले भर दो। */
  var ri=row.querySelector('.mr-rank-input,.rank-input'),ki=row.querySelector('.mr-kills-input,.kills-input');
  if(allowRank===false)ri=null;   /* safety: adhoori rows par rank mat bharo */
  if(ri&&op.rank>0){ri.value=op.rank;ri.dispatchEvent(new Event('input',{bubbles:true}));_flash(ri,'rgba(255,215,0,.08)');}
  if(ki&&op.kills>=0){ki.value=op.kills;ki.dispatchEvent(new Event('input',{bubbles:true}));_flash(ki,'rgba(255,107,107,.08)');}
}
function _flash(el,reset){el.style.transition='background .5s';el.style.background='rgba(0,255,156,.45)';setTimeout(function(){el.style.background=reset;},900);}

/* ── 8. LOBBY VERIFY ── */
var _lBusy=false;
async function runLobby(files){
  if(_lBusy){_lbar('⏳ OCR chal raha hai...','warn');return;}
  if(!TSR.ready){_lbar('⏳ OCR engine load ho raha hai...','info');await new Promise(function(r){TSR.load(r);});}
  var tbl=_collectVerifyRows();
  if(!tbl.length){_lbar('⚠️ Player rows nahi mili — Joined Players refresh karo','warn');return;}
  _lBusy=true;
  var fileArr=Array.from(files).slice(0,6);
  _lbar('<i class="fas fa-spinner fa-spin"></i> &nbsp;Lobby screenshot scan ho rahi hai...','loading');
  try{
    var all=[];
    for(var i=0;i<fileArr.length;i++){
      _lbar('<i class="fas fa-spinner fa-spin"></i> &nbsp;Image '+(i+1)+'/'+fileArr.length+' scan...','loading');
      all=all.concat(parseLobby(await runOCR(fileArr[i])));
    }
    if(!all.length){_lbar('⚠️ Koi player detect nahi hua — clearer lobby screenshot lo','warn');_lBusy=false;return;}
    var seen={};
    all=all.filter(function(p){var k=norm(p.name);if(!k||seen[k])return false;seen[k]=true;return true;});
    var ticked=0,promises=[];
    all.forEach(function(dp){
      if(!dp.name||dp.name.length<2)return;
      var res=bestMatch(dp.name,tbl,58);if(!res)return;
      var tp=res.item;
      if(dp.slot>0&&tp.slot>0&&dp.slot!==tp.slot&&res.score<78)return;
      if(tp.verified)return;
      tp.el.style.borderColor='#00ff9c';tp.el.style.background='rgba(0,255,156,.12)';tp.el.dataset.verified='true';
      var ico=tp.el.querySelector('i');if(ico)ico.style.color='#00ff9c';
      tp.verified=true;ticked++;
      if(typeof rtdb!=='undefined'&&typeof auth!=='undefined'){
        promises.push((function(rk){
          return rtdb.ref('joinRequests/'+rk).update({adminVerified:true,verifiedAt:Date.now(),verifiedBy:auth.currentUser?_adminUid():'admin',verifiedVia:'ocr_free'}).catch(function(){});
        })(tp.reqKey));
      }
    });
    await Promise.all(promises);
    // FIX v2.1: Update verified counter badge
    _updateVerifiedCounter();
    _lbar('✅ Done! <b>'+ticked+' players</b> auto-verified'+(all.length-ticked>0?' <span style="opacity:.6;font-weight:400">('+( all.length-ticked)+' unmatched)</span>':''),ticked>0?'success':'warn');
  }catch(e){_lbar('❌ Error: '+e.message,'error');}
  _lBusy=false;
}

/* Update verified count in section header */
function _updateVerifiedCounter(){
  var allWraps=document.querySelectorAll('.verify-chk-wrap, .tm-vchk');
  var total=allWraps.length,verified=0;
  allWraps.forEach(function(el){if((el.style.borderColor||'').includes('00ff9c')||el.dataset.verified==='true')verified++;});
  var badge=document.getElementById('_ocrVerifiedBadge');
  if(!badge){
    var countEl=document.getElementById('joinedCount');
    if(countEl&&countEl.parentNode){
      badge=document.createElement('span');badge.id='_ocrVerifiedBadge';
      badge.style.cssText='margin-left:8px;font-size:11px;color:#00ff9c;font-weight:700;background:rgba(0,255,156,.1);border:1px solid rgba(0,255,156,.25);border-radius:12px;padding:2px 9px';
      countEl.parentNode.insertBefore(badge,countEl.nextSibling);
    }
  }
  if(badge)badge.textContent='✅ '+verified+'/'+total+' verified';
}

function _collectVerifyRows(){
  var data=[];
  document.querySelectorAll('#joinedPlayersTable tr[data-uid]').forEach(function(row){
    var wrap=row.querySelector('.verify-chk-wrap');if(!wrap)return;
    var rk=wrap.id?wrap.id.replace('vwrap_',''):'';
    var nm=row.querySelector('td:nth-child(1) span.badge');
    var sl=row.querySelector('td:nth-child(2) span');
    data.push({reqKey:rk,name:nm?(nm.getAttribute('title')||nm.textContent.trim()):'',slot:sl?parseInt(sl.textContent)||0:0,el:wrap,verified:wrap.style.borderColor&&wrap.style.borderColor.includes('00ff9c')});
  });
  document.querySelectorAll('.tm-vchk[data-rk]').forEach(function(el){
    var rk=el.dataset.rk;
    var con=el.closest('div[style*="grid-template-columns"]');if(!con)return;
    var nm=con.querySelector('span.badge.primary');
    var sl=con.querySelector('span[style*="00d4ff"]');
    data.push({reqKey:rk,name:nm?(nm.getAttribute('title')||nm.textContent.trim()):'',slot:sl?parseInt(sl.textContent.replace(/\D/g,''))||0:0,el:el,verified:el.style.borderColor&&el.style.borderColor.includes('00ff9c')});
  });
  return data.filter(function(d){return d.name&&d.name.length>1;});
}

function _lbar(msg,type){
  var anc=document.getElementById('_lobbyOcrAnchor');
  if(!anc){anc=document.createElement('span');anc.id='_lobbyOcrAnchor';var sa=document.querySelector('#section-joinedPlayers .section-actions');if(sa)sa.appendChild(anc);}
  bar('_lobbyOcrAnchor',msg,type);
}

/* ── 9. UI INJECTION
   FIX v2.1: hookResult wraps mrAddScreenshots — auto-runs OCR on NEW file upload only.
   Manual button reads existing base64 from _mrScreenshots → no double trigger. ── */
var _rHooked=false,_rBtn=false,_lBtn=false;

var _lastHooked=null;
function hookResult(){
  if(!window.mrAddScreenshots)return;
  /* ✅ FIX (2026-09-27): purana guard function-identity compare karta tha.
     fa-admin-v10 ka wrapper beech me aane par hum use dobara wrap karte the
     aur dono scripts ping-pong karte rehte the (chain har 500ms gehri hoti
     jati thi). Ab: hamara wrapper already outermost hai to kuch na karo. */
  if(window.mrAddScreenshots._fa53Hook) return;
  var orig=window.mrAddScreenshots;
  var wrapped=function(inp){
    /* ✅ FIX (2026-09-27 — auto-path ka ASLI bug): base handler
       (fa22-match-result.js `mrAddScreenshots`) aakhir me `input.value=''`
       karta hai — uske BAAD `inp.files` khaali ho jati hai. Pehle hum orig()
       ke baad `inp.files` use karte the → OCR ko khaali list milti thi →
       auto path chupchaap marta tha. Ab files ko orig() se PEHLE local
       variable me pakadte hain aur wahi (FileList ref) runResult ko dete hain
       (ref input clear hone ke baad bhi valid rehta hai). */
    var files = (inp && inp.files && inp.files.length) ? inp.files : null;
    if(files) window._mrLastFiles = files;
    orig(inp);
    var use = files || window._mrLastFiles;
    if(use && use.length){ runResult(use); }
  };
  wrapped._fa53Hook=true;
  window.mrAddScreenshots=wrapped;
}

function addResultBtn(){
  if(_rBtn||document.getElementById('_ocrRBtn'))return;
  var inp=document.getElementById('mrFileInput');if(!inp)return;
  _rBtn=true;
  /* ✅ FIX (2026-09-27): wrapper chain par bharosa na karo — seedha input
     element par bhi listener lagao (agar koi aur script wrappers badal de to
     bhi auto-OCR chalega; runResult ka identity-guard duplicate kha jata hai). */
  if(!inp._fa53Auto){
    inp._fa53Auto=true;
    /* capture:true — inline onchange (jo input.value='' kar deta hai) se PEHLE
       chalta hai, isliye files yahan guaranteed milti hain. */
    inp.addEventListener('change',function(){
      var f=this.files;
      if(f&&f.length){ window._mrLastFiles=f; runResult(f); }
    },true);
  }
  var btn=document.createElement('button');
  btn.id='_ocrRBtn';btn.type='button';
  btn.innerHTML='<i class="fas fa-magic"></i> OCR Auto-Fill';
  btn.title='Free OCR — Screenshot se Rank/Kills auto fill (No API, Unlimited)';
  btn.style.cssText='padding:7px 14px;border-radius:8px;background:rgba(255,215,0,.12);border:1.5px solid rgba(255,215,0,.35);color:#ffd700;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px';
  btn.onclick=function(){
    var ex=window._mrScreenshots;
    if(!ex||!ex.length){bar('mrSsPreview','⚠️ Pehle screenshots add karo','warn');return;}
    // Convert stored base64 → Blob, then run — does NOT re-trigger hookResult
    var blobs=ex.map(function(src,i){
      try{var a=src.split(','),mt=a[0].match(/:(.*?);/)[1],bs=atob(a[1]),n=bs.length,u=new Uint8Array(n);for(var j=0;j<n;j++)u[j]=bs.charCodeAt(j);var b=new Blob([u],{type:mt});b.name='ss'+i+'.jpg';return b;}catch(e){return null;}
    }).filter(Boolean);
    if(blobs.length)runResult(blobs);
  };
  inp.parentNode.insertBefore(btn,inp);
}

function addLobbyBtn(){
  if(_lBtn||document.getElementById('_ocrLBtn'))return;
  var sa=document.querySelector('#section-joinedPlayers .section-actions');if(!sa)return;
  _lBtn=true;
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';inp.multiple=true;inp.id='_ocrLFile';inp.style.display='none';
  inp.onchange=function(){if(this.files&&this.files.length)runLobby(this.files);this.value='';};
  sa.appendChild(inp);
  var anc=document.createElement('span');anc.id='_lobbyOcrAnchor';sa.appendChild(anc);
  var btn=document.createElement('button');
  btn.id='_ocrLBtn';btn.type='button';btn.className='btn btn-ghost btn-sm';
  btn.style.cssText='background:rgba(0,255,156,.08);border:1px solid rgba(0,255,156,.3);color:#00ff9c;font-weight:700';
  btn.innerHTML='<i class="fas fa-camera-retro"></i> OCR Verify';
  btn.title='Lobby screenshot → players auto-tick (Free, No API)';
  btn.onclick=function(){document.getElementById('_ocrLFile').click();};
  sa.insertBefore(btn,sa.firstChild);
}

/* ── 10. BOOT ── */
var _tries=0,_poll=setInterval(function(){
  _tries++;
  hookResult();addResultBtn();addLobbyBtn();
  /* _rHooked flag ab kaam nahi karta (doosri script wrapper replace kar sakti hai)
     — hookResult() khud compare karta hai ki current function hamara hai ya nahi */
  if(window.loadJoinedPlayers&&!window._ocrLHooked){
    window._ocrLHooked=true;
    var orig=window.loadJoinedPlayers;
    window.loadJoinedPlayers=function(){
      var r=orig.apply(this,arguments);
      setTimeout(function(){_lBtn=false;addLobbyBtn();_updateVerifiedCounter();},1000);
      return r;
    };
  }
  if(_tries>300)clearInterval(_poll);
},500);

window._FFREOCR={runResult:runResult,runLobby:runLobby,parseResultV25:parseResultV25,parseResult:parseResult};
})();
