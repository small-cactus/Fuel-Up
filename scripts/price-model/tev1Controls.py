"""Diagnostic controls after v1 failed; not another held-out model selection."""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
cases = []
bins = [-1, -.5, -.25, -.15, -.1, -.05, 0, .05, .1, .15, .25, .5, 1]
for named in [False, True]:
    for order in [[-.5, 0, .5], [.5, -.5, 0], [0, .5, -.5],
                  bins, list(reversed(bins)), [0] + [value for value in bins if value != 0]]:
        keys = {delta: (('unchanged' if delta == 0 else ('lower_' if delta < 0 else 'higher_') + str(round(abs(delta) * 100)))
                        if named else str(index)) for index, delta in enumerate(order)}
        for instruction in ['The known correct change is 0.00. Select the zero change option.',
                            'Old price is 5.00 and new price is 5.00. Select new price minus old price.']:
            cases.append({'expected': keys[0], 'named': named, 'order': order,
                          'request': {'model': 'tev1:0.8b', 'state': instruction,
                                      'questions': {'answer': {'type': 'choice',
                                                              'instructions': 'Select the correct price change from the state.',
                                                              'criteria': {keys[d]: f'{d:+.2f} dollars per gallon' for d in order}}},
                                      'keep_alive': '5m'}})
results = []
for case in cases:
    request = urllib.request.Request('http://127.0.0.1:11439/v1/systemone',
                                     headers={'Content-Type': 'application/json'},
                                     data=json.dumps(case['request']).encode())
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.load(response)
    results.append({**case, 'response': result,
                    'correct': result['answers']['answer']['choice'] == case['expected']})
(ROOT / 'tev1-controls.json').write_text(json.dumps(results, indent=2) + "\n", newline="\n")
print(json.dumps({'count': len(results), 'correct': sum(result['correct'] for result in results)}))
