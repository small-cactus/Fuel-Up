"""Score fixed Tev1 outputs against the same untouched chronological test."""
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

ROOT = Path(sys.argv[1])
data = json.loads((ROOT / 'dataset.json').read_text())
calls = json.loads((ROOT / 'tev1-results.json').read_text())
samples = data['samples']
validation = [i for i, row in enumerate(samples) if row['split'] == 'validation']
test = [i for i, row in enumerate(samples) if row['split'] == 'test']
assert len(calls) == len(validation) + len(test)
assert {call['sampleIndex'] for call in calls} == set(validation + test)
assert len({call['sampleIndex'] for call in calls}) == len(calls)
failed = [call for call in calls if 'error' in call]
assert not failed, 'Report failed calls explicitly; do not drop them to improve scores.'
by_index = {call['sampleIndex']: call for call in calls}


def price_metrics(key, subset):
    error = np.array([by_index[i][key] - samples[i]['correction'] for i in subset])
    changed = np.array([samples[i]['materiallyChanged'] for i in subset])
    return {'count': len(subset), 'maeCents': float(np.abs(error).mean() * 100),
            'rmseCents': float(np.sqrt(np.mean(error ** 2)) * 100),
            'within5Cents': float((np.abs(error) <= .05 + 1e-8).mean()),
            'within10Cents': float((np.abs(error) <= .10 + 1e-8).mean()),
            'underByMoreThan10Cents': int((error < -.10 - 1e-8).sum()),
            'overByMoreThan10Cents': int((error > .10 + 1e-8).sum()),
            'materialChangeMaeCents': float(np.abs(error[changed]).mean() * 100)}


def classification_metrics(subset, threshold):
    truth = np.array([samples[i]['materiallyChanged'] for i in subset])
    probability = np.array([by_index[i]['probability'] for i in subset])
    alert = probability >= threshold
    tp, fp = int((alert & truth).sum()), int((alert & ~truth).sum())
    fn, tn = int((~alert & truth).sum()), int((~alert & ~truth).sum())
    return {'brier': float(brier_score_loss(truth, probability)),
            'averagePrecision': float(average_precision_score(truth, probability)),
            'rocAuc': float(roc_auc_score(truth, probability)), 'threshold': float(threshold),
            'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn, 'precision': tp / max(1, tp + fp),
            'recall': tp / max(1, tp + fn), 'f1': 2 * tp / max(1, 2 * tp + fp + fn)}


def bootstrap_difference(key, field=None):
    rng = np.random.default_rng(11)
    stations = np.array([samples[i]['station'] for i in test])
    station_ids = np.unique(stations)
    delta = np.array([abs(by_index[i][key] - samples[i]['correction']) -
                      abs((samples[i][field] - samples[i]['rawPrice'] if field else 0) - samples[i]['correction'])
                      for i in test]) * 100
    clusters = {station: np.flatnonzero(stations == station) for station in station_ids}
    differences = [float(delta[np.concatenate([clusters[s] for s in rng.choice(station_ids, len(station_ids), replace=True)])].mean())
                   for _ in range(1000)]
    return {'meanCents': float(delta.mean()), 'stationBootstrap95Cents': np.quantile(differences, [.025, .975]).tolist()}


# Fix choice of decoder and decision threshold using validation only.
decoder = min(['expectedDelta', 'chosenDelta'], key=lambda key: price_metrics(key, validation)['maeCents'])
threshold = float(max(np.linspace(.05, .95, 19), key=lambda value:
                      (classification_metrics(validation, value)['f1'], value)))
results = {'selectedDecoderByValidation': decoder, 'calls': len(calls), 'failed': len(failed),
           'classification': {name: classification_metrics(subset, threshold)
                              for name, subset in [('validation', validation), ('test', test)]},
           'testAtHalf': classification_metrics(test, .5), 'price': {},
           'latencySeconds': {'median': float(np.median([call['seconds'] for call in calls])),
                              'p95': float(np.quantile([call['seconds'] for call in calls], .95))},
           'inputTokens': {'min': min(call['response']['usage']['input_tokens'] for call in calls),
                           'max': max(call['response']['usage']['input_tokens'] for call in calls)}}
for key in ['expectedDelta', 'chosenDelta']:
    results['price'][key] = {name: price_metrics(key, subset) for name, subset in [('validation', validation), ('test', test)]}
    results['price'][key]['differenceVsRaw'] = bootstrap_difference(key)
    results['price'][key]['differenceVsCurrentMath'] = bootstrap_difference(key, 'mathPrice')
(ROOT / 'tev1-scores.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
