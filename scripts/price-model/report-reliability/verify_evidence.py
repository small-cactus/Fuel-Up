"""Read back the illustrative alternating-price episode from original local archives."""
import argparse,gzip,hashlib,json
from datetime import datetime
from pathlib import Path
import numpy as np


def verify(root,out):
    manifest=json.loads((root/'manifest.json').read_text());am=json.loads((root/'arrays/metadata.json').read_text())
    sid='13053';i=am['ids'].index(sid);batch=next(b for b in manifest['batches'] if sid in b['station_ids'])
    prices=np.load(root/'arrays/prices.npy',mmap_mode='r');sources=np.load(root/'arrays/sources.npy',mmap_mode='r')
    proof=[]
    for run in sorted(manifest['runs'],key=lambda r:r['slot_at']):
        if not '2026-10-03T02:00:00'<=run['slot_at']<'2026-10-03T06:00:00':continue
        job=next(j for j in manifest['jobs'] if j['run_id']==run['id'] and j['ordinal']==batch['ordinal'])
        raw=(root/job['object_path']).read_bytes()
        assert len(raw)==job['archive_bytes'] and hashlib.sha256(raw).hexdigest()==job['sha256']
        data=json.loads(gzip.decompress(raw));assert data['executionRegion']==job['execution_region']==batch['execution_region']
        station=next(s for s in data['stations'] if s['id']==sid)
        t=round((datetime.fromisoformat(run['slot_at']).timestamp()-am['base_epoch'])/3600-am['start_hour'])
        for product in station['prices']:
            for k,payment in enumerate(['cash','credit']):
                quote=product.get(payment)
                if not quote:continue
                c=am['fuels'].index(product['fuelProduct'])*2+k
                assert abs(float(prices[t,i,c])-quote['price'])<1e-5
                hours=(datetime.fromisoformat(quote['postedTime'].replace('Z','+00:00')).timestamp()-am['base_epoch'])/3600
                assert abs(float(sources[t,i,c])-hours)<1e-4
        proof.append({'slot':run['slot_at'],'object_path':job['object_path'],'sha256':job['sha256'],
                      'execution_region':data['executionRegion'],'observed_at':data['observedAt'],'station':station,'array_match':True})
    assert len(proof)==4
    out.write_text(json.dumps(proof,indent=2));print('Four immutable archive hashes, fixed region, prices and source times match.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('out',type=Path);a=p.parse_args();verify(a.root,a.out)
