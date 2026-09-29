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
      /* v3.0: naye contrast-robust modes (scene/theme change se bachne ke liye) */
      if(invert==='otsu' || invert==='norm'){
        var gpx = (invert==='norm') ? (function(){
          var gid=ctx.getImageData(0,0,W,H), g2=gid.data, gi;
          for(gi=0;gi<g2.length;gi+=4){ var gg=0.299*g2[gi]+0.587*g2[gi+1]+0.114*g2[gi+2]; g2[gi]=g2[gi+1]=g2[gi+2]=Math.max(0,Math.min(255,((gg-128)*2.0)+128)); }
          ctx.putImageData(gid,0,0);
          return ctx.getImageData(0,0,W,H).data;
        })() : px;
        _applyFilter(gpx, W, H, invert, false, false);
        var gid2=ctx.getImageData(0,0,W,H); gid2.data.set(gpx); ctx.putImageData(gid2,0,0);
      } else {
        ctx.putImageData(id,0,0);
      }
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
function norm(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu,'');}
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
  /* v4.4 FIX: containment rule sirf tab jab chhota naam kam se kam 3 akshar ka ho —
     warna junk candidate ('oo' vs 'Noob') ko 86 mil jata tha aur galat player
     bhara jata tha (ek row kam wale panel par real test me pakda gaya). */
  if((na.includes(nb)||nb.includes(na)) && Math.min(na.length,nb.length)>=3)
    return Math.max(0,88-Math.abs(na.length-nb.length));
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
var _WL_NAME='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_ .@#$%&*()!?-';
var _WL_DIGITS='0123456789';
async function ocrWords(blob, psm, wl){
  var worker = await _getOCRWorker();
  /* v3.0: region-specific whitelist -- digits = sirf 0-9 (junk khatam),
     naam = kam punctuation -- Tesseract ka search-space chhota = accurate. */
  var use = wl || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.,!?@#$%&*()-+=|;:' ";
  try { await worker.setParameters({ tessedit_char_whitelist: use, preserve_interword_spaces: '1', tessedit_pageseg_mode: String(psm||6) }); } catch(e) {}
  var out = await worker.recognize(blob, {}, { blocks: true });
  var lines = [];
  function walkLine(l){
    if (!l) return;
    var tx = (l.text || '').trim(); if (!tx) return;
    lines.push({ text: tx, conf: (typeof l.confidence==='number'? l.confidence : null), y: l.bbox ? (l.bbox.y0 + l.bbox.y1) / 2 : null,
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
/* == v3.0 ADVANCED IMAGE FILTERS (contrast-robust) ==
   Game screenshots me brightness/contrast har match me badalta hai (day/night
   map, effects, glow). Isliye fixed threshold par bharosa nahi -- 4 filters,
   aur output par ENSEMBLE VOTING:
     thr<number> : global min-channel threshold (bright text)
     'ada'       : Bradley adaptive local-mean (glow/shadow ke liye)
     'otsu'      : per-crop Otsu (contrast badle to bhi text/background ka
                   best split khud dhoondta hai)
     'norm'      : percentile contrast-stretch (p2->0, p98->255) -- binarize
                   nahi, sirf contrast normalize
   plus optional unsharp (sharpen) patle stroke ke liye. */
function _unsharp(px, w, h){
  if(w<3||h<3) return;
  var n=w*h, src=new Uint8Array(n), i;
  for(i=0;i<n;i++) src[i]=Math.min(px[i*4],px[i*4+1],px[i*4+2]);
  for(var y=1;y<h-1;y++){
    for(var x=1;x<w-1;x++){
      var k=y*w+x, c=src[k];
      var lap=5*c - src[k-w] - src[k+w] - src[k-1] - src[k+1];
      var v=lap<0?0:(lap>255?255:lap);
      var out2=Math.round(c*0.45 + v*0.55);
      var idx=k*4; px[idx]=px[idx+1]=px[idx+2]=out2;
    }
  }
}
function _normStretch(px, w, h){
  var n=w*h, i, vals=new Uint8Array(n);
  for(i=0;i<n;i++) vals[i]=Math.min(px[i*4],px[i*4+1],px[i*4+2]);
  var hist=new Int32Array(256);
  for(i=0;i<n;i++) hist[vals[i]]++;
  var lo=0, hi=255, acc=0, tgt=Math.max(1,Math.round(n*0.02));
  for(i=0;i<256;i++){ acc+=hist[i]; if(acc>=tgt){ lo=i; break; } }
  acc=0;
  for(i=255;i>=0;i--){ acc+=hist[i]; if(acc>=tgt){ hi=i; break; } }
  if(hi<=lo) hi=lo+1;
  var m=255/(hi-lo);
  for(i=0;i<n;i++){
    var v=(vals[i]-lo)*m; v=v<0?0:(v>255?255:v);
    px[i*4]=px[i*4+1]=px[i*4+2]=v;
  }
}
function _otsuBinary(px, w, h, inv){
  var n=w*h, i, hist=new Int32Array(256);
  for(i=0;i<n;i++) hist[Math.min(px[i*4],px[i*4+1],px[i*4+2])]++;
  var total=n, sum=0; for(i=0;i<256;i++) sum+=i*hist[i];
  var sumB=0, wB=0, best=0, thr=128;
  for(i=0;i<256;i++){
    wB+=hist[i]; if(!wB) continue;
    var wF=total-wB; if(!wF) break;
    sumB+=i*hist[i];
    var mB=sumB/wB, mF=(sum-sumB)/wF, between=wB*wF*(mB-mF)*(mB-mF);
    if(between>best){ best=between; thr=i; }
  }
  for(i=0;i<n;i++){
    var idx=i*4;
    var on=(Math.min(px[idx],px[idx+1],px[idx+2])>thr);
    if(inv) on=!on;
    px[idx]=px[idx+1]=px[idx+2]=on?255:0; px[idx+3]=255;
  }
}
/* ek hi jagah saare filters (strip + composite + full-image sab isi ko use karte hain) */
function _applyFilter(px, w, h, thr, inv, sharp){
  if(sharp) _unsharp(px, w, h);
  if(thr==='ada'){ _adaBinary(px, w, h, 10, !!inv); return; }
  if(thr==='otsu'){ _otsuBinary(px, w, h, !!inv); return; }
  if(thr==='norm'){ _normStretch(px, w, h); return; }
  var T = (typeof thr==='number') ? thr : 145;
  for(var i=0;i<px.length;i+=4){
    var r=px[i],g=px[i+1],b=px[i+2];
    var on=(Math.min(r,g,b)>=T);
    if(inv) on=!on;
    px[i]=px[i+1]=px[i+2]=on?255:0; px[i+3]=255;
  }
}
function _stripBlob(im, x0, y0, x1, y1, thr, inv, opts){
  var W=im.naturalWidth||im.width, H=im.naturalHeight||im.height;
  x0=Math.max(0,Math.round(x0)); y0=Math.max(0,Math.round(y0));
  x1=Math.min(W,Math.round(x1)); y1=Math.min(H,Math.round(y1));
  var cw=x1-x0, ch=y1-y0;
  if(cw<20||ch<8) return Promise.resolve(null);
  var tgt = (opts && opts.targetW) ? opts.targetW : 700;
  var s=Math.max(1,Math.min(8, tgt/cw));
  var cv=document.createElement('canvas'); cv.width=Math.round(cw*s); cv.height=Math.round(ch*s);
  var ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(im, x0,y0,cw,ch, 0,0, cv.width, cv.height);
  var id=ctx.getImageData(0,0,cv.width,cv.height), px=id.data;
  /* v3.0: saare filters ek jagah (contrast-robust) + optional sharpen */
  _applyFilter(px, cv.width, cv.height, thr, inv, !!(opts && opts.sharp));
  ctx.putImageData(id,0,0);
  return new Promise(function(res){cv.toBlob(function(bl){res(bl);},'image/png');});}
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
      var bl = await (_stripBlob(im, x0 + offs[i], y0, x1 + offs[i], y1, thr, inv, {sharp:true}));
      if (!bl) continue;
      var pass = await (ocrWords(bl, 10, _WL_DIGITS));
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
/* == v3.0 COMPOSITE COLUMN ENSEMBLE =====================================
   Idea: per-row alag-alag OCR karne ke bajaye, saari rows ki ek-ek "cell"
   (jaise sirf K column ke digits, ya sirf naam plates) ko ek composite image
   me vertically stack karo -> Tesseract ek hi pass me poori column padhta hai
   (zyada context, kam noise), aur hum 4 filters par votes lete hain.
   Fayda: (a) zyada accurate (ensemble), (b) tez (per-row 5 reads ki jagah
   1 composite pass), (c) contrast-change par robust (Otsu/ada/norm variants). */
function _composeCells(im, cells, targetH){
  var cw=0, ch=0;
  cells.forEach(function(c){ cw=Math.max(cw, c.x1-c.x0); ch=Math.max(ch, c.y1-c.y0); });
  if(!cw||!ch) return null;
  var s=Math.max(1, Math.min(8, Math.min(900/Math.max(cw,1), (targetH||120)/Math.max(ch,1))));
  var cwS=Math.round(cw*s), chS=Math.round(ch*s);
  var gap=Math.max(10, Math.round(chS*0.65));
  var W2=cwS+8, H2=gap + cells.length*(chS+gap);
  var cv=document.createElement('canvas'); cv.width=W2; cv.height=H2;
  var ctx=cv.getContext('2d');
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W2,H2);
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  var map=[], y=gap;
  cells.forEach(function(c){
    var w0=Math.max(1,c.x1-c.x0), h0=Math.max(1,c.y1-c.y0);
    ctx.drawImage(im, Math.max(0,c.x0), Math.max(0,c.y0), w0, h0, 4, y, Math.round(w0*s), Math.round(h0*s));
    map.push({idx:c.idx, cy:y+Math.round(h0*s/2), h:Math.round(h0*s)});
    y += chS + gap;
  });
  return {cv:cv, map:map, W:W2, H:H2, s:s, gap:gap};
}
/* v3.0e: COLUMN CONSENSUS — FF result screen ka table-grid fixed hota hai.
   Kuch rows ka x-anchor (pehla word / kills-word) naam ya avatar ke upar gir
   jata hai (Spiri / Hardik / ANSHU wali rows) — us strip me naam ki digits
   ('69' -> '63') aa jati thi aur galat kills fill hote the. Majority rows ka
   common x-window nikaal kar, deviating rows ke liye wahi window strict
   re-read me use hota hai (2-of-3 clean reads chahiye, warna chhod dete hain). */
function _consensusBox(cells, Wo){
  /* majority rows ka common x-window (table grid) -> {x0,x1} | null */
  /* v3.0l: 4-row screenshots (588x258 jaisi chhoti images) ke liye bhi chale —
     pehle cells<5 par null return hota tha, isliye stage 2b wahan chalti hi nahi thi */
  if(!cells || cells.length<3 || !Wo) return null;
  var xs=cells.map(function(c){return (c.x0+c.x1)/2;}).sort(function(a,b){return a-b;});
  var med=xs[Math.floor(xs.length/2)];
  var tol=Math.max(0.030*Wo, 14);
  var near=cells.filter(function(c){return Math.abs((c.x0+c.x1)/2-med)<=tol;});
  /* chhoti images (4 rows) me 3-cluster kaafi hai; bade tables me 4 chahiye */
  var need = Math.ceil(cells.length*0.6);
  need = (cells.length>=6) ? Math.max(4, need) : Math.max(3, need);
  if(near.length < need) return null;
  var cx0=0,cx1=0;
  near.forEach(function(c){cx0+=c.x0;cx1+=c.x1;});
  return {x0:cx0/near.length, x1:cx1/near.length, tol:tol, n:near.length};
}
function _consensusWindow(cells, Wo){
  var out={}, cb=_consensusBox(cells, Wo);
  if(!cb) return out;
  cells.forEach(function(c){
    /* row ka x-window consensus se door hai -> is row ko consensus window
       bhi dena hai (deviating index -> box) */
    if(Math.abs((c.x0+c.x1)/2 - (cb.x0+cb.x1)/2) <= 1.1*cb.tol) return;
    out[c.idx]={x0:cb.x0, y0:c.y0, x1:cb.x1, y1:c.y1, cons:true};
  });
  return out;
}
/* v3.0f: COLUMN INK-BAND DETECTOR.
   K-column ke x-window me sirf SAFED/GREY text ko ink maan kar (min(R,G,B)
   >=145 — isse laal annotation digits, orange team-line aur glow apne aap
   bahar ho jate hain) ink-density bands nikaalte hain. Yeh bands asli digit
   rows ke exact y-position dete hain — per-row word-anchor ka bharosa khatam
   (kuch rows ka y-band digit ko kaat raha tha: '10' adha kat gaya tha). */
function _colBands(im, x0, x1, y0, y1, Ho){
  try{
    var X0=Math.max(0,Math.round(x0)), X1=Math.round(x1);
    var Y0=Math.max(0,Math.round(y0)), Y1=Math.round(y1);
    var W=X1-X0, H=Y1-Y0;
    if(W<4||H<12) return null;
    var cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    var ctx=cv.getContext('2d');
    ctx.drawImage(im, X0,Y0,W,H, 0,0,W,H);
    var d=ctx.getImageData(0,0,W,H).data;
    /* v3.0m: ink-threshold ADAPTIVE — chhoti/low-res images me digit ki stroke
       patli hoti hai aur 145 se neeche reh jati hai (bands miss ho jate the).
       Window ke brightest pixels (95th percentile) se threshold nikalte hain;
       laal annotation/orange line phir bhi bahar rehti hai kyunki unka
       min(R,G,B) kam hota hai. */
    var hist=new Array(256).fill(0), npx=W*H, i5, mn2;
    for(i5=0;i5<npx;i5++){
      mn2=Math.min(d[i5*4],d[i5*4+1],d[i5*4+2]);
      hist[mn2]++;
    }
    var acc=0, p95=0;
    for(i5=255;i5>=0;i5--){ acc+=hist[i5]; if(acc>=npx*0.02){ p95=i5; break; } }
    var inkT=Math.max(115, Math.min(200, Math.round(p95*0.62)));
    var bands=[], cur=null, x, y;
    for(y=0;y<H;y++){
      var c=0;
      for(x=0;x<W;x++){
        var i4=(y*W+x)*4;
        if(Math.min(d[i4],d[i4+1],d[i4+2])>=inkT) c++;
      }
      if(c>=2){ if(!cur) cur={y0:y,y1:y}; else cur.y1=y; }
      else if(cur && (y-cur.y1)>2){ bands.push(cur); cur=null; }
    }
    if(cur) bands.push(cur);
    var minH=Math.max(6, 0.012*Ho), maxH=0.12*Ho;
    bands=bands.filter(function(b){ var h=b.y1-b.y0+1; return h>=minH && h<=maxH; });
    return bands.map(function(b){ return {y0:Y0+b.y0, y1:Y0+b.y1+1, cy:Y0+(b.y0+b.y1)/2}; });
  }catch(e){ return null; }
}

/* v3.0f: rows ko ink-bands se match karo (greedy nearest, 1:1).
   Bands me extra entries ho sakti hain (doosre team ka 'K' header bhi isi
   column me white text hota hai) — nearest matching se phantom band apne aap
   drop ho jata hai; koi row match na ho to us row ke liye band nahi (purana
   anchor hi chalega). */
function _matchBands(rows, bands, Ho){
  if(!bands || !bands.length) return null;
  var pairs=[], cap=Math.max(0.05*Ho, 26);
  for(var i=0;i<rows.length;i++){
    if(rows[i].y==null) continue;
    for(var j=0;j<bands.length;j++){
      var d=Math.abs(rows[i].y*Ho - bands[j].cy);
      if(d<=cap) pairs.push({i:i, j:j, d:d});
    }
  }
  pairs.sort(function(a,b){ return a.d-b.d; });
  var ri={}, bj={}, out={}, n=0;
  for(var k=0;k<pairs.length;k++){
    var pp=pairs[k];
    if(ri[pp.i]||bj[pp.j]) continue;
    ri[pp.i]=1; bj[pp.j]=1; out[pp.i]=bands[pp.j]; n++;
  }
  /* v3.0m: SAFETY — matching sirf tab use karo jab HAR row ko apna band mila ho
     (1:1 complete). Low-res images me ek band miss/misplace hone par mapping ek
     row shift ho jati thi (row1 ka digit row2 ko) — us se acchi khaasi read bhi
     galat player par chali jati. Incomplete mapping par purana anchor hi chalta hai. */
  if(n !== rows.length) return null;
  return out;
}
/* v3.0i: GLYPH SHAPE VERIFIER (low-contrast ka asli ilaaj).
   Kam-contrast game screenshots me Tesseract '5'/'9', '9'/'0', '0'/'8',
   '6'/'8' ko confuse karta hai — aur galat reading par bhi HIGH conf deta hai
   (isliye sirf conf par bharosa karna kaafi nahi tha). Digit ka TOPOLOGY font
   aur size se independent hota hai, isliye candidate ko shape se verify karte
   hain:
     * digits ki ginti = ink khaancha (width/height ratio + column-gaps)
     * hole (bandar ka gap) ki jagah ->  0 = poori height ka hole,
       9/4 = upar-aadha hole, 6 = neeche-aadha hole, 8 = do hole,
       koi hole nahi = 0/6/8/9 ho hi nahi sakta (1,2,3,5,7).
   Yeh image-specific tuning nahi hai (normalized ratios hain), geometry se
   independent hai — isliye har font/scale par chalega. */
function _holeClass(hT, hB, hH, nHoles){
  if(nHoles>=2) return '8';
  if(hH>=0.55) return '0';
  if(hT<=0.34) return '94';
  if(hB>=0.60) return '68';
  return '6';
}
function _glyphShape(im, x0, y0, x1, y1){
  try{
    var cwI=Math.round(x1-x0), chI=Math.round(y1-y0);
    if(cwI<8 || chI<8) return null;
    var s=Math.max(1, Math.min(8, 260/cwI));
    var cv=document.createElement('canvas');
    cv.width=Math.max(4,Math.round(cwI*s)); cv.height=Math.max(4,Math.round(chI*s));
    var ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(im, Math.round(x0),Math.round(y0),cwI,chI, 0,0,cv.width,cv.height);
    var id=ctx.getImageData(0,0,cv.width,cv.height), d=id.data;
    _applyFilter(d, cv.width, cv.height, 110, false, false);
    var W=cv.width, H=cv.height, i, x, y, ink=new Uint8Array(W*H);
    for(i=0;i<W*H;i++) ink[i]= (d[i*4]>=128)?1:0;
    var ix0=W,ix1=-1,iy0=H,iy1=-1;
    for(y=0;y<H;y++) for(x=0;x<W;x++) if(ink[y*W+x]){ if(x<ix0)ix0=x; if(x>ix1)ix1=x; if(y<iy0)iy0=y; if(y>iy1)iy1=y; }
    if(ix1<ix0 || iy1<iy0) return null;
    var inkW=ix1-ix0+1, inkH=iy1-iy0+1;
    /* vertical projection -> digit columns (column-gap se digits alag) */
    var groups=[], cur=null, gapRun=0, maxGap=Math.max(2, Math.round(inkW*0.035));
    for(x=ix0;x<=ix1;x++){
      var c=0;
      for(y=iy0;y<=iy1;y++) if(ink[y*W+x]) c++;
      if(c>0){ if(cur==null) cur={x0:x,x1:x}; else cur.x1=x; gapRun=0; }
      else if(cur){ gapRun++; if(gapRun>maxGap){ cur.x1=x-gapRun; groups.push(cur); cur=null; } }
    }
    if(cur){ cur.x1=ix1; groups.push(cur); }
    groups=groups.filter(function(g){ return (g.x1-g.x0+1) >= Math.max(3, inkW*0.10); });
    if(groups.length<1 || groups.length>2) return null;
    var digits=[];
    for(var gi=0; gi<groups.length; gi++){
      var g=groups[gi], gw=g.x1-g.x0+1, gh=inkH, seen=new Uint8Array(gw*gh);
      var stack=[], gx, gy;
      for(gx=0;gx<gw;gx++){ stack.push(gx); stack.push(gx+(gh-1)*gw); }
      for(gy=0;gy<gh;gy++){ stack.push(gy*gw); stack.push(gy*gw+gw-1); }
      while(stack.length){
        var ii=stack.pop();
        if(ii<0 || ii>=gw*gh || seen[ii]) continue;
        var px=(g.x0+ (ii%gw)), py=(iy0 + Math.floor(ii/gw));
        if(ink[py*W+px]) { seen[ii]=1; continue; }
        seen[ii]=1;
        var cx2=ii%gw, cy2=Math.floor(ii/gw);
        if(cx2>0) stack.push(ii-1);
        if(cx2<gw-1) stack.push(ii+1);
        if(cy2>0) stack.push(ii-gw);
        if(cy2<gh-1) stack.push(ii+gw);
      }
      /* hole components (non-ink, visited nahi) */
      var hs=[];
      for(gy=0; gy<gh; gy++) for(gx=0; gx<gw; gx++){
        var i3=gy*gw+gx;
        if(seen[i3]) continue;
        var px2=g.x0+gx, py2=iy0+gy;
        if(ink[py2*W+px2]){ seen[i3]=1; continue; }
        /* naya hole component: BFS */
        var q=[i3], n=0, hx0=1e9,hx1=-1,hy0=1e9,hy1=-1;
        seen[i3]=1;
        while(q.length){
          var j=q.pop(); n++;
          var jx=j%gw, jy=Math.floor(j/gw);
          if(jx<hx0)hx0=jx; if(jx>hx1)hx1=jx; if(jy<hy0)hy0=jy; if(jy>hy1)hy1=jy;
          var nb=[[jx-1,jy],[jx+1,jy],[jx,jy-1],[jx,jy+1]];
          for(var ni=0; ni<4; ni++){
            var nx=nb[ni][0], ny=nb[ni][1];
            if(nx<0||ny<0||nx>=gw||ny>=gh) continue;
            var j2=ny*gw+nx;
            if(seen[j2]) continue;
            if(ink[(iy0+ny)*W + (g.x0+nx)]){ seen[j2]=1; continue; }
            seen[j2]=1; q.push(j2);
          }
        }
        hs.push({n:n, t:(hy0)/gh, b:(hy1)/gh, h:(hy1-hy0+1)/gh});
      }
      hs=hs.filter(function(h){ return h.n >= 0.015*gw*gh; });
      hs.sort(function(a,b){ return b.n-a.n; });
      digits.push({w:gw, h:gh, holes:hs});
    }
    return {nd:digits.length, digits:digits, inkW:inkW, inkH:inkH, aspect:inkW/Math.max(1,inkH)};
  }catch(e){ return null; }
}
function _digitAllowed(d, cls){
  if(d==='4') return true;                       /* 4 ka hole font-dependent */
  if(cls==='none') return (d!=='0' && d!=='6' && d!=='8' && d!=='9');
  if(cls==='0') return (d==='0');
  if(cls==='8') return (d==='8' || d==='0');
  if(cls==='94') return (d==='9' || d==='4');
  if(cls==='68') return (d==='6' || d==='8' || d==='0');
  if(cls==='6') return (d==='6');
  return true;
}
function _shapeOK(v, sh){
  if(!sh || v==null || v==='') return true;      /* FIX: v=0 falsy tha */
  var ds=String(v).split('');
  if(ds.length<1 || ds.length>2) return true;
  var wide = (sh.aspect >= 0.64);                /* itna chauda = 2 digits */
  if(sh.nd===ds.length){
    if(wide && ds.length===1) return false;      /* wide ink single digit nahi */
    for(var i=0;i<ds.length;i++){
      var dg=sh.digits[i]; if(!dg) continue;
      var asp=dg.w/Math.max(1,dg.h);
      if(ds[i]==='1'){
        /* v3.0k: '1' patla hota hai — 0.42+ aspect wala glyph '1' nahi ho sakta
           (img1 row1 me '1'/'7' confusion isi se resolve hui) */
        if(asp>=0.42) return false;
        continue;
      }
      if(asp<0.26) return false;                 /* itna patla sirf '1' ho sakta hai */
      var cls=dg.holes.length ? _holeClass(dg.holes[0].t, dg.holes[0].b, dg.holes[0].h, dg.holes.length) : 'none';
      if(!_digitAllowed(ds[i], cls)) return false;
    }
    return true;
  }
  /* merged groups: dono digits ek hi group me jud gaye (wide ink) */
  if(sh.nd===1 && ds.length===2 && wide){
    var g=sh.digits[0];
    var clsM=g.holes.length ? _holeClass(g.holes[0].t, g.holes[0].b, g.holes[0].h, g.holes.length) : 'none';
    if(clsM==='none') return _digitAllowed(ds[0],'none') && _digitAllowed(ds[1],'none');
    return _digitAllowed(ds[1], clsM) && _digitAllowed(ds[0],'none');
  }
  return false;
}
async function _compositeBlob(comp, thr, inv, sharp){
  var cv=document.createElement('canvas'); cv.width=comp.W; cv.height=comp.H;
  var ctx=cv.getContext('2d'); ctx.drawImage(comp.cv,0,0);
  var id=ctx.getImageData(0,0,comp.W,comp.H);
  _applyFilter(id.data, comp.W, comp.H, thr, inv, !!sharp);
  ctx.putImageData(id,0,0);
  return await new Promise(function(r){cv.toBlob(function(b){r(b);},'image/png');});
}
/* composite par kai filter-variants -> per-cell weighted votes
   pick(lineText, conf) -> value | null */
async function _colEnsemble(comp, variants, psm, wl, pick){
  var votes={};
  for(var v=0; v<variants.length; v++){
    var vr=variants[v];
    try{
      var blob=await _compositeBlob(comp, vr.thr, vr.inv, vr.sharp);
      if(!blob) continue;
      var pass=await ocrWords(blob, psm, wl);
      for(var li=0; li<pass.lines.length; li++){
        var ln=pass.lines[li];
        if(ln.y==null) continue;
        var bestI=-1, bestD=1e9;
        for(var mi=0; mi<comp.map.length; mi++){
          var d=Math.abs(ln.y-comp.map[mi].cy);
          if(d<bestD){ bestD=d; bestI=mi; }
        }
        if(bestI<0 || bestD > comp.map[bestI].h*0.8) continue;
        var val=pick(ln.text, ln.conf);
        if(val==null) continue;
        var idx=comp.map[bestI].idx;
        var bag=votes[idx]||(votes[idx]={});
        /* weight = variant weight x Tesseract line-confidence (60+ par bonus) */
        var cw2=(typeof ln.conf==='number')? ln.conf : 70;
        var w=(vr.w||1) * (0.7 + Math.max(0, Math.min(0.6, (cw2-50)/100)));
        bag[val]=(bag[val]||0)+w;
      }
    }catch(e){}
  }
  return votes;
}
function _voteWinner(bag, minW){
  if(!bag) return null;
  var best=null, bestW=0, second=0;
  Object.keys(bag).forEach(function(k){
    var w=bag[k];
    if(w>bestW){ second=bestW; bestW=w; best=k; }
    else if(w>second){ second=w; }
  });
  if(best==null || bestW < (minW||2)) return null;
  if(second>0 && bestW < second*1.35) return null;   /* ambiguous -> chhod do */
  return best;
}
async function _numStrips(im, rows, Wo, Ho, scale){
  if(!im||!Wo||!Ho||!rows.length) return;
  scale = scale || 1;
  var off = Math.max(3, Math.round(0.004 * Wo));
  var cells=[];
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(r.y==null) continue;
    var yc = r.y * Ho;
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
    r._kbox = {x0:x0-off, y0:y0, x1:x1+off, y1:y1};
    cells.push({idx:i, x0:x0-off, y0:y0, x1:x1+off, y1:y1});
  }
  if(!cells.length) return;
  var _cons = _consensusWindow(cells, Wo);
  Object.keys(_cons).forEach(function(k){ if(rows[k]) rows[k]._cons=_cons[k]; });
  /* (1) composite digits pass — saari K-cells ek image me, 4 filters par vote */
  try{
    var comp = _composeCells(im, cells, 220);   /* v3.0b: 120->220 (2x -> ~5x upscale) */
    if(comp){
      var variants=[{thr:110,w:1.5},{thr:140,w:1.2},{thr:'otsu',w:1.3},{thr:'ada',w:1.1}];
      var votes = await _colEnsemble(comp, variants, 6, _WL_DIGITS, function(t){
        var d=String(t||'').replace(/[^0-9]/g,'');
        if(!d) return null;
        var v=parseInt(d,10);
        return (isNaN(v)||v<0||v>99)?null:v;
      });
      Object.keys(votes).forEach(function(k){
        var bag=votes[k], rr=rows[k];
        if(!bag||!rr) return;
        /* v3.0b: full-row parser ka value bhi ek ballot hai — kai baar parser
           ne '17' theek padha tha jabki digit-strip ka thin '1' gum ho gaya
           ('7'). Suffix-loss detect hone par parser value jeet jati hai. */
        if(rr.kills!=null) bag[String(rr.kills)]=(bag[String(rr.kills)]||0)+1.3;
        var w=_voteWinner(bag, 2.0);
        if(w==null) return;
        var wv=parseInt(w,10);
        var pv=rr.kills;
        if(pv!=null && wv!==pv && String(pv).length>String(wv).length && String(pv).slice(-String(wv).length)===String(wv)){
          wv=pv;   /* strip ne digit khoya (17->7) — parser wala rakho */
        }
        rr.kills=wv; rr._numDone=true;
      });
    }
  }catch(e){}
  /* (2) fallback: jinko composite se value nahi mili — per-row sharpened reads */
  var offs=[-off, 0, off];
  for(var j=0;j<rows.length;j++){
    var r2=rows[j];
    if(r2._numDone || !r2._kbox) continue;
    var b=r2._kbox, v=null;
    try{ v=_pickVote(await _digitVote(im, b.x0, b.y0, b.x1, b.y1, 110, offs)); }catch(e){}
    if(v==null){ try{ v=_pickVote(await _digitVote(im, b.x0, b.y0, b.x1, b.y1, 'otsu', offs)); }catch(e){} }
    if(v==null){ try{ v=_pickVote(await _digitVote(im, b.x0, b.y0, b.x1, b.y1, 140, offs)); }catch(e){} }
    if(v!=null) r2.kills=v;
  }
  /* (2b) v3.0f: GRID RE-READ (consensus x-window + ink-bands).
     Majority rows ka common column-x, aur K-column ki white-ink bands se asli
     digit rows. Phir har row ke liye 4 filters par reads; winner sirf tab
     badalta hai jab max-conf >= 70 ho aur runner-up se >= 20 ka gap ho
     (kamzor/ambiguous reads par purana value hi rehta hai). */
  var _cb = _consensusBox(cells, Wo);
  if(_cb){
    var ymin=1e9, ymax=-1e9;
    rows.forEach(function(r){ if(r.y!=null){ ymin=Math.min(ymin,r.y*Ho); ymax=Math.max(ymax,r.y*Ho); } });
    if(ymax>ymin){
      var bands=_colBands(im, _cb.x0, _cb.x1, ymin-0.05*Ho, ymax+0.14*Ho, Ho);
      var bpad=Math.max(2, 0.005*Ho);
      var bmap=_matchBands(rows, bands, Ho);
      var ybox=null;
      if(bmap){ ybox={}; Object.keys(bmap).forEach(function(kk){ ybox[kk]={y0:bmap[kk].y0-bpad, y1:bmap[kk].y1+bpad}; }); }
      /* v3.0i: sirf white-on-black nahi — FF screens white-on-dark hote hain,
         aur Tesseract dark-on-light par train hua hai, isliye INVERTED
         variants bhi ballot me (ada/inverted ne kai rows 80-90 conf diya). */
      var gtries=[{thr:110},{thr:110,sh:true},{thr:140},{thr:140,sh:true},
                   {thr:'otsu'},{thr:'otsu',inv:true},{thr:'ada'},{thr:'ada',inv:true}];
      for(var q2=0;q2<rows.length;q2++){
        var r4=rows[q2];
        var yb = (ybox && ybox[q2]) ? ybox[q2] : (r4._cons ? {y0:r4._cons.y0, y1:r4._cons.y1} : null);
        if(!yb) continue;
        var kdev = r4._kbox ? (Math.abs((r4._kbox.x0+r4._kbox.x1)/2-(_cb.x0+_cb.x1)/2) > 1.1*_cb.tol) : true;
        var xb = (r4._cons || kdev || ybox) ? {x0:_cb.x0,x1:_cb.x1} : {x0:r4._kbox.x0,x1:r4._kbox.x1};
        var rrd=[];
        for(var z2=0;z2<gtries.length;z2++){
          try{
            var bl2=await _stripBlob(im, xb.x0, yb.y0, xb.x1, yb.y1, gtries[z2].thr, !!gtries[z2].inv, {sharp:!!gtries[z2].sh, targetW:520});
            if(!bl2) continue;
            var pc2=await ocrWords(bl2, 7, _WL_DIGITS);
            var tx2=(pc2.lines[0]&&pc2.lines[0].text)||'';
            var mm2=tx2.match(/\d{1,2}/);
            if(!mm2) continue;
            rrd.push({v:parseInt(mm2[0],10), c:Math.round(pc2.conf||0)});
          }catch(e2){}
        }
        if(rrd.length<2) continue;
        /* per-value max conf -> top-2 VALUES compare (same value ke multiple
           reads runner-up nahi hain — pehle wahi bug tha) */
        var bv={};
        rrd.forEach(function(x2){ bv[x2.v]=Math.max(bv[x2.v]==null?-1:bv[x2.v], x2.c); });
        var vlist=Object.keys(bv).map(function(kk){ return {v:parseInt(kk,10), c:bv[kk]}; })
                        .sort(function(a,b){ return b.c-a.c; });
        if(!vlist.length) continue;
        var bestV=null, topv=vlist[0], secondC=(vlist.length>1)?vlist[1].c:-1;
        /* shape (topology) verdict — low-contrast par yahi decisive hota hai */
        var sh=null;
        try{ sh=_glyphShape(im, xb.x0, yb.y0, xb.x1, yb.y1); }catch(e3){}
        if(sh){
          var cons=vlist.filter(function(z3){ return _shapeOK(z3.v, sh); });
          if(cons.length){
            var c1=cons[0], c2=(cons.length>1)?cons[1].c:-1;
            if(c1.c>=45 && (c2<0 || (c1.c-c2)>=12)) bestV=c1.v;      /* shape-verified */
            else if(topv.c>=70 && (secondC<0 || (topv.c-secondC)>=15)) bestV=topv.v;
          } else if(topv.c>=70 && (secondC<0 || (topv.c-secondC)>=15)) bestV=topv.v;
        } else if(topv.c>=70 && (secondC<0 || (topv.c-secondC)>=15)) bestV=topv.v;
        if(bestV==null) continue;
        r4.kills=bestV; r4._numDone=true; r4._colFixed=true;
      }
    }
  }
}
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
  if(!im||!Wo||!Ho||!rows.length) return;
  scale = scale || 1;
  var cells=[];
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(r.y==null) continue;
    var ax = (killsXo != null) ? killsXo : ((r.fx != null && r.fx > 0) ? (r.fx / scale) : null);
    if (!ax) continue;
    var yc=r.y*Ho;
    /* v3.0c: PEHLE tight word-box (full pass me jo naam ke words mile unka exact
       bbox) — isse avatar/subtitle/glow sab crop se bahar rehta hai. Warna
       purana ax-window wala box (patla band 0.031). */
    var box = null;
    if (r.nbx0 != null && r.nbx1 != null && r.nby0 != null && r.nby1 != null) {
      box = { x0: r.nbx0/scale - 0.010*Wo, y0: r.nby0/scale - 0.014*Ho,
              x1: r.nbx1/scale + 0.010*Wo, y1: r.nby1/scale + 0.014*Ho };
      var bw=(box.x1-box.x0), bh=(box.y1-box.y0);
      if (bw < 0.05*Wo || bh < 0.018*Ho || bh > 0.085*Ho || box.x1 > ax) box = null;  /* sanity */
    }
    if (!box) box={x0:ax-0.205*Wo, y0:yc-0.031*Ho, x1:ax-0.070*Wo, y1:yc+0.031*Ho};
    r._nbox=box; r._ax=ax;
    cells.push({idx:i, x0:box.x0, y0:box.y0, x1:box.x1, y1:box.y1});
  }
  if(!cells.length) return;
  var bagAll={};
  /* (1) composite naam pass — saari name-plates ek image me (psm 6), 4 filters */
  try{
    var comp=_composeCells(im, cells, 200);   /* v3.0b: 110->200 (2x -> ~4x upscale) */
    if(comp){
      var variants=[{thr:140,w:1.2},{thr:115,w:1},{thr:'otsu',w:1.3},{thr:'ada',w:1.1}];
      var votes=await _colEnsemble(comp, variants, 6, _WL_NAME, function(t){
        var c=_cleanName(t);
        return (_nameLikeScore(c)>-50)?c:null;
      });
      Object.keys(votes).forEach(function(k){ bagAll[k]=votes[k]; });
    }
  }catch(e){}
  /* (2) per-row sharpened extra reads — sirf jinki composite candidate kamzor hai */
  for(var j=0;j<rows.length;j++){
    var r2=rows[j];
    if(!r2._ax || !r2._nbox) continue;
    var bag=bagAll[j]||{};
    var top=null, tw=0;
    Object.keys(bag).forEach(function(t){ if(bag[t]>tw){tw=bag[t]; top=t;} });
    var b=r2._nbox;
    /* v3.0b: composite ke upar per-row reads HAMESHA (2 reads) — thr140
       historically best raha, otsu+sharp contrast-change ke liye. */
    var extras=[{thr:140},{thr:'otsu',sharp:true}];
    for(var e=0;e<extras.length;e++){
      try{
        var bl=await _stripBlob(im, b.x0,b.y0,b.x1,b.y1, extras[e].thr, false, {sharp:!!extras[e].sharp, targetW:700});
        if(!bl) continue;
        var pass=await ocrWords(bl, 7, _WL_NAME);
        var tx=_cleanName((pass.lines[0]&&pass.lines[0].text)||'');
        if(_nameLikeScore(tx)>-50){ bag[tx]=(bag[tx]||0)+1; }
      }catch(err){}
    }
    bagAll[j]=bag;
  }
  /* (3) final candidates: weight + naam-jaisa score */
  for(var k=0;k<rows.length;k++){
    var bag2=bagAll[k];
    if(!bag2) continue;
    var list=Object.keys(bag2).filter(function(t){ return _nameLikeScore(t)>-50; });
    list.sort(function(a,b){
      var sa=_nameLikeScore(a)+bag2[a]*0.9, sb=_nameLikeScore(b)+bag2[b]*0.9;
      return sb-sa;
    });
    if(list[0]) rows[k].name2=list[0];
    if(list[1]) rows[k].name3=list[1];
    if(list[2]) rows[k].name4=list[2];
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
    /* v3.0d: DOOSRE TEAM ka header row ('K D A DMG') OCR me 'K 0 A OMG' jaisa
       aa jata hai — usme 2 se zyada header-jaise letter-token hote hain aur
       sirf 1-2 numbers. Aisa row asli player row nahi hai; isse drop na karne
       par neeche ki saari rows ka index/rank ek se shift ho jata tha (naam
       galat row me, kills galat player ko). */
    var hdrLike = w2.filter(function (w) { return /^(K|D|A|DMG|OMG|KILLS|REVIVAL|SURVIVAL|TIME)$/i.test(w.t); }).length;
    if (hdrLike >= 2 && nums.length <= 2) return;
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
    var leftWords = w2.filter(function (w) {
      return kw ? (w.x1 < kw.x0 - W * 0.004) : (w.x < W * 0.42);
    }).filter(function (w) { return !/^(NAME|K|A|D|DMG|KILLS)$/i.test(w.t); });
    var left = leftWords.map(function (w) { return w.t; }).join(' ');
    /* v3.0c: naam ke words ka TIGHT bbox (scaled space) — isse naam crop bilkul
       exact hota hai (avatar/subtitle/glow sab bahar), naam padhne ka sabse bada
       accuracy lever. */
    var nb = null;
    if (leftWords.length) {
      var nx0=1e9, nx1=-1e9, ny0=1e9, ny1=-1e9;
      leftWords.forEach(function (w) {
        nx0=Math.min(nx0,w.x0); nx1=Math.max(nx1,w.x1);
        ny0=Math.min(ny0,(w.y - (w.h||0)/2)); ny1=Math.max(ny1,(w.y + (w.h||0)/2));
      });
      if (nx1>nx0 && ny1>ny0) nb={x0:nx0,x1:nx1,y0:ny0,y1:ny1};
    }
    var hasDmg = nums.some(function (n) { return n.v >= 100 && n.v <= 99999; });
    /* v2.5g: pre-filter ab sirf bilkul khaali junk hataata hai — asli validity
       naam-strip ke BAAD decide hoti hai (naam + numbers dono chahiye). */
    if (!nums.length) return;
    var fromCol = (killsX != null) ? nums.some(function (n) { return Math.abs(n.w.x - killsX) <= tol && n.v === kills; })
                                   : (fx != null && nums.some(function (n) { return n.v === kills && n.w.x === fx; }));
    rows.push({ kills: kills, y: Number((ln2.y / H).toFixed(3)), name: _cleanName(left), raw: ln2.text.slice(0, 80),
                nums: nums.length, hasDmg: hasDmg, fromCol: fromCol, fx: fx,
                kwx0: kw ? kw.x0 : null, kwx1: kw ? kw.x1 : null, kwy: kw ? kw.y : null, kwh: kw ? kw.h : null,
                nbx0: nb ? nb.x0 : null, nbx1: nb ? nb.x1 : null, nby0: nb ? nb.y0 : null, nby1: nb ? nb.y1 : null });
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
  /* v3.0: small images ka scale 4200px canvas banata tha (OCR 20s+/mode);
     ab 3000px target (~5x) — speed + accuracy ka balance. */
  var sc = small ? Math.max(2.5, Math.min(8, 3000 / Math.max(dims.w || 1, 1))) : 0;   /* 0 = default */
  /* v3.0: 'otsu' (contrast-adaptive threshold) add — game scene ka contrast
     badalne par fixed thresholds fail hote hain, Otsu khud split dhoondta hai. */
  var modes = [['white', 0], ['maxch', 0], ['soft', 0], ['otsu', 0]];
  if (small) modes = [['maxch', 0], ['soft', 0], ['otsu', 0]];
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
/* Uncertain identities need an explicit admin decision, never positional guessing. */
function _eliminationReview(all,tbl,plans){
  var prior=document.getElementById('_ocrEliminationReview');if(prior)prior.remove();
  if(!all.some(function(r){return r.elimination;}))return;
  var host=document.getElementById('mrSsPreview');if(!host)return;
  var box=document.createElement('div');box.id='_ocrEliminationReview';
  box.style.cssText='padding:14px;margin-top:12px;border:1px solid #e2aa35;border-radius:10px;background:#151b29;color:#fff';
  var title=document.createElement('strong');title.textContent='BR result review — verify screenshot before applying';box.appendChild(title);
  var note=document.createElement('p');note.textContent='Unclear name? Select the actual player. Rank badges are not assumed from row order. Enter rank only after checking the screenshot. This fills the form; it does not publish results.';box.appendChild(note);
  var entries=[];
  all.forEach(function(op,i){
    var row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0';
    var label=document.createElement('span');label.textContent='Screenshot row '+(i+1)+' · OCR: '+(op.name3||op.name||'unreadable');row.appendChild(label);
    var sel=document.createElement('select');sel.setAttribute('aria-label','Player for screenshot row '+(i+1));
    var empty=document.createElement('option');empty.value='';empty.textContent='Choose player — not verified';sel.appendChild(empty);
    tbl.forEach(function(t,j){var o=document.createElement('option');o.value=String(j);o.textContent=t.name;sel.appendChild(o);});
    var plan=plans.find(function(p){return p.op===op;});if(plan)sel.value=String(tbl.findIndex(function(t){return t.row===plan.row;}));
    var kills=document.createElement('input');kills.type='number';kills.min='0';kills.max='99';kills.placeholder='Kills';kills.setAttribute('aria-label','Kills for screenshot row '+(i+1));kills.value=op.kills==null?'':op.kills;
    var rank=document.createElement('input');rank.type='number';rank.min='1';rank.max='48';rank.placeholder='Verify rank';rank.setAttribute('aria-label','Rank for screenshot row '+(i+1));rank.value=op.explicitRank?op.rank:'';
    [sel,kills,rank].forEach(function(e){e.style.cssText='padding:8px;background:#222c40;color:white;border:1px solid #65718a;border-radius:5px;max-width:230px';row.appendChild(e);});
    entries.push({sel:sel,kills:kills,rank:rank});box.appendChild(row);
  });
  var check=document.createElement('input');check.type='checkbox';check.id='_ocrReviewConfirm';
  var cl=document.createElement('label');cl.appendChild(check);cl.appendChild(document.createTextNode(' I checked player identities, kills and any entered ranks against the screenshot.'));box.appendChild(cl);
  var msg=document.createElement('p');msg.setAttribute('role','status');
  var apply=document.createElement('button');apply.type='button';apply.id='_ocrReviewApply';apply.textContent='Apply reviewed values (no publish)';apply.style.cssText='margin:10px;padding:10px;background:#ffd052;color:#111;border:0;border-radius:6px';
  apply.onclick=function(){
    if(!check.checked){msg.textContent='Confirm the screenshot review first.';return;}
    var selected={},ranks={},todo=[],error='';
    entries.forEach(function(e){
      if(e.sel.value==='')return;
      var id=+e.sel.value,k=e.kills.value,r=e.rank.value;
      if(selected[id])error='A player is selected twice. No values applied.';selected[id]=true;
      if(!/^\d+$/.test(k)||+k>99)error='Enter valid kills (0–99). No values applied.';
      if(r!==''&&(!/^\d+$/.test(r)||+r<1||+r>48))error='Enter valid rank (1–48), or leave it blank.';
      if(r!==''&&ranks[+r])error='Duplicate ranks. No values applied.';if(r!=='')ranks[+r]=true;
      if(!tbl[id]||!tbl[id].row.isConnected||((tbl[id].row.querySelector('td:nth-child(2) div')||{}).textContent||'').trim()!==tbl[id].name)error='Roster changed. Rescan before applying.';
      todo.push({row:tbl[id]&&tbl[id].row,op:{kills:+k,rank:r===''?0:+r}});
    });
    if(error){msg.textContent=error;return;}
    if(!todo.length){msg.textContent='Select at least one player.';return;}
    todo.forEach(function(p){_fillRow(p.row,p.op,true);var ri=p.row.querySelector('.mr-rank-input');if(ri&&window.mrCalcPrize)window.mrCalcPrize(ri);});
    if(window.mrCheckDuplicateRanks)window.mrCheckDuplicateRanks();
    msg.textContent=todo.length+' reviewed player rows applied. Results have NOT been published.';
  };
  box.appendChild(apply);box.appendChild(msg);host.appendChild(box);
}

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
  var oldReview=document.getElementById('_ocrEliminationReview');if(oldReview)oldReview.remove();
  var fileArr=Array.from(files).slice(0,5);
  var b=bar('mrSsPreview','<i class="fas fa-spinner fa-spin"></i> &nbsp;Scanning...','loading');
  try{
    var all=[];
    for(var i=0;i<fileArr.length;i++){
      if(b)b.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;Image '+(i+1)+'/'+fileArr.length+' scan...';
      /* v4 (2026-09-28): table-aware engine — header row se table/columns, row bands,
         per-row cell crops + votes. Clash ke 2 table bhi handle karta hai. */
      var boxed=null;
      try{boxed=await parseEliminationList(fileArr[i]);}catch(e){}
      if(boxed && boxed.recognizedLayout && !boxed.rows.length){continue;}
      try{ if(!boxed) boxed=await parseResultV4(fileArr[i],function(p){if(b)b.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;'+(i+1)+'/'+fileArr.length+': '+p+'%';}); }catch(e){}
      if(!boxed || !boxed.rows || !boxed.rows.length){
        /* v2.5 fallback: word-box parsing (columns alag, crosses nahi) */
        try{ boxed=await parseResultV25(fileArr[i],function(p){if(b)b.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;'+(i+1)+'/'+fileArr.length+': '+p+'%';}); }catch(e){}
      }
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
    /* v3.4: single-image me rows ko kabhi drop nahi karo — warna index/order
       badal jata hai (order-prior band) aur kills galat player par jate hain.
       Multi-image me duplicate players merge hote hain (wahi naam 2 screenshot
       me), par khaali-naam row kabhi nahi hatti. */
    var _single=(fileArr.length===1);
    all=all.filter(function(p){
      var k=norm(p.name);
      if(!k) return true;
      if(!_single && seen[k]) return false;
      seen[k]=true; return true;
    });
    var tbl=[];
    rows.forEach(function(row){var el=row.querySelector('td:nth-child(2) div');if(el)tbl.push({name:el.textContent.trim(),row:row});});
    var skipped=0,lowConf=0;
    /* v3.0 GLOBAL ASSIGNMENT: pehle har OCR row ka best player nikalta hai, phir
       ek player ko sirf EK hi OCR row mil sakti hai (greedy, best score pehle).
       Pehle do OCR rows ek hi player par baith sakti thi -> dono ka data galat.
       Candidates = [full-pass naam, composite naam2/name3/name4]. */
    var scoredPairs=[];
    all.forEach(function(op, oi){
      var names=[op.name, op.name2, op.name3, op.name4].filter(function(x){ return x && x.length>=2; });
      if(!names.length){ if(rows.length===1) scoredPairs.push({oi:oi, op:op, item:rows[0], score:100, second:null, strong:true}); return; }
      var best=null;
      names.forEach(function(nm){
        var s2=_bestScore(nm,tbl);
        if(s2 && (!best || s2.score>best.score)) best=s2;
      });
      if(!best) return;
      if(op.elimination && op.kills==null && !op.explicitRank)return;
      if(op.elimination && (best.score<85 || (best.second!=null && best.score-best.second<15))) return;
      var strong = (op.fromCol === true) || (op.hasDmg === true && (op.nums || 0) >= 3);
      /* v3.0m: EXACT naam-match khud strong evidence hai — 92+ score aur 15+
         ka gap ho to kills fill karo (kills ab per-row column-geometry se
         aate hain, isliye 'strong' flag ki zaroorat nahi — par kamzor match
         par purana strict rule hi chalega). */
      if(!strong && best.score>=92 && (best.second==null || (best.score-best.second)>=15)) strong=true;
      scoredPairs.push({oi:oi, op:op, item:best.item, score:best.score, second:best.second, strong:strong});
    });
    /* v3.1 ORDER-PRIOR (2026-09-28): screenshot ke rows aur panel ke rows aksar
       SAME order me hote hain. Agar (a) OCR rows == panel rows, (b) kam se kam ek
       naam 85+ score se APNI jagah (diagonal) match karta hai, aur (c) koi bhi OCR
       row kisi DUSRI panel row se 60+ match nahi karta — to poora order verified
       maana jata hai aur jo rows naam se match nahi hui, unke kills diagonal row se
       fill ho jate hain (naam OCR junk padhe to bhi data sahi player par jata hai).
       Ulta/galat order ya kisi aur match ki image par ye rule khud band ho jata
       hai (anchor nahi milega ya conflict milega). Is mode me RANK kabhi nahi bharta. */
    var orderOK=false, oAnchors=0;
    if(!all.some(function(r){return r.noOrder;}) && all.length===rows.length && rows.length>1 && tbl.length===rows.length){
      var conflict=false, claim={};
      all.forEach(function(op,i){
        /* har candidate ko ALAG score karo (joined string se fuzzy score gir jata tha) */
        var cnd=[op.name, op.name2, op.name3, op.name4].filter(function(x){ return x && x.length>=2; });
        if(!cnd.length) return;                /* koi naam evidence nahi = neutral */
        var diag=0, other=0, bestJ=-1, bestAll=0;
        cnd.forEach(function(nm){
          tbl.forEach(function(it,j){
            var sc=fuzzyScore(nm,it.name);
            if(sc>bestAll){ bestAll=sc; bestJ=j; }
            if(j===i){ if(sc>diag) diag=sc; }
            else if(sc>other) other=sc;
          });
        });
        /* v4.3: row ka APNA best match decisive hai (junk candidate kisi dusre naam
           se match kar jaye to conflict nahi — 'oo' vs 'Noob' 86 ka false conflict) */
        if(bestAll>=62){
          if(bestJ!==i) conflict=true;                     /* row kisi DUSRE player par baith rahi hai */
          if(claim[bestJ]!=null) conflict=true;            /* do rows ek hi player claim kar rahi hain */
          claim[bestJ]=i;
        }
        if(diag>=80 || (diag>=65 && diag>=other+15)) oAnchors++;
      });
      orderOK=((oAnchors>=2 || (rows.length<=2 && oAnchors>=1)) && !conflict);
    }
    scoredPairs.sort(function(a,b){ return b.score-a.score; });
    var usedOp={}, usedRow=[], plans=[];
    scoredPairs.forEach(function(p){
      if(usedOp[p.oi]) return;
      if(p.score<72){ skipped++; usedOp[p.oi]='skip'; return; }
      if(p.second!=null && (p.score-p.second)<8){ skipped++; usedOp[p.oi]='skip'; return; }
      if(!p.strong){ lowConf++; usedOp[p.oi]='skip'; return; }
      if(usedRow.indexOf(p.item.row)>=0){ skipped++; usedOp[p.oi]=1; return; }  /* player already le liya */
      usedOp[p.oi]=1; usedRow.push(p.item.row);
      plans.push({row:p.item.row, op:p.op});
    });
    if(orderOK){
      all.forEach(function(op,i){
        if(usedOp[i]===1) return;                 /* 'skip' = naam se reject hui, order-prior le sakta hai */
        var item=tbl[i]; if(!item || usedRow.indexOf(item.row)>=0) return;
        if(op.kills==null || op.kills<0) return;   /* kills read hui tabhi fill */
        usedOp[i]=1; usedRow.push(item.row); op.__idxScan=true;
        plans.push({row:item.row, op:op, idx:true});
      });
    }
    /* ✅ SAFETY (2026-09-27): rank OCR row-ORDER par depend karta hai. Rank sirf
       tab bharo jab HAR panel row match ho gayi ho (complete 1:1 mapping) —
       warna order shift ho sakta hai aur rank ghalat fill hoga (galat prize).
       Kills per-player independent hain, wo har matched row me safe hain. */
    var _anyIdx=plans.some(function(p){ return p.idx===true; });
    var fillRank = (plans.length >= rows.length) && !_anyIdx;
    plans.forEach(function(p){ _fillRow(p.row,p.op,fillRank || p.op.explicitRank===true); });
    var filled = plans.length;
    if(window.mrCalcPrize)rows.forEach(function(r){var inp=r.querySelector('.mr-rank-input');if(inp)window.mrCalcPrize(inp);});
    if(window.mrCheckDuplicateRanks)window.mrCheckDuplicateRanks();
    var msg=(filled?'✅ Done! <b>':'⚠️ No verified matches — <b>')+filled+'/'+rows.length+' players</b> auto-filled';
    if(skipped>0)msg+=' <span style="opacity:.6;font-weight:400">('+skipped+' unmatched)</span>';
    if(lowConf>0)msg+=' <span style="opacity:.6;font-weight:400">('+lowConf+' low-confidence — manually check karo)</span>';
    var _idxN=plans.filter(function(p){ return p.idx===true; }).length;
    if(_idxN>0)msg+=' <span style="opacity:.7;font-weight:400">('+_idxN+' rows order-verified — amber kills ek nazar verify kar lo)</span>';
    if(!fillRank&&filled>0)msg+=' <span style="opacity:.7;font-weight:400">— kills fill hue; rank manually verify karo (kuch rows read nahi hui)</span>';
    if(all.some(function(r){return r.elimination&&!r.explicitRank;}))msg+=' — stylized ranks need screenshot review';
    bar('mrSsPreview',msg,filled>0?'success':'warn');
    _eliminationReview(all,tbl,plans);
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
  var _kreset=(op&&op.__idxScan)?'rgba(255,193,7,.16)':'rgba(255,107,107,.08)';
  if(ki&&op.kills!=null&&op.kills>=0){ki.value=op.kills;ki.dispatchEvent(new Event('input',{bubbles:true}));_flash(ki,_kreset);}
}
function _flash(el,reset){el.style.transition='background .5s';el.style.background='rgba(0,255,156,.45)';setTimeout(function(){el.style.background=reset;},900);}


/* ═══════════════════════════════════════════════════════════════════════════
   v4 TABLE-AWARE ENGINE (2026-09-28) — "layout ko samajh kar padho"
   Kisi bhi FF result screen par kaam karta hai:
     1) poore image ka OCR -> header row dhoondo (RATING/NAME/K/D/A/DMG/REVIVAL...)
     2) header se TABLE + column boundaries nikalo (2 table = clash 4v4 bhi)
     3) K column me bright-text profile se ROW bands (avatar/text anchor) + pitch
     4) har row ka K/K-D-A cell tight crop -> 5-6 filter variants -> weighted vote
     5) K/D/A group me sirf pehla digit (K) alag crop karke sub-cell verdict
     6) naam ka cell -> top line = naam, neeche = clan (candidates)
   Sab kuch image se derive hota hai — koi fixed pixel layout nahi.
   ═══════════════════════════════════════════════════════════════════════════ */
function _v4Kind(t){
  var s=String(t||'').toUpperCase().replace(/[^A-Z0-9\/]/g,'');
  if(!s) return null;
  if(s==='RATING'||s==='RATINGS'||s==='RT') return 'rating';
  if(s==='NAME'||s==='NAMES'||s==='PLAYER'||s==='PLAYERS'||s==='IGN') return 'name';
  if(s==='K'||s==='KILLS'||s==='KILL'||s==='KO') return 'k';
  if(/^K.{0,2}D.{0,2}A$/.test(s)||s==='KDA'||s==='KDJA'||s==='K/D/A') return 'kda';
  if(s==='A'||s==='ASSIST'||s==='ASSISTS'||s==='AST') return 'a';
  if(s==='D'||s==='DEATH'||s==='DEATHS') return 'd';
  if(s==='DMG'||s==='DAMAGE'||s==='DMGS') return 'dmg';
  if(s.indexOf('REVIV')===0) return 'rev';
  if(s.indexOf('SURVIV')===0) return 'surv';
  if(s==='TIME') return 'time';
  return null;
}
/* pixel access ek hi baar */
function _imgPixels(im){
  var W=im.naturalWidth||im.width, H=im.naturalHeight||im.height;
  var cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  var g=cv.getContext('2d'); g.drawImage(im,0,0);
  return {W:W,H:H,D:g.getImageData(0,0,W,H).data};
}
/* ek row band me x-range ka "white ink" column profile (naam/ankde dhoondhne ke liye) */
function _inkRuns(px, x0, x1, y0, y1, thr){
  x0=Math.max(0,Math.round(x0)); x1=Math.min(px.W,Math.round(x1));
  y0=Math.max(0,Math.round(y0)); y1=Math.min(px.H,Math.round(y1));
  var W=px.W, D=px.D, cols=[];
  for(var x=x0;x<x1;x++){ var c=0, t0=1e9, t1=-1;
    for(var y=y0;y<y1;y++){ var i=(y*W+x)*4; var mn=Math.min(D[i],D[i+1],D[i+2]);
      if(mn>=thr){ c++; if(y<t0)t0=y; if(y>t1)t1=y; } }
    cols.push({x:x,c:c,t0:t0,t1:t1});
  }
  var runs=[], cur=null;
  cols.forEach(function(cl){
    if(cl.c>=1){
      if(cur && cl.x-cur.x1<=3){ cur.x1=cl.x; cur.n+=cl.c; if(cl.t0<cur.t0)cur.t0=cl.t0; if(cl.t1>cur.t1)cur.t1=cl.t1; }
      else { if(cur) runs.push(cur); cur={x0:cl.x,x1:cl.x,n:cl.c,t0:cl.t0,t1:cl.t1}; }
    } else if(cur && cl.x-cur.x1>0){ runs.push(cur); cur=null; }
  });
  if(cur) runs.push(cur);
  runs.forEach(function(r){ r.w=r.x1-r.x0+1; r.h=r.t1-r.t0+1; });
  return runs;
}
/* cell crop -> OCR text (ek variant) */
async function _v4Read(im, x0, y0, x1, y1, thr, inv, sharp, psm, wl, targetW){
  var bl=null;
  try{ bl=await _stripBlob(im, x0, y0, x1, y1, thr, inv, {targetW:targetW||520, sharp:!!sharp}); }catch(e){ return null; }
  if(!bl) return null;
  try{ return await ocrWords(bl, psm||7, wl); }catch(e){ return null; }
}
function _v4Text(o){ if(!o||!o.lines) return ''; return o.lines.map(function(l){return l.text;}).join(' ').trim(); }
function _v4Nums(txt){ var m=String(txt||'').match(/\d+/g); return m? m.map(function(x){return parseInt(x,10);}) : []; }
function _v4Vote(votes){
  var best=null, tot=0;
  for(var k in votes){ tot+=votes[k]; if(best==null||votes[k]>votes[best]) best=k; }
  if(best==null||!tot) return {v:null,share:0,total:0};
  return {v:parseInt(best,10), share:votes[best]/tot, total:tot};
}
/* ── main v4 parser ── */

/* v5: repeated Elimination labels are row anchors, never the phone HUD.
   Geometry is derived from detected labels/words; no screenshot-specific values. */
async function _eliminationRank(im,x0,y0,x1,y1,threshold){
  x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));
  var c=document.createElement('canvas');c.width=Math.ceil(x1-x0);c.height=Math.ceil(y1-y0);
  var ctx=c.getContext('2d');ctx.drawImage(im,x0,y0,c.width,c.height,0,0,c.width,c.height);
  var px=ctx.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height,seen=new Uint8Array(w*h),best=null;
  for(var pos=0;pos<w*h;pos++){
    if(seen[pos])continue;seen[pos]=1;
    if(Math.max(px[pos*4],px[pos*4+1],px[pos*4+2])<threshold)continue;
    var stack=[pos],pts=[],lx=w,rx=0,ly=h,ry=0;
    while(stack.length){var p=stack.pop(),x=p%w,y=Math.floor(p/w);pts.push(p);lx=Math.min(lx,x);rx=Math.max(rx,x);ly=Math.min(ly,y);ry=Math.max(ry,y);
      var ns=[];if(x>0)ns.push(p-1);if(x<w-1)ns.push(p+1);if(y>0)ns.push(p-w);if(y<h-1)ns.push(p+w);
      ns.forEach(function(n){if(!seen[n]){seen[n]=1;if(Math.max(px[n*4],px[n*4+1],px[n*4+2])>=threshold)stack.push(n);}});
    }
    if(lx<1||ly<1||rx>=w-1||ry>=h-1||ry-ly<h*.16||pts.length<10)continue;
    if(!best||pts.length>best.pts.length)best={pts:pts,lx:lx,rx:rx,ly:ly,ry:ry};
  }
  if(!best)return null;
  var out=document.createElement('canvas'),sc=6,pad=20;out.width=(best.rx-best.lx+1)*sc+pad*2;out.height=(best.ry-best.ly+1)*sc+pad*2;
  var oc=out.getContext('2d');oc.fillStyle='white';oc.fillRect(0,0,out.width,out.height);oc.fillStyle='black';
  best.pts.forEach(function(p){oc.fillRect(pad+(p%w-best.lx-.25*(best.ry-Math.floor(p/w)))*sc,pad+(Math.floor(p/w)-best.ly)*sc,sc,sc);});
  return await new Promise(function(r){out.toBlob(r,'image/png');});
}

async function _eliminationCrop(im,x0,y0,x1,y1,thr){
  var c=document.createElement('canvas'),scale=5,pad=20;
  x0=Math.max(0,Math.round(x0));y0=Math.max(0,Math.round(y0));
  x1=Math.min(im.naturalWidth||im.width,Math.round(x1));y1=Math.min(im.naturalHeight||im.height,Math.round(y1));
  c.width=(x1-x0)*scale+pad*2;c.height=(y1-y0)*scale+pad*2;
  var ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(im,x0,y0,x1-x0,y1-y0,pad,pad,c.width-pad*2,c.height-pad*2);
  var d=ctx.getImageData(pad,pad,c.width-pad*2,c.height-pad*2),px=d.data;
  for(var q=0;q<px.length;q+=4){var on=Math.max(px[q],px[q+1],px[q+2])>=thr;px[q]=px[q+1]=px[q+2]=on?0:255;}
  ctx.putImageData(d,pad,pad);return await new Promise(function(r){c.toBlob(r,'image/png');});
}
async function parseEliminationList(file){
  var im=await _loadImgFile(file); if(!im)return null;
  var W=im.naturalWidth||im.width,H=im.naturalHeight||im.height;
  var pass=await ocrWords(file,11,'');
  var anchors=[];
  pass.lines.forEach(function(l){(l.words||[]).forEach(function(w){
    if(/^eliminations?$/i.test(w.t)) anchors.push({w:w,y:l.y,line:l});
  });});
  if(anchors.length<2)return null;
  anchors.sort(function(a,b){return a.y-b.y;});
  var x=anchors[0].w.x0,h=anchors[0].w.h;
  if(anchors.some(function(a,i){return Math.abs(a.w.x0-x)>h*2 || (i&&a.y-anchors[i-1].y<h*2);}))
    return {rows:[],recognizedLayout:true,debug:{layout:'eliminations',rejected:'unaligned labels'}};
  var pitch=(anchors[anchors.length-1].y-anchors[0].y)/(anchors.length-1);
  var near=[];
  pass.lines.forEach(function(l){if(anchors.some(function(a){return Math.abs(l.y-a.y)<pitch*.30;}))
    (l.words||[]).forEach(function(w){if(w.x1<x-h*3 && w.x0>0)near.push(w);});});
  var left=near.length?Math.min.apply(null,near.map(function(w){return w.x0;})):0;
  var ranks=near.filter(function(w){return w.x0<left+h*3;});
  if(!ranks.length)return {rows:[],recognizedLayout:true,debug:{layout:'eliminations',rejected:'missing rank column'}};
  var right=Math.max.apply(null,ranks.map(function(w){return w.x1;}));
  var rows=[], mw=null;
  try {
    /* Isolated lazy multilingual worker: does not change existing English worker. */
    mw=await Tesseract.createWorker(['eng','hin','ben'],1,{
      workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js'
    });
    await mw.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'',preserve_interword_spaces:'1'});
  }catch(e){if(mw){try{await mw.terminate();}catch(ee){}}mw=null;}
  try {
    for(var i=0;i<anchors.length;i++){
      var a=anchors[i], cy=a.y, wh=Math.max(h,a.w.h), texts=[], kv={},rv={};
      for(var j=0;j<3;j++){
        var thr=[110,150,'otsu'][j];
        var kb=await _eliminationCrop(im,a.w.x0-wh*2.7,cy-wh*1.2,a.w.x0-2,cy+wh*1.2,[90,110,130][j]);
        var kp=await ocrWords(kb,7,_WL_DIGITS);
        var kt=kp.lines.map(function(l){return l.text;}).join('').trim();
        if(/^\d{1,2}$/.test(kt))kv[+kt]=(kv[+kt]||0)+1;
        var rb=await _eliminationRank(im,left-5,cy-pitch*.48,right+15,cy+pitch*.42,[140,170,200][j]);
        var rp=rb?await ocrWords(rb,10,_WL_DIGITS):{lines:[]}, rt=rp.lines.map(function(l){return l.text;}).join('').trim();
        if(/^\d{1,2}$/.test(rt)&&+rt>0&&+rt<=48)rv[+rt]=(rv[+rt]||0)+1;
        var rb2=await _stripBlob(im,left+wh*1.3,cy-pitch*.40,right+5,cy+pitch*.35,j===0?'norm':thr,j===2,{targetW:220});
        var rp2=await ocrWords(rb2,10,_WL_DIGITS),rt2=rp2.lines.map(function(l){return l.text;}).join('').trim();
        if(/^\d{1,2}$/.test(rt2)&&+rt2>0&&+rt2<=48)rv[+rt2]=(rv[+rt2]||0)+1;
        var nb=await _stripBlob(im,right+wh*2,cy-pitch*.34,a.w.x0-wh*3,cy+pitch*.34,thr,false,{targetW:1000});
        if(mw){var nr=await mw.recognize(nb);texts.push((nr.data.text||'').trim());}
        else {var np=await ocrWords(nb,7,'');texts.push(np.lines.map(function(l){return l.text;}).join(' '));}
      }
      function consensus(v){var ks=Object.keys(v).sort(function(a,b){return v[b]-v[a];});return ks.length&&v[ks[0]]>=2&&(ks.length===1||v[ks[0]]>v[ks[1]])?+ks[0]:null;}
      var k=consensus(kv),r=consensus(rv);
      rows.push({name:texts[0]||'',name2:texts[1]||'',name3:texts[2]||'',kills:k,rank:r||0,
        y:cy/H,fromCol:true,explicitRank:r!==null,elimination:true,noOrder:true});
    }
  }finally{if(mw)try{await mw.terminate();}catch(e){}}
  /* Duplicate or non-monotonic digit reads are rejected, never replaced by row order. */
  var prev=0,valid=true;rows.forEach(function(r){if(!r.rank||(prev&&r.rank!==prev+1))valid=false;prev=r.rank;});
  if(!valid)rows.forEach(function(r){r.rank=0;r.explicitRank=false;});
  return {rows:rows,recognizedLayout:true,debug:{layout:'eliminations',rows:rows.length,rankVerified:valid,multilingual:!!mw}};
}

async function parseResultV4(blob, progress){
  var im=await _loadImgFile(blob);
  if(!im) return null;
  var px=_imgPixels(im), W=px.W, H=px.H;
  if(progress) progress(8);
  var o=await ocrWords(blob, 6, '');
  if(progress) progress(28);
  var lines=(o.lines||[]);
  /* 1) header line dhoondo: sabse zyada header-words wali line */
  var bestLine=null, bestN=0;
  lines.forEach(function(ln){
    var items=[], kinds={};
    (ln.words||[]).forEach(function(w){
      var k=_v4Kind(w.t);
      if(k){ items.push({k:k, t:w.t, x0:w.x0, x1:w.x1, h:w.h}); kinds[k]=1; }
    });
    if(items.length<3) return;
    if(!kinds['name']||(!kinds['k']&&!kinds['kda'])||!kinds['dmg']) return;
    if(items.length>bestN){ bestN=items.length; bestLine={y:(ln.y==null?0:ln.y), items:items}; }
  });
  if(!bestLine) return null;
  bestLine.items.sort(function(a,b){ return a.x0-b.x0; });
  /* 2) tables: header tokens ko x-gap se alag karo (clash = 2 table) */
  var groups=[], cur=[];
  bestLine.items.forEach(function(h){
    var haveName=false, haveKill=false;
    cur.forEach(function(c){ if(c.k==='name') haveName=true; if(c.k==='k'||c.k==='kda') haveKill=true; });
    /* v4.1: nayi table tab shuru hoti hai jab current table me naam + kills column
       already ho aur phir se RATING/NAME aaye (clash squad me 2 table hote hain).
       Bada khaali gap bhi safety ke liye split karta hai. */
    if(cur.length && (h.k==='rating'||h.k==='name') && haveName && haveKill){ groups.push(cur); cur=[]; }
    else if(cur.length && (h.x0 - cur[cur.length-1].x1) > 0.22*W){ groups.push(cur); cur=[]; }
    cur.push(h);
  });
  if(cur.length) groups.push(cur);
  var tables=[], dbg={hdrY:Math.round(bestLine.y), groups:groups.length, tables:[]};
  groups.forEach(function(grp){
    var rating=null, name=null, dmgH=null, killsH=null;
    grp.forEach(function(h){
      if(h.k==='rating') rating=h;
      if(h.k==='name') name=h;
      if(h.k==='dmg') dmgH=h;
      if((h.k==='kda'||h.k==='k') && !killsH) killsH=h;
    });
    if(!name||!killsH) return;
    var stats=grp.filter(function(h){ return ['k','kda','a','d','dmg','rev','surv','time'].indexOf(h.k)>=0; })
                  .sort(function(a,b){ return a.x0-b.x0; });
    var idx=stats.indexOf(killsH), next=stats[idx+1];
    var kx0=Math.max(0, killsH.x0-10);
    var kx1=next? (next.x0-10) : Math.min(W-1, killsH.x1+0.05*W);
    if(kx1-kx0<10) return;
    var nl = rating ? (rating.x1 + 0.040*W) : (name.x0 - 0.012*W);
    var nr = killsH.x0-10;
    if(nr-nl<40){ nl=Math.max(0, name.x0-0.02*W); nr=killsH.x0-8; }
    if(nr-nl<40 || kx1-kx0<8) return;                    /* v4.1 guard: geometry valid honi chahiye */
    var d0=null, d1=null;
    if(dmgH){
      d0=Math.max(0, dmgH.x0-10);
      var di=stats.indexOf(dmgH), nx2=stats[di+1];
      d1=nx2? (nx2.x0-8) : Math.min(W, dmgH.x1+0.06*W);
      if(d1-d0<8){ d0=null; d1=null; }
    }
    tables.push({mode:(killsH.k==='kda')?'kda':'k', kx0:kx0, kx1:kx1, nl:nl, nr:nr, dmg0:d0, dmg1:d1, khx:killsH.x0, khy:killsH.x1});
  });
  if(!tables.length) return null;
  /* 3) har table: row bands + cell reads */
  var outRows=[];
  for(var ti=0; ti<tables.length; ti++){
    var T=tables[ti];
    /* 3a) row detection: K column me bright-text profile */
    var prof=[];
    for(var y=0;y<H;y++){ var c=0;
      for(var x=Math.round(T.kx0);x<Math.round(T.kx1);x++){ var i=(y*W+x)*4; var mn=Math.min(px.D[i],px.D[i+1],px.D[i+2]);
        if(mn>=195) c++; }
      prof.push(c); }
    var bands=[], st=-1;
    for(var y2=0;y2<H;y2++){ var on=prof[y2]>=2;
      if(on&&st<0) st=y2;
      if(!on&&st>=0){ bands.push([st,y2-1]); st=-1; } }
    if(st>=0) bands.push([st,H-1]);
    var merged=[];
    bands.forEach(function(b){ var last=merged[merged.length-1];
      if(last && b[0]-last[1]<=4) last[1]=b[1]; else merged.push([b[0],b[1]]); });
    var cand=merged.filter(function(b){ var h=b[1]-b[0]+1; return h>=7 && h<=34 && b[0]>bestLine.y; });
    var ctr=cand.map(function(b){ return (b[0]+b[1])/2; });
    var diffs=[]; for(var q=1;q<ctr.length;q++){ var d=ctr[q]-ctr[q-1]; if(d>=20) diffs.push(d); }
    diffs.sort(function(a,b){ return a-b; });
    var pitch = diffs.length? diffs[Math.floor(diffs.length/2)] : 0.083*H;
    function brightAt(cc){ var y3=Math.max(0,Math.round(cc-0.35*pitch)), y4=Math.min(H,Math.round(cc+0.35*pitch)); var ssum=0;
      for(var yy=y3;yy<y4;yy++) ssum+=prof[yy]; return ssum; }
    if(ctr.length){
      var full=ctr.slice();
      for(var q2=0;q2<ctr.length-1;q2++){ var dd=ctr[q2+1]-ctr[q2];
        if(dd>1.6*pitch){ var nn=Math.round(dd/pitch)-1;
          for(var q3=1;q3<=nn;q3++) full.push(ctr[q2]+q3*(dd/(nn+1))); } }
      full.sort(function(a,b){ return a-b; });
      var lastC=full[full.length-1];
      for(var q4=0;q4<3;q4++){ var c1=lastC+pitch; if(c1+0.42*pitch<H && brightAt(c1)>=6){ full.push(c1); lastC=c1; } else break; }
      var firstC=full[0];
      for(var q5=0;q5<2;q5++){ var c2=firstC-pitch; if(c2>bestLine.y+6 && brightAt(c2)>=6){ full.unshift(c2); firstC=c2; } else break; }
      cand=full.map(function(cc){ return [Math.round(cc-0.42*pitch), Math.round(cc+0.42*pitch)]; });
    }
    /* 3b) per-row cell reads */
    var tdbg={mode:T.mode, kx:[Math.round(T.kx0),Math.round(T.kx1)], rows:[]};
    for(var ri=0; ri<cand.length; ri++){
      var y0=cand[ri][0], y1=cand[ri][1];
      var rdbg={y:[y0,y1]};
      /* naam cell ka left bound: us row ki pehli white-ink cheez (avatar ke baad) */
      var nl2=T.nl;
      var runs=_inkRuns(px, Math.max(0,T.nl-0.02*W), T.nr, y0, y1, 185);
      var textRun=null;
      for(var r1=0;r1<runs.length;r1++){
        var A=runs[r1];
        if(A.w<4 || A.h<(y1-y0)*0.30) continue;
        /* text-like = agla run 25px ke andar (avatar edge ki akele thin run skip) */
        var nxt=runs[r1+1];
        if(!nxt || (nxt.x0-A.x1)>25) continue;
        textRun=A; break;
      }
      if(textRun && textRun.x0 > T.nl - 0.02*W) nl2=Math.max(0, textRun.x0-6);
      rdbg.runs=runs.length+(textRun?(' pick='+textRun.x0+','+textRun.w+','+textRun.h):' none');
      /* kills: K column */
      var kv={}, ktxt=[];
      var KVAR=[[150,true,true],[190,false,true],['otsu',false,true],[190,true,true],['ada',false,false],[200,false,false]];
      for(var v1=0; v1<KVAR.length; v1++){
        var KK=KVAR[v1];
        var o2=await _v4Read(im, T.kx0, y0, T.kx1, y1, KK[0], KK[1], KK[2], 7, _WL_DIGITS+'/', 520);
        if(!o2) continue;
        var txt=_v4Text(o2), nums=_v4Nums(txt);
        ktxt.push(String(KK[0])+(KK[1]?'i':'')+':'+txt);
        if(!nums.length) continue;
        var val=nums[0];
        var w=0.3+((o2.conf||0)/100);
        kv[val]=(kv[val]||0)+w;
      }
      var kres=_v4Vote(kv);
      rdbg.k=[kres.v, Math.round(kres.share*100)];
      rdbg.nx=[Math.round(nl2),Math.round(T.nr)];
      /* kda mode: sub-cell (sirf K digit ka tight crop) se cross-check */
      if(T.mode==='kda'){
        /* v4.2: K cell ka PEHLA digit = leftmost text-like ink run (K cell me
           '0 / 4 / 0' me sirf '0' chahiye — pehle pura left hissa crop hota tha
           jisme '/' aur '4' bhi aa jate the aur '0' -> '4' padha jata tha) */
        var kRuns=_inkRuns(px, Math.max(0,T.kx0-8), T.kx1, y0, y1, 170);
        var g1=null, rH=y1-y0;
        for(var rk=0; rk<kRuns.length; rk++){
          var R=kRuns[rk];
          if(R.h > 0.62*rH) continue;           /* rating-box edge / bade blobs skip */
          if(R.w < 3) continue;
          if(R.x0 < T.khx-6) continue;          /* header K column se left kuch nahi */
          g1={x0:Math.max(0,R.x0-4), x1:Math.min(W,R.x1+5), h:R.h, w:R.w};
          break;
        }
        if(g1 && (g1.x1-g1.x0)<6) g1=null;      /* bahut patla = shayad '/' */
        if(g1){
          var svotes={}, shp=null;
          var SVAR=[[150,true,true],[190,false,true],['otsu',false,true],[190,true,true]];
          for(var v2=0; v2<SVAR.length; v2++){
            var SS=SVAR[v2];
            var o3=await _v4Read(im, g1.x0-5, y0, g1.x1+6, y1, SS[0], SS[1], SS[2], 10, _WL_DIGITS, 200);
            if(!o3) continue;
            var t3=_v4Text(o3).replace(/[^0-9]/g,'');
            if(!t3 || t3.length>2) continue;
            svotes[parseInt(t3,10)]=(svotes[parseInt(t3,10)]||0)+ (0.3+((o3.conf||0)/100));
          }
          var sres=_v4Vote(svotes);
          rdbg.sub=[sres.v, Math.round(sres.share*100)];
          rdbg.subx=[g1.x0,g1.x1]; rdbg.subn=svotes;
          if(sres.v!=null && sres.share>=0.6){
            if(kres.v==null || kres.share<0.5){ kres={v:sres.v, share:sres.share, total:sres.total, sub:true}; }
            else if(sres.v===kres.v){ kres.share=Math.max(kres.share, sres.share); kres.sub=true; }
            /* v4.3: plain vote saare filters me EK-JUT tha (>=90%) to usi par bharosa
               (img C: '5' par sab sehra tha, sub-crop ne galti se '8' padha) */
            else if(kres.share>=0.9){ kres.sub=false; rdbg.kdis=[sres.v, Math.round(sres.share*100)]; }
            else if(sres.share>=0.9 && kres.share<0.75){ kres={v:sres.v, share:sres.share, total:sres.total, sub:true, conflict:kres.v}; }
            else { kres={v:null, share:0, total:0, conflict:kres.v}; }   /* ambiguous disagreement -> fill nahi (safe) */
          }
        }
      }
      rdbg.kf=[kres.v, Math.round(kres.share*100)];
      /* naam cell */
      var nvar=[[150,true,true],[185,false,true],['norm',false,false],['otsu',false,true]];
      var cands=[], nlines=[];
      for(var v3=0; v3<nvar.length; v3++){
        var NN=nvar[v3];
        var o4=await _v4Read(im, nl2, y0, T.nr, y1, NN[0], NN[1], NN[2], 6, _WL_NAME, 900);
        if(!o4) continue;
        var ls=(o4.lines||[]).filter(function(l){ return l.text && l.text.replace(/[^A-Za-z0-9]/g,'').length>=2; });
        if(ls.length) nlines=nlines.concat(ls.map(function(l){ return {t:l.text.trim(), y:(l.y==null?0:l.y)}; }));
      }
      /* top crop (sirf naam ki line) */
      var oTop=await _v4Read(im, nl2, y0, T.nr, y0+Math.round((y1-y0)*0.62), 165, true, true, 7, _WL_NAME, 900);
      if(oTop){ var tt=_v4Text(oTop); if(tt) cands.push(tt); }
      nlines.sort(function(a,b){ return a.y-b.y; });
      var uniq={};
      nlines.forEach(function(L){
        var t=L.t.replace(/\s+/g,' ').trim();
        var kk=norm(t); if(!kk||uniq[kk]) return; uniq[kk]=1; cands.push(t);
        /* top-2 lines ka combo bhi candidate (naam + clan ek saath kabhi hota hai) */
      });
      var top2=nlines.slice(0,2).map(function(l){ return l.t; }).join(' ');
      if(top2 && !uniq[norm(top2)]) cands.push(top2);
      rdbg.n=cands.slice(0,3);
      /* damage (evidence) */
      var dmg=null;
      if(T.dmg0!=null && T.dmg1!=null && T.dmg1-T.dmg0>8){
        var o5=await _v4Read(im, T.dmg0, y0, T.dmg1, y1, 190, false, true, 7, _WL_DIGITS, 520);
        if(o5){ var dn=_v4Nums(_v4Text(o5)); if(dn.length) dmg=dn[0]; }
      }
      rdbg.d=dmg;
      outRows.push({name:(cands[0]||''), name2:(cands[1]||null), name3:(cands[2]||null), name4:(cands[3]||null),
                    kills:(kres.v==null? null : kres.v), rank:outRows.length+1,
                    fromCol:(kres.v!=null && T.mode!=='kda' ? true : (kres.v!=null&&kres.sub===true)),
                    hasDmg:(dmg!=null && dmg>0), nums:(T.mode==='kda'?3:1), dmg:dmg,
                    _v4conf:Math.round((kres.share||0)*100), _v4table:ti, _v4mode:T.mode});
      tdbg.rows.push(rdbg);
    }
    dbg.tables.push(tdbg);
  }
  if(progress) progress(100);
  var good=outRows.filter(function(r){ return r.kills!=null; });
  return {rows:outRows, mode:'v4-'+dbg.tables.map(function(t){return t.mode;}).join('+'),
          score:(good.length? Math.min(100, 60+good.length*4) : 0),
          conf:(outRows.length? Math.round(100*good.length/outRows.length) : 0),
          debug:dbg, lines:lines.length};
}

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
    /* v3.4: single-image me rows ko kabhi drop nahi karo — warna index/order
       badal jata hai (order-prior band) aur kills galat player par jate hain.
       Multi-image me duplicate players merge hote hain (wahi naam 2 screenshot
       me), par khaali-naam row kabhi nahi hatti. */
    var _single=(fileArr.length===1);
    all=all.filter(function(p){
      var k=norm(p.name);
      if(!k) return true;
      if(!_single && seen[k]) return false;
      seen[k]=true; return true;
    });
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

window._FFREOCR={runResult:runResult,runLobby:runLobby,parseResultV4:parseResultV4,parseResultV25:parseResultV25,parseResult:parseResult};
})();
