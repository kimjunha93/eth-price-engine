'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
function frozenCore(){
 const DAY=86400000, CUT=Date.parse("2023-01-01T00:00:00Z"), K=[.05,.10,.15,.20,.30,.40,.50], Q=[.1,.25,.5,.75,.9], mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
 function quant(a,p){let b=[...a].sort((x,y)=>x-y),i=(b.length-1)*p,j=Math.floor(i);return b[j]+(b[Math.min(j+1,b.length-1)]-b[j])*(i-j)}
 function parse(csv){let rows=[],seen=new Set();for(let l of csv.trim().split(/\r?\n/).slice(1)){let [ds,o,h,lo,c,v]=l.split(","),t=Date.parse(ds.includes("+")||ds.endsWith("Z")?ds:ds+"Z");[o,h,lo,c,v]=[o,h,lo,c,v].map(Number);if(!Number.isFinite(t)||seen.has(t)||![o,h,lo,c,v].every(Number.isFinite)||Math.min(o,h,lo,c)<=0||h<Math.max(o,lo,c)||lo>Math.min(o,h,c)||v<0)throw Error("invalid input");seen.add(t);rows.push({t,o,h,l:lo,c,v})}return rows.sort((a,b)=>a.t-b.t)}
 function scan(a,k){let state=0,seed=0,ext=0,seg=0,hist=[],previous=null,active=null,events=[];for(let i=0;i<a.length;i++){let b=a[i];if(!i||b.t-a[i-1].t!==DAY){if(active)events.push({...active,status:"gap",end:a[i-1].t+DAY});active=null;previous=null;hist=[];state=0;seed=b.c;ext=b.c;seg++}hist.push(b);if(hist.length>61)hist.shift();
 if(!state){if(b.c>=seed*(1+k)){state=1;ext=b.c}else if(b.c<=seed*(1-k)){state=-1;ext=b.c}continue}
 ext=state===1?Math.max(ext,b.h):Math.min(ext,b.l);
 if(!(state===1?b.c<=ext*(1-k):b.c>=ext*(1+k)))continue;
 if(active){events.push({...active,status:"complete",end:b.t+DAY,y:ext/active.anchor});active=null}
 if(previous!==null&&hist.length===61){let atr=mean(hist.slice(-14).map((x,j)=>Math.max(x.h-x.l,Math.abs(x.h-hist[46+j].c),Math.abs(x.l-hist[46+j].c))))/b.c,vol=mean(hist.slice(-20).map(x=>x.v)),high=Math.max(...hist.map(x=>x.h));if(vol>0)active={t:b.t+DAY,seg,dir:state===1?"down":"up",anchor:b.c,x:[Math.abs(Math.log(ext/previous)),atr,Math.log(b.c/high),Math.log(b.c/hist[53].c),b.v/vol]}}
 previous=ext;state=-state;ext=b.c;
 }if(active)events.push({...active,status:"open",end:a.at(-1).t+DAY});return events}
 function model(tr,s){let pack=a=>Q.map(p=>quant(a.map(r=>r.y),p));let mu=s.x.map((_,i)=>mean(tr.map(r=>r.x[i]))),sd=mu.map((v,i)=>Math.sqrt(mean(tr.map(r=>(r.x[i]-v)**2)))||1);
 const near=ids=>pack(tr.map(r=>({r,d:mean(ids.map(i=>((r.x[i]-s.x[i])/sd[i])**2))})).sort((a,b)=>a.d-b.d).slice(0,15).map(x=>x.r));let med=quant(tr.map(r=>r.x[1]),.5),group=tr.filter(r=>(r.x[1]>=med)===(s.x[1]>=med));return {B0:Q.map(()=>1),B1:pack(tr),M_swing:near([0]),M_volatility:pack(group.length>=15?group:tr),M_price:near([0,1,2,3]),M_all:near([0,1,2,3,4])}}
 function losses(q,s){return {mae:Math.abs(q[2]-s.y)*100,pin:mean(q.map((v,i)=>{let d=s.y-v;return d>=0?Q[i]*d:(Q[i]-1)*d}))*100,cover:+(q[1]<=s.y&&s.y<=q[3]),width:(q[3]-q[1])*100}}
 function boot(d){let groups={};for(let r of d){let dt=new Date(r.t),key=dt.getUTCFullYear()+"-"+Math.floor(dt.getUTCMonth()/3);(groups[key]??=[]).push(r)}let blocks=Object.values(groups);if(blocks.length<8)return {blocks:blocks.length,lower:null};let seed=270116,rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};let samples=[];for(let i=0;i<1500;i++){let sum=0,n=0;for(let j=0;j<blocks.length;j++){let b=blocks[Math.floor(rand()*blocks.length)];for(let r of b){sum+=r.delta;n++}}samples.push(sum/n)}return {blocks:blocks.length,lower:quant(samples,.05),upper:quant(samples,.95)}}
 function evals(e){let rows=[];for(let s of e.filter(r=>r.status==="complete"&&r.t>=CUT)){let tr=e.filter(r=>r.status==="complete"&&r.end<=s.t&&r.dir===s.dir);if(tr.length<30)continue;let p=model(tr,s);rows.push({t:s.t,dir:s.dir,loss:Object.fromEntries(Object.entries(p).map(([m,v])=>[m,losses(v,s)]))})}let n=rows.length;if(!n)return {n:0,models:{}};let base=mean(rows.map(r=>r.loss.B1.mae)),basepin=mean(rows.map(r=>r.loss.B1.pin)),out={};for(let m of Object.keys(rows[0].loss)){let mae=mean(rows.map(r=>r.loss[m].mae)),pin=mean(rows.map(r=>r.loss[m].pin)),years={};for(let r of rows){let y=new Date(r.t).getUTCFullYear();(years[y]??=[]).push(r)}let by=Object.fromEntries(Object.entries(years).map(([y,a])=>[y,{n:a.length,mae:mean(a.map(r=>r.loss[m].mae)),baseline:mean(a.map(r=>r.loss.B1.mae))}])),good=Object.values(by).filter(r=>r.mae<r.baseline).length,bt=boot(rows.map(r=>({t:r.t,delta:r.loss.B1.mae-r.loss[m].mae})));let eligible=m.startsWith("M")&&n>=50&&1-mae/base>=.05&&1-pin/basepin>=.05&&good>Object.keys(by).length/2&&bt.lower>0;out[m]={mae,pin,coverage50:mean(rows.map(r=>r.loss[m].cover)),width50:mean(rows.map(r=>r.loss[m].width)),improvement_mae_pct:(1-mae/base)*100,improvement_pin_pct:(1-pin/basepin)*100,by_year:by,quarter_cluster_bootstrap:bt,exploratory_gate:eligible}}return {n,models:out}}
 return {parse,scan,model,losses};
}

const core=frozenCore(),DAY=86400000,HOUR=3600000,root='eth_data',dest=root+'/v43_output',statePath=root+'/prospective_state_v1.json',policyPath='v43/prospective_policy_v1.json';
const names=['B0','B1','M_swing','M_volatility','M_price','M_all'],markets=['Upbit_ETHKRW','Bithumb_ETHKRW','Bitstamp_ETHUSD'],thresholds=[.05,.1,.15,.2,.3,.4,.5],sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const iso=t=>new Date(t).toISOString(), read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function atomic(p,obj){fs.writeFileSync(p+'.tmp',JSON.stringify(obj,null,2)+'\n');fs.renameSync(p+'.tmp',p)}
function prefixHash(a,n){return sha(JSON.stringify(a.slice(0,n)))}
function calculate(rows,market,k,now,prev,records,policyHash,codeHash){
 if(!rows.length)throw Error('empty input');
 const last=rows.at(-1).t+DAY;
 if(last>now)throw Error('unclosed daily bar');
 if(prev&&(rows.length<prev.rows||prefixHash(rows,prev.rows)!==prev.prefix_sha256))return {blocked:'historical_source_changed',checkpoint:prev,records};
 const next={rows:rows.length,last_closed:last,prefix_sha256:prefixHash(rows,rows.length)};
 if(!prev)return {checkpoint:next,records,action:'initialized_no_backfill'};
 if(last<prev.last_closed)throw Error('time regression');
 const events=core.scan(rows,k),active=events.at(-1);
 let action='no_new_eligible_pivot';
 // Never retroactively create forecasts for a previously confirmed or already completed event.
 if(active?.status==='open'&&active.t===last&&active.t>prev.last_closed&&now-active.t<HOUR){
   const id=market+'|'+k+'|'+iso(active.t),tr=events.filter(r=>r.status==='complete'&&r.end<=active.t&&r.dir===active.dir);
   if(!records.some(r=>r.id===id)&&tr.length>=30){
     const predictions=core.model(tr,active);
     if(Object.keys(predictions).join('|')!==names.join('|')||Object.values(predictions).some(p=>p.length!==5||p.some((v,i)=>!Number.isFinite(v)||v<=0||(i&&v<p[i-1]))))throw Error('bad forecast');
     records=[...records,{id,market,threshold:k,kind:'prospective_daily_pivot',asof:iso(active.t),issued_at:iso(now),delay_ms:now-active.t,anchor:active.anchor,direction:active.dir,train_n:tr.length,features:active.x,forecast_ratios:predictions,forecast_prices:Object.fromEntries(Object.entries(predictions).map(([m,p])=>[m,p.map(v=>v*active.anchor)])),policy_sha256:policyHash,code_sha256:codeHash,input_prefix_sha256:next.prefix_sha256}];
     action='registered_new_pivot';
   } else action='insufficient_training_or_duplicate';
 }else if(active?.status==='open'&&active.t>prev.last_closed)action='late_or_nonlatest_pivot_not_registered';
 return {checkpoint:next,records,action};
}
function scoresFor(rows,market,k,records,blocked){let e=core.scan(rows,k),by=new Map(e.map(r=>[iso(r.t),r]));return records.filter(r=>r.market===market&&r.threshold===k).map(r=>{if(blocked)return {id:r.id,market,threshold:k,status:'source_revision_hold'};let a=by.get(r.asof);if(!a||a.anchor!==r.anchor||a.dir!==r.direction||JSON.stringify(a.x)!==JSON.stringify(r.features))return {id:r.id,market,threshold:k,status:'source_revision_hold'};if(a.status!=='complete')return {id:r.id,market,threshold:k,status:a.status==='gap'?'gap_censored':'pending'};return {id:r.id,market,threshold:k,status:'confirmed',asof:r.asof,issued_at:r.issued_at,end:iso(a.end),actual_extreme:a.y*a.anchor,metrics:Object.fromEntries(names.map(m=>[m,core.losses(r.forecast_ratios[m],a)]))}})}
function summary(scores){let p=scores.filter(s=>s.market==='Upbit_ETHKRW'&&s.threshold===.1),d=p.filter(s=>s.status==='confirmed').sort((a,b)=>a.asof.localeCompare(b.asof));let cohort=[],quarters=new Set();for(let r of d){cohort.push(r);let t=new Date(r.asof);quarters.add(t.getUTCFullYear()+'-'+Math.floor(t.getUTCMonth()/3));if(cohort.length>=50&&quarters.size>=8)break}let metrics=Object.fromEntries(names.map(m=>[m,cohort.length?Object.fromEntries(['mae','pin','cover','width'].map(k=>[k,cohort.reduce((s,r)=>s+r.metrics[m][k],0)/cohort.length])):null]));return {registered:p.length,confirmed:d.length,cohort_n:cohort.length,quarters:quarters.size,metrics,review:cohort.length>=50&&quarters.size>=8?'eligible_for_manual_multiplicity_adjusted_review':'insufficient_prospective_events',promotion:'blocked'} }
function tests(){let n=0,ck=x=>{if(!x)throw Error('test '+n);n++},t=Date.parse('2026-11-27T00:00:00Z'),a=[{t:t-DAY,o:100,h:101,l:99,c:100,v:1}],p=calculate(a,'Upbit_ETHKRW',.1,t,null,[],'x','y');ck(p.action==='initialized_no_backfill');ck(p.records.length===0);let q=calculate(a,'Upbit_ETHKRW',.1,t+HOUR,p.checkpoint,[],'x','y');ck(q.action==='no_new_eligible_pivot');ck(calculate([{...a[0],c:99}], 'Upbit_ETHKRW',.1,t,p.checkpoint,[],'x','y').blocked==='historical_source_changed');ck(summary([]).metrics.B1===null);ck(summary([]).promotion==='blocked');let failed=false;try{calculate(a,'Upbit_ETHKRW',.1,t-1,null,[],'x','y')}catch{failed=true}ck(failed);return n}
function main(){if(process.argv[2]==='--test'){console.log(JSON.stringify({passed:tests()}));return}
const now=Date.now(),policyHash=sha(fs.readFileSync(policyPath)),codeHash=sha(fs.readFileSync(__filename)),policy=read(policyPath);
if(policy.primary_market!=='Upbit_ETHKRW'||policy.primary_threshold!==.1||policy.version!=='v43-prospective-policy-1')throw Error('policy changed');
let state=fs.existsSync(statePath)?read(statePath):{version:'v43-prospective-state-1',activated_at:iso(now),policy_sha256:policyHash,code_sha256:codeHash,checkpoints:{},records:[]};
if(state.policy_sha256!==policyHash||state.code_sha256!==codeHash)throw Error('frozen version changed: separate cohort required');
if(new Set(state.records.map(r=>r.id)).size!==state.records.length)throw Error('duplicate ledger');
let statuses={},scores=[];
for(let m of markets){let a=core.parse(fs.readFileSync(root+'/'+m+'_1d.csv','utf8'));if(now-(a.at(-1).t+DAY)>DAY+2*HOUR)throw Error('stale daily '+m);for(let k of thresholds){let key=m+'|'+k,r=calculate(a,m,k,now,state.checkpoints[key],state.records,policyHash,codeHash);state.records=r.records;state.checkpoints[key]=r.checkpoint;statuses[key]=r.blocked??r.action;scores.push(...scoresFor(a,m,k,state.records,!!r.blocked))}}
fs.mkdirSync(dest,{recursive:true});atomic(statePath,state);const report={version:'v43-prospective-monitor-1',generated_utc:iso(now),activated_at:state.activated_at,registered:state.records.length,primary:summary(scores),statuses,scores,policy:'Daily close features only; issuance within one hour of confirmation, entire following daily bar included in statistical label, not executable trading P/L. No historical forecast backfill; no path or first-touch promotion; gap/open separately reported.'};atomic(dest+'/prospective_scores.json',report);console.log(JSON.stringify({registered:report.registered,primary:report.primary,statuses}));
}
if(require.main===module)main();
