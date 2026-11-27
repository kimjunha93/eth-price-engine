"""V4.3 guarded path audit. No live forecast or model promotion.
Run from repository root after collection. Separate exchange histories."""
from pathlib import Path
import json
import numpy as np
import pandas as pd

ROOT=Path("eth_data")
NOW=pd.Timestamp.now(tz="UTC")
KS=(.05,.10,.15,.20,.30,.40,.50)
COL=["h1","l2","h2"]

def load(name,tf):
    d=pd.read_csv(ROOT/f"{name}_{tf}.csv")
    d["date"]=pd.to_datetime(d.date,utc=True,format="mixed",errors="coerce")
    cols=["open","high","low","close"]
    for c in cols: d[c]=pd.to_numeric(d[c],errors="coerce")
    step=pd.Timedelta(hours=1) if tf=="1h" else pd.Timedelta(days=1)
    ok=d.date.notna() & ~d.date.duplicated(keep=False) & np.isfinite(d[cols]).all(axis=1) & (d[cols]>0).all(axis=1) & (d.high>=d[["open","close","low"]].max(axis=1)) & (d.low<=d[["open","close","high"]].min(axis=1)) & (d.date+step<=NOW)
    return d.loc[ok].set_index("date").sort_index()[cols]

def scan(b,k,step):
    out=[]; direction=0; extreme=None; prior=None; last=None; seg=0
    for t,h,l,c in b[["high","low","close"]].itertuples():
        if last is None or t-last!=step:
            if prior is not None: out.append((seg,*prior,None,None,last+step,"high" if direction==1 else "low","censored_gap"))
            seg+=1;direction=0;prior=None;extreme=None;seed=c;last=t;continue
        last=t;avail=t+step
        if direction==0:
            if c>=seed*(1+k):direction=1;extreme=(t,c)
            elif c<=seed*(1-k):direction=-1;extreme=(t,c)
            continue
        val=h if direction==1 else l
        if (direction==1 and val>extreme[1]) or (direction==-1 and val<extreme[1]):extreme=(t,val)
        hit=c<=extreme[1]*(1-k) if direction==1 else c>=extreme[1]*(1+k)
        if hit:
            p=(*extreme,avail)
            if prior is not None:out.append((seg,*prior,*p,"high" if direction==1 else "low","confirmed"))
            prior=p;direction=-direction;extreme=(t,c)
    if prior is not None:out.append((seg,*prior,None,None,last+step,"high" if direction==1 else "low","censored_end"))
    return pd.DataFrame(out,columns=["segment","start","start_price","start_available","extreme_bar","extreme_price","available","direction","status"])

def events(w):
    out=[]
    for s,g in w.groupby("segment"):
        g=g.sort_values("start_available").reset_index(drop=True)
        for i,a in g.iterrows():
            if a.direction!="low" or a.status!="confirmed":continue
            r=dict(asof=a.available,prior_drop=a.extreme_price/a.start_price,status="censored",end=g.available.max())
            b=g.iloc[i+1:i+4]
            if len(b)==3 and b.status.eq("confirmed").all() and list(b.direction)==["high","low","high"] and list(b.start_available)==[a.available,*b.available.iloc[:2]] and b.extreme_bar.ge(a.available).all():
                r.update(status="complete",end=b.available.iloc[-1],**dict(zip(COL,b.extreme_price.to_numpy()/a.extreme_price)))
            out.append(r)
    return pd.DataFrame(out,columns=["asof","prior_drop","status","end",*COL])

def independent(g):
    end=pd.Timestamp("1900-01-01",tz="UTC");keep=[]
    for a in g.sort_values("asof").itertuples():
        if a.asof>=end:keep.append(a.Index);end=a.end
    return g.loc[keep]

def audit(b,k,step):
    w=scan(b,k,step);c=w[w.status=="confirmed"]
    cut=b.index[int(len(b)*.8)]
    pre=scan(b[b.index<cut],k,step)
    assert pre[pre.status=="confirmed"].reset_index(drop=True).equals(c[c.available<=cut].reset_index(drop=True))
    assert not ((c.start_available>c.extreme_bar+step)|(c.extreme_bar+step>c.available)|(c.start_available>=c.available)).any()
    e=events(w);complete=e[e.status=="complete"]
    ev=independent(e[e["asof"]>=pd.Timestamp("2023-01-01",tz="UTC")])
    err={m:[] for m in ["flat","marginal","medoid","neighbor_medoid"]};skipped=0
    for a in ev[ev.status=="complete"].itertuples():
        tr=independent(e[e.end<a.asof]);tr=tr[tr.status=="complete"]
        if len(tr)<20:skipped+=1;continue
        x=tr[COL].to_numpy();z=np.log(x);med=np.median(z,axis=0);y=np.array([a.h1,a.l2,a.h2]);p=x[np.argmin(np.abs(z-med).sum(axis=1))]
        near=tr.iloc[np.argsort(abs(np.log(tr.prior_drop.to_numpy()/a.prior_drop)))[:20]]
        zz=np.log(near[COL].to_numpy());pp=np.exp(zz[np.argmin(abs(zz-np.median(zz,axis=0)).sum(axis=1))])
        for m,v in [("flat",np.ones(3)),("marginal",np.exp(med)),("medoid",p),("neighbor_medoid",pp)]:err[m].append(float(np.mean(abs(v/y-1))*100))
    return dict(confirmed_waves=len(c),complete_paths=len(complete),censored_paths=len(e)-len(complete),nonoverlap_complete=int((independent(e).status=="complete").sum()),hold_count=int((complete.l2>=1).sum()),fail_count=int((complete.l2<1).sum()),evaluated=len(err["flat"]),insufficient_train=skipped,evaluation_censored=int((ev.status!="complete").sum()),mape={m:float(np.mean(v)) if v else None for m,v in err.items()},prefix_test=True)

def main():
    result={"version":"v4.3-path-audit-1","generated_utc":str(NOW),"status":"exploratory_only","markets":{},"limitations":"2023+ reused evaluation; within-scale nonoverlap only; no calibrated probability, live forecast, or full-cycle validation."}
    for name in ["Upbit_ETHKRW","Bitstamp_ETHUSD"]:
        h=load(name,"1h");d=load(name,"1d")
        g=h.resample("4h");f=g.agg({"open":"first","high":"max","low":"min","close":"last"});f=f[g.size()==4]
        a={}
        for tf,b,step in [("1h",h,pd.Timedelta(hours=1)),("4h",f,pd.Timedelta(hours=4)),("1d",d,pd.Timedelta(days=1))]:
            if b.empty:raise RuntimeError(f"Empty {name} {tf}")
            a[tf]={"bars":len(b),"last_closed":str(b.index[-1]+step),"scales":{str(k):audit(b,k,step) for k in KS}}
        result["markets"][name]=a
    p=ROOT/"path_audit_v43.json";tmp=p.with_suffix(".tmp");tmp.write_text(json.dumps(result,indent=2,allow_nan=False));tmp.replace(p)
    print("V4.3 exploratory path audit written; no live forecast.")
if __name__=="__main__":main()
