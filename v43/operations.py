"""V4.3 operations: charts, explicit forecast ledger, closed-hour barrier scoring.
Structure references are never automatically registered as forecasts."""
import json,math,hashlib
from pathlib import Path
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import matplotlib.dates as md
from path_audit import load,ROOT,NOW

DEST=ROOT/"v43_output"
LEDGER=ROOT/"forecast_ledger_v43.jsonl"
MARKETS=("Upbit_ETHKRW","Bitstamp_ETHUSD")
HOUR=pd.Timedelta(hours=1)

def validate(r):
    req={"id","asof","market","model","data_version","side","anchor","target","invalidation","horizon_hours","kind"}
    if not req<=r.keys() or r["market"] not in MARKETS or r["side"] not in ("up","down") or r["kind"]!="live":raise ValueError("record schema")
    t=pd.Timestamp(r["asof"])
    if t.tzinfo is None or t!=t.floor("h"):raise ValueError("asof must be UTC hour boundary with timezone")
    if type(r["horizon_hours"]) is not int or not 1<=r["horizon_hours"]<=8760:raise ValueError("horizon")
    a,b,c=[r[x] for x in ("anchor","target","invalidation")]
    if not all(isinstance(v,(int,float)) and math.isfinite(v) and v>0 for v in (a,b,c)):raise ValueError("price")
    if not (c<a<b if r["side"]=="up" else b<a<c):raise ValueError("barriers")
    if not all(isinstance(r[x],str) and r[x].strip() for x in ("id","model","data_version")):raise ValueError("identity")
    return t.tz_convert("UTC")

def read_ledger(p=LEDGER):
    rows=[json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
    seen={}
    for r in rows:
        t=validate(r)
        if r["id"] in seen:raise ValueError("duplicate id")
        parent=r.get("revision_of")
        if parent and (parent not in seen or seen[parent]["market"]!=r["market"] or t<=validate(seen[parent])):raise ValueError("invalid revision")
        seen[r["id"]]=r
    return rows

def score(r,d,now):
    t=validate(r);end=t+r["horizon_hours"]*HOUR
    for ts in pd.date_range(t,end-HOUR,freq="h"):
        if ts+HOUR>now:return "pending",None
        if ts not in d.index:
            if d.empty or ts>d.index[-1]:return "data_wait",None
            return "gap_unknown",str(ts)
        x=d.loc[ts]
        if isinstance(x,pd.DataFrame):return "gap_unknown",str(ts)
        up=r["side"]=="up"
        hit=x.high>=r["target"] if up else x.low<=r["target"]
        bad=x.low<=r["invalidation"] if up else x.high>=r["invalidation"]
        if hit and bad:return "order_unknown",str(ts)
        if bad:return "invalidated",str(ts)
        if hit:return "target_touched",str(ts)
    return "expired_no_touch",None

def tests():
    t=pd.Timestamp("2020-01-01T00:00Z")
    r=dict(id="x",asof=str(t),market=MARKETS[0],model="test",data_version="synthetic",side="up",anchor=100,target=110,invalidation=90,horizon_hours=2,kind="live")
    def frame(x,idx=None):
        return pd.DataFrame(x,columns=["high","low"],index=idx if idx is not None else pd.date_range(t,periods=len(x),freq="h"))
    cases=[("target_touched",[(111,95)],t+HOUR,None),("invalidated",[(105,89)],t+HOUR,None),("order_unknown",[(111,89)],t+HOUR,None),("pending",[(105,95)],t+HOUR,None),("expired_no_touch",[(105,95),(106,94)],t+2*HOUR,None),("gap_unknown",[(105,95)],t+2*HOUR,[t+HOUR]),("data_wait",[(105,95)],t+2*HOUR,None),("pending",[(111,95)],t+pd.Timedelta(minutes=30),None)]
    for expect,x,now,idx in cases:assert score(r,frame(x,idx),now)[0]==expect
    for changes in ({"asof":"2020-01-01T00:15Z"},{"target":99},{"horizon_hours":0},{"target":float("nan")}):
        try:validate(dict(r,**changes))
        except ValueError:continue
        raise AssertionError("invalid record accepted")
    return 12

def save(fig,name):
    fig.tight_layout()
    fig.savefig(DEST/name,dpi=130,bbox_inches="tight")
    plt.close(fig)

def candle(ax,d,scale):
    for t,r in d.iterrows():
        x=md.date2num(t);o,h,l,c=[r[k]/scale for k in ("open","high","low","close")]
        ax.vlines(x,l,h,color="#666666",lw=.7)
        ax.add_patch(Rectangle((x-.33,min(o,c)),.66,max(abs(c-o),1e-9),facecolor="white" if c>=o else "#777777",edgecolor="#777777",lw=.6))
    ax.autoscale_view();ax.xaxis_date();ax.xaxis.set_major_formatter(md.DateFormatter("%m-%d"));ax.grid(alpha=.2)

def charts(snap,data,scores):
    for m,d in data.items():
        scale=10000 if m==MARKETS[0] else 1
        unit="KRW 10k" if scale==10000 else "USD"
        fig,ax=plt.subplots(figsize=(10,4));ax.plot(d.index,d.close/scale,color="#666666",lw=.8);ax.set_yscale("log");ax.set_title(m+" | available history (log)");ax.set_ylabel(unit);ax.grid(alpha=.2)
        for col,t in [("low",d.low.idxmin()),("high",d.high.idxmax())]:
            y=d.loc[t,col]/scale;ax.scatter(t,y,color="#0d9488");ax.annotate(f"{y:,.1f}",(t,y),xytext=(6,5),textcoords="offset points")
        save(fig,"A_"+m+".png")
        fig,ax=plt.subplots(figsize=(10,4));candle(ax,d.tail(90),scale);ax.set_title(m+" | last 90 closed daily bars");ax.set_ylabel(unit);save(fig,"B_"+m+".png")
        fig,(a,b)=plt.subplots(1,2,figsize=(12,5),gridspec_kw={"width_ratios":[1.1,1]})
        candle(a,d.tail(60),scale);a.set_ylabel(unit);a.set_title("Actual daily bars")
        states=snap["markets"][m]["scales"]["1d"]["states"]
        for i,(k,r) in enumerate(states.items()):
            obs=r.get("observed_extreme");q=r.get("reference_q25_q50_q75")
            if obs is not None:b.scatter(i,obs/scale,marker="x",color="#777777")
            if q:
                lo,mid,hi=np.array(q)/scale;b.errorbar(i,mid,yerr=[[mid-lo],[hi-mid]],fmt="o",mfc="white",color="#0d9488",capsize=4)
                b.annotate(f"{mid:,.1f}",(i,mid),xytext=(0,8),textcoords="offset points",ha="center",fontsize=8)
        b.axhline(d.close.iloc[-1]/scale,color="#999999",ls="--",lw=.8)
        b.set_xticks(range(len(states)),[f"{float(k)*100:.0f}%" for k in states]);b.set_title("Independent reference levels, NOT a future path");b.set_xlabel("Reversal threshold (not time)");b.set_ylabel(unit);b.grid(alpha=.2)
        fig.suptitle("C | No validated linked full-cycle forecast");save(fig,"C_"+m+".png")
    fig,ax=plt.subplots(figsize=(10,max(3,1+len(scores)*.5)));ax.axis("off")
    if not scores:ax.text(.5,.5,"D | No registered live forecasts. No score.",ha="center",va="center",fontsize=15)
    else:
        rows=[[r["id"],r.get("revision_of",""),r["market"],r["status"]] for r in scores]
        ax.table(cellText=rows,colLabels=["ID","Revision of","Market","Status"],loc="center",cellLoc="left")
    save(fig,"D_tracking.png")

def main():
    DEST.mkdir(parents=True,exist_ok=True)
    n=tests()
    p=ROOT/"structure_snapshot_v43.json";snap=json.loads(p.read_text())
    data={m:load(m,"1d") for m in MARKETS};hours={m:load(m,"1h") for m in MARKETS}
    rows=read_ledger();scores=[]
    for r in rows:
        status,when=score(r,hours[r["market"]],NOW)
        scores.append(dict(id=r["id"],market=r["market"],revision_of=r.get("revision_of"),status=status,event_bar_open=when,extreme_score=None))
    charts(snap,data,scores)
    report=dict(version="v43-operations-1",generated_utc=str(NOW),snapshot_sha256=hashlib.sha256(p.read_bytes()).hexdigest(),freshness_pass=snap["freshness_pass"],synthetic_tests_passed=n,registered_live=len(rows),scores=scores,charts=sorted(x.name for x in DEST.glob("*.png")),status="descriptive_only_no_automatic_forecast",limits="Barrier scoring only, no actual extreme or full-path score; charts show independent references, not a linked prediction; no automatic registration.")
    tmp=DEST/"operations.tmp";tmp.write_text(json.dumps(report,indent=2,allow_nan=False));tmp.replace(DEST/"operations.json")
    print(json.dumps(report))
if __name__=="__main__":main()
