# Early ETH/USD reference audit — 2026-11-27

Status: exploratory price reference only; not accepted as exchange OHLCV training input. No production forecast or model changes.

Sources:
- https://raw.githubusercontent.com/RobKuebler/datasets/main/ETH-USD.csv (public mirror, upstream provenance and redistribution rights not established)
- eth_data/Bitstamp_ETHUSD_1d.csv (repository snapshot)
- https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data (official archive available; not downloaded)

Fetched and parsed both CSVs. Reference: 2302 daily rows, 2015-08-07 through 2021-11-24; 0 duplicate dates, 0 absent calendar dates. Four invalid/null OHLC rows excluded: 2020-04-17, 2020-10-09, 2020-10-12, 2020-10-13. OHLC validation requires finite positive prices, high >= max(open,close,low), low <= min(open,close,high). No zero numeric volume rows; volume units/provenance unverified. No imputation.

825 valid rows before Bitstamp starts on 2017-11-09. Early low $0.420897 on 2015-10-21; high $414.756012 on 2017-06-12. Year ranges: 2015 147 rows 0.420897–3.536610; 2016 366 rows 0.929835–21.522699; 2017 through Nov 8 312 rows 7.982310–414.756012.

Overlap: 1473 paired valid daily rows, 2017-11-09 through 2021-11-24. Absolute close relative difference = abs(reference_close / Bitstamp_close - 1)*100. Quantile convention nearest index round((n-1)*q). Median 0.301370578%; Q90 1.415473227%; Q95 1.773371901%; max 5.778174586%; <=1% 1225/1473; <=3% 1456/1473. Calendar date alignment only; precise closing timezone not established. Overlap does not authenticate early intraday extrema or volume.

Decision: retain reference separately, no splice, no OHLCV training, no raw mirror redistribution. Official Kraken archive preferred; CryptoDataDownload Kraken CSV page currently unavailable. Coin Metrics GitHub raw data fetch failed due to size/unsupported response. Official archive extraction and independent early price cross-check remain outstanding. Existing model and source files unchanged.
