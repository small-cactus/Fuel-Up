"""Reconstruct the original selected tree fit; verify before new inference."""
import json
import sys
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

root = Path(sys.argv[2])
original = json.loads((root / 'dataset.json').read_text())
new = json.loads(Path(sys.argv[1]).read_text())
scaler = json.loads((root / 'ridge.json').read_text())
assert new['featureNames'] == original['featureNames'] == scaler['featureNames']
X = np.array([row['featureValues'] for row in original['samples']])
scaled = (X - scaler['scalerMean']) / scaler['scalerScale']
train = [i for i, row in enumerate(original['samples']) if row['split'] == 'train']
y = np.array([row['correction'] for row in original['samples']])
settings = json.loads((root / 'results.json').read_text())['settings']['boosted_trees']
model = HistGradientBoostingRegressor(max_leaf_nodes=settings['leaves'],
    max_iter=settings['iterations'], early_stopping=False, random_state=11).fit(scaled[train], y[train])
prior = {row['id']: row['deltas']['boosted_trees'] for row in json.loads((root / 'predictions.json').read_text())}
error = max(abs(value - prior[row['id']]) for row, value in zip(original['samples'], model.predict(scaled)))
assert error < 1e-10
newX = (np.array([row['featureValues'] for row in new['samples']]) - scaler['scalerMean']) / scaler['scalerScale']
result = {'settings': settings, 'verifiedOriginalSamples': len(original['samples']),
          'maxOriginalDifference': error, 'predictions': {
              row['id']: float(row['rawPrice'] + delta) for row, delta in zip(new['samples'], model.predict(newX))}}
(root / 'ranking-tree-predictions.json').write_text(json.dumps(result, indent=2) + '\n')
print('Restored original tree; maximum prediction difference:', error)
