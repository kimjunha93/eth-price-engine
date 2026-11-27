import argparse, hashlib, json
from pathlib import Path
import pandas as pd
import numpy as np

DAY=pd.Timedelta(days=1); HOUR=pd.Timedelta(hours=1)
PAIRS=[(.05,.05),(.10,.10),(.20,.10),(.30,.10),(.30,.20),(.40,.20),(.20,.20),(.10,.20)]
COL=['open','high','low','close']
def load(p):
    d=pd.read_csv(p); d['date']=pd.to_datetime(d.date,utc=True,format='mixed',errors='raise'); d=d.set_index('date').sort_index()
    assert not d.index.has_duplicates and np.isfinite(d[COL]).all().all() and (d[COL]>0).all().all()
    assert (d.high>=d[['open','low','close']].max(axis=1)).all() and (d.low<=d[['open','high','close']].min(axis=1)).all()
    return d

def touch(o,h,l,u,d):
    a=h>=u; b=l<=d
    if a and b: return 'up' if o>=u else 'down' if o<=d else 'ambiguous'
    return 'up' if a else 'down' if b else None

def audit(dp,hp):
    d=load(dp); h=load(hp); g=h.resample('1D'); a=g.agg(dict(open='first',high='max',low='min',close='last')); a=a[g.size()==24]; z=d[COL].join(a,how='inner',rsuffix='_h'); ok=(z[COL].values==z[[x+'_h' for x in COL]].values).all(axis=1); valid=set(z.index[ok]); mismatch=int((~ok).sum()); rows=[]
    for u,l in PAIRS:
        for cap in (30,90,180):
            counts={k:0 for k in ('up','down','neither','ambiguous','censored')}; fixed=counts.copy(); resolutions={'up':0,'down':0,'same_hour':0,'unmatched_day':0}; next_t=d.index[0]; evaln=0; transitions=[]
            # Every seventh row, matching the original sampling grid; require continuous 60-day warmup.
            for i,(t,b) in enumerate(d.iterrows()):
                start=t+DAY
                if i<60 or i%7 or start<next_t or d.index[i]-d.index[i-60]!=60*DAY: continue
                U=b.close*(1+u); L=b.close*(1-l); lab='neither'; final='neither'; end=start+cap*DAY
                for j in range(1,cap+1):
                    tt=t+j*DAY
                    if tt not in d.index: lab=final='censored'; end=tt; break
                    v=d.loc[tt]; lab=touch(v.open,v.high,v.low,U,L)
                    if lab is None: lab=final='neither'; continue
                    end=tt+DAY; final=lab
                    if lab=='ambiguous':
                        if tt not in valid: resolutions['unmatched_day']+=1
                        else:
                            hh=h.loc[tt:tt+23*HOUR]
                            for q in hh.itertuples():
                                f=touch(q.open,q.high,q.low,U,L)
                                if f is not None:
                                    final=f; resolutions[f if f!='ambiguous' else 'same_hour']+=1; break
                        transitions.append({'day':str(tt),'daily':lab,'hourly':final})
                    break
                next_t=max(end,start+DAY); counts[lab]+=1; fixed[final]+=1
                if start>=pd.Timestamp('2023-01-01',tz='UTC') and final!='censored': evaln+=1
            assert sum(counts.values())==sum(fixed.values()) and counts['ambiguous']-fixed['ambiguous']==resolutions['up']+resolutions['down']
            rows.append(dict(up=u,down=l,cap=cap,daily=counts,hourly=fixed,resolutions=resolutions,evaluated_eligible_after_2023=evaln,transitions=transitions))
    return dict(version='v43-hourly-touch-audit-1',market='Upbit_ETHKRW',daily_rows=len(d),hourly_rows=len(h),daily_last=str(d.index[-1]),hourly_last=str(h.index[-1]),complete_day_overlap=len(z),exact_ohlc_days=len(valid),mismatch_days=mismatch,input_sha256={Path(p).name:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in (dp,hp)},policy='Only resolve ambiguous daily hits using complete 24-hour OHLC-matched days; remaining same-hour double touch remains ambiguous; no model promotion; counts across pairs overlap; 30/90/180 caps are for validation, not prediction dates.',results=rows)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('daily');p.add_argument('hourly');p.add_argument('output');args=p.parse_args();res=audit(args.daily,args.hourly);Path(args.output).write_text(json.dumps(res,indent=2));print(json.dumps({k:v for k,v in res.items() if k!='results'},indent=2));print(json.dumps([r for r in res['results'] if r['cap']==90],indent=2))
