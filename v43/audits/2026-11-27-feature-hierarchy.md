# V4.3 exploratory feature and hierarchy audit — 2026-11-27 UTC
Local snapshots: Bitfinex ETHUSD and Upbit ETHKRW, last daily close 2026-11-26 00:00 UTC. Separate from production Bitstamp.
Fixed chronological replay on reused 2023+ data; minimum 20 completed training events strictly before each prediction. Not independent final evaluation. Same common eligible feature sample, multiple scales not independent. Rolling 14-bar RSI proxy uses log returns, not Wilder RSI; price residence is not traded-volume profile.

| Feature model | KRW normalized MAE (%) | USD normalized MAE (%) |
|---|---:|---:|
| flat | 11.245 | 10.699 |
| median | 8.520 | 8.390 |
| structure | 8.856 | 8.796 |
| volatility | 9.189 | 8.821 |
| momentum | 9.019 | 8.528 |
| volume | 8.819 | 8.741 |
| residence | 8.772 | 8.859 |
| combined | 8.986 | 8.551 |

KRW 354, USD 433 evaluation records; 99/1242 and 112/1875 confirmed labels excluded for missing features. Models use fixed 20-neighbor distance with historical standardization. No independent promotion. Hierarchy test: KRW 74 cases, medoid 11.605 vs parent medoid 11.941 MAPE; USD 69, 13.755 vs 15.236. Parent label is last known coarse pivot, not verified geometric nesting; reject this candidate only.

At age 3 daily bars for still-active legs: KRW 251, USD 305 evaluation records. Observed extreme only normalized MAE 9.768/10.345; clamped start median 9.846/10.887; age-conditioned median 10.486/11.698. Conditional model not promoted. Observed extreme is not a confirmed final extreme. Core range coverage clamped median 55.4%/50.2%, conditional 51.0%/45.2%, not calibrated. Different test cohort from feature experiment.

Policy: retain simple historical median as descriptive reference at leg inception, show observed extremes separately, avoid claiming current-age calibrated bounds or full-cycle single best path. New structure_snapshot.py is a separate production descriptive report, using Bitstamp/Upbit; no live forecast registration. No real VP, no 2015 complete history, no independent live score, no proven full-cycle connection. This commit stores audit summary, not the local experiment code or all CSVs.
