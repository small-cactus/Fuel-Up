# Nationwide causal price-model experiment

Research pipeline only. It does not fetch provider prices or modify app rankings.

1. Freeze `docs/research/2026-10-04-prospective-model/PROTOCOL.md` before training.
2. `node scripts/price-model/prospective/export.mjs /absolute/research-dir 2026-10-04T02:30:00Z`
3. Export static station coordinates to `geography.json` as records containing `station_id`, `latitude`, and `longitude`. Do not include serving prices. Save the exact file hash for reproducibility.
4. `python scripts/price-model/prospective/ingest.py /absolute/research-dir docs/research/2026-09-30-national-prices/verified-catalog.json.gz`
5. `python scripts/price-model/prospective/features.py /absolute/research-dir`
6. `python -m unittest discover -s scripts/price-model/prospective -p 'test_*.py'`
7. On a CUDA machine with CatBoost, NumPy, scikit-learn, and PyTorch: `python scripts/price-model/prospective/train_trees.py /absolute/research-dir/dataset /absolute/results-dir` and then `python scripts/price-model/prospective/train_neural.py /absolute/research-dir/dataset /absolute/results-dir`.

8. Run `python scripts/price-model/prospective/compare.py /absolute/results-dir` after both model families finish. This saves development selection, state/fuel/age slices, prediction hashes and model versions.

The dense arrays preserve missing observations as NaN. Each downloaded successful batch must match its immutable hash, byte count, exact inventory IDs, regional assignment and collection timestamps. Empty historical hours remain empty. The training split purges labels observed after its boundary. Day-four/five results are development selection only; final evaluation requires the reserved future window.

`meta` contains station index, grade/payment index, hourly index, observed hours since campaign start, target-availability hours, split, and city-panel index. Station index is evaluation metadata and never a model feature. Split 0 trains, split 1 selects using source-event examples, and split 2 checks full price-only geographic decision panels without removing unlabelled candidates. Grade/payment observations from the same station are correlated.

Models predict a residual in dollars/gallon to add to the observed raw quote. Output remains an estimate. Source reports and raw archives are never overwritten. A research win does not authorize production promotion or establish pump-price accuracy.

No credentials may be saved in datasets, logs, models or commits. `export.mjs` obtains the existing authorized Storage credential into memory only. Its download path is fixed to the source project/bucket and manifest paths.

## Trained experiment and frozen candidate

See `docs/research/2026-10-04-prospective-model/RESULTS.md` and `FROZEN_CANDIDATE.json`. The selected model is a research candidate, not production approved.

Verify saved assets with `python scripts/price-model/prospective/verify_artifacts.py docs/research/2026-10-04-prospective-model/artifacts`.

Run frozen inference on CUDA with `python scripts/price-model/prospective/inference.py /absolute/artifacts/results /absolute/inputs.npz /absolute/predictions.npz`. Inputs must contain the exact 47-column `X` feature matrix and a `(rows,24,4)` `sequence`, as defined by `features.py`; no labels are read. The policy retains raw price for predicted corrections below 10 cents and caps applied corrections at 20 cents. Output prices remain estimates.

`replay_candidate.py` verifies the saved checkpoint against every preserved development prediction. `audit_candidate.py` reproduces the adverse-case policy sensitivity checks. `train_hurdle.py` trains the station-balanced change detector and conditional regressors. `augment_oil.py` adds past-only crude features to a separate dataset, preserving labels/splits exactly. `oil_lags.py` evaluates the separate aggregate historical lag question. TimesFM preparation/benchmark scripts are isolated research tools; its weights are not a production dependency.

The final two-day window remains reserved. These scripts do not automatically unlock it or deploy the candidate.

The Windows GPU environment is recorded in `training-environment.txt`. Install its CUDA PyTorch wheel from the official `https://download.pytorch.org/whl/cu128` index before installing the remaining pinned packages. For TimesFM reproduction, copy `src/timesfm3` from the upstream commit in `timesfm-source.json` into the research directory's `src` folder; the benchmark pins the upstream model revision and uses a local cache. Review and honor the model license before running it. The 24-hour sequence is shared by the two trained neural networks; TimesFM instead uses causal report-event contexts prepared by `prepare_timesfm.py`.
