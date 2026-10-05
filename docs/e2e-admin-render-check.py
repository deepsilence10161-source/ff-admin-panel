# Verify the admin App Settings Payment section renders + saves manualPayment correctly
import subprocess, json
js = r'''
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('/home/user/ff-admin-panel/js/fa-app-settings-v2.js','utf8');
// extract _renderAppSettings and the section-building helpers
function extractFn(name){const m=src.match(new RegExp('function\\s+'+name+'\\s*\\('));let i=src.indexOf('{',m.index),d=0;for(let j=i;j<src.length;j++){if(src[j]==='{')d++;else if(src[j]==='}'){d--;if(d===0)return src.slice(m.index,j+1);}}}
const fn = extractFn('_renderAppSettings');
let html='';
const el={set innerHTML(v){html=v},get innerHTML(){return html}};
const sb=vm.createContext({
  document:{getElementById:id=>id==='appSettingsContent'?el:null,querySelectorAll:()=>[],createElement:()=>({style:{},click(){}})},
  window:{},console:{log(){},error(){}},
  _AS:{paytmEnabled:true,manualPayment:{enabled:true,upiId:'miniesports@upi',payeeName:'Mini eSports',qrImageUrl:'https://i.ibb.co/x/qr.png',instructions:'Step A\nStep B',minAmount:20}},
  _CVS:{},
});
vm.runInContext(fn+'\n_renderAppSettings();',sb);
const checks = {
  'section title': html.includes('Manual UPI Payment (QR System)'),
  'enable toggle': html.includes('as_manualPayEnabled'),
  'UPI ID input': html.includes('as_manualPayUpiId'),
  'payee input': html.includes('as_manualPayPayee'),
  'QR URL input': html.includes('as_manualPayQrUrl'),
  'min amount input': html.includes('as_manualPayMin'),
  'instructions textarea': html.includes('as_manualPayInstructions'),
  'existing values prefilled': html.includes('https://i.ibb.co/x/qr.png') && html.includes('miniesports@upi'),
  'paytm section still intact': html.includes('Paytm Instant Checkout'),
};
let fail=0;
for (const [k,v] of Object.entries(checks)) { console.log((v?'  ✅ ':'  ❌ ')+k); if(!v) fail++; }
// XSS check on instructions rendering (value goes into textarea)
const m = html.match(/as_manualPayInstructions[^>]*>([^<]*)</);
console.log('  instructions in textarea:', JSON.stringify(m?m[1]:null));
process.exit(fail?1:0);
'''
r = subprocess.run(['node','-e',js],capture_output=True,text=True,cwd='/home/user')
print(r.stdout); print(r.stderr[:500] if r.stderr else '')
