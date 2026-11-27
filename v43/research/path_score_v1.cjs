function scorePath(r,bars,now){
 const H=3600000, start=Date.parse(r.asof), stop=start+r.horizon_hours*H;
 if(!Number.isFinite(start)||start%H||!Number.isInteger(r.horizon_hours)||r.horizon_hours<1||r.horizon_hours>8760||!Array.isArray(r.stages)||!r.stages.length||r.stages.length>20||!["up","down"].includes(r.invalid_side)||!Number.isFinite(r.invalidation)||r.invalidation<=0)throw Error("invalid path schema");
 let prior=r.anchor;
 if(!Number.isFinite(prior)||prior<=0)throw Error("invalid anchor");
 for(const s of r.stages){if(!["up","down"].includes(s.side)||!Number.isFinite(s.target)||s.target<=0||(s.side==="up"?s.target<=prior:s.target>=prior)||(r.invalid_side==="down"?s.target<=r.invalidation:s.target>=r.invalidation))throw Error("invalid stage");prior=s.target;}
 if(r.invalid_side==="down"?r.invalidation>=r.anchor:r.invalidation<=r.anchor)throw Error("invalid global barrier");
 const map=new Map();for(const b of bars){if(map.has(b.t))throw Error("duplicate bar");map.set(b.t,b)}
 const latest=bars.reduce((m,b)=>Math.max(m,b.t),-Infinity),hits=[];let i=0;
 const done=(status,t)=>({status,completed:i,total:r.stages.length,hits,event_bar:t==null?null:new Date(t).toISOString(),extreme_score:null});
 const touch=(s,b)=>s.side==="up"?b.h>=s.target:b.l<=s.target;
 for(let t=start;t<stop;t+=H){
  if(t+H>now)return done("pending",null);
  const b=map.get(t);if(!b)return done(t>latest?"data_wait":"gap_unknown",t);
  if(!Number.isFinite(b.h)||!Number.isFinite(b.l)||b.l<=0||b.h<b.l)return done("invalid_bar",t);
  const bad=r.invalid_side==="down"?b.l<=r.invalidation:b.h>=r.invalidation,hit=touch(r.stages[i],b);
  if(bad&&hit)return done("order_unknown",t);
  if(bad)return done("invalidated",t);
  if(hit){
   if(i+1<r.stages.length&&touch(r.stages[i+1],b))return done("order_unknown",t);
   hits.push({stage:i+1,target:r.stages[i].target,bar:new Date(t).toISOString()});i++;
   if(i===r.stages.length)return done("path_touched",t);
  }
 }
 return done("expired",null);
}
function tests(){
 const H=3600000,t=Date.parse("2026-11-27T00:00:00Z");
 const r={asof:new Date(t).toISOString(),anchor:100,horizon_hours:4,invalidation:80,invalid_side:"down",stages:[{side:"up",target:120},{side:"down",target:100},{side:"up",target:140}]};
 const b=(a)=>a.map(([h,l],i)=>({t:t+i*H,h,l}));let n=0;
 function ck(rows,now,status,count,rec=r){const x=scorePath(rec,rows,now);if(x.status!==status||x.completed!==count)throw Error(JSON.stringify(x));n++}
 ck(b([[121,101],[119,99],[141,110]]),t+3*H,"path_touched",3);
 ck(b([[121,101],[119,99]]),t+2*H,"pending",2);
 ck(b([[121,99]]),t+H,"order_unknown",0);
 ck(b([[121,79]]),t+H,"order_unknown",0);
 ck(b([[110,79]]),t+H,"invalidated",0);
 ck(b([[121,101],[119,79]]),t+2*H,"order_unknown",1);
 ck(b([[121,101],[119,99],[139,105],[138,104]]),t+4*H,"expired",2);
 ck(b([[121,101]]),t+H/2,"pending",0);
 ck([{t:t+H,h:110,l:99}],t+2*H,"gap_unknown",0);
 ck([],t+2*H,"data_wait",0);
 ck(b([[121,101],[141,99]]),t+2*H,"order_unknown",1);
 ck(b([[119,90],[121,101],[119,99],[141,110]]),t+4*H,"path_touched",3);
 ck(b([[70,80]]),t+H,"invalid_bar",0);
 ck(b([[99,79]]),t+H,"path_touched",1,{...r,invalid_side:"up",invalidation:130,stages:[{side:"down",target:80}]});
 return n;
}
if(require.main===module) console.log(JSON.stringify({tests:tests()}));
module.exports={scorePath,tests};
