"""Exploratory causal close-based directional changes; not a forecast."""
import json
from pathlib import Path
import pandas as pd
import numpy as np

ROOT=Path("eth_data")
NOW=pd.Timestamp.now(tz="UTC")
def scan(d, pct=None, mult=None):
    piv=[]; censored=0
    for _,s in d.groupby(d.date.diff().ne(pd.Timedelta(days=1)).cumsum()):
        if len(s)<2: continue
        c=s.close.to_numpy(); a=s.atr.to_numpy(); t=s.date.tolist()
        mode=0; hi=lo=0
        def threshold(i):
            return c[i]*pct if pct is not None else a[i]*mult
        for i in range(1,len(s)):
            if mode==0:
                if c[i]>c[hi]: hi=i
                if c[i]<c[lo]: lo=i
                if c[i]-c[lo]>=threshold(lo):
                    mode=1; hi=i
                elif c[hi]-c[i]>=threshold(hi):
                    mode=-1; lo=i
            elif mode==1:
                if c[i]>c[hi]: hi=i
                elif c[hi]-c[i]>=threshold(hi):
                    piv.append(dict(segment=str(t[0]),kind="high",price=float(c[hi]),date=str(t[hi]),confirmed=str(t[i]),delay=i-hi))
                    mode=-1; lo=i
            else:
                if c[i]<c[lo]: lo=i
                elif c[i]-c[lo]>=threshold(lo):
                    piv.append(dict(segment=str(t[0]),kind="low",price=float(c[lo]),date=str(t[lo]),confirmed=str(t[i]),delay=i-lo))
                    mode=1; hi=i
        censored+=1
    legs=[]; paths=[]
    for x,y in zip(piv,piv[1:]):
        if x["segment"]==y["segment"]:
            legs.append(dict(kind=y["kind"],ret=100*(y["price"]/x["price"]-1)))
    # Non-overlapping complete low-high-low-high sequences; descriptive only.
    i=0
    while i+3<len(piv):
        p=piv[i:i+4]
        if len({x["segment"] for x in p})==1 and [x["kind"] for x in p]==["low","high","low","high"]:
            z=[x["price"] for x in p]
            paths.append([100*(z[j+1]/z[j]-1) for j in range(3)])
            i+=4
        else: i+=1
    def dist(v):
        return {"n":len(v),"quantiles":dict(zip(["10","25","50","75","90"],map(float,np.quantile(v,[.1,.25,.5,.75,.9])))) if len(v) else None}
    return {"pivot_count":len(piv),"censored_segment_tails":censored,"up":dist([x["ret"] for x in legs if x["kind"]=="high"]),"down":dist([x["ret"] for x in legs if x["kind"]=="low"]),"complete_nonoverlap_paths":len(paths),"path_marginals_not_joint_forecast":[dist([x[j] for x in paths]) for j in range(3)],"recent_confirmed_pivots":piv[-8:]}
def main():
    out={"version":"wave-exploratory-0.1","generated_utc":str(NOW),"status":"descriptive_close_pivots_only","markets":{}}
    for market in ["Upbit_ETHKRW","Bitstamp_ETHUSD"]:
        d=pd.read_csv(ROOT/(market+"_1d.csv"))
        d.date=pd.to_datetime(d.date,utc=True,errors="coerce")
        for c in ["open","high","low","close"]: d[c]=pd.to_numeric(d[c],errors="coerce")
        valid=d.date.notna() & ~d.date.duplicated(keep=False) & np.isfinite(d[["open","high","low","close"]]).all(axis=1) & (d[["open","high","low","close"]]>0).all(axis=1) & (d.high>=d[["open","close","low"]].max(axis=1)) & (d.low<=d[["open","close","high"]].min(axis=1)) & (d.date+pd.Timedelta(days=1)<=NOW)
        d=d.loc[valid].sort_values("date").reset_index(drop=True)
        d["atr"]=np.nan
        for _,s in d.groupby(d.date.diff().ne(pd.Timedelta(days=1)).cumsum()):
            tr=pd.concat([s.high-s.low,(s.high-s.close.shift()).abs(),(s.low-s.close.shift()).abs()],axis=1).max(axis=1)
            d.loc[s.index,"atr"]=tr.rolling(14).mean()
        out["markets"][market]={"rows":len(d),"models":{**{f"DC_{p}pct":scan(d,pct=p/100) for p in [5,10,15,20]},**{f"ATR_{m}":scan(d.dropna(subset=["atr"]),mult=m) for m in [2,3,4]}}}
    (ROOT/"wave_summary.json").write_text(json.dumps(out,indent=2,allow_nan=False),encoding="utf-8")
if __name__=="__main__": main()
