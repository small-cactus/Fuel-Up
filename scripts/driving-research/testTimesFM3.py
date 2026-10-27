"""Offline TimesFM 3.0 zero-shot forecasts of successive purchase intervals.

The time axis is purchase-cycle index, not regularly spaced calendar days.
Use only a local checkpoint. Never upload participant data to a model service.
"""
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
from timesfm3.mlx import TimesFM3Forecaster

from auditMileageCoverage import epoch
from inferMileageConfidence import load
from trainMileageModels import examples


def summary(rows):
    return {name: dict(n=len(rows), mae_miles=float(np.mean([abs(r[name]-r['actual']) for r in rows])) if rows else None)
            for name in ('median_baseline', 'timesfm3')}


def main(base, output, cutoff, checkpoint, upstream_commit):
    if not checkpoint.is_dir():
        raise ValueError('Download the public checkpoint separately; inference must be offline')
    groups, files = load(base, epoch(cutoff))
    rows = sorted([r for account, es in enumerate(groups, 1) for r in examples(es, account)], key=lambda r: r['decision'])
    started = time.monotonic()
    model = TimesFM3Forecaster.from_pretrained(str(checkpoint), local_files_only=True, compile=True)
    loaded = time.monotonic()
    outputs = list(model.predict_batch([np.asarray(r['history_miles'], dtype=np.float32) for r in rows],
                   horizon=1, return_quantiles=True, use_symmetric_averaging=False, use_znorm=False, padding_mode='none'))
    finished = time.monotonic()
    details = []
    for r, out in zip(rows, outputs, strict=True):
        training = [p for p in rows if p['account'] == r['account'] and p['known'] <= r['decision'] and p['decision'] < r['decision']]
        forecast = float(out.forecast[0])
        details.append(dict(account=r['account'], context_cycles=len(r['history_miles']),
            new_period=r['new_period'], matches_trained_ml_targets=len(training) >= 4,
            actual=r['y'], median_baseline=r['baseline'], timesfm3=max(0, forecast), raw_forecast=forecast,
            quantiles=list(map(float, out.quantiles[0])), gap_count=r['gap_count'], boundaries=r['boundaries']))
    report = dict(cutoff=cutoff, checkpoint='google/timesfm-3.0-pytorch', checkpoint_revision=checkpoint.name,
        upstream_code_commit=upstream_commit,
        backend='official MLX Apple Silicon backend', trained_on_this_dataset=False,
        target='Captured miles in the next purchase cycle; irregular calendar intervals indexed by purchase order.',
        configuration=dict(horizon=1, compile=True, symmetric_averaging=False, znorm=False, padding='none'),
        model_load_seconds=loaded-started, forecast_batch_seconds=finished-loaded,
        all_forecasts=summary(details), new_period=summary([r for r in details if r['new_period']]),
        same_targets_as_trained_ml=summary([r for r in details if r['matches_trained_ml_targets']]), details=details,
        limitations=['Only a handful of purchase intervals per person; context is much shorter than typical foundation-model workloads.',
                     'Zero-shot inference, not fine-tuning and not a station-classification model.',
                     'No actual fuel quantity, full-tank status or complete odometer target. Quantiles are not calibrated here.',
                     'Local research evaluation only; no app deployment. Checkpoint has a separate non-commercial license.'],
        source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        dependency_sha256={name: hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()
                           for name in ('trainMileageModels.py', 'auditMileageCoverage.py', 'inferMileageConfidence.py')},
        checkpoint_sha256={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in checkpoint.iterdir() if p.is_file()},
        input_sha256={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files})
    output.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: report[k] for k in ('all_forecasts', 'new_period', 'same_targets_as_trained_ml', 'model_load_seconds', 'forecast_batch_seconds')}, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]), sys.argv[5])
