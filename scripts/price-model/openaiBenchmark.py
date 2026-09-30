"""One request per model/decision; no tools, examples, retries, or prompt tuning."""
import argparse
import concurrent.futures
import hashlib
import gzip
import json
import os
import random
import time
import urllib.error
import urllib.request
from pathlib import Path
from priceHistory import station_histories

PROMPT = """You select a gas station for a user who wants the cheapest reliable price.
A stale low quote that wins the ranking but actually costs more than an alternative
is the main failure. Minimize expected extra dollars/gallon paid at your selected
station, not average prediction error across all stations.

For each candidate estimate the price in its next independently newer report,
if received within 48 hours. This is only a proxy for the unknown current pump
price: age alone does not prove an error, and updates can leave prices unchanged.
Also estimate probability that this next report exceeds the raw quote by at least
$0.10/gallon. Recommend exactly one candidate using the available evidence.

All supplied candidates are eligible for this price-only experiment, same fuel
and payment. Membership access and travel costs are outside this experiment.
Inputs are causal feature summaries available at the decision time. Price/gap
units are dollars/gallon; ages are hours. peer_gap = historical nearby median minus
raw price; previous_station_gap = raw minus previous price; math_display_gap and
math_prediction_gap are the existing heuristic's displayed/predicted minus raw
price. Existing math is fallible; risk/validity and low/stale/plateau/jump/replay
are heuristic scores, not calibrated probabilities. Boolean indicators are 0/1.
Peers are latest prior reports within 8 miles and 72 hours. peer_spread is median
absolute deviation. No peers means peer_gap/spread=0, peer_age=72; missing previous
station history means previous_station_gap=0 and previous_station_age=336.
hour_sin/cos represent local hour. IDs are arbitrary and ordering is randomized.
Each candidate also includes its last up to eight independently timestamped raw
reports, oldest observation first, from the prior 14 days in this cached market.
source_age_hours is report age at the decision; first_seen_age_hours and
last_seen_age_hours say when our cache first/last observed that report. Repeated
cache_observations do NOT mean independent price confirmations. Use these sequences
to assess station update cadence, price changes, and lag relative to nearby
stations. Missing history means unknown, not stable. This request-driven history
has gaps and source report times are not verified pump-change times.
Do not invent external information. Return only the requested structured answer,
one prediction per supplied candidate, without explanations or reasoning text."""

SCHEMA = {"type": "object", "additionalProperties": False,
          "properties": {"recommended_id": {"type": "string"}, "predictions": {
              "type": "array", "items": {"type": "object", "additionalProperties": False,
                  "properties": {"id": {"type": "string"},
                      "price": {"type": "number"},
                      "underpriced_probability": {"type": "number"}},
                  "required": ["id", "price", "underpriced_probability"]}}},
          "required": ["recommended_id", "predictions"]}


def prepare(dataset, ranking, history):
    groups = {}
    for row in dataset['samples']:
        groups.setdefault(row['snapshotId'] + '|' + row['payment'], []).append(row)
    cases = []
    for batch in ranking['details']:
        if not batch['firstOccurrence']:
            continue
        rows = sorted(groups[batch['id']], key=lambda row: row['station'])
        histories = station_histories(history, batch['id'], [row['station'] for row in rows])
        random.Random(hashlib.sha256(batch['id'].encode()).hexdigest()).shuffle(rows)
        inputs, mapping = [], {}
        for index, row in enumerate(rows):
            ident = f'S{index + 1:02d}'
            mapping[ident] = row['station']
            inputs.append({'id': ident, 'features': dict(zip(dataset['featureNames'], row['featureValues'])),
                           'history': histories[row['station']]})
        cases.append({'case': len(cases), 'batchId': batch['id'], 'idMap': mapping,
                      'input': {'candidates': inputs}})
    return {'protocol': 'one-shot selection audit v2 with histories; user-directed addition after three API smoke calls',
            'instructions': PROMPT, 'schema': SCHEMA, 'cases': cases}


def call(case, model, effort, key):
    body = {'model': model, 'reasoning': {'effort': effort}, 'store': False,
            'instructions': PROMPT, 'input': json.dumps(case['input'], separators=(',', ':')),
            'max_output_tokens': 6000,
            'text': {'format': {'type': 'json_schema', 'name': 'station_choice', 'strict': True, 'schema': SCHEMA}}}
    started = time.perf_counter()
    result = {'case': case['case'], 'requestedModel': model, 'reasoningEffort': effort}
    try:
        request = urllib.request.Request('https://api.openai.com/v1/responses',
            data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=120) as response:
            value = json.load(response)
        result.update({'model': value.get('model'), 'status': value.get('status'), 'usage': value.get('usage'),
                       'responseId': value.get('id'), 'incompleteDetails': value.get('incomplete_details')})
        text = ''.join(content.get('text', '') for item in value.get('output', [])
                       if item.get('type') == 'message' for content in item.get('content', [])
                       if content.get('type') == 'output_text')
        result['outputText'] = text
        parsed = json.loads(text)
        expected = set(case['idMap'])
        predicted = [row['id'] for row in parsed['predictions']]
        assert len(predicted) == len(expected) and set(predicted) == expected, 'candidate mismatch'
        assert parsed['recommended_id'] in expected, 'invalid recommendation'
        assert all(0 < row['price'] < 20 and 0 <= row['underpriced_probability'] <= 1 for row in parsed['predictions']), 'invalid numeric output'
        assert result['status'] == 'completed', 'incomplete response'
        if effort == 'none':
            assert result['usage']['output_tokens_details']['reasoning_tokens'] == 0, 'reasoning was not disabled'
        result['prediction'] = parsed
        result['valid'] = True
    except urllib.error.HTTPError as error:
        # Never persist authorization headers, credentials, or full request objects.
        result.update({'valid': False, 'httpStatus': error.code, 'error': error.read().decode()[:1000].replace(key, '[REDACTED]')})
    except Exception as error:
        result.update({'valid': False, 'error': str(error)[:500].replace(key, '[REDACTED]')})
    result['elapsedSeconds'] = time.perf_counter() - started
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--dataset', default='/tmp/fuelup-ranking-snapshots.json')
    parser.add_argument('--root', default='docs/research/2026-09-30-price-model')
    parser.add_argument('--model', choices=['gpt-6-luna', 'gpt-5.6-terra', 'gpt-6.1-sol'])
    parser.add_argument('--effort', choices=['none', 'low'], default='none')
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    root = Path(args.root)
    input_path = root / 'openai-history-inputs.json'
    if args.prepare:
        history = json.loads(gzip.decompress((root / 'history-snapshot.json.gz').read_bytes()))['rows']
        inputs = prepare(json.loads(Path(args.dataset).read_text()), json.loads((root / 'ranking-results.json').read_text()), history)
        input_path.write_text(json.dumps(inputs, indent=2) + '\n')
        print('Prepared', len(inputs['cases']), 'label-free cases')
        return
    assert args.model
    assert args.model != 'gpt-6.1-sol' or args.effort == 'low'
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        key = Path(os.environ['OPENAI_API_KEY_FILE']).read_text().strip()
    inputs = json.loads(input_path.read_text())
    assert inputs['instructions'] == PROMPT and inputs['schema'] == SCHEMA, 'frozen prompt changed'
    output = root / f'openai-history-{args.model}-{args.effort}.jsonl'
    existing = [json.loads(line) for line in output.read_text().splitlines()] if output.exists() else []
    done = {row['case'] for row in existing}
    cases = [case for case in inputs['cases'] if case['case'] not in done]
    if args.limit is not None:
        cases = cases[:args.limit]
    # No automatic retry. Failed requests remain failures in the saved evidence.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor, output.open('a') as stream:
        futures = [executor.submit(call, case, args.model, args.effort, key) for case in cases]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            stream.write(json.dumps(result) + '\n')
            stream.flush()
            print(args.model, result['case'], 'ok' if result['valid'] else 'failed', round(result['elapsedSeconds'], 2), flush=True)


if __name__ == '__main__':
    main()
