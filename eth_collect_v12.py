"""Public ETH candle incremental collector. Python 3.10+, pip install requests pandas."""
import argparse, time, json
from pathlib import Path
import pandas as pd
import requests

COLS=['date','open','high','low','close','volume_eth','volume_quote']
S=requests.Session()
def get(url,params):
    for i in range(5):
        try:
            r=S.get(url,params=params,timeout=40); r.raise_for_status(); return r.json()
        except (requests.RequestException,ValueError):
            if i==4: raise
            time.sleep(2**i)

def load(p):
    if not p.exists(): return pd.DataFrame(columns=COLS)
    with p.open(encoding='utf-8-sig') as f: first=f.readline().lower()
    d=pd.read_csv(p,skiprows=0 if 'open' in first and 'close' in first else 1)
    d.columns=[x.lower().replace(' ','_') for x in d.columns]
    d=d.rename(columns={'volume_krw':'volume_quote','volume_usd':'volume_quote'})
    if 'volume_quote' not in d: d['volume_quote']=float('nan')
    d=d[COLS].copy(); d['date']=pd.to_datetime(d.date.astype(str).str.replace(r' (\d{2})-(AM|PM)$',r' \1:00 \2',regex=True),utc=True,format='mixed'); return d

def clean(d,step,now):
    d=d.copy(); d['date']=pd.to_datetime(d.date,utc=True,format='mixed')
    for c in COLS[1:]: d[c]=pd.to_numeric(d[c],errors='coerce')
    bad=d.date.isna()|d[COLS[1:6]].isna().any(axis=1)|(d[['open','high','low','close']]<=0).any(axis=1)|(d.volume_eth<0)|(d.high<d[['open','close','low']].max(axis=1))|(d.low>d[['open','close','high']].min(axis=1))
    dup=int(d.date.duplicated().sum()); invalid=int(bad.sum()); d=d.loc[~bad & (d.date+pd.Timedelta(seconds=step)<=now)].drop_duplicates('date',keep='last').sort_values('date')
    return d,invalid,dup

def korean(exchange,step,start,now):
    base={'Upbit':'https://api.upbit.com/v1','Bithumb':'https://api.bithumb.com/v1'}[exchange]
    endpoint='/candles/days' if step==86400 else '/candles/minutes/60'
    cursor=now; rows=[]
    while cursor>start:
        params={'market':'KRW-ETH','count':200}
        if exchange=='Bithumb':
            if rows: params['to']=cursor.tz_convert('Asia/Seoul').strftime('%Y-%m-%dT%H:%M:%S')
        else: params['to']=cursor.strftime('%Y-%m-%dT%H:%M:%SZ')
        a=get(base+endpoint,params)
        if not isinstance(a,list): raise RuntimeError(str(a))
        if not a: break
        for x in a: rows.append([x['candle_date_time_utc'],x['opening_price'],x['high_price'],x['low_price'],x['trade_price'],x['candle_acc_trade_volume'],x['candle_acc_trade_price']])
        nxt=min(pd.Timestamp(x['candle_date_time_utc'],tz='UTC') for x in a)
        if nxt>=cursor: raise RuntimeError('Pagination stalled')
        cursor=nxt; time.sleep(.18)
        if len(rows)%10000==0: print(exchange,step,cursor,flush=True)
    return pd.DataFrame(rows,columns=COLS)

def bitstamp(step,start,now):
    rows=[]; cursor=int(start.timestamp()); end=int(now.timestamp())
    while cursor<end:
        stop=min(cursor+999*step,end)
        a=get('https://www.bitstamp.net/api/v2/ohlc/ethusd/',{'step':step,'limit':1000,'start':cursor,'end':stop,'exclude_current_candle':'true'})['data']['ohlc']
        for x in a: rows.append([pd.to_datetime(int(x['timestamp']),unit='s',utc=True),x['open'],x['high'],x['low'],x['close'],x['volume'],None])
        cursor=stop+step; time.sleep(.2)
    return pd.DataFrame(rows,columns=COLS)

def kraken(step,start,now):
    a=get('https://api.kraken.com/0/public/OHLC',{'pair':'ETHUSD','interval':step//60,'since':int(start.timestamp())})
    if a['error']: raise RuntimeError(str(a['error']))
    k=next(k for k in a['result'] if k!='last')
    return pd.DataFrame([[pd.to_datetime(x[0],unit='s',utc=True),x[1],x[2],x[3],x[4],x[6],None] for x in a['result'][k]],columns=COLS)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--folder',default='eth_data'); p.add_argument('--seed',default='.'); p.add_argument('--markets',nargs='+',default=['Upbit','Bithumb','Bitstamp','Kraken'],choices=['Upbit','Bithumb','Bitstamp','Kraken']); p.add_argument('--audit-only',action='store_true'); p.add_argument('--repair-days',type=int,default=7);  args=p.parse_args()
    folder=Path(args.folder); folder.mkdir(parents=True,exist_ok=True); now=pd.Timestamp.now(tz='UTC'); report=[]
    for ex in args.markets:
        for step,tf in [(86400,'1d'),(3600,'1h')]:
            name=f'{ex}_ETH'+('KRW' if ex in ['Upbit','Bithumb'] else 'USD'); out=folder/f'{name}_{tf}.csv'; seed=Path(args.seed)/f'{name}_{tf}.csv'
            if not seed.exists() and tf=='1d': seed=Path(args.seed)/f'{name}_d.csv'
            try:
                old=load(out if out.exists() else seed); old,invalid,dup=clean(old,step,now); new=pd.DataFrame(columns=COLS)
                if not args.audit_only:
                    start=old.date.max()-pd.Timedelta(days=args.repair_days) if len(old) else pd.Timestamp('2015-08-01',tz='UTC')
                    new=korean(ex,step,start,now) if ex in ['Upbit','Bithumb'] else bitstamp(step,start,now) if ex=='Bitstamp' else kraken(step,start,now)
                new,ni,nd=clean(new,step,now); merged,_,_=clean(pd.concat([old,new],ignore_index=True),step,now)
                if len(merged):
                    tmp=out.with_suffix('.tmp'); merged.to_csv(tmp,index=False); tmp.replace(out)
                missing=None if step==86400 and merged.date.dt.hour.nunique()>1 else int((merged.date.max()-merged.date.min()).total_seconds()/step)+1-len(merged) if len(merged) else None
                item=dict(market=ex,tf=tf,rows=len(merged),first=str(merged.date.min()),last=str(merged.date.max()),missing_slots=missing,invalid=invalid+ni,duplicates=dup+nd,new_rows=int((~new.date.isin(old.date)).sum()),zero_volume=int((merged.volume_eth==0).sum()),note='Kraken REST limited to latest 720 candles; historical archive required' if ex=='Kraken' else '')
            except Exception as e: item=dict(market=ex,tf=tf,error=str(e))
            report.append(item); print(json.dumps(item,ensure_ascii=False),flush=True)
            (folder/'audit.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
def analysis_files(folder):
    folder=Path(folder); dest=folder/'analysis'; dest.mkdir(exist_ok=True)
    report=[]
    for ex in ['Upbit','Bithumb','Bitstamp','Kraken']:
        name=f'{ex}_ETH'+('KRW' if ex in ['Upbit','Bithumb'] else 'USD')
        for tf,step in [('1d',86400),('1h',3600)]:
            src=folder/f'{name}_{tf}.csv'
            if not src.exists(): continue
            d,invalid,dup=clean(load(src),step,pd.Timestamp.now(tz='UTC'))
            if tf=='1d' and ex=='Bithumb':
                for hour in [0,15]:
                    d[d.date.dt.hour==hour].to_csv(dest/f'{name}_1d_UTC{hour:02}.csv',index=False)
            if ex=='Bitstamp':
                d['volume_eth']=float('nan'); d['volume_quote']=float('nan')
            if tf=='1h':
                for freq,n,label in [('4h',4,'4h'),('24h',24,'1d')]:
                    g=d.set_index('date').resample(freq,origin='epoch'); a=g.agg({'open':'first','high':'max','low':'min','close':'last','volume_eth':lambda x:x.sum(min_count=n),'volume_quote':lambda x:x.sum(min_count=n)})
                    a=a[g.size()==n]; a.to_csv(dest/f'{name}_{label}_from_1h.csv')
                    report.append({'market':ex,'derived':label,'rows':len(a)})
            if tf=='1d' and ex=='Bithumb': continue
            d.to_csv(dest/src.name,index=False)
            report.append({'market':ex,'tf':tf,'rows':len(d),'invalid':invalid,'duplicates':dup,'volume_excluded':ex=='Bitstamp'})
    (dest/'quality.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':
    import sys
    if '--prepare-only' in sys.argv:
        p=argparse.ArgumentParser(); p.add_argument('--prepare-only',action='store_true'); p.add_argument('--folder',default='eth_data'); a=p.parse_args(); analysis_files(a.folder)
    else:
        main()
        folder=sys.argv[sys.argv.index('--folder')+1] if '--folder' in sys.argv else 'eth_data'
        analysis_files(folder)

