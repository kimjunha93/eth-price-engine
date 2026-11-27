function experiment(csv){
 const D=86400000, end=Date.parse("2026-11-26"),cut=Date.parse("2023-01-01");
 const rows=csv.trim().split(/\r?\n/).slice(1).map(s=>{const a=s.split(",");return {t:Date.parse(a[0]),o:+a[1],h:+a[2],l:+a[3],c:+a[4]}}).filter(r=>r.t<=end&&Number.isFinite(r.t)&&[r.o,r.h,r.l,r.c].every(v=>Number.isFinite(v)&&v>0)&&r.h>=Math.max(r.o,r.c,r.l)&&r.l<=Math.min(r.o,r.c,r.h)).sort((a,b)=>a.t-b.t);
 if(new Set(rows.map(r=>r.t)).size!==rows.length)throw Error("duplicates");
 const byTime=new Map(rows.map(r=>[r.t,r])),origins=[];let seed,ext,dir=0,last=null,piv=[],age=0,seq=0;
 for(const r of rows){
  if(last===null||r.t-last!==D){seed=r;ext=null;dir=0;piv=[];age=0;seq=0;}else{
   age++;
   if(!dir){if(r.c>=seed.c*1.1){dir=1;ext=r}else if(r.c<=seed.c*.9){dir=-1;ext=r}}
   else{if(dir===1?r.c>ext.c:r.c<ext.c)ext=r;if(dir===1?r.c<=ext.c*.9:r.c>=ext.c*1.1){piv.push({p:ext.c,t:ext.t,dir,available:r.t+D});dir=-dir;ext=r}}
  }
  last=r.t;
  if(age<179||(age-179)%10)continue;
  const index=seq++,asof=r.t+D,levels=piv.filter(p=>p.available<=asof&&asof-p.t<=365*D);
  let support=levels.filter(p=>p.dir===-1&&p.p<r.c).sort((a,b)=>b.p-a.p)[0],resistance=levels.filter(p=>p.dir===1&&p.p>r.c).sort((a,b)=>a.p-b.p)[0];
  if(!support||!resistance)continue;
  const ds=1-support.p/r.c,dr=resistance.p/r.c-1;
  if(ds<.02||ds>.2||dr<.02||dr>.2)continue;
  origins.push({asof,index,close:r.c,support:support.p,resistance:resistance.p,levels});
 }
 function outcome(asof,p,side){
  let touched=null,up=p*1.03,down=p*.97;
  for(let i=0;i<10;i++){let t=asof+i*D,b=byTime.get(t);if(!b)return {status:"censor_before_touch",touch:false};if(b.l<=p*1.005&&b.h>=p*.995){touched=t;if(b.h>=up||b.l<=down)return {status:"touch_bar_ambiguous",touch:true};break}}
  if(touched===null)return {status:"no_touch",touch:false};
  for(let i=1;i<=5;i++){const b=byTime.get(touched+i*D);if(!b)return {status:"censor_after_touch",touch:true};const h=b.h>=up,l=b.l<=down;if(h&&l)return {status:"order_unknown",touch:true};if(h||l)return {status:(side==="support"?h:l)?"reaction":"break",touch:true}}
  return {status:"no_outcome",touch:true};
 }
 let events=[];
 for(const o of origins)for(const side of ["support","resistance"]){
  const p=o[side],q=o.close*o.close/o[side==="support"?"resistance":"support"];
  const d=Math.abs(p/o.close-1),dq=Math.abs(q/o.close-1);
  events.push({side,asof:o.asof,independent:o.index%2===0,matched:d/dq>=.8&&d/dq<=1.25,d,dq,coincides:o.levels.some(x=>x.dir===(side==="support"?-1:1)&&Math.abs(x.p/q-1)<=.005),real:outcome(o.asof,p,side),placebo:outcome(o.asof,q,side)});
 }
 function summary(es,arm){let counts=Object.fromEntries(["reaction","break","no_outcome","no_touch","touch_bar_ambiguous","order_unknown","censor_before_touch","censor_after_touch"].map(k=>[k,0]));for(let e of es)counts[e[arm].status]++;let n=es.length,resolved=counts.reaction+counts.break;return {n,touches:es.filter(e=>e[arm].touch).length,counts,resolved,reaction_fraction:resolved?counts.reaction/resolved:null,mean_distance:n?es.reduce((s,e)=>s+(arm==="real"?e.d:e.dq),0)/n:null}}
 let out={rows:rows.length,origins:origins.length,groups:{}};
 for(const period of ["earlier","2023plus"])for(const side of ["support","resistance"])for(const group of ["raw","independent","matched_independent"]){
  let es=events.filter(e=>(period==="earlier"?e.asof<cut:e.asof>=cut)&&e.side===side&&(group==="raw"||e.independent)&&(group!=="matched_independent"||e.matched));
  out.groups[[period,side,group].join("_")]={coincidence:es.filter(e=>e.coincides).length,real:summary(es,"real"),placebo:summary(es,"placebo"),strata:[ [.02,.05],[.05,.1],[.1,.200000001]].map(([a,b])=>({range:[a,b],real:summary(es.filter(e=>e.d>=a&&e.d<b),"real"),placebo:summary(es.filter(e=>e.dq>=a&&e.dq<b),"placebo")})),placebo_outside_strata:es.filter(e=>e.dq<.02||e.dq>.2).length};
 }
 return out;
}
const fs=require('node:fs');const result={version:'sr-reaction-v1',status:'exploratory_reused_history',markets:{}};for(const n of ['Upbit_ETHKRW','Bitstamp_ETHUSD'])result.markets[n]=experiment(fs.readFileSync('eth_data/'+n+'_1d.csv','utf8'));console.log(JSON.stringify(result,null,2));
