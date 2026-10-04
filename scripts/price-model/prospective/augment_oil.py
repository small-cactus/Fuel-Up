"""Append past-only crude features; preserve the exact station labels and split."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
import pandas as pd
from ingest import BASE

def main(root):
    dest=root/'dataset-oil';dest.mkdir(exist_ok=True);metadata=json.loads((root/'dataset/metadata.json').read_text());sources={};new_features=[];cache={}
    for name in ['DCOILWTICO','DCOILBRENTEU']:
        p=root/'oil'/(name+'.csv');d=pd.read_csv(p,parse_dates=['observation_date']).set_index('observation_date')[name];d=pd.to_numeric(d,errors='coerce').dropna()
        sources[name]=d.reindex(pd.date_range(d.index.min(),'2026-10-04')).ffill()
        for lag in [8,14,21,28,30,42,60]:new_features += [f'{name}_level_lag_{lag}d',f'{name}_change_lag_{lag}d']
    for part in sorted((root/'dataset').glob('part-*.npz')):
        d=np.load(part);dates=pd.to_datetime(d['meta'][:,3]*3600+BASE,unit='s',utc=True).tz_localize(None).normalize()
        # BASE is 2026-09-30 18:19 UTC. Features contain no target dates or prices.
        assert pd.Timestamp(BASE,unit='s',tz='UTC')==pd.Timestamp('2026-09-30T18:19:00Z')
        for date in dates.unique():
            if date in cache:continue
            values=[]
            for name,series in sources.items():
                for lag in [8,14,21,28,30,42,60]:
                    at=date-pd.Timedelta(days=lag);old=at-pd.Timedelta(days=7)
                    values.extend([float(series.loc[at])/42,float(series.loc[at]-series.loc[old])/42])
            cache[date]=values
        extra=np.array([cache[t] for t in dates],dtype='float32');assert np.isfinite(extra).all()
        np.savez_compressed(dest/part.name,X=np.concatenate([d['X'],extra],axis=1),sequence=d['sequence'],y=d['y'],meta=d['meta'])
    metadata['features']+=new_features;metadata['oil']={'features':new_features,'minimum_calendar_lag_days':8,'observed_dates':[str(d.date()) for d in sorted(cache)],'unique_daily_feature_vectors':len(cache),'sources':{n:hashlib.sha256((root/'oil'/(n+'.csv')).read_bytes()).hexdigest() for n in sources},'limitation':'Only a few distinct macro feature dates; cannot establish month-long station-specific effects. Eight-day availability embargo; current-vintage public series.'}
    (dest/'metadata.json').write_text(json.dumps(metadata,indent=2));print(json.dumps(metadata['oil']),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);a=p.parse_args();main(a.root)
