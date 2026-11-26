"""Exploratory first-touch test; fixed symmetric 5/10% barriers, 28-day censoring."""
import json
from pathlib import Path
import pandas as pd
import numpy as np
ROOT=Path("eth_data")
NOW=pd.Timestamp.now(tz="UTC")
def load(m,tf,h):
    d=pd.read_csv(ROOT/(m+"_"+tf+".csv"))
    d.date=pd.to_datetime(d.date,utc=True,errors="coerce")
    c=["open","high","low","close"]
    for k in c: d[k]=pd.to_numeric(d[k],errors="coerce")
    ok=d.date.notna() & ~d.date.duplicated(keep=False) & np.isfinite(d[c]).all(axis=1) & (d[c]>0).all(axis=1) & (d.high>=d[["open","close","low"]].max(axis=1)) & (d.low<=d[["open","close","high"]].min(axis=1)) & (d.date+pd.Timedelta(hours=h)<=NOW)
    return d.loc[ok].sort_values("date").set_index("date")
def run(m):
    d=load(m,"1d",24); h=load(m,"1h",1)
    out={}
    for p in [.05,.10]:
        events=[]
        for i in range(0,len(d)-28,28):
            t=d.index[i]; a=d.close.iloc[i]; up=a*(1+p); dn=a*(1-p)
            future=d.iloc[i+1:i+29]
            if not future.index.equals(pd.date_range(t+pd.Timedelta(days=1),periods=28,freq="D")):
                label="gap"
            else:
                label="neither"
                for dt,r in future.iterrows():
                    u=r.high>=up; l=r.low<=dn
                    if not (u or l): continue
                    if u and l:
                        sub=h.loc[(h.index>=dt)&(h.index<dt+pd.Timedelta(days=1))]
                        label="unknown"
                        if sub.index.equals(pd.date_range(dt,periods=24,freq="h")):
                            for q in sub.itertuples():
                                x=q.high>=up; y=q.low<=dn
                                if x or y:
                                    label="unknown" if x and y else "up" if x else "down"
                                    break
                    else: label="up" if u else "down"
                    break
            events.append((t,label))
        split=pd.Timestamp("2024-01-01",tz="UTC")
        labels=["up","down","neither","unknown","gap"]
        train=[l for t,l in events if t+pd.Timedelta(days=29)<=split]
        test=[l for t,l in events if t>=split]
        counts=lambda x:{k:x.count(k) for k in labels}
        n=len(train)-train.count("gap")-train.count("unknown")
        probs={k:train.count(k)/n for k in labels[:3]} if n else None
        known=[l for l in test if l in labels[:3]]
        brier=float(np.mean([sum((probs[k]-(l==k))**2 for k in labels[:3]) for l in known])) if probs and known else None
        out[str(p)]={"train":counts(train),"test":counts(test),"empirical_baseline_multiclass_brier":brier,"test_scored":len(known)}
    return out
if __name__=="__main__":
    result={"version":"touch-exploratory-0.1","generated_utc":str(NOW),"status":"symmetric benchmark only, not current target probabilities","markets":{m:run(m) for m in ["Upbit_ETHKRW","Bitstamp_ETHUSD"]}}
    (ROOT/"touch_summary.json").write_text(json.dumps(result,indent=2,allow_nan=False))
