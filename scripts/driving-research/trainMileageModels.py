"""Expanding-window ML forecasts of captured miles between confirmed purchases.

Never a full-tank/remaining-range model. At each decision, only prior completed
cycles whose answers were already received can be training examples.
"""
import collections
import hashlib
import json
import statistics
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from auditMileageCoverage import epoch, ledger_interval
from backtestAnticipation import available
from inferMileageConfidence import load

TEST_START = epoch('2026-10-22T14:10:00Z')
FEATURES = ['last_cycle_miles', 'previous_cycle_miles', 'third_previous_cycle_miles',
            'median_three', 'spread_three', 'last_minus_previous']


def examples(events, account):
    observations, labels = {}, {}
    for e in sorted(events, key=lambda e: (available(e), e['id'])):
        if e['kind'] == 'visit_observation':
            observations.setdefault(e['payload']['visitId'], e)
        elif e['kind'] == 'visit_label':
            labels.setdefault(e['payload']['visitId'], []).append(e)
    fuels = sorted((e for vid, e in observations.items()
                    if labels.get(vid, [{}])[-1].get('payload', {}).get('label') == 'fueled'),
                   key=lambda e: e['payload']['startedAt'])
    cycles, rows = [], []
    for a, b in zip(fuels, fuels[1:]):
        decision = max(available(a), available(labels[a['payload']['visitId']][-1]))
        known = max(available(b), available(labels[b['payload']['visitId']][-1]), decision)
        ledger = ledger_interval(a, b)
        current_epoch = a['payload'].get('mileageAtReceipt', {}).get('epoch')
        prior = [c for c in cycles if c['known'] <= decision and c['epoch'] == current_epoch and c['boundaries'] == 0]
        if (len(prior) >= 3 and decision < b['payload']['startedAt']
                and ledger['status'] == 'comparable_receipt_endpoints'):
            recent = [c['miles'] for c in prior[-3:]]
            median = statistics.median(recent)
            rows.append(dict(account=account, decision=decision, known=known,
                history_miles=[c['miles'] for c in prior],
                x=[recent[2], recent[1], recent[0], median, max(recent)-min(recent), recent[2]-recent[1]],
                y=ledger['captured_miles'], baseline=median,
                new_period=decision >= TEST_START, gap_count=ledger['gap_count'], boundaries=ledger['collection_boundaries']))
        if ledger['status'] == 'comparable_receipt_endpoints':
            cycles.append(dict(known=known, epoch=current_epoch, boundaries=ledger['collection_boundaries'], miles=ledger['captured_miles']))
    return rows


def summarize(rows):
    return {name: dict(n=len(rows), mae_miles=float(np.mean([abs(r[name]-r['actual']) for r in rows])) if rows else None,
                       median_absolute_error_miles=float(np.median([abs(r[name]-r['actual']) for r in rows])) if rows else None)
            for name in ('median_baseline', 'ridge', 'random_forest')}


def main(base, output, cutoff):
    groups, files = load(base, epoch(cutoff))
    rows = sorted([r for account, es in enumerate(groups, 1) for r in examples(es, account)], key=lambda r: r['decision'])
    evaluated = []
    for r in rows:
        # Restrict to this person's historical labeled cycles; no person-ID feature.
        train = [p for p in rows if p['account'] == r['account'] and p['known'] <= r['decision'] and p['decision'] < r['decision']]
        if len(train) < 4:
            continue
        models = {'ridge': make_pipeline(StandardScaler(), Ridge(alpha=10)),
                  'random_forest': RandomForestRegressor(n_estimators=200, max_depth=2, min_samples_leaf=2, random_state=27, n_jobs=2)}
        result = dict(account=r['account'], new_period=r['new_period'], training_examples=len(train),
                      actual=r['y'], median_baseline=r['baseline'], gap_count=r['gap_count'], boundaries=r['boundaries'])
        for name, model in models.items():
            model.fit([p['x'] for p in train], [p['y'] for p in train])
            result[name] = max(0., float(model.predict([r['x']])[0]))
        evaluated.append(result)
    # Preserve final local fitted models for reproducibility; they are not deployed.
    for account in {r['account'] for r in rows}:
        train = [r for r in rows if r['account'] == account and r['known'] < epoch(cutoff)]
        if len(train) >= 4:
            model = make_pipeline(StandardScaler(), Ridge(alpha=10))
            model.fit([r['x'] for r in train], [r['y'] for r in train])
            path = base/'ml'/f'mileage-ridge-account-{account}.joblib'
            path.parent.mkdir(mode=0o700, exist_ok=True)
            joblib.dump(model, path)
            path.chmod(0o600)
    result = dict(cutoff=cutoff, features=FEATURES, eligible_examples=len(rows),
        examples_per_account=dict(collections.Counter(r['account'] for r in rows)),
        methods='Per-person expanding-window training, minimum four prior labeled examples; fixed Ridge alpha=10 and 200-tree forest depth2 leaf2. Compare on identical forecast targets; no hyperparameter tuning.',
        limitations=['Very small correlated cycles, not sufficient to validate generalization.',
                     'Target is captured mileage between purchases, not true odometer distance or miles since a full tank.',
                     'Recorded gaps retained and disclosed. A clean ledger still does not verify complete travel.',
                     'New-period means forecast issued on/after Oct22 cutoff. Online models may learn from earlier new-period answers only after receipt.'],
        all_evaluated=summarize(evaluated), new_period=summarize([r for r in evaluated if r['new_period']]), details=evaluated,
        input_sha256={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
        source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    output.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: result[k] for k in ('eligible_examples', 'examples_per_account', 'all_evaluated', 'new_period')}, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
