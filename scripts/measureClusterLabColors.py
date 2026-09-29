"""Measure rendered colors at repeated, fixed Glass Lab camera checkpoints.

Usage: python3 scripts/measureClusterLabColors.py path/to/manifest.json
Requires Pillow and numpy. Captures must be full-resolution PNG screenshots,
not UIView snapshots. Manifest captures contain checkpoint, cycle, path and
the corresponding Argent AX tree. Paths may be relative to the manifest.
Use --visible-bottom to exclude the card/tab overlays on the tested device.
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image


def chips(tree, bottom):
    pattern = r'AXGroup "([^"]+)" value="(\$[^"]+|\+\d+)"  \(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)'
    return [dict(name=n, value=v.split(',')[0], x=float(x), y=float(y), w=float(w), h=float(h))
            for n, v, x, y, w, h in re.findall(pattern, tree)
            if float(y) >= 0 and float(y) + float(h) < bottom]


def lab(rgb):
    # sRGB, D65, CIE Lab. Delta E 76 is diagnostic, not a pass threshold.
    c = np.asarray(rgb) / 255
    c = np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)
    xyz = np.array([[.4124564, .3575761, .1804375], [.2126729, .7151522, .0721750],
                    [.0193339, .1191920, .9503041]]) @ c
    v = xyz / np.array([.95047, 1, 1.08883])
    f = np.where(v > (6 / 29) ** 3, np.cbrt(v), v / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])


def sample(image, frame):
    height, width = image.shape[:2]
    def point(x, y):
        return round((frame['x'] + x * frame['w']) * width), round((frame['y'] + y * frame['h']) * height)
    bands = []
    for top, bottom in [(.15, .23), (.77, .85)]:
        x0, y0 = point(.30, top)
        x1, y1 = point(.70, bottom)
        bands.append(image[y0:y1, x0:x1].reshape(-1, 3))
    fixed = []
    for x in [.30, .50, .70]:
        for y in [.17, .83]:
            px, py = point(x, y)
            fixed.append(np.mean(image[py-1:py+2, px-1:px+2], axis=(0, 1)))
    return np.median(np.concatenate(bands), axis=0), np.asarray(fixed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--visible-bottom', type=float, default=.53)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    baselines, results = {}, []
    for capture in manifest['captures']:
        path = args.manifest.parent / capture['path']
        image = np.asarray(Image.open(path).convert('RGB'))
        current = chips(capture['tree'], args.visible_bottom)
        key = capture['checkpoint']
        if key not in baselines:
            baselines[key] = (image, current)
        base, positions = baselines[key]
        if image.shape != base.shape:
            raise ValueError('Checkpoint image dimensions changed')
        for frame in positions:
            # A promoted +N view may retain its original child's AX name.
            matches = [c for c in current if c['value'] == frame['value'] and
                       (frame['value'].startswith('+') or c['name'] == frame['name'])]
            match = min(matches, key=lambda c: (c['x']-frame['x'])**2 + (c['y']-frame['y'])**2) if matches else None
            geometry = max(abs(match[k]-frame[k]) for k in ['x', 'y', 'w', 'h']) if match else None
            before, before_points = sample(base, frame)
            after, after_points = sample(image, frame)
            results.append(dict(checkpoint=key, cycle=capture['cycle'], chip=frame['name']+' '+frame['value'],
                                geometry=geometry, baselineRGB=before.tolist(), rgb=after.tolist(),
                                deltaE76=float(np.linalg.norm(lab(after)-lab(before))),
                                fixedPointRGB=after_points.tolist(), baselinePointRGB=before_points.tolist(),
                                maxPointChannelDelta=float(np.max(abs(after_points-before_points)))))
    # AX frames are rounded to 0.001. Mismatched geometry is reported separately,
    # never silently counted as stable color. Every sample uses baseline pixels.
    valid = [r for r in results if r['geometry'] is not None and r['geometry'] <= .00100001]
    idle = [r for r in valid if str(r['cycle']).startswith('idle')]
    summary = dict(captures=len(manifest['captures']), samples=len(valid),
                   geometryMismatches=len(results)-len(valid),
                   maxIdlePointDelta=max((r['maxPointChannelDelta'] for r in idle), default=None),
                   maxPointChannelDelta=max((r['maxPointChannelDelta'] for r in valid), default=None))
    output = args.manifest.with_name('pixel-measurements.json')
    output.write_text(json.dumps(dict(summary=summary, measurements=results), indent=2)+'\n')
    print(json.dumps(summary, indent=2))
    for key in sorted({(r['checkpoint'], r['chip']) for r in valid}):
        rows = [r for r in valid if (r['checkpoint'], r['chip']) == key]
        worst = max(rows, key=lambda r: r['maxPointChannelDelta'])
        print(f"{key}: point delta {worst['maxPointChannelDelta']:.2f}/255, cycle {worst['cycle']}")
    print(output)


if __name__ == '__main__':
    main()
