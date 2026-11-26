"""Quality alignment and exploratory causal nearest-neighbor fixed-horizon benchmark."""
import json
from pathlib import Path
import numpy as np
import pandas as pd
ROOT=Path("eth_data")
NOW=pd.Timestamp.now(tz="UTC")
from eth_touch_v42 import load
def quality(m):
    h=load(m,"1h",1)
    d=load(m,"1d",24)
    out={}
    for hour in sorted(set(d.index.hour)):
        a=d[d.index.hour==hour]
        g=h.resample("1D",offset=pd.Timedelta(hours=int(hour)))
        b=g.agg({"open":"first","high":"max","low":"min","close":"last","volume_eth":"sum"})
        b=b.loc[g.close.count()==24]
        j=a.join(b,lsuffix="_daily",rsuffix="_hourly",how="inner")
        metrics={}
        for k in ["open","high","low","close","volume_eth"]:
            x=j[k+"_daily"]; y=j[k+"_hourly"]
            good=x.notna() & y.notna()
            metrics[k]={"n":int(good.sum()),"match_fraction":float(np.isclose(x[good],y[good],rtol=1e-6,atol=1e-8).mean()) if good.any() else None}
        out[str(hour)]={"daily_rows":len(a),"missing_daily_slots":int((a.index[-1]-a.index[0])/pd.Timedelta(days=1))+1-len(a),"overlap":len(j),"metrics":metrics}
    return out
def neighbors(m):
    d=load(m,"1d",24)
    rows=[]
    for _,s in d.groupby(d.index.to_series().diff().ne(pd.Timedelta(days=1)).cumsum()):
        c=s.close
        f=pd.DataFrame({str(n):np.log(c/c.shift(n)) for n in [3,7,14,28,60,90]})
        f["vol"]=np.log(c/c.shift()).rolling(28).std()
        f["drawdown"]=np.log(c/c.rolling(90).max())
        for i in range(90,len(s)-28,28):
            x=f.iloc[i].to_numpy()
            if not np.isfinite(x).all(): continue
            future=s.iloc[i+1:i+29]
            rows.append((s.index[i],future.index[-1],x,np.array([future.low.min()/c.iloc[i],future.high.max()/c.iloc[i]])))
    split=pd.Timestamp("2024-01-01",tz="UTC")
    train=[r for r in rows if r[1]<split]; test=[r for r in rows if r[0]>=split]
    if len(train)<30 or not test: return {"train":len(train),"test":len(test),"status":"insufficient"}
    X=np.stack([r[2] for r in train]); Y=np.stack([r[3] for r in train])
    mu=X.mean(0); sd=X.std(0); sd[sd==0]=1
    errors={"current":[],"median":[],"knn15":[]}
    for _,_,x,y in test:
        ix=np.argsort(np.linalg.norm((X-x)/sd,axis=1))[:15]
        for k,p in [("current",np.ones(2)),("median",np.median(Y,axis=0)),("knn15",np.median(Y[ix],axis=0))]:
            errors[k].append(abs(p-y)*100)
    return {"train":len(train),"test":len(test),"mae_pct_of_anchor_low_high":{k:np.mean(v,axis=0).tolist() for k,v in errors.items()},"status":"exploratory_fixed_28day_not_wave_extrema"}
if __name__=="__main__":
    markets=["Upbit_ETHKRW","Bithumb_ETHKRW","Bitstamp_ETHUSD","Kraken_ETHUSD"]
    result={"version":"quality-neighbors-0.1","generated_utc":str(NOW),"quality":{m:quality(m) for m in markets},"neighbors":{m:neighbors(m) for m in ["Upbit_ETHKRW","Bitstamp_ETHUSD"]}}
    (ROOT/"research_summary.json").write_text(json.dumps(result,indent=2,allow_nan=False))
