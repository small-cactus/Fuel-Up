"""Causal held-out comparison. See PROTOCOL.md; no application integration."""
import copy
import json
import platform
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import HuberRegressor, LogisticRegression, Ridge
from sklearn.metrics import (average_precision_score, brier_score_loss,
                             mean_absolute_error, roc_auc_score)
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.exceptions import ConvergenceWarning

warnings.filterwarnings('ignore', category=ConvergenceWarning)
ROOT = Path(sys.argv[1])
data = json.loads((ROOT / 'dataset.json').read_text())
samples = data['samples']
X = np.array([row['featureValues'] for row in samples])
y = np.array([row['correction'] for row in samples])
z = np.array([row['materiallyChanged'] for row in samples], dtype=int)
indices = {split: np.array([i for i, row in enumerate(samples) if row['split'] == split])
           for split in ['train', 'validation', 'test']}
train, validation, test = (indices[key] for key in ['train', 'validation', 'test'])
scaler = StandardScaler().fit(X[train])
scaled = scaler.transform(X)
target_mean, target_scale = float(y[train].mean()), max(float(y[train].std()), .05)
models, candidates = {}, []


def consider(family, setting, model, prediction, neural=False, classifier=False):
    loss = (brier_score_loss(z[validation], prediction[validation]) if classifier
            else mean_absolute_error(y[validation], prediction[validation]))
    candidates.append({'family': family, 'setting': setting, 'validationLoss': float(loss)})
    if family not in models or loss < models[family]['validationLoss']:
        models[family] = {'setting': setting, 'validationLoss': float(loss),
                          'model': copy.deepcopy(model), 'prediction': prediction.copy(),
                          'neural': neural, 'classifier': classifier}


for alpha in [1, 10, 100]:
    model = Ridge(alpha=alpha).fit(scaled[train], y[train])
    consider('ridge', {'alpha': alpha}, model, model.predict(scaled))
for epsilon in [1.35, 2]:
    model = HuberRegressor(epsilon=epsilon, max_iter=2000).fit(scaled[train], y[train])
    consider('huber', {'epsilon': epsilon}, model, model.predict(scaled))
for iterations in [30, 80]:
    model = HistGradientBoostingRegressor(max_leaf_nodes=7, max_iter=iterations,
                                         early_stopping=False, random_state=11).fit(scaled[train], y[train])
    consider('boosted_trees', {'iterations': iterations, 'leaves': 7}, model, model.predict(scaled))
for c in [.01, .1, 1, 10]:
    model = LogisticRegression(C=c, max_iter=2000, random_state=11).fit(scaled[train], z[train])
    consider('logistic', {'C': c}, model, model.predict_proba(scaled)[:, 1], classifier=True)
for seed in [11, 23, 47]:
    regression = MLPRegressor(hidden_layer_sizes=(16, 8), solver='adam', alpha=.01,
                              learning_rate_init=.001, random_state=seed, shuffle=False)
    classification = MLPClassifier(hidden_layer_sizes=(16, 8), solver='adam', alpha=.01,
                                    learning_rate_init=.001, random_state=seed, shuffle=False)
    for epoch in range(1, 241):
        regression.partial_fit(scaled[train], (y[train] - target_mean) / target_scale)
        classification.partial_fit(scaled[train], z[train], classes=[0, 1])
        if epoch in [30, 60, 120, 240]:
            setting = {'seed': seed, 'epochs': epoch, 'layers': [16, 8], 'alpha': .01}
            consider('tiny_mlp_price', setting, regression,
                     regression.predict(scaled) * target_scale + target_mean, neural=True)
            consider('tiny_mlp_stale', setting, classification,
                     classification.predict_proba(scaled)[:, 1], neural=True, classifier=True)

# Select before computing held-out metrics. Test outcomes never select models.
price_winner = min((name for name, model in models.items() if not model['classifier']),
                   key=lambda name: models[name]['validationLoss'])
stale_winner = min((name for name, model in models.items() if model['classifier']),
                   key=lambda name: models[name]['validationLoss'])


def price_metrics(prediction, subset):
    error = prediction[subset] - y[subset]
    changed = z[subset].astype(bool)
    return {'count': len(subset), 'maeCents': float(np.abs(error).mean() * 100),
            'rmseCents': float(np.sqrt(np.mean(error ** 2)) * 100),
            'within5Cents': float((np.abs(error) <= .05 + 1e-8).mean()),
            'within10Cents': float((np.abs(error) <= .10 + 1e-8).mean()),
            'underByMoreThan10Cents': int((error < -.10 - 1e-8).sum()),
            'overByMoreThan10Cents': int((error > .10 + 1e-8).sum()),
            'materialChangeMaeCents': float(np.abs(error[changed]).mean() * 100) if changed.any() else None}


def classification_metrics(probability, subset, threshold):
    truth = z[subset].astype(bool)
    alert = probability[subset] >= threshold
    tp, fp = int((alert & truth).sum()), int((alert & ~truth).sum())
    fn, tn = int((~alert & truth).sum()), int((~alert & ~truth).sum())
    return {'brier': float(brier_score_loss(truth, probability[subset])),
            'averagePrecision': float(average_precision_score(truth, probability[subset])),
            'rocAuc': float(roc_auc_score(truth, probability[subset])) if len(set(truth)) > 1 else None,
            'threshold': float(threshold), 'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn,
            'precision': tp / max(1, tp + fp), 'recall': tp / max(1, tp + fn),
            'f1': 2 * tp / max(1, 2 * tp + fp + fn)}


def select_threshold(probability):
    candidates = np.linspace(.05, .95, 19)
    return float(max(candidates, key=lambda threshold:
                     (classification_metrics(probability, validation, threshold)['f1'], threshold)))


def bootstrap_difference(prediction, baseline):
    rng = np.random.default_rng(11)
    stations = np.array([row['station'] for row in samples])[test]
    station_ids = np.unique(stations)
    delta = (np.abs(prediction[test] - y[test]) - np.abs(baseline[test] - y[test])) * 100
    clusters = {station: np.flatnonzero(stations == station) for station in station_ids}
    differences = [float(delta[np.concatenate([clusters[s] for s in rng.choice(station_ids, len(station_ids), replace=True)])].mean())
                   for _ in range(1000)]
    return {'meanCents': float(delta.mean()), 'stationBootstrap95Cents': np.quantile(differences, [.025, .975]).tolist()}


prices = {'unchanged_raw': np.zeros(len(y)),
          'current_math': np.array([row['mathPrice'] - row['rawPrice'] for row in samples]),
          'unbuffered_math': np.array([row['mathPrediction'] - row['rawPrice'] for row in samples]),
          'peer_median': np.array([row['peerMedian'] - row['rawPrice'] for row in samples])}
probabilities = {'never_flag': np.zeros(len(y)),
                 'current_math_risk': np.array([row['mathRisk'] for row in samples]),
                 'current_math_adjusted': np.array([row['mathAdjusted'] for row in samples], dtype=float)}
for name, model in models.items():
    (probabilities if model['classifier'] else prices)[name] = model['prediction']
thresholds = {name: select_threshold(probability) for name, probability in probabilities.items()}
results = {'datasetSummary': data['summary'], 'priceWinnerByValidation': price_winner,
           'staleWinnerByValidation': stale_winner, 'candidates': candidates,
           'environment': {'python': platform.python_version(), 'sklearn': sklearn.__version__,
                           'numpy': np.__version__, 'machine': platform.machine()},
           'testStationsSeenInTrain': len({samples[i]['station'] for i in test} & {samples[i]['station'] for i in train}),
           'price': {}, 'classification': {}, 'settings': {}}
for name, prediction in prices.items():
    results['price'][name] = {split: price_metrics(prediction, indices[split]) for split in ['validation', 'test']}
    results['price'][name]['differenceVsRaw'] = bootstrap_difference(prediction, prices['unchanged_raw'])
    results['price'][name]['differenceVsCurrentMath'] = bootstrap_difference(prediction, prices['current_math'])
for name, probability in probabilities.items():
    results['classification'][name] = {split: classification_metrics(probability, indices[split], thresholds[name])
                                       for split in ['validation', 'test']}
    results['classification'][name]['testAtHalf'] = classification_metrics(probability, test, .5)
for name, entry in models.items():
    model = entry['model']
    timings = []
    for _ in range(100):
        start = time.perf_counter()
        batch = scaler.transform(X[test[:1]])
        (model.predict_proba if entry['classifier'] else model.predict)(batch)
        timings.append((time.perf_counter() - start) * 1000)
    results['settings'][name] = {**entry['setting'], 'medianSingleRowMilliseconds': float(np.median(timings))}
    if entry['neural']:
        results['settings'][name]['parameters'] = sum(value.size for value in model.coefs_ + model.intercepts_)
        artifact = {'featureNames': data['featureNames'], 'scalerMean': scaler.mean_.tolist(),
                    'scalerScale': scaler.scale_.tolist(), 'layers': [value.tolist() for value in model.coefs_],
                    'biases': [value.tolist() for value in model.intercepts_], 'activation': 'relu',
                    'outputActivation': model.out_activation_, 'targetMean': 0 if entry['classifier'] else target_mean,
                    'targetScale': 1 if entry['classifier'] else target_scale, 'settings': results['settings'][name]}
        (ROOT / f'{name}.json').write_text(json.dumps(artifact, indent=2) + '\n')
    elif name in ['ridge', 'huber', 'logistic']:
        artifact = {'featureNames': data['featureNames'], 'scalerMean': scaler.mean_.tolist(),
                    'scalerScale': scaler.scale_.tolist(), 'coef': np.asarray(model.coef_).tolist(),
                    'intercept': np.asarray(model.intercept_).tolist(), 'settings': results['settings'][name]}
        (ROOT / f'{name}.json').write_text(json.dumps(artifact, indent=2) + '\n')
predictions = [{'id': row['id'], 'split': row['split'],
                'deltas': {name: float(values[i]) for name, values in prices.items()},
                'probabilities': {name: float(values[i]) for name, values in probabilities.items()}}
               for i, row in enumerate(samples)]
(ROOT / 'predictions.json').write_text(json.dumps(predictions, indent=2) + '\n')
(ROOT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps({'priceWinner': price_winner, 'staleWinner': stale_winner,
                  'priceTest': {name: value['test'] for name, value in results['price'].items()},
                  'classificationTest': {name: value['test'] for name, value in results['classification'].items()}}, indent=2))
