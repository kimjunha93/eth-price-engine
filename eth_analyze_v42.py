"""V4.2 foundation: descriptive diagnostics only; no validated forecast."""
import json, hashlib
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path("eth_data")
NOW = pd.Timestamp.now(tz="UTC")
COLS = ["open","high","low","close","volume_eth"]
def analyze(path, hours):
    raw = pd.read_csv(path)
    raw["date"] = pd.to_datetime(raw["date"], utc=True, errors="coerce")
    for c in COLS:
        raw[c] = pd.to_numeric(raw[c], errors="coerce")
    bad = raw.date.isna() | ~np.isfinite(raw[COLS]).all(axis=1) | (raw[COLS[:4]] <= 0).any(axis=1) | (raw.volume_eth < 0) | (raw.high < raw[["open","close","low"]].max(axis=1)) | (raw.low > raw[["open","close","high"]].min(axis=1))
    dup = raw.date.duplicated(keep=False)
    d = raw.loc[~bad & ~dup].sort_values("date").set_index("date")
    d = d.loc[d.index + pd.Timedelta(hours=hours) <= NOW]
    if d.empty:
        raise ValueError("No valid closed candles")
    step = pd.Timedelta(hours=hours)
    missing = int(((d.index[-1]-d.index[0])/step)+1-len(d))
    # Indicators use only the last uninterrupted segment.
    gaps = d.index.to_series().diff().ne(step)
    s = d.loc[gaps[gaps].index[-1]:]
    c = s.close
    tr = pd.concat([s.high-s.low,(s.high-c.shift()).abs(),(s.low-c.shift()).abs()],axis=1).max(axis=1)
    def val(x):
        return float(x) if pd.notna(x) and np.isfinite(x) else None
    out = dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(),raw_rows=len(raw),closed_valid_rows=len(d),invalid_rows=int(bad.sum()),duplicate_rows=int(dup.sum()),missing_slots=missing,zero_volume=int((d.volume_eth==0).sum()),first=str(d.index[0]),last=str(d.index[-1]),continuous_tail_rows=len(s),last_close=val(c.iloc[-1]),last_closed_ohlcv={k:val(s[k].iloc[-1]) for k in COLS},sma={str(n):val(c.rolling(n).mean().iloc[-1]) for n in [5,10,20,50,60,100,120,200]},atr14_simple=val(tr.rolling(14).mean().iloc[-1]),return_pct={str(n):val((c.iloc[-1]/c.iloc[-n-1]-1)*100) if len(c)>n else None for n in [3,7,14,28,42,60,90]})
    return out
def main():
    result={"version":"4.2-foundation-0.1","generated_utc":str(NOW),"forecast_status":"not_validated","markets":{}}
    for market in ["Upbit_ETHKRW","Bithumb_ETHKRW","Bitstamp_ETHUSD","Kraken_ETHUSD"]:
        for tf,h in [("1d",24),("1h",1)]:
            key=market+"_"+tf
            try:
                result["markets"][key]=analyze(ROOT/(key+".csv"),h)
            except Exception as e:
                result["markets"][key]={"error":str(e)}
    dest=ROOT/"analysis_summary.json"
    tmp=dest.with_suffix(".tmp")
    tmp.write_text(json.dumps(result,indent=2,allow_nan=False),encoding="utf-8")
    tmp.replace(dest)
    if any("error" in v for v in result["markets"].values()):
        raise SystemExit("One or more market files failed validation; inspect summary")
if __name__=="__main__":
    main()
