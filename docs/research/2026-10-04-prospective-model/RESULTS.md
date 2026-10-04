# Fuel Up prospective price model: trained research candidate

The experiment produced a usable saved model and a modest development improvement, not evidence of a production-ready estimator. Seventeen station-model checkpoints were fitted on 2,062,756 examples. A 330,710,976-parameter TimesFM 3 checkpoint was also benchmarked in two zero-shot configurations. Bigger models did not win this experiment.

The frozen candidate is the 887,553-parameter temporal network, with a 10-cent minimum predicted correction and a 20-cent maximum applied correction. Its weights, normalization, input schema and code hashes are recorded in `FROZEN_CANDIDATE.json`. It predicts the next timestamp-advancing provider report; it does not establish the current pump price.

## Development results

All errors below are **cents per gallon**, not dollars. These are chronological development results, selected/tuned on this same period. They are not the untouched final test.

| Policy | Mean absolute error | RMSE | Mean error on ≥10¢ changes | Mean of worst 5% errors |
|---|---:|---:|---:|---:|
| Keep raw report | 0.2188 | 2.3098 | 20.4390 | 4.3758 |
| Uncapped sparse temporal reference | 0.1981 | 1.8687 | 16.0233 | 3.9619 |
| **Frozen ±20¢ bounded candidate** | **0.2080** | **2.0692** | **17.9916** | **4.1599** |
| TimesFM 3, report sequence | 0.4193 | 2.6744 | 16.5509 | 6.9360 |
| TimesFM 3, sequence + past timing | 0.4310 | see saved results | 16.1332 | 7.3068 |

The frozen policy improves mean error by 4.93%, RMSE by 10.42%, and large-change error by 11.97%. The very low overall error mainly reflects unchanged reports in a short, quiet development period. It is **not** evidence that actual pump prices are accurate to fractions of a cent.

The uncapped reference improved mean and worst-5% error by 9.46%, and large-change error by 21.60%, but one correction worsened next-report error by $1.0625. This prevented treating the aggregate win as sufficient. The 20-cent cap is a conservative research policy chosen after this adverse-case audit, not the cap with minimum development MAE.

The bounded candidate adjusted 181 examples from 46 stations in 11 states. Of these, 134 improved and 47 worsened against the next report; 45 adjusted examples had an unchanged next report. It can still make bad corrections. Errors exceeding 10 cents increased slightly overall: underestimates rose from 0.1559% to 0.1648%, while overestimates fell from 0.2053% to 0.1998%. This is an unresolved promotion concern.

Station-grouped and state-grouped bootstrap intervals for the bounded policy's mean error difference were below zero. These intervals do **not** correct for development model/threshold selection, spatial dependence, or the short observation window. They are supporting diagnostics, not a substitute for the final test.

## Data and evaluation boundaries

- Fixed national catalog: 141,660 IDs, 72 batches; 59 Virginia, 9 Northern California, 4 Oregon.
- Export: 4,758 successful immutable batches, 251,284,590 compressed bytes, 62 complete and 9 partial runs. The dense hourly panel has 76 positions, retaining absent hours and missing stations.
- Original observations span September 30 22:00 through October 4 01:00 UTC slots, with a fixed export cutoff of October 4 02:30 UTC. Every batch matched its SHA-256, byte count, exact ordered inventory, region, and recorded collection timestamps.
- Source events: 2,877,668 across station/grade/payment series. These are dependent observations, not independent pump measurements. Exact repeated timestamps were collapsed; no conflicting same-time reports occurred in this export.
- Training: 2,062,756 examples, with 57,548 ≥10-cent changes. Both feature and label availability precede October 3 18:19 UTC.
- Development: 145,644 examples from 14,081 stations; 959 ≥10-cent changes from 434 stations. Input availability is after the training boundary; labels are available before the export cutoff.
- An additional 58,498 geographic decision rows support local ranking diagnostics. Candidate selection happens before checking whether future labels exist.
- The development window is right-censored: a full 24-hour outcome window has not elapsed for its inputs. Fast-reporting, unchanged stations are overrepresented. The validation period is only several hours, not multiple market regimes.
- Coordinates come from the current station catalog and were treated as static. Historical station moves cannot be excluded. Serving-cache prices and names were not used as model features.
- Texas and DC retain the documented coverage assumptions; Texas's inventory is one ID above the provider aggregate. Missing prices and missed collection hours remain missing.

## What was trained

Six substantial CatBoost candidates used RMSE, MAE, Huber and quantile objectives at depths 8 and 10, with an upper limit of 2,400 iterations and chronological early stopping. Their actual saved tree counts are recorded in `artifacts/results/tree-results.json`; several stopped almost immediately because later fitting worsened development error.

Temporal networks used 47 causal tabular features, missingness indicators and a 24-hour sequence. The smaller model has 887,553 parameters and retained epoch 2 of 7 attempted epochs. The larger model has 5,058,561 parameters and retained epoch 4 of 9. Training used all eligible training examples, CUDA BF16, AdamW, gradient clipping, and a combined Huber/MSE objective.

A station-balanced change classifier and two conditional regression models tested a two-stage approach. The classifier retained 759 trees. Its development average precision was 0.1365 against a 0.0320 prevalence for changes of at least one cent. Its predictions and failures are preserved, rather than silently discarded.

Six matching tree candidates were refitted with 28 lagged WTI/Brent features. All model checkpoints and selection trials are saved. Sparse thresholds, age gates, caps and classifier-gate diagnostics were explored on development data after initial models underperformed; these are explicitly exploratory additions to the initial protocol.

TimesFM 3 was evaluated zero-shot, not fine-tuned. It forecast one next report-indexed observation, with irregular report intervals disclosed. The second variant received past-only report intervals and report ages. Neither variant received the actual future report time. Both performed worse overall. The downloaded weights are under the [TimesFM Non-Commercial License](https://huggingface.co/google/timesfm-3.0-pytorch/blob/main/LICENSE); they are not redistributed or included in the shipping candidate.

## Oil-price lag experiment

Historical sources are EIA series distributed by FRED: [WTI](https://fred.stlouisfed.org/series/DCOILWTICO), [Brent](https://fred.stlouisfed.org/series/DCOILBRENTEU), and [U.S. regular gasoline](https://fred.stlouisfed.org/series/GASREGW). Exact CSVs and hashes are preserved under `artifacts/oil`.

The analysis used **changes**, not just correlations between trending price levels. Training-period correlations were strongest over roughly the previous week. At an eight-day lag, correlations were 0.4145 for WTI and 0.4505 for Brent; at 30 days they were 0.1485 and 0.1447. Weekly sampling and non-trading days mean this does not identify a precise daily causal delay.

Two weekly gasoline forecasting models were tuned on 2024 after training on 2001–2023, then refitted through 2024 and evaluated on 91 weeks from 2025 through September 28, 2026. Adding distributed oil lags reduced test MAE from 5.0954¢ to 4.8955¢, a 3.92% improvement. The eight-week block-bootstrap interval for the improvement includes zero; p95 error worsened slightly. Persistence had 5.6560¢ MAE.

Predictive oil inputs used at least an eight-calendar-day delay. These are current-vintage observations with a conservative publication-delay assumption, not a fully reconstructed historical release-vintage backtest. Correlations at shorter lags are descriptive only.

Oil features did not beat the best station model. There are only five distinct calendar dates in the station feature export. Millions of station rows cannot turn those few dates into reliable evidence about a month-long oil pass-through effect. The aggregate finding supports continued investigation, not a claim that adding oil already improves production station estimates.

## Station choice is not proven better

There were 1,123 eligible price-only local panels, but only 181 had a labelled selected station and a comparable alternative. The bounded candidate made no measurable improvement in these panel diagnostics. The remaining 942 panels were unknown, not counted as successes. Membership eligibility, preferences and travel cost are not reconstructed here. The exact production estimation/ranking baseline was not reproduced and is not represented by a substitute.

## Verification and artifacts

- Six source-event, boundary-purge and unknown-winner tests passed.
- All 4,758 downloaded archives passed integrity and provenance checks.
- The saved checkpoint was reloaded and reproduced all 204,142 development/ranking residuals exactly, with maximum delta 0. The bounded inference policy also matched its expected output exactly.
- Training inputs can be rebuilt from the immutable archive manifest and the saved geography. Compressed training-shard hashes are preserved.
- All 17 fitted station-model checkpoints, two aggregate models, feature metadata, development inputs/predictions, full candidate results, and training logs are preserved. TimesFM weights remain at their pinned upstream revision; only its benchmark report is included.
- No production price, ranking, collector configuration or phone app was changed by this experiment.

## Frozen final-test requirement

The reserved interval is **October 5 18:19 through October 7 18:19 UTC**. It has not been read for training or selection and has not happened yet. The frozen candidate must face that interval without changing its weights, features, threshold or cap. Report errors, harmful corrections, region/fuel slices, missing outcomes and station-choice results. Do not promote it on the development mean alone. A successful final comparison would still validate a provider-report proxy, not independently verified pump truth.
