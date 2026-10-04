"""Augment existing eligible query cohorts; never refetch provider prices."""
import argparse, hashlib, json, warnings
from pathlib import Path
import numpy as np
from signals import history_features, corroborated_labels, agreement_features, split
warnings.filterwarnings('ignore', category=RuntimeWarning)


def build(arrays, datasets, out):
    out.mkdir(parents=True, exist_ok=True)
    am = json.loads((arrays/'metadata.json').read_text())
    assert am['cutoff'] <= '2026-10-05T18:19:00.000Z'
    p,s,o = [np.load(arrays/(name+'.npy'), mmap_mode='r') for name in ['prices','sources','observed']]
    names = json.loads((datasets[0]/'metadata.json').read_text())['features']
    stats = {'input_rows':0,'no_confirmation':0,'ambiguous':0,'boundary_purged':0}
    digest = hashlib.sha256(); index = 0
    for root in datasets:
        assert json.loads((root/'metadata.json').read_text())['features'] == names
        for file in sorted(root.glob('part-*.npz')):
            digest.update(hashlib.sha256(file.read_bytes()).digest())
            d = np.load(file)
            eligible = d['meta'][:,5] != 2  # Ranking panels are a separate, overlapping sampling task.
            X = d['X'][eligible]; meta = d['meta'][eligible]; stats['input_rows'] += len(X)
            for start in range(0,len(X),8192):
                x = X[start:start+8192]; m = meta[start:start+8192]
                if not len(x): continue
                station, product, t = [m[:,i].astype(int) for i in range(3)]
                hn,hv = history_features(p,s,o,station,product,t)
                an,av = agreement_features(x,names)
                y,end,first,second = corroborated_labels(p,s,o,station,product,t)
                splits = split(m[:,3],end)
                stats['no_confirmation'] += int((~np.isfinite(end)).sum())
                stats['ambiguous'] += int(((y < 0) & np.isfinite(end)).sum())
                stats['boundary_purged'] += int(((y >= 0) & (splits < 0)).sum())
                keep = (y >= 0) & (splits >= 0)
                np.savez_compressed(out/f'part-{index:04}.npz', X=np.column_stack([x,hv,av])[keep], y=y[keep],
                                    meta=m[keep], split=splits[keep], end=end[keep], first=first[keep], second=second[keep])
                index += 1
            if index % 40 == 0: print(index, stats, flush=True)
    (out/'metadata.json').write_text(json.dumps({'features':names+hn+an,'base_features':len(names),'stats':stats,
        'input_hash':digest.hexdigest(),'array_manifest':am['manifest_sha256'],'cutoff':am['cutoff']},indent=2))
    print(stats,flush=True)

if __name__ == '__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--arrays',type=Path,required=True);ap.add_argument('--datasets',type=Path,nargs='+',required=True);ap.add_argument('--out',type=Path,required=True)
    a=ap.parse_args();build(a.arrays,a.datasets,a.out)
