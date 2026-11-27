"""V4.3 structure snapshot: descriptive reference, never an automatic live forecast."""
import hashlib,json
from pathlib import Path
import numpy as np
import pandas as pd
from path_audit import load,scan,events,independent,KS,ROOT,NOW

def snapshot(name):
    h=load(name,"1h");d=load(name,"1d")
    if h.empty or d.empty:raise RuntimeError("Empty market "+name)
    grp=h.resample("4h");f=grp.agg({"open":"first","high":"max","low":"min","close":"last"});f=f[grp.size()==4]
    out={"last_hour_close":float(h.close.iloc[-1]),"last_hour_closed":str(h.index[-1]+pd.Timedelta(hours=1)),"fresh_hourly":bool(NOW-h.index[-1]-pd.Timedelta(hours=1)<=pd.Timedelta(hours=2)),"last_day_close":float(d.close.iloc[-1]),"last_day_closed":str(d.index[-1]+pd.Timedelta(days=1)),"fresh_daily":bool(NOW-d.index[-1]-pd.Timedelta(days=1)<=pd.Timedelta(hours=26)),"scales":{},"input_sha256":{tf:hashlib.sha256((ROOT/f"{name}_{tf}.csv").read_bytes()).hexdigest() for tf in ("1h","1d")}}
    for tf,b,step in [("1h",h,pd.Timedelta(hours=1)),("4h",f,pd.Timedelta(hours=4)),("1d",d,pd.Timedelta(days=1))]:
        if b.empty:continue
        cutoff=b.index[-1]+step;scales={}
        for k in KS:
            w=scan(b,k,step);live=w[w.status=="censored_end"]
            if live.empty:
                scales[str(k)]={"state":"unresolved_after_gap"};continue
            a=live.iloc[-1];side=a.direction;start=a.start_available
            s=b.loc[start-step:];age=int((cutoff-start)/step)
            if len(s)!=age+1 or age<0 or s.index.to_series().diff().dropna().ne(step).any():
                scales[str(k)]={"state":"unresolved_gap"};continue
            base=float(s.close.iloc[0]);follow=s.iloc[1:]
            obs=float(min(base,follow.low.min())) if side=="low" and len(follow) else float(max(base,follow.high.max())) if side=="high" and len(follow) else base
            tr=w[(w.status=="confirmed")&(w.direction==side)&(w.available<cutoff)].copy()
            tr["base"]=b.close.reindex(pd.DatetimeIndex(tr.start_available-step)).to_numpy()
            ratio=(tr.extreme_price/tr.base).dropna()
            ref=ratio.quantile([.25,.5,.75]).to_numpy()*base if len(ratio)>=20 else None
            if ref is not None:ref=np.minimum(ref,obs) if side=="low" else np.maximum(ref,obs)
            e=events(w);hist=independent(e[e.end<cutoff]);complete=hist[hist.status=="complete"]
            # Reference distribution includes failures. Do not join this to an unconfirmed low.
            path={"n":len(complete),"censored":int((hist.status!="complete").sum()),"status":"conditional_reference_only"}
            if len(complete)>=20:
                path["ratios_q25_q50_q75"]={c:[float(v) for v in complete[c].quantile([.25,.5,.75])] for c in ("h1","l2","h2")}
                path["low_held_count"]=int((complete.l2>=1).sum())
            scales[str(k)]={"state":"active_"+side,"start_available":str(start),"elapsed_bars":age,"observed_extreme":obs,"n_history":len(ratio),"censored_history":int(((w.status!="confirmed")&(w.direction==side)&(w.available<cutoff)).sum()),"reference_q25_q50_q75":[float(v) for v in ref] if ref is not None else None,"range_status":"descriptive_unvalidated_at_current_age" if ref is not None else "insufficient_history","path":path}
        out["scales"][tf]={"last_closed":str(cutoff),"data_age_hours":float((NOW-cutoff)/pd.Timedelta(hours=1)),"states":scales}
    return out

def main():
    out={"version":"v43-structure-1","generated_utc":str(NOW),"status":"descriptive_only","model_policy":"historical median reference; no calibrated probability or full-cycle path; no live forecast registration","markets":{m:snapshot(m) for m in ["Upbit_ETHKRW","Bitstamp_ETHUSD"]}}
    out["freshness_pass"]=all(x["fresh_hourly"] and x["fresh_daily"] for x in out["markets"].values())
    p=ROOT/"structure_snapshot_v43.json";tmp=p.with_suffix(".tmp");tmp.write_text(json.dumps(out,indent=2,allow_nan=False));tmp.replace(p)
    print("V4.3 structure snapshot saved; freshness pass:",out["freshness_pass"])
if __name__=="__main__":main()
