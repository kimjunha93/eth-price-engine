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
 const direction=evaluate(events,cut);
 return {rows:rows.length,prefix,counts,direction};
}
function evaluate(events,cut){
 const qs=[.1,.25,.5,.75,.9],z=[-1.2815515655446004,-.6744897501960817,0,.6744897501960817,1.2815515655446004],names=["B1","B2","Q1","Q2"],mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
 const quant=(x,q)=>{let a=[...x].sort((a,b)=>a-b),i=(a.length-1)*q,l=Math.floor(i);return a[l]+(a[Math.min(l+1,a.length-1)]-a[l])*(i-l)};
 const features=e=>[e.f.fixed5.v,e.f.fixed5.dir,e.f.atr4.v,e.f.atr4.dir],dist=(a,b)=>["fixed5","atr4"].reduce((s,n)=>s+Math.abs(a.f[n].v-b.f[n].v)+(a.f[n].dir!==b.f[n].dir?1:0),0);
 const empirical=tr=>qs.map(q=>quant(tr.map(e=>Math.log(e.y)),q));
 function regression(tr,e){
  let raw=tr.map(features),mu=[0,1,2,3].map(j=>mean(raw.map(x=>x[j]))),sd=mu.map((m,j)=>Math.sqrt(mean(raw.map(x=>(x[j]-m)**2)))||1);
  const transform=x=>[1,...x.map((v,j)=>(v-mu[j])/sd[j])],X=raw.map(transform),target=tr.map(x=>Math.log(x.y)),xe=transform(features(e));
  return qs.map(q=>{let b=[quant(target,q),0,0,0,0];for(let i=0;i<3000;i++){let g=[0,0,0,0,0];for(let k=0;k<X.length;k++){let p=X[k].reduce((s,v,j)=>s+v*b[j],0),d=p<target[k]?-q:p>target[k]?1-q:0;for(let j=0;j<5;j++)g[j]+=d*X[k][j]/X.length}let step=.04/Math.sqrt(1+i/30);for(let j=0;j<5;j++)b[j]-=step*(g[j]+(j?.02*b[j]:0))}return xe.reduce((s,v,j)=>s+v*b[j],0)});
 }
 let direction={};
 for(const dir of [-1,1]){
  let errors=Object.fromEntries(names.map(n=>[n,[]])),skipped=0;
  for(const e of events.filter(e=>e.dir===dir&&e.start>=cut)){
   let tr=events.filter(q=>q.dir===dir&&q.end<e.start);
   if(tr.length<20){skipped++;continue}
   let y=tr.map(t=>Math.log(t.y)),mu=mean(y),sd=Math.sqrt(y.reduce((s,v)=>s+(v-mu)**2,0)/(y.length-1));
   let predictions={B1:empirical(tr),B2:z.map(v=>mu+v*sd),Q1:empirical([...tr].sort((a,b)=>dist(a,e)-dist(b,e)).slice(0,20)),Q2:regression(tr,e)};
   for(const n of names){let raw=predictions[n];if(!raw.every(Number.isFinite))throw Error("nonfinite prediction");let cross=raw.some((v,j)=>j&&v<raw[j-1]);let p=[...raw].sort((a,b)=>a-b).map(Math.exp),v=e.y;let interval=(l,h,alpha)=>({coverage:Number(v>=l&&v<=h),width:h-l,score:h-l+2/alpha*(Math.max(l-v,0)+Math.max(v-h,0))});errors[n].push({cross:Number(cross),pinball:mean(p.map((x,j)=>Math.max(qs[j]*(v-x),(qs[j]-1)*(v-x)))),mape:100*Math.abs(p[2]/v-1),i50:interval(p[1],p[3],.5),i80:interval(p[0],p[4],.2)});}
  }
  direction[dir===-1?"low":"high"]={evaluated:errors.B1.length,skipped,eligible:events.filter(e=>e.dir===dir).length,scores:Object.fromEntries(names.map(n=>{let a=errors[n];return [n,a.length?{pinball:mean(a.map(x=>x.pinball)),mape:mean(a.map(x=>x.mape)),crossings:a.reduce((s,x)=>s+x.cross,0),i50:Object.fromEntries(["coverage","width","score"].map(k=>[k,mean(a.map(x=>x.i50[k]))])),i80:Object.fromEntries(["coverage","width","score"].map(k=>[k,mean(a.map(x=>x.i80[k]))]))}:null]}))};
 }
 return direction;
}
const fs=require('node:fs');const result={version:'quantile-extrema-v1',status:'exploratory_reused_history',markets:{}};for(const n of ['Upbit_ETHKRW','Bitstamp_ETHUSD'])result.markets[n]=experiment(fs.readFileSync('eth_data/'+n+'_1d.csv','utf8'));console.log(JSON.stringify(result,null,2));
