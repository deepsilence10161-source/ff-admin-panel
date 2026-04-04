/* ADMIN FEATURE A10: User Activity Heatmap (Hour-of-day)
   Kitne users kis time most active hain — admin match scheduling ke liye. */
(function(){
'use strict';
window.fa10ActivityHeatmap=async function(){
  try{
    var s=await rtdb.ref('joinRequests').once('value');
    var counts=new Array(24).fill(0);
    s.forEach(function(c){
      var d=c.val()||{};
      var ts=Number(d.joinedAt||d.timestamp||d.createdAt||0);
      if(!ts) return;
      var h=new Date(ts).getHours();
      counts[h]++;
    });
    var max=Math.max.apply(null,counts)||1;
    var h='<div><div style="font-size:12px;color:#aaa;margin-bottom:12px">Best match times (based on join data):</div><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px">';
    for(var i=0;i<24;i++){
      var pct=Math.round(counts[i]/max*100);
      var col=pct>70?'#00ff9c':pct>40?'#ffd700':pct>15?'#ff8c00':'rgba(255,255,255,.08)';
      h+='<div style="text-align:center"><div style="height:40px;background:'+col+';opacity:'+(0.2+pct/100*0.8)+';border-radius:6px;margin-bottom:2px"></div><div style="font-size:9px;color:#aaa">'+String(i).padStart(2,'0')+':00</div><div style="font-size:9px;color:#fff">'+counts[i]+'</div></div>';
    }
    h+='</div><div style="margin-top:12px;font-size:11px;color:#aaa">Peak hour: <strong style="color:#00ff9c">'+counts.indexOf(max)+':00</strong></div></div>';
    showAdminModal('📊 User Activity Heatmap',h);
  }catch(e){showToast('Error: '+e.message,true);}
};
})();
