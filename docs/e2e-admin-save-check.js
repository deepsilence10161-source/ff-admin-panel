const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('/home/user/ff-admin-panel/js/fa-app-settings-v2.js','utf8');
function extractFn(name){
  const m = src.match(new RegExp('function\\s+'+name+'\\s*\\(')) || src.match(new RegExp(name+'\\s*=\\s*function\\s*\\('));
  let i=src.indexOf('{',m.index),d=0;
  for(let j=i;j<src.length;j++){if(src[j]==='{')d++;else if(src[j]==='}'){d--;if(d===0)return src.slice(m.index,j+1);}}
}
const fn = extractFn('saveAppSettings');
// form values the admin would type
const form = {
  as_manualPayEnabled:{checked:true},
  as_manualPayUpiId:{value:'hunter7@ybl'},
  as_manualPayPayee:{value:'Mini eSports Official'},
  as_manualPayQrUrl:{value:'https://i.ibb.co/real/qr.png'},
  as_manualPayMin:{value:'50'},
  as_manualPayInstructions:{value:'1. Pay karo\n2. UTR bhejo'},
  as_paytmEnabled:{checked:false},
  saveAppSettingsBtn:{disabled:false,innerHTML:''},
};
let upserts=[];
const supa={from:t=>({select:()=>({in:()=>Promise.resolve({data:[]})}),upsert:(row)=>{upserts.push(row);return Promise.resolve({error:null});}})};
const sb=vm.createContext({
  document:{getElementById:id=>form[id]||{value:'',checked:false},querySelectorAll:()=>[],createElement:()=>({style:{}})},
  showToast:()=>{},window:{_supa:supa,showToast:()=>{},rtdb:{ref:()=>({})}},
  console:{log(){},error(){}},Date,Promise,
});
vm.runInContext(fn+'\nsaveAppSettings();',sb);
setTimeout(()=>{
  const lc = upserts.find(u=>u.key==='live_config');
  const mp = lc && lc.value && lc.value.manualPayment;
  console.log('  upsert keys:', upserts.map(u=>u.key).join(', '));
  console.log('  manualPayment saved:', JSON.stringify(mp));
  const checks = {
    'enabled from checkbox': mp && mp.enabled===true,
    'upiId from input': mp && mp.upiId==='hunter7@ybl',
    'payeeName from input': mp && mp.payeeName==='Mini eSports Official',
    'qrImageUrl from input': mp && mp.qrImageUrl==='https://i.ibb.co/real/qr.png',
    'minAmount numeric': mp && mp.minAmount===50,
    'instructions text': mp && mp.instructions==='1. Pay karo\n2. UTR bhejo',
    'updatedAt set': mp && typeof mp.updatedAt==='number',
  };
  let fail=0;
  for (const [k,v] of Object.entries(checks)) { console.log((v?'  ✅ ':'  ❌ ')+k); if(!v) fail++; }
  process.exit(fail?1:0);
},100);
