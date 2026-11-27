import csv,json,hashlib,sys,datetime as dt,collections,math
from pathlib import Path
H=3600; DAY=24*H; CUT=int(dt.datetime(2023,1,1,tzinfo=dt.timezone.utc).timestamp()); DEV=int(dt.datetime(2020,1,1,tzinfo=dt.timezone.utc).timestamp())
LABELS=[a+b+c for a in 'UD' for b in 'UD' for c in 'UD']+['timeout','gap','ambiguous']
def load(path):
    a=[]
    with open(path) as f:
        for r in csv.DictReader(f):
            t=dt.datetime.fromisoformat(r.get('date') or r['timestamp_utc']); t=t.replace(tzinfo=dt.timezone.utc) if t.tzinfo is None else t
            t=int(t.timestamp()); o,h,l,c=map(float,[r[x] for x in ('open','high','low','close')]); v=float(r.get('volume_eth') or r['volume']); assert t%H==0 and min(o,h,l,c)>0 and h>=max(o,l,c) and l<=min(o,h,c) and v>=0 and all(map(math.isfinite,(o,h,l,c,v)))
            assert not a or t>a[-1][0]; a.append((t,o,h,l,c))
    return a

def event(a,i,p,cap):
    # forecast after hourly close; barrier is reference price, not simulated fill
    anchor=a[i][4]; t=a[i][0]+H; seq=''; end=t
    for j in range(i+1,i+1+cap):
        end=t+(j-i)*H
        if j>=len(a):return seq,'end_censored',a[-1][0]+H
        if a[j][0]!=a[j-1][0]+H:return seq,'gap',end
        _,o,h,l,c=a[j]; u=anchor*(1+p); d=anchor*(1-p); U=h>=u; D=l<=d
        if U and D:return seq,'ambiguous',end
        if not (U or D):continue
        seq+='U' if U else 'D'; anchor=u if U else d
        if len(seq)==3:return seq,seq,end
        # Possible second barrier in same bar: do not assign ordering, even if open is beyond first barrier.
        if h>=anchor*(1+p) or l<=anchor*(1-p):return seq,'ambiguous',end
    return seq,'timeout',end

def sample(a,p,cap):
    out=[]; next_t=-1
    for i in range(167,len(a)-1):
        t=a[i][0]+H
        if t%DAY or t<next_t or a[i][0]-a[i-167][0]!=167*H:continue
        hist=a[i-167:i+1]; dd=1-a[i][4]/max(r[2] for r in hist)
        if dd<.15:continue
        ret=a[i][4]/a[i-24][4]-1
        seq,label,end=event(a,i,p,cap);next_t=end
        out.append(dict(t=t,end=end,dd=dd,ret=ret,seq=seq,label=label))
    return out

def mode(xs):
    c=collections.Counter(xs); return min(c,key=lambda k:(-c[k],k))
def predict(train,r,model):
    if model=='regime':
        z=[x for x in train if (x['dd']>=.25)==(r['dd']>=.25) and (x['ret']>=0)==(r['ret']>=0)]
        if len(z)>=15:train=z
    if model=='marginal':
        z=[x['label'] for x in train if x['label'] in LABELS[:8]]
        return ''.join(mode([x[j] for x in z]) for j in range(3)) if z else mode([x['label'] for x in train])
    return mode([x['label'] for x in train])
def evaluate(rows,lo,hi,models):
    eligible=[r for r in rows if lo<=r['t']<hi and r['end']<=hi and r['label'] not in ('gap','ambiguous','end_censored')]; metrics={m:dict(n=0,correct=0,complete_n=0,complete_correct=0,stage1_n=0,stage1_correct=0) for m in models}
    for r in eligible:
        train=[x for x in rows if x['end']<r['t'] and x['label'] not in ('gap','ambiguous','end_censored')]
        if len(train)<20:continue
        for m,z in metrics.items():
            pred=predict(train,r,m); z['n']+=1; z['correct']+=pred==r['label']
            if r['label'] in LABELS[:8]:z['complete_n']+=1;z['complete_correct']+=pred==r['label']
            if r['seq'] and not (r['label']=='ambiguous' and not r['seq']):z['stage1_n']+=1;z['stage1_correct']+=pred[0] == r['seq'][0] if pred in LABELS[:8] else 0
    return metrics

def run(paths):
    out={'version':'hourly_barrier_path_v1','design':{'scales':[.05,.10,.15,.20],'cap_hours':720,'entry':'UTC daily boundary, previous 168 contiguous hours, close >=15% below trailing high, no overlapping events per scale','labels':'three successive symmetric barriers U/D; gap, timeout, ambiguous, end_censored separate. Same-hour competing barriers and possible next-stage hit censored as ambiguous; no cross-market pooling.','models':'marginal stage-wise modes among completed paths; joint most common full outcome including timeout but excluding data gaps and ambiguous; regime joint with fixed 25% drawdown and 24h return sign, min 15 subset otherwise joint; min 20 prior ended events','selection':'2020-22 internal, choose regime or marginal only if >=20 evaluated and >=5 percentage point full-outcome accuracy improvement over joint; 2023+ reused evaluation, no promotion; data faults excluded from training/evaluation but counted; Kraken early only descriptive','note':'These are barrier visit sequences, not confirmed reversal pivots, not live target-specific or full cycle forecast.'},'markets':{}}
    for path in paths:
        a=load(path); name=Path(path).name; m={'rows':len(a),'first':a[0][0],'last':a[-1][0]+H,'sha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),'scales':{}};out['markets'][name]=m
        for p in [.05,.10,.15,.20]:
            rows=sample(a,p,720); prefix=sample([r for r in a if r[0]<CUT],p,720)
            assert [r for r in prefix if r['end']<CUT]==[r for r in rows if r['end']<CUT]
            models=['joint','marginal','regime']; dev=evaluate(rows,DEV,CUT,models); test=evaluate(rows,CUT,10**12,models); base=dev['joint']; chosen='joint'
            if base['n']>=20:
                cand=[x for x in models[1:] if dev[x]['correct']/dev[x]['n']-base['correct']/base['n']>=.05]
                if cand:chosen=max(cand,key=lambda x:dev[x]['correct'])
            m['scales'][str(p)]={'total':len(rows),'outcomes':dict(collections.Counter(r['label'] for r in rows)),'first_known':dict(collections.Counter(r['seq'][0] for r in rows if r['seq'])),'internal':dev,'evaluation':test,'chosen':chosen,'prefix_pass':True,'evaluation_excluded':dict(collections.Counter(r['label'] for r in rows if r['t']>=CUT and r['label'] in ('gap','ambiguous','end_censored')))}
    return out
if __name__=='__main__':
    result=run(sys.argv[1:]); print(json.dumps(result,indent=2))
