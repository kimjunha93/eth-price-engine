function experiment(csv){
 const D=86400000,cut=Date.parse("2023-01-01"),end=Date.parse("2026-11-26"),rows=csv.trim().split(/\r?\n/).slice(1).map(s=>{let a=s.split(",");return {t:Date.parse(a[0]),o:+a[1],h:+a[2],l:+a[3],c:+a[4]}}).filter(r=>r.t<=end&&[r.o,r.h,r.l,r.c].every(x=>Number.isFinite(x)&&x>0)&&r.h>=Math.max(r.o,r.l,r.c)&&r.l<=Math.min(r.o,r.h,r.c)).sort((a,b)=>a.t-b.t);
 if(new Set(rows.map(r=>r.t)).size!==rows.length)throw Error("duplicate dates");
 const modes=[["5",.05,false],["10",.1,false],["20",.2,false],["30",.3,false],["50",.5,false]];
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
 return transition(rows,modes,scan,cut,D);
}
function transition(rows,modes,scan,cut,D){
 const scans=Object.fromEntries(modes.map(([n,k,a])=>[n,scan(rows,k,a)])),pcut=rows[Math.floor(rows.length*.8)].t;
 const prefix=Object.fromEntries(modes.map(([n,k,a])=>[n,JSON.stringify(scan(rows.filter(r=>r.t<pcut),k,a).piv)===JSON.stringify(scans[n].piv.filter(p=>p.available<=pcut))]));
 if(!Object.values(prefix).every(Boolean))throw Error("prefix fail");
 const names=["B1","B2","M7","M8"],classes=["up","down","no_touch","ambiguous"],mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
 const byTime=new Map(rows.map(r=>[r.t,r]));let events=[],history=[],atr=null,trs=[],prev=null,counts={grid:0,missing_state:0,invalid_lower:0,censored:0};
 for(const r of rows){
  if(!prev||r.t-prev.t!==D){prev=null;atr=null;trs=[];history=[]}
  const tr=prev?Math.max(r.h-r.l,Math.abs(r.h-prev.c),Math.abs(r.l-prev.c)):r.h-r.l;
  if(atr===null){trs.push(tr);if(trs.length===14)atr=mean(trs)}else atr=(atr*13+tr)/14;
  history.push(r);prev=r;
  if(history.length<181||(history.length-181)%20!==0)continue;
  counts.grid++;const asof=r.t+D,f={};
  for(const [n] of modes){const p=scans[n].states.get(asof);if(p)f[n]={v:Math.log(p.price/r.c),dir:p.dir}}
  if(Object.keys(f).length!==modes.length){counts.missing_state++;continue}
  const u=r.c+2*atr,l=r.c-2*atr;if(!(l>0)){counts.invalid_lower++;continue}
  let y=2,end=asof+20*D;
  for(let j=0;j<20;j++){
   let t=asof+j*D,b=byTime.get(t);
   if(!b){y=-1;end=t;break}
   const h=b.h>=u,d=b.l<=l;
   if(h||d){y=h&&d?3:h?0:1;end=t+D;break}
  }
  if(y===-1)counts.censored++;
  const h=history.slice(-181),ret=h.slice(1).map((v,j)=>Math.log(v.c/h[j].c)),m=mean(ret);
  events.push({start:asof,end,y,f,upper:u/r.c,lower:l/r.c,returns:ret.map(v=>v-m)});
 }
 const freq=(a)=>{const c=[1,1,1,1];for(const v of a)c[v]++;return c.map(v=>v/(a.length+4))};
 function simulate(e){let state=20261127>>>0;const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};let ys=[];
 for(let i=0;i<256;i++){let price=1,y=2;outer:for(let j=0;j<4;j++){const s=Math.floor(rand()*e.returns.length);for(let k=0;k<5;k++){price*=Math.exp(e.returns[(s+k)%e.returns.length]);if(price>=e.upper){y=0;break outer}if(price<=e.lower){y=1;break outer}}}ys.push(y)}return freq(ys)}
 let scores=Object.fromEntries(names.map(n=>[n,{brier:[],logloss:[],correct:[],confusion:Array.from({length:4},()=>Array(4).fill(0))}]));let skipped=0,actual=[0,0,0,0];
 const dist=(a,b,ns)=>mean(ns.map(n=>Math.abs(a.f[n].v-b.f[n].v)+(a.f[n].dir!==b.f[n].dir?1:0)));
 for(const e of events.filter(e=>e.start>=cut&&e.y>=0)){
 const tr=events.filter(a=>a.y>=0&&a.end<e.start);if(tr.length<20){skipped++;continue}
 const near=ns=>freq([...tr].sort((a,b)=>dist(a,e,ns)-dist(b,e,ns)).slice(0,20).map(a=>a.y));
 const pred={B1:freq(tr.map(a=>a.y)),B2:simulate(e),M7:near(["10"]),M8:near(modes.map(m=>m[0]))};actual[e.y]++;
 for(const n of names){const p=pred[n],a=scores[n],k=p.indexOf(Math.max(...p));a.brier.push(p.reduce((s,v,j)=>s+(v-Number(j===e.y))**2,0));a.logloss.push(-Math.log(p[e.y]));a.correct.push(Number(k===e.y));a.confusion[e.y][k]++}
 }
 const n=actual.reduce((s,v)=>s+v,0);
 return {rows:rows.length,prefix,counts,all_classes:Object.fromEntries(classes.map((k,j)=>[k,events.filter(e=>e.y===j).length])),evaluation:{n,skipped,censored:events.filter(e=>e.start>=cut&&e.y<0).length,actual:Object.fromEntries(classes.map((k,j)=>[k,actual[j]])),scores:Object.fromEntries(names.map(k=>[k,{brier:n?mean(scores[k].brier):null,logloss:n?mean(scores[k].logloss):null,accuracy:n?mean(scores[k].correct):null,confusion:scores[k].confusion}]))}};
}
const fs=require('node:fs');const result={version:'state-transition-v1',status:'exploratory_reused_history',markets:{}};for(const n of ['Upbit_ETHKRW','Bitstamp_ETHUSD'])result.markets[n]=experiment(fs.readFileSync('eth_data/'+n+'_1d.csv','utf8'));console.log(JSON.stringify(result,null,2));
