function experiment(csv){
 const D=86400000,cut=Date.parse("2023-01-01"),end=Date.parse("2026-11-26"),rows=csv.trim().split(/\r?\n/).slice(1).map(s=>{let a=s.split(",");return {t:Date.parse(a[0]),o:+a[1],h:+a[2],l:+a[3],c:+a[4]}}).filter(r=>r.t<=end&&[r.o,r.h,r.l,r.c].every(x=>Number.isFinite(x)&&x>0)&&r.h>=Math.max(r.o,r.l,r.c)&&r.l<=Math.min(r.o,r.h,r.c)).sort((a,b)=>a.t-b.t);
 if(new Set(rows.map(r=>r.t)).size!==rows.length)throw Error("duplicate dates");
 const modes=[["10",.1,false],["20",.2,false],["30",.3,false],["40",.4,false],["50",.5,false]];
 function scan(rs,k,atrMode){
  let piv=[],states=new Map(),last=null,dir=0,ext=null,seed=null,seg=0,atr=null,trs=[],latest=null;
  for(const r of rs){
   if(last===null||r.t-last.t!==D){dir=0;ext=null;seed=null;seg++;atr=null;trs=[];latest=null;last=null}
   const tr=last?Math.max(r.h-r.l,Math.abs(r.h-last.c),Math.abs(r.l-last.c)):r.h-r.l;
   if(atr===null){trs.push(tr);if(trs.length===14)atr=trs.reduce((a,b)=>a+b,0)/14;}else atr=(atr*13+tr)/14;
   const x={...r,atr};last=r;
   if(atrMode&&atr===null)continue;
   if(!seed){seed=x;continue}
   const threshold=p=>atrMode?k*p.atr:k*p.c;
   if(!dir){if(x.c>=seed.c+threshold(seed)){dir=1;ext=x}else if(x.c<=seed.c-threshold(seed)){dir=-1;ext=x}}
   else{
    if(dir===1?x.c>ext.c:x.c<ext.c)ext=x;
    if(dir===1?x.c<=ext.c-threshold(ext):x.c>=ext.c+threshold(ext)){
     latest={seg,dir,price:ext.c,extreme:ext.t,available:x.t+D,anchor:x.c};piv.push(latest);dir=-dir;ext=x;
    }
   }
   if(latest)states.set(x.t+D,latest);
  }
  return {piv,states};
 }
 return hierarchy(rows,modes,scan,cut,D);
}
function hierarchy(rows,modes,scan,cut,D){
 const scans=Object.fromEntries(modes.map(([n,k,a])=>[n,scan(rows,k,a).piv])),pcut=rows[Math.floor(rows.length*.8)].t;
 const prefix=Object.fromEntries(modes.map(([n,k,a])=>[n,JSON.stringify(scan(rows.filter(r=>r.t<pcut),k,a).piv)===JSON.stringify(scans[n].filter(p=>p.available<=pcut))]));
 if(!Object.values(prefix).every(Boolean))throw Error("prefix fail");
 const q=(x,p)=>{let a=[...x].sort((a,b)=>a-b);let i=(a.length-1)*p,k=Math.floor(i);return a.length?a[k]+(a[Math.min(k+1,a.length-1)]-a[k])*(i-k):null};
 const stats=x=>[.25,.5,.75].map(p=>q(x,p));
 let nested={};
 for(const n of ["30","50"]){let paths=[];const p=scans[n];for(let i=0;i+1<p.length;i++){let a=p[i],b=p[i+1];if(a.seg!==b.seg||a.dir!==-1||b.dir!==1)continue;let inside=scans["10"].filter(s=>s.seg===a.seg&&s.extreme>=a.extreme&&s.extreme<=b.extreme),inner=inside.filter(s=>s.extreme>a.extreme);let h=0;for(let j=0;j+2<inner.length;j++)if(inner[j].dir===1&&inner[j+1].dir===-1&&inner[j+2].dir===1)h++;paths.push({low:new Date(a.extreme).toISOString().slice(0,10),high:new Date(b.extreme).toISOString().slice(0,10),ratio:b.price/a.price,pivots:inside.length,hlh:h})}nested[n]={n:paths.length,with_hlh:paths.filter(x=>x.hlh>0).length,ratio_q:stats(paths.map(x=>x.ratio)),pivots_q:stats(paths.map(x=>x.pivots)),paths};}
 const segments=new Map();let seg=0,last=null;for(const r of rows){if(last===null||r.t-last!==D)seg++;last=r.t;segments.set(seg,r.t+D)}
 const events=[];let p=scans["10"];
 for(let i=0;i<p.length;i++){let a=p[i];if(a.dir!==-1)continue;let prior=p[i-1],ev={start:a.available,anchor:a.anchor,low:a.price,priorDrop:prior&&prior.seg===a.seg? a.price/prior.price:null,stage:0,reason:"",end:segments.get(a.seg),y:[]};let prev=a;
 const append=(s,dir,shared=false)=>{if(!s){ev.reason="right_censored";return false}if(s.dir!==dir||s.extreme<prev.extreme||(!shared&&s.extreme<prev.available)){ev.reason="structural_mismatch";ev.end=s.available;return false}ev.y.push(s.price/a.anchor);ev.stage++;prev=s;return true};
 let ok=true;
 for(let j=1;j<=3;j++){const s=p[i+j];if(!append(s?.seg===a.seg?s:null,j%2?1:-1)){ok=false;break}}
 if(ok){let h30=scans["30"].find(x=>x.seg===a.seg&&x.dir===1&&x.available>a.available);if(!h30){ev.reason="right_censored";ok=false}else if(h30.available<prev.available||h30.extreme<prev.extreme){ev.reason="structural_mismatch";ev.end=Math.max(h30.available,prev.available);ok=false}else if(!append(h30,1,h30.extreme===prev.extreme)){ok=false}}
 if(ok){const l30=scans["30"].find(x=>x.seg===a.seg&&x.dir===-1&&x.available>prev.available);if(!append(l30,-1))ok=false}
 if(ok){const h50=scans["50"].find(x=>x.seg===a.seg&&x.dir===1&&x.available>prev.available);if(!append(h50,1))ok=false}
 if(ok){ev.reason="complete";ev.end=prev.available}
 ev.low_breach=rows.some(r=>r.t>=ev.start&&r.t+D<=ev.end&&r.c<ev.low);
 events.push(ev);
 }
 const independent=es=>{let end=-Infinity;return es.filter(e=>{if(e.start<end)return false;end=e.end;return true})};
 const summary=es=>({n:es.length,complete:es.filter(e=>e.reason==="complete").length,mismatch:es.filter(e=>e.reason==="structural_mismatch").length,censored:es.filter(e=>e.reason==="right_censored").length,low_breach:es.filter(e=>e.low_breach).length,stage_counts:[1,2,3,4,5,6].map(k=>es.filter(e=>e.stage>=k).length)});
 const ev=independent(events.filter(e=>e.start>=cut));let errors={flat:[],median:[],medoid:[],neighbor:[]},skipped=0;
 const medianPaths=tr=>Array.from({length:6},(_,j)=>q(tr.map(e=>Math.log(e.y[j])),.5));
 const medoid=tr=>{let m=medianPaths(tr),d=e=>e.y.reduce((s,v,j)=>s+Math.abs(Math.log(v)-m[j]),0);return tr.reduce((a,b)=>d(a)<=d(b)?a:b).y};
 for(const e of ev.filter(x=>x.reason==="complete"&&x.priorDrop)){const tr=independent(events.filter(x=>x.start<e.start)).filter(x=>x.end<e.start&&x.reason==="complete"&&x.priorDrop);if(tr.length<10){skipped++;continue}const near=[...tr].sort((a,b)=>Math.abs(Math.log(a.priorDrop/e.priorDrop))-Math.abs(Math.log(b.priorDrop/e.priorDrop))).slice(0,10);let preds={flat:Array(6).fill(1),median:medianPaths(tr).map(Math.exp),medoid:medoid(tr),neighbor:medoid(near)};for(const [k,v] of Object.entries(preds))errors[k].push(v.reduce((s,p,j)=>s+Math.abs(p/e.y[j]-1)*100,0)/6)}
 return {rows:rows.length,prefix,pivots:Object.fromEntries(Object.entries(scans).map(([k,v])=>[k,v.length])),nested,all:summary(events),independent:summary(independent(events)),evaluation:summary(ev),evaluated:errors.flat.length,skipped,scores:Object.fromEntries(Object.entries(errors).map(([k,v])=>[k,v.length?v.reduce((s,x)=>s+x,0)/v.length:null])),completed_examples:events.filter(e=>e.reason==="complete").map(e=>({start:new Date(e.start).toISOString(),end:new Date(e.end).toISOString(),y:e.y,low_breach:e.low_breach}))};
}
const fs=require('node:fs');const result={version:'hierarchy-path-v1',status:'exploratory_reused_history',markets:{}};for(const n of ['Upbit_ETHKRW','Bitstamp_ETHUSD'])result.markets[n]=experiment(fs.readFileSync('eth_data/'+n+'_1d.csv','utf8'));console.log(JSON.stringify(result,null,2));
