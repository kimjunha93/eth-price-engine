import json, hashlib
from pathlib import Path
import pandas as pd
import numpy as np

def analyze(path, now, hour):
    d=pd.read_csv(path)
    d.date=pd.to_datetime(d.date,utc=True,errors='coerce')
    cols=['open','high','low','close']
    d[cols]=d[cols].apply(pd.to_numeric,errors='coerce')
    c=d[cols]
    valid=d.date.notna() & ~d.date.duplicated(False) & np.isfinite(c).all(axis=1) & (c>0).all(axis=1) & (d.high>=c.max(axis=1)) & (d.low<=c.min(axis=1))
    s=d[valid & (d.date.dt.hour==hour) & (d.date+pd.Timedelta(days=1)<=now)].sort_values('date').set_index('date')
    if s.empty: raise ValueError('no valid closed bars')
    states=[]
    for th in [.05,.1]:
        events=[]
        for _,g in s.groupby(s.index.to_series().diff().ne(pd.Timedelta(days=1)).cumsum()):
            mode=0; hi=lo=ref=float(g.close.iloc[0]); start=0
            for i,c in enumerate(g.close):
                if not mode:
                    hi=max(hi,c); lo=min(lo,c)
                    if c<=hi*(1-th): mode=-1
                    elif c>=lo*(1+th): mode=1
                    else: continue
                    start=i; ref=c; continue
                ref=min(ref,c) if mode<0 else max(ref,c)
                if not (c>=ref*(1+th) if mode<0 else c<=ref*(1-th)): continue
                if start>=90: events.append((mode,float(g.close.iloc[start]),g.iloc[start+1:i+1]))
                mode=-mode; start=i; ref=c
        age=len(g)-1-start; anchor=float(g.close.iloc[start]); col='low' if mode<0 else 'high'
        f=g.iloc[start+1:]
        extreme=float(f[col].min() if mode<0 else f[col].max()) if age and mode else None
        ratios=[]
        for direction,a,h in events:
            if direction!=mode or len(h)<=age: continue
            if age:
                v=h.iloc[:age][col]
                observed=float(v.min() if mode<0 else v.max())
                if abs(observed/a-extreme/anchor)>.05: continue
            ratios.append(float(h[col].min() if mode<0 else h[col].max())/a)
        q=np.quantile(ratios,[.1,.25,.5,.75,.9])*anchor if len(ratios)>=20 and mode else None
        if q is not None and extreme is not None: q=np.minimum(q,extreme) if mode<0 else np.maximum(q,extreme)
        states.append(dict(scale=th,mode=mode,age=age,start=str(g.index[start]),anchor=anchor,observed_extreme=extreme,matched=len(ratios),diagnostic_quantiles=q.tolist() if q is not None else None,status='withheld'))
    return dict(rows=len(s),invalid=int((~valid).sum()),last_closed_start=str(s.index[-1]),close=float(s.close.iloc[-1]),stale=bool(now-s.index[-1]-pd.Timedelta(days=1)>pd.Timedelta(days=1)),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),states=states)

def main():
    now=pd.Timestamp.now(tz='UTC')
    root=Path('eth_data')
    result=dict(version='4.2-integration-14',asof=str(now),forecast_status='withheld',reason='No independently validated path model',markets={})
    for market,hour in [('Upbit_ETHKRW',0),('Bitstamp_ETHUSD',0),('Bithumb_ETHKRW',15)]:
        result['markets'][market]=analyze(root/f'{market}_1d.csv',now,hour)
    (root/'forecast_diagnostics.json').write_text(json.dumps(result,indent=2,allow_nan=False))
    print(json.dumps(result,indent=2,allow_nan=False))
if __name__=='__main__': main()
