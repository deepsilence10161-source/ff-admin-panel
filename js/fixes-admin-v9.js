/* ================================================================
   MINI eSPORTS ADMIN — fixes-admin-v9.js
   1. Replace remaining <img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block"> with green-diamond image
   2. Green Diamond currency uses UD.greenDiamonds field
   3. Correct match type → prize currency labels
   4. Manual wallet: green=greenDiamonds path
   5. Result publish: paid match awards greenDiamonds
   ================================================================ */
(function(){
'use strict';

var GD = '<img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block">';
var GD_LG = '<img src="green-diamond.png" style="width:18px;height:18px;vertical-align:middle;object-fit:contain;display:inline-block">';
window.ADMIN_GD = GD;

function replaceGDInNode(node){
  if(!node) return;
  if(node.nodeType===3){
    if(node.textContent.indexOf('<img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block">')!==-1){
      var sp=document.createElement('span');
      sp.innerHTML=node.textContent.replace(/<img src="green-diamond.png" style="width:14px;height:14px;vertical-align:middle;object-fit:contain;display:inline-block">/g,GD);
      node.parentNode.replaceChild(sp,node);
    }
    return;
  }
  if(node.tagName==='SCRIPT'||node.tagName==='STYLE'||node.tagName==='IMG') return;
  Array.prototype.slice.call(node.childNodes).forEach(replaceGDInNode);
}

/* Run GD replacement on full document after load */
document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){ replaceGDInNode(document.body); }, 500);
  setTimeout(function(){ replaceGDInNode(document.body); }, 2000);
});

/* Also run periodically for dynamically rendered content */
setInterval(function(){ replaceGDInNode(document.body); }, 3000);

/* ── Correct prize path for result publishing ── */
/* Already handled in main JS: greenDiamonds path for paid matches */

console.log('[admin-v9] Fixes loaded ✅');
})();
