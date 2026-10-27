# October 27 prediction refresh

Frozen server upload cutoff: 2026-10-27 15:42:00 UTC. Original research objects remain unchanged. Raw exports are private, outside Git; published outputs contain anonymous aggregates only.

Primary score is confirmed correct predictions divided by **all emitted predictions**. Unanswered encounters, absent encounters, wrong stations, explicit nonpurchases and end-censored predictions count as wrong. Preserve their distinct raw outcome categories; this convention does not establish that unanswered encounters were actual nonpurchases. No predictions means an undefined rate, never 100%.

Before examining the refreshed replay, specify these comparisons:

- Unchanged habitual-station, single-route-point and three-point sequence baselines.
- Sequence with all three matched points within 150m or 100m (baseline 300m).
- Sequence requiring two prior confirmed purchases at its selected station.
- Sequence requiring last three captured-mile cycles to have max/min <=1.5.
- Sequence requiring a previous purchase at the selected station within one hour of current UTC time of day, with circular midnight handling.

Use the original mileage bracket, 15-minute outcome window and separate 30-minute cooldown per policy. Report prediction counts, distinct purchases caught, account/station concentration and lead times. Separate decision times before versus on/after 2026-10-22 14:10 UTC. Train each decision only on phone evidence available then. Late server uploads restrict the snapshot but do not pretend to have been unavailable on the phone. Future labels score outcomes only.

These are exploratory candidate comparisons, not a tuned winner with a claimed independent holdout. The new period is a chronological extension, not an independently recruited cohort. Selecting a candidate after seeing its new-period result requires a future prospective test.

Mileage checks: repeat the same receipt-aligned ledger audit, counts of gaps/boundaries, purchase-cycle forecasts, motion evidence inside gaps, and automatic stop inference. A confirmed purchase is not a full-tank label. No inferred purchases, fuel quantities or missing-distance interpolation may become ground truth. Post-arrival stop inference must be reported separately from advance prediction.

## Local ML extension requested during the refresh

Train regularized logistic regression (C=0.1, balanced classes) and a shallow random forest (200 trees, depth3, leaf10, balanced classes) on moving minute decisions inside the existing mileage bracket. Candidate station is sequence match, else single-point route, else habit. Features use existing mileage, personal history counts, route evidence, speed, accuracy, time and distance to historical approaches; no account/station IDs or raw coordinates enter the estimator. No GPU or external ML service is used.

Train before October18 00:00 UTC, choose thresholds on October18–22 14:10, and test thereafter. Embargo the entire 15-minute outcome horizon at split boundaries. Training labels must exist before the training boundary, validation labels before the test boundary. Fit preprocessing on training only. Freeze weights before testing. Report fixed 0.5 and validation-selected thresholds; selection considers 0.1–0.9 in 0.1 increments, requires >=3 alerts and >=2 correct, then maximizes precision, distinct purchases, threshold. If no candidate qualifies, report no selected model. Evaluate alerts with 30-minute per-account cooldown; also report average precision and positive prevalence over all minute candidates. Adjacent minutes are correlated and do not represent independent purchases.

For mileage, fit Ridge (alpha10) and a small random forest (200 trees, depth2, leaf2) with expanding per-person history, requiring four prior fully labeled training examples. Inputs are last three comparable ledger intervals, median, spread and trend. Freeze each forecast before its target purchase; compare against last-three median on the identical scored cycles. Report all predictions and new-period predictions separately. This is a captured-distance experiment, not validation of full-tank range. Keep fitted models and per-decision datasets private; push reproducible code and aggregate results only.

## TimesFM 3 extension

Use the official `google/timesfm-3.0-pytorch` checkpoint with the upstream MLX backend locally and offline after download. Forecast one next purchase-cycle interval from prior comparable intervals, in purchase order, with default normalization/padding and no covariates or fine-tuning. Compare on all eligible forecasts and the exact four targets used by the trained mileage models. Do not use future target distances as context or mix different people's cycles. Report the short context, irregular calendar spacing, checkpoint revision and code revision. This evaluates captured-distance forecasting only; it does not turn TimesFM into a station classifier or establish full-tank range.
