"""Aggregate coverage and missing tank truth, without exporting identities or routes."""
import collections
import hashlib
import json
import sys
from pathlib import Path
from auditMileageCoverage import epoch
from automaticRefuelEvidence import infer
from backtestAnticipation import available
from inferMileageConfidence import load


def main(base, output, cutoff):
    groups, files = load(base, epoch(cutoff))
    kinds = {r['kind']: r['n'] for r in json.loads((base/'kinds.json').read_text())['data']['rows']}
    key_counts = collections.Counter()
    odometer_values = collections.Counter()
    new_stops = collections.Counter()
    full_stops = collections.Counter()
    location_fields, context_fields, diagnostic_sources, pedometer_fields = (collections.Counter() for _ in range(4))
    full_tank_keys = ('fulltank', 'isfulltank', 'full_tank', 'tankcapacity', 'tankcapacitygallons',
                      'gallons', 'gallonsbought', 'gallons_bought', 'fuellevel', 'fuel_level', 'fuelvolume', 'fuel_volume')
    def walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k.lower() in full_tank_keys:
                    key_counts[k] += 1
                if k == 'completeOdometer':
                    odometer_values[str(v)] += 1
                walk(v)
        elif isinstance(obj, list):
            for value in obj:
                walk(value)
    for events in groups:
        for e in events:
            walk(e['payload'])
            p = e['payload']
            if e['kind'] == 'location':
                for k in ('speedAccuracy', 'courseAccuracy', 'altitudeMeters', 'verticalAccuracyMeters', 'accessory', 'simulated'):
                    if k in p:
                        location_fields[k] += 1
            context_fields.update(p.get('contextAtReceipt', {}).keys())
            if e['kind'] == 'diagnostic' and p.get('source'):
                diagnostic_sources[p['source']] += 1
            if e['kind'] == 'visit_pedometer' and p.get('status') == 'available':
                pedometer_fields.update(k for k in ('steps', 'distanceMeters') if k in p)
        predictions, _ = infer(events)
        for p in predictions:
            full_stops[p['later_answer']] += 1
            if p['known_at'] >= epoch('2026-10-22T14:10:00Z'):
                new_stops[p['later_answer']] += 1
    def score(c):
        total = sum(c.values())
        return dict(predictions=total, correct=c['fueled'], wrong=total-c['fueled'], outcomes=dict(c))
    report = dict(cutoff=cutoff, database_events=sum(kinds.values()), exported_events=sum(len(es) for es in groups),
        accounts_with_exported_events=len(groups), kinds=kinds,
        location_field_presence=dict(location_fields), context_field_presence=dict(context_fields),
        diagnostic_sources=dict(diagnostic_sources), available_visit_pedometer_fields=dict(pedometer_fields),
        tank_quantity_key_occurrences=dict(key_counts), searched_tank_quantity_keys=list(full_tank_keys),
        complete_odometer_claims=dict(odometer_values),
        habitual_stop_inference=dict(all=score(full_stops), new_period=score(new_stops)),
        interpretation='Keys checked recursively in exported event payloads, not inferred profile defaults or simulator fixtures. No tank-quantity field means no measured tank target in this export. Stop inference is after arrival.',
        input_sha256={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
        source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    output.write_text(json.dumps(report, indent=2)+'\n')


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
