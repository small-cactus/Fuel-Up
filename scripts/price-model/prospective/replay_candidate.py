"""Reload the frozen checkpoint and verify all saved development predictions."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
from evaluate import price_metrics

from inference import predict

def main(root):
    d=np.load(root/'evaluation-inputs.npz');sparse,pred=predict(root,d['X'],d['sequence']);old=np.load(root/'temporal_128x4-predictions.npy');chosen=np.load(root/'sparse-predictions.npy')
    error=float(np.max(abs(pred-old)));assert error<=1e-7,('checkpoint replay mismatch',error);assert np.array_equal(np.where(abs(pred)>=.1,pred,0),chosen)
    assert np.array_equal(sparse,np.clip(chosen,-.2,.2));np.save(root/'bounded-predictions.npy',sparse)
    v=d['meta'][:,5]==1
    report={'passed':True,'replayed_examples':len(pred),'max_absolute_checkpoint_delta':error,'uncapped_reference_exact_match':True,'bounded_policy_exact_match':True,'metrics':price_metrics(d['y'][v],sparse[v]),'sha256':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['temporal_128x4.pt','normalization.npz','sparse-predictions.npy','bounded-predictions.npy']}}
    (root/'candidate-readback.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('results',type=Path);a=p.parse_args();main(a.results)
