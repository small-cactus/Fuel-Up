#!/usr/bin/env python3
"""Summarize an xctrace time-profile XML export. CPU samples are not wall time.

Export with xctrace export --input capture.trace --xpath
'/trace-toc/run[@number="1"]/data/table[@schema="time-profile"][1]'
--output capture.xml. Record the same template/duration/device for comparisons.
"""
import json
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
refs = {node.get('id'): node for node in root.iter() if node.get('id')}
def resolve(node):
    return refs.get(node.get('ref'), node) if node is not None else None
samples = []
for row in root.iter('row'):
    trace = resolve(row.find('tagged-backtrace'))
    if trace is None:
        continue
    time = resolve(row.find('sample-time'))
    thread = resolve(row.find('thread'))
    weight = resolve(row.find('weight'))
    names = [resolve(frame).get('name', '') for frame in trace]
    samples.append((int(time.text) / 1e9, thread.get('fmt', ''), int(weight.text) / 1e6, names))
if not samples:
    raise SystemExit('No time-profile samples; do not treat this as a zero-cost launch.')
start = min(sample[0] for sample in samples)
window = [sample for sample in samples if sample[0] < start + 3]
metrics = {'windowSeconds': 3, 'sampleWindowOrigin': 'first sampled process activity',
           'mainThreadCpuMs': 0, 'jsThreadCpuMs': 0, 'legacyBlurCpuMs': 0,
           'totalCpuMs': 0, 'firstMapKitSampleMs': None}
for time, thread, weight, names in window:
    metrics['totalCpuMs'] += weight
    if 'Main Thread' in thread:
        metrics['mainThreadCpuMs'] += weight
    if 'JavaScript' in thread:
        metrics['jsThreadCpuMs'] += weight
    if any('VariableBlurView' in name or 'ProgressiveBlurView' in name for name in names):
        metrics['legacyBlurCpuMs'] += weight
    if metrics['firstMapKitSampleMs'] is None and any('MKMapView' in name for name in names):
        metrics['firstMapKitSampleMs'] = round((time - start) * 1000, 2)
print(json.dumps(metrics, indent=2))
