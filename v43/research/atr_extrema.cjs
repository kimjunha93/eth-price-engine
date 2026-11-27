function experiment(csv){
 const D=86400000,cut=Date.parse("2023-01-01"),end=Date.parse("2026-11-26"),rows=csv.trim().split(/\r?\n/).slice(1).map(s=>{let a=s.split(",");return {t:Date.parse(a[0]),o:+a[1],h:+a[2],l:+a[3],c:+a[4]}}).filter(r=>r.t<=end&&[r.o,r.h,r.l,r.c].every(x=>Number.isFinite(x)&&x>0)&&r.h>=Math.max(r.o,r.l,r.c)&&r.l<=Math.min(r.o,r.h,r.c)).sort((a,b)=>a.t-b.t);
 if(new Set(rows.map(r=>r.t)).size!==rows.length)throw Error("duplicate dates");
 const modes=[["fixed5",.05,false],["fixed10",.1,false],["fixed15",.15,false],["atr2",2,true],["atr3",3,true],["atr4",4,true]];
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
 let scans=Object.fromEntries(modes.map(([n,k,a])=>[n,scan(rows,k,a)])),pcut=rows[Math.floor(rows.length*.8)].t;
 let prefix=Object.fromEntries(modes.map(([n,k,a])=>[n,JSON.stringify(scan(rows.filter(r=>r.t<pcut),k,a).piv)===JSON.stringify(scans[n].piv.filter(p=>p.available<=pcut))]));
 if(!Object.values(prefix).every(Boolean))throw Error("prefix failure");
 let common=scans.fixed10.piv,events=[],counts={all:0,overlap_excluded:0,right_censored:0,missing_states:0};
 for(let i=0;i<common.length;i++){
  const p=common[i],next=common[i+1];counts.all++;
  if(!next||next.seg!==p.seg){counts.right_censored++;continue}
  if(next.extreme<p.available){counts.overlap_excluded++;continue}
  const f={};for(const [n] of modes){let q=scans[n].states.get(p.available);if(q)f[n]={v:Math.log(q.price/p.anchor),dir:q.dir};}
  if(Object.keys(f).length!==modes.length){counts.missing_states++;continue}
  events.push({start:p.available,end:next.available,dir:next.dir,y:next.price/p.anchor,f});
 }
 const median=x=>{let a=[...x].sort((a,b)=>a-b);return(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2};
 const prediction=x=>Math.exp(median(x.map(q=>Math.log(q.y))));
 let direction={};
 for(const dir of [-1,1]){
  let err=Object.fromEntries(["flat","median",...modes.map(m=>m[0])].map(n=>[n,[]])),skipped=0;
  for(const e of events.filter(e=>e.dir===dir&&e.start>=cut)){
   let tr=events.filter(q=>q.dir===dir&&q.end<e.start);
   if(tr.length<20){skipped++;continue}
   let p={flat:1,median:prediction(tr)};
   for(const [n] of modes){let d=q=>Math.abs(q.f[n].v-e.f[n].v)+(q.f[n].dir!==e.f[n].dir?1:0);p[n]=prediction([...tr].sort((a,b)=>d(a)-d(b)).slice(0,20))}
   for(const n of Object.keys(err))err[n].push(100*Math.abs(p[n]/e.y-1));
  }
  direction[dir===1?"high":"low"]={evaluated:err.flat.length,skipped,eligible:events.filter(x=>x.dir===dir).length,scores:Object.fromEntries(Object.entries(err).map(([n,e])=>[n,e.length?{mape:e.reduce((s,v)=>s+v,0)/e.length,median_ape:median(e)}:null]))};
 }
 return {rows:rows.length,pivots:Object.fromEntries(modes.map(([n])=>[n,scans[n].piv.length])),prefix,counts,direction};
}
const fs=require('node:fs');const result={version:'atr-extrema-v1',status:'exploratory_reused_history',markets:{}};for(const n of ['Upbit_ETHKRW','Bitstamp_ETHUSD'])result.markets[n]=experiment(fs.readFileSync('eth_data/'+n+'_1d.csv','utf8'));console.log(JSON.stringify(result,null,2));
