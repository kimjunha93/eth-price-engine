"""Separate early Bitfinex archive, never overwrite production input."""
import csv, hashlib, io, json, math, time
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT=Path("eth_data/early_exchange")
BASE="https://api-pub.bitfinex.com/v2/candles/trade:{tf}:tETHUSD/hist"
START=int(datetime(2015,8,1,tzinfo=timezone.utc).timestamp()*1000)
END=int(datetime(2019,1,1,tzinfo=timezone.utc).timestamp()*1000)
def iso(t):return datetime.fromtimestamp(t/1000,timezone.utc).isoformat()
def fetch(tf,step):
    rows=[]; cursor=START
    session=requests.Session()
    while cursor<END:
        end=min(END-1,cursor+step*9999-1)
        for attempt in range(4):
            try:
                r=session.get(BASE.format(tf=tf),params=dict(start=cursor,end=end,limit=10000,sort=1),timeout=45)
                r.raise_for_status(); a=r.json()
                if not isinstance(a,list) or any(not isinstance(x,list) or len(x)!=6 for x in a):raise ValueError("unexpected response")
                break
            except (requests.RequestException,ValueError):
                if attempt==3:raise
                time.sleep(5*(attempt+1))
        for x in a:
            t,o,c,h,l,v=x
            if not isinstance(t,int) or t%step or not cursor<=t<=end or not all(isinstance(z,(int,float)) and math.isfinite(z) for z in (o,c,h,l,v)) or min(o,c,h,l)<=0 or h<max(o,c,l) or l>min(o,c,h) or v<0:raise ValueError("invalid row")
            rows.append((t,o,h,l,c,v))
        cursor=end+1
        time.sleep(2)
    rows.sort()
    if not rows or len(set(r[0] for r in rows))!=len(rows):raise ValueError("missing or duplicate archive")
    return rows
def write(rows,tf,step):
    b=io.StringIO();w=csv.writer(b,lineterminator="\n");w.writerow(["date","open","high","low","close","volume_eth"])
    w.writerows((iso(t),o,h,l,c,v) for t,o,h,l,c,v in rows)
    raw=b.getvalue().encode(); p=ROOT/("Bitfinex_ETHUSD_"+tf+".csv")
    p.write_bytes(raw)
    return dict(rows=len(rows),first=iso(rows[0][0]),last=iso(rows[-1][0]),missing_slots=(rows[-1][0]-rows[0][0])//step+1-len(rows),zero_volume=sum(r[-1]==0 for r in rows),sha256=hashlib.sha256(raw).hexdigest())
def main():
    d=fetch("1D",86400000);h=fetch("1h",3600000)
    ROOT.mkdir(parents=True,exist_ok=True)
    # Match only complete UTC days with exactly 24 hours.
    groups={}
    for r in h:groups.setdefault(r[0]//86400000*86400000,[]).append(r)
    matched=0;compared=0;vol_error=[]
    for t,o,hi,lo,c,v in d:
        a=groups.get(t,[])
        if len(a)!=24 or [r[0] for r in a]!=[t+i*3600000 for i in range(24)]:continue
        compared+=1
        if all(math.isclose(x,y,rel_tol=1e-10,abs_tol=1e-10) for x,y in zip((o,hi,lo,c),(a[0][1],max(r[2] for r in a),min(r[3] for r in a),a[-1][4]))):matched+=1
        vol_error.append(abs(sum(r[5] for r in a)-v)/max(v,1e-12))
    # Compare same UTC daily closes without splicing or scaling.
    bit={}
    with Path("eth_data/Bitstamp_ETHUSD_1d.csv").open() as f:
        for r in csv.DictReader(f):bit[r["date"][:10]]=float(r["close"])
    errors=sorted(abs(c/bit[iso(t)[:10]]-1)*100 for t,o,hi,lo,c,v in d if iso(t)[:10] in bit)
    report=dict(version="v43-early-bitfinex-1",source=BASE,requested_start=iso(START),requested_end_exclusive=iso(END),daily=write(d,"1d",86400000),hourly=write(h,"1h",3600000),daily_hourly=dict(complete_days=compared,ohlc_matches=matched,max_relative_volume_error=max(vol_error,default=None)),bitstamp_overlap=dict(n=len(errors),median_abs_close_pct=errors[len(errors)//2] if errors else None,max_abs_close_pct=max(errors,default=None)),status="isolated_archive_pending_review",policy="No imputation, no cross-exchange merge, no automatic model promotion; earliest returned bar is not proof of first-ever ETH trade.")
    (ROOT/"audit.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report))
if __name__=="__main__":main()
