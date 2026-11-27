function validatePath(r){
 const H=3600000,t=Date.parse(r.asof),i=Date.parse(r.issued_at);
 if(!["Upbit_ETHKRW","Bitstamp_ETHUSD"].includes(r.market)||!["conditional_structure","validated_model"].includes(r.label)||typeof r.rationale!=="string"||!r.rationale.trim()||r.kind!=="live"||!Number.isFinite(i)||!Number.isFinite(t)||t!==Math.floor(i/H)*H+H||typeof r.id!=="string"||!r.id||typeof r.model!=="string"||!r.model||![r.data_version,r.snapshot_sha256].every(s=>/^[a-f0-9]{64}$/.test(s)))throw Error("path metadata");
 if(!Array.isArray(r.stages)||!r.stages.length||r.stages[0].side===r.invalid_side||r.stages.some((s,j)=>j&&s.side===r.stages[j-1].side))throw Error("path directions");
 scorePath(r,[],t);return r;
}
function checkLedger(rows){
 const ids=new Map();for(const r of rows){validatePath(r);if(ids.has(r.id))throw Error("duplicate path id");if(r.revision_of){const p=ids.get(r.revision_of);if(!p||p.market!==r.market||Date.parse(p.asof)>=Date.parse(r.asof))throw Error("invalid revision")}ids.set(r.id,r)}return rows;
}
function createPath(input,env,rows){
 checkLedger(rows);
 if(!Array.isArray(input.stages)||!input.stages.length||input.invalid_side===input.stages[0].side)throw Error("first stage");
 const base=registration({...input,side:input.stages[0].side,target:input.stages[0].target},env,rows);
 return validatePath({...base,stages:input.stages.map(s=>({side:s.side,target:s.target})),invalid_side:input.invalid_side,label:input.label,rationale:input.rationale});
}
function parseHours(csv,now){
 const lines=csv.trimEnd().split(/\r?\n/),seen=new Set(),out=[];
 if(lines[0].split(",").slice(0,5).join(",")!=="date,open,high,low,close")throw Error("header");
 for(const line of lines.slice(1)){const a=line.split(","),t=Date.parse(a[0]),[o,h,l,c]=a.slice(1,5).map(Number);
 if(!Number.isFinite(t)||t%3600000||seen.has(t)||![o,h,l,c].every(v=>Number.isFinite(v)&&v>0)||h<Math.max(o,c,l)||l>Math.min(o,c,h))throw Error("invalid or duplicate hourly row");
 seen.add(t);if(t+3600000<=now)out.push({t,h,l,c});}return out.sort((a,b)=>a.t-b.t);
}
function integrationTests(){
 const H=3600000,t=Date.parse("2026-11-27T01:15:00Z"),hash="a".repeat(64),e={now:t,closed:t-900000,close:100,snapshotTime:t-60000,fresh:true,sourceHash:hash,expectedHash:hash,snapshotHash:"b".repeat(64)},i={id:"path-1",market:"Upbit_ETHKRW",model:"structure-v43",anchor:100,invalidation:80,invalid_side:"down",horizon_hours:48,label:"conditional_structure",rationale:"fixture",stages:[{side:"up",target:120},{side:"down",target:100},{side:"up",target:140}]};let n=0;
 const ck=x=>{if(!x)throw Error("test "+n);n++};
 const r=createPath(i,e,[]),s=Date.parse(r.asof);
 ck(checkLedger([]).length===0);ck(s===Date.parse("2026-11-27T02:00:00Z"));ck(checkLedger([r]).length===1);ck(createPath({...i,id:"rev",revision_of:r.id},{...e,now:t+H},[r]).revision_of===r.id);
 const bars=[[121,101],[119,99],[141,110]].map(([h,l],j)=>({t:s+j*H,h,l}));
 ck(scorePath(r,bars,s+3*H).status==="path_touched");ck(scorePath(r,bars,s+2*H).completed===2);ck(scorePath(r,[{t:s,h:121,l:99}],s+H).status==="order_unknown");
 for(const p of [{label:"unknown"},{rationale:""},{invalid_side:"up"},{stages:[{side:"up",target:120},{side:"up",target:140}]},{stages:[{side:"up",target:120},{side:"down",target:70}]}]){let fail=false;try{createPath({...i,...p},e,[])}catch{fail=true}ck(fail)}
 let duplicate=false;try{checkLedger([r,r])}catch{duplicate=true}ck(duplicate);
 const header="date,open,high,low,close,volume_eth,volume_quote\n",row="2026-11-27T02:00:00Z,100,121,99,110,1,110\n";
 ck(parseHours(header+row,s+H/2).length===0);ck(parseHours(header+row,s+H).length===1);
 for(const x of [row+row,"2026-11-27T02:00:00Z,100,90,99,110,1,110\n"]){let fail=false;try{parseHours(header+x,s+H)}catch{fail=true}ck(fail)}
 return n;
}
const fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path");
const {registration}=require("./register_forecast.cjs");
const {scorePath}=require("./research/path_score_v1.cjs");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const root="eth_data",ledger=path.join(root,"path_ledger_v43.jsonl");
function readLedger(){const s=fs.existsSync(ledger)?fs.readFileSync(ledger,"utf8"):"";if(s&&!s.endsWith("\n"))throw Error("incomplete ledger");return checkLedger(s.split(/\r?\n/).filter(x=>x.trim()).map(JSON.parse));}
function main(){
 const cmd=process.argv[2];
 if(cmd==="--test"){console.log(JSON.stringify({passed:integrationTests()}));return;}
 if(cmd==="--register"){
  const input=JSON.parse(fs.readFileSync(process.argv[3],"utf8"));
  if(!["Upbit_ETHKRW","Bitstamp_ETHUSD"].includes(input.market))throw Error("market");
  const lock=ledger+".lock",fd=fs.openSync(lock,"wx");
  try{
   const now=Date.now(),snapBytes=fs.readFileSync(path.join(root,"structure_snapshot_v43.json")),snap=JSON.parse(snapBytes),m=snap.markets[input.market],src=fs.readFileSync(path.join(root,input.market+"_1h.csv")),bars=parseHours(src.toString("utf8"),now),last=bars.at(-1);
   if(!last||last.t+3600000!==Date.parse(m.last_hour_closed)||last.c!==m.last_hour_close)throw Error("snapshot/hour mismatch");
   const record=createPath(input,{now,closed:last.t+3600000,close:last.c,snapshotTime:Date.parse(snap.generated_utc),fresh:snap.freshness_pass&&m.fresh_hourly,sourceHash:sha(src),expectedHash:m.input_sha256["1h"],snapshotHash:sha(snapBytes)},readLedger());
   const out=fs.openSync(ledger,"a");try{fs.writeFileSync(out,JSON.stringify(record)+"\n");fs.fsyncSync(out)}finally{fs.closeSync(out)}console.log(JSON.stringify(record));
  }finally{fs.closeSync(fd);fs.unlinkSync(lock)}return;
 }
 if(cmd!=="--score")throw Error("usage: --test | --register input.json | --score");
 const now=Date.now(),rows=readLedger(),markets={},scores=[];
 for(const m of new Set(rows.map(r=>r.market))){const b=fs.readFileSync(path.join(root,m+"_1h.csv"));markets[m]={sha256:sha(b),bars:parseHours(b.toString("utf8"),now)}}
 for(const r of rows){const d=markets[r.market];scores.push({id:r.id,market:r.market,label:r.label,revision_of:r.revision_of??null,scored_data_sha256:d.sha256,...scorePath(r,d.bars,now)})}
 const dest=path.join(root,"v43_output");fs.mkdirSync(dest,{recursive:true});const report={version:"v43-path-integration-1",generated_utc:new Date(now).toISOString(),registered:rows.length,status:rows.length?"touch_scoring_only":"no_registered_paths",scores};
 fs.writeFileSync(path.join(dest,"path_scores.tmp"),JSON.stringify(report,null,2)+"\n");fs.renameSync(path.join(dest,"path_scores.tmp"),path.join(dest,"path_scores.json"));console.log(JSON.stringify(report));
}
if(require.main===module)main();
