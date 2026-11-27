# V4.3 causal rebuild audit — 2026-11-27 UTC

Offline snapshot; Bitfinex ETHUSD and Upbit ETHKRW, separate markets. Daily last open 2026-11-25 UTC. Hourly last open USD 2026-11-26 23:00 UTC, KRW 2026-11-26 14:00 UTC.

| Market | 1h confirmed | 4h confirmed | 1d confirmed | verified daily volume | excluded daily volume |
|---|---:|---:|---:|---:|---:|
| USD | 3550 | 2747 | 1989 | 3802 | 105 |
| KRW | 2028 | 1538 | 1331 | 3249 | 97 |

42/42 fixed-cut prefix replay tests passed, zero chronology violations under close-confirmed label definition. Gaps censor events. Same-bar opposite extreme before confirmation close is not assumed to belong to the next leg. 2023+ exploratory walk-forward, training events completed strictly before prediction time, minimum 20; overlapping scales are not independent. Normalized MAE (%) for KRW, k<=20%: 1h flat 6.625, full median 5.014, recent3 5.005, nearest20 5.138; 4h 7.320, 5.369, 5.358, 5.556; 1d 11.260, 8.551, 8.550, 9.120. Reused evaluation period, no independent final test. No forecast registered. Raw volume unchanged; derived volume masked if incomplete or mismatched. Existing GitHub workflow inspected, not modified. Code and CSV remain local to analysis session; this commit preserves audit summary only.
