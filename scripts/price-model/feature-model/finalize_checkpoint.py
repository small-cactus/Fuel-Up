"""Audit a deliberately stopped completed-epoch checkpoint; never invent completion."""
import argparse,json
from pathlib import Path
import numpy as np
import torch
from common import load,record_predictions
from compare import classification

p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('out',type=Path);p.add_argument('--reason',required=True);a=p.parse_args()
d=load(a.dataset);ev=d['meta'][:,5]!=0;m=d['meta'][ev];y=d['y'][ev];v=m[:,5]==1
ckpt=torch.load(a.out/'best.pt',weights_only=False);pred=np.load(a.out/'best-predictions.npy');prob=np.load(a.out/'stale-probabilities.npy');history=json.loads((a.out/'history.json').read_text());spec=json.loads((a.out/'spec.json').read_text())
assert len(pred)==len(m) and ckpt['epoch']<=len(history)
result=record_predictions(a.out,'model',y,pred,m)
result.update(spec=spec,best_epoch=ckpt['epoch'],policy=ckpt['policy'],epochs_completed=len(history),checkpoint_rows_seen=ckpt['epoch']*spec['train_rows'],intentional_stop_reason=a.reason,seconds_to_last_completed_epoch=history[-1]['seconds'],classifier=classification(y[v],prob[v]))
np.savez_compressed(a.out/'evaluation.npz',y=y,meta=m,raw=d['X'][ev,0]);(a.out/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps({'saved_epoch':ckpt['epoch'],'reason':a.reason,'selected':result['policies'][ckpt['policy']]}))
