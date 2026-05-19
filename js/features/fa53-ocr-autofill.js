/* ================================================================
   FA53: FREE FIRE OCR ENGINE v2.1
   Technology : Tesseract.js (Apache License 2.0) — FREE, Unlimited
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
function preprocessImage(file,invert){
  return new Promise(function(resolve){
    var url=URL.createObjectURL(file);
    var img=new Image();
    img.onerror=function(){URL.revokeObjectURL(url);resolve(file);};
    img.onload=function(){
      URL.revokeObjectURL(url);
      var scale=Math.min(2.5,2400/Math.max(img.width,img.height,1));
      if(scale<1)scale=1;
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
        var out=invert?(bright>145?0:255):(bright>145?255:0);
        px[i]=px[i+1]=px[i+2]=out;px[i+3]=255;
      }
      ctx.putImageData(id,0,0);
      cv.toBlob(function(blob){resolve(blob||file);},'image/png');
    };
    img.src=url;
  });
}

/* ── 3. OCR RUNNER — dual pass, merge ── */
async function recognize(blob,onPct){
  var worker=await Tesseract.createWorker('eng',1,{
    workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    logger:function(m){if(onPct&&m.status==='recognizing text')onPct(Math.round(m.progress*100));}
  });
  await worker.setParameters({
    tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.,!?@#$%&*()-+=|;:\' ',
    preserve_interword_spaces:'1',tessedit_pageseg_mode:'6'
  });
  var result=await worker.recognize(blob);
  await worker.terminate();
  return result.data.text||'';
}

async function runOCR(file,onPct){
  var ps=await Promise.all([preprocessImage(file,false),preprocessImage(file,true)]);
  var ts=await Promise.all([recognize(ps[0],onPct),recognize(ps[1])]);
  var seen={},lines=[];
  (ts[0]+'\n'+ts[1]).split('\n').forEach(function(l){
    l=l.trim();var k=l.toLowerCase().replace(/\s+/g,'');
    if(k.length>1&&!seen[k]){seen[k]=true;lines.push(l);}
  });
  return lines.join('\n');
}

/* ── 4. FUZZY MATCH ── */
function norm(s){return(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
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
  return Math.max(pfxSc,biSc);
}
function bestMatch(name,list,minSc){
  var best=null,bestSc=0;
  list.forEach(function(item){var sc=fuzzyScore(name,item.name);if(sc>bestSc){bestSc=sc;best=item;}});
  return bestSc>=(minSc||55)?{item:best,score:bestSc}:null;
}

/* ── 5. PARSERS ── */

/* Result parser
   FIX v2.1: \d+ for damage (was \d{3,6} — missed damage < 100)
   FIX v2.1: positional rank fallback when no #N found */
function parseResult(text){
  var lines=text.split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var players=[];
  lines.forEach(function(line){
    // "Name  K  D  A  DMG" — FIX: \d+ not \d{3,6}
    var m1=line.match(/^(.{2,22}?)\s+(\d{1,2})\s+\d+\s+(\d+)/);
    if(m1){var nm=m1[1].replace(/[|[\]{}\\/]/g,'').trim();if(nm.length>=2){players.push({name:nm,kills:parseInt(m1[2])||0,rank:0});return;}}
    // "Name K/D/A DMG"
    var m2=line.match(/^(.{2,22}?)\s+(\d{1,2})\s*\/\s*\d+\s*\/\s*\d+\s+(\d+)/);
    if(m2){var nm2=m2[1].replace(/[|[\]{}\\/]/g,'').trim();if(nm2.length>=2){players.push({name:nm2,kills:parseInt(m2[2])||0,rank:0});return;}}
    // "Name  Kills  DMG" — simple 2-col
    var m3=line.match(/^(.{2,22}?)\s+(\d{1,2})\s+(\d{2,6})\s*$/);
    if(m3&&parseInt(m3[2])<=48){var nm3=m3[1].replace(/[|[\]{}\\/]/g,'').trim();if(nm3.length>=2){players.push({name:nm3,kills:parseInt(m3[2])||0,rank:0});return;}}
  });

  // Try #N rank pattern first
  var rPat=/#\s*(\d{1,2})\b/g,rm,ri=0;
  while((rm=rPat.exec(text))!==null){
    var pos=parseInt(rm[1]);
    if(pos>=1&&pos<=48&&ri<players.length){if(!players[ri].rank){players[ri].rank=pos;ri++;}}
  }
  // FIX v2.1: if no #N found, use positional order (FF results screen IS ordered 1..N)
  if(ri===0&&players.length>0){players.forEach(function(p,i){if(!p.rank)p.rank=i+1;});}

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
  var lines=text.split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var players=[];
  lines.forEach(function(line){
    // FIX: max 16 chars (was 28)
    if(SKIP.test(line)||line.length<2||line.length>16)return;
    if(/^\d+$/.test(line))return;
    if(/^[^a-zA-Z]+$/.test(line))return;
    // "N Name"
    var m1=line.match(/^(\d{1,2})\s+(.{2,14})$/);
    if(m1&&parseInt(m1[1])>=1&&parseInt(m1[1])<=48){players.push({name:m1[2].trim(),slot:parseInt(m1[1])});return;}
    // "Name  N"
    var m2=line.match(/^(.{2,14}?)\s+(\d{1,2})$/);
    if(m2&&parseInt(m2[2])>=1&&parseInt(m2[2])<=48){players.push({name:m2[1].trim(),slot:parseInt(m2[2])});return;}
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
  if(_rBusy){bar('mrSsPreview','⏳ OCR chal raha hai...','warn');return;}
  var rows=document.querySelectorAll('#mrPlayerTable tr[data-uid]');
  if(!rows.length){bar('mrSsPreview','⚠️ Pehle match select karo aur players load karo','warn');return;}
  if(!TSR.ready){bar('mrSsPreview','⏳ OCR engine load ho raha hai...','info');await new Promise(function(r){TSR.load(r);});}
  _rBusy=true;
  var fileArr=Array.from(files).slice(0,5);
  var b=bar('mrSsPreview','<i class="fas fa-spinner fa-spin"></i> &nbsp;Scanning...','loading');
  try{
    var all=[];
    for(var i=0;i<fileArr.length;i++){
      if(b)b.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;Image '+(i+1)+'/'+fileArr.length+' scan...';
      var text=await runOCR(fileArr[i],function(p){if(b)b.innerHTML='<i class="fas fa-spinner fa-spin"></i> &nbsp;'+(i+1)+'/'+fileArr.length+': '+p+'%';});
      all=all.concat(parseResult(text));
    }
    if(!all.length){bar('mrSsPreview','⚠️ Player data detect nahi hua — clearer screenshot upload karo','warn');_rBusy=false;return;}
    var seen={};
    all=all.filter(function(p){var k=norm(p.name);if(!k||seen[k])return false;seen[k]=true;return true;});
    var tbl=[];
    rows.forEach(function(row){var el=row.querySelector('td:nth-child(2) div');if(el)tbl.push({name:el.textContent.trim(),row:row});});
    var filled=0,skipped=0;
    all.forEach(function(op){
      if(!op.name||op.name.length<2){if(rows.length===1){_fillRow(rows[0],op);filled++;}return;}
      var res=bestMatch(op.name,tbl,55);
      if(!res){skipped++;return;}
      _fillRow(res.item.row,op);filled++;
    });
    if(window.mrCalcPrize)rows.forEach(function(r){var inp=r.querySelector('.mr-rank-input');if(inp)window.mrCalcPrize(inp);});
    if(window.mrCheckDuplicateRanks)window.mrCheckDuplicateRanks();
    var msg='✅ Done! <b>'+filled+'/'+rows.length+' players</b> auto-filled';
    if(skipped>0)msg+=' <span style="opacity:.6;font-weight:400">('+skipped+' unmatched)</span>';
    bar('mrSsPreview',msg,filled>0?'success':'warn');
  }catch(e){bar('mrSsPreview','❌ Error: '+e.message,'error');}
  _rBusy=false;
}

function _fillRow(row,op){
  var ri=row.querySelector('.mr-rank-input'),ki=row.querySelector('.mr-kills-input');
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
          return rtdb.ref('joinRequests/'+rk).update({adminVerified:true,verifiedAt:Date.now(),verifiedBy:auth.currentUser?auth.currentUser.uid:'admin',verifiedVia:'ocr_free'}).catch(function(){});
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

function hookResult(){
  if(_rHooked||!window.mrAddScreenshots)return;
  _rHooked=true;
  var orig=window.mrAddScreenshots;
  window.mrAddScreenshots=function(inp){
    orig(inp);
    // Auto-run ONLY on actual new file upload
    if(inp.files&&inp.files.length)setTimeout(function(){runResult(inp.files);},200);
  };
}

function addResultBtn(){
  if(_rBtn||document.getElementById('_ocrRBtn'))return;
  var inp=document.getElementById('mrFileInput');if(!inp)return;
  _rBtn=true;
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

window._FFREOCR={runResult:runResult,runLobby:runLobby};
})();
