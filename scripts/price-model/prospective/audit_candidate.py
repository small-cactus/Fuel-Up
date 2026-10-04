"""Reproduce adverse-case, correction-cap and classifier-gate diagnostics."""
import argparse,json
from pathlib import Path
import numpy as np
from evaluate import price_metrics,grouped_mae_interval
p=argparse.ArgumentParser();p.add_argument('results',type=Path);a=p.parse_args();r=a.results
d=np.load(r/'evaluation-inputs.npz');v=d['meta'][:,5]==1;y=d['y'][v];prediction=np.load(r/'sparse-predictions.npy')[v];station=d['meta'][v,0]
rows=[]
for cap in [.1,.2,.3,.5,.75,1.]:
    q=np.clip(prediction,-cap,cap);e=np.abs(q-y)-np.abs(y)
    rows.append({'cap_dollars':cap,**price_metrics(y,q),'maximum_worsening_cents':float(e.max()*100),'station_interval':grouped_mae_interval(y,q,station)})
(r/'bounded-sensitivity.json').write_text(json.dumps(rows,indent=2))
prob=np.load(r/'change-probabilities.npy')[v];rows=[]
for threshold in [.1,.25,.5,.75]:
    q=np.where(prob>=threshold,prediction,0);e=abs(q-y)-abs(y)
    rows.append({'minimum_change_probability':threshold,'adjusted':int(np.count_nonzero(q)),**price_metrics(y,q),'maximum_worsening_cents':float(e.max()*100)})
(r/'classifier-gate-sensitivity.json').write_text(json.dumps(rows,indent=2))
print(json.dumps({'cap_variants':6,'classifier_gate_variants':4,'selection_note':'Exploratory development diagnostics; not independent holdout evidence.'}))
