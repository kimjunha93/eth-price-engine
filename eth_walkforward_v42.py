"""Expanding chronological evaluation on common close-confirmed leg labels.
Exploratory only: historical data already inspected; no production forecast.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
ROOT=Path("eth_data")
from eth_touch_v42 import load
def run(m):
    d=load(m,"1d",24)
    events=[]
    for _,s in d.groupby(d.index.to_series().diff().ne(pd.Timedelta(days=1)).cumsum()):
        c=s.close.to_numpy(); dates=s.index
        mode=0; hi=lo=c[0]; start=None
        for i in range(1,len(c)):
            v=c[i]
            if mode==0:
                hi=max(hi,v); lo=min(lo,v)
                if v<=hi*.90: mode=-1
                elif v>=lo*1.10: mode=1
                else: continue
                start=i; extreme=v; continue
            extreme=min(extreme,v) if mode==-1 else max(extreme,v)
            flip=v>=extreme*1.10 if mode==-1 else v<=extreme*.90
            if flip:
                if start>=90:
                    x=np.array([np.log(c[start]/c[start-k]) for k in [3,7,14,28,60,90]]+[np.std(np.diff(np.log(c[start-28:start+1]))),np.log(c[start]/max(c[start-89:start+1]))])
                    events.append((dates[start],dates[i],mode,x,extreme/c[start]))
                mode=-mode; start=i; extreme=v
    out={}
    for direction in [-1,1]:
        errors={k:[] for k in ["current","median","knn15"]}; years={}
        for t,end,mode,x,y in events:
            if mode!=direction or t.year<2022: continue
            train=[e for e in events if e[2]==mode and e[1]<t]
            if len(train)<30: continue
            X=np.stack([e[3] for e in train]); Y=np.array([e[4] for e in train])
            sd=X.std(0); sd[sd==0]=1
            ix=np.argsort(np.linalg.norm((X-x)/sd,axis=1))[:15]
            preds={"current":1,"median":np.median(Y),"knn15":np.median(Y[ix])}
            for k,v in preds.items(): errors[k].append(float(abs(v-y)*100))
            years[str(t.year)]=years.get(str(t.year),0)+1
        out[str(direction)]={"n":len(errors["current"]),"years":years,"mae_pct_anchor":{k:float(np.mean(v)) if v else None for k,v in errors.items()},"adoption":"blocked_no_untouched_test"}
    return out
if __name__=="__main__":
    result={"version":"walkforward-exploratory-0.1","status":"no_production_forecast","label":"10% close-confirmed leg extreme after observable entry; not intraday","markets":{m:run(m) for m in ["Upbit_ETHKRW","Bitstamp_ETHUSD"]}}
    (ROOT/"walkforward_summary.json").write_text(json.dumps(result,indent=2,allow_nan=False))
