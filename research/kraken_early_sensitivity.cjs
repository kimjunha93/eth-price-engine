const fs=require('node:fs');
function run(kraken,bitstamp){
  const DAY=86400000,cut=Date.parse("2017-11-09"),test=Date.parse("2020-01-01");
  function load(s,limit=Infinity){
    const rows=s.trim().split(/\r?\n/).slice(1).map(l=>{const a=l.split(",");return {t:Date.parse(a[0].replace(" ","T").replace(" ","")),o:+a[1],h:+a[2],l:+a[3],c:+a[4]}}).filter(x=>x.t<limit);
    const segs=[];let seg=[],invalid=0,gaps=0;const seen=new Set();for(const r of rows){if(!Number.isFinite(r.t)||![r.o,r.h,r.l,r.c].every(v=>Number.isFinite(v)&&v>0)||r.h<Math.max(r.o,r.c)||r.l>Math.min(r.o,r.c)||seen.has(r.t)){invalid++;if(seg.length)segs.push(seg);seg=[];continue}seen.add(r.t);if(seg.length&&r.t-seg.at(-1).t!==DAY){gaps++;segs.push(seg);seg=[]}seg.push(r)}if(seg.length)segs.push(seg);return {segs,rows:rows.length,invalid,gaps};
  }
  function events(src,p){
    const out=[];let censored=0;
    for(const s of src.segs){if(s.length<2)continue;let trend=0,hi=s[0],lo=s[0],prev=null;
      function emit(kind,pivot,confirmation){if(prev)out.push({dir:prev.kind==="low"?"up":"down",start:prev.confirmation.t,end:confirmation.t,ratio:pivot.c/prev.confirmation.c});prev={kind,pivot,confirmation}}
      for(const r of s.slice(1)){if(trend===0){if(r.c>hi.c)hi=r;if(r.c<lo.c)lo=r;if(r.c>=lo.c*(1+p)){emit("low",lo,r);trend=1;hi=r}else if(r.c<=hi.c*(1-p)){emit("high",hi,r);trend=-1;lo=r}}
      else if(trend===1){if(r.c>hi.c)hi=r;else if(r.c<=hi.c*(1-p)){emit("high",hi,r);trend=-1;lo=r}}
      else {if(r.c<lo.c)lo=r;else if(r.c>=lo.c*(1+p)){emit("low",lo,r);trend=1;hi=r}}}
      if(prev)censored++;
    }return {out,censored};
  }
  function median(a){let b=[...a].sort((a,b)=>a-b),n=b.length;return n%2?b[n>>1]:(b[n/2-1]+b[n/2])/2}
  const k=load(kraken,cut),b=load(bitstamp);
  const results=[.2,.3,.4,.5].map(p=>{const e=events(k,p),m=events(b,p),scores=[];for(const x of m.out.filter(x=>x.start>=test)){const base=m.out.filter(z=>z.dir===x.dir&&z.end<x.start).map(z=>Math.log(z.ratio));const add=e.out.filter(z=>z.dir===x.dir&&z.end<x.start).map(z=>Math.log(z.ratio));if(base.length<5)continue;const truth=Math.log(x.ratio);const v0=median(base),v1=median(base.concat(add));scores.push({dir:x.dir,b0:Math.abs(truth),base:Math.abs(v0-truth),early:Math.abs(v1-truth),baseRel:Math.abs(Math.exp(v0-truth)-1),earlyRel:Math.abs(Math.exp(v1-truth)-1)})}
    const mean=(a,key)=>a.length?a.reduce((s,x)=>s+x[key],0)/a.length:null;
    const stat=a=>({n:a.length,current_log_mae:mean(a,"b0"),baseline_log_mae:mean(a,"base"),augmented_log_mae:mean(a,"early"),baseline_relative_mae:mean(a,"baseRel"),augmented_relative_mae:mean(a,"earlyRel")});
    return {threshold:p,early_completed:e.out.length,early_censored:e.censored,bitstamp_completed:m.out.length,bitstamp_censored:m.censored,early_up:e.out.filter(x=>x.dir==="up").length,early_down:e.out.filter(x=>x.dir==="down").length,overall:stat(scores),up:stat(scores.filter(x=>x.dir==="up")),down:stat(scores.filter(x=>x.dir==="down"))};
  });return {version:"kraken-early-sensitivity-1",design:"Daily close-only directional change, fixed 20/30/40/50% thresholds; estimate next close pivot relative to observed confirmation close with median log ratio by direction; use only completed training events strictly before prediction; min 5 Bitstamp training cases per direction; early archive before 2017-11-09; evaluate identical Bitstamp events starting 2020-01-01 or later; break on missing calendar days and invalid OHLC; no concatenation or volume features; last unconfirmed event censored. Exploratory retrospective test, not production promotion.",early:{rows:k.rows,invalid:k.invalid,gaps:k.gaps},bitstamp:{rows:b.rows,invalid:b.invalid,gaps:b.gaps},results}
}
if(require.main===module){const [k,b]=process.argv.slice(2);console.log(JSON.stringify(run(fs.readFileSync(k,'utf8'),fs.readFileSync(b,'utf8')),null,2));}
module.exports={run};
