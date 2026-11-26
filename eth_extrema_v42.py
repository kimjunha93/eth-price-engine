"""Causal daily-close reversal events with intraday extrema and chronological baseline test."""
import json
from pathlib import Path
import numpy as np
import pandas as pd
ROOT=Path("eth_data")
NOW=pd.Timestamp.now(tz="UTC")
def run(m):
    d=pd.read_csv(ROOT/(m+"_1d.csv"))
    d.date=pd.to_datetime(d.date,utc=True,errors="coerce")
    cols=["open","high","low","close"]
    for c in cols: d[c]=pd.to_numeric(d[c],errors="coerce")
    ok=d.date.notna() & ~d.date.duplicated(keep=False) & np.isfinite(d[cols]).all(axis=1) & (d[cols]>0).all(axis=1) & (d.high>=d[["open","close","low"]].max(axis=1)) & (d.low<=d[["open","close","high"]].min(axis=1)) & (d.date+pd.Timedelta(days=1)<=NOW)
    d=d.loc[ok].sort_values("date")
    out={}
    for p in [.05,.10,.15,.20]:
        events=[]; censored=0
        for _,s in d.groupby(d.date.diff().ne(pd.Timedelta(days=1)).cumsum()):
            mode=0; peak=trough=None; start=None; extreme=None
            for r in s.itertuples():
                if mode==0:
                    peak=r.close if peak is None else max(peak,r.close)
                    trough=r.close if trough is None else min(trough,r.close)
                    if r.close<=peak*(1-p): mode=-1
                    elif r.close>=trough*(1+p): mode=1
                    else: continue
                    start=r; extreme=r; peak=trough=r.close
                    continue
                if mode==-1:
                    if r.low<extreme.low: extreme=r
                    trough=min(trough,r.close)
                    flip=r.close>=trough*(1+p)
                else:
                    if r.high>extreme.high: extreme=r
                    peak=max(peak,r.close)
                    flip=r.close<=peak*(1-p)
                if flip:
                    price=extreme.low if mode==-1 else extreme.high
                    events.append(dict(kind="low" if mode==-1 else "high",start=str(start.date),confirmed=str(r.date),extreme_date=str(extreme.date),price=float(price),anchor=float(start.close),ratio=float(price/start.close)))
                    mode=-mode; start=r; extreme=r; peak=trough=r.close
            if mode: censored+=1
        # Fixed split, no tuning; labels known only after confirmation.
        split="2024-01-01"; scores={}
        for kind in ["low","high"]:
            train=[e for e in events if e["kind"]==kind and e["confirmed"][:10]<split]
            test=[e for e in events if e["kind"]==kind and e["start"][:10]>=split]
            med=float(np.median([e["ratio"] for e in train])) if train else None
            scores[kind]={"train":len(train),"test":len(test),"median_ratio":med,"baseline_mae_pct":float(np.mean([abs(1-e["ratio"])*100 for e in test])) if test else None,"historical_mae_pct":float(np.mean([abs(med-e["ratio"])*100 for e in test])) if test and med is not None else None}
        out[str(p)]={"completed":len(events),"censored_segment_tails":censored,"recent":events[-6:],"fixed_split_exploratory":scores}
    return out
if __name__=="__main__":
    result={"version":"extrema-exploratory-0.1","generated_utc":str(NOW),"limitations":"Daily intraday extrema within close-confirmed legs; boundary candle shared, no hourly order resolution; fixed split exploratory, no forecast.","markets":{m:run(m) for m in ["Upbit_ETHKRW","Bitstamp_ETHUSD"]}}
    (ROOT/"extrema_summary.json").write_text(json.dumps(result,indent=2,allow_nan=False))
