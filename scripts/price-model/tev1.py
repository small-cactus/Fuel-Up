"""Run on the owned Windows inference server; inputs contain no future labels."""
import json
import statistics
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API = 'http://127.0.0.1:11439'
BINS = [-1, -.5, -.25, -.15, -.1, -.05, 0, .05, .1, .15, .25, .5, 1]


def api(path, body=None):
    request = urllib.request.Request(API + path, headers={'Content-Type': 'application/json'},
                                     data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def request_for(features):
    return {
        'model': 'tev1:0.8b', 'keep_alive': '10m',
        'state': {'task': 'Forecast the next independent report for the same gas station, fuel grade and payment method, within 48 hours. Prices are USD per gallon. Only currently known observations follow. The current math is a heuristic, not ground truth. Keep unchanged prices when evidence for a correction is weak.',
                  'features': features},
        'questions': {
            'outdated': {'type': 'noul', 'instructions': 'Will the next reported price differ from the current price by at least $0.10 per gallon? A newer timestamp alone does not prove a price change.'},
            'correction': {'type': 'choice',
                           'instructions': 'Choose the closest signed correction: next report price minus current price, in USD per gallon. Zero means unchanged. Negative means next price lower; positive means higher. Predict conservatively from the known facts only.',
                           'criteria': {str(index): f'{delta:+.2f} dollars per gallon' for index, delta in enumerate(BINS)}},
        },
    }


cases = json.loads((ROOT / 'tev1-inputs.json').read_text())
metadata = {'version': api('/api/version'), 'models': api('/api/tags'), 'bins': BINS,
            'prompt': request_for({}), 'endpoint': '/v1/systemone'}
# Warm up on a real validation input, never on a label.
api('/v1/systemone', request_for(cases[0]['features']))
metadata['loaded'] = api('/api/ps')
(ROOT / 'tev1-metadata.json').write_text(json.dumps(metadata, indent=2) + "\n", newline="\n")
results = []
for index, case in enumerate(cases):
    started = time.perf_counter()
    try:
        response = api('/v1/systemone', request_for(case['features']))
        answer = response['answers']['correction']
        probability = response['answers']['outdated']['noul']
        probabilities = answer['probabilities']
        assert 0 <= probability <= 1
        assert abs(sum(probabilities.values()) - 1) < 1e-5
        assert all(0 <= p <= 1 for p in probabilities.values())
        expected = sum(BINS[int(key)] * value for key, value in probabilities.items())
        chosen = BINS[int(answer['choice'])]
        results.append({'sampleIndex': case['sampleIndex'], 'probability': probability,
                        'expectedDelta': expected, 'chosenDelta': chosen,
                        'seconds': time.perf_counter() - started, 'response': response})
    except Exception as error:
        results.append({'sampleIndex': case['sampleIndex'], 'error': str(error),
                        'seconds': time.perf_counter() - started})
    (ROOT / 'tev1-results.json').write_text(json.dumps(results, indent=2) + "\n", newline="\n")
    if (index + 1) % 50 == 0:
        print(f'Completed {index + 1}/{len(cases)}', flush=True)
print(json.dumps({'calls': len(results), 'failed': sum('error' in row for row in results),
                  'medianSeconds': statistics.median(row['seconds'] for row in results)}), flush=True)
