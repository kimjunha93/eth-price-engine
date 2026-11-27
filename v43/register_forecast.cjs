function registration(input, env, existing) {
 const allowed=["Upbit_ETHKRW","Bitstamp_ETHUSD"];
 const H=3600000, t=env.now, issued=new Date(t).toISOString(), start=Math.floor(t/H)*H+H;
 const fail=s=>{throw Error(s)};
 if(!Number.isFinite(t)||!allowed.includes(input.market)||!["up","down"].includes(input.side))fail("market/side/time");
 if(typeof input.id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(input.id)||typeof input.model!=="string"||!input.model.trim()||/synthetic|^test$/i.test(input.model))fail("identity");
 if(!Number.isInteger(input.horizon_hours)||input.horizon_hours<1||input.horizon_hours>8760)fail("observation cap");
 if(![input.anchor,input.target,input.invalidation,env.close].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>0))fail("price");
 if(input.anchor!==env.close)fail("anchor mismatch");
 if(input.side==="up"?!(input.invalidation<input.anchor&&input.anchor<input.target):!(input.target<input.anchor&&input.anchor<input.invalidation))fail("barriers");
 if(!env.fresh||!Number.isFinite(env.closed)||env.closed%H!==0||env.closed>t||t-env.closed>2*H||!Number.isFinite(env.snapshotTime)||env.snapshotTime<env.closed||env.snapshotTime>t||t-env.snapshotTime>2*H)fail("stale or future input");
 if(![env.sourceHash,env.snapshotHash].every(x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x))||env.sourceHash!==env.expectedHash)fail("source version mismatch");
 const ids=new Set();for(const r of existing){if(ids.has(r.id))fail("existing duplicate");ids.add(r.id)}
 if(ids.has(input.id))fail("duplicate id");
 if(input.revision_of!==undefined){const p=existing.find(r=>r.id===input.revision_of);if(!p||p.market!==input.market||Date.parse(p.asof)>=start)fail("invalid revision");}
 return {id:input.id,asof:new Date(start).toISOString(),issued_at:issued,market:input.market,model:input.model,data_version:env.sourceHash,snapshot_sha256:env.snapshotHash,anchor_closed_at:new Date(env.closed).toISOString(),anchor:input.anchor,side:input.side,target:input.target,invalidation:input.invalidation,horizon_hours:input.horizon_hours,kind:"live",...(input.revision_of!==undefined?{revision_of:input.revision_of}:{})};
}
function tests(){
 const H=3600000, t=Date.parse("2026-11-27T01:15:00Z"),hash="a".repeat(64);
 const e={now:t,closed:t-15*60000,close:100,snapshotTime:t-60000,fresh:true,sourceHash:hash,expectedHash:hash,snapshotHash:"b".repeat(64)};
 const i={id:"example-1",market:"Upbit_ETHKRW",model:"v43-test-fixture",side:"up",anchor:100,target:110,invalidation:90,horizon_hours:48};
 let n=0;function check(x){if(!x)throw Error("test failed "+n);n++}
 const r=registration(i,e,[]);check(r.asof==="2026-11-27T02:00:00.000Z");check(r.issued_at==="2026-11-27T01:15:00.000Z");check(registration({...i,side:"down",target:90,invalidation:110},e,[]).side==="down");check(registration({...i,id:"revision",revision_of:"example-1"},{...e,now:t+H},[r]).revision_of==="example-1");
 for(const [a,b,c] of [[{anchor:99},{},[]],[{target:99},{},[]],[{horizon_hours:0},{},[]],[{market:"bad"},{},[]],[{target:NaN},{},[]],[{model:"synthetic"},{},[]],[{},{fresh:false},[]],[{},{closed:e.closed-3*H},[]],[{},{closed:e.closed+H},[]],[{},{snapshotTime:t+1},[]],[{},{expectedHash:"c".repeat(64)},[]],[{},{},[r]],[{revision_of:"missing"},{},[]],[{id:"rev",revision_of:r.id},{},[r]]]){
 let rejected=false;try{registration({...i,...a},{...e,...b},c)}catch{rejected=true}check(rejected)}
 return n;
}

const fs=require("node:fs"), crypto=require("node:crypto"), path=require("node:path");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const parseDate=s=>Date.parse(s.replace(" ","T").replace(/\+00:00$/,"Z"));
function main(){
 if(process.argv[2]==="--test"){console.log(JSON.stringify({passed:tests()}));return;}
 if(process.argv[2]!=="--register"||!process.argv[3])throw Error("usage: node v43/register_forecast.cjs --register input.json | --test");
 const input=JSON.parse(fs.readFileSync(process.argv[3],"utf8"));
 if(!["Upbit_ETHKRW","Bitstamp_ETHUSD"].includes(input.market))throw Error("market");
 const root="eth_data", ledger=path.join(root,"forecast_ledger_v43.jsonl"), lock=ledger+".lock";
 const fd=fs.openSync(lock,"wx");
 try{
 const snapBytes=fs.readFileSync(path.join(root,"structure_snapshot_v43.json")),snap=JSON.parse(snapBytes),m=snap.markets[input.market];
 const source=fs.readFileSync(path.join(root,input.market+"_1h.csv"));
 const lines=source.toString("utf8").trimEnd().split(/\r?\n/), row=lines.at(-1).split(",");
 const closed=parseDate(row[0])+3600000, close=Number(row[4]), now=Date.now();
 if(closed!==parseDate(m.last_hour_closed)||close!==m.last_hour_close)throw Error("snapshot/hourly mismatch");
 const old=fs.existsSync(ledger)?fs.readFileSync(ledger,"utf8"):"";
 if(old&&!old.endsWith("\n"))throw Error("incomplete ledger tail");
 const existing=old.split(/\r?\n/).filter(s=>s.trim()).map(JSON.parse);
 const record=registration(input,{now,closed,close,snapshotTime:parseDate(snap.generated_utc),fresh:snap.freshness_pass&&m.fresh_hourly,sourceHash:sha(source),expectedHash:m.input_sha256["1h"],snapshotHash:sha(snapBytes)},existing);
 const out=fs.openSync(ledger,"a");try{fs.writeFileSync(out,JSON.stringify(record)+"\n");fs.fsyncSync(out)}finally{fs.closeSync(out)}
 console.log(JSON.stringify(record));
 }finally{fs.closeSync(fd);fs.unlinkSync(lock)}
}
if(require.main===module)main();
module.exports={registration,tests};
