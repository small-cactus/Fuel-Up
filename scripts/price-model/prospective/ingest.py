"""Validate immutable archives into dense hourly arrays. Missing remains NaN."""
import argparse, gzip, hashlib, json, time
from datetime import datetime
from pathlib import Path
import numpy as np

FUELS = ['regular_gas', 'midgrade_gas', 'premium_gas', 'diesel', 'e85', 'e15', 'unl88']
BASE = datetime.fromisoformat('2026-09-30T18:19:00+00:00').timestamp()
def hours(value):
    return (datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()-BASE)/3600

def ingest(root, catalog):
    manifest = json.loads((root/'manifest.json').read_text())
    assert hours(manifest['cutoff']) <= 120, 'Reserved holdout supplied'
    batches = {b['ordinal']: b for b in manifest['batches']}
    cat = json.load(gzip.open(catalog))
    ids = sorted({sid for b in batches.values() for sid in b['station_ids']})
    index = {sid:i for i,sid in enumerate(ids)}
    states = {sid:r['code'] for r in cat['regions'] for sid in r['ids']}
    assert len(ids) == 141660 and set(ids) == set(states)
    runs = sorted(manifest['runs'], key=lambda r:r['slot_at'])
    start = hours(runs[0]['slot_at'])
    ntime = int(round(hours(runs[-1]['slot_at'])-start))+1
    shape = (ntime,len(ids),len(FUELS)*2)
    out = root/'arrays'; out.mkdir(exist_ok=True)
    def array(name, dims):
        path = out/(name+'.npy')
        if path.exists(): return np.load(path,mmap_mode='r+')
        a = np.lib.format.open_memmap(path,mode='w+',dtype='float32',shape=dims)
        a[:] = np.nan; a.flush(); return a
    prices, sources = array('prices',shape), array('sources',shape)
    observed = array('observed',shape[:2])
    jobs = {}
    for j in manifest['jobs']: jobs.setdefault(j['run_id'],[]).append(j)
    ignored = set()
    for run in runs:
        marker = out/(str(run['id'])+'.verified')
        if marker.exists(): continue
        while not (root/(str(run['id'])+'.downloaded')).exists(): time.sleep(3)
        t = int(round(hours(run['slot_at'])-start))
        seen = set()
        for job in jobs.get(run['id'],[]):
            raw = (root/job['object_path']).read_bytes()
            assert len(raw)==job['archive_bytes'] and hashlib.sha256(raw).hexdigest()==job['sha256']
            snap = json.loads(gzip.decompress(raw)); batch = batches[job['ordinal']]
            assert snap['version']==1 and snap['provider']=='gasbuddy'
            assert snap['executionRegion']==job['execution_region']==batch['execution_region']
            assert [s['id'] for s in snap['stations']]==batch['station_ids']
            at = hours(snap['observedAt']); began = hours(snap['startedAt'])
            assert abs(at-hours(job['observed_at']))<1e-7 and abs(began-hours(job['started_at']))<1e-7
            assert hours(run['slot_at'])<=began<=at<hours(run['deadline_at'])
            count_priced = 0
            for station in snap['stations']:
                sid = station['id']; assert sid not in seen; seen.add(sid)
                i = index[sid]; observed[t,i] = at; station_priced = False; products=set()
                for p in station['prices']:
                    product=p['fuelProduct']; assert product not in products; products.add(product)
                    for k,payment in enumerate(['cash','credit']):
                        q=p.get(payment)
                        if not q or q['price']<=0: continue
                        assert np.isfinite(q['price']); station_priced=True
                        if product not in FUELS: ignored.add(product); continue
                        c=FUELS.index(product)*2+k; prices[t,i,c]=q['price']
                        if q.get('postedTime'):
                            try: sources[t,i,c]=hours(q['postedTime'])
                            except (ValueError,TypeError): pass
                count_priced+=station_priced
            assert count_priced==job['priced_count']
        if run['status']=='complete': assert len(seen)==141660 and len(jobs[run['id']])==72
        prices.flush(); sources.flush(); observed.flush(); marker.write_text(str(len(seen)))
        print(json.dumps({'verified_run':run['id'],'stations':len(seen),'hour':t}),flush=True)
    metadata={'ids':ids,'states':[states[s] for s in ids],'fuels':FUELS,'base_epoch':BASE,'start_hour':start,'shape':shape,'cutoff':manifest['cutoff'],'ignored_products':sorted(ignored),'manifest_sha256':hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()}
    (out/'metadata.json').write_text(json.dumps(metadata))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('catalog',type=Path);a=p.parse_args();ingest(a.root,a.catalog)
