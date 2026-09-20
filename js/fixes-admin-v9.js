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
/* ✅ AUDIT FIX: this function was IIFE-local, but the SEPARATE _patchModalGD
   IIFE below (a different closure entirely) calls it too — every admin
   modal open threw "replaceGDInNode is not defined" 60ms after opening.
   Expose it globally, same pattern as window.ADMIN_GD right above. */
window.replaceGDInNode = replaceGDInNode;

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

/* Bug 11 Fix: Hook into openAdminModal/openModal so dynamically rendered
   modals also get GD image replacement. The 3s interval misses modals that
   open and close faster than the interval fires. */
(function _patchModalGD() {
  function _wrap(fnName) {
    if (!window[fnName] || window[fnName]._gdPatched) return;
    var _orig = window[fnName];
    window[fnName] = function() {
      var res = _orig.apply(this, arguments);
      setTimeout(function() {
        var sel = '.admin-modal-content, #adminModal .modal-body, .modal-overlay .modal-inner, #mainModal';
        var el = document.querySelector(sel) || document.body;
        replaceGDInNode(el);
      }, 60);
      return res;
    };
    window[fnName]._gdPatched = true;
  }
  function _tryPatch() {
    ['openAdminModal','openModal','_adminModal','_modal','showAdminModal'].forEach(_wrap);
  }
  _tryPatch();
  // Retry after scripts load
  setTimeout(_tryPatch, 1000);
  setTimeout(_tryPatch, 3000);
})();
