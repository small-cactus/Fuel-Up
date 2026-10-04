"""Research inference for the frozen sparse temporal candidate (CUDA BF16)."""
import argparse
from pathlib import Path
import numpy as np
import torch
from network import TemporalPrice

def predict(root,X,sequence):
    assert torch.cuda.is_available(),'The frozen benchmark uses CUDA BF16 inference.'
    torch.set_num_threads(8);torch.set_float32_matmul_precision('high')
    ckpt=torch.load(root/'temporal_128x4.pt',map_location='cpu',weights_only=True);norm=np.load(root/'normalization.npz')
    fill=np.where(np.isfinite(X),X,norm['median']);features=np.concatenate([np.clip((fill-norm['mean'])/norm['scale'],-20,20),~np.isfinite(X)],axis=1).astype('float32')
    model=TemporalPrice(ckpt['features'],ckpt['width'],ckpt['layers']).cuda();model.load_state_dict(ckpt['state_dict']);model.eval();result=[]
    with torch.inference_mode(),torch.autocast('cuda',dtype=torch.bfloat16):
        for lo in range(0,len(X),512):
            result.append(model(torch.from_numpy(features[lo:lo+512]).cuda(),torch.from_numpy(sequence[lo:lo+512].astype('float32')).cuda()).float().cpu().numpy())
    residual=np.concatenate(result);correction=np.where(abs(residual)>=.1,residual,0)
    return np.clip(correction,-.2,.2),residual


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('artifacts',type=Path);p.add_argument('inputs',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    d=np.load(a.inputs);X=d['X'];sequence=d['sequence']
    assert X.ndim==2 and X.shape[1]==47 and sequence.shape==(len(X),24,4)
    correction,_=predict(a.artifacts,X,sequence)
    np.savez_compressed(a.output,raw_price=X[:,0],estimated_price=X[:,0]+correction,correction=correction,is_estimated=correction!=0)
