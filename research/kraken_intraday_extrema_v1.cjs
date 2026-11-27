const fs=require('node:fs');
function study(kraken,bitstamp){
 const D=86400000,cut=Date.parse("2017-11-09"),start=Date.parse("2020-01-01"),split=Date.parse("2023-01-01"),thresholds=[.1,.15,.2,.3,.4,.5],weights=[0,.25,.5,1];
 function load(s,limit=Infinity){let segs=[],seg=[],prev=-Infinity,invalid=0,gaps=0,n=0;for(const line of s.trim().split(/\r?\n/).slice(1)){let a=line.split(","),t=Date.parse(a[0].replace(" ","T").replace(" ",""));if(t>=limit)continue;const [o,h,l,c]=a.slice(1,5).map(Number);if(!Number.isFinite(t)||t<=prev||![o,h,l,c].every(v=>Number.isFinite(v)&&v>0)||h<Math.max(o,l,c)||l>Math.min(o,h,c)){invalid++;if(seg.length)segs.push(seg);seg=[];continue}if(seg.length&&t-prev!==D){gaps++;segs.push(seg);seg=[]}seg.push({t,o,h,l,c});prev=t;n++}if(seg.length)segs.push(seg);return {segs,n,invalid,gaps}}
 function scan(src,p){let out=[],pivots=[],censored=0,ambiguous=0,segments=0;for(const s of src.segs){let trend=0,seed=null,ext=null,prev=null;segments++;
 function reset(){if(prev)censored++;prev=null;seed=null;ext=null;trend=0;segments++}
 function emit(type,b){let pivot={type,price:ext.price,t:ext.t,known:b.t+D,c:b.c};if(prev){out.push({dir:prev.type==="L"?"up":"down",start:prev.known,end:pivot.known,log:Math.log(pivot.price/prev.c),anchor:prev.c,actual:pivot.price})}pivots.push(pivot);prev=pivot;trend=-trend;ext={price:b.c,t:b.t}}
 for(const b of s){if(seed===null){seed=b.c;continue}if(!trend){if(b.c>=seed*(1+p)){trend=1;ext={price:b.c,t:b.t}}else if(b.c<=seed*(1-p)){trend=-1;ext={price:b.c,t:b.t}}continue}
 const fresh=trend===1?b.h>ext.price:b.l<ext.price;
 const next=trend===1?Math.max(ext.price,b.h):Math.min(ext.price,b.l);
 const closeHit=trend===1?b.c<=next*(1-p):b.c>=next*(1+p);
 const wickHit=trend===1?b.l<=next*(1-p):b.h>=next*(1+p);
 // When a new extreme and a contrary wick occur but the close does not confirm, do not guess the order.
 if(fresh&&wickHit&&!closeHit){ambiguous++;reset();seed=b.c;continue}
 if(fresh)ext={price:next,t:b.t};
 if(closeHit)emit(trend===1?"H":"L",b);
 }if(prev)censored++}
 return {out,pivots,censored,ambiguous,segments}}
 function wm(a,b,w){const z=a.map(v=>[v,1]).concat(w?b.map(v=>[v,w]):[]).sort((a,b)=>a[0]-b[0]);let x=0,half=z.reduce((s,r)=>s+r[1],0)/2;for(let i=0;i<z.length;i++){x+=z[i][1];if(x===half&&i+1<z.length)return (z[i][0]+z[i+1][0])/2;if(x>half)return z[i][0]}return z.at(-1)[0]}
 function score(rows,w){if(!rows.length)return {n:0,log:null,rel:null};return {n:rows.length,log:rows.reduce((s,r)=>s+Math.abs(r.pred[w]-r.log),0)/rows.length,rel:rows.reduce((s,r)=>s+Math.abs(Math.exp(r.pred[w]-r.log)-1),0)/rows.length}}
 const k=load(kraken,cut),b=load(bitstamp);
 return {version:"kraken-intraday-extrema-v1",design:{thresholds,weights,internal:"2020-2022 both start and end",evaluation:"2023 onward previously inspected; exploratory",selection:"min 10 internal cases, both relative and log error >=5% better than zero weight; choose min relative error; min 5 past baseline events per direction; exclude boundary event",label:"Daily high/low extremes, confirmed only by daily close; confirmation day's opposite extreme not used for next leg; if new extreme and opposite wick touches reversal threshold without close confirmation, break segment and censor active event. No exact intraday ordering claimed. Forecast anchor is confirmation close, target next confirmed intraday extreme. No gap bridging, no cross-exchange path, no volume.",promotion:"none; prior test dates reused"},data:{kraken:{n:k.n,invalid:k.invalid,gaps:k.gaps},bitstamp:{n:b.n,invalid:b.invalid,gaps:b.gaps}},results:thresholds.map(p=>{
 const e=scan(k,p),m=scan(b,p);
 // Verify causal prefix, bar-end known timestamps.
 const pref={segs:b.segs.map(s=>s.filter(r=>r.t<split)).filter(s=>s.length)};
 const prefix_ok=JSON.stringify(scan(pref,p).out)===JSON.stringify(m.out.filter(r=>r.end<=split));
 if(!prefix_ok)throw Error("prefix check failed "+p);
 let rows=[];for(const x of m.out.filter(x=>x.start>=start)){const base=m.out.filter(z=>z.dir===x.dir&&z.end<x.start).map(z=>z.log),early=e.out.filter(z=>z.dir===x.dir&&z.end<x.start).map(z=>z.log);if(base.length<5)continue;rows.push({...x,pred:Object.fromEntries(weights.map(w=>[w,wm(base,early,w)]))})}
 const ins=rows.filter(r=>r.end<=split&&r.start<split),test=rows.filter(r=>r.start>=split),internal=weights.map(w=>({w,...score(ins,w)})),base=internal[0],eligible=internal.filter(r=>r.w>0&&r.n>=10&&r.log<=base.log*.95&&r.rel<=base.rel*.95).sort((a,b)=>a.rel-b.rel||a.w-b.w),chosen=eligible[0]?.w??0;
 return {threshold:p,prefix_ok,early:{completed:e.out.length,up:e.out.filter(x=>x.dir==="up").length,down:e.out.filter(x=>x.dir==="down").length,censored:e.censored,ambiguous_bars:e.ambiguous},bitstamp:{completed:m.out.length,censored:m.censored,ambiguous_bars:m.ambiguous},internal,evaluation:weights.map(w=>({w,...score(test,w)})),chosen,excluded_boundary:rows.length-ins.length-test.length,selected_evaluation:score(test,chosen),baseline_evaluation:score(test,0),current_evaluation:score(test.map(r=>({...r,pred:{0:0}})),0),by_direction:Object.fromEntries(["up","down"].map(d=>[d,{base:score(test.filter(r=>r.dir===d),0),selected:score(test.filter(r=>r.dir===d),chosen)}]))}
 })};
}
if(require.main===module){const [k,b]=process.argv.slice(2);console.log(JSON.stringify(study(fs.readFileSync(k,'utf8'),fs.readFileSync(b,'utf8')),null,2));}
module.exports={study};
